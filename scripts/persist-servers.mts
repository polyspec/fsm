#!/usr/bin/env node
// persist-servers runs a command with the PostgreSQL and the MySQL server of the tests, each in a container of the run, from
// the images that config/containers.json pins by their digests (docs/plans/fsm-v1/plan.md, C-6;
// docs/plans/fsm-v1/checklist.md, S-472-1, S-475).
//
//   node scripts/persist-servers.mts run -- <command> [argument...]
//   node scripts/persist-servers.mts pull
//
// bay pulls, starts and removes the servers: it runs a Compose project on Apple container on Darwin and on Docker on Linux,
// and this file calls no container program itself. A run makes a directory of its own in the temporary directory of the
// system, fsm-persist-<pid>-<random>, whose name holds the process id of the run and 4 random bytes, and writes its
// compose.yaml into it. Each command of bay names that file and the project, the name of the directory, by the options -f
// and -p before the command; bay names each container <project>-<service> and keeps two names apart, so two runs share no
// project and no container. The file publishes no port and mounts nothing.
//
// A run needs bay on PATH and fails at once without it, with its name and what installs it. It first shows what bay version
// --json prints, so the record of a run names the bay that made its result (S-475-4). It checks no machine setup: bay up
// changes none, and with a part missing it fails and names the part and bay install.
//
// run downloads nothing: bay images --json, which fetches nothing, tells whether each image is installed, and an image that
// is not fails the run before a server starts and names make persist-images, the target of pull; bay up -no-pull then fails
// before it creates anything when the store lacks an image. pull writes the same Compose file into a directory of its own,
// runs bay pull on it and removes the directory.
//
// Waiting for the servers has no sleep, no polling and no time limit in this file: each service declares a healthcheck, the
// program of its server over TCP in its container, bay runs it at the start and returns from up after each service is
// healthy, and that return is the ready event. The values of a healthcheck are declarations that bay evaluates (plan C-6
// states the reason of each value). The run shows each line of the progress of bay as `persist-servers: bay <verb>: <line>`.
//
// The command runs with the four variables of the servers, FSM_TEST_PG_DSN, FSM_TEST_PG_ADMIN_DSN, FSM_TEST_MYSQL_DSN and
// FSM_TEST_MYSQL_ADMIN_DSN, which name the host and the port of each service as the JSON of bay up --json holds them. The
// run builds no name of a service itself, because the form of the name belongs to bay.
//
// Once bay up was started, the run runs bay down and removes its directory when the command ends or fails and when bay up
// fails; bay down ends with 0 also for a project of which bay made nothing. SIGINT and SIGTERM are forwarded to the command;
// a signal that comes while the servers start is forwarded to bay up, which removes what it created, and the run then ends
// without the command. A bay down that fails fails the run, which keeps its directory and shows the command that removes
// the project, because that command needs the Compose file. The exit code is that of the command, 130 or 143 for the two
// signals, and 1 for a failure of the run itself.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { accessSync, constants, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

const ROOT = path.resolve(import.meta.dirname, '..');
const PINS = path.join(ROOT, 'config/containers.json');
const USAGE = 'usage: scripts/persist-servers.mts run -- <command> [argument...] | pull';
// The declarations of a healthcheck, which bay evaluates: the start period is the time of the initialization of an image,
// whose failed asks do not count, and the first ask that succeeds ends the wait; a failed ask is followed by the next after
// 1 s, where the default is 30 s; one ask of a server in the same container may take 5 s; and 3 failures count after the
// start period, the default of Compose.
const HEALTH = ['start_period: "300s"', 'interval: "1s"', 'timeout: "5s"', 'retries: 3'];

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
 * over the socket, on which the temporary server of the initialization of the image listens too; `variables` are the
 * variables of the tests for the host and the port at which bay serves the service.
 */
interface Server {
  port: number;
  environment: Record<string, string>;
  health: readonly string[];
  variables: (address: string) => Record<string, string>;
}

// The accounts are those of the tests (plan C-6): the PostgreSQL user fsm is the superuser of the image, which owns the
// databases that createEmptyDatabase creates, and the MySQL accounts root and fsm connect from every host.
const SERVERS: Record<Kind, Server> = {
  postgres: {
    port: 5432,
    environment: { POSTGRES_USER: 'fsm', POSTGRES_PASSWORD: 'fsm', POSTGRES_DB: 'fsm_test' },
    health: ['pg_isready', '--host=127.0.0.1', '--port=5432', '--username=fsm', '--dbname=fsm_test'],
    variables: address => {
      const dsn = `postgres://fsm:fsm@${address}/fsm_test?sslmode=disable`;
      return { FSM_TEST_PG_DSN: dsn, FSM_TEST_PG_ADMIN_DSN: dsn };
    },
  },
  mysql: {
    port: 3306,
    environment: { MYSQL_ROOT_PASSWORD: 'root', MYSQL_USER: 'fsm', MYSQL_PASSWORD: 'fsm', MYSQL_DATABASE: 'fsm_test' },
    health: ['mysqladmin', 'ping', '--protocol=tcp', '--host=127.0.0.1', '--port=3306'],
    variables: address => ({
      FSM_TEST_MYSQL_DSN: `mysql://fsm:fsm@${address}/fsm_test`,
      FSM_TEST_MYSQL_ADMIN_DSN: `mysql://root:root@${address}/mysql`,
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
 * The Compose file of a run: a service for each server, with the image of its pin, the port of its server in `expose`, the
 * environment of its accounts and its healthcheck. Each text is written as a JSON string, which YAML reads as the same
 * string. The file names no project, no host port, no domain, no volume and no path.
 */
function composeFile(): string {
  const lines = ['services:'];
  for (const kind of KINDS) {
    const server = SERVERS[kind];
    lines.push(`  ${kind}:`, `    image: ${JSON.stringify(image(kind))}`, `    expose: [${JSON.stringify(String(server.port))}]`, '    environment:');
    for (const [name, value] of Object.entries(server.environment)) lines.push(`      ${name}: ${JSON.stringify(value)}`);
    lines.push('    healthcheck:', `      test: [${['CMD', ...server.health].map(word => JSON.stringify(word)).join(', ')}]`, ...HEALTH.map(declared => `      ${declared}`));
  }
  return `${lines.join('\n')}\n`;
}

/** Whether a directory of PATH holds the executable file `name`. */
function onPath(name: string): boolean {
  return (process.env.PATH ?? '').split(path.delimiter).filter(directory => directory !== '').some(directory => {
    try {
      accessSync(path.join(directory, name), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/** The Compose project of one run or one pull: its name and its directory, which holds its compose.yaml. */
interface Project {
  name: string;
  directory: string;
}

/**
 * Fails unless PATH holds bay, shows the version of that bay, and makes the project of this process: a directory of its own
 * in the temporary directory of the system with the Compose file of a run.
 */
function project(): Project {
  // The file is built first, so a pin that is wrong fails before anything is made.
  const composed = composeFile();
  if (!onPath('bay')) throw new Failure('persist-servers: bay is not found on PATH: install bay and apply its machine setup with bay install');
  const version = spawnSync('bay', ['version', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (version.error) throw new Failure(`persist-servers: bay: ${version.error.message}`);
  if (version.status !== 0) throw new Failure(`persist-servers: bay version --json ended with ${String(version.status ?? version.signal)}:\n${version.stderr}${version.stdout}`.trimEnd());
  show(`persist-servers: bay version: ${version.stdout.trim()}`);
  const name = `fsm-persist-${String(process.pid)}-${randomBytes(4).toString('hex')}`;
  const directory = path.join(tmpdir(), name);
  mkdirSync(directory, { mode: 0o700 });
  writeFileSync(path.join(directory, 'compose.yaml'), composed);
  return { name, directory };
}

/** How a command of bay ended: its exit code, or the signal that ended it, and what it wrote to standard output when that was kept. */
interface Ran {
  end: number | NodeJS.Signals | null;
  stdout: string;
}

/**
 * Runs the command `args` of bay on the project `of` and resolves with how it ended. Each line that bay writes to standard
 * error is shown as `persist-servers: bay <verb>: <line>`. Its standard output is shown the same way, or kept as the text
 * of the result when `kept`, for a command that prints JSON. bay runs in a process group of its own, so a signal of the
 * terminal reaches the run alone; `started` receives the process, so the run can forward a signal to it.
 */
function bay(of: Project, args: readonly string[], kept = false, started: (child: ChildProcess) => void = () => undefined): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn('bay', ['-f', of.directory, '-p', of.name, ...args], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    started(child);
    const label = `persist-servers: bay ${args[0] ?? ''}`;
    let stdout = '';
    if (kept) child.stdout.setEncoding('utf8').on('data', (text: string) => { stdout += text; });
    for (const stream of kept ? [child.stderr] : [child.stdout, child.stderr]) createInterface({ input: stream }).on('line', line => { show(`${label}: ${line}`); });
    child.on('error', error => { reject(new Failure(`persist-servers: bay: ${error.message}`)); });
    // close comes after the end of both streams, so every line of bay was shown and all of its output was kept.
    child.on('close', (code, signal) => { resolve({ end: code ?? signal, stdout }); });
  });
}

/**
 * Fails unless the local store of bay holds the image of each service of `of`: `bay images --json` prints an array with
 * the service, the image and `present` of each, fetches nothing and ends with 1 when an image is missing.
 */
async function installed(of: Project): Promise<void> {
  const ran = await bay(of, ['images', '--json'], true);
  const entries: unknown = ran.stdout.trim() === '' ? undefined : parse(ran.stdout, 'the output of bay images --json');
  if (!Array.isArray(entries)) throw new Failure(`persist-servers: bay images --json ended with ${String(ran.end)} and printed no array:\n${ran.stdout}`.trimEnd());
  const missing = entries.filter(entry => field(entry, 'present') !== true);
  if (missing.length > 0) throw new Failure(missing.map(entry => `persist-servers: the image ${String(field(entry, 'image'))} of ${String(field(entry, 'service'))} is not installed: run make persist-images`).join('\n'));
  if (ran.end !== 0) throw new Failure(`persist-servers: bay images --json ended with ${String(ran.end)}:\n${ran.stdout}`.trimEnd());
}

/**
 * The host and the port of the service of each kind, `<host>:<port>`, as the JSON `text` of `bay up --json` holds them: the
 * fields host and port of the entry of that name in its array services. A service that the JSON does not hold, a host that
 * is no text or is empty and a port that is no number fail the run.
 */
function addresses(text: string): Record<Kind, string> {
  const services = field(parse(text, 'the output of bay up --json'), 'services');
  const address = (kind: Kind): string => {
    const service: unknown = Array.isArray(services) ? services.find(each => field(each, 'name') === kind) : undefined;
    const [host, port] = [field(service, 'host'), field(service, 'port')];
    if (typeof host !== 'string' || host === '' || typeof port !== 'number') throw new Failure(`persist-servers: bay up --json names no host and port of the service ${kind}:\n${text}`.trimEnd());
    return `${host}:${String(port)}`;
  };
  return { postgres: address('postgres'), mysql: address('mysql') };
}

const SIGNALS = { SIGINT: 130, SIGTERM: 143 } as const;
type Signal = keyof typeof SIGNALS;

/** Runs `command` with the servers and returns the exit code of the run. */
async function run(command: readonly string[]): Promise<number> {
  const [file, ...args] = command;
  if (file === undefined) throw new Failure(USAGE, 2);
  const of = project();
  // state is what the listeners of the signals share with the run: the signal that it received, and the process that the
  // signal is forwarded to, bay up while the servers start and then the command.
  const state: { received?: Signal; child?: ChildProcess } = {};
  const receive = (signal: Signal) => (): void => {
    state.received = signal;
    state.child?.kill(signal);
  };
  const listeners = { SIGINT: receive('SIGINT'), SIGTERM: receive('SIGTERM') };
  process.on('SIGINT', listeners.SIGINT);
  process.on('SIGTERM', listeners.SIGTERM);
  let code = 1;
  // started tells that bay up ran, so bay may hold the project.
  let started = false;
  let kept = false;
  try {
    await installed(of);
    if (state.received === undefined) {
      started = true;
      const up = await bay(of, ['up', '-no-pull', '--json'], true, child => { state.child = child; });
      delete state.child;
      if (state.received === undefined) {
        if (up.end !== 0) throw new Failure(`persist-servers: bay up ended with ${String(up.end)} before the servers of the project ${of.name} were healthy`);
        const hosts = addresses(up.stdout);
        const variables: Record<string, string> = {};
        for (const kind of KINDS) Object.assign(variables, SERVERS[kind].variables(hosts[kind]));
        code = await new Promise<number>((resolve, reject) => {
          const spawned = spawn(file, args, { env: { ...process.env, ...variables }, stdio: 'inherit' });
          state.child = spawned;
          spawned.on('error', error => { reject(new Failure(`persist-servers: ${file}: ${error.message}`)); });
          spawned.on('exit', (ended, signal) => { resolve(ended ?? (signal === 'SIGINT' || signal === 'SIGTERM' ? SIGNALS[signal] : 1)); });
        });
      }
    }
    // A signal that came before the command ran ends the run with its code.
    if (state.received !== undefined && state.child === undefined) code = SIGNALS[state.received];
  } finally {
    delete state.child;
    if (started) {
      // The project is removed also after a failed bay up: bay down ends with 0 for a project of which bay made nothing. A
      // bay that did not start is a failed removal too.
      const down = await bay(of, ['down']).then(ran => ran.end, (error: unknown) => (error instanceof Error ? error.message : String(error)));
      if (down === 0) show(`persist-servers: removed the project ${of.name}`);
      else {
        kept = true;
        show(`persist-servers: bay down ended with ${String(down)}; the containers of the project ${of.name} may still run: run bay -f ${of.directory} -p ${of.name} down`);
        if (code === 0) code = 1;
      }
    }
    process.off('SIGINT', listeners.SIGINT);
    process.off('SIGTERM', listeners.SIGTERM);
    if (!kept) rmSync(of.directory, { recursive: true, force: true });
  }
  return code;
}

/** Pulls each pinned image with bay pull, on the Compose file of a run in a directory of its own; it is the only command that downloads. */
async function pull(): Promise<void> {
  const of = project();
  try {
    const ran = await bay(of, ['pull']);
    if (ran.end !== 0) throw new Failure(`persist-servers: bay pull ended with ${String(ran.end)}`);
  } finally {
    rmSync(of.directory, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [verb, separator, ...command] = process.argv.slice(2);
  try {
    if (verb === 'run' && separator === '--' && command.length > 0) process.exitCode = await run(command);
    else if (verb === 'pull' && separator === undefined) await pull();
    else throw new Failure(USAGE, 2);
  } catch (error) {
    if (!(error instanceof Failure)) throw error;
    show(error.message);
    process.exitCode = error.code;
  }
}
