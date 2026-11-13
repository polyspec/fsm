#!/usr/bin/env node
// persist-servers runs a command with the PostgreSQL and the MySQL server of the tests, each in a container of the run, from
// the images that config/containers.json pins by their digests (docs/plans/fsm-v1/plan.md, C-6;
// docs/plans/fsm-v1/checklist.md, S-472-1, S-475).
//
//   node scripts/persist-servers.mts run -- <command> [argument...]
//   node scripts/persist-servers.mts pull
//
// bay starts and removes the servers: it runs a Compose project on Apple container on Darwin and on Docker on Linux. A run
// makes a directory of its own in the temporary directory of the system, fsm-persist-<pid>-<random>, whose name holds the
// process id of the run and 4 random bytes, and writes its compose.yaml into it. The key name of the file is the name of
// the directory, because bay has no option that names a project (S-475-1), and bay names each container
// <project>-<service>, so two runs share no project and no container. The file publishes no port and mounts nothing.
//
// A run needs bay and the container program of the platform on PATH, and fails at once without one, with its name and what
// installs it. bay check, which changes nothing, must pass before a server starts, so that bay up asks no person for a
// password in the middle of a run. The container program, whose commands scripts/container.mts holds, tells whether an
// image is installed and pulls it, because bay has no command for either (S-475-2): an image that is not installed fails
// the run before a server starts and names make persist-images, the target of pull. run downloads nothing.
//
// Waiting for the servers has no sleep, no polling and no time limit in this file: each service declares a healthcheck, the
// program of its server over TCP in its container, bay checks it at the start and returns from up after each service is
// healthy, and that return is the ready event. The interval, the timeout and the retries of a healthcheck are declarations
// that Compose requires and bay evaluates (plan C-6 states the reason of each value). The run shows each line of bay as `persist-servers: bay <verb>: <line>`.
// A bay up that fails fails the run with the last lines of each service, which bay logs prints.
//
// The command runs with the four variables of the servers, FSM_TEST_PG_DSN, FSM_TEST_PG_ADMIN_DSN, FSM_TEST_MYSQL_DSN and
// FSM_TEST_MYSQL_ADMIN_DSN, which name the address of each service and the port of its server. The address is the one that
// bay reports: after bay up the run reads `bay status --json`, and takes the field address of the service in the group of
// its project. The run builds no name of a service itself, because the form of the name belongs to bay; when bay up has a
// JSON output, the run reads that instead (S-475-3). The run runs bay down and removes its directory when the command ends or fails and
// when bay up fails. SIGINT and SIGTERM are forwarded to the command; a signal that comes while the servers start ends the
// run once bay up has ended, without the command. A bay down that fails fails the run, which keeps its directory and names
// it: bay down in that directory removes the containers that may still run. The exit code is that of the command, 130 or
// 143 for the two signals, and 1 for a failure of the run itself.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { ContainerError, containerCommand, containerProgram, onPath, type Program, type Verb } from './container.mts';

const ROOT = path.resolve(import.meta.dirname, '..');
const PINS = path.join(ROOT, 'config/containers.json');
const USAGE = 'usage: scripts/persist-servers.mts run -- <command> [argument...] | pull';
// TAIL is the count of the last lines of a service that a failed start shows.
const TAIL = 40;
// The declarations of a healthcheck, which bay evaluates: it asks each second, where the default of Compose is 30 s; one ask
// of a server in the same container may take 5 s; and 300 asks give the initialization of an image five minutes, where the
// default of 3 would report a server that still initializes.
const HEALTH = ['interval: "1s"', 'timeout: "5s"', 'retries: 300'];

/** A failure of the run that ends it with `code` and the message on standard error. */
class Failure extends Error {
  code: number;

  constructor(message: string, code = 1) {
    super(message);
    this.code = code;
  }
}

type Kind = 'postgres' | 'mysql';
// A kind is the name of its service in the Compose file of a run.
const KINDS: readonly Kind[] = ['postgres', 'mysql'];

/**
 * A server of the tests. `port` is the port of the server in its container; `environment` creates its accounts and its
 * database when the image initializes it; `health` is the command that ends with 0 when the server answers over TCP, never
 * over the socket, on which the temporary server of the initialization of the image listens too; `variables` are the variables of the tests for the address `host` of the service.
 */
interface Server {
  port: number;
  environment: Record<string, string>;
  health: readonly string[];
  variables: (host: string) => Record<string, string>;
}

// The accounts are those of the tests (plan C-6): the PostgreSQL user fsm is the superuser of the image, which owns the
// databases that createEmptyDatabase creates, and the MySQL accounts root and fsm connect from every host.
const SERVERS: Record<Kind, Server> = {
  postgres: {
    port: 5432,
    environment: { POSTGRES_USER: 'fsm', POSTGRES_PASSWORD: 'fsm', POSTGRES_DB: 'fsm_test' },
    health: ['pg_isready', '--host=127.0.0.1', '--port=5432', '--username=fsm', '--dbname=fsm_test'],
    variables: host => {
      const dsn = `postgres://fsm:fsm@${host}:5432/fsm_test?sslmode=disable`;
      return { FSM_TEST_PG_DSN: dsn, FSM_TEST_PG_ADMIN_DSN: dsn };
    },
  },
  mysql: {
    port: 3306,
    environment: { MYSQL_ROOT_PASSWORD: 'root', MYSQL_USER: 'fsm', MYSQL_PASSWORD: 'fsm', MYSQL_DATABASE: 'fsm_test' },
    health: ['mysqladmin', 'ping', '--protocol=tcp', '--host=127.0.0.1', '--port=3306'],
    variables: host => ({
      FSM_TEST_MYSQL_DSN: `mysql://fsm:fsm@${host}:3306/fsm_test`,
      FSM_TEST_MYSQL_ADMIN_DSN: `mysql://root:root@${host}:3306/mysql`,
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

/** Writes a line of the run to standard error. */
function show(line: string): void {
  process.stderr.write(`${line}\n`);
}

/**
 * The Compose file of the project `project`: a service for each server, with the image of its pin, the port of its server
 * in `expose`, the environment of its accounts and its healthcheck. Each scalar is written as a JSON string, which YAML reads as the same
 * string. The file names no host port, no domain, no volume and no path.
 */
function composeFile(project: string): string {
  const lines = [`name: ${JSON.stringify(project)}`, 'services:'];
  for (const kind of KINDS) {
    const server = SERVERS[kind];
    lines.push(`  ${kind}:`, `    image: ${JSON.stringify(image(kind))}`, `    expose: [${JSON.stringify(String(server.port))}]`, '    environment:');
    for (const [name, value] of Object.entries(server.environment)) lines.push(`      ${name}: ${JSON.stringify(value)}`);
    lines.push('    healthcheck:', `      test: [${['CMD', ...server.health].map(word => JSON.stringify(word)).join(', ')}]`, ...HEALTH.map(declared => `      ${declared}`));
  }
  return `${lines.join('\n')}\n`;
}

// The words of the command of bay that prints its projects and their services as JSON.
const LISTING = ['status', '--json'];

/** How a command of bay ended: its exit code, or the signal that ended it. */
type End = number | NodeJS.Signals | null;

/**
 * Runs bay with `args` in the directory `directory` of a project and resolves with how it ended. Each line that bay prints
 * is shown as `persist-servers: <label>: <line>`. bay runs in a process group of its own, so a signal of the terminal
 * reaches the run alone, which removes the project itself.
 */
function bay(directory: string, args: readonly string[], label: string): Promise<End> {
  return new Promise((resolve, reject) => {
    const child = spawn('bay', args, { cwd: directory, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', line => { show(`persist-servers: ${label}: ${line}`); });
    child.on('error', error => { reject(new Failure(`persist-servers: bay: ${error.message}`)); });
    // close comes after the end of both streams, so every line of bay was shown.
    child.on('close', (code, signal) => { resolve(code ?? signal); });
  });
}

/** Fails unless bay check passes: it changes nothing and fails when a part of the machine setup of bay is missing. */
function check(): void {
  const ran = spawnSync('bay', ['check'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (ran.error) throw new Failure(`persist-servers: bay: ${ran.error.message}`);
  if (ran.status === 0) return;
  for (const line of `${ran.stdout}${ran.stderr}`.split('\n').filter(each => each !== '')) show(`persist-servers: bay check: ${line}`);
  throw new Failure(`persist-servers: bay check ended with ${String(ran.status ?? ran.signal)}: a part of the machine setup of bay is missing: run bay install`);
}

/**
 * The address of the service of each kind of the project `project`, which runs in `directory`, as bay reports it: the field
 * address of the service of that name in the group of that name, in the JSON of `bay status --json`. A project or a service
 * that the JSON does not hold, and an address that is no text or is empty, fail the run.
 */
function addresses(directory: string, project: string): Record<Kind, string> {
  const ran = spawnSync('bay', LISTING, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (ran.error) throw new Failure(`persist-servers: bay: ${ran.error.message}`);
  const command = `bay ${LISTING.join(' ')}`;
  if (ran.status !== 0) throw new Failure(`persist-servers: ${command} ended with ${String(ran.status ?? ran.signal)}:\n${ran.stderr}${ran.stdout}`.trimEnd());
  const groups = field(parse(ran.stdout, `the output of ${command}`), 'groups');
  const group: unknown = Array.isArray(groups) ? groups.find(each => field(each, 'name') === project) : undefined;
  const services = field(group, 'services');
  const address = (kind: Kind): string => {
    const found = field(Array.isArray(services) ? services.find(each => field(each, 'name') === kind) : undefined, 'address');
    if (typeof found !== 'string' || found === '') throw new Failure(`persist-servers: ${command} names no address of the service ${kind} of the project ${project}:\n${ran.stdout}`.trimEnd());
    return found;
  };
  return { postgres: address('postgres'), mysql: address('mysql') };
}

/** Runs the command of `verb` for the image of `kind` on the container program `program`, with the output of the program on that of the run when `shown`, and returns its exit code, or the signal that ended it. */
function engine(program: Program, verb: Verb, kind: Kind, shown: boolean): number | NodeJS.Signals | null {
  const ran = spawnSync(program, containerCommand(verb, image(kind)), { stdio: shown ? 'inherit' : ['ignore', 'ignore', 'inherit'] });
  if (ran.error) throw new Failure(`persist-servers: ${program}: ${ran.error.message}`);
  return ran.status ?? ran.signal;
}

const SIGNALS = { SIGINT: 130, SIGTERM: 143 } as const;
type Signal = keyof typeof SIGNALS;

/** Runs `command` with the servers and returns the exit code of the run. */
async function run(command: readonly string[]): Promise<number> {
  const [file, ...args] = command;
  if (file === undefined) throw new Failure(USAGE, 2);
  if (!onPath('bay')) throw new Failure('persist-servers: bay is not found on PATH: install bay and apply its machine setup with bay install');
  const program = containerProgram();
  check();
  for (const kind of KINDS) {
    if (engine(program, 'present', kind, false) !== 0) throw new Failure(`persist-servers: the image ${image(kind)} of ${kind} is not installed: run make persist-images`);
  }
  const project = `fsm-persist-${String(process.pid)}-${randomBytes(4).toString('hex')}`;
  const directory = path.join(tmpdir(), project);
  const composed = composeFile(project);
  // state is what the listeners of the signals share with the run: the signal that it received and its command.
  const state: { received?: Signal; child?: ChildProcess } = {};
  const receive = (signal: Signal) => (): void => {
    state.received = signal;
    if (state.child) state.child.kill(signal);
    else show(`persist-servers: received ${signal}; the run ends when bay up has ended`);
  };
  const listeners = { SIGINT: receive('SIGINT'), SIGTERM: receive('SIGTERM') };
  process.on('SIGINT', listeners.SIGINT);
  process.on('SIGTERM', listeners.SIGTERM);
  let code = 1;
  mkdirSync(directory, { mode: 0o700 });
  try {
    writeFileSync(path.join(directory, 'compose.yaml'), composed);
    const up = await bay(directory, ['up'], 'bay up');
    if (up !== 0) {
      for (const kind of KINDS) await bay(directory, ['logs', '-n', String(TAIL), kind], kind);
      throw new Failure(`persist-servers: bay up ended with ${String(up)} before the servers of the project ${project} accepted connections`);
    }
    if (state.received !== undefined) code = SIGNALS[state.received];
    else {
      const hosts = addresses(directory, project);
      const variables: Record<string, string> = {};
      for (const kind of KINDS) Object.assign(variables, SERVERS[kind].variables(hosts[kind]));
      code = await new Promise<number>((resolve, reject) => {
        const spawned = spawn(file, args, { env: { ...process.env, ...variables }, stdio: 'inherit' });
        state.child = spawned;
        spawned.on('error', error => { reject(new Failure(`persist-servers: ${file}: ${error.message}`)); });
        spawned.on('exit', (ended, signal) => { resolve(ended ?? (signal === 'SIGINT' || signal === 'SIGTERM' ? SIGNALS[signal] : 1)); });
      });
    }
  } finally {
    // The project is removed also after a failed bay up, which may have started a service. A bay that did not start is a
    // failed removal too.
    const down = await bay(directory, ['down'], 'bay down').catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
    process.off('SIGINT', listeners.SIGINT);
    process.off('SIGTERM', listeners.SIGTERM);
    if (down === 0) {
      rmSync(directory, { recursive: true, force: true });
      show(`persist-servers: removed the project ${project}`);
    } else {
      show(`persist-servers: bay down ended with ${String(down)}; the containers of the project ${project} may still run: run bay down in ${directory}`);
      if (code === 0) code = 1;
    }
  }
  return code;
}

/** Pulls each pinned image with the container program of the platform; it is the only command that downloads. */
function pull(): void {
  const program = containerProgram();
  for (const kind of KINDS) {
    const ended = engine(program, 'pull', kind, true);
    if (ended !== 0) throw new Failure(`persist-servers: the pull of ${image(kind)} ended with ${String(ended)}`);
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
