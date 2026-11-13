// The run of scripts/persist-servers.mts (docs/plans/fsm-v1/plan.md, C-6; docs/plans/fsm-v1/checklist.md, S-472-1, S-475): it
// writes the Compose project of the PostgreSQL and the MySQL server into a temporary directory of its own, starts it with bay
// up, whose return is the ready event because each service declares its health, reads the address of each service from the JSON of `bay status --json`, runs its
// command with the four FSM_TEST_* variables of those addresses, and runs bay down and removes the
// directory when the command ends, fails or the run gets SIGINT or SIGTERM. The test runs the script with stand-ins that it
// writes into a directory of its own, the only programs of PATH: a uname that names the platform, a bay that records its
// commands and the Compose file that it was started with, and the container program of the platform, which records its
// commands, so it needs neither bay nor a container runtime. That directory is the temporary directory of the script too, so
// the test reads what a run left. A stand-in waits on a named pipe, never on time.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { standIns } from '../support/stand-ins.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts/persist-servers.mts');

type Kind = 'postgres' | 'mysql';
const KINDS: readonly Kind[] = ['postgres', 'mysql'];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The reference of the image of `kind` in config/containers.json. */
function reference(kind: Kind): string {
  let found: unknown = JSON.parse(readFileSync(path.join(ROOT, 'config/containers.json'), 'utf8'));
  for (const key of ['images', kind, 'reference']) found = isRecord(found) ? found[key] : undefined;
  assert.ok(typeof found === 'string', `config/containers.json names no reference of ${kind}`);
  return found;
}

/** The Compose file of the run whose project is `project`. */
function compose(project: string): string {
  return `name: "${project}"
services:
  postgres:
    image: "${reference('postgres')}"
    expose: ["5432"]
    environment:
      POSTGRES_USER: "fsm"
      POSTGRES_PASSWORD: "fsm"
      POSTGRES_DB: "fsm_test"
    healthcheck:
      test: ["CMD", "pg_isready", "--host=127.0.0.1", "--port=5432", "--username=fsm", "--dbname=fsm_test"]
      interval: "3s"
      timeout: "5s"
      retries: 100
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
      interval: "3s"
      timeout: "5s"
      retries: 100
`;
}

// The lines that the stand-in bay prints: of up before the services accept connections and after, of a failing up, of a
// failing check, of an up that refuses the Compose file, of a command for a project that is not registered, and of the logs
// of each service.
const STARTING = 'starting 2 services';
const ACCEPTING = 'all services accept connections';
const STOPPED = 'bay: the service mysql stopped before it accepted connections';
const MISSING = 'missing  the resolver of the domain test';
const REFUSED = 'bay: compose.yaml: service postgres: the image is no reference';
const UNREGISTERED = 'bay: no project is registered for this directory';
const LOGS: Record<Kind, string[]> = {
  postgres: ['LOG:  starting PostgreSQL 17.11', 'LOG:  database system is ready to accept connections'],
  mysql: ['[ERROR] [MY-010119] [Server] Aborting', '[System] [MY-010910] [Server] /usr/sbin/mysqld: Shutdown complete'],
};

/** What the stand-ins of a case do. */
interface Stand {
  /** The container program that PATH holds; none when it is undefined. */
  engine?: string;
  /** Whether PATH holds bay. */
  bay?: boolean;
  /** The container program fails the commands of an image: no image is installed. */
  absent?: boolean;
  /** bay check fails: a part of the machine setup is missing. */
  unset?: boolean;
  /** bay up fails after its first line. */
  upFails?: boolean;
  /** bay up waits behind a gate after its first line. */
  gated?: boolean;
  /** bay down fails. */
  downFails?: boolean;
  /** The JSON of bay holds no group of the project of the run. */
  unlisted?: boolean;
  /** bay up refuses the Compose file before it registers the project. */
  refuses?: boolean;
  /** bay down fails after it removed the project, so bay lists it no more. */
  downForgets?: boolean;
}

/** The directory of the stand-ins of one run and what the test reads from it. */
interface Stage {
  directory: string;
  env: NodeJS.ProcessEnv;
  /** The commands that bay and the container program received, each as the name of its program and its words. */
  calls: () => string[][];
  /** The names of the directories in which bay ran `verb`, one for each command. */
  where: (verb: string) => string[];
  /** The Compose file of the directory in which bay up ran, or undefined when it did not run. */
  composed: () => string | undefined;
  /** The directories of runs that the temporary directory holds. */
  left: () => string[];
  /** Lets the gated bay up go on. */
  open: () => void;
}

/** Writes the stand-ins of the platform `system`: uname, bay and the container program, as `stand` says. */
function stage(t: TestContext, system: string, stand: Stand = {}): Stage {
  const { directory, path: PATH, program: write } = standIns(t, system);
  for (const flag of ['absent', 'unset', 'upFails', 'downFails', 'unlisted', 'refuses', 'downForgets'] as const) {
    if (stand[flag] === true) writeFileSync(path.join(directory, flag), '');
  }
  if (stand.gated === true) execFileSync('mkfifo', [path.join(directory, 'gate')]);
  for (const kind of KINDS) writeFileSync(path.join(directory, `logs-${kind}`), LOGS[kind].map(line => `${line}\n`).join(''));
  // Each command is one line of the file calls, the name of its program and its words joined by a tab.
  const record = `d='${directory}'
line=$(basename "$0")
for word in "$@"; do line="$line\t$word"; done
printf '%s\\n' "$line" >> "$d/calls"
`;
  if (stand.engine !== undefined) write(stand.engine, `${record}case "$1" in image) [ ! -e "$d/absent" ] ;; esac\n`);
  // bay records the name of the directory of each command: up and down read the Compose file of that directory, and fail
  // with the code 9 without it. up copies the file, so the test reads what the project was started with. The JSON of its
  // projects holds the group of another project first, and the address of a service is a name that no rule builds from the
  // project and the service, so a DSN holds it only when the run read it. As bay does, up refuses a file whose healthcheck
  // declares a count of retries outside 1..100, and registers the project only when it accepted the file: the JSON holds the
  // group of a registered project alone, and logs and down fail for a project that is not registered.
  if (stand.bay !== false) {
    write('bay', `${record}printf '%s\\t%s\\n' "$1" "$(basename "$(pwd)")" >> "$d/where"
case "$1" in
check)
	if [ -e "$d/unset" ]; then echo '${MISSING}'; exit 1; fi
	echo 'ok       certificate authority'
	;;
up)
	cp compose.yaml "$d/composed" || exit 9
	awk '/^  [a-z]+:$/ { service = substr($1, 1, length($1) - 1) } /^      retries: / { if ($2 < 1 || $2 > 100) { print "bay: compose.yaml: service " service ": healthcheck retries must be 1..100"; refused = 1 } } END { exit refused }' compose.yaml >&2 || exit 1
	if [ -e "$d/refuses" ]; then echo '${REFUSED}' >&2; exit 1; fi
	: > "$d/registered"
	echo '${STARTING}'
	if [ -p "$d/gate" ]; then read -r _ < "$d/gate"; fi
	if [ -e "$d/upFails" ]; then echo '${STOPPED}' >&2; exit 1; fi
	echo '${ACCEPTING}'
	;;
logs)
	[ -e "$d/registered" ] || { echo '${UNREGISTERED}' >&2; exit 1; }
	cat "$d/logs-$4"
	;;
status)
	project=$(basename "$(pwd)")
	if [ -e "$d/unlisted" ] || [ ! -e "$d/registered" ]; then project=another; fi
	printf '{"groups":[{"name":"other","services":[{"name":"postgres","address":"other.example"}]},{"name":"%s","services":[{"name":"mysql","address":"m.%s.example"},{"name":"postgres","address":"p.%s.example"}]}]}\\n' "$project" "$project" "$project"
	;;
down)
	[ -e compose.yaml ] || exit 9
	[ -e "$d/registered" ] || { echo '${UNREGISTERED}' >&2; exit 1; }
	if [ -e "$d/downFails" ]; then echo 'bay: the runtime did not answer' >&2; exit 1; fi
	rm "$d/registered"
	if [ -e "$d/downForgets" ]; then echo 'bay: the proxy did not answer' >&2; exit 1; fi
	echo 'removed 2 services'
	;;
esac
`);
  }
  const lines = (name: string): string[][] => {
    const file = path.join(directory, name);
    return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(line => line !== '').map(line => line.split('\t')) : [];
  };
  return {
    directory,
    env: { PATH, TMPDIR: directory },
    calls: () => lines('calls'),
    where: verb => lines('where').filter(line => line[0] === verb).map(line => line[1] ?? ''),
    composed: () => (existsSync(path.join(directory, 'composed')) ? readFileSync(path.join(directory, 'composed'), 'utf8') : undefined),
    left: () => readdirSync(directory).filter(name => name.startsWith('fsm-persist-')),
    open: () => { writeFileSync(path.join(directory, 'gate'), 'open\n'); },
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
 * Runs the script with `args` in the environment of `staged`. `seen` receives each line of its output with the stream that
 * held it and a function that sends a signal to the script, so a test acts on an event of the run.
 */
function script(staged: Stage, args: string[], seen: (line: string, stream: 'stdout' | 'stderr', kill: (signal: NodeJS.Signals) => void) => void = () => undefined): Promise<Ended> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { env: staged.env, stdio: ['ignore', 'pipe', 'pipe'] });
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

/** The command of a run that writes the four variables of the servers into `file`, one a line, and exits with `code`. */
function writes(file: string, code = 0): string[] {
  return ['run', '--', '/bin/sh', '-c', `printf '%s\\n' "$FSM_TEST_PG_DSN" "$FSM_TEST_PG_ADMIN_DSN" "$FSM_TEST_MYSQL_DSN" "$FSM_TEST_MYSQL_ADMIN_DSN" > '${file}'; exit ${String(code)}`];
}

/** The four variables of the servers of `project`, one a line, with the addresses that the stand-in bay reports. */
function dsns(project: string): string {
  return [
    `postgres://fsm:fsm@p.${project}.example:5432/fsm_test?sslmode=disable`,
    `postgres://fsm:fsm@p.${project}.example:5432/fsm_test?sslmode=disable`,
    `mysql://fsm:fsm@m.${project}.example:3306/fsm_test`,
    `mysql://root:root@m.${project}.example:3306/mysql`,
    '',
  ].join('\n');
}

/** The project of the run of `staged`: the name of the directory in which bay up ran; fails when it did not run once. */
function projectOf(staged: Stage): string {
  const [project, ...more] = staged.where('up');
  assert.ok(project !== undefined && more.length === 0, `bay up did not run once: ${JSON.stringify(staged.calls())}`);
  return project;
}

// The command that reads the projects of bay and their services as JSON.
const LISTING = ['bay', 'status', '--json'];

/** The commands that ask the container program `engine` whether each image is installed. */
function installed(engine: string): string[][] {
  return KINDS.map(kind => [engine, 'image', 'inspect', reference(kind)]);
}

test('on Linux the run starts the Compose project of both servers with bay up, passes their DSNs to the command, runs bay down and removes its directory', async t => {
  const staged = stage(t, 'Linux', { engine: 'docker' });
  const file = path.join(staged.directory, 'variables');
  const ended = await script(staged, writes(file));
  assert.deepEqual([ended.code, ended.signal], [0, null], ended.stderr);
  const project = projectOf(staged);
  assert.match(project, /^fsm-persist-\d+-[0-9a-f]{8}$/);
  assert.equal(staged.composed(), compose(project));
  assert.equal(readFileSync(file, 'utf8'), dsns(project));
  // bay check and the images come before the start, and bay starts and removes the servers: the container program gets no
  // other command.
  assert.deepEqual(staged.calls(), [['bay', 'check'], ...installed('docker'), ['bay', 'up'], LISTING, ['bay', 'down']]);
  assert.deepEqual(staged.where('down'), [project]);
  assert.deepEqual(staged.left(), [], 'the run left its directory');
  // The lines of bay are shown, so the log of a run holds what bay did.
  assert.match(ended.stderr, new RegExp(`^persist-servers: bay up: ${ACCEPTING}$`, 'm'));
  assert.match(ended.stderr, /^persist-servers: bay down: removed 2 services$/m);
  assert.match(ended.stderr, new RegExp(`^persist-servers: removed the project ${project}$`, 'm'));
  // The project of a second run has another name, so two runs share no project and no container.
  const again = stage(t, 'Linux', { engine: 'docker' });
  await script(again, writes(path.join(again.directory, 'variables')));
  assert.notEqual(projectOf(again), project);
});

test('on Darwin the run asks Apple container for the images and starts the same project, and its code is that of the command', async t => {
  const staged = stage(t, 'Darwin', { engine: 'container' });
  const file = path.join(staged.directory, 'variables');
  const ended = await script(staged, writes(file, 7));
  assert.deepEqual([ended.code, ended.signal], [7, null], ended.stderr);
  const project = projectOf(staged);
  assert.equal(staged.composed(), compose(project));
  assert.equal(readFileSync(file, 'utf8'), dsns(project));
  assert.deepEqual(staged.calls(), [['bay', 'check'], ...installed('container'), ['bay', 'up'], LISTING, ['bay', 'down']]);
  assert.deepEqual(staged.left(), []);
});

test('the Compose file publishes no port, mounts nothing and names each image by its digest', async t => {
  const staged = stage(t, 'Linux', { engine: 'docker' });
  await script(staged, writes(path.join(staged.directory, 'variables')));
  const composed = staged.composed();
  assert.ok(composed !== undefined, 'bay up did not run');
  assert.doesNotMatch(composed, /^\s*(?:ports|volumes|network_mode|x-bay|container_name)\s*:/m);
  assert.deepEqual(composed.match(/^ {4}expose: .*$/gm), ['    expose: ["5432"]', '    expose: ["3306"]']);
  const images = [...composed.matchAll(/^ {4}image: "(.*)"$/gm)].map(match => match[1]);
  assert.deepEqual(images, KINDS.map(reference));
  for (const kind of KINDS) assert.match(reference(kind), /^docker\.io\/library\/[a-z]+@sha256:[0-9a-f]{64}$/);
});

// bay checks the declared health of a service before it returns from up. Each check runs the program of its server over TCP:
// the temporary server of the initialization of each image listens on its socket alone, so a check over the socket would
// pass before the accounts exist.
test('each service declares a health check that asks its server over TCP in the container', async t => {
  const staged = stage(t, 'Linux', { engine: 'docker' });
  await script(staged, writes(path.join(staged.directory, 'variables')));
  const composed = staged.composed();
  assert.ok(composed !== undefined, 'bay up did not run');
  assert.deepEqual(composed.match(/^ {6}test: .*$/gm), [
    '      test: ["CMD", "pg_isready", "--host=127.0.0.1", "--port=5432", "--username=fsm", "--dbname=fsm_test"]',
    '      test: ["CMD", "mysqladmin", "ping", "--protocol=tcp", "--host=127.0.0.1", "--port=3306"]',
  ]);
  assert.equal(composed.match(/^ {4}healthcheck:$/gm)?.length, 2);
  for (const declared of ['      interval: "3s"', '      timeout: "5s"', '      retries: 100']) {
    assert.equal(composed.split('\n').filter(line => line === declared).length, 2, `each service does not declare ${declared.trim()}`);
  }
  assert.doesNotMatch(composed, /--socket|--protocol=socket|start_period|disable/);
});

test('a bay up that fails fails the run with the last lines of each service, without the command, and the project is removed', async t => {
  const staged = stage(t, 'Linux', { engine: 'docker', upFails: true });
  const file = path.join(staged.directory, 'variables');
  const ended = await script(staged, writes(file));
  assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
  const project = projectOf(staged);
  assert.match(ended.stderr, new RegExp(`^persist-servers: bay up: ${STOPPED}$`, 'm'));
  for (const kind of KINDS) {
    for (const line of LOGS[kind]) assert.ok(ended.stderr.includes(`\npersist-servers: ${kind}: ${line}\n`), `the failure does not hold the line ${line} of ${kind}:\n${ended.stderr}`);
  }
  assert.match(ended.stderr, new RegExp(`^persist-servers: bay up ended with 1 before the servers of the project ${project} accepted connections$`, 'm'));
  assert.equal(existsSync(file), false, 'the command ran with servers that were not ready');
  // The JSON of bay holds the project, so bay up made it: its services are shown and it is removed.
  assert.deepEqual(staged.calls(), [['bay', 'check'], ...installed('docker'), ['bay', 'up'], LISTING, ['bay', 'logs', '-n', '40', 'postgres'], ['bay', 'logs', '-n', '40', 'mysql'], ['bay', 'down']]);
  assert.deepEqual(staged.where('logs'), [project, project]);
  assert.deepEqual(staged.where('down'), [project]);
  assert.deepEqual(staged.left(), []);
});

// What bay up made is read from the JSON of bay, never from a line that it printed: bay registers a project when it accepts
// its Compose file. bay logs and bay down fail for a project that is not registered, so the run runs neither.
test('a bay up that refuses the Compose file made nothing: the run fails, runs no bay logs and no bay down, and removes its directory', async t => {
  const staged = stage(t, 'Linux', { engine: 'docker', refuses: true });
  const file = path.join(staged.directory, 'variables');
  const ended = await script(staged, writes(file));
  assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
  const project = projectOf(staged);
  assert.match(ended.stderr, new RegExp(`^persist-servers: bay up: ${REFUSED}$`, 'm'));
  assert.match(ended.stderr, new RegExp(`^persist-servers: bay lists no project ${project}: bay up made nothing$`, 'm'));
  assert.match(ended.stderr, new RegExp(`^persist-servers: bay up ended with 1 before the servers of the project ${project} accepted connections$`, 'm'));
  assert.equal(existsSync(file), false);
  assert.deepEqual(staged.calls(), [['bay', 'check'], ...installed('docker'), ['bay', 'up'], LISTING]);
  assert.deepEqual(staged.left(), [], 'the run kept the directory of a project that bay never made');
});

// bay accepts 1 to 100 retries of a healthcheck. The stand-in refuses another count as bay does, so a file that bay would
// refuse fails every case that starts the servers.
test('the count of retries of each healthcheck is one that bay accepts', async t => {
  const staged = stage(t, 'Linux', { engine: 'docker' });
  const ended = await script(staged, writes(path.join(staged.directory, 'variables')));
  assert.doesNotMatch(ended.stderr, /healthcheck retries must be 1\.\.100/);
  assert.deepEqual([ended.code, ended.signal], [0, null], ended.stderr);
  const counts = [...(staged.composed() ?? '').matchAll(/^ {6}retries: (\d+)$/gm)].map(match => Number(match[1]));
  assert.equal(counts.length, 2);
  for (const count of counts) assert.ok(count >= 1 && count <= 100, `bay refuses ${String(count)} retries`);
});

test('a bay down that fails after bay removed the project fails the run, which removes its directory', async t => {
  const staged = stage(t, 'Linux', { engine: 'docker', downForgets: true });
  const ended = await script(staged, writes(path.join(staged.directory, 'variables')));
  assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
  const project = projectOf(staged);
  assert.match(ended.stderr, new RegExp(`^persist-servers: bay down ended with 1; bay lists no project ${project}, so no container of the run exists: removed the directory of the run$`, 'm'));
  assert.deepEqual(staged.calls().slice(-2), [['bay', 'down'], LISTING]);
  assert.deepEqual(staged.left(), []);
});

test('a project that the JSON of bay does not hold fails the run without the command, and the project is removed', async t => {
  const staged = stage(t, 'Linux', { engine: 'docker', unlisted: true });
  const file = path.join(staged.directory, 'variables');
  const ended = await script(staged, writes(file));
  assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
  const project = projectOf(staged);
  assert.match(ended.stderr, new RegExp(`^persist-servers: bay status --json names no address of the service postgres of the project ${project}:$`, 'm'));
  assert.equal(existsSync(file), false, 'the command ran without the address of a server');
  assert.deepEqual(staged.calls(), [['bay', 'check'], ...installed('docker'), ['bay', 'up'], LISTING, ['bay', 'down']]);
  assert.deepEqual(staged.left(), []);
});

test('an image that is not installed fails the run before a server starts and names make persist-images', async t => {
  const staged = stage(t, 'Linux', { engine: 'docker', absent: true });
  const ended = await script(staged, writes(path.join(staged.directory, 'variables')));
  assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
  assert.match(ended.stderr, new RegExp(`^persist-servers: the image ${reference('postgres').replaceAll('.', '\\.')} of postgres is not installed: run make persist-images$`, 'm'));
  assert.deepEqual(staged.calls(), [['bay', 'check'], ['docker', 'image', 'inspect', reference('postgres')]]);
  assert.deepEqual(staged.left(), [], 'the run made a directory before it knew its images');
});

test('a program that PATH does not hold fails the run at once, with its name and what installs it', async t => {
  for (const [system, program, install] of [['Linux', 'docker', 'Docker Engine'], ['Darwin', 'container', 'Apple container']] as const) {
    const staged = stage(t, system);
    const file = path.join(staged.directory, 'variables');
    const ended = await script(staged, writes(file));
    assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
    assert.match(ended.stderr, new RegExp(`^scripts/container\\.mts: ${program} is not found on PATH: install ${install} `));
    assert.equal(existsSync(file), false);
    assert.deepEqual(staged.calls(), []);
  }
  const staged = stage(t, 'Linux', { engine: 'docker', bay: false });
  const file = path.join(staged.directory, 'variables');
  const ended = await script(staged, writes(file));
  assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
  assert.equal(ended.stderr, 'persist-servers: bay is not found on PATH: install bay and apply its machine setup with bay install\n');
  assert.equal(existsSync(file), false);
  assert.deepEqual(staged.calls(), []);
});

test('a bay check that fails fails the run with its output before an image is asked for', async t => {
  const staged = stage(t, 'Linux', { engine: 'docker', unset: true });
  const file = path.join(staged.directory, 'variables');
  const ended = await script(staged, writes(file));
  assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
  assert.match(ended.stderr, new RegExp(`^persist-servers: bay check: ${MISSING}$`, 'm'));
  assert.match(ended.stderr, /^persist-servers: bay check ended with 1: a part of the machine setup of bay is missing: run bay install$/m);
  assert.equal(existsSync(file), false);
  assert.deepEqual(staged.calls(), [['bay', 'check']]);
  assert.deepEqual(staged.left(), []);
});

test('a bay down that fails fails the run, which keeps its directory and names it with the project', async t => {
  const staged = stage(t, 'Linux', { engine: 'docker', downFails: true });
  const ended = await script(staged, writes(path.join(staged.directory, 'variables')));
  assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
  const project = projectOf(staged);
  assert.match(ended.stderr, /^persist-servers: bay down: bay: the runtime did not answer$/m);
  const directory = path.join(staged.directory, project);
  assert.ok(ended.stderr.includes(`\npersist-servers: bay down ended with 1; the containers of the project ${project} may still run: run bay down in ${directory}\n`), ended.stderr);
  assert.deepEqual(staged.left(), [project]);
  assert.equal(readFileSync(path.join(directory, 'compose.yaml'), 'utf8'), compose(project));
});

for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130]] as const) {
  test(`${signal} while the command runs reaches the command, and the project is removed`, async t => {
    const staged = stage(t, 'Linux', { engine: 'docker' });
    execFileSync('mkfifo', [path.join(staged.directory, 'never')]);
    // The command writes a line when it runs and then waits on a pipe that nothing writes, so only the signal ends it.
    const command = ['run', '--', '/bin/sh', '-c', `echo started; read -r _ < '${path.join(staged.directory, 'never')}'`];
    const ended = await script(staged, command, (line, stream, kill) => { if (stream === 'stdout' && line === 'started') kill(signal); });
    assert.deepEqual([ended.code, ended.signal], [code, null], ended.stderr);
    assert.deepEqual(staged.where('down'), [projectOf(staged)]);
    assert.deepEqual(staged.left(), []);
  });

  test(`${signal} while the servers start ends the run once bay up has ended, without the command, and the project is removed`, async t => {
    const staged = stage(t, 'Linux', { engine: 'docker', gated: true });
    const file = path.join(staged.directory, 'variables');
    const ended = await script(staged, writes(file), (line, stream, kill) => {
      // The signal is sent when the run shows the first line of bay up, and bay up goes on when the run shows that it
      // received the signal.
      if (stream === 'stderr' && line === `persist-servers: bay up: ${STARTING}`) kill(signal);
      if (stream === 'stderr' && line.startsWith(`persist-servers: received ${signal}`)) staged.open();
    });
    assert.deepEqual([ended.code, ended.signal], [code, null], ended.stderr);
    assert.equal(existsSync(file), false, 'the command ran after the signal');
    assert.match(ended.stderr, new RegExp(`^persist-servers: bay up: ${ACCEPTING}$`, 'm'));
    assert.deepEqual(staged.where('down'), [projectOf(staged)]);
    assert.deepEqual(staged.left(), []);
  });
}

// pull is the only command that downloads, and it needs no bay: bay has no command that pulls an image and starts nothing.
test('pull pulls each pinned image with the container program of the platform', async t => {
  const staged = stage(t, 'Darwin', { engine: 'container', bay: false });
  const ended = await script(staged, ['pull']);
  assert.deepEqual([ended.code, ended.signal], [0, null], ended.stderr);
  assert.deepEqual(staged.calls(), [['container', 'image', 'pull', reference('postgres')], ['container', 'image', 'pull', reference('mysql')]]);
});

test('a run without a command and a verb that the script does not know fail with the usage', async t => {
  for (const args of [[], ['run'], ['run', '--'], ['run', 'make'], ['start'], ['pull', 'postgres']]) {
    const staged = stage(t, 'Linux', { engine: 'docker' });
    const ended = await script(staged, args);
    assert.equal(ended.code, 2, args.join(' '));
    assert.match(ended.stderr, /^usage: scripts\/persist-servers\.mts run -- <command> \[argument\.\.\.\] \| pull$/m);
    assert.deepEqual(staged.calls(), []);
  }
});
