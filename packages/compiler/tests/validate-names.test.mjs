// Tests of the name and code rules of packages/compiler/src/core/validate.mjs (docs/spec/fsm.md, B-5): each name
// and code error has its own failing case, and the expected findings are listed exactly. The reserved samples name one key
// of each fixed list; the lists themselves are in packages/compiler/src/core/reserved.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as lists from '../src/core/reserved.mjs';
import { renameState } from '../src/core/lock.mjs';
import { validate } from '../src/core/validate.mjs';

/** A valid machine: draft (initial) -next-> paid -next-> done (final). */
const base = () => ({
  machine: 'order',
  states: [{ key: 'draft', code: 1, initial: true }, { key: 'paid', code: 2 }, { key: 'done', code: 3, final: true }],
  events: [{ key: 'next', edges: [{ from: 'draft', to: 'paid' }, { from: 'paid', to: 'done' }] }],
});

/** The findings of `definitions` as `{code, machine, path}`, in order. */
const shape = definitions => validate(definitions).map(({ code, machine, path }) => ({ code, machine, path }));

/** The findings of the base machine changed by `change`. */
function names(change) {
  const definition = base();
  change(definition);
  return shape([definition]);
}

const at = (code, machine, path) => ({ code, machine, path });

test('the base machine has no findings', () => {
  assert.deepEqual(names(() => {}), []);
});

test('a machine key outside the key format fails E_KEY_FORMAT at machine', () => {
  for (const key of ['Order', '_order', 'order_', 'or__der', '1order', 'or-der']) {
    assert.deepEqual(names(d => { d.machine = key; }), [at('E_KEY_FORMAT', key, '$.machine')], key);
  }
});

test('a state or event key outside the key format fails E_KEY_FORMAT', () => {
  assert.deepEqual(names(d => renameState(d, 'paid', 'Paid')), [at('E_KEY_FORMAT', 'order', '$.states[1].key')]);
  assert.deepEqual(names(d => { d.events[0].key = 'next-step'; }), [at('E_KEY_FORMAT', 'order', '$.events[0].key')]);
});

test('a machine key on the fixed lists fails E_KEY_RESERVED at machine', () => {
  const samples = [
    'fsm', 'index', 'lib', 'main', 'internal', 'init', 'testdata', 'vendor',
    'error', 'len', 'iota', 'nil', 'func', 'range', 'fn', 'impl', 'gen', 'try',
    'def', 'lambda', 'nonlocal', 'function', 'var', 'typeof', 'implements', 'null', 'true', 'false',
  ];
  for (const key of samples) {
    assert.deepEqual(names(d => { d.machine = key; }), [at('E_KEY_RESERVED', key, '$.machine')], key);
  }
});

test('a machine key that the go test bed once declared is accepted: no generated go test file exists (B-5)', () => {
  // The names of the test files of the go test bed (examples, vectors, machines, expectation, lookup) were reserved while
  // fsm-gen wrote the test file; the compiler writes no test now, so a machine of any of these names is a valid key.
  for (const key of ['examples', 'vectors', 'machines', 'expectation', 'lookup']) {
    assert.deepEqual(names(d => { d.machine = key; }), [], key);
  }
});

test('the machine key tests is not reserved: a machine of that name builds with the go test files (measured by S-39)', () => {
  assert.deepEqual(names(d => { d.machine = 'tests'; }), []);
});

test('a machine key is compared after its underscores are removed', () => {
  assert.deepEqual(names(d => { d.machine = 'te_stdata'; }), [at('E_KEY_RESERVED', 'te_stdata', '$.machine')]);
  assert.deepEqual(names(d => { d.machine = 'in_it'; }), [at('E_KEY_RESERVED', 'in_it', '$.machine')]);
});

test('machine keys that only resemble a reserved key are not reserved', () => {
  for (const key of ['orders', 'order_item', 'fsmes', 'machine_init', 'functional']) {
    assert.deepEqual(names(d => { d.machine = key; }), [], key);
  }
});

test('a state key on the fixed lists fails E_KEY_RESERVED at the state', () => {
  const samples = [
    'self', 'class', 'note', 'classdef', 'style', 'click', 'href', 'default',
    'state', 'statediagram', 'scale', 'acctitle', 'accdescr', 'root_start', 'root_end',
  ];
  for (const key of samples) {
    assert.deepEqual(names(d => renameState(d, 'paid', key)), [at('E_KEY_RESERVED', 'order', '$.states[1].key')], key);
  }
});

test('an event key of self or class fails E_KEY_RESERVED at the event', () => {
  for (const key of ['self', 'class']) {
    assert.deepEqual(names(d => { d.events[0].key = key; }), [at('E_KEY_RESERVED', 'order', '$.events[0].key')], key);
  }
});

test('state and event keys outside their fixed lists are not reserved', () => {
  assert.deepEqual(names(d => renameState(d, 'paid', 'null')), []);
  assert.deepEqual(names(d => { d.events[0].key = 'note'; }), []);
});

test('a repeated machine key fails E_DUPLICATE_KEY at the later machine', () => {
  assert.deepEqual(shape([base(), base()]), [at('E_DUPLICATE_KEY', 'order', '$.machine')]);
});

test('machine keys equal after their underscores are removed fail E_DUPLICATE_KEY', () => {
  const first = base();
  first.machine = 'order_item';
  const second = base();
  second.machine = 'orderitem';
  assert.deepEqual(shape([first, second]), [at('E_DUPLICATE_KEY', 'orderitem', '$.machine')]);
});

test('a machine with a structural error is not compared with other machines', () => {
  const broken = base();
  broken.states = {};
  assert.deepEqual(shape([broken, base()]), [at('E_SCHEMA', 'order', '$.states')]);
});

test('a state key repeated in one machine fails E_DUPLICATE_KEY at the later state', () => {
  assert.deepEqual(names(d => { d.states.push({ key: 'done', code: 4, final: true }); }), [at('E_DUPLICATE_KEY', 'order', '$.states[3].key')]);
});

test('an event key repeated in one machine fails E_DUPLICATE_KEY at the later event', () => {
  assert.deepEqual(names(d => { d.events.push({ key: 'next', edges: [{ from: 'draft', to: 'done' }] }); }), [at('E_DUPLICATE_KEY', 'order', '$.events[1].key')]);
});

test('a code used twice in one machine fails E_DUPLICATE_CODE at the later state', () => {
  assert.deepEqual(names(d => { d.states[1].code = 1; }), [at('E_DUPLICATE_CODE', 'order', '$.states[1].code')]);
});

test('a code outside 1 to 2147483647 fails E_CODE_RANGE at the state', () => {
  for (const code of [0, -1, 2147483648]) {
    assert.deepEqual(names(d => { d.states[0].code = code; }), [at('E_CODE_RANGE', 'order', '$.states[0].code')], String(code));
  }
});

test('the codes 1 and 2147483647 are in range', () => {
  assert.deepEqual(names(d => { d.states[2].code = 2147483647; }), []);
});

test('a machine with a structural error reports only E_SCHEMA, not the name rules', () => {
  assert.deepEqual(names(d => { d.machine = 'fsm'; d.states = {}; }), [at('E_SCHEMA', 'fsm', '$.states')]);
});

test('every entry of each machine list is rejected as a machine key', () => {
  const machineLists = ['MACHINE_FIXED', 'GO_PREDECLARED', 'GO_KEYWORDS', 'RUST_KEYWORDS', 'PYTHON_KEYWORDS', 'JS_KEYWORDS', 'MACHINE_LITERALS'];
  for (const name of machineLists) {
    for (const key of lists[name]) {
      assert.ok(names(d => { d.machine = key; }).some(item => item.code === 'E_KEY_RESERVED'), `${name}: ${key}`);
    }
  }
});

test('every entry of the state and event lists is rejected as a state or event key', () => {
  for (const key of [...lists.STATE_EVENT_KEYS, ...lists.MERMAID_STATE_KEYS]) {
    assert.ok(names(d => renameState(d, 'paid', key)).some(item => item.code === 'E_KEY_RESERVED'), key);
  }
  for (const key of lists.STATE_EVENT_KEYS) {
    assert.ok(names(d => { d.events[0].key = key; }).some(item => item.code === 'E_KEY_RESERVED'), key);
  }
});

test('a machine, state or event key of 64 characters passes', () => {
  const key = 'a1'.repeat(32);
  assert.equal(key.length, 64);
  assert.deepEqual(names(d => { d.machine = key; }), []);
  assert.deepEqual(names(d => renameState(d, 'paid', key)), []);
  assert.deepEqual(names(d => { d.events[0].key = key; }), []);
});

test('a machine, state or event key of 65 characters fails E_KEY_FORMAT at its path, naming 65 and the maximum 64', () => {
  const key = 'a1'.repeat(32) + 'a';
  assert.equal(key.length, 65);
  const cases = [
    [d => { d.machine = key; }, at('E_KEY_FORMAT', key, '$.machine')],
    [d => renameState(d, 'paid', key), at('E_KEY_FORMAT', 'order', '$.states[1].key')],
    [d => { d.events[0].key = key; }, at('E_KEY_FORMAT', 'order', '$.events[0].key')],
  ];
  for (const [change, expected] of cases) {
    assert.deepEqual(names(change), [expected], expected.path);
    const definition = base();
    change(definition);
    const [finding] = validate([definition]);
    assert.match(finding.message, /65/, expected.path);
    assert.match(finding.message, /64/, expected.path);
  }
});
