// The run of scripts/persist-servers.mts (docs/plans/fsm-v1/plan.md, C-6; docs/plans/fsm-v1/checklist.md, S-472-1, S-475,
// S-475-7, S-475-11): the script writes the directory of a run, var/persist-servers/<project>, and its run.sh executes it.
// A run has two forms. In the host form, the default, the servers alone are the project: run.sh asks bay for the images,
// starts the project with bay up -no-pull, whose return is the ready event because each server declares its health, runs
// the command on the host with the four FSM_TEST_* variables, and removes the project with bay down, by a trap also after a
// failure and a signal. In the runner form the run is two jobs of bay: build, alone in compose.build.yaml, installs, and
// check, in compose.yaml with the servers, runs the command. The directory also holds runner.sh and the bundle of the
// branch, and run.sh queues each job with the commit of the bundle as its key, shows its output, waits for it and starts
// no program but bay and date.
//
// A test copies the script and the files that it reads into a root of its own, so the directories of its runs are its own,
// and runs it with stand-ins of bay, git, sudo and date that it writes into another directory, the only programs of PATH
// beside a uname: it needs neither bay nor a container runtime, and a run.sh that started another program would fail. The
// stand-in bay records its commands and the Compose file that it was started with, and keeps the contract of bay that plan
// C-6 states. A stand-in waits on a named pipe, never on time.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { standIns } from '../support/stand-ins.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// The tracked files that the script reads, which a test copies with it: the module that starts bay and its pin, the pins of
// the images and the version of Node.js.
const READ = ['scripts/persist-servers.mts', 'scripts/bay.mts', 'config/containers.json', 'config/toolchain.json', 'mise.toml'];

type Kind = 'postgres' | 'mysql' | 'runner';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The value of `key` of the pin of the image of `kind` in config/containers.json. */
function pin(kind: Kind, key: string): unknown {
  let found: unknown = JSON.parse(readFileSync(path.join(ROOT, 'config/containers.json'), 'utf8'));
  for (const each of ['images', kind, key]) found = isRecord(found) ? found[each] : undefined;
  return found;
}

/** The reference of the image of `kind` in config/containers.json. */
function reference(kind: Kind): string {
  const found = pin(kind, 'reference');
  assert.ok(typeof found === 'string', `config/containers.json names no reference of ${kind}`);
  return found;
}

/**
 * The line of the Compose file for the memory limit of the pin of `kind`. The tracked pins hold one each, which a test
 * requires; a pin without one gives the text undefined, which no Compose file of a run holds.
 */
function limit(kind: Kind): string {
  return `    mem_limit: "${String(pin(kind, 'memory'))}"\n`;
}

// The Compose file of a run of the host form: the two servers with the memory limits of their pins. It holds no name,
// because the option -p of bay names the project, and no mount.
const SERVERS = `services:
  postgres:
    image: "${reference('postgres')}"
${limit('postgres')}    expose: ["5432"]
    environment:
      POSTGRES_USER: "fsm"
      POSTGRES_PASSWORD: "fsm"
      POSTGRES_DB: "fsm_test"
    healthcheck:
      test: ["CMD", "pg_isready", "--host=127.0.0.1", "--port=5432", "--username=fsm", "--dbname=fsm_test"]
      start_period: "300s"
      interval: "1s"
      timeout: "5s"
      retries: 3
  mysql:
    image: "${reference('mysql')}"
${limit('mysql')}    expose: ["3306"]
    environment:
      MYSQL_ROOT_PASSWORD: "root"
      MYSQL_USER: "fsm"
      MYSQL_PASSWORD: "fsm"
      MYSQL_DATABASE: "fsm_test"
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "--protocol=tcp", "--host=127.0.0.1", "--port=3306"]
      start_period: "300s"
      interval: "1s"
      timeout: "5s"
      retries: 3
`;

// The command of the runs of the runner form: the words that make persist-servers-write gives, one of them with spaces. The
// stand-in bay runs no job, so the command itself never runs.
const COMMAND = ['make', 'ci-targets', 'TARGETS=db-test-postgres db-test-mysql'];
const RUN = ['run', '--runner', '--', ...COMMAND];

/** The four variables of the servers of `project`, with the hosts and the ports that the stand-in bay plans. */
function variables(project: string): [string, string][] {
  return [
    ['FSM_TEST_PG_DSN', `postgres://fsm:fsm@p.${project}.example:15432/fsm_test?sslmode=disable`],
    ['FSM_TEST_PG_ADMIN_DSN', `postgres://fsm:fsm@p.${project}.example:15432/fsm_test?sslmode=disable`],
    ['FSM_TEST_MYSQL_DSN', `mysql://fsm:fsm@m.${project}.example:13306/fsm_test`],
    ['FSM_TEST_MYSQL_ADMIN_DSN', `mysql://root:root@m.${project}.example:13306/mysql`],
  ];
}

/** The words of a command of a Compose file: each a JSON string whose `$` is `$$`, because bay replaces a `$` of the file. */
function words(command: readonly string[]): string {
  return `[${command.map(word => JSON.stringify(word.replaceAll('$', () => '$$'))).join(', ')}]`;
}

/** The lines of a job of the runner form: the image and the memory of the pin of the runner, and the time limit of a job. */
function job(name: string, command: readonly string[], environment = ''): string {
  return `  ${name}:
    image: "${reference('runner')}"
${limit('runner')}    command: ${words(['sh', '/persist-run/runner.sh', ...command])}
${environment}    volumes: ["./:/persist-run"]
    x-bay:
      job: true
      timeout: "2h"
`;
}

/**
 * The Compose file of a run of the runner form of `project` with the words `command`: the servers and the job check, which
 * runs the command with the four variables. Its one mount is the directory of the run itself, by a path relative to the
 * file, writable, because the jobs share what build installed there. The jobs keep the trust of bay.
 */
function composed(project: string, command: readonly string[] = COMMAND): string {
  return `${SERVERS}${job('check', ['check', ...command], `    environment:\n${variables(project).map(([name, value]) => `      ${name}: ${JSON.stringify(value)}\n`).join('')}`)}`;
}

// The Compose file of the job build of the runner form: the job alone, so the installation runs with no server.
const BUILD = `services:\n${job('build', ['build'])}`;

// The lines that the stand-in bay prints: the JSON of its version, a release that no file of the repository names, with the
// schema of the contract that the files of a run read, the progress of up before the servers are healthy and after, the
// line of a failing up, the output of a job and the id of the job that it queues.
const VERSION = '{"version":"v7.8.9-build","schemaVersion":1}';
const STARTING = 'starting 2 services';
const HEALTHY = 'all services are healthy';
const STOPPED = 'bay: the service mysql stopped before it was healthy';
const RUNNING = 'the command runs';
// The tail of the record of every job, the last output of the job, which quotes the fields that judge a job.
const SHOWN = String.raw`\\"state\\": \\"succeeded\\", \\"ended\\": \\"now\\"`;
// The ids of the jobs that the stand-in bay queues, one for each part.
const JOBS = { build: '20260102-030405.000001-b1b1', check: '20260102-030406.000002-c2c2' } as const;
// The commit that the stand-in git names as the head of the branch, the key of the job.
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
// The time that the stand-in date prints, and the file of the cgroup of a container that holds its highest memory use.
const TIME = '2026-01-02T03:04:05Z';
const PEAK = '/sys/fs/cgroup/memory.peak';

/** What the stand-ins of a case do. */
interface Stand {
  /** Whether PATH holds bay. */
  bay?: boolean;
  /** The local store lacks an image. */
  absent?: boolean;
  /** bay up fails after its first line. */
  upFails?: boolean;
  /** bay up waits on a pipe that nothing writes, after its first line. */
  upWaits?: boolean;
  /** bay job add fails. */
  addFails?: boolean;
  /** The first bay job logs waits on a pipe that nothing writes, after its first line. */
  logsWaits?: boolean;
  /** The job build does not succeed: bay job wait ends with 1 for it. */
  buildFails?: boolean;
  /** The job check does not succeed: bay job wait ends with 1 for it. */
  checkFails?: boolean;
  /** The job build has not ended: bay job wait ends with 1 for it, as at the end of its time limit, and bay job show records it as running. */
  unended?: boolean;
  /** bay job show fails. */
  showFails?: boolean;
  /** bay down fails. */
  downFails?: boolean;
  /** The JSON of bay plan holds no service. */
  unlisted?: boolean;
  /** The JSON of bay plan names no service as a job. */
  unjobbed?: boolean;
  /** The contract of bay is another schema than the one that the files of a run read. */
  other?: boolean;
  /** The words of the variable BAY, which start bay; the variable is not set when it is undefined. */
  started?: string;
  /** The memory that the pin of an image holds in the copied config/containers.json; null removes it. */
  memory?: Partial<Record<Kind, string | null>>;
}

/** The root and the stand-ins of one case and what the test reads from them. */
interface Stage {
  /** The copy of the checkout that holds the script. */
  root: string;
  /** The copied script. */
  script: string;
  env: NodeJS.ProcessEnv;
  /** The commands that bay received, each as the name of the program and its words. */
  calls: () => string[][];
  /** The commands that sudo received. */
  sudo: () => string[][];
  /** The commands that git received. */
  git: () => string[][];
  /** The Compose file of the name `name` that the last bay up or bay job add was started with, or undefined when neither ran with it. */
  composed: (name?: string) => string | undefined;
  /** The directories of runs that the root holds. */
  left: () => string[];
}

/** Copies the script into a root of its own and writes the stand-ins: uname, sudo, date, git and bay, as `stand` says. */
function stage(t: TestContext, stand: Stand = {}): Stage {
  // The script names its checkout by the real path of its own file, so the root is the real path of its directory.
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'fsm-persist-root-')));
  t.after(() => { rmSync(root, { recursive: true, force: true }); });
  for (const file of READ) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    cpSync(path.join(ROOT, file), path.join(root, file));
  }
  if (stand.memory !== undefined) {
    const file = path.join(root, 'config/containers.json');
    const pins: unknown = JSON.parse(readFileSync(file, 'utf8'));
    for (const [kind, memory] of Object.entries(stand.memory)) {
      const pinned = isRecord(pins) && isRecord(pins.images) ? pins.images[kind] : undefined;
      assert.ok(isRecord(pinned), `config/containers.json pins no image of ${kind}`);
      if (memory === null) delete pinned.memory;
      else pinned.memory = memory;
    }
    writeFileSync(file, `${JSON.stringify(pins, null, 2)}\n`);
  }
  const { directory, path: PATH, program: write } = standIns(t, 'Linux');
  for (const flag of ['absent', 'upFails', 'addFails', 'buildFails', 'checkFails', 'unended', 'showFails', 'downFails', 'unlisted', 'unjobbed', 'other'] as const) {
    if (stand[flag] === true) writeFileSync(path.join(directory, flag), '');
  }
  if (stand.upWaits === true) execFileSync('mkfifo', [path.join(directory, 'up-waits')]);
  if (stand.logsWaits === true) execFileSync('mkfifo', [path.join(directory, 'logs-waits')]);
  // Each command is one line of its file of calls, the name of the program and its words joined by a tab.
  const record = (name: string, file: string): string => `d='${directory}'
line=${name}
for word in "$@"; do line="$line\t$word"; done
printf '%s\\n' "$line" >> "$d/${file}"
`;
  // sudo -n runs its command, as the sudo of a user without a password does.
  write('sudo', `${record('sudo', 'sudo-calls')}[ "$1" = -n ] || exit 2\nshift\nPATH='${directory}' exec "$@"\n`);
  // date prints one time, so the report of a run is the same text in every case.
  write('date', `[ "$1" = -u ] && [ "$2" = '+%Y-%m-%dT%H:%M:%SZ' ] || exit 2\necho '${TIME}'\n`);
  // git names the branch main and its commit, and writes an empty file as its bundle.
  write('git', `${record('git', 'git-calls')}case "$1" in
symbolic-ref) echo main ;;
rev-parse) [ "$2" = --verify ] && [ "$3" = 'main^{commit}' ] || exit 2; echo ${COMMIT} ;;
bundle) : > "$3" ;;
*) exit 2 ;;
esac
`);
  // The options -f and -p come before the command: every command of a project reads the Compose file that -f names, or
  // the compose.yaml of a directory that it names, and fails with the code 9 without it. up and job add copy the file, so
  // the test reads what bay was started with. As bay does, plan prints the name, the host and the port of each service of
  // the file as JSON, and the time limit of a service that the file declares as a job; images ends with 1 when the store
  // lacks an image; up refuses a healthcheck whose count of retries is outside 1..100. The host and the port of a service
  // are values that no rule builds from the project and the service, so a DSN holds them only when the script read them.
  // exec prints the memory of a container. job add prints the id of the job of its part on standard output and its
  // progress on standard error; job logs prints the output of a job, job wait ends with 0 for a job that succeeded and 1
  // for one that did not or has not ended, job show -json prints the record of a job as bay does, one field a line, with
  // the field ended once the job ended and a tail that quotes other fields, and job cancel prints a line. No job runs: the
  // installation and the command would run in a container.
  if (stand.bay !== false) {
    write('bay', `${record('bay', 'calls')}f=
p=
while [ $# -gt 0 ]; do
	case "$1" in
	-f) f=$2; shift 2 ;;
	-p) p=$2; shift 2 ;;
	*) break ;;
	esac
done
c=$f
[ -d "$f" ] && c=$f/compose.yaml
[ "$1" = version ] || [ -e "$c" ] || exit 9
# The id of a job: the last word is the id, or the part of job add.
id() {
	case "$1" in
	build | ${JOBS.build}) echo ${JOBS.build} ;;
	check | ${JOBS.check}) echo ${JOBS.check} ;;
	*) exit 2 ;;
	esac
}
case "$1" in
version)
	if [ -e "$d/other" ]; then echo '{"version":"v7.8.9-build","schemaVersion":2}'; else echo '${VERSION}'; fi
	;;
plan)
	if [ -e "$d/unlisted" ]; then printf '{"schemaVersion":1,"project":"%s","services":[]}\\n' "$p"; exit 0; fi
	job=
	if [ ! -e "$d/unjobbed" ]; then job=',"job":{"timeout":"2h0m0s"}'; fi
	services=
	if grep -q '^  mysql:$' "$c"; then services=$(printf '{"name":"mysql","host":"m.%s.example","port":13306},{"name":"postgres","host":"p.%s.example","port":15432}' "$p" "$p"); fi
	for part in build check; do
		if grep -q "^  $part:$" "$c"; then services="$services\${services:+,}$(printf '{"name":"%s","host":"%s.%s.example"%s}' "$part" "$part" "$p" "$job")"; fi
	done
	printf '{"schemaVersion":1,"project":"%s","services":[%s]}\\n' "$p" "$services"
	;;
images)
	if [ -e "$d/absent" ]; then echo 'postgres  missing'; exit 1; fi
	echo 'postgres  present'
	;;
pull)
	echo 'pulled 3 images'
	;;
up)
	cp "$c" "$d/composed-$(basename "$c")"
	awk '/^  [a-z]+:$/ { service = substr($1, 1, length($1) - 1) } /^      retries: / { if ($2 < 1 || $2 > 100) { print "bay: compose.yaml: service " service ": healthcheck retries must be 1..100"; refused = 1 } } END { exit refused }' "$c" >&2 || exit 1
	echo '${STARTING}' >&2
	if [ -p "$d/up-waits" ]; then read -r _ < "$d/up-waits"; fi
	if [ -e "$d/upFails" ]; then echo '${STOPPED}' >&2; exit 1; fi
	echo '${HEALTHY}' >&2
	;;
exec)
	[ "$3" = cat ] && [ "$4" = ${PEAK} ] || exit 2
	echo 4096
	;;
job)
	case "$2" in
	add)
		cp "$c" "$d/composed-$(basename "$c")"
		if [ -e "$d/addFails" ]; then echo 'bay: the agent did not answer' >&2; exit 1; fi
		job=$(id "$5")
		echo "queued job $job (project $5)" >&2
		echo "$job"
		;;
	logs)
		echo "${RUNNING} $(id "$6")"
		if [ -p "$d/logs-waits" ]; then read -r _ < "$d/logs-waits"; fi
		;;
	wait)
		job=$(id "$5")
		if [ "$job" = ${JOBS.build} ] && [ -e "$d/unended" ]; then echo "bay: job $job has not ended" >&2; exit 1; fi
		if [ "$job" = ${JOBS.build} ] && [ -e "$d/buildFails" ]; then echo "bay: job $job failed, exit 7" >&2; exit 1; fi
		if [ "$job" = ${JOBS.check} ] && [ -e "$d/checkFails" ]; then echo "bay: job $job failed, exit 7" >&2; exit 1; fi
		;;
	show)
		[ "$3" = -json ] || exit 2
		job=$(id "$4")
		if [ -e "$d/showFails" ]; then echo 'bay: the agent did not answer' >&2; exit 1; fi
		state=succeeded
		ended=1
		if [ "$job" = ${JOBS.build} ] && [ -e "$d/buildFails" ]; then state=failed; fi
		if [ "$job" = ${JOBS.check} ] && [ -e "$d/checkFails" ]; then state=failed; fi
		if [ "$job" = ${JOBS.build} ] && [ -e "$d/unended" ]; then state=running; ended=; fi
		printf '{\n  "id": "%s",\n  "state": "%s",\n' "$job" "$state"
		if [ -n "$ended" ]; then printf '  "ended": "%s",\n' '${TIME}'; fi
		printf '  "tail": "${SHOWN}"\n}\n'
		;;
	cancel)
		echo "cancelled job $(id "$3")"
		;;
	*)
		exit 2
		;;
	esac
	;;
down)
	if [ -e "$d/downFails" ]; then echo 'bay: the runtime did not answer' >&2; exit 1; fi
	echo 'removed 2 services'
	;;
*)
	exit 2
	;;
esac
`);
  }
  const lines = (name: string): string[][] => {
    const file = path.join(directory, name);
    return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(line => line !== '').map(line => line.split('\t')) : [];
  };
  const runs = path.join(root, 'var/persist-servers');
  return {
    root,
    script: path.join(root, 'scripts/persist-servers.mts'),
    env: stand.started === undefined ? { PATH } : { PATH, BAY: stand.started },
    calls: () => lines('calls'),
    sudo: () => lines('sudo-calls'),
    git: () => lines('git-calls'),
    composed: (name = 'compose.yaml') => (existsSync(path.join(directory, `composed-${name}`)) ? readFileSync(path.join(directory, `composed-${name}`), 'utf8') : undefined),
    left: () => (existsSync(runs) ? readdirSync(runs) : []),
  };
}

/** How a run of the script ended, with its output. */
interface Ended {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs the script of `staged` with `args`. `seen` receives each line of its output with the stream that held it and a
 * function that sends a signal to the script, so a test acts on an event of the run.
 */
function script(staged: Stage, args: string[], seen: (line: string, stream: 'stdout' | 'stderr', kill: (signal: NodeJS.Signals) => void) => void = () => undefined, cwd?: string): Promise<Ended> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [staged.script, ...args], { cwd, env: staged.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = { stdout: '', stderr: '' };
    for (const stream of ['stdout', 'stderr'] as const) {
      createInterface({ input: child[stream] }).on('line', line => {
        output[stream] += `${line}\n`;
        seen(line, stream, signal => { child.kill(signal); });
      });
    }
    child.on('error', reject);
    child.on('close', (code, signal) => { resolve({ code, signal, ...output }); });
  });
}

/** The command of a run of the host form, which runs: it writes the four variables of the servers into `file`, one a line, and exits with `code`. */
function writes(file: string, code = 0): string[] {
  return ['/bin/sh', '-c', `printf '%s\\n' "$FSM_TEST_PG_DSN" "$FSM_TEST_PG_ADMIN_DSN" "$FSM_TEST_MYSQL_DSN" "$FSM_TEST_MYSQL_ADMIN_DSN" > '${file}'; exit ${String(code)}`];
}

/** The four variables of the servers of `project`, one a line, as the command of the host form writes them. */
function dsns(project: string): string {
  return `${variables(project).map(([, value]) => value).join('\n')}\n`;
}

/** The words that name the Compose file and the project of a command of bay: the program and its options -f and -p. */
type Named = [string, string, string, string, string];

/** The directory of the run of `project`, which holds its Compose file. */
function directoryOf(project: Named): string {
  return path.dirname(project[2]);
}

/** Writes the directory of a run of the runner form of `staged` and returns the words of its project. */
function written(staged: Stage): Named {
  const wrote = spawnSync(process.execPath, [staged.script, 'write', '--runner', '--', ...COMMAND], { encoding: 'utf8', env: staged.env });
  assert.equal(wrote.status, 0, wrote.stderr);
  return named(staged);
}

/** Runs run.sh of `project` with `args` from another directory, as sh <directory>/run.sh over ssh does. */
function runSh(staged: Stage, project: Named, args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync('/bin/sh', [path.join(directoryOf(project), 'run.sh'), ...args], { cwd: tmpdir(), encoding: 'utf8', env: staged.env });
}

/**
 * The words before the command of the one project that the calls of `staged` name: bay, -f with compose.yaml of the
 * directory of the run and -p with the project, the name of that directory. Fails when the calls name no project or more
 * than one, and when a command names another file than the two Compose files of a run.
 */
function named(staged: Stage): Named {
  const calls = staged.calls().filter(call => call[1] === '-f');
  const projects = new Set(calls.map(call => `${path.dirname(call[2] ?? '')}\t${call[4] ?? ''}`));
  const [only, ...more] = [...projects];
  assert.ok(only !== undefined && more.length === 0, `the commands of bay do not name one project: ${JSON.stringify(staged.calls())}`);
  const [directory = '', project = ''] = only.split('\t');
  assert.equal(directory, path.join(staged.root, 'var/persist-servers', project), 'the directory of the run is not var/persist-servers/<project> of the checkout');
  for (const call of calls) {
    assert.ok(['compose.yaml', 'compose.build.yaml'].includes(path.basename(call[2] ?? '')), `a command of bay names the file ${String(call[2])}`);
    assert.deepEqual([call[0], call[1], call[3], call[4]], ['bay', '-f', '-p', project]);
  }
  // The version of bay is that of the machine, so its two commands name no project.
  for (const call of staged.calls().filter(each => each[1] !== '-f')) assert.deepEqual(call.slice(0, 2), ['bay', 'version']);
  return ['bay', '-f', path.join(directory, 'compose.yaml'), '-p', project];
}

/** The words of `project` with the Compose file of the job build, which holds that job alone. */
function building(project: Named): Named {
  return [project[0], project[1], path.join(directoryOf(project), 'compose.build.yaml'), project[3], project[4]];
}

// The commands of bay of the writing before its plan, and of run.sh before its first step: each reads the version of bay.
const WRITTEN = ['bay', 'version', '--json'];
const VERSIONED = ['bay', 'version', '--json'];

/**
 * The commands of bay of a run of the host form to the step `last`: the version and the plan of the writing, then the steps
 * of run.sh and, once bay up was started, the reading of the memory of each server and bay down. The command is no command
 * of bay.
 */
function hosted(project: Named, last: 'images' | 'up'): string[][] {
  const all = [WRITTEN, [...project, 'plan', '--json'], VERSIONED, [...project, 'images'], [...project, 'up', '-no-pull']];
  const ending = [...['postgres', 'mysql'].map(service => [...project, 'exec', service, 'cat', PEAK]), [...project, 'down']];
  return last === 'images' ? all.slice(0, 4) : [...all, ...ending];
}

/** The commands of bay of the job of `part` of `project`: it is queued with the commit of the bundle as its key, its output is shown, it is waited for and its record is printed. */
function part(project: Named, name: 'build' | 'check'): string[][] {
  const words = name === 'build' ? building(project) : project;
  const id = JOBS[name];
  return [[...words, 'job', 'add', '-key', COMMIT, name], [...words, 'job', 'logs', '-f', '-timeout', '24h', id], [...words, 'job', 'wait', '-timeout', '24h', id], [...words, 'job', 'show', '-json', id]];
}

/**
 * The commands of bay of a run of the runner form to the step `last`: the version and the three plans of the writing, one
 * of the servers alone for their hosts and one of each whole file, then the steps of run.sh: the images, and the job build
 * and then the job check, each queued, shown, waited for and printed.
 */
function jobbed(project: Named, last: 'plans' | 'images' | 'add' | 'build' | 'check'): string[][] {
  const all = [
    WRITTEN, [...project, 'plan', '--json'], [...project, 'plan', '--json'], [...building(project), 'plan', '--json'], VERSIONED, [...project, 'images'],
    ...part(project, 'build'), ...part(project, 'check'),
  ];
  return all.slice(0, { plans: 4, images: 6, add: 7, build: 10, check: 14 }[last]);
}

// The lines of a report: the time and an event, and the start and the exit code of a step.
const event = (text: string): string => `${TIME} ${text}`;
const stepped = (name: string, code = 0): string[] => [event(`${name} start`), event(`${name} exit ${String(code)}`)];

// ---- The host form, the default --------------------------------------------------------------------------------------

test('a run of the host form starts the servers alone, runs the command on the host with the DSNs that bay plans, runs bay down and removes its directory', async t => {
  const staged = stage(t);
  const file = path.join(staged.root, 'variables');
  const ended = await script(staged, ['run', '--', ...writes(file)]);
  assert.deepEqual([ended.code, ended.signal], [0, null], ended.stderr);
  const project = named(staged);
  assert.equal(staged.composed(), SERVERS);
  assert.equal(readFileSync(file, 'utf8'), dsns(project[4]));
  // The command is a process of the host: bay gets no job, and no bundle is made.
  assert.deepEqual(staged.calls(), hosted(project, 'up'));
  assert.deepEqual(staged.git(), []);
  assert.deepEqual(staged.left(), []);
  // The output of bay is on standard error; the standard output is that of the command, which writes to its file.
  assert.ok(ended.stderr.includes(`\n${VERSION}\n`), ended.stderr);
  assert.equal(ended.stdout, '');
  assert.match(ended.stderr, new RegExp(`^persist-servers: removed the project ${project[4]}$`, 'm'));
  // The lines of the report are shown, because run removes the directory that holds the file.
  for (const line of ['up exit 0', 'command exit 0', 'memory.peak postgres 4096', 'memory.peak mysql 4096', 'run exit 0']) assert.ok(ended.stderr.includes(`persist-servers: ${TIME} ${line}\n`), `the run does not show ${line}:\n${ended.stderr}`);
});

// The command of the host form is that of the caller, such as make ci-targets of make persist-servers, so it runs in the
// directory of the caller and not in the directory of the run that run.sh enters: there, make found no Makefile and the job
// check of CI ended with `No rule to make target 'ci-targets'` (S-480).
test('the command of a run of the host form runs in the directory of the caller', async t => {
  const staged = stage(t);
  const caller = realpathSync(mkdtempSync(path.join(tmpdir(), 'fsm-persist-caller-')));
  t.after(() => { rmSync(caller, { recursive: true, force: true }); });
  const file = path.join(staged.root, 'directory');
  const ended = await script(staged, ['run', '--', '/bin/sh', '-c', `pwd -P > '${file}'`], undefined, caller);
  assert.deepEqual([ended.code, ended.signal], [0, null], ended.stderr);
  assert.equal(readFileSync(file, 'utf8'), `${caller}\n`);
  assert.deepEqual(staged.left(), []);
});

test('the code of a run of the host form is that of the command, and a failed bay up runs no command and removes the project', async t => {
  const staged = stage(t);
  const ended = await script(staged, ['run', '--', ...writes(path.join(staged.root, 'variables'), 7)]);
  assert.deepEqual([ended.code, ended.signal], [7, null], ended.stderr);
  assert.deepEqual(staged.calls(), hosted(named(staged), 'up'));
  assert.deepEqual(staged.left(), []);
  const failing = stage(t, { upFails: true });
  const file = path.join(failing.root, 'variables');
  const failed = await script(failing, ['run', '--', ...writes(file)]);
  assert.deepEqual([failed.code, failed.signal], [1, null], failed.stderr);
  const project = named(failing);
  assert.equal(existsSync(file), false, 'the command ran with servers that were not ready');
  assert.match(failed.stderr, new RegExp(`^${STOPPED}$`, 'm'));
  assert.match(failed.stderr, new RegExp(`^persist-servers: bay up failed before the servers of the project ${project[4]} were healthy$`, 'm'));
  assert.deepEqual(failing.calls(), hosted(project, 'up'));
  assert.deepEqual(failing.left(), []);
});

test('write of the host form writes the Compose file of the servers and run.sh alone', t => {
  const staged = stage(t);
  const file = path.join(staged.root, 'variables');
  const written = spawnSync(process.execPath, [staged.script, 'write', '--', ...writes(file)], { encoding: 'utf8', env: staged.env });
  assert.equal(written.status, 0, written.stderr);
  const project = named(staged);
  assert.equal(written.stdout, `${directoryOf(project)}\n`);
  assert.deepEqual(readdirSync(directoryOf(project)).sort(), ['compose.yaml', 'run.sh']);
  assert.equal(readFileSync(path.join(directoryOf(project), 'compose.yaml'), 'utf8'), SERVERS);
  const ran = spawnSync('/bin/sh', [path.join(directoryOf(project), 'run.sh')], { cwd: tmpdir(), encoding: 'utf8', env: staged.env });
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(readFileSync(file, 'utf8'), dsns(project[4]));
  assert.deepEqual(staged.calls(), hosted(project, 'up'));
  const unknown = spawnSync('/bin/sh', [path.join(directoryOf(project), 'run.sh'), 'add'], { cwd: tmpdir(), encoding: 'utf8', env: staged.env });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /^usage: sh run\.sh \[run\|pull\]$/m);
});

for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130]] as const) {
  test(`${signal} while the command of the host form runs ends the command, and the project is removed`, async t => {
    const staged = stage(t);
    execFileSync('mkfifo', [path.join(staged.root, 'never')]);
    // The command writes a line when it runs and then waits on a pipe that nothing writes, so only the signal ends it.
    const command = ['run', '--', '/bin/sh', '-c', `echo started; read -r _ < '${path.join(staged.root, 'never')}'`];
    const ended = await script(staged, command, (line, stream, kill) => { if (stream === 'stdout' && line === 'started') kill(signal); });
    assert.deepEqual([ended.code, ended.signal], [code, null], ended.stderr);
    assert.deepEqual(staged.calls(), hosted(named(staged), 'up'));
    assert.deepEqual(staged.left(), []);
  });

  // The stand-in waits on a pipe that nothing writes, so only the signal that run.sh sends to bay up ends it.
  test(`${signal} while the servers start ends bay up, and the run ends without the command and removes the project`, async t => {
    const staged = stage(t, { upWaits: true });
    const file = path.join(staged.root, 'variables');
    const ended = await script(staged, ['run', '--', ...writes(file)], (line, stream, kill) => { if (stream === 'stderr' && line === STARTING) kill(signal); });
    assert.deepEqual([ended.code, ended.signal], [code, null], ended.stderr);
    assert.doesNotMatch(ended.stderr, new RegExp(HEALTHY));
    assert.equal(existsSync(file), false, 'the command ran with servers that were not ready');
    assert.deepEqual(staged.calls(), hosted(named(staged), 'up'));
    assert.deepEqual(staged.left(), []);
  });
}

test('a bay down that fails fails the run, which keeps its directory, marks it and shows the command that removes the project', async t => {
  const staged = stage(t, { downFails: true });
  const ended = await script(staged, ['run', '--', '/bin/sh', '-c', 'exit 0']);
  assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
  const project = named(staged);
  assert.ok(ended.stderr.includes(`\npersist-servers: bay down failed; the containers of the project ${project[4]} may still run: run bay -f ${project[2]} -p ${project[4]} down\n`), ended.stderr);
  assert.deepEqual(staged.left(), [project[4]]);
  assert.equal(existsSync(path.join(directoryOf(project), 'down-failed')), true);
  assert.equal(readFileSync(path.join(directoryOf(project), 'compose.yaml'), 'utf8'), SERVERS);
});

// ---- The memory of the services ----------------------------------------------------------------------------------------

// A machine of 3.7 GB ends the processes of its containers at 3.0 GB together. The servers hold limits above their peaks,
// and the runner, which installs in the job build with no server, a limit above the peak of its installation that stays
// below 3.0 GB.
test('the pins hold the memory limit of each service, and that of the runner stays below the 3.0 GB of the machine of a run', () => {
  assert.deepEqual((['postgres', 'mysql', 'runner'] as const).map(kind => pin(kind, 'memory')), ['448m', '640m', '2560m']);
  assert.ok(2560 * 2 ** 20 < 3.0e9);
});

// A limit of memory is a value of the pin of an image; a pin without one gives a service without a limit.
test('the memory of a pin is the mem_limit of its service in the Compose file, and a pin without one gives no limit', async t => {
  const staged = stage(t, { memory: { mysql: '768m', postgres: null } });
  const ended = await script(staged, ['run', '--', '/bin/sh', '-c', 'exit 0']);
  assert.deepEqual([ended.code, ended.signal], [0, null], ended.stderr);
  assert.equal(staged.composed(), SERVERS.replace(limit('mysql'), '    mem_limit: "768m"\n').replace(limit('postgres'), ''));
});

// ---- The runner form: two jobs of bay -------------------------------------------------------------------------------

test('a run of the runner form queues the job build and then the job check with the commit of the bundle as their key, shows their output, waits for them and removes its directory', async t => {
  const staged = stage(t);
  const ended = await script(staged, RUN);
  assert.deepEqual([ended.code, ended.signal], [0, null], ended.stderr);
  const project = named(staged);
  assert.match(project[4], /^fsm-persist-\d+-[0-9a-f]{8}$/);
  assert.equal(staged.composed(), composed(project[4]));
  assert.equal(staged.composed('compose.build.yaml'), BUILD);
  // The steps of run.sh in their order, each a command of bay: no bay up and no bay down, which each job does itself.
  assert.deepEqual(staged.calls(), jobbed(project, 'check'));
  // The bundle and the key are those of the branch of the checkout.
  assert.deepEqual(staged.git(), [
    ['git', 'symbolic-ref', '--short', 'HEAD'], ['git', 'rev-parse', '--verify', 'main^{commit}'],
    ['git', 'bundle', 'create', path.join(directoryOf(project), 'tree.bundle'), 'main'],
  ]);
  assert.deepEqual(staged.left(), [], 'the run left its directory');
  // The record of a run names the bay that made its result, and holds the output of each job and its record, all on
  // standard error: the standard output of run.sh holds results alone.
  assert.ok(ended.stderr.startsWith(`persist-servers: bay version: ${VERSION}\n`), ended.stderr);
  assert.ok(ended.stderr.includes(`\n${VERSION}\n`), ended.stderr);
  assert.equal(ended.stdout, '');
  for (const id of Object.values(JOBS)) {
    assert.match(ended.stderr, new RegExp(`^${RUNNING} ${id}$`, 'm'));
    assert.match(ended.stderr, new RegExp(`^  "id": "${id}",\n  "state": "succeeded",$`, 'm'));
  }
  for (const line of [event(`job build ${JOBS.build}`), event(`job check ${JOBS.check}`), event('wait check exit 0'), event('run exit 0')]) assert.ok(ended.stderr.includes(`persist-servers: ${line}\n`), `the run does not show ${line}:\n${ended.stderr}`);
  // The project of a second run has another name, so two runs share no directory, no project and no container.
  const again = stage(t);
  await script(again, RUN);
  assert.notEqual(named(again)[4], project[4]);
});

test('a job build that does not succeed fails the run without the job check, and a job check that does not succeed fails it', async t => {
  const staged = stage(t, { buildFails: true });
  const ended = await script(staged, RUN);
  assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
  assert.deepEqual(staged.calls(), jobbed(named(staged), 'build'));
  assert.equal(staged.composed(), undefined, 'the job check was queued after the job build failed');
  assert.deepEqual(staged.left(), []);
  const checking = stage(t, { checkFails: true });
  const checked = await script(checking, RUN);
  assert.deepEqual([checked.code, checked.signal], [1, null], checked.stderr);
  assert.deepEqual(checking.calls(), jobbed(named(checking), 'check'));
  assert.deepEqual(checking.left(), []);
});

test('a bay job add that fails fails the run and waits for no job', async t => {
  const staged = stage(t, { addFails: true });
  const ended = await script(staged, RUN);
  assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
  const project = named(staged);
  assert.match(ended.stderr, new RegExp(`^persist-servers: bay job add failed for the job build of the project ${project[4]}$`, 'm'));
  assert.deepEqual(staged.calls(), jobbed(project, 'add'));
  assert.deepEqual(staged.left(), []);
});

// write is the verb for a run on another machine: the directory is all that is moved there, and sh with bay runs it.
test('write of the runner form writes the directory of a run and prints it, and sh run.sh executes it with bay alone', t => {
  const staged = stage(t);
  const written = spawnSync(process.execPath, [staged.script, 'write', '--runner', '--', ...COMMAND], { encoding: 'utf8', env: staged.env });
  assert.equal(written.status, 0, written.stderr);
  const project = named(staged);
  assert.equal(written.stdout, `${directoryOf(project)}\n`);
  assert.deepEqual(staged.calls(), jobbed(project, 'plans'));
  assert.deepEqual(readdirSync(directoryOf(project)).sort(), ['compose.build.yaml', 'compose.yaml', 'run.sh', 'runner.sh', 'tree.bundle']);
  assert.equal(readFileSync(path.join(directoryOf(project), 'compose.yaml'), 'utf8'), composed(project[4]));
  assert.equal(readFileSync(path.join(directoryOf(project), 'compose.build.yaml'), 'utf8'), BUILD);
  // run.sh runs from another directory, with a PATH that holds the stand-ins alone.
  const ran = spawnSync('/bin/sh', [path.join(directoryOf(project), 'run.sh')], { cwd: tmpdir(), encoding: 'utf8', env: staged.env });
  assert.equal(ran.status, 0, ran.stderr);
  assert.deepEqual(staged.calls(), jobbed(project, 'check'));
  // The directory stays: the one who wrote it removes it.
  assert.deepEqual(staged.left(), [project[4]]);
  const pulled = spawnSync('/bin/sh', [path.join(directoryOf(project), 'run.sh'), 'pull'], { cwd: tmpdir(), encoding: 'utf8', env: staged.env });
  assert.equal(pulled.status, 0, pulled.stderr);
  assert.deepEqual(staged.calls().slice(-2), [VERSIONED, [...project, 'pull']]);
  // The report of the two runs of the directory: the time of each step and the id of each job.
  const parted = (name: 'build' | 'check'): string[] => [...stepped(`add ${name}`), event(`job ${name} ${JOBS[name]}`), ...stepped(`logs ${name}`), ...stepped(`wait ${name}`), ...stepped(`show ${name}`)];
  assert.deepEqual(readFileSync(path.join(directoryOf(project), 'report.txt'), 'utf8').split('\n'), [
    ...stepped('version'), ...stepped('images'), ...parted('build'), ...parted('check'), event('run exit 0'),
    ...stepped('version'), ...stepped('pull'), event('run exit 0'),
    '',
  ]);
  for (const args of [['start'], ['add'], ['add', 'runner'], ['add', 'build', 'check'], ['wait'], ['wait', 'runner'], ['wait', 'build', 'check']]) {
    const unknown = spawnSync('/bin/sh', [path.join(directoryOf(project), 'run.sh'), ...args], { cwd: tmpdir(), encoding: 'utf8', env: staged.env });
    assert.equal(unknown.status, 2, args.join(' '));
    assert.match(unknown.stderr, /^usage: sh run\.sh \[run\|add build\|add check\|wait build\|wait check\|pull\]$/m);
  }
});

// A run on another machine is queued there part by part and read from the machine that wrote it: a job runs on without
// its caller, who queues check after build succeeded.
// The standard output of add is the id alone, so that id=$(ssh <machine> sh run.sh add build) holds the id; the version of
// bay and every line of the run are on standard error.
test('sh run.sh add <part> queues the job of that part, prints its id alone on standard output and ends, and waits for nothing', t => {
  const staged = stage(t);
  const project = written(staged);
  const report: string[] = [];
  for (const name of ['build', 'check'] as const) {
    const added = runSh(staged, project, ['add', name]);
    assert.equal(added.status, 0, added.stderr);
    const id = JOBS[name];
    assert.equal(added.stdout, `${id}\n`);
    assert.ok(added.stderr.includes(`${VERSION}\n`), added.stderr);
    assert.deepEqual(staged.calls().slice(-3), [VERSIONED, [...project, 'images'], part(project, name)[0]]);
    assert.ok(added.stderr.includes(`persist-servers: the job ${id} runs on; sh ${path.join(directoryOf(project), 'run.sh')} wait ${name} on this machine follows it to its end\n`), added.stderr);
    assert.equal(readFileSync(path.join(directoryOf(project), `job-${name}`), 'utf8'), `${id}\n`);
    report.push(...stepped('version'), ...stepped('images'), ...stepped(`add ${name}`), event(`job ${name} ${id}`), event('run exit 0'));
  }
  assert.deepEqual(readFileSync(path.join(directoryOf(project), 'report.txt'), 'utf8').split('\n'), [...report, '']);
});

// wait runs on the machine that runs the job, so a lost connection of the one who waits ends the wait and not the job;
// its code says how the job ended, by the record of bay, and 3 says that its end is not known, so wait follows it again.
test('sh run.sh wait <part> follows the job that add queued to its end and ends with 0 for a job that succeeded, prints nothing on standard output and queues nothing', t => {
  const staged = stage(t);
  const project = written(staged);
  for (const name of ['build', 'check'] as const) {
    assert.equal(runSh(staged, project, ['add', name]).status, 0);
    const before = staged.calls().length;
    const waited = runSh(staged, project, ['wait', name]);
    assert.equal(waited.status, 0, waited.stderr);
    assert.equal(waited.stdout, '');
    assert.deepEqual(staged.calls().slice(before), [VERSIONED, ...part(project, name).slice(1)]);
    assert.match(waited.stderr, new RegExp(`^${RUNNING} ${JOBS[name]}$`, 'm'));
    assert.match(waited.stderr, new RegExp(`^  "id": "${JOBS[name]}",$`, 'm'));
    assert.equal(readFileSync(path.join(directoryOf(project), `job-${name}.json`), 'utf8').split('\n')[2], '  "state": "succeeded",');
  }
});

test('sh run.sh wait <part> ends with 1 for a job that ended and did not succeed, 3 for one that has not ended or that bay cannot show, and 2 for a part that add did not queue', t => {
  for (const [stand, code, said] of [
    [{ buildFails: true }, 1, 'did not succeed'],
    [{ unended: true }, 3, 'has not ended'],
    [{ showFails: true }, 3, 'has no record'],
  ] as const) {
    const staged = stage(t, stand);
    const project = written(staged);
    assert.equal(runSh(staged, project, ['add', 'build']).status, 0);
    const waited = runSh(staged, project, ['wait', 'build']);
    assert.equal(waited.status, code, `${JSON.stringify(stand)}: ${waited.stderr}`);
    assert.equal(waited.stdout, '');
    assert.match(waited.stderr, new RegExp(`^persist-servers: the job build ${JOBS.build} of the project ${project[4]} ${said}`, 'm'));
    if (code === 3) assert.match(waited.stderr, new RegExp(`sh ${path.join(directoryOf(project), 'run.sh')} wait build follows it again`));
    // A wait cancels nothing: the job runs on without the one who waits.
    assert.ok(!staged.calls().some(call => call.includes('cancel')), JSON.stringify(staged.calls()));
  }
  const staged = stage(t);
  const project = written(staged);
  const before = staged.calls().length;
  const waited = runSh(staged, project, ['wait', 'check']);
  assert.equal(waited.status, 2, waited.stderr);
  assert.match(waited.stderr, new RegExp(`^persist-servers: the job check of the project ${project[4]} is not queued here: run sh ${path.join(directoryOf(project), 'run.sh')} add check$`, 'm'));
  assert.deepEqual(staged.calls().slice(before), [VERSIONED]);
});

// The whole run judges each job as wait does: a job whose end is not known is cancelled, because the run removes the
// directory that the job reads.
test('a run of the runner form whose job build has not ended ends with 3 and cancels the job', async t => {
  const staged = stage(t, { unended: true });
  const ended = await script(staged, RUN);
  assert.deepEqual([ended.code, ended.signal], [3, null], ended.stderr);
  const project = named(staged);
  const build = building(project);
  assert.deepEqual(staged.calls(), [...jobbed(project, 'build'), [...build, 'job', 'cancel', JOBS.build], [...build, 'job', 'wait', '-timeout', '24h', JOBS.build]]);
  assert.deepEqual(staged.left(), []);
});

test('runner.sh installs the tools of the repository below work/ in the job build and runs the command on them in the job check', t => {
  const staged = stage(t);
  const written = spawnSync(process.execPath, [staged.script, 'write', '--runner', '--', ...COMMAND], { encoding: 'utf8', env: staged.env });
  assert.equal(written.status, 0, written.stderr);
  const runner = readFileSync(path.join(directoryOf(named(staged)), 'runner.sh'), 'utf8');
  const packages = pin('runner', 'packages');
  assert.ok(Array.isArray(packages) && packages.length > 0 && packages.every(each => typeof each === 'string'), 'config/containers.json names no packages of the runner');
  const node = /^node = "(\d+\.\d+\.\d+)"$/m.exec(readFileSync(path.join(ROOT, 'mise.toml'), 'utf8'))?.[1];
  assert.ok(node !== undefined, 'mise.toml names no version of node');
  // The steps in their order: a later step needs what an earlier one installed. Each job installs the system packages
  // into its new container, and the job build installs the rest below work/ of the directory of the run.
  const order = [
    'set -eu',
    'work=/persist-run/work',
    'owner=$(stat -c %u:%g /persist-run)',
    'chown -R "$owner" "$work"',
    `apt-get install -y -q ${packages.join(' ')}`,
    'case "$1" in',
    'build)',
    `https://nodejs.org/dist/v${node}/node-v${node}-linux-$arch.tar.xz`,
    'tar -xJ -C "$work/node" --strip-components=1',
    'https://sh.rustup.rs',
    'git clone -q -b main /persist-run/tree.bundle "$work/tree"',
    'make bootstrap',
    'make install',
    'check)',
    'cd "$work/tree"',
    '"$@"',
  ];
  let from = 0;
  for (const text of order) {
    const at = runner.indexOf(text, from);
    assert.ok(at >= 0, `runner.sh does not hold ${text} after the step before it:\n${runner}`);
    from = at + text.length;
  }
  // The tools are those of work/, and nothing is written into the directory of the run outside work/.
  assert.match(runner, /^PATH="\$work\/node\/bin:\$CARGO_HOME\/bin:\$PATH"$/m);
  assert.doesNotMatch(runner, /> ?\/persist-run\/(?!work)|-C \/persist-run\/(?!work)|\/usr\/local/);
});

test('the Compose files of the runner form name no project, publish no port, mount the directory of the run alone, keep the trust of bay and name each image by its digest', async t => {
  const staged = stage(t);
  await script(staged, RUN);
  const file = staged.composed();
  assert.ok(file !== undefined, 'bay job add did not run with compose.yaml');
  for (const each of [file, BUILD]) {
    assert.doesNotMatch(each, /^\s*(?:name|ports|tmpfs|network_mode|container_name|trust|certificate)\s*:/m);
    // The one key of bay is the job of the file.
    assert.deepEqual(each.match(/^\s*x-bay:.*$/gm), ['    x-bay:']);
    assert.deepEqual(each.match(/^ *volumes: .*$/gm), ['    volumes: ["./:/persist-run"]']);
  }
  assert.deepEqual(file.match(/^ {4}expose: .*$/gm), ['    expose: ["5432"]', '    expose: ["3306"]']);
  assert.doesNotMatch(BUILD, /expose|healthcheck|FSM_TEST_/);
  const images = [...file.matchAll(/^ {4}image: "(.*)"$/gm)].map(match => match[1]);
  assert.deepEqual(images, [reference('postgres'), reference('mysql'), reference('runner')]);
  for (const image of images) assert.match(image ?? '', /^docker\.io\/library\/[a-z]+@sha256:[0-9a-f]{64}$/);
});

// bay replaces a $ of a Compose file by a variable of its own environment, so a $ of the command reaches the job as $$.
test('a $ of the command of the runner form is written as $$ in the Compose file', async t => {
  const staged = stage(t);
  const command = ['sh', '-c', 'echo "$HOME"'];
  const written = spawnSync(process.execPath, [staged.script, 'write', '--runner', '--', ...command], { encoding: 'utf8', env: staged.env });
  assert.equal(written.status, 0, written.stderr);
  const project = named(staged);
  const file = readFileSync(path.join(directoryOf(project), 'compose.yaml'), 'utf8');
  assert.equal(file, composed(project[4], command));
  assert.match(file, /"echo \\"\$\$HOME\\""/);
});

// bay runs the declared healthcheck of a server before it returns from up and before a job starts. Each check runs the
// program of its server over TCP: the temporary server of the initialization of each image listens on its socket alone, so
// a check over the socket would pass before the accounts exist. The start period declares that initialization, whose
// failures bay does not count, and the retries are the failures that count after it.
test('each server declares a health check that asks it over TCP in the container, with a start period for the initialization of its image', async t => {
  const staged = stage(t);
  await script(staged, RUN);
  const file = staged.composed();
  assert.ok(file !== undefined, 'bay job add did not run');
  assert.deepEqual(file.match(/^ {6}test: .*$/gm), [
    '      test: ["CMD", "pg_isready", "--host=127.0.0.1", "--port=5432", "--username=fsm", "--dbname=fsm_test"]',
    '      test: ["CMD", "mysqladmin", "ping", "--protocol=tcp", "--host=127.0.0.1", "--port=3306"]',
  ]);
  assert.equal(file.match(/^ {4}healthcheck:$/gm)?.length, 2);
  for (const declared of ['      start_period: "300s"', '      interval: "1s"', '      timeout: "5s"', '      retries: 3']) {
    assert.equal(file.split('\n').filter(line => line === declared).length, 2, `each server does not declare ${declared.trim()}`);
  }
  assert.doesNotMatch(file, /--socket|--protocol=socket|disable:/);
});

test('an image that the store of bay lacks fails the run before a job is queued and names the step that pulls', async t => {
  const staged = stage(t, { absent: true });
  const ended = await script(staged, RUN);
  assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
  const project = named(staged);
  assert.ok(ended.stderr.includes(`persist-servers: an image of the project ${project[4]} is not installed: run make persist-images, or sh ${directoryOf(project)}/run.sh pull\n`), ended.stderr);
  assert.deepEqual(staged.calls(), jobbed(project, 'images'));
  assert.deepEqual(staged.left(), []);
});

test('a service that the JSON of bay plan does not hold fails the writing, and no directory stays', async t => {
  const staged = stage(t, { unlisted: true });
  const ended = await script(staged, RUN);
  assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
  const project = named(staged);
  assert.ok(ended.stderr.includes(`\npersist-servers: bay plan --json names no host and port of the service postgres:\n{"schemaVersion":1,"project":"${project[4]}","services":[]}\n`), ended.stderr);
  assert.deepEqual(staged.calls(), [WRITTEN, [...project, 'plan', '--json']]);
  assert.deepEqual(staged.left(), []);
});

// A bay that does not read x-bay.job would run a job as a service that bay up starts, so the writing asks bay how it reads
// each file.
test('a bay whose plan does not name a part as a job fails the writing, and no directory stays', async t => {
  const staged = stage(t, { unjobbed: true });
  const ended = await script(staged, RUN);
  assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
  const project = named(staged);
  assert.match(ended.stderr, new RegExp(`^persist-servers: bay plan --json names the service check of the project ${project[4]} as no job, so this bay does not run jobs:$`, 'm'));
  assert.deepEqual(staged.calls(), jobbed(project, 'plans').slice(0, 3));
  assert.deepEqual(staged.left(), []);
});

// The files of a run are written for one schema of the contract of bay; the release of bay is not compared.
test('a bay whose contract is another schema fails the writing before anything is made', async t => {
  const staged = stage(t, { other: true });
  const ended = await script(staged, RUN);
  assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
  assert.equal(ended.stderr, 'persist-servers: bay version: {"version":"v7.8.9-build","schemaVersion":2}\nscripts/bay.mts: the contract of bay is the schema 2, and the scripts of this repository read the schema 1\n');
  assert.deepEqual(staged.calls(), [WRITTEN]);
  assert.deepEqual(staged.git(), []);
  assert.deepEqual(staged.left(), []);
});

// The one who starts a run on a machine says how bay is started there: every command of bay runs through the words of BAY.
test('every command of bay runs through the words of the variable BAY', async t => {
  const staged = stage(t, { started: 'sudo -n bay' });
  const ended = await script(staged, RUN);
  assert.deepEqual([ended.code, ended.signal], [0, null], ended.stderr);
  const calls = staged.calls();
  assert.deepEqual(calls, jobbed(named(staged), 'check'));
  assert.deepEqual(staged.sudo(), calls.map(call => ['sudo', '-n', ...call]));
});

test('a bay that PATH does not hold fails every verb at once, with its name and what installs it', async t => {
  for (const args of [RUN, ['run', '--', ...COMMAND], ['write', '--', ...COMMAND], ['pull']]) {
    const staged = stage(t, { bay: false });
    const ended = await script(staged, args);
    assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
    assert.equal(ended.stderr, 'scripts/bay.mts: bay is not found on PATH: install bay and apply its machine setup with bay install\n');
    assert.deepEqual(staged.left(), []);
  }
});

// The stand-in waits on a pipe that nothing writes, so only the signal that run.sh sends to bay job logs ends it; the job
// that has not ended is then cancelled, so no container of the run outlives it, and the job check is not queued.
for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130]] as const) {
  test(`${signal} while the job build runs ends bay job logs and cancels the job`, async t => {
    const staged = stage(t, { logsWaits: true });
    const ended = await script(staged, RUN, (line, stream, kill) => { if (stream === 'stderr' && line === `${RUNNING} ${JOBS.build}`) kill(signal); });
    assert.deepEqual([ended.code, ended.signal], [code, null], ended.stderr);
    const project = named(staged);
    const build = building(project);
    assert.deepEqual(staged.calls(), [...jobbed(project, 'add'), part(project, 'build')[1], [...build, 'job', 'cancel', JOBS.build], [...build, 'job', 'wait', '-timeout', '24h', JOBS.build]]);
    assert.deepEqual(staged.left(), []);
  });
}

// pull is the only verb that downloads an image: the step pull of run.sh is bay pull.
test('pull writes a directory, runs bay pull on it and removes it', async t => {
  const staged = stage(t);
  const ended = await script(staged, ['pull']);
  assert.deepEqual([ended.code, ended.signal], [0, null], ended.stderr);
  const project = named(staged);
  assert.deepEqual(staged.calls(), [...jobbed(project, 'plans'), VERSIONED, [...project, 'pull']]);
  assert.match(ended.stderr, /^pulled 3 images$/m);
  assert.equal(ended.stdout, '');
  assert.deepEqual(staged.left(), []);
});

test('a run or a writing without a command and a verb that the script does not know fail with the usage', async t => {
  for (const args of [[], ['run'], ['run', '--'], ['run', 'make'], ['run', '--runner'], ['run', '--runner', '--'], ['write'], ['write', '--'], ['write', '--runner', 'make'], ['start'], ['pull', 'postgres'], ['pull', '--runner']]) {
    const staged = stage(t);
    const ended = await script(staged, args);
    assert.equal(ended.code, 2, args.join(' '));
    assert.match(ended.stderr, /^usage: scripts\/persist-servers\.mts run \[--runner\] -- <command> \[argument\.\.\.\] \| write \[--runner\] -- <command> \[argument\.\.\.\] \| pull$/m);
    assert.deepEqual(staged.calls(), []);
    assert.deepEqual(staged.left(), []);
  }
});
