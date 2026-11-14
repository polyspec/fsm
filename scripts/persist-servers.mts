#!/usr/bin/env node
// persist-servers writes the directory of a run of the PostgreSQL and the MySQL server of the tests, which its run.sh
// executes, from the images that config/containers.json pins by their digests (docs/plans/fsm-v1/plan.md, C-6;
// docs/plans/fsm-v1/checklist.md, S-472-1, S-475, S-475-7, S-475-11).
//
//   node scripts/persist-servers.mts write [--runner] -- <command> [argument...]   writes the directory, prints its path
//   node scripts/persist-servers.mts run [--runner] -- <command> [argument...]     writes it, runs sh run.sh, removes it
//   node scripts/persist-servers.mts pull                                          writes it, runs sh run.sh pull, removes it
//
// bay pulls, starts and removes the servers: it runs a Compose project on Apple container on Darwin and on Docker on Linux,
// and no file of a run calls a container program itself. A run has two forms, which share the version of bay and the
// images as their first steps. The form is chosen when the directory is written.
//
//   the host form, the default   the servers alone are the project: bay up, the command as a process of the host, which
//                                gets the DSNs in its environment, and bay down; for a machine of development and for CI,
//                                whose host holds the tools of the repository
//   the runner form, --runner    two jobs of bay, which run.sh queues and waits for: build installs with no server, and
//                                check runs the command with the servers; run.sh starts no program but bay and date: for
//                                a machine whose host holds sh and bay alone; the directory alone is moved there, and
//                                sh run.sh add <part> queues the job of a part there, which runs on and keeps its result
//                                without the one who queued it
//
// The directory is var/persist-servers/<project> of the checkout, which Git ignores; the project is
// fsm-persist-<pid>-<random>, with the process id of this process and 4 random bytes, so two runs share no directory, no
// project and no container. It holds:
//
//   compose.yaml   the services postgres and mysql, and in the runner form the job check; no service publishes a port
//   compose.build.yaml   the runner form: the job build alone
//   run.sh         the steps of the run
//   report.txt     written by run.sh: the time of each step, and the highest memory use of each service of the host form
//                  or the id of each job of the runner form
//   runner.sh      the runner form: the command of the two jobs, the installation order of the repository below work/
//                  in build and the command in check
//   tree.bundle    the runner form: the Git bundle of the branch of the checkout, the committed tree of the command
//
// Each job runs a Debian image that mounts the directory of the run, writable, and nothing of the checkout: the job build
// clones the bundle into work/ of that directory, so the tools and the build outputs of the jobs never meet those of the
// host, and the job check runs on them. The command
// gets the four variables of the servers, FSM_TEST_PG_DSN, FSM_TEST_PG_ADMIN_DSN, FSM_TEST_MYSQL_DSN and
// FSM_TEST_MYSQL_ADMIN_DSN, with the host and the port of each server as bay plan --json gives them when the directory is
// written. This file builds no name of a service itself, because the form of the name belongs to bay.
//
// No file of a run has a sleep, a polling or a time limit of its own: each server declares a healthcheck, the program of
// the server over TCP in its container, bay runs it and returns from up, or starts the container of a job, after each
// server is healthy, and that is the ready event. The values of a healthcheck, the time limit of the job and the bound of
// the waits for it are declarations that bay evaluates (plan C-6 states the reason of each).
//
// run.sh of the host form removes the project with bay down once bay up was started, by a trap also after a failed step
// and on SIGINT, SIGTERM and SIGHUP, which first end the step that runs. A bay down that fails fails the run and writes the
// file down-failed into the directory; run then keeps the directory. In the runner form bay takes the project down after
// each job, and the trap cancels a job that has not ended. The exit code of run is that of run.sh: that of the command,
// or 0 when both jobs succeeded and 1 for a job that did not, 1 for a step that failed before it, and 130 or 143 for the two
// signals.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { BayError, bayOutput, bayVersion, requireContract } from './bay.mts';

const ROOT = path.resolve(import.meta.dirname, '..');
const PINS = path.join(ROOT, 'config/containers.json');
const TOOLS = path.join(ROOT, 'mise.toml');
const RUNS = path.join(ROOT, 'var/persist-servers');
const USAGE = 'usage: scripts/persist-servers.mts run [--runner] -- <command> [argument...] | write [--runner] -- <command> [argument...] | pull';
// The longest time of one job of the runner form, which bay requires of a job: about six times the 20 min 27 s that the
// installation and two targets took on a Linux arm64 machine, so that a job that hangs gives the queue of its machine back.
const JOB_TIMEOUT = '2h';
// The bound of the commands of run.sh that wait for a job: the longest time of a job of bay. The job ends by its own
// limit; the wait also holds the time of the jobs that were queued before it on the machine.
const WAIT = '24h';
// The path in a job of the directory of the run, and the file that run.sh writes into the directory after a failed bay down.
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

/** The lines of the Compose file for the memory limit of the image `name`: its pin may hold `memory`, a size that bay passes to the container engine as mem_limit. */
function memoryLimit(name: Kind | 'runner'): string[] {
  const memory = field(pinned(name), 'memory');
  if (memory === undefined) return [];
  if (typeof memory !== 'string' || !/^[1-9][0-9]*[kmg]?$/.test(memory)) throw new Failure(`persist-servers: ${PINS} names the memory ${JSON.stringify(memory)} of ${name}, which is no size such as 768m`);
  return [`    mem_limit: ${JSON.stringify(memory)}`];
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

/** The text `text` as a string of a Compose file: a JSON string, which YAML reads as the same string, whose `$` is `$$`, because bay replaces a `$` of a Compose file by a variable of its own environment. */
function composed(text: string): string {
  return JSON.stringify(text.replaceAll('$', () => '$$'));
}

/** A part of the runner form, which is a job of bay and a service of its Compose file: build installs, check runs the command. */
type Part = 'build' | 'check';

/** The Compose file of each part: build is alone, so it runs with no server, and check is with the servers. */
const PART_FILES: Record<Part, string> = { build: 'compose.build.yaml', check: 'compose.yaml' };

/** The lines of the job `part`, which runs `sh runner.sh` with `words` and has `variables` in its environment. */
function jobLines(part: Part, words: readonly string[], variables: Record<string, string>): string[] {
  const environment = Object.entries(variables).map(([name, value]) => `      ${name}: ${composed(value)}`);
  return [
    `  ${part}:`, `    image: ${JSON.stringify(image('runner'))}`, ...memoryLimit('runner'), `    command: [${['sh', `${MOUNT}/runner.sh`, ...words].map(composed).join(', ')}]`,
    ...(environment.length > 0 ? ['    environment:', ...environment] : []),
    `    volumes: ["./:${MOUNT}"]`, '    x-bay:', '      job: true', `      timeout: ${JSON.stringify(JOB_TIMEOUT)}`,
  ];
}

/**
 * The Compose file of a run: a service for each server, with the image of its pin, its memory limit, the port of its
 * server in `expose`, the environment of its accounts and its healthcheck, and with `check` the job check, which runs the
 * command with the variables of the servers. The file names no project and no host port. The one mount, of the job, is the
 * directory of the run itself, by the one relative path that a run writes: with it the directory works wherever it lies.
 * It is writable, because the job check runs on what the job build installed there.
 */
function composeFile(check?: { command: readonly string[]; variables: Record<string, string> }): string {
  const lines = ['services:'];
  for (const kind of KINDS) {
    const server = SERVERS[kind];
    lines.push(`  ${kind}:`, `    image: ${JSON.stringify(image(kind))}`, ...memoryLimit(kind), `    expose: [${JSON.stringify(String(server.port))}]`, '    environment:');
    for (const [name, value] of Object.entries(server.environment)) lines.push(`      ${name}: ${JSON.stringify(value)}`);
    lines.push('    healthcheck:', `      test: [${['CMD', ...server.health].map(word => JSON.stringify(word)).join(', ')}]`, ...HEALTH.map(declared => `      ${declared}`));
  }
  if (check !== undefined) lines.push(...jobLines('check', ['check', ...check.command], check.variables));
  return `${lines.join('\n')}\n`;
}

/** The Compose file of the job build: the job alone, so the installation runs with no server. */
function buildFile(): string {
  return `${['services:', ...jobLines('build', ['build'], {})].join('\n')}\n`;
}

/**
 * runner.sh, the command of the two jobs: each first installs the system packages of the pin into its new container; the
 * job build then installs the tools of the repository and the clone of the bundle of `branch` below work/ of the directory
 * of the run, and the job check runs the command of the run in that clone with those tools. A step that fails ends the file
 * with its exit code, and the files of work/ are given to the owner of the directory when the file ends.
 */
function runnerFile(branch: string): string {
  const node = nodeVersion();
  return `${[
    '#!/bin/sh',
    '# Runs in the jobs of a run of scripts/persist-servers.mts (docs/plans/fsm-v1/plan.md, C-6):',
    '#',
    '#   sh runner.sh build                 installs what the targets of the repository need below work/ and clones the bundle',
    '#   sh runner.sh check <command> ...   runs the command in that clone',
    '#',
    '# bay runs the job build with no server and starts the servers before the container of the job check, so the',
    '# installation and the servers do not hold their memory at once. A container is new in each job, so what the jobs',
    `# share is work/ of the directory of the run, which bay mounts at ${MOUNT}, and each run installs again (S-475-8).`,
    'set -eu',
    'export DEBIAN_FRONTEND=noninteractive',
    `work=${MOUNT}/work`,
    '# The container writes as its own user, so the files of work/ are given to the owner of the directory of the run when',
    '# the file ends, and the one who removes the directory needs no rights of the container.',
    `owner=$(stat -c %u:%g ${MOUNT})`,
    'release() {',
    '\tchown -R "$owner" "$work" || echo "persist-runner: the files of $work keep the owner of the container" >&2',
    '}',
    'trap release EXIT',
    'mkdir -p "$work/tmp"',
    'export TMPDIR="$work/tmp" CARGO_HOME="$work/cargo" RUSTUP_HOME="$work/rustup"',
    'PATH="$work/node/bin:$CARGO_HOME/bin:$PATH"',
    'export PATH',
    "echo 'persist-runner: the system packages' >&2",
    'apt-get update -q',
    `apt-get install -y -q ${packages().join(' ')}`,
    'case "$1" in',
    'build)',
    '\t# make bootstrap starts the npm of the machine, so Node.js at the version of mise.toml comes before it.',
    '\tcase "$(uname -m)" in',
    '\taarch64 | arm64) arch=arm64 ;;',
    '\tx86_64 | amd64) arch=x64 ;;',
    '\t*) echo "persist-runner: no archive of Node.js is named for $(uname -m)" >&2; exit 1 ;;',
    '\tesac',
    `\techo 'persist-runner: Node.js ${node}' >&2`,
    '\tmkdir -p "$work/node"',
    `\tcurl -fsSL "https://nodejs.org/dist/v${node}/node-v${node}-linux-$arch.tar.xz" | tar -xJ -C "$work/node" --strip-components=1`,
    '\t# make install installs the toolchain of rust-toolchain.toml with rustup, which no package of the image provides.',
    "\techo 'persist-runner: rustup' >&2",
    '\tcurl -fsSL https://sh.rustup.rs | sh -s -- -y --no-modify-path --default-toolchain none --profile minimal',
    `\techo 'persist-runner: the tree of the branch ${branch}' >&2`,
    `\tgit clone -q -b ${branch} ${MOUNT}/tree.bundle "$work/tree"`,
    '\tcd "$work/tree"',
    "\techo 'persist-runner: make bootstrap and make install' >&2",
    '\tmake bootstrap',
    '\tmake install',
    '\t;;',
    'check)',
    '\tshift',
    '\tcd "$work/tree"',
    '\t"$@"',
    '\t;;',
    '*)',
    "\techo 'usage: sh runner.sh build | check <command> ...' >&2",
    '\texit 2',
    '\t;;',
    'esac',
  ].join('\n')}\n`;
}

/**
 * run.sh of the project `name`: the steps of a run, whose exit codes decide it. Without `key` it is the host form: the
 * command `command` is a process that the file starts, with `variables` in its environment, between bay up and bay down.
 * With `key` it is the runner form: the file queues the job build and, after it succeeded, the job check with that key,
 * the commit of the bundle, shows the output of each, waits for it and judges it by its record, and starts no program but
 * bay and date, which gives the time of its report: what else it does is of sh itself. A step runs as a job of sh that the
 * file waits for, so a signal reaches the trap at once, which ends the step. Every line that the file shows, the output of
 * bay included, is on standard error: the standard output holds the id that add prints and nothing else.
 */
function runFile(name: string, variables: Record<string, string>, command: readonly string[], key?: string): string {
  const runner = key !== undefined;
  // The steps after the images. The host form: the servers, the command as a process of this host, whose variables are
  // assignments before its words, which sh puts into the environment of that process alone, and bay down by the trap.
  const hosted = [
    'started=1',
    '# bay up returns after each server is healthy; it pulls nothing and changes no machine setup.',
    'step up -f "$compose" -p "$project" up -no-pull || {',
    '\techo "persist-servers: bay up failed before the servers of the project $project were healthy" >&2',
    '\texit',
    '}',
    '# The command of the run, a process of this host in the directory of the caller, where its own files are: make',
    '# ci-targets needs the Makefile of the checkout, not this directory.',
    'cd "$caller" || exit',
    "mark 'command start'",
    `${[...Object.entries(variables).map(([variable, value]) => `${variable}=${quoted(value)}`), ...command.map(quoted)].join(' ')} &`,
    'child=$!',
    'wait "$child"',
    'code=$?',
    'child=',
    'mark "command exit $code"',
    'exit',
  ];
  // The runner form: the two jobs, which bay runs in a process of its own. The key returns the same job to a caller that was
  // cut off before it read the id. bay runs the job build with no server, starts the servers before the container of the
  // job check and takes the project down after each job; follow runs bay down after the job check too, since an agent that
  // took over the run of a job left its servers running (S-481).
  const jobbed = [
    '# queue queues the job of the part $1, sets job to its id and writes it to job-$1; it fails when bay queues none.',
    'queue() {',
    '\tmark "add $1 start"',
    `\tjob=$($bay -f "$file" -p "$project" job add -key ${quoted(key ?? '')} "$1")`,
    '\tadded=$?',
    '\tmark "add $1 exit $added"',
    '\t[ "$added" -eq 0 ] && [ -n "$job" ] || {',
    '\t\techo "persist-servers: bay job add failed for the job $1 of the project $project" >&2',
    '\t\treturn 1',
    '\t}',
    '\techo "$job" > "$directory/job-$1"',
    '\tmark "job $1 $job"',
    '}',
    'if [ "$verb" = add ]; then',
    '\tpartFile "$part"',
    '\tqueue "$part" || exit',
    '\techo "$job"',
    '\techo "persist-servers: the job $job runs on; sh $directory/run.sh wait $part on this machine follows it to its end" >&2',
    '\tcode=0',
    '\texit',
    'fi',
    '# The job check is queued only after the job build succeeded. A job whose end is not known is cancelled by the trap,',
    '# because the directory that it reads is removed after the run.',
    'for part in build check; do',
    '\tpartFile "$part"',
    '\tqueue "$part" || exit',
    '\tqueued=$file',
    '\tfollow "$part"',
    '\tcode=$?',
    '\t[ "$code" -eq 3 ] || queued=',
    '\t[ "$code" -eq 0 ] || exit',
    'done',
    'exit',
  ];
  // The ending of the trap. The host form reads the memory of each server and removes the project once bay up was started;
  // the runner form cancels a job that has not ended and waits for it, so no container of the run outlives it.
  const ending = runner ? [
    '\tif [ -n "$queued" ]; then',
    '\t\tmark \'cancel start\'',
    '\t\t$bay -f "$queued" -p "$project" job cancel "$job" >&2',
    '\t\tmark "cancel exit $?"',
    `\t\t$bay -f "$queued" -p "$project" job wait -timeout ${WAIT} "$job" >&2`,
    '\tfi',
  ] : [
    '\tif [ -n "$started" ]; then',
    '\t\t# The highest memory use of each service, which the cgroup of its container holds, before the project is removed. A',
    '\t\t# service whose file cannot be read does not fail the run.',
    `\t\tfor service in ${KINDS.join(' ')}; do`,
    '\t\t\tpeak=$($bay -f "$compose" -p "$project" exec "$service" cat /sys/fs/cgroup/memory.peak 2>/dev/null) || peak=\'not read\'',
    '\t\t\tmark "memory.peak $service $peak"',
    '\t\tdone',
    "\t\tmark 'down start'",
    '\t\tif $bay -f "$compose" -p "$project" down >&2; then',
    "\t\t\tmark 'down exit 0'",
    '\t\t\techo "persist-servers: removed the project $project" >&2',
    '\t\telse',
    '\t\t\tmark "down exit $?"',
    `\t\t\t: > "$directory/${DOWN_FAILED}"`,
    '\t\t\techo "persist-servers: bay down failed; the containers of the project $project may still run: run bay -f $compose -p $project down" >&2',
    '\t\t\t[ "$code" -ne 0 ] || code=1',
    '\t\tfi',
    '\tfi',
  ];
  const verbs = runner ? 'run|add build|add check|wait build|wait check|pull' : 'run|pull';
  return `${[
    '#!/bin/sh',
    '# Executes a run that scripts/persist-servers.mts wrote into this directory, with sh and bay alone',
    '# (docs/plans/fsm-v1/plan.md, C-6):',
    '#',
    ...(runner ? [
      '#   sh run.sh              queues the job build, which installs, and after it the job check, which runs the command',
      '#                          with the servers, shows the output of each and waits for it',
      '#   sh run.sh add <part>   queues the job of the part build or check and prints its id alone on standard output: the',
      '#                          job runs on without the one who queued it',
      '#   sh run.sh wait <part>  follows the job that add queued to its end and ends with 0 when it succeeded, 1 when it',
      '#                          did not and 3 when its end is not known; it cancels nothing, and runs again after a',
      '#                          connection that dropped. check is queued after wait build ended with 0',
    ] : ['#   sh run.sh        starts the servers, runs the command on this host and removes the project']),
    '#   sh run.sh pull   pulls the images of the project, the only step that downloads an image',
    '#',
    `# The exit code of each step decides the run. The exit code is ${runner ? '0 when both jobs succeeded, 1 for a job that did not, 3 for a job whose end is not known' : 'that of the command'}, 1 for a step that failed`,
    '# before it, and 130, 143 and 129 after SIGINT, SIGTERM and SIGHUP. The file report.txt of this directory gets the time',
    `# of each step and ${runner ? 'the id of each job' : 'the highest memory use of each service'}, and each of its lines is shown.`,
    'set -u',
    ...(runner ? [] : ['# The directory of the caller, in which the command runs; the steps of bay run in this directory.', 'caller=$PWD']),
    'case "$0" in',
    '*/*) directory=${0%/*} ;;',
    '*) directory=. ;;',
    'esac',
    'cd "$directory" || exit 1',
    'directory=$PWD',
    'compose=$directory/compose.yaml',
    `project=${quoted(name)}`,
    '# The words that start bay on this machine: those of the variable BAY, which the one who starts the run sets.',
    'bay=${BAY:-bay}',
    `# child is the step that runs, ${runner ? 'job is the id of the last job, queued is its Compose file while it has not ended' : 'started is set once bay up was started'}, and code is the exit`,
    '# code of the run.',
    'child=',
    ...(runner ? ['job=', 'queued='] : ['started=']),
    'code=1',
    '# mark writes a line of the report, the time in UTC and an event, and shows it. date is the one program beside bay',
    '# that this file starts for its own steps.',
    'mark() {',
    '\tline="$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"',
    '\techo "persist-servers: $line" >&2',
    '\techo "$line" >> "$directory/report.txt"',
    '}',
    '# step runs the command of bay of its words after the first, which names the step in the report. The output of bay goes',
    '# to standard error, or to the file that into names.',
    'into=',
    'step() {',
    '\tname=$1',
    '\tshift',
    '\tmark "$name start"',
    '\tif [ -n "$into" ]; then',
    '\t\t$bay "$@" > "$into" &',
    '\telse',
    '\t\t$bay "$@" >&2 &',
    '\tfi',
    '\tchild=$!',
    '\twait "$child"',
    '\tended=$?',
    '\tchild=',
    '\tmark "$name exit $ended"',
    '\treturn "$ended"',
    '}',
    `# finish ends the step that runs and ${runner ? 'cancels the job that has not ended and waits for it' : 'removes the project that bay up may have started. bay down ends with 0\n# also for a project that holds no container. After a failed bay down the directory is marked, because bay down needs\n# its Compose file'}.`,
    'finish() {',
    "\ttrap '' INT TERM HUP",
    '\ttrap - EXIT',
    '\tif [ -n "$child" ]; then',
    '\t\tkill -TERM "$child" 2>/dev/null',
    '\t\twait "$child"',
    '\tfi',
    ...ending,
    '\tmark "run exit $code"',
    '\texit "$code"',
    '}',
    'trap finish EXIT',
    "trap 'code=130; exit' INT",
    "trap 'code=143; exit' TERM",
    "trap 'code=129; exit' HUP",
    'verb=${1:-run}',
    ...(runner ? ['part=${2:-}'] : []),
    'case "$verb${2+ $2}${3+ $3}" in',
    `${runner ? "run|'add build'|'add check'|'wait build'|'wait check'" : 'run'}) ;;`,
    'pull)',
    '\tstep version version --json || exit',
    '\tstep pull -f "$compose" -p "$project" pull',
    '\tcode=$?',
    '\texit',
    '\t;;',
    '*)',
    `\techo 'usage: sh run.sh [${verbs}]' >&2`,
    '\tcode=2',
    '\texit',
    '\t;;',
    'esac',
    '# The release and the contract of the bay that runs, for the record of the run. Nothing is compared: the bay of the',
    '# machine is used as it is.',
    'step version version --json || exit',
    ...(runner ? [
      '# partFile sets file to the Compose file of the part $1.',
      'partFile() {',
      '\tfile=$directory/compose.$1.yaml',
      '\t[ "$1" = check ] && file=$compose',
      '}',
      '# follow shows the output of the job of the part $1, waits for it, writes its record to job-$1.json and shows it, and',
      '# judges the job by that record and not by the exit code of bay job wait, which is 1 also when the wait ends before the',
      '# job: it returns 0 when the job ended and succeeded, 1 when it ended and did not, and 3 when it has not ended or bay',
      '# shows no record of it. The fields of the record are lines that start with two spaces, so a quote of them in the',
      '# output of the job, which the field tail holds escaped, is not read as one of them.',
      'follow() {',
      `\tstep "logs $1" -f "$file" -p "$project" job logs -f -timeout ${WAIT} "$job"`,
      `\tstep "wait $1" -f "$file" -p "$project" job wait -timeout ${WAIT} "$job"`,
      '\twaited=$?',
      '\trecord=$directory/job-$1.json',
      '\tinto=$record',
      '\tstep "show $1" -f "$file" -p "$project" job show -json "$job"',
      '\tshown=$?',
      '\tinto=',
      '\tif [ "$shown" -ne 0 ]; then',
      '\t\techo "persist-servers: the job $1 $job of the project $project has no record, bay job show exited with $shown; sh $directory/run.sh wait $1 follows it again" >&2',
      '\t\treturn 3',
      '\tfi',
      '\tfinished=',
      '\tsucceeded=',
      '\twhile IFS= read -r line; do',
      '\t\techo "$line" >&2',
      '\t\tcase "$line" in',
      `\t\t'  "ended": "'*) finished=1 ;;`,
      `\t\t'  "state": "succeeded"'*) succeeded=1 ;;`,
      '\t\tesac',
      '\tdone < "$record"',
      '\tif [ -z "$finished" ]; then',
      '\t\techo "persist-servers: the job $1 $job of the project $project has not ended, bay job wait exited with $waited; sh $directory/run.sh wait $1 follows it again" >&2',
      '\t\treturn 3',
      '\tfi',
      '\t# The servers of the job check belong to the run: bay down removes them once the job ended. bay takes the project',
      '\t# down after a job, but not after its agent took over the run of the job, and bay down ends with 0 for a project that',
      '\t# holds no container (S-481).',
      '\tif [ "$1" = check ]; then',
      '\t\tstep down -f "$compose" -p "$project" down || {',
      '\t\t\techo "persist-servers: bay down failed; the containers of the project $project may still run: run bay -f $compose -p $project down" >&2',
      '\t\t\treturn 1',
      '\t\t}',
      '\tfi',
      '\t[ -n "$succeeded" ] && return 0',
      '\techo "persist-servers: the job $1 $job of the project $project did not succeed, bay job wait exited with $waited" >&2',
      '\treturn 1',
      '}',
      '# wait follows the job that add queued on this machine and cancels nothing: a wait that ends leaves the job running.',
      'if [ "$verb" = wait ]; then',
      '\tpartFile "$part"',
      '\tread -r job 2>/dev/null < "$directory/job-$part" || {',
      '\t\techo "persist-servers: the job $part of the project $project is not queued here: run sh $directory/run.sh add $part" >&2',
      '\t\tcode=2',
      '\t\texit',
      '\t}',
      '\tfollow "$part"',
      '\tcode=$?',
      '\texit',
      'fi',
    ] : []),
    '# bay images fetches nothing and fails when the store lacks an image.',
    'step images -f "$compose" -p "$project" images || {',
    '\techo "persist-servers: an image of the project $project is not installed: run make persist-images, or sh $directory/run.sh pull" >&2',
    '\texit',
    '}',
    ...(runner ? jobbed : hosted),
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

/**
 * Fails unless the JSON `text` of `bay plan --json` of the Compose file of `part` of the project `name` names the service
 * of that part as a job: a bay that does not read x-bay.job would start it as a service.
 */
function requireJob(text: string, part: Part, name: string): void {
  const services = field(parse(text, 'the output of bay plan --json'), 'services');
  const service: unknown = Array.isArray(services) ? services.find(each => field(each, 'name') === part) : undefined;
  if (!isRecord(field(service, 'job'))) throw new Failure(`persist-servers: bay plan --json names the service ${part} of the project ${name} as no job, so this bay does not run jobs:\n${text}`.trimEnd());
}

/**
 * Writes the directory of a run of `command`, of the runner form with `runner` and of the host form without it, and returns
 * its path. Fails at once unless PATH holds bay; a failure after the directory was made removes it.
 */
function write(command: readonly string[], runner: boolean): string {
  // The files are built first, so a pin that is wrong fails before anything is made.
  const servers = composeFile();
  if (runner) {
    composeFile({ command, variables: {} });
    buildFile();
    packages();
    nodeVersion();
  }
  // The bay of the machine is used as it is: its version is shown for the record of the run, and only the schema of its
  // contract is required.
  const version = bayVersion();
  process.stderr.write(`persist-servers: bay version: ${version.text}\n`);
  requireContract(version);
  // The jobs run the committed tree of the branch of the checkout, and the commit of that branch is the key of each job.
  const branch = runner ? output('git', ['symbolic-ref', '--short', 'HEAD']).trim() : '';
  if (runner && !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch)) throw new Failure(`persist-servers: the checkout is on no branch that a line of sh can name: ${JSON.stringify(branch)}`);
  const commit = runner ? output('git', ['rev-parse', '--verify', `${branch}^{commit}`]).trim() : undefined;
  if (commit !== undefined && !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(commit)) throw new Failure(`persist-servers: git names no commit of the branch ${branch}: ${JSON.stringify(commit)}`);
  const name = `fsm-persist-${String(process.pid)}-${randomBytes(4).toString('hex')}`;
  const directory = path.join(RUNS, name);
  mkdirSync(directory, { recursive: true });
  try {
    // The hosts of the servers come from the plan of the servers alone, and the job check holds them.
    const compose = path.join(directory, 'compose.yaml');
    writeFileSync(compose, servers);
    const hosts = addresses(bayOutput(['-f', compose, '-p', name, 'plan', '--json']));
    const variables: Record<string, string> = {};
    for (const kind of KINDS) Object.assign(variables, SERVERS[kind].variables(hosts[kind]));
    if (runner) {
      writeFileSync(compose, composeFile({ command, variables }));
      writeFileSync(path.join(directory, PART_FILES.build), buildFile());
      for (const part of ['check', 'build'] as const) requireJob(bayOutput(['-f', path.join(directory, PART_FILES[part]), '-p', name, 'plan', '--json']), part, name);
      output('git', ['bundle', 'create', path.join(directory, 'tree.bundle'), branch]);
      writeFileSync(path.join(directory, 'runner.sh'), runnerFile(branch));
    }
    writeFileSync(path.join(directory, 'run.sh'), runFile(name, variables, command, commit));
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return directory;
}

const SIGNALS = { SIGINT: 130, SIGTERM: 143 } as const;

/**
 * Writes the directory of a run of `command`, in the form that `runner` names, runs its run.sh with `args` and returns its exit code. SIGINT and SIGTERM
 * are forwarded to run.sh, whose trap removes the project or cancels the job. The directory is removed unless run.sh marked it after a failed
 * bay down.
 */
async function execute(command: readonly string[], runner: boolean, args: readonly string[]): Promise<number> {
  const directory = write(command, runner);
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
  const [verb, ...rest] = process.argv.slice(2);
  // The option --runner, before the separator, names the runner form.
  const runner = rest[0] === '--runner';
  const [separator, ...command] = runner ? rest.slice(1) : rest;
  try {
    if (verb === 'run' && separator === '--' && command.length > 0) process.exitCode = await execute(command, runner, []);
    else if (verb === 'write' && separator === '--' && command.length > 0) process.stdout.write(`${write(command, runner)}\n`);
    // The step pull runs no command. Its directory is of the runner form, whose Compose file holds every image of a run.
    else if (verb === 'pull' && rest.length === 0) process.exitCode = await execute(['true'], true, ['pull']);
    else throw new Failure(USAGE, 2);
  } catch (error) {
    if (!(error instanceof Failure) && !(error instanceof BayError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.code;
  }
}
