#!/usr/bin/env node
// persist-servers writes the directory of a run of the PostgreSQL and the MySQL server of the tests, which sh and bay
// execute alone, from the images that config/containers.json pins by their digests (docs/plans/fsm-v1/plan.md, C-6;
// docs/plans/fsm-v1/checklist.md, S-472-1, S-475, S-475-7).
//
//   node scripts/persist-servers.mts write -- <command> [argument...]   writes the directory and prints its path
//   node scripts/persist-servers.mts run -- <command> [argument...]     writes it, runs sh run.sh and removes it
//   node scripts/persist-servers.mts pull                               writes it, runs sh run.sh pull and removes it
//
// bay pulls, starts and removes the servers: it runs a Compose project on Apple container on Darwin and on Docker on Linux,
// and no file of a run calls a container program itself. The machine that runs the servers and the command needs sh, bay
// and the container engine of bay, and nothing of its host beside them: this file only writes, and the run.sh that it
// writes, a POSIX file that starts no program but bay, executes. For another machine the directory alone is moved there.
//
// The directory is var/persist-servers/<project> of the checkout, which Git ignores; the project is
// fsm-persist-<pid>-<random>, with the process id of this process and 4 random bytes, so two runs share no directory, no
// project and no container. It holds:
//
//   compose.yaml   the services postgres, mysql and runner; no service publishes a port
//   run.sh         the steps of the run, each a command of bay -f <directory> -p <project>
//   runner.sh      the steps that run inside runner: the installation order of the repository, then the command
//   tree.bundle    the Git bundle of the branch of the checkout, the committed tree that the command runs on
//
// The command runs in the service runner, a Debian image with a command that does not end, which mounts the directory of
// the run read-only and nothing of the checkout: runner.sh clones the bundle into the container, so the tools and the
// build outputs of the runner never meet those of the host. The command gets the four variables of the servers,
// FSM_TEST_PG_DSN, FSM_TEST_PG_ADMIN_DSN, FSM_TEST_MYSQL_DSN and FSM_TEST_MYSQL_ADMIN_DSN, with the host and the port of
// each server as bay plan --json gives them when the directory is written. This file builds no name of a service itself,
// because the form of the name belongs to bay.
//
// No file of a run has a sleep, a polling or a time limit of its own: each server declares a healthcheck, the program of
// the server over TCP in its container, bay runs it and returns from up after each server is healthy, and that return is
// the ready event. The values of a healthcheck are declarations that bay evaluates (plan C-6 states the reason of each).
//
// run.sh removes the project with bay down once bay up was started, by a trap also after a failed step and on SIGINT,
// SIGTERM and SIGHUP, which first end the command of bay that runs. A bay down that fails fails the run and writes the file
// down-failed into the directory; run then keeps the directory. The exit code of run is that of run.sh: that of the
// command, 1 for a step that failed before it, and 130 or 143 for the two signals.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BayError, bayOutput, bayVersion, requireContract } from './bay.mts';

const ROOT = path.resolve(import.meta.dirname, '..');
const PINS = path.join(ROOT, 'config/containers.json');
const TOOLS = path.join(ROOT, 'mise.toml');
const RUNS = path.join(ROOT, 'var/persist-servers');
const USAGE = 'usage: scripts/persist-servers.mts run -- <command> [argument...] | write -- <command> [argument...] | pull';
// The path in runner of the directory of the run, and the file that run.sh writes into the directory after a failed bay down.
const MOUNT = '/persist-run';
const DOWN_FAILED = 'down-failed';
// The declarations of a healthcheck, which bay evaluates: the start period is the time of the initialization of an image,
// whose failed asks do not count, and the first ask that succeeds ends the wait, so the bound of 300 s, about four times
// the 70 s that MySQL took on a Linux arm64 machine, costs a ready server nothing; a failed ask is followed by the next
// after 1 s, where the default is 30 s; one ask of a server in the same container may take 5 s; and 3 failures count after
// the start period, the default of Compose.
const HEALTH = ['start_period: "300s"', 'interval: "1s"', 'timeout: "5s"', 'retries: 3'];

/** A failure that ends the command with `code` and the message on standard error. */
class Failure extends Error {
  code: number;

  constructor(message: string, code = 1) {
    super(message);
    this.code = code;
  }
}

type Kind = 'postgres' | 'mysql';
// A kind is the name of the service of its server in the Compose file of a run.
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

/** The pin of the image `name` in config/containers.json. */
function pinned(name: Kind | 'runner'): unknown {
  return field(field(parse(readFileSync(PINS, 'utf8'), PINS), 'images'), name);
}

/** The reference of the image `name`, which config/containers.json pins by its digest. */
function image(name: Kind | 'runner'): string {
  const reference = field(pinned(name), 'reference');
  if (typeof reference !== 'string' || !/@sha256:[0-9a-f]{64}$/.test(reference)) throw new Failure(`persist-servers: ${PINS} pins no image of ${name} by its digest`);
  return reference;
}

/** The system packages that the runner installs, which the pin of its image names. */
function packages(): string[] {
  const names = field(pinned('runner'), 'packages');
  if (!Array.isArray(names) || names.length === 0) throw new Failure(`persist-servers: ${PINS} names no packages of the runner`);
  return names.map(name => {
    if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9.+-]*$/.test(name)) throw new Failure(`persist-servers: ${PINS} names the package ${JSON.stringify(name)} of the runner, which is no name of a package`);
    return name;
  });
}

/** The version of Node.js that mise.toml pins, which the runner installs before the tools of the checkout exist. */
function nodeVersion(): string {
  const version = /^node = "(\d+\.\d+\.\d+)"$/m.exec(readFileSync(TOOLS, 'utf8'))?.[1];
  if (version === undefined) throw new Failure(`persist-servers: ${TOOLS} names no version of node`);
  return version;
}

/** The word `text` as one word of a line of sh. */
function quoted(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

/**
 * The Compose file of a run: a service for each server, with the image of its pin, the port of its server in `expose`, the
 * environment of its accounts and its healthcheck, and the service runner. Each text is written as a JSON string, which
 * YAML reads as the same string. The file names no project and no host port. Its one mount is the directory of the run
 * itself, read-only, by the one relative path that a run writes: with it the directory works wherever it lies.
 */
function composeFile(): string {
  const lines = ['services:'];
  for (const kind of KINDS) {
    const server = SERVERS[kind];
    lines.push(`  ${kind}:`, `    image: ${JSON.stringify(image(kind))}`, `    expose: [${JSON.stringify(String(server.port))}]`, '    environment:');
    for (const [name, value] of Object.entries(server.environment)) lines.push(`      ${name}: ${JSON.stringify(value)}`);
    lines.push('    healthcheck:', `      test: [${['CMD', ...server.health].map(word => JSON.stringify(word)).join(', ')}]`, ...HEALTH.map(declared => `      ${declared}`));
  }
  // The command of runner does not end, so the container stays for the commands of bay exec. Its targets verify no
  // certificate, so it runs without the trust of bay.
  lines.push('  runner:', `    image: ${JSON.stringify(image('runner'))}`, '    command: ["sleep", "infinity"]', `    volumes: ["./:${MOUNT}:ro"]`, '    x-bay:', '      trust: false');
  return `${lines.join('\n')}\n`;
}

/**
 * runner.sh, which runs inside runner with the command of the run as its arguments: the installation order of the
 * repository on the image of the pin, and then the command, in the clone of the bundle of `branch`. A step that fails ends
 * the file with its exit code.
 */
function runnerFile(branch: string): string {
  const node = nodeVersion();
  return `${[
    '#!/bin/sh',
    '# Runs in the service runner of a run of scripts/persist-servers.mts, with the command of the run as its arguments',
    '# (docs/plans/fsm-v1/plan.md, C-6). It installs what the targets of the repository need on the image of the runner,',
    '# clones the bundle of the branch into the container and runs the command there. The container is new in each run, so',
    '# each run installs again (S-475-8). Nothing is written into the directory of the run, which is mounted read-only.',
    'set -eu',
    'export DEBIAN_FRONTEND=noninteractive',
    'work=/persist-work',
    'mkdir -p "$work/tmp"',
    'export TMPDIR="$work/tmp" CARGO_HOME="$work/cargo" RUSTUP_HOME="$work/rustup"',
    "echo 'persist-runner: the system packages' >&2",
    'apt-get update -q',
    `apt-get install -y -q ${packages().join(' ')}`,
    '# make bootstrap starts the npm of the machine, so Node.js at the version of mise.toml comes before it.',
    'case "$(uname -m)" in',
    'aarch64 | arm64) arch=arm64 ;;',
    'x86_64 | amd64) arch=x64 ;;',
    '*) echo "persist-runner: no archive of Node.js is named for $(uname -m)" >&2; exit 1 ;;',
    'esac',
    `echo 'persist-runner: Node.js ${node}' >&2`,
    `curl -fsSL "https://nodejs.org/dist/v${node}/node-v${node}-linux-$arch.tar.xz" | tar -xJ -C /usr/local --strip-components=1`,
    '# make install installs the toolchain of rust-toolchain.toml with rustup, which no package of the image provides.',
    "echo 'persist-runner: rustup' >&2",
    'curl -fsSL https://sh.rustup.rs | sh -s -- -y --default-toolchain none --profile minimal',
    'PATH="$CARGO_HOME/bin:$PATH"',
    'export PATH',
    `echo 'persist-runner: the tree of the branch ${branch}' >&2`,
    `git clone -q -b ${branch} ${MOUNT}/tree.bundle "$work/tree"`,
    'cd "$work/tree"',
    "echo 'persist-runner: make bootstrap and make install' >&2",
    'make bootstrap',
    'make install',
    "echo 'persist-runner: the command' >&2",
    'exec "$@"',
  ].join('\n')}\n`;
}

/**
 * run.sh of the project `name`: the steps of a run, each a command of bay, whose exit code decides the run. The command of
 * the run, `command`, runs in runner with `variables`. The file starts no program but bay: what else it does is of sh
 * itself. A step runs as a job that the file waits for, so a signal reaches the trap at once, which ends the step.
 */
function runFile(name: string, variables: Record<string, string>, command: readonly string[]): string {
  const exec = ['exec', ...Object.entries(variables).flatMap(([key, value]) => ['-e', quoted(`${key}=${value}`)]), 'runner', 'sh', `${MOUNT}/runner.sh`, ...command.map(quoted)];
  return `${[
    '#!/bin/sh',
    '# Executes a run that scripts/persist-servers.mts wrote into this directory, with sh and bay alone',
    '# (docs/plans/fsm-v1/plan.md, C-6):',
    '#',
    '#   sh run.sh        starts the servers and the runner, runs the command in the runner and removes the project',
    '#   sh run.sh pull   pulls the images of the project, the only step that downloads an image',
    '#',
    '# Each step is one command of bay, and its exit code decides the run. The exit code is that of the command, 1 for a',
    '# step that failed before it, and 130, 143 and 129 after SIGINT, SIGTERM and SIGHUP.',
    'set -u',
    'case "$0" in',
    '*/*) directory=${0%/*} ;;',
    '*) directory=. ;;',
    'esac',
    'cd "$directory" || exit 1',
    'directory=$PWD',
    `project=${quoted(name)}`,
    '# The words that start bay on this machine: those of the variable BAY, which the one who starts the run sets.',
    'bay=${BAY:-bay}',
    '# child is the command of bay that runs, started is set once bay up was started, and code is the exit code of the run.',
    'child=',
    'started=',
    'code=1',
    'step() {',
    '\t$bay "$@" &',
    '\tchild=$!',
    '\twait "$child"',
    '\tended=$?',
    '\tchild=',
    '\treturn "$ended"',
    '}',
    '# finish ends the command of bay that runs and removes the project that bay up may have started. bay down ends with 0',
    '# also for a project that holds no container. After a failed bay down the directory is marked, because bay down needs',
    '# its Compose file.',
    'finish() {',
    "\ttrap '' INT TERM HUP",
    '\ttrap - EXIT',
    '\tif [ -n "$child" ]; then',
    '\t\tkill -TERM "$child" 2>/dev/null',
    '\t\twait "$child"',
    '\tfi',
    '\tif [ -n "$started" ]; then',
    '\t\tif $bay -f "$directory" -p "$project" down; then',
    '\t\t\techo "persist-servers: removed the project $project" >&2',
    '\t\telse',
    `\t\t\t: > "$directory/${DOWN_FAILED}"`,
    '\t\t\techo "persist-servers: bay down failed; the containers of the project $project may still run: run bay -f $directory -p $project down" >&2',
    '\t\t\t[ "$code" -ne 0 ] || code=1',
    '\t\tfi',
    '\tfi',
    '\texit "$code"',
    '}',
    'trap finish EXIT',
    "trap 'code=130; exit' INT",
    "trap 'code=143; exit' TERM",
    "trap 'code=129; exit' HUP",
    'case "${1:-run}" in',
    'run) ;;',
    'pull)',
    '\tstep version --json || exit',
    '\tstep -f "$directory" -p "$project" pull',
    '\tcode=$?',
    '\texit',
    '\t;;',
    '*)',
    "\techo 'usage: sh run.sh [run|pull]' >&2",
    '\tcode=2',
    '\texit',
    '\t;;',
    'esac',
    '# The release and the contract of the bay that runs, for the record of the run. Nothing is compared: the bay of the',
    '# machine is used as it is.',
    'step version --json || exit',
    '# bay images fetches nothing and fails when the store lacks an image.',
    'step -f "$directory" -p "$project" images || {',
    '\techo "persist-servers: an image of the project $project is not installed: run make persist-images, or sh $directory/run.sh pull" >&2',
    '\texit',
    '}',
    '# bay up returns after each server is healthy; it pulls nothing and changes no machine setup.',
    'started=1',
    'step -f "$directory" -p "$project" up -no-pull || {',
    '\techo "persist-servers: bay up failed before the servers of the project $project were healthy" >&2',
    '\texit',
    '}',
    `step -f "$directory" -p "$project" ${exec.join(' ')}`,
    'code=$?',
    'exit',
  ].join('\n')}\n`;
}

/** Runs `program` with `args` in the checkout and returns its standard output; fails when it did not start or ended with another code than 0. */
function output(program: string, args: readonly string[]): string {
  const ran = spawnSync(program, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (ran.error) throw new Failure(`persist-servers: ${program}: ${ran.error.message}`);
  if (ran.status !== 0) throw new Failure(`persist-servers: ${program} ${args.join(' ')} ended with ${String(ran.status ?? ran.signal)}:\n${ran.stderr}${ran.stdout}`.trimEnd());
  return ran.stdout;
}

/**
 * The host and the port of the service of each kind, `<host>:<port>`, as the JSON `text` of `bay plan --json` holds them:
 * the fields host and port of the entry of that name in its array services. A service that the JSON does not hold, a host
 * that is no text or is empty and a port that is no number fail the writing.
 */
function addresses(text: string): Record<Kind, string> {
  const services = field(parse(text, 'the output of bay plan --json'), 'services');
  const address = (kind: Kind): string => {
    const service: unknown = Array.isArray(services) ? services.find(each => field(each, 'name') === kind) : undefined;
    const [host, port] = [field(service, 'host'), field(service, 'port')];
    if (typeof host !== 'string' || host === '' || typeof port !== 'number') throw new Failure(`persist-servers: bay plan --json names no host and port of the service ${kind}:\n${text}`.trimEnd());
    return `${host}:${String(port)}`;
  };
  return { postgres: address('postgres'), mysql: address('mysql') };
}

/** Writes the directory of a run of `command` and returns its path. Fails at once unless PATH holds bay; a failure after the directory was made removes it. */
function write(command: readonly string[]): string {
  // The files are built first, so a pin that is wrong fails before anything is made.
  const composed = composeFile();
  packages();
  nodeVersion();
  // The bay of the machine is used as it is: its version is shown for the record of the run, and only the schema of its
  // contract is required.
  const version = bayVersion();
  process.stderr.write(`persist-servers: bay version: ${version.text}\n`);
  requireContract(version);
  const branch = output('git', ['symbolic-ref', '--short', 'HEAD']).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)) throw new Failure(`persist-servers: the checkout is on no branch that a line of sh can name: ${JSON.stringify(branch)}`);
  const name = `fsm-persist-${String(process.pid)}-${randomBytes(4).toString('hex')}`;
  const directory = path.join(RUNS, name);
  mkdirSync(directory, { recursive: true });
  try {
    writeFileSync(path.join(directory, 'compose.yaml'), composed);
    const hosts = addresses(bayOutput(['-f', directory, '-p', name, 'plan', '--json']));
    const variables: Record<string, string> = {};
    for (const kind of KINDS) Object.assign(variables, SERVERS[kind].variables(hosts[kind]));
    output('git', ['bundle', 'create', path.join(directory, 'tree.bundle'), branch]);
    writeFileSync(path.join(directory, 'runner.sh'), runnerFile(branch));
    writeFileSync(path.join(directory, 'run.sh'), runFile(name, variables, command));
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return directory;
}

const SIGNALS = { SIGINT: 130, SIGTERM: 143 } as const;

/**
 * Writes the directory of a run of `command`, runs its run.sh with `args` and returns its exit code. SIGINT and SIGTERM
 * are forwarded to run.sh, whose trap removes the project. The directory is removed unless run.sh marked it after a failed
 * bay down.
 */
async function execute(command: readonly string[], args: readonly string[]): Promise<number> {
  const directory = write(command);
  try {
    return await new Promise<number>((resolve, reject) => {
      // sh is started by its path, the one that POSIX names, so the run needs no PATH for it.
      const child = spawn('/bin/sh', [path.join(directory, 'run.sh'), ...args], { stdio: 'inherit' });
      const listeners = { SIGINT: (): void => { child.kill('SIGINT'); }, SIGTERM: (): void => { child.kill('SIGTERM'); } };
      process.on('SIGINT', listeners.SIGINT);
      process.on('SIGTERM', listeners.SIGTERM);
      const ended = (): void => {
        process.off('SIGINT', listeners.SIGINT);
        process.off('SIGTERM', listeners.SIGTERM);
      };
      child.on('error', error => {
        ended();
        reject(new Failure(`persist-servers: /bin/sh: ${error.message}`));
      });
      child.on('close', (code, signal) => {
        ended();
        resolve(code ?? (signal === 'SIGINT' || signal === 'SIGTERM' ? SIGNALS[signal] : 1));
      });
    });
  } finally {
    if (!existsSync(path.join(directory, DOWN_FAILED))) rmSync(directory, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [verb, separator, ...command] = process.argv.slice(2);
  try {
    if (verb === 'run' && separator === '--' && command.length > 0) process.exitCode = await execute(command, []);
    else if (verb === 'write' && separator === '--' && command.length > 0) process.stdout.write(`${write(command)}\n`);
    // The step pull runs no command in the runner, so the directory of a pull is written with a command that does nothing.
    else if (verb === 'pull' && separator === undefined) process.exitCode = await execute(['true'], ['pull']);
    else throw new Failure(USAGE, 2);
  } catch (error) {
    if (!(error instanceof Failure) && !(error instanceof BayError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.code;
  }
}
