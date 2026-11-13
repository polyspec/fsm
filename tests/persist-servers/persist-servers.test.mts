// The run of scripts/persist-servers.mts (docs/plans/fsm-v1/plan.md, C-6; docs/plans/fsm-v1/checklist.md, S-472-1, S-475,
// S-475-7): the script writes the directory of a run, var/persist-servers/<project>, and its run.sh executes it: it asks
// bay for the images, starts the project with bay up -no-pull, whose return is the ready event because each server
// declares its health, runs the command with the four FSM_TEST_* variables, and removes the project with bay down, by a
// trap also after a failure and a signal. A run has two forms with these same steps. In the host form, the default, the
// servers alone are the project and the command is a process of the host. In the runner form the Compose file also holds
// the service runner, the directory also holds runner.sh and the bundle of the branch, the command runs in runner with
// bay exec, and run.sh starts no program but bay.
//
// A test copies the script and the files that it reads into a root of its own, so the directories of its runs are its own,
// and runs it with stand-ins of bay and git that it writes into another directory, the only programs of PATH beside a
// uname: it needs neither bay nor a container runtime, and a run.sh that started another program would fail. The stand-in
// bay records its commands and the Compose file that it was started with, and keeps the contract of bay that plan C-6
// states. A stand-in waits on a named pipe, never on time.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
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

// The Compose file of a run of the host form: the two servers. It holds no name, because the option -p of bay names the
// project, and no mount.
const SERVERS = `services:
  postgres:
    image: "${reference('postgres')}"
    expose: ["5432"]
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
    expose: ["3306"]
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

// The Compose file of a run of the runner form: the servers and the service runner, whose one mount is the directory of the
// run itself, by a path relative to the file. The runner keeps the trust of bay.
const RUNNER = `  runner:
    image: "${reference('runner')}"
    command: ["sleep", "infinity"]
    volumes: ["./:/persist-run:ro"]
`;
const COMPOSE = `${SERVERS}${RUNNER}`;
// The Compose file of the first phase of the runner form: the runner alone, the same text as in the file of the second
// phase, so bay keeps its container when the servers are added.
const INSTALLING = `services:\n${RUNNER}`;

// The lines that the stand-in bay prints: the JSON of its version, a release that no file of the repository names, with the
// schema of the contract that the files of a run read, the progress of up before the servers are healthy and after, the
// line of a failing up, and the line of an exec.
const VERSION = '{"version":"v7.8.9-build","schemaVersion":1}';
const STARTING = 'starting 3 services';
const HEALTHY = 'all services are healthy';
const STOPPED = 'bay: the service mysql stopped before it was healthy';
const RUNNING = 'the command runs';
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
  /** bay exec waits on a pipe that nothing writes, after its first line. */
  execWaits?: boolean;
  /** The exit code of bay exec. */
  execCode?: number;
  /** bay down fails. */
  downFails?: boolean;
  /** The JSON of bay plan holds no service. */
  unlisted?: boolean;
  /** The contract of bay is another schema than the one that the files of a run read. */
  other?: boolean;
  /** The words of the variable BAY, which start bay; the variable is not set when it is undefined. */
  started?: string;
  /** The memory that the pin of an image holds in the copied config/containers.json. */
  memory?: Partial<Record<Kind, string>>;
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
  /** The Compose file that the last bay up was started with, or undefined when it did not run. */
  composed: () => string | undefined;
  /** The Compose file of the name `name` that bay up was started with, or undefined when no bay up ran with it. */
  started: (name: string) => string | undefined;
  /** The directories of runs that the root holds. */
  left: () => string[];
}

/** Copies the script into a root of its own and writes the stand-ins: uname, git and bay, as `stand` says. */
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
      pinned.memory = memory;
    }
    writeFileSync(file, `${JSON.stringify(pins, null, 2)}\n`);
  }
  const { directory, path: PATH, program: write } = standIns(t, 'Linux');
  for (const flag of ['absent', 'upFails', 'downFails', 'unlisted', 'other'] as const) {
    if (stand[flag] === true) writeFileSync(path.join(directory, flag), '');
  }
  if (stand.upWaits === true) execFileSync('mkfifo', [path.join(directory, 'up-waits')]);
  if (stand.execWaits === true) execFileSync('mkfifo', [path.join(directory, 'exec-waits')]);
  writeFileSync(path.join(directory, 'exec-code'), `${String(stand.execCode ?? 0)}\n`);
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
  // git names the branch main and writes an empty file as its bundle.
  write('git', `${record('git', 'git-calls')}case "$1" in
symbolic-ref) echo main ;;
bundle) : > "$3" ;;
*) exit 2 ;;
esac
`);
  // The options -f and -p come before the command: every command of a project reads the Compose file that -f names, or
  // the compose.yaml of a directory that it names, and fails with the code 9 without it. A flag that fails or holds bay up
  // applies to the up of a file that holds the servers, so the first phase of the runner form passes. up copies the file, so the test reads what bay was started with.
  // As bay does, plan prints the name, the host and the port of each service as JSON, images ends with 1 when the store
  // lacks an image, and up refuses a healthcheck whose count of retries is outside 1..100. The host and the port of a
  // service are values that no rule builds from the project and the service, so a DSN holds them only when the script
  // read them. exec runs nothing: the installation and the command of a run would run in a container; the exit code and
  // the pipe of an exec are those of the command, and the installation passes.
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
# The phase of the servers: the file of the command holds them.
servers=
if [ "$1" != version ] && grep -q '^  postgres:$' "$c"; then servers=1; fi
case "$1" in
version)
	if [ -e "$d/other" ]; then echo '{"version":"v7.8.9-build","schemaVersion":2}'; else echo '${VERSION}'; fi
	;;
plan)
	if [ -e "$d/unlisted" ]; then printf '{"schemaVersion":1,"project":"%s","services":[]}\\n' "$p"; exit 0; fi
	printf '{"schemaVersion":1,"project":"%s","services":[{"name":"mysql","host":"m.%s.example","port":13306},{"name":"postgres","host":"p.%s.example","port":15432},{"name":"runner","host":"r.%s.example","port":0}]}\\n' "$p" "$p" "$p" "$p"
	;;
images)
	if [ -e "$d/absent" ]; then echo 'postgres  missing'; exit 1; fi
	echo 'postgres  present'
	;;
pull)
	echo 'pulled 3 images'
	;;
up)
	cp "$c" "$d/composed"
	cp "$c" "$d/composed-$(basename "$c")"
	awk '/^  [a-z]+:$/ { service = substr($1, 1, length($1) - 1) } /^      retries: / { if ($2 < 1 || $2 > 100) { print "bay: compose.yaml: service " service ": healthcheck retries must be 1..100"; refused = 1 } } END { exit refused }' "$c" >&2 || exit 1
	if [ -z "$servers" ]; then echo 'started the runner' >&2; exit 0; fi
	echo '${STARTING}' >&2
	if [ -n "$servers" ] && [ -p "$d/up-waits" ]; then read -r _ < "$d/up-waits"; fi
	if [ -n "$servers" ] && [ -e "$d/upFails" ]; then echo '${STOPPED}' >&2; exit 1; fi
	echo '${HEALTHY}' >&2
	;;
exec)
	shift
	while [ "$1" = -e ]; do shift 2; done
	if [ "$2" = cat ]; then
		[ "$3" = ${PEAK} ] || exit 2
		echo 4096
		exit 0
	fi
	if [ "$4" = install ]; then echo 'installed'; exit 0; fi
	echo '${RUNNING}'
	if [ -p "$d/exec-waits" ]; then read -r _ < "$d/exec-waits"; fi
	exit "$(cat "$d/exec-code")"
	;;
down)
	if [ -e "$d/downFails" ]; then echo 'bay: the runtime did not answer' >&2; exit 1; fi
	echo 'removed 3 services'
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
    composed: () => (existsSync(path.join(directory, 'composed')) ? readFileSync(path.join(directory, 'composed'), 'utf8') : undefined),
    started: name => (existsSync(path.join(directory, `composed-${name}`)) ? readFileSync(path.join(directory, `composed-${name}`), 'utf8') : undefined),
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
function script(staged: Stage, args: string[], seen: (line: string, stream: 'stdout' | 'stderr', kill: (signal: NodeJS.Signals) => void) => void = () => undefined): Promise<Ended> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [staged.script, ...args], { env: staged.env, stdio: ['ignore', 'pipe', 'pipe'] });
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

// The command of the runs of the runner form: the words that make persist-servers-write gives, one of them with spaces. The
// stand-in bay runs nothing for bay exec, so the command itself never runs.
const COMMAND = ['make', 'ci-targets', 'TARGETS=db-test-postgres db-test-mysql'];
const RUN = ['run', '--runner', '--', ...COMMAND];

/** The command of a run of the host form, which runs: it writes the four variables of the servers into `file`, one a line, and exits with `code`. */
function writes(file: string, code = 0): string[] {
  return ['/bin/sh', '-c', `printf '%s\\n' "$FSM_TEST_PG_DSN" "$FSM_TEST_PG_ADMIN_DSN" "$FSM_TEST_MYSQL_DSN" "$FSM_TEST_MYSQL_ADMIN_DSN" > '${file}'; exit ${String(code)}`];
}

/** The four variables of the servers of `project`, one a line, with the hosts and the ports that the stand-in bay plans. */
function dsns(project: string): string {
  return [
    `postgres://fsm:fsm@p.${project}.example:15432/fsm_test?sslmode=disable`,
    `postgres://fsm:fsm@p.${project}.example:15432/fsm_test?sslmode=disable`,
    `mysql://fsm:fsm@m.${project}.example:13306/fsm_test`,
    `mysql://root:root@m.${project}.example:13306/mysql`,
    '',
  ].join('\n');
}

/** The words that name the Compose file and the project of a command of bay: the program and its options -f and -p. */
type Named = [string, string, string, string, string];

/** The directory of the run of `project`, which holds its Compose files. */
function directoryOf(project: Named): string {
  return path.dirname(project[2]);
}

/** The words of `project` with the Compose file of the first phase of the runner form, which holds the runner alone. */
function installing(project: Named): Named {
  return [project[0], project[1], path.join(directoryOf(project), 'compose.install.yaml'), project[3], project[4]];
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
    assert.ok(['compose.yaml', 'compose.install.yaml'].includes(path.basename(call[2] ?? '')), `a command of bay names the file ${String(call[2])}`);
    assert.deepEqual([call[0], call[1], call[3], call[4]], ['bay', '-f', '-p', project]);
  }
  // The version of bay is that of the machine, so its two commands name no project.
  for (const call of staged.calls().filter(each => each[1] !== '-f')) assert.deepEqual(call.slice(0, 2), ['bay', 'version']);
  return ['bay', '-f', path.join(directory, 'compose.yaml'), '-p', project];
}

/** The command of bay that runs the command of a run in runner, with the DSNs of the hosts and ports that the stand-in bay plans. */
function executed(project: Named): string[] {
  const name = project[4];
  return [
    ...project, 'exec',
    '-e', `FSM_TEST_PG_DSN=postgres://fsm:fsm@p.${name}.example:15432/fsm_test?sslmode=disable`,
    '-e', `FSM_TEST_PG_ADMIN_DSN=postgres://fsm:fsm@p.${name}.example:15432/fsm_test?sslmode=disable`,
    '-e', `FSM_TEST_MYSQL_DSN=mysql://fsm:fsm@m.${name}.example:13306/fsm_test`,
    '-e', `FSM_TEST_MYSQL_ADMIN_DSN=mysql://root:root@m.${name}.example:13306/mysql`,
    'runner', 'sh', '/persist-run/runner.sh', 'run', ...COMMAND,
  ];
}

// The commands of bay of the writing before its plan, and of run.sh before its first step: each reads the version of bay.
const WRITTEN = ['bay', 'version', '--json'];
const VERSIONED = ['bay', 'version', '--json'];

/**
 * The commands of bay of a run to the step `last`: the version and the plan of the writing, then the steps of run.sh and the
 * reading of the memory of each service. The command of the host form is no command of bay.
 */
function steps(project: Named, last: 'images' | 'up' | 'exec', form: 'host' | 'runner' = 'runner'): string[][] {
  // The first phase of the runner form: the runner alone starts and installs, and its memory is read, before the servers.
  const first = installing(project);
  const phase = form === 'runner' ? [[...first, 'up', '-no-pull'], [...first, 'exec', 'runner', 'sh', '/persist-run/runner.sh', 'install'], [...first, 'exec', 'runner', 'cat', PEAK]] : [];
  const all = [WRITTEN, [...project, 'plan', '--json'], VERSIONED, [...project, 'images'], ...phase, [...project, 'up', '-no-pull'], ...(form === 'runner' ? [executed(project)] : [])];
  // Once bay up was started, the memory of each service is read before the project is removed.
  const services = form === 'runner' ? ['postgres', 'mysql', 'runner'] : ['postgres', 'mysql'];
  const ending = [...services.map(service => [...project, 'exec', service, 'cat', PEAK]), [...project, 'down']];
  return [...all.slice(0, { images: 4, up: 5 + phase.length, exec: 6 + phase.length }[last]), ...(last === 'images' ? [] : ending)];
}

// ---- The host form, the default --------------------------------------------------------------------------------------

test('a run of the host form starts the servers alone, runs the command on the host with the DSNs that bay plans, runs bay down and removes its directory', async t => {
  const staged = stage(t);
  const file = path.join(staged.root, 'variables');
  const ended = await script(staged, ['run', '--', ...writes(file)]);
  assert.deepEqual([ended.code, ended.signal], [0, null], ended.stderr);
  const project = named(staged);
  assert.equal(staged.composed(), SERVERS);
  assert.equal(readFileSync(file, 'utf8'), dsns(project[4]));
  // The command is a process of the host: bay gets no exec, and no bundle is made.
  assert.deepEqual(staged.calls(), steps(project, 'exec', 'host'));
  assert.deepEqual(staged.git(), []);
  assert.deepEqual(staged.left(), []);
  assert.ok(ended.stdout.startsWith(`${VERSION}\n`), ended.stdout);
  assert.match(ended.stderr, new RegExp(`^persist-servers: removed the project ${project[4]}$`, 'm'));
  // The lines of the report are shown, because run removes the directory that holds the file.
  for (const line of ['up exit 0', 'command exit 0', 'memory.peak postgres 4096', 'memory.peak mysql 4096', 'run exit 0']) assert.ok(ended.stderr.includes(`persist-servers: ${TIME} ${line}\n`), `the run does not show ${line}:\n${ended.stderr}`);
});

test('the code of a run of the host form is that of the command, and a failed bay up runs no command', async t => {
  const staged = stage(t);
  const ended = await script(staged, ['run', '--', ...writes(path.join(staged.root, 'variables'), 7)]);
  assert.deepEqual([ended.code, ended.signal], [7, null], ended.stderr);
  assert.deepEqual(staged.calls(), steps(named(staged), 'exec', 'host'));
  assert.deepEqual(staged.left(), []);
  const failing = stage(t, { upFails: true });
  const file = path.join(failing.root, 'variables');
  const failed = await script(failing, ['run', '--', ...writes(file)]);
  assert.deepEqual([failed.code, failed.signal], [1, null], failed.stderr);
  assert.equal(existsSync(file), false, 'the command ran with servers that were not ready');
  assert.deepEqual(failing.calls(), steps(named(failing), 'up', 'host'));
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
  assert.deepEqual(staged.calls(), steps(project, 'exec', 'host'));
});

for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130]] as const) {
  test(`${signal} while the command of the host form runs ends the command, and the project is removed`, async t => {
    const staged = stage(t);
    execFileSync('mkfifo', [path.join(staged.root, 'never')]);
    // The command writes a line when it runs and then waits on a pipe that nothing writes, so only the signal ends it.
    const command = ['run', '--', '/bin/sh', '-c', `echo started; read -r _ < '${path.join(staged.root, 'never')}'`];
    const ended = await script(staged, command, (line, stream, kill) => { if (stream === 'stdout' && line === 'started') kill(signal); });
    assert.deepEqual([ended.code, ended.signal], [code, null], ended.stderr);
    assert.deepEqual(staged.calls(), steps(named(staged), 'exec', 'host'));
    assert.deepEqual(staged.left(), []);
  });
}

// A limit of memory is a value of the pin of an image; a pin without one gives a service without a limit.
test('the memory of a pin is the mem_limit of its service in the Compose file', async t => {
  const staged = stage(t, { memory: { mysql: '768m' } });
  const ended = await script(staged, ['run', '--', '/bin/sh', '-c', 'exit 0']);
  assert.deepEqual([ended.code, ended.signal], [0, null], ended.stderr);
  const image = `    image: "${reference('mysql')}"\n`;
  assert.equal(staged.composed(), SERVERS.replace(image, `${image}    mem_limit: "768m"\n`));
  assert.doesNotMatch(SERVERS, /mem_limit/);
});

// ---- The runner form ---------------------------------------------------------------------------------------------------

test('a run of the runner form writes its directory, starts the project with bay up, runs the command in runner with the hosts and ports that bay plans, runs bay down and removes its directory', async t => {
  const staged = stage(t);
  const ended = await script(staged, RUN);
  assert.deepEqual([ended.code, ended.signal], [0, null], ended.stderr);
  const project = named(staged);
  assert.match(project[4], /^fsm-persist-\d+-[0-9a-f]{8}$/);
  assert.equal(staged.composed(), COMPOSE);
  // The steps of run.sh in their order, each a command of bay: no check of the machine setup, no log and no other program.
  assert.deepEqual(staged.calls(), steps(project, 'exec'));
  // The bundle is that of the branch of the checkout.
  assert.deepEqual(staged.git(), [['git', 'symbolic-ref', '--short', 'HEAD'], ['git', 'bundle', 'create', path.join(directoryOf(project), 'tree.bundle'), 'main']]);
  assert.deepEqual(staged.left(), [], 'the run left its directory');
  // The record of a run names the bay that made its result, and holds what bay and the command printed.
  assert.ok(ended.stderr.startsWith(`persist-servers: bay version: ${VERSION}\n`), ended.stderr);
  assert.ok(ended.stdout.startsWith(`${VERSION}\n`), ended.stdout);
  assert.match(ended.stdout, new RegExp(`^${RUNNING}$`, 'm'));
  assert.match(ended.stderr, new RegExp(`^${HEALTHY}$`, 'm'));
  assert.match(ended.stderr, new RegExp(`^persist-servers: removed the project ${project[4]}$`, 'm'));
  // The project of a second run has another name, so two runs share no directory, no project and no container.
  const again = stage(t);
  await script(again, RUN);
  assert.notEqual(named(again)[4], project[4]);
});

test('the code of the run is that of the command in runner, and the project is removed', async t => {
  const staged = stage(t, { execCode: 7 });
  const ended = await script(staged, RUN);
  assert.deepEqual([ended.code, ended.signal], [7, null], ended.stderr);
  assert.deepEqual(staged.calls(), steps(named(staged), 'exec'));
  assert.deepEqual(staged.left(), []);
});

// write is the verb for a run on another machine: the directory is all that is moved there, and sh with bay runs it.
test('write of the runner form writes the directory of a run and prints it, and sh run.sh executes it with bay alone', t => {
  const staged = stage(t);
  const written = spawnSync(process.execPath, [staged.script, 'write', '--runner', '--', ...COMMAND], { encoding: 'utf8', env: staged.env });
  assert.equal(written.status, 0, written.stderr);
  const project = named(staged);
  assert.equal(written.stdout, `${directoryOf(project)}\n`);
  assert.deepEqual(staged.calls(), [WRITTEN, [...project, 'plan', '--json']]);
  assert.deepEqual(readdirSync(directoryOf(project)).sort(), ['compose.install.yaml', 'compose.yaml', 'run.sh', 'runner.sh', 'tree.bundle']);
  assert.equal(readFileSync(path.join(directoryOf(project), 'compose.yaml'), 'utf8'), COMPOSE);
  assert.equal(readFileSync(path.join(directoryOf(project), 'compose.install.yaml'), 'utf8'), INSTALLING);
  // run.sh runs from another directory, with a PATH that holds the stand-ins alone.
  const ran = spawnSync('/bin/sh', [path.join(directoryOf(project), 'run.sh')], { cwd: tmpdir(), encoding: 'utf8', env: staged.env });
  assert.equal(ran.status, 0, ran.stderr);
  assert.deepEqual(staged.calls(), steps(project, 'exec'));
  // The two phases: the runner alone, then the servers with the same runner.
  assert.equal(staged.started('compose.install.yaml'), INSTALLING);
  assert.equal(staged.started('compose.yaml'), COMPOSE);
  // The directory stays: the one who wrote it removes it.
  assert.deepEqual(staged.left(), [project[4]]);
  assert.equal(existsSync(path.join(directoryOf(project), 'down-failed')), false);
  const pulled = spawnSync('/bin/sh', [path.join(directoryOf(project), 'run.sh'), 'pull'], { cwd: tmpdir(), encoding: 'utf8', env: staged.env });
  assert.equal(pulled.status, 0, pulled.stderr);
  assert.deepEqual(staged.calls().slice(-2), [VERSIONED, [...project, 'pull']]);
  // The report of the two runs of the directory: the time of each step, and the memory of each service of the run.
  const event = (text: string): string => `${TIME} ${text}`;
  const stepped = (name: string): string[] => [event(`${name} start`), event(`${name} exit 0`)];
  assert.deepEqual(readFileSync(path.join(directoryOf(project), 'report.txt'), 'utf8').split('\n'), [
    ...stepped('version'), ...stepped('images'),
    ...stepped('runner-up'), ...stepped('install'), event('memory.peak runner 4096 after install'),
    ...stepped('up'), ...stepped('command'),
    event('memory.peak postgres 4096'), event('memory.peak mysql 4096'), event('memory.peak runner 4096'),
    ...stepped('down'), event('run exit 0'),
    ...stepped('version'), ...stepped('pull'), event('run exit 0'),
    '',
  ]);
  for (const line of [event('command exit 0'), event('memory.peak runner 4096'), event('run exit 0')]) assert.ok(ran.stderr.includes(`persist-servers: ${line}\n`), `the run does not show the line ${line} of its report:\n${ran.stderr}`);
  const unknown = spawnSync('/bin/sh', [path.join(directoryOf(project), 'run.sh'), 'start'], { cwd: tmpdir(), encoding: 'utf8', env: staged.env });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /^usage: sh run\.sh \[run\|pull\]$/m);
});

test('runner.sh has a part that installs the tools of the repository and clones the bundle of the branch, and a part that runs the command in that tree', t => {
  const staged = stage(t);
  const written = spawnSync(process.execPath, [staged.script, 'write', '--runner', '--', ...COMMAND], { encoding: 'utf8', env: staged.env });
  assert.equal(written.status, 0, written.stderr);
  const runner = readFileSync(path.join(directoryOf(named(staged)), 'runner.sh'), 'utf8');
  const packages = pin('runner', 'packages');
  assert.ok(Array.isArray(packages) && packages.length > 0 && packages.every(each => typeof each === 'string'), 'config/containers.json names no packages of the runner');
  const node = /^node = "(\d+\.\d+\.\d+)"$/m.exec(readFileSync(path.join(ROOT, 'mise.toml'), 'utf8'))?.[1];
  assert.ok(node !== undefined, 'mise.toml names no version of node');
  // The steps in their order: a later step needs what an earlier one installed.
  const order = [
    'set -eu',
    'case "$1" in',
    'install)',
    `apt-get install -y -q ${packages.join(' ')}`,
    `https://nodejs.org/dist/v${node}/node-v${node}-linux-$arch.tar.xz`,
    'https://sh.rustup.rs',
    'git clone -q -b main /persist-run/tree.bundle "$work/tree"',
    'make bootstrap',
    'make install',
    'run)',
    'cd "$work/tree"',
    'exec "$@"',
  ];
  let from = 0;
  for (const text of order) {
    const at = runner.indexOf(text, from);
    assert.ok(at >= 0, `runner.sh does not hold ${text} after the step before it:\n${runner}`);
    from = at + text.length;
  }
  // Nothing of the runner is written into the directory of the run, which is mounted read-only.
  assert.doesNotMatch(runner, /> ?\/persist-run|-C \/persist-run/);
});

test('the Compose file of the runner form names no project, publishes no port, mounts the directory of the run alone, keeps the trust of bay and names each image by its digest', async t => {
  const staged = stage(t);
  await script(staged, RUN);
  const composed = staged.composed();
  assert.ok(composed !== undefined, 'bay up did not run');
  assert.doesNotMatch(composed, /^\s*(?:name|ports|tmpfs|network_mode|container_name|x-bay)\s*:/m);
  assert.deepEqual(composed.match(/^ {4}expose: .*$/gm), ['    expose: ["5432"]', '    expose: ["3306"]']);
  assert.deepEqual(composed.match(/^ *volumes: .*$/gm), ['    volumes: ["./:/persist-run:ro"]']);
  const images = [...composed.matchAll(/^ {4}image: "(.*)"$/gm)].map(match => match[1]);
  assert.deepEqual(images, [reference('postgres'), reference('mysql'), reference('runner')]);
  for (const image of images) assert.match(image ?? '', /^docker\.io\/library\/[a-z]+@sha256:[0-9a-f]{64}$/);
});

// bay runs the declared healthcheck of a server before it returns from up. Each check runs the program of its server over
// TCP: the temporary server of the initialization of each image listens on its socket alone, so a check over the socket
// would pass before the accounts exist. The start period declares that initialization, whose failures bay does not count,
// and the retries are the failures that count after it.
test('each server declares a health check that asks it over TCP in the container, with a start period for the initialization of its image', async t => {
  const staged = stage(t);
  await script(staged, RUN);
  const composed = staged.composed();
  assert.ok(composed !== undefined, 'bay up did not run');
  assert.deepEqual(composed.match(/^ {6}test: .*$/gm), [
    '      test: ["CMD", "pg_isready", "--host=127.0.0.1", "--port=5432", "--username=fsm", "--dbname=fsm_test"]',
    '      test: ["CMD", "mysqladmin", "ping", "--protocol=tcp", "--host=127.0.0.1", "--port=3306"]',
  ]);
  assert.equal(composed.match(/^ {4}healthcheck:$/gm)?.length, 2);
  for (const declared of ['      start_period: "300s"', '      interval: "1s"', '      timeout: "5s"', '      retries: 3']) {
    assert.equal(composed.split('\n').filter(line => line === declared).length, 2, `each server does not declare ${declared.trim()}`);
  }
  assert.doesNotMatch(composed, /--socket|--protocol=socket|disable/);
});

test('a bay up that fails fails the run without the command, and the run runs bay down and removes its directory', async t => {
  const staged = stage(t, { upFails: true });
  const ended = await script(staged, RUN);
  assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
  const project = named(staged);
  assert.match(ended.stderr, new RegExp(`^${STOPPED}$`, 'm'));
  assert.match(ended.stderr, new RegExp(`^persist-servers: bay up failed before the servers of the project ${project[4]} were healthy$`, 'm'));
  assert.deepEqual(staged.calls(), steps(project, 'up'));
  assert.deepEqual(staged.left(), []);
});

test('an image that the store of bay lacks fails the run before a server starts and names the step that pulls', async t => {
  const staged = stage(t, { absent: true });
  const ended = await script(staged, RUN);
  assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
  const project = named(staged);
  assert.ok(ended.stderr.includes(`persist-servers: an image of the project ${project[4]} is not installed: run make persist-images, or sh ${directoryOf(project)}/run.sh pull\n`), ended.stderr);
  // Nothing was started, so no bay down runs; the directory of the run is removed.
  assert.deepEqual(staged.calls(), steps(project, 'images'));
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
  assert.deepEqual(calls, steps(named(staged), 'exec'));
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

test('a bay down that fails fails the run, which keeps its directory, marks it and shows the command that removes the project', async t => {
  const staged = stage(t, { downFails: true });
  const ended = await script(staged, RUN);
  assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
  const project = named(staged);
  assert.ok(ended.stderr.includes(`\npersist-servers: bay down failed; the containers of the project ${project[4]} may still run: run bay -f ${project[2]} -p ${project[4]} down\n`), ended.stderr);
  assert.deepEqual(staged.left(), [project[4]]);
  assert.equal(existsSync(path.join(directoryOf(project), 'down-failed')), true);
  assert.equal(readFileSync(path.join(directoryOf(project), 'compose.yaml'), 'utf8'), COMPOSE);
});

// The stand-in waits on a pipe that nothing writes, so only the signal that run.sh sends to its command of bay ends it.
for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130]] as const) {
  test(`${signal} while the command runs ends bay exec, and the project is removed`, async t => {
    const staged = stage(t, { execWaits: true });
    const ended = await script(staged, RUN, (line, stream, kill) => { if (stream === 'stdout' && line === RUNNING) kill(signal); });
    assert.deepEqual([ended.code, ended.signal], [code, null], ended.stderr);
    assert.deepEqual(staged.calls(), steps(named(staged), 'exec'));
    assert.deepEqual(staged.left(), []);
  });

  test(`${signal} while the servers start ends bay up, and the run ends without the command and removes the project`, async t => {
    const staged = stage(t, { upWaits: true });
    const ended = await script(staged, RUN, (line, stream, kill) => { if (stream === 'stderr' && line === STARTING) kill(signal); });
    assert.deepEqual([ended.code, ended.signal], [code, null], ended.stderr);
    assert.doesNotMatch(ended.stderr, new RegExp(HEALTHY));
    assert.deepEqual(staged.calls(), steps(named(staged), 'up'));
    assert.deepEqual(staged.left(), []);
  });
}

// pull is the only verb that downloads an image: the step pull of run.sh is bay pull.
test('pull writes a directory, runs bay pull on it and removes it', async t => {
  const staged = stage(t);
  const ended = await script(staged, ['pull']);
  assert.deepEqual([ended.code, ended.signal], [0, null], ended.stderr);
  const project = named(staged);
  assert.deepEqual(staged.calls(), [WRITTEN, [...project, 'plan', '--json'], VERSIONED, [...project, 'pull']]);
  assert.match(ended.stdout, /^pulled 3 images$/m);
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
