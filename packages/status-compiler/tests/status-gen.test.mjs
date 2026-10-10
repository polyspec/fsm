// Tests of the command line of packages/status-compiler/src/cli/status-gen.mjs (docs/plans/status-v1.md, C-5): the exit codes
// (0 ok, 1 findings, 2 usage), the finding lines on stderr, the summary line on stdout, and the options. check and lock take
// --project <dir> (the project root, default the current directory). copy takes the source from --project and the target
// directory from --root, which is required. Every case runs in temporary directories that are removed when the file's tests end.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { LOCK_TEXT, ORDER_LOCK_TEXT, ORDER_TEXT, TRACK_TEXT } from './canonical-texts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '../src/cli/status-gen.mjs');
const CONFIG_JSON = '{ "store": "json" }\n';
const roots = [];

/** A new temporary directory with the files of `files` (path -> text), removed when the file's tests end. */
function project(files = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'status-gen-'));
  roots.push(root);
  for (const [relative, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), text);
  }
  return root;
}

/** Runs status-gen with `args` in `cwd` and returns its status, stdout and stderr. */
function gen(args, cwd = HERE) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** The bytes of the machine files and the lock under `root`, as a map of relative path to text. */
function filesOf(root) {
  const out = {};
  const machines = path.join(root, 'machines');
  if (existsSync(machines)) {
    for (const name of ['order.status.json', 'track.status.json']) {
      if (existsSync(path.join(machines, name))) out[`machines/${name}`] = readFileSync(path.join(machines, name), 'utf8');
    }
  }
  if (existsSync(path.join(root, 'status.lock.json'))) out['status.lock.json'] = readFileSync(path.join(root, 'status.lock.json'), 'utf8');
  return out;
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test('check of a canonical project exits 0 with a one-line summary', () => {
  const root = project({ 'status.config.json': CONFIG_JSON, 'machines/order.status.json': ORDER_TEXT, 'status.lock.json': ORDER_LOCK_TEXT });
  assert.deepEqual(gen(['check', '--project', root]), { status: 0, stdout: '[status-gen] check: ok\n', stderr: '' });
});

test('check defaults --project to the current directory', () => {
  const root = project({ 'status.config.json': CONFIG_JSON, 'machines/order.status.json': ORDER_TEXT, 'status.lock.json': ORDER_LOCK_TEXT });
  assert.deepEqual(gen(['check'], root), { status: 0, stdout: '[status-gen] check: ok\n', stderr: '' });
});

test('check of a lock that does not match exits 1 and prints the finding on stderr', () => {
  const lock = '{ "order": { "codes": { "1": "draft", "2": "paid" }, "reserved": [] } }\n';
  const root = project({ 'status.config.json': CONFIG_JSON, 'machines/order.status.json': ORDER_TEXT, 'status.lock.json': lock });
  const result = gen(['check', '--project', root]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.split('\n')[0].startsWith('[status-gen] E_LOCK_MISMATCH order $.codes: '), true, result.stderr);
});

test('a missing status.config.json exits 1 with E_STORE_NOT_CONFIGURED at $', () => {
  const root = project({});
  const result = gen(['check', '--project', root]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.split('\n')[0].startsWith('[status-gen] E_STORE_NOT_CONFIGURED - $: '), true, result.stderr);
});

test('a store other than json or mermaid exits 1 with E_STORE_NOT_CONFIGURED at $.store', () => {
  const root = project({ 'status.config.json': '{ "store": "db", "dsnEnv": "STATUS_DSN" }\n' });
  const result = gen(['check', '--project', root]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.split('\n')[0].startsWith('[status-gen] E_STORE_NOT_CONFIGURED - $.store: '), true, result.stderr);
});

test('the mermaid store exits 1 with E_STORE_NOT_CONFIGURED until S-08', () => {
  const root = project({ 'status.config.json': '{ "store": "mermaid" }\n' });
  assert.deepEqual(gen(['check', '--project', root]), {
    status: 1,
    stdout: '',
    stderr: '[status-gen] E_STORE_NOT_CONFIGURED - $: the mermaid store arrives with S-08\n',
  });
});

test('lock writes the lock of the definitions, and check then passes', () => {
  const root = project({ 'status.config.json': CONFIG_JSON, 'machines/order.status.json': ORDER_TEXT });
  assert.deepEqual(gen(['lock', '--project', root]), { status: 0, stdout: '[status-gen] lock: ok\n', stderr: '' });
  assert.equal(readFileSync(path.join(root, 'status.lock.json'), 'utf8'), ORDER_LOCK_TEXT);
  assert.equal(gen(['check', '--project', root]).status, 0);
});

test('lock --rename changes the state in the definition and the lock, and keeps the code', () => {
  const root = project({ 'status.config.json': CONFIG_JSON, 'machines/order.status.json': ORDER_TEXT, 'status.lock.json': ORDER_LOCK_TEXT });
  assert.equal(gen(['lock', '--rename', 'order.draft=started', '--project', root]).status, 0);
  const definition = JSON.parse(readFileSync(path.join(root, 'machines/order.status.json'), 'utf8'));
  assert.equal(definition.states[0].key, 'started');
  assert.equal(definition.states[0].code, 1);
  assert.equal(definition.events[0].edges[0].from, 'started');
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'status.lock.json'), 'utf8')).order.codes, { 1: 'started', 2: 'done' });
});

test('lock refused by a lock rule exits 1 and writes neither the definition nor the lock', () => {
  const changed = ORDER_TEXT.replace('"key": "draft"', '"key": "started"').replace('"from": "draft"', '"from": "started"');
  const root = project({ 'status.config.json': CONFIG_JSON, 'machines/order.status.json': changed, 'status.lock.json': ORDER_LOCK_TEXT });
  const result = gen(['lock', '--project', root]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.split('\n')[0].startsWith('[status-gen] E_CODE_KEY_CHANGED order $.states[0].code: '), true, result.stderr);
  assert.equal(readFileSync(path.join(root, 'status.lock.json'), 'utf8'), ORDER_LOCK_TEXT);
  assert.equal(readFileSync(path.join(root, 'machines/order.status.json'), 'utf8'), changed);
});

test('lock refused with E_CODE_CHANGED exits 1 and writes nothing', () => {
  const changed = ORDER_TEXT.replace('"code": 2', '"code": 7');
  const root = project({ 'status.config.json': CONFIG_JSON, 'machines/order.status.json': changed, 'status.lock.json': ORDER_LOCK_TEXT });
  const result = gen(['lock', '--project', root]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.split('\n')[0].startsWith('[status-gen] E_CODE_CHANGED order $.states[1].code: '), true, result.stderr);
  assert.equal(readFileSync(path.join(root, 'status.lock.json'), 'utf8'), ORDER_LOCK_TEXT);
  assert.equal(readFileSync(path.join(root, 'machines/order.status.json'), 'utf8'), changed);
});

test('usage errors exit 2 with a usage line on stderr and nothing on stdout', () => {
  const root = project({ 'status.config.json': CONFIG_JSON });
  const cases = [
    [],
    ['frobnicate'],
    ['check', 'extra'],
    ['check', '--project'],
    ['check', '--root', root],
    ['lock', '--root', root],
    ['check', '--rename', 'order.a=b', '--project', root],
    ['lock', '--rename', 'order.a', '--project', root],
    ['check', '--to', 'json', '--project', root],
    ['copy', '--project', root],
    ['copy', '--to', 'json'],
    ['copy', '--to', 'xml', '--root', root],
  ];
  for (const args of cases) {
    const result = gen(args);
    assert.equal(result.status, 2, JSON.stringify(args));
    assert.equal(result.stdout, '', JSON.stringify(args));
    assert.equal(result.stderr.startsWith('[status-gen] usage: '), true, JSON.stringify(args));
  }
});

test('copy --to json into an empty target writes byte-identical machine files and lock', () => {
  const source = project({
    'status.config.json': CONFIG_JSON,
    'machines/order.status.json': ORDER_TEXT,
    'machines/track.status.json': TRACK_TEXT,
    'status.lock.json': LOCK_TEXT,
  });
  const target = path.join(project(), 'empty-target');
  assert.deepEqual(gen(['copy', '--to', 'json', '--project', source, '--root', target]), {
    status: 0,
    stdout: '[status-gen] copy: ok\n',
    stderr: '',
  });
  assert.deepEqual(filesOf(target), filesOf(source));
  assert.equal(readFileSync(path.join(target, 'status.lock.json'), 'utf8'), LOCK_TEXT);
});

test('copy --to json into a non-empty target exits 1 with E_STORE_NOT_EMPTY and writes nothing', () => {
  const source = project({
    'status.config.json': CONFIG_JSON,
    'machines/order.status.json': ORDER_TEXT,
    'status.lock.json': ORDER_LOCK_TEXT,
  });
  const target = project({ 'machines/order.status.json': ORDER_TEXT, 'status.lock.json': ORDER_LOCK_TEXT });
  const before = filesOf(target);
  const result = gen(['copy', '--to', 'json', '--project', source, '--root', target]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.startsWith('[status-gen] E_STORE_NOT_EMPTY - $: '), true, result.stderr);
  assert.deepEqual(filesOf(target), before);
});

test('copy --to mermaid exits 1 with E_STORE_NOT_CONFIGURED until S-08', () => {
  const source = project({ 'status.config.json': CONFIG_JSON, 'machines/order.status.json': ORDER_TEXT });
  const target = path.join(project(), 'empty-target');
  assert.deepEqual(gen(['copy', '--to', 'mermaid', '--project', source, '--root', target]), {
    status: 1,
    stdout: '',
    stderr: '[status-gen] E_STORE_NOT_CONFIGURED - $: the mermaid store arrives with S-08\n',
  });
  assert.equal(existsSync(target), false);
});
