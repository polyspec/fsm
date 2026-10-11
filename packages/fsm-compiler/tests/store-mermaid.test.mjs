// Tests of the Mermaid store of packages/fsm-compiler/src/store-mermaid/store.mjs (docs/spec/fsm.md, B-1 to B-3): the
// store contract, the canonical bytes of save, the json -> mermaid -> json round trip of every valid fixture, one finding per
// line outside the canonical form, the name and mixed findings, the refusal of a definition the canonical form cannot carry,
// and the deletion of undefined Mermaid files. Every case runs in its own temporary directory, removed when the tests end.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { jsonStore } from '../src/store-json/store.mjs';
import { mermaidStore } from '../src/store-mermaid/store.mjs';
import {
  LOCK_TEXT, ORDER_MMD_TEXT, SPEC_ORDER_MMD_TEXT, TRACK_MMD_TEXT,
} from './canonical-texts.mjs';
import { bytesOf, filesOf, removeRoots, tempRoot, write } from './checkout.mjs';
import { storeContract } from './store-contract.mjs';

after(removeRoots);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures/valid');

/** The findings as {code, machine, path}. */
const shape = findings => findings.map(({ code, machine, path }) => ({ code, machine, path }));

/** The line number that a finding message gives first: `line <n> ...`. */
const lineOf = message => Number(/^line (\d+) /.exec(message)[1]);

/** The order definition of docs/spec/fsm.md with two states: draft (initial) -next-> done (final). */
const order = () => ({
  machine: 'order',
  states: [{ key: 'draft', code: 1, initial: true }, { key: 'done', code: 2, final: true }],
  events: [{ key: 'next', edges: [{ from: 'draft', to: 'done' }] }],
});

/** The track definition: one state that is initial and final, and no event. */
const track = () => ({ machine: 'track', states: [{ key: 'only', code: 1, initial: true, final: true }], events: [] });

/** The lock of order and track, in the order that the canonical lock writes. */
const lock = () => ({ track: { reserved: [], codes: { 1: 'only' } }, order: { reserved: [3], codes: { 2: 'done', 1: 'draft' } } });

/** A JSON checkout whose only machine file holds the bytes of the fixture tests/fixtures/valid/<name>.json. */
function jsonFixture(name) {
  const root = tempRoot();
  write(root, `machines/${name}.fsm.json`, readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));
  return root;
}

/** Loads a Mermaid checkout whose only machine file, order.fsm.mmd, holds `text`, and returns the findings. */
async function loadOrder(text) {
  const root = tempRoot();
  write(root, 'machines/order.fsm.mmd', text);
  return (await mermaidStore(root).load()).findings;
}

storeContract('mermaid', () => {
  const root = tempRoot();
  return { store: mermaidStore(root), snapshot: () => bytesOf(root) };
});

test('mermaid store: a missing lock file is the empty lock', async () => {
  const root = tempRoot();
  write(root, 'machines/order.fsm.mmd', ORDER_MMD_TEXT);
  const loaded = await mermaidStore(root).load();
  assert.deepEqual(loaded.lock, {});
  assert.deepEqual(shape(loaded.findings), []);
  assert.equal(loaded.definitions.length, 1);
});

test('mermaid store: load reads the Mermaid files in name order, and the lock of the canonical lock file', async () => {
  const root = tempRoot();
  write(root, 'machines/track.fsm.mmd', TRACK_MMD_TEXT);
  write(root, 'machines/order.fsm.mmd', ORDER_MMD_TEXT);
  write(root, 'fsm.lock.json', LOCK_TEXT);
  const loaded = await mermaidStore(root).load();
  assert.deepEqual(loaded.definitions.map(definition => definition.machine), ['order', 'track']);
  assert.deepEqual(loaded.definitions[0], order());
  assert.deepEqual(loaded.definitions[1], track());
  assert.deepEqual(loaded.lock, JSON.parse(LOCK_TEXT));
  assert.deepEqual(shape(loaded.findings), []);
});

test('mermaid store: save writes the canonical texts and the canonical lock', async () => {
  const root = tempRoot();
  await mermaidStore(root).save({ definitions: [order(), track()], lock: lock() });
  assert.deepEqual(filesOf(root), {
    'machines/order.fsm.mmd': ORDER_MMD_TEXT,
    'machines/track.fsm.mmd': TRACK_MMD_TEXT,
    'fsm.lock.json': LOCK_TEXT,
  });
});

test('mermaid store: save writes the spec example of B-1 for the order example', async () => {
  const source = await jsonStore(jsonFixture('order')).load();
  const root = tempRoot();
  await mermaidStore(root).save({ definitions: source.definitions, lock: source.lock });
  assert.equal(readFileSync(path.join(root, 'machines/order.fsm.mmd'), 'utf8'), SPEC_ORDER_MMD_TEXT);
});

test('mermaid store: a canonical checkout changes no byte on save(load())', async () => {
  const root = tempRoot();
  write(root, 'machines/order.fsm.mmd', ORDER_MMD_TEXT);
  write(root, 'machines/track.fsm.mmd', TRACK_MMD_TEXT);
  write(root, 'fsm.lock.json', LOCK_TEXT);
  const before = bytesOf(root);
  const store = mermaidStore(root);
  const loaded = await store.load();
  assert.deepEqual(shape(loaded.findings), []);
  await store.save({ definitions: loaded.definitions, lock: loaded.lock });
  assert.equal(bytesOf(root), before);
});

test('mermaid store: save deletes the Mermaid files that are no longer defined and leaves the JSON files alone', async () => {
  const root = tempRoot();
  write(root, 'machines/order.fsm.mmd', ORDER_MMD_TEXT);
  write(root, 'machines/track.fsm.mmd', TRACK_MMD_TEXT);
  write(root, 'machines/other.fsm.json', 'kept\n');
  await mermaidStore(root).save({ definitions: [track()], lock: { track: { reserved: [], codes: { 1: 'only' } } } });
  assert.equal(existsSync(path.join(root, 'machines/order.fsm.mmd')), false);
  assert.equal(readFileSync(path.join(root, 'machines/track.fsm.mmd'), 'utf8'), TRACK_MMD_TEXT);
  assert.equal(readFileSync(path.join(root, 'machines/other.fsm.json'), 'utf8'), 'kept\n');
});

test('mermaid store: a file whose name is not <title>.fsm.mmd fails E_SCHEMA at $.machine', async () => {
  const root = tempRoot();
  write(root, 'machines/wrong.fsm.mmd', ORDER_MMD_TEXT);
  assert.deepEqual(shape((await mermaidStore(root).load()).findings), [{ code: 'E_SCHEMA', machine: 'order', path: '$.machine' }]);
});

test('mermaid store: a file in machines that is not a fsm file fails E_SCHEMA', async () => {
  const root = tempRoot();
  write(root, 'machines/notes.txt', 'not a machine');
  assert.deepEqual(shape((await mermaidStore(root).load()).findings), [{ code: 'E_SCHEMA', machine: null, path: '$' }]);
});

test('mermaid store: a *.fsm.json file in machines fails E_STORE_MIXED', async () => {
  const root = tempRoot();
  write(root, 'machines/order.fsm.json', '{}\n');
  assert.deepEqual(shape((await mermaidStore(root).load()).findings), [{ code: 'E_STORE_MIXED', machine: null, path: '$' }]);
});

test('mermaid store: a lock file that is not valid JSON fails E_SCHEMA at $', async () => {
  const root = tempRoot();
  write(root, 'fsm.lock.json', '{ "order": ');
  assert.deepEqual(shape((await mermaidStore(root).load()).findings), [{ code: 'E_SCHEMA', machine: null, path: '$' }]);
});

/** The lines of the order example of the canonical form, one per constant (lines 1 to 9 of ORDER_MMD_TEXT). */
const HEAD = ['---', 'title: order', '---', 'stateDiagram-v2'];
const DRAFT = '    draft : 1';
const DONE = '    done : 2';
const INIT = '    [*] --> draft';
const EDGE = '    draft --> done : next';
const FINAL = '    done --> [*]';

/**
 * Each line outside the canonical form, in a file that is otherwise canonical, with the line numbers that the findings give.
 * The findings of a line-by-line parse are one per line, so each row lists every line that the parser refuses.
 */
const unsupportedCases = [
  ['a blank line', [...HEAD, DRAFT, '', DONE, INIT, EDGE, FINAL], [6]],
  ['a comment', [...HEAD, '    %% a comment', DRAFT, DONE, INIT, EDGE, FINAL], [5]],
  ['a note', [...HEAD, '    note right of draft : waiting', DRAFT, DONE, INIT, EDGE, FINAL], [5]],
  ['a state block', [...HEAD, '    state draft {', '    draft : 1', '    }', DONE, INIT, EDGE, FINAL], [5, 7]],
  ['a fork', [...HEAD, '    state split <<fork>>', DRAFT, DONE, INIT, EDGE, FINAL], [5]],
  ['a join', [...HEAD, '    state merge <<join>>', DRAFT, DONE, INIT, EDGE, FINAL], [5]],
  ['a choice', [...HEAD, '    state pick <<choice>>', DRAFT, DONE, INIT, EDGE, FINAL], [5]],
  ['a classDef', [...HEAD, '    classDef big fill:#f00', DRAFT, DONE, INIT, EDGE, FINAL], [5]],
  ['a class statement', [...HEAD, '    class draft big', DRAFT, DONE, INIT, EDGE, FINAL], [5]],
  ['a style statement', [...HEAD, '    style draft fill:#f00', DRAFT, DONE, INIT, EDGE, FINAL], [5]],
  ['a click statement', [...HEAD, '    click draft "https://example.com"', DRAFT, DONE, INIT, EDGE, FINAL], [5]],
  ['a direction statement', [...HEAD, '    direction LR', DRAFT, DONE, INIT, EDGE, FINAL], [5]],
  ['a wrong indentation', [...HEAD, '  draft : 1', DONE, INIT, EDGE, FINAL], [5]],
  ['a second description of a state', [...HEAD, DRAFT, DRAFT, DONE, INIT, EDGE, FINAL], [6]],
  ['a code with a leading zero', [...HEAD, '    draft : 01', DONE, INIT, EDGE, FINAL], [5]],
  ['an edge before the description of its state', [...HEAD, DRAFT, EDGE, DONE, INIT, FINAL], [6]],
  ['an initial line after an edge', [...HEAD, DRAFT, DONE, INIT, EDGE, INIT, FINAL], [9]],
  ['a final line before an edge', [...HEAD, DRAFT, DONE, INIT, FINAL, EDGE], [9]],
  ['an event that reappears after another event', [...HEAD, DRAFT, DONE, INIT, EDGE, '    done --> draft : prev', EDGE, FINAL], [10]],
  ['a final line out of state order', [...HEAD, DRAFT, DONE, INIT, EDGE, '    done --> [*]', '    draft --> [*]'], [10]],
  ['a missing initial line', [...HEAD, DRAFT, DONE, EDGE, FINAL], [7, 8, 9]],
  ['an empty file', [], [1]],
];

for (const [name, lines, expected] of unsupportedCases) {
  test(`mermaid store: ${name} fails E_MERMAID_UNSUPPORTED at its line`, async () => {
    const findings = await loadOrder(lines.map(line => `${line}\n`).join(''));
    assert.deepEqual(findings.map(({ code, machine, path: at }) => ({ code, machine, path: at })),
      expected.map(() => ({ code: 'E_MERMAID_UNSUPPORTED', machine: 'order', path: '$' })));
    assert.deepEqual(findings.map(finding => lineOf(finding.message)), expected);
  });
}

test('mermaid store: a file without a final line break fails E_MERMAID_UNSUPPORTED at its last line', async () => {
  const findings = await loadOrder(ORDER_MMD_TEXT.slice(0, -1));
  assert.deepEqual(shape(findings), [{ code: 'E_MERMAID_UNSUPPORTED', machine: 'order', path: '$' }]);
  assert.deepEqual(findings.map(finding => lineOf(finding.message)), [9]);
});

test('mermaid store: the canonical texts load without findings', async () => {
  assert.deepEqual(shape(await loadOrder(ORDER_MMD_TEXT)), []);
  assert.deepEqual(shape(await loadOrder(SPEC_ORDER_MMD_TEXT)), []);
});

for (const file of readdirSync(FIXTURES).filter(name => name.endsWith('.json')).sort()) {
  const name = file.slice(0, -'.json'.length);
  test(`mermaid store: the valid fixture ${name} round-trips json -> mermaid -> json byte-identically`, async () => {
    const source = await jsonStore(jsonFixture(name)).load();
    assert.deepEqual(shape(source.findings), []);
    const expected = tempRoot();
    await jsonStore(expected).save({ definitions: source.definitions, lock: source.lock });
    const middle = tempRoot();
    await mermaidStore(middle).save({ definitions: source.definitions, lock: source.lock });
    const mermaid = await mermaidStore(middle).load();
    assert.deepEqual(shape(mermaid.findings), []);
    assert.deepEqual(mermaid.definitions, source.definitions);
    assert.deepEqual(mermaid.lock, source.lock);
    const back = tempRoot();
    await jsonStore(back).save({ definitions: mermaid.definitions, lock: mermaid.lock });
    assert.equal(bytesOf(back), bytesOf(expected));
  });
}

/** Definitions that the canonical form cannot carry: save refuses them and writes nothing. */
const unrepresentable = [
  ['no initial state', { machine: 'order', states: [{ key: 'draft', code: 1 }], events: [] }, 'exactly one initial state'],
  ['two initial states', {
    machine: 'order', states: [{ key: 'draft', code: 1, initial: true }, { key: 'done', code: 2, initial: true }], events: [],
  }, 'exactly one initial state'],
  ['an event without edges', {
    machine: 'order', states: [{ key: 'draft', code: 1, initial: true }], events: [{ key: 'next', edges: [] }],
  }, 'has no edge'],
  ['a key that is not lower case', {
    machine: 'order', states: [{ key: 'Draft', code: 1, initial: true }], events: [],
  }, 'key Draft'],
];

for (const [name, definition, reason] of unrepresentable) {
  test(`mermaid store: save refuses ${name} and writes nothing`, async () => {
    const root = tempRoot();
    await assert.rejects(mermaidStore(root).save({ definitions: [definition], lock: {} }), error => error.message.includes(reason));
    assert.equal(bytesOf(root), '');
  });
}
