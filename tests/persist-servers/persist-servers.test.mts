// The run of scripts/persist-servers.mts (docs/plans/fsm-v1/plan.md, C-6; docs/plans/fsm-v1/checklist.md, S-472-1, S-475): it
// writes the Compose project of the PostgreSQL and the MySQL server into a temporary directory of its own, names the file and
// the project to bay by the options -f and -p, reads from bay whether the images are installed, starts the project with bay
// up -no-pull --json, whose return is the ready event because each service declares its health, reads the host and the port
// of each service from the JSON of that command, runs its command with the four FSM_TEST_* variables, and runs bay down and
// removes the directory when the command ends, fails or the run gets SIGINT or SIGTERM. The test runs the script with a
// stand-in bay that it writes into a directory of its own, the only program of PATH beside a uname, so it needs neither bay
// nor a container runtime. The stand-in records its commands and the Compose file that it was started with, and keeps the
// contract of bay that plan C-6 states. That directory is the temporary directory of the script too, so the test reads what
// a run left. A stand-in waits on a named pipe, never on time.
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

// The Compose file of a run. It holds no name: the option -p of bay names the project.
const COMPOSE = `services:
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

// The lines that the stand-in bay prints: its version, the progress of up before the services are healthy and after, and
// the line of a failing up.
const VERSION = '{"version":"v9.9.9","commit":"0123456789abcdef","modified":false,"go":"go1.27.2","platform":"test/arm64","schemaVersion":1}';
const STARTING = 'starting 2 services';
const HEALTHY = 'all services are healthy';
const STOPPED = 'bay: the service mysql stopped before it was healthy';

/** What the stand-in bay of a case does. */
interface Stand {
  /** Whether PATH holds bay. */
  bay?: boolean;
  /** The local store lacks the image of postgres. */
  absent?: boolean;
  /** bay up fails after its first line. */
  upFails?: boolean;
  /** bay up waits behind a gate after its first line. */
  gated?: boolean;
  /** bay down fails. */
  downFails?: boolean;
  /** The JSON of bay up holds no service. */
  unlisted?: boolean;
}

/** The directory of the stand-ins of one run and what the test reads from it. */
interface Stage {
  directory: string;
  env: NodeJS.ProcessEnv;
  /** The commands that bay received, each as the name of the program and its words. */
  calls: () => string[][];
  /** The Compose file that bay up was started with, or undefined when it did not run. */
  composed: () => string | undefined;
  /** The Compose file that bay pull was started with, or undefined when it did not run. */
  pulled: () => string | undefined;
  /** The directories of runs that the temporary directory holds. */
  left: () => string[];
}

/** Writes the stand-ins: uname and bay, as `stand` says. */
function stage(t: TestContext, stand: Stand = {}): Stage {
  const { directory, path: PATH, program: write } = standIns(t, 'Linux');
  for (const flag of ['absent', 'upFails', 'downFails', 'unlisted'] as const) {
    if (stand[flag] === true) writeFileSync(path.join(directory, flag), '');
  }
  if (stand.gated === true) execFileSync('mkfifo', [path.join(directory, 'gate')]);
  // What bay images --json prints: an entry for each service, in the order of their names.
  const images = (present: boolean): string => `${JSON.stringify([
    { service: 'mysql', image: reference('mysql'), present: true },
    { service: 'postgres', image: reference('postgres'), present },
  ])}\n`;
  writeFileSync(path.join(directory, 'images-present'), images(true));
  writeFileSync(path.join(directory, 'images-absent'), images(false));
  // Each command is one line of the file calls, the name of the program and its words joined by a tab. The options -f and
  // -p come before the command: every command of a project reads the Compose file of the directory that -f names, and
  // fails with the code 9 without it. up and pull copy the file, so the test reads what bay was started with. As bay does,
  // up refuses a file whose healthcheck declares a count of retries outside 1..100, writes its progress to standard error
  // and its JSON to standard output, and images ends with 1 when the store lacks an image. The host and the port of a
  // service in the JSON are values that no rule builds from the project and the service, so a DSN holds them only when
  // the run read them.
  if (stand.bay !== false) {
    write('bay', `d='${directory}'
line=bay
for word in "$@"; do line="$line\t$word"; done
printf '%s\\n' "$line" >> "$d/calls"
f=
p=
while [ $# -gt 0 ]; do
	case "$1" in
	-f) f=$2; shift 2 ;;
	-p) p=$2; shift 2 ;;
	*) break ;;
	esac
done
case "$1" in
version)
	echo '${VERSION}'
	;;
images)
	[ -e "$f/compose.yaml" ] || exit 9
	if [ -e "$d/absent" ]; then cat "$d/images-absent"; exit 1; fi
	cat "$d/images-present"
	;;
pull)
	cp "$f/compose.yaml" "$d/pulled" || exit 9
	echo 'pulled 2 images'
	;;
up)
	cp "$f/compose.yaml" "$d/composed" || exit 9
	awk '/^  [a-z]+:$/ { service = substr($1, 1, length($1) - 1) } /^      retries: / { if ($2 < 1 || $2 > 100) { print "bay: compose.yaml: service " service ": healthcheck retries must be 1..100"; refused = 1 } } END { exit refused }' "$f/compose.yaml" >&2 || exit 1
	echo '${STARTING}' >&2
	if [ -p "$d/gate" ]; then read -r _ < "$d/gate"; fi
	if [ -e "$d/upFails" ]; then echo '${STOPPED}' >&2; exit 1; fi
	echo '${HEALTHY}' >&2
	if [ -e "$d/unlisted" ]; then printf '{"schemaVersion":1,"project":"%s","services":[]}\\n' "$p"; exit 0; fi
	printf '{"schemaVersion":1,"project":"%s","services":[{"name":"mysql","host":"m.%s.example","port":13306},{"name":"postgres","host":"p.%s.example","port":15432}]}\\n' "$p" "$p" "$p"
	;;
down)
	[ -e "$f/compose.yaml" ] || exit 9
	if [ -e "$d/downFails" ]; then echo 'bay: the runtime did not answer' >&2; exit 1; fi
	echo 'removed 2 services'
	;;
*)
	exit 2
	;;
esac
`);
  }
  const text = (name: string): string | undefined => (existsSync(path.join(directory, name)) ? readFileSync(path.join(directory, name), 'utf8') : undefined);
  return {
    directory,
    env: { PATH, TMPDIR: directory },
    calls: () => (text('calls') ?? '').split('\n').filter(line => line !== '').map(line => line.split('\t')),
    composed: () => text('composed'),
    pulled: () => text('pulled'),
    left: () => readdirSync(directory).filter(name => name.startsWith('fsm-persist-')),
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

/** The four variables of the servers of `project`, one a line, with the hosts and the ports that the stand-in bay reports. */
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

/**
 * The words before the command of the one project that the calls of `staged` name: bay, -f with the directory of the run
 * and -p with the project, the name of that directory. Fails when the calls name no project or more than one.
 */
function named(staged: Stage): Named {
  const projects = new Set(staged.calls().filter(call => call[1] === '-f').map(call => `${call[2] ?? ''}\t${call[4] ?? ''}`));
  const [only, ...more] = [...projects];
  assert.ok(only !== undefined && more.length === 0, `the commands of bay do not name one project: ${JSON.stringify(staged.calls())}`);
  const [directory = '', project = ''] = only.split('\t');
  assert.equal(directory, path.join(staged.directory, project), 'the directory of the run is not named after its project');
  for (const call of staged.calls().filter(each => each[1] === '-f')) assert.deepEqual(call.slice(0, 5), ['bay', '-f', directory, '-p', project]);
  return ['bay', '-f', directory, '-p', project];
}

const VERSIONED = ['bay', 'version', '--json'];

/** The commands of a run that started its servers and removed them. */
function whole(project: Named): string[][] {
  return [VERSIONED, [...project, 'images', '--json'], [...project, 'up', '-no-pull', '--json'], [...project, 'down']];
}

test('the run starts the Compose project of both servers with bay up, passes the hosts and ports that bay reports to the command, runs bay down and removes its directory', async t => {
  const staged = stage(t);
  const file = path.join(staged.directory, 'variables');
  const ended = await script(staged, writes(file));
  assert.deepEqual([ended.code, ended.signal], [0, null], ended.stderr);
  const project = named(staged);
  assert.match(project[4], /^fsm-persist-\d+-[0-9a-f]{8}$/);
  assert.equal(staged.composed(), COMPOSE);
  assert.equal(readFileSync(file, 'utf8'), dsns(project[4]));
  // The version comes first; the images are read before the start; up pulls nothing and prints JSON; and no other command
  // of bay runs: no check of the machine setup, no log and no listing of the projects of the machine.
  assert.deepEqual(staged.calls(), whole(project));
  assert.deepEqual(staged.left(), [], 'the run left its directory');
  // The record of a run names the bay that made its result, and holds the progress of bay.
  assert.ok(ended.stderr.startsWith(`persist-servers: bay version: ${VERSION}\n`), ended.stderr);
  assert.match(ended.stderr, new RegExp(`^persist-servers: bay up: ${HEALTHY}$`, 'm'));
  assert.match(ended.stderr, /^persist-servers: bay down: removed 2 services$/m);
  assert.match(ended.stderr, new RegExp(`^persist-servers: removed the project ${project[4]}$`, 'm'));
  // The JSON of bay up is read, not shown as progress.
  assert.doesNotMatch(ended.stderr, /schemaVersion":1,"project"/);
  // The project of a second run has another name, so two runs share no project and no container.
  const again = stage(t);
  await script(again, writes(path.join(again.directory, 'variables')));
  assert.notEqual(named(again)[4], project[4]);
});

test('the code of the run is that of the command', async t => {
  const staged = stage(t);
  const file = path.join(staged.directory, 'variables');
  const ended = await script(staged, writes(file, 7));
  assert.deepEqual([ended.code, ended.signal], [7, null], ended.stderr);
  assert.deepEqual(staged.calls(), whole(named(staged)));
  assert.deepEqual(staged.left(), []);
});

test('the Compose file names no project, publishes no port, mounts nothing and names each image by its digest', async t => {
  const staged = stage(t);
  await script(staged, writes(path.join(staged.directory, 'variables')));
  const composed = staged.composed();
  assert.ok(composed !== undefined, 'bay up did not run');
  assert.doesNotMatch(composed, /^\s*(?:name|ports|volumes|tmpfs|network_mode|x-bay|container_name)\s*:/m);
  assert.deepEqual(composed.match(/^ {4}expose: .*$/gm), ['    expose: ["5432"]', '    expose: ["3306"]']);
  const images = [...composed.matchAll(/^ {4}image: "(.*)"$/gm)].map(match => match[1]);
  assert.deepEqual(images, KINDS.map(reference));
  for (const kind of KINDS) assert.match(reference(kind), /^docker\.io\/library\/[a-z]+@sha256:[0-9a-f]{64}$/);
});

// bay runs the declared healthcheck of a service before it returns from up. Each check runs the program of its server over
// TCP: the temporary server of the initialization of each image listens on its socket alone, so a check over the socket
// would pass before the accounts exist. The start period declares that initialization, whose failures bay does not count,
// and the retries are the failures that count after it.
test('each service declares a health check that asks its server over TCP in the container, with a start period for the initialization of its image', async t => {
  const staged = stage(t);
  await script(staged, writes(path.join(staged.directory, 'variables')));
  const composed = staged.composed();
  assert.ok(composed !== undefined, 'bay up did not run');
  assert.deepEqual(composed.match(/^ {6}test: .*$/gm), [
    '      test: ["CMD", "pg_isready", "--host=127.0.0.1", "--port=5432", "--username=fsm", "--dbname=fsm_test"]',
    '      test: ["CMD", "mysqladmin", "ping", "--protocol=tcp", "--host=127.0.0.1", "--port=3306"]',
  ]);
  assert.equal(composed.match(/^ {4}healthcheck:$/gm)?.length, 2);
  for (const declared of ['      start_period: "300s"', '      interval: "1s"', '      timeout: "5s"', '      retries: 3']) {
    assert.equal(composed.split('\n').filter(line => line === declared).length, 2, `each service does not declare ${declared.trim()}`);
  }
  assert.doesNotMatch(composed, /--socket|--protocol=socket|disable/);
});

// bay down ends with 0 also for a project of which bay made nothing, so the run removes every project that it started in one
// way and reads no other fact.
test('a bay up that fails fails the run without the command, and the run runs bay down and removes its directory', async t => {
  const staged = stage(t, { upFails: true });
  const file = path.join(staged.directory, 'variables');
  const ended = await script(staged, writes(file));
  assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
  const project = named(staged);
  assert.match(ended.stderr, new RegExp(`^persist-servers: bay up: ${STOPPED}$`, 'm'));
  assert.match(ended.stderr, new RegExp(`^persist-servers: bay up ended with 1 before the servers of the project ${project[4]} were healthy$`, 'm'));
  assert.equal(existsSync(file), false, 'the command ran with servers that were not ready');
  assert.deepEqual(staged.calls(), whole(project));
  assert.deepEqual(staged.left(), []);
});

test('a service that the JSON of bay up does not hold fails the run without the command, and the project is removed', async t => {
  const staged = stage(t, { unlisted: true });
  const file = path.join(staged.directory, 'variables');
  const ended = await script(staged, writes(file));
  assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
  const project = named(staged);
  assert.ok(ended.stderr.includes(`\npersist-servers: bay up --json names no host and port of the service postgres:\n{"schemaVersion":1,"project":"${project[4]}","services":[]}\n`), ended.stderr);
  assert.equal(existsSync(file), false, 'the command ran without the address of a server');
  assert.deepEqual(staged.calls(), whole(project));
  assert.deepEqual(staged.left(), []);
});

test('an image that the store of bay lacks fails the run before a server starts and names make persist-images', async t => {
  const staged = stage(t, { absent: true });
  const ended = await script(staged, writes(path.join(staged.directory, 'variables')));
  assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
  assert.match(ended.stderr, new RegExp(`^persist-servers: the image ${reference('postgres').replaceAll('.', '\\.')} of postgres is not installed: run make persist-images$`, 'm'));
  // Nothing was started, so nothing is removed with bay; the directory of the run is removed.
  assert.deepEqual(staged.calls(), [VERSIONED, [...named(staged), 'images', '--json']]);
  assert.deepEqual(staged.left(), []);
});

test('a bay that PATH does not hold fails the run and the pull at once, with its name and what installs it', async t => {
  for (const args of [writes('/dev/null'), ['pull']]) {
    const staged = stage(t, { bay: false });
    const ended = await script(staged, args);
    assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
    assert.equal(ended.stderr, 'persist-servers: bay is not found on PATH: install bay and apply its machine setup with bay install\n');
    assert.deepEqual(staged.left(), []);
  }
});

test('a bay down that fails fails the run, which keeps its directory and shows the command that removes the project', async t => {
  const staged = stage(t, { downFails: true });
  const ended = await script(staged, writes(path.join(staged.directory, 'variables')));
  assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
  const project = named(staged);
  assert.match(ended.stderr, /^persist-servers: bay down: bay: the runtime did not answer$/m);
  assert.ok(ended.stderr.includes(`\npersist-servers: bay down ended with 1; the containers of the project ${project[4]} may still run: run bay -f ${project[2]} -p ${project[4]} down\n`), ended.stderr);
  assert.deepEqual(staged.left(), [project[4]]);
  assert.equal(readFileSync(path.join(project[2], 'compose.yaml'), 'utf8'), COMPOSE);
});

for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130]] as const) {
  test(`${signal} while the command runs reaches the command, and the project is removed`, async t => {
    const staged = stage(t);
    execFileSync('mkfifo', [path.join(staged.directory, 'never')]);
    // The command writes a line when it runs and then waits on a pipe that nothing writes, so only the signal ends it.
    const command = ['run', '--', '/bin/sh', '-c', `echo started; read -r _ < '${path.join(staged.directory, 'never')}'`];
    const ended = await script(staged, command, (line, stream, kill) => { if (stream === 'stdout' && line === 'started') kill(signal); });
    assert.deepEqual([ended.code, ended.signal], [code, null], ended.stderr);
    assert.deepEqual(staged.calls(), whole(named(staged)));
    assert.deepEqual(staged.left(), []);
  });

  // The gate of the stand-in is never opened: only the signal that the run forwards ends its bay up.
  test(`${signal} while the servers start is forwarded to bay up, and the run ends without the command and removes the project`, async t => {
    const staged = stage(t, { gated: true });
    const file = path.join(staged.directory, 'variables');
    const ended = await script(staged, writes(file), (line, stream, kill) => {
      if (stream === 'stderr' && line === `persist-servers: bay up: ${STARTING}`) kill(signal);
    });
    assert.deepEqual([ended.code, ended.signal], [code, null], ended.stderr);
    assert.equal(existsSync(file), false, 'the command ran after the signal');
    assert.doesNotMatch(ended.stderr, new RegExp(HEALTHY));
    assert.deepEqual(staged.calls(), whole(named(staged)));
    assert.deepEqual(staged.left(), []);
  });
}

// pull is the only command that downloads: it gives bay pull the Compose file of a run in a directory of its own.
test('pull runs bay pull on the Compose file of a run and removes its directory', async t => {
  const staged = stage(t);
  const ended = await script(staged, ['pull']);
  assert.deepEqual([ended.code, ended.signal], [0, null], ended.stderr);
  assert.deepEqual(staged.calls(), [VERSIONED, [...named(staged), 'pull']]);
  assert.equal(staged.pulled(), COMPOSE);
  assert.match(ended.stderr, /^persist-servers: bay pull: pulled 2 images$/m);
  assert.deepEqual(staged.left(), []);
});

test('a run without a command and a verb that the script does not know fail with the usage', async t => {
  for (const args of [[], ['run'], ['run', '--'], ['run', 'make'], ['start'], ['pull', 'postgres']]) {
    const staged = stage(t);
    const ended = await script(staged, args);
    assert.equal(ended.code, 2, args.join(' '));
    assert.match(ended.stderr, /^usage: scripts\/persist-servers\.mts run -- <command> \[argument\.\.\.\] \| pull$/m);
    assert.deepEqual(staged.calls(), []);
  }
});
