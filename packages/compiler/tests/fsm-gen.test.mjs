// Tests of the command line of packages/compiler/src/cli/fsm-gen.mjs (docs/plans/fsm-v1.md, C-5): the exit codes
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
import { jsonStore } from '../src/store-json/store.mjs';
import { mermaidStore } from '../src/store-mermaid/store.mjs';
import {
  LOCK_TEXT, ORDER_LOCK_TEXT, ORDER_MMD_TEXT, ORDER_TEXT, TRACK_MMD_TEXT, TRACK_TEXT,
} from './canonical-texts.mjs';
import { filesOf } from './checkout.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '../src/cli/fsm-gen.mjs');
const CONFIG_JSON = '{ "store": "json" }\n';
const MERMAID_CONFIG = '{ "store": "mermaid" }\n';
const roots = [];

/** A new temporary directory with the files of `files` (path -> text), removed when the file's tests end. */
function project(files = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'fsm-gen-'));
  roots.push(root);
  for (const [relative, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), text);
  }
  return root;
}

/** Runs fsm-gen with `args` in `cwd` and returns its status, stdout and stderr. */
function gen(args, cwd = HERE) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test('check of a canonical project exits 0 with a one-line summary', () => {
  const root = project({ 'fsm.config.json': CONFIG_JSON, 'machines/order.fsm.json': ORDER_TEXT, 'fsm.lock.json': ORDER_LOCK_TEXT });
  assert.deepEqual(gen(['check', '--project', root]), { status: 0, stdout: '[fsm-gen] check: ok\n', stderr: '' });
});

test('check defaults --project to the current directory', () => {
  const root = project({ 'fsm.config.json': CONFIG_JSON, 'machines/order.fsm.json': ORDER_TEXT, 'fsm.lock.json': ORDER_LOCK_TEXT });
  assert.deepEqual(gen(['check'], root), { status: 0, stdout: '[fsm-gen] check: ok\n', stderr: '' });
});

test('check of a lock that does not match exits 1 and prints the finding on stderr', () => {
  const lock = '{ "order": { "codes": { "1": "draft", "2": "paid" }, "reserved": [] } }\n';
  const root = project({ 'fsm.config.json': CONFIG_JSON, 'machines/order.fsm.json': ORDER_TEXT, 'fsm.lock.json': lock });
  const result = gen(['check', '--project', root]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.split('\n')[0].startsWith('[fsm-gen] E_LOCK_MISMATCH order $.codes: '), true, result.stderr);
});

test('a missing fsm.config.json exits 1 with E_STORE_NOT_CONFIGURED at $', () => {
  const root = project({});
  const result = gen(['check', '--project', root]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.split('\n')[0].startsWith('[fsm-gen] E_STORE_NOT_CONFIGURED - $: '), true, result.stderr);
});

test('a store other than json or mermaid exits 1 with E_STORE_NOT_CONFIGURED at $.store', () => {
  const root = project({ 'fsm.config.json': '{ "store": "db", "dsnEnv": "FSM_DSN" }\n' });
  const result = gen(['check', '--project', root]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.split('\n')[0].startsWith('[fsm-gen] E_STORE_NOT_CONFIGURED - $.store: '), true, result.stderr);
});

test('check of a canonical mermaid project exits 0 with a one-line summary', () => {
  const root = project({ 'fsm.config.json': MERMAID_CONFIG, 'machines/order.fsm.mmd': ORDER_MMD_TEXT, 'fsm.lock.json': ORDER_LOCK_TEXT });
  assert.deepEqual(gen(['check', '--project', root]), { status: 0, stdout: '[fsm-gen] check: ok\n', stderr: '' });
});

test('check of a mermaid project whose lock does not match exits 1 with E_LOCK_MISMATCH', () => {
  const root = project({ 'fsm.config.json': MERMAID_CONFIG, 'machines/order.fsm.mmd': ORDER_MMD_TEXT });
  const result = gen(['check', '--project', root]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.startsWith('[fsm-gen] E_LOCK_MISMATCH order $: '), true, result.stderr);
});

test('check of a mermaid project with a json machine file exits 1 with E_STORE_MIXED', () => {
  const root = project({ 'fsm.config.json': MERMAID_CONFIG, 'machines/order.fsm.mmd': ORDER_MMD_TEXT, 'machines/track.fsm.json': TRACK_TEXT });
  const result = gen(['check', '--project', root]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.startsWith('[fsm-gen] E_STORE_MIXED - $: '), true, result.stderr);
});

test('a mermaid line outside the canonical form exits 1 with E_MERMAID_UNSUPPORTED and its line', () => {
  const root = project({ 'fsm.config.json': MERMAID_CONFIG, 'machines/order.fsm.mmd': ORDER_MMD_TEXT.replace('    done : 2', '    done : 02') });
  const result = gen(['check', '--project', root]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.startsWith('[fsm-gen] E_MERMAID_UNSUPPORTED order $: line 8 '), true, result.stderr);
});

test('lock writes the lock of the definitions, and check then passes', () => {
  const root = project({ 'fsm.config.json': CONFIG_JSON, 'machines/order.fsm.json': ORDER_TEXT });
  assert.deepEqual(gen(['lock', '--project', root]), { status: 0, stdout: '[fsm-gen] lock: ok\n', stderr: '' });
  assert.equal(readFileSync(path.join(root, 'fsm.lock.json'), 'utf8'), ORDER_LOCK_TEXT);
  assert.equal(gen(['check', '--project', root]).status, 0);
});

test('lock --rename changes the state in the definition and the lock, and keeps the code', () => {
  const root = project({ 'fsm.config.json': CONFIG_JSON, 'machines/order.fsm.json': ORDER_TEXT, 'fsm.lock.json': ORDER_LOCK_TEXT });
  assert.equal(gen(['lock', '--rename', 'order.draft=started', '--project', root]).status, 0);
  const definition = JSON.parse(readFileSync(path.join(root, 'machines/order.fsm.json'), 'utf8'));
  assert.equal(definition.states[0].key, 'started');
  assert.equal(definition.states[0].code, 1);
  assert.equal(definition.events[0].edges[0].from, 'started');
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, 'fsm.lock.json'), 'utf8')).order.codes, { 1: 'started', 2: 'done' });
});

test('lock refused by a lock rule exits 1 and writes neither the definition nor the lock', () => {
  const changed = ORDER_TEXT.replace('"key": "draft"', '"key": "started"').replace('"from": "draft"', '"from": "started"');
  const root = project({ 'fsm.config.json': CONFIG_JSON, 'machines/order.fsm.json': changed, 'fsm.lock.json': ORDER_LOCK_TEXT });
  const result = gen(['lock', '--project', root]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.split('\n')[0].startsWith('[fsm-gen] E_CODE_KEY_CHANGED order $.states[0].code: '), true, result.stderr);
  assert.equal(readFileSync(path.join(root, 'fsm.lock.json'), 'utf8'), ORDER_LOCK_TEXT);
  assert.equal(readFileSync(path.join(root, 'machines/order.fsm.json'), 'utf8'), changed);
});

test('lock refused with E_CODE_CHANGED exits 1 and writes nothing', () => {
  const changed = ORDER_TEXT.replace('"code": 2', '"code": 7');
  const root = project({ 'fsm.config.json': CONFIG_JSON, 'machines/order.fsm.json': changed, 'fsm.lock.json': ORDER_LOCK_TEXT });
  const result = gen(['lock', '--project', root]);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.split('\n')[0].startsWith('[fsm-gen] E_CODE_CHANGED order $.states[1].code: '), true, result.stderr);
  assert.equal(readFileSync(path.join(root, 'fsm.lock.json'), 'utf8'), ORDER_LOCK_TEXT);
  assert.equal(readFileSync(path.join(root, 'machines/order.fsm.json'), 'utf8'), changed);
});

test('usage errors exit 2 with a usage line on stderr and nothing on stdout', () => {
  const root = project({ 'fsm.config.json': CONFIG_JSON });
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
    assert.equal(result.stderr.startsWith('[fsm-gen] usage: '), true, JSON.stringify(args));
  }
});

test('copy --to json into an empty target writes byte-identical machine files and lock', () => {
  const source = project({
    'fsm.config.json': CONFIG_JSON,
    'machines/order.fsm.json': ORDER_TEXT,
    'machines/track.fsm.json': TRACK_TEXT,
    'fsm.lock.json': LOCK_TEXT,
  });
  const target = path.join(project(), 'empty-target');
  assert.deepEqual(gen(['copy', '--to', 'json', '--project', source, '--root', target]), {
    status: 0,
    stdout: '[fsm-gen] copy: ok\n',
    stderr: '',
  });
  assert.deepEqual(filesOf(target), filesOf(source));
  assert.equal(readFileSync(path.join(target, 'fsm.lock.json'), 'utf8'), LOCK_TEXT);
});

test('copy --to json into a non-empty target exits 1 with E_STORE_NOT_EMPTY and writes nothing', () => {
  const source = project({
    'fsm.config.json': CONFIG_JSON,
    'machines/order.fsm.json': ORDER_TEXT,
    'fsm.lock.json': ORDER_LOCK_TEXT,
  });
  const target = project({ 'machines/order.fsm.json': ORDER_TEXT, 'fsm.lock.json': ORDER_LOCK_TEXT });
  const before = filesOf(target);
  const result = gen(['copy', '--to', 'json', '--project', source, '--root', target]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.startsWith('[fsm-gen] E_STORE_NOT_EMPTY - $: '), true, result.stderr);
  assert.deepEqual(filesOf(target), before);
});

test('copy --to mermaid into an empty target writes the files that the mermaid store writes for the same definitions', async () => {
  const source = project({
    'fsm.config.json': CONFIG_JSON,
    'machines/order.fsm.json': ORDER_TEXT,
    'machines/track.fsm.json': TRACK_TEXT,
    'fsm.lock.json': LOCK_TEXT,
  });
  const target = path.join(project(), 'empty-target');
  assert.deepEqual(gen(['copy', '--to', 'mermaid', '--project', source, '--root', target]), {
    status: 0,
    stdout: '[fsm-gen] copy: ok\n',
    stderr: '',
  });
  const expected = project();
  const loaded = await jsonStore(source).load();
  await mermaidStore(expected).save({ definitions: loaded.definitions, lock: loaded.lock });
  assert.deepEqual(filesOf(target), filesOf(expected));
  assert.deepEqual(filesOf(target), {
    'machines/order.fsm.mmd': ORDER_MMD_TEXT,
    'machines/track.fsm.mmd': TRACK_MMD_TEXT,
    'fsm.lock.json': LOCK_TEXT,
  });
});

test('copy --to mermaid into a non-empty target exits 1 with E_STORE_NOT_EMPTY and writes nothing', () => {
  const source = project({ 'fsm.config.json': CONFIG_JSON, 'machines/order.fsm.json': ORDER_TEXT, 'fsm.lock.json': ORDER_LOCK_TEXT });
  const target = project({ 'machines/order.fsm.mmd': ORDER_MMD_TEXT });
  const before = filesOf(target);
  const result = gen(['copy', '--to', 'mermaid', '--project', source, '--root', target]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.startsWith('[fsm-gen] E_STORE_NOT_EMPTY - $: '), true, result.stderr);
  assert.deepEqual(filesOf(target), before);
});

test('copy --to json from a mermaid project into an empty target writes the files that the json store writes for the same definitions', async () => {
  const source = project({
    'fsm.config.json': MERMAID_CONFIG,
    'machines/order.fsm.mmd': ORDER_MMD_TEXT,
    'machines/track.fsm.mmd': TRACK_MMD_TEXT,
    'fsm.lock.json': LOCK_TEXT,
  });
  const target = path.join(project(), 'empty-target');
  assert.deepEqual(gen(['copy', '--to', 'json', '--project', source, '--root', target]), {
    status: 0,
    stdout: '[fsm-gen] copy: ok\n',
    stderr: '',
  });
  const expected = project();
  const loaded = await mermaidStore(source).load();
  await jsonStore(expected).save({ definitions: loaded.definitions, lock: loaded.lock });
  assert.deepEqual(filesOf(target), filesOf(expected));
  assert.deepEqual(filesOf(target), {
    'machines/order.fsm.json': ORDER_TEXT,
    'machines/track.fsm.json': TRACK_TEXT,
    'fsm.lock.json': LOCK_TEXT,
  });
});

test('vectors writes the file <out> in the canonical form: two spaces, a final line break and the case order', () => {
  const root = project({ 'fsm.config.json': CONFIG_JSON, 'machines/order.fsm.json': ORDER_TEXT, 'fsm.lock.json': ORDER_LOCK_TEXT });
  const out = path.join(root, 'conformance/vectors.json');
  assert.deepEqual(gen(['vectors', '--project', root, '--out', out]), { status: 0, stdout: '[fsm-gen] vectors: ok\n', stderr: '' });
  const text = readFileSync(out, 'utf8');
  const parsed = JSON.parse(text);
  assert.equal(text, `${JSON.stringify(parsed, null, 2)}\n`);
  assert.deepEqual(parsed.machines.map(entry => entry.machine), ['order']);
  const { cases } = parsed.machines[0];
  assert.deepEqual(cases.slice(0, 2).map(entry => entry.id), ['order_initial', 'order_code_s0']);
  assert.equal(cases.length, 37);
  assert.equal(cases.at(-1).id, 'order_persist_retry');
});

test('vectors gives each case the feature, id and name that the parity checks read', () => {
  const root = project({ 'fsm.config.json': CONFIG_JSON, 'machines/order.fsm.json': ORDER_TEXT, 'fsm.lock.json': ORDER_LOCK_TEXT });
  assert.equal(gen(['vectors', '--project', root, '--out', path.join(root, 'conformance/vectors.json')]).status, 0);
  for (const { machine, cases } of JSON.parse(readFileSync(path.join(root, 'conformance/vectors.json'), 'utf8')).machines) {
    for (const entry of cases) {
      assert.equal(typeof entry.feature, 'string');
      assert.ok(entry.id.startsWith(`${machine}_`), entry.id);
      assert.equal(entry.name, `${entry.feature}__${entry.id}`);
    }
  }
});

test('vectors without --out exits 2 with a usage line', () => {
  const root = project({ 'fsm.config.json': CONFIG_JSON, 'machines/order.fsm.json': ORDER_TEXT, 'fsm.lock.json': ORDER_LOCK_TEXT });
  for (const args of [['vectors', '--project', root], ['vectors', '--out']]) {
    const result = gen(args);
    assert.equal(result.status, 2, JSON.stringify(args));
    assert.equal(result.stdout, '', JSON.stringify(args));
    assert.equal(result.stderr.startsWith('[fsm-gen] usage: '), true, JSON.stringify(args));
  }
});

test('vectors refused by a lock rule exits 1 and writes no vector file', () => {
  const root = project({ 'fsm.config.json': CONFIG_JSON, 'machines/order.fsm.json': ORDER_TEXT });
  const out = path.join(root, 'conformance/vectors');
  const result = gen(['vectors', '--project', root, '--out', out]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.split('\n')[0].startsWith('[fsm-gen] E_LOCK_MISMATCH order $: '), true, result.stderr);
  assert.equal(existsSync(out), false);
});
