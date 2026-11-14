#!/usr/bin/env node
// persist-servers runs a command with the PostgreSQL and the MySQL server of the tests, each in a container of the run, from
// the images that config/containers.json pins by their digests (docs/plans/fsm-v1/plan.md, C-6;
// docs/plans/fsm-v1/checklist.md, S-472-1).
//
//   node scripts/persist-servers.mts run -- <command> [argument...]
//   node scripts/persist-servers.mts pull
//
// The container program is the one of the platform, whose commands scripts/container.mts holds: Apple container on Darwin
// and docker on Linux. A program that PATH does not hold fails the run at once, and an image that is not installed fails it
// before a container starts and names make persist-images, the target of pull: run downloads nothing.
//
// A run owns its containers. Their names hold the process id of the run and 4 random bytes,
// fsm-persist-<pid>-<random>-postgres and fsm-persist-<pid>-<random>-mysql, so two runs share no container. No port is
// published: the DSNs name the address of each container on its network, which the container program assigns, and the port
// of the server in the container.
//
// Waiting for a server has no sleep, no polling and no time limit: the container runs attached, the run reads each line of
// its output, shows it on standard error as `persist-servers: <kind>: <line>`, and goes on at the ready line that the
// server logs after the line of the initialization of its image; the temporary server of that initialization logs a ready
// line too, which is not the one. The ready line is the event of the server: a ready line that names another port than
// that of the tests fails the run with that line at once, since no later line of the server would be its ready line, and a
// container that stops before its ready line fails the run with its last lines. The run shows each of its steps: the
// initialization and the ready line of each server, the start of the command and its end, and the removal.
//
// The command runs with the four variables of the servers, FSM_TEST_PG_DSN, FSM_TEST_PG_ADMIN_DSN, FSM_TEST_MYSQL_DSN and
// FSM_TEST_MYSQL_ADMIN_DSN. The run removes its containers when the command ends or fails and when the start of a server
// fails. SIGINT and SIGTERM are forwarded to the command; a signal that comes while the servers start ends the run once the
// start ends, without the command. The exit code is that of the command, 130 or 143 for the two signals, and 1 for a
// failure of the run itself.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { ContainerError, containerCommand, containerProgram, type Program, type Verb } from './container.mts';

const ROOT = path.resolve(import.meta.dirname, '..');
const PINS = path.join(ROOT, 'config/containers.json');
const USAGE = 'usage: scripts/persist-servers.mts run -- <command> [argument...] | pull';
// TAIL is the count of the last lines of a container that a failure shows.
const TAIL = 40;

/** A failure of the run that ends it with `code` and the message on standard error. */
class Failure extends Error {
  code: number;

  constructor(message: string, code = 1) {
    super(message);
    this.code = code;
  }
}

type Kind = 'postgres' | 'mysql';
const KINDS: readonly Kind[] = ['postgres', 'mysql'];

/**
 * A server of the tests. `environment` creates its accounts and its database when the image initializes it; `initialized`
 * is the line of the image after that initialization, and `ready` tells the first line after it that says that the server
 * accepts connections; `refused` gives the failure of such a line that names another port than that of the tests, and
 * undefined for a line of that port; `variables` are the variables of the tests for the address of the container.
 */
interface Server {
  environment: string[];
  initialized: string;
  ready: (line: string) => boolean;
  refused: (line: string) => string | undefined;
  variables: (address: string) => Record<string, string>;
}

// The accounts are those of the tests (plan C-6): the PostgreSQL user fsm is the superuser of the image, which owns the
// databases that createEmptyDatabase creates, and the MySQL accounts root and fsm connect from every host.
const SERVERS: Record<Kind, Server> = {
  postgres: {
    environment: ['POSTGRES_USER=fsm', 'POSTGRES_PASSWORD=fsm', 'POSTGRES_DB=fsm_test'],
    initialized: 'PostgreSQL init process complete',
    ready: line => line.includes('database system is ready to accept connections'),
    // The ready line of PostgreSQL names no port; the server listens on 5432, the line before it says so.
    refused: () => undefined,
    variables: address => {
      const dsn = `postgres://fsm:fsm@${address}:5432/fsm_test?sslmode=disable`;
      return { FSM_TEST_PG_DSN: dsn, FSM_TEST_PG_ADMIN_DSN: dsn };
    },
  },
  mysql: {
    environment: ['MYSQL_ROOT_PASSWORD=root', 'MYSQL_USER=fsm', 'MYSQL_PASSWORD=fsm', 'MYSQL_DATABASE=fsm_test'],
    initialized: 'MySQL init process done',
    // The ready line of the server names its port inside the line: `... port: 3306  MySQL Community Server - GPL.`. The
    // temporary server of the initialization logs it with port 0 before the line of the initialization, and the line of the
    // X plugin is `X Plugin ready for connections`, which is not the line of mysqld.
    ready: line => line.includes('mysqld: ready for connections'),
    refused: line => (/\bport: 3306\b/.test(line) ? undefined : `the server is ready on another port than 3306: ${line}`),
    variables: address => ({
      FSM_TEST_MYSQL_DSN: `mysql://fsm:fsm@${address}:3306/fsm_test`,
      FSM_TEST_MYSQL_ADMIN_DSN: `mysql://root:root@${address}:3306/mysql`,
    }),
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value of the property `name` of a parsed JSON value, or undefined when the value is no object or has no such property. */
function field(value: unknown, name: string): unknown {
  return isRecord(value) ? value[name] : undefined;
}

/** The value that the JSON `text` holds; `source` names it in the failure of a text that is no JSON. */
function parse(text: string, source: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Failure(`persist-servers: ${source} is no JSON:\n${text}`);
  }
}

/** The reference of the image of `kind`, which config/containers.json pins by its digest. */
function image(kind: Kind): string {
  const reference = field(field(field(parse(readFileSync(PINS, 'utf8'), PINS), 'images'), kind), 'reference');
  if (typeof reference !== 'string' || !/@sha256:[0-9a-f]{64}$/.test(reference)) throw new Failure(`persist-servers: ${PINS} pins no image of ${kind} by its digest`);
  return reference;
}

/** How a command of the container program ended, with its output. */
interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the command of `verb` on `program` and returns how it ended; fails when the program did not start. */
function container(program: Program, verb: Verb, args: readonly string[]): Ran {
  const ran = spawnSync(program, containerCommand(program, verb, args), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (ran.error) throw new Failure(`persist-servers: ${program}: ${ran.error.message}`);
  return { code: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

/**
 * The IPv4 address of the container `name` on its network, from the JSON that the inspect of `program` prints: docker names
 * it in NetworkSettings.Networks.<network>.IPAddress, and Apple container in status.networks[].ipv4Address with its prefix
 * length.
 */
function address(program: Program, name: string): string {
  const inspected = container(program, 'inspect', [name]);
  if (inspected.code !== 0) throw new Failure(`persist-servers: ${program} inspect ${name} ended with ${String(inspected.code)}:\n${inspected.stderr}${inspected.stdout}`.trimEnd());
  const described = parse(inspected.stdout, `the output of ${program} inspect ${name}`);
  const first: unknown = Array.isArray(described) ? described[0] : undefined;
  let found: unknown;
  if (program === 'docker') {
    const networks = field(field(first, 'NetworkSettings'), 'Networks');
    found = isRecord(networks) ? Object.values(networks).map(network => field(network, 'IPAddress')).find(each => typeof each === 'string' && each !== '') : undefined;
  } else {
    const networks = field(field(first, 'status'), 'networks');
    found = Array.isArray(networks) ? field(networks[0], 'ipv4Address') : undefined;
  }
  const text = (typeof found === 'string' ? found : '').split('/')[0] ?? '';
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(text)) throw new Failure(`persist-servers: ${program} inspect ${name} names no IPv4 address`);
  return text;
}

/**
 * A started container: `ready` resolves at the ready line of its server and rejects when the container stops first;
 * `ended` resolves when the attached container program has ended, and `stopped` tells that it has.
 */
interface Launched {
  kind: Kind;
  name: string;
  ready: Promise<void>;
  ended: Promise<void>;
  stopped: boolean;
}

/** Writes a line of the run to standard error. */
function show(line: string): void {
  process.stderr.write(`${line}\n`);
}

/**
 * Starts the container `name` of the server of `kind` on `program`, attached and in a process group of its own, so that a signal of the
 * terminal reaches the run alone, which removes the container itself.
 */
function launch(program: Program, kind: Kind, name: string): Launched {
  const server = SERVERS[kind];
  const child = spawn(program, containerCommand(program, 'run', [name, ...server.environment.flatMap(setting => ['--env', setting]), image(kind)]), { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const last: string[] = [];
  let initialized = false;
  let finish: () => void = () => undefined;
  const launched: Launched = {
    kind,
    name,
    stopped: false,
    ended: new Promise(resolve => { finish = resolve; }),
    ready: new Promise((resolve, reject) => {
      const read = (line: string): void => {
        show(`persist-servers: ${kind}: ${line}`);
        last.push(line);
        if (last.length > TAIL) last.shift();
        if (line.includes(server.initialized)) {
          initialized = true;
          show(`persist-servers: ${kind} is initialized; the run waits for the ready line of its server`);
        } else if (initialized && server.ready(line)) {
          const refused = server.refused(line);
          if (refused === undefined) {
            show(`persist-servers: ${kind} is ready`);
            resolve();
          } else reject(new Failure(`persist-servers: ${kind}: ${refused}`));
        }
      };
      for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', read);
      const stop = (failure: Failure): void => {
        launched.stopped = true;
        reject(failure);
        finish();
      };
      child.on('error', error => { stop(new Failure(`persist-servers: ${program}: ${error.message}`)); });
      // close comes after the end of both streams, so every line of the container was read.
      child.on('close', (code, signal) => {
        stop(new Failure(`persist-servers: the container ${name} of ${kind} stopped with ${String(code ?? signal)} before it was ready; its last lines:\n${last.join('\n')}`));
      });
    }),
  };
  // A container that stops after its ready line, or after the failure of the other, rejects a promise that nothing awaits.
  launched.ready.catch(() => undefined);
  return launched;
}

/**
 * Stops and removes the containers of `launched` that still run on `program` and waits for the end of their container programs. It
 * returns false when the removal failed: the containers may still run, and the run does not wait for them.
 */
async function remove(program: Program, launched: Launched[]): Promise<boolean> {
  const running = launched.filter(each => !each.stopped);
  if (running.length === 0) return true;
  const names = running.map(each => each.name);
  const ran = container(program, 'delete', names);
  if (ran.code !== 0) {
    show(`persist-servers: the removal of ${names.join(' ')} failed with ${String(ran.code)}; a container of these names may still run:\n${ran.stderr}${ran.stdout}`.trimEnd());
    return false;
  }
  await Promise.all(running.map(each => each.ended));
  show(`persist-servers: removed ${names.join(' ')}`);
  return true;
}

const SIGNALS = { SIGINT: 130, SIGTERM: 143 } as const;
type Signal = keyof typeof SIGNALS;

/** Runs `command` with the servers and returns the exit code of the run. */
async function run(command: readonly string[]): Promise<number> {
  const [file, ...args] = command;
  if (file === undefined) throw new Failure(USAGE, 2);
  const program = containerProgram();
  for (const kind of KINDS) {
    const present = container(program, 'present', [image(kind)]);
    if (present.code !== 0) throw new Failure(`${present.stderr}persist-servers: the image ${image(kind)} of ${kind} is not installed: run make persist-images`);
  }
  const id = `fsm-persist-${String(process.pid)}-${randomBytes(4).toString('hex')}`;
  // state is what the listeners of the signals share with the run: the signal that it received and its command.
  const state: { received?: Signal; child?: ChildProcess } = {};
  const receive = (signal: Signal) => (): void => {
    state.received = signal;
    if (state.child) state.child.kill(signal);
    else show(`persist-servers: received ${signal}; the run ends when the start of the servers has ended`);
  };
  const listeners = { SIGINT: receive('SIGINT'), SIGTERM: receive('SIGTERM') };
  process.on('SIGINT', listeners.SIGINT);
  process.on('SIGTERM', listeners.SIGTERM);
  const launched: Launched[] = [];
  let code = 1;
  try {
    for (const kind of KINDS) launched.push(launch(program, kind, `${id}-${kind}`));
    show(`persist-servers: started ${launched.map(each => each.name).join(' ')}; the run waits for the ready line of each server`);
    await Promise.all(launched.map(each => each.ready));
    if (state.received !== undefined) code = SIGNALS[state.received];
    else {
      const variables: Record<string, string> = {};
      for (const each of launched) Object.assign(variables, SERVERS[each.kind].variables(address(program, each.name)));
      show(`persist-servers: the servers are ready; running ${command.join(' ')}`);
      code = await new Promise<number>((resolve, reject) => {
        const spawned = spawn(file, args, { env: { ...process.env, ...variables }, stdio: 'inherit' });
        state.child = spawned;
        spawned.on('error', error => { reject(new Failure(`persist-servers: ${file}: ${error.message}`)); });
        spawned.on('exit', (ended, signal) => { resolve(ended ?? (signal === 'SIGINT' || signal === 'SIGTERM' ? SIGNALS[signal] : 1)); });
      });
      show(`persist-servers: ${file} ended with ${String(code)}; the run removes the servers`);
    }
  } finally {
    const removed = await remove(program, launched);
    process.off('SIGINT', listeners.SIGINT);
    process.off('SIGTERM', listeners.SIGTERM);
    if (!removed && code === 0) code = 1;
  }
  return code;
}

/** Pulls each pinned image; it is the only command that downloads. */
function pull(): void {
  const program = containerProgram();
  for (const kind of KINDS) {
    const ran = spawnSync(program, containerCommand(program, 'pull', [image(kind)]), { stdio: 'inherit' });
    if (ran.error) throw new Failure(`persist-servers: ${program}: ${ran.error.message}`);
    if (ran.status !== 0) throw new Failure(`persist-servers: the pull of ${image(kind)} ended with ${String(ran.status ?? ran.signal)}`);
  }
}

if (import.meta.main) {
  const [verb, separator, ...command] = process.argv.slice(2);
  try {
    if (verb === 'run' && separator === '--' && command.length > 0) process.exitCode = await run(command);
    else if (verb === 'pull' && separator === undefined) pull();
    else throw new Failure(USAGE, 2);
  } catch (error) {
    if (!(error instanceof Failure) && !(error instanceof ContainerError)) throw error;
    show(error.message);
    process.exitCode = error.code;
  }
}
