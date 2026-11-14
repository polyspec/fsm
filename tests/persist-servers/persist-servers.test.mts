// The run of scripts/persist-servers.mts (docs/plans/fsm-v1/plan.md, C-6; docs/plans/fsm-v1/checklist.md, S-472-1): it starts
// the PostgreSQL and the MySQL server in the container program of the platform, goes on at the ready line of each, runs its
// command with the four FSM_TEST_* variables, and removes the containers when the command ends, fails or the run gets SIGINT
// or SIGTERM. The test runs the script with stand-ins that it writes into a directory of its own, the only programs of
// PATH: a uname that names the platform and a container program that records its arguments, writes the
// output of a server and stays until its container is deleted, so it needs no container runtime. A stand-in waits on a named
// pipe, never on time: its run ends when the delete writes to the pipe of its container.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

// The lines of a server whose image initialized it: the temporary server of the initialization logs a ready line too, and
// MySQL logs one for the port of its X plugin, so only the last line of each list is the ready line of the server. The
// lines of MySQL are those of MySQL 8.4.11 in CI: its ready line names the port inside the line, before the name of the
// server, and a ready line that the run read only at the end of the line was never found (S-479).
const OUTPUT: Record<Kind, string[]> = {
  postgres: [
    'LOG:  database system is ready to accept connections',
    'PostgreSQL init process complete; ready for start up.',
    'LOG:  starting PostgreSQL 17.11',
    'LOG:  database system is ready to accept connections',
  ],
  mysql: [
    '[System] [MY-011323] [Server] X Plugin ready for connections. Socket: /var/run/mysqld/mysqlx.sock',
    "[System] [MY-010931] [Server] /usr/sbin/mysqld: ready for connections. Version: '8.4.11'  socket: '/var/run/mysqld/mysqld.sock'  port: 0  MySQL Community Server - GPL.",
    '[Note] [Entrypoint]: MySQL init process done. Ready for start up.',
    "[System] [MY-011323] [Server] X Plugin ready for connections. Bind-address: '::' port: 33060, socket: /var/run/mysqld/mysqlx.sock",
    "[System] [MY-010931] [Server] /usr/sbin/mysqld: ready for connections. Version: '8.4.11'  socket: '/var/run/mysqld/mysqld.sock'  port: 3306  MySQL Community Server - GPL.",
  ],
};

// The JSON that the inspect of each program prints for a container with the address.
const INSPECT: Record<string, (address: string) => string> = {
  docker: address => JSON.stringify([{ NetworkSettings: { Networks: { bridge: { IPAddress: address } } } }]),
  container: address => JSON.stringify([{ status: { networks: [{ ipv4Address: `${address}/24` }] } }]),
};
const ADDRESS: Record<Kind, string> = { postgres: '192.0.2.10', mysql: '192.0.2.20' };

/** What a stand-in server does: the lines that it writes, and whether it exits with code 3 after them or waits behind a gate before its last line. */
interface Stand {
  lines?: string[];
  exits?: boolean;
  gated?: boolean;
}

/** The directory of the stand-ins of one run and what the test reads from it. */
interface Stage {
  directory: string;
  env: NodeJS.ProcessEnv;
  /** The commands that the container program received, each as its words. */
  calls: () => string[][];
  /** Lets the gated server of `kind` write its last line. */
  open: (kind: Kind) => void;
}

/**
 * Writes the stand-ins of the platform `system`: uname and `program`, the container program that PATH holds, none when it is
 * undefined. `absent` makes the program fail the commands of an image; `stands` are the servers by kind.
 */
function stage(t: TestContext, system: string, program: string | undefined, stands: Partial<Record<Kind, Stand>> = {}, absent = false): Stage {
  const { directory, path: PATH, program: write } = standIns(t, system);
  for (const kind of KINDS) {
    const { lines = OUTPUT[kind], exits = false, gated = false } = stands[kind] ?? {};
    const [head, tail] = gated ? [lines.slice(0, -1), lines.slice(-1)] : [lines, []];
    writeFileSync(path.join(directory, `head-${kind}`), head.map(line => `${line}\n`).join(''));
    writeFileSync(path.join(directory, `tail-${kind}`), tail.map(line => `${line}\n`).join(''));
    if (exits) writeFileSync(path.join(directory, `exits-${kind}`), '');
    if (gated) execFileSync('mkfifo', [path.join(directory, `gate-${kind}`)]);
    if (program !== undefined) writeFileSync(path.join(directory, `inspect-${kind}`), `${INSPECT[program]?.(ADDRESS[kind]) ?? ''}\n`);
  }
  if (absent) writeFileSync(path.join(directory, 'absent'), '');
  // Each command is one line of the file calls, its words joined by a tab. The kind of a container is the last part of its
  // name. run writes the lines of its server and stays until delete writes to the pipe stop-<kind>, which run makes first.
  if (program !== undefined) {
    write(program, `d='${directory}'
line=$(basename "$0")
for word in "$@"; do line="$line\t$word"; done
printf '%s\\n' "$line" >> "$d/calls"
case "$1" in
image)
	[ ! -e "$d/absent" ]
	;;
run)
	while [ "$1" != --name ]; do shift; done
	kind=\${2##*-}
	mkfifo "$d/stop-$kind" || exit 9
	cat "$d/head-$kind"
	if [ -p "$d/gate-$kind" ]; then read -r _ < "$d/gate-$kind"; fi
	cat "$d/tail-$kind"
	if [ -e "$d/exits-$kind" ]; then exit 3; fi
	read -r _ < "$d/stop-$kind"
	;;
rm | delete)
	shift 2
	for name in "$@"; do echo stop > "$d/stop-\${name##*-}"; done
	;;
inspect)
	cat "$d/inspect-\${2##*-}"
	;;
esac
`);
  }
  const calls = (): string[][] => {
    const file = path.join(directory, 'calls');
    return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(line => line !== '').map(line => line.split('\t')) : [];
  };
  const open = (kind: Kind): void => { writeFileSync(path.join(directory, `gate-${kind}`), 'open\n'); };
  return { directory, env: { PATH }, calls, open };
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

const DSNS = [
  'postgres://fsm:fsm@192.0.2.10:5432/fsm_test?sslmode=disable',
  'postgres://fsm:fsm@192.0.2.10:5432/fsm_test?sslmode=disable',
  'mysql://fsm:fsm@192.0.2.20:3306/fsm_test',
  'mysql://root:root@192.0.2.20:3306/mysql',
  '',
].join('\n');

const POSTGRES_ENV = ['--env', 'POSTGRES_USER=fsm', '--env', 'POSTGRES_PASSWORD=fsm', '--env', 'POSTGRES_DB=fsm_test'];
const MYSQL_ENV = ['--env', 'MYSQL_ROOT_PASSWORD=root', '--env', 'MYSQL_USER=fsm', '--env', 'MYSQL_PASSWORD=fsm', '--env', 'MYSQL_DATABASE=fsm_test'];

/** The name of the container of `kind` that the calls started; fails when none was started. */
function nameOf(calls: string[][], kind: Kind): string {
  const name = calls.filter(call => call[1] === 'run').map(call => call[call.indexOf('--name') + 1] ?? '').find(each => each.endsWith(`-${kind}`));
  assert.ok(name !== undefined, `no container of ${kind} was started: ${JSON.stringify(calls)}`);
  return name;
}

/** The calls with the two commands that start the servers in the order postgres, mysql: they start at once, so either is first. */
function ordered(calls: string[][]): string[][] {
  const runs = calls.filter(call => call[1] === 'run').sort((a, b) => Number(a.includes('MYSQL_USER=fsm')) - Number(b.includes('MYSQL_USER=fsm')));
  return calls.map(call => (call[1] === 'run' ? runs.shift() ?? call : call));
}

test('on Linux the run starts both servers in docker, passes their DSNs to the command and removes the containers', async t => {
  const staged = stage(t, 'Linux', 'docker');
  const file = path.join(staged.directory, 'variables');
  const ended = await script(staged, writes(file));
  assert.deepEqual([ended.code, ended.signal], [0, null], ended.stderr);
  assert.equal(readFileSync(file, 'utf8'), DSNS);
  const calls = staged.calls();
  const [postgres, mysql] = [nameOf(calls, 'postgres'), nameOf(calls, 'mysql')];
  assert.match(postgres, /^fsm-persist-\d+-[0-9a-f]{8}-postgres$/);
  assert.equal(mysql, postgres.replace(/postgres$/, 'mysql'));
  assert.deepEqual(ordered(calls), [
    ['docker', 'image', 'inspect', reference('postgres')],
    ['docker', 'image', 'inspect', reference('mysql')],
    ['docker', 'run', '--rm', '--name', postgres, ...POSTGRES_ENV, reference('postgres')],
    ['docker', 'run', '--rm', '--name', mysql, ...MYSQL_ENV, reference('mysql')],
    ['docker', 'inspect', postgres],
    ['docker', 'inspect', mysql],
    ['docker', 'rm', '--force', postgres, mysql],
  ]);
  // The lines of each server are shown, so the log of a run holds the output of its servers.
  assert.match(ended.stderr, /^persist-servers: postgres: PostgreSQL init process complete; ready for start up\.$/m);
  assert.match(ended.stderr, /^persist-servers: mysql: .*port: 3306  MySQL Community Server - GPL\.$/m);
  // Each step of the run is a line, so a run that waits shows what it waits for (S-479).
  for (const step of [
    /^persist-servers: started fsm-persist-\S+-postgres fsm-persist-\S+-mysql; the run waits for the ready line of each server$/m,
    /^persist-servers: postgres is initialized; the run waits for the ready line of its server$/m,
    /^persist-servers: mysql is initialized; the run waits for the ready line of its server$/m,
    /^persist-servers: postgres is ready$/m,
    /^persist-servers: mysql is ready$/m,
    /^persist-servers: the servers are ready; running \/bin\/sh -c /m,
    /^persist-servers: \/bin\/sh ended with 0; the run removes the servers$/m,
    /^persist-servers: removed fsm-persist-\S+-postgres fsm-persist-\S+-mysql$/m,
  ]) assert.match(ended.stderr, step);
  // The names of a second run are other names, so two runs share no container.
  const again = stage(t, 'Linux', 'docker');
  await script(again, writes(path.join(again.directory, 'variables')));
  assert.notEqual(nameOf(again.calls(), 'postgres'), postgres);
});

test('on Darwin the run starts both servers in Apple container, and its code is that of the command', async t => {
  const staged = stage(t, 'Darwin', 'container');
  const file = path.join(staged.directory, 'variables');
  const ended = await script(staged, writes(file, 7));
  assert.deepEqual([ended.code, ended.signal], [7, null], ended.stderr);
  assert.equal(readFileSync(file, 'utf8'), DSNS);
  const calls = staged.calls();
  const [postgres, mysql] = [nameOf(calls, 'postgres'), nameOf(calls, 'mysql')];
  assert.deepEqual(ordered(calls), [
    ['container', 'image', 'inspect', reference('postgres')],
    ['container', 'image', 'inspect', reference('mysql')],
    ['container', 'run', '--rm', '--progress', 'none', '--name', postgres, ...POSTGRES_ENV, reference('postgres')],
    ['container', 'run', '--rm', '--progress', 'none', '--name', mysql, ...MYSQL_ENV, reference('mysql')],
    ['container', 'inspect', postgres],
    ['container', 'inspect', mysql],
    ['container', 'delete', '--force', postgres, mysql],
  ]);
});

test('no container publishes a port, and each image is pinned by its digest', async t => {
  const staged = stage(t, 'Linux', 'docker');
  await script(staged, writes(path.join(staged.directory, 'variables')));
  const runs = staged.calls().filter(call => call[1] === 'run');
  assert.equal(runs.length, 2);
  for (const call of runs) assert.deepEqual(call.filter(word => /^(?:-p|--publish|--publish-all|-P|--network)/.test(word)), []);
  for (const kind of KINDS) assert.match(reference(kind), /^docker\.io\/library\/[a-z]+@sha256:[0-9a-f]{64}$/);
});

// The ready line of the temporary server of the initialization, and for MySQL the line of the port of its X plugin, are not
// the ready line of the server: a container that stops after them stopped before it was ready.
for (const kind of KINDS) {
  test(`a ${kind} container that stops before its ready line fails the run with its last lines, and the other container is removed`, async t => {
    const other = kind === 'postgres' ? 'mysql' : 'postgres';
    const staged = stage(t, 'Linux', 'docker', { [kind]: { lines: OUTPUT[kind].slice(0, -1), exits: true } });
    const file = path.join(staged.directory, 'variables');
    const ended = await script(staged, writes(file));
    assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
    const calls = staged.calls();
    assert.match(ended.stderr, new RegExp(`^persist-servers: the container ${nameOf(calls, kind)} of ${kind} stopped with 3 before it was ready; its last lines:$`, 'm'));
    const report = ended.stderr.slice(ended.stderr.indexOf('its last lines:'));
    for (const line of OUTPUT[kind].slice(0, -1)) assert.ok(report.includes(`\n${line}\n`), `the failure does not hold the line ${line}:\n${report}`);
    assert.equal(existsSync(file), false, 'the command ran with a server that was not ready');
    assert.deepEqual(calls.filter(call => call[1] === 'rm'), [['docker', 'rm', '--force', nameOf(calls, other)]]);
    assert.deepEqual(calls.filter(call => call[1] === 'inspect'), []);
  });
}

// A ready line of mysqld after the initialization is the event of the server; when it names another port, no later line
// would be the ready line, so the run fails at it instead of waiting (S-479).
test('a MySQL ready line that names another port than 3306 fails the run with that line, and both containers are removed', async t => {
  const other = "[System] [MY-010931] [Server] /usr/sbin/mysqld: ready for connections. Version: '8.4.11'  socket: '/var/run/mysqld/mysqld.sock'  port: 3307  MySQL Community Server - GPL.";
  const staged = stage(t, 'Linux', 'docker', { mysql: { lines: [...OUTPUT.mysql.slice(0, -1), other] } });
  const file = path.join(staged.directory, 'variables');
  const ended = await script(staged, writes(file));
  assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
  assert.ok(ended.stderr.includes(`persist-servers: mysql: the server is ready on another port than 3306: ${other}\n`), ended.stderr);
  assert.equal(existsSync(file), false, 'the command ran with a server that was not ready');
  const calls = staged.calls();
  assert.deepEqual(calls.filter(call => call[1] === 'rm'), [['docker', 'rm', '--force', nameOf(calls, 'postgres'), nameOf(calls, 'mysql')]]);
  assert.deepEqual(calls.filter(call => call[1] === 'inspect'), []);
});

test('an image that is not installed fails the run before a container starts and names make persist-images', async t => {
  const staged = stage(t, 'Linux', 'docker', {}, true);
  const ended = await script(staged, writes(path.join(staged.directory, 'variables')));
  assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
  assert.match(ended.stderr, new RegExp(`^persist-servers: the image ${reference('postgres').replaceAll('.', '\\.')} of postgres is not installed: run make persist-images$`, 'm'));
  assert.deepEqual(staged.calls(), [['docker', 'image', 'inspect', reference('postgres')]]);
});

test('a container program that PATH does not hold fails the run at once, with its name and what installs it', async t => {
  for (const [system, program, install] of [['Linux', 'docker', 'Docker Engine'], ['Darwin', 'container', 'Apple container']] as const) {
    const staged = stage(t, system, undefined);
    const file = path.join(staged.directory, 'variables');
    const ended = await script(staged, writes(file));
    assert.deepEqual([ended.code, ended.signal], [1, null], ended.stderr);
    assert.match(ended.stderr, new RegExp(`^scripts/container\\.mts: ${program} is not found on PATH: install ${install} `));
    assert.equal(existsSync(file), false);
  }
});

for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130]] as const) {
  test(`${signal} while the command runs reaches the command, and the containers are removed`, async t => {
    const staged = stage(t, 'Linux', 'docker');
    execFileSync('mkfifo', [path.join(staged.directory, 'never')]);
    // The command writes a line when it runs and then waits on a pipe that nothing writes, so only the signal ends it.
    const command = ['run', '--', '/bin/sh', '-c', `echo started; read -r _ < '${path.join(staged.directory, 'never')}'`];
    const ended = await script(staged, command, (line, stream, kill) => { if (stream === 'stdout' && line === 'started') kill(signal); });
    assert.deepEqual([ended.code, ended.signal], [code, null], ended.stderr);
    const calls = staged.calls();
    assert.deepEqual(calls.filter(call => call[1] === 'rm'), [['docker', 'rm', '--force', nameOf(calls, 'postgres'), nameOf(calls, 'mysql')]]);
  });

  test(`${signal} while the servers start ends the run once the start ends, without the command, and the containers are removed`, async t => {
    const staged = stage(t, 'Linux', 'docker', { postgres: { gated: true }, mysql: { gated: true } });
    const file = path.join(staged.directory, 'variables');
    const ended = await script(staged, writes(file), (line, stream, kill) => {
      // The signal is sent when the server shows a line of its initialization, and the servers get ready when the run
      // shows that it received the signal.
      if (stream === 'stderr' && line === 'persist-servers: postgres: PostgreSQL init process complete; ready for start up.') kill(signal);
      if (stream === 'stderr' && line.startsWith(`persist-servers: received ${signal}`)) for (const kind of KINDS) staged.open(kind);
    });
    assert.deepEqual([ended.code, ended.signal], [code, null], ended.stderr);
    assert.equal(existsSync(file), false, 'the command ran after the signal');
    const calls = staged.calls();
    assert.deepEqual(calls.filter(call => call[1] === 'rm'), [['docker', 'rm', '--force', nameOf(calls, 'postgres'), nameOf(calls, 'mysql')]]);
  });
}

test('pull pulls each pinned image', async t => {
  const staged = stage(t, 'Darwin', 'container');
  const ended = await script(staged, ['pull']);
  assert.deepEqual([ended.code, ended.signal], [0, null], ended.stderr);
  assert.deepEqual(staged.calls(), [['container', 'image', 'pull', reference('postgres')], ['container', 'image', 'pull', reference('mysql')]]);
});

test('a run without a command and a verb that the script does not know fail with the usage', async t => {
  for (const args of [[], ['run'], ['run', '--'], ['run', 'make'], ['start'], ['pull', 'postgres']]) {
    const staged = stage(t, 'Linux', 'docker');
    const ended = await script(staged, args);
    assert.equal(ended.code, 2, args.join(' '));
    assert.match(ended.stderr, /^usage: scripts\/persist-servers\.mts run -- <command> \[argument\.\.\.\] \| pull$/m);
    assert.deepEqual(staged.calls(), []);
  }
});
