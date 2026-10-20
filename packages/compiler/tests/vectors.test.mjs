// Tests of packages/compiler/src/core/vectors.mjs (docs/plans/fsm-v1/plan.md, C-4): the oracle of the conformance vectors,
// computed from the IR and the lock. The two-state machine is checked against tests/fixtures/vectors/two_step.json, which is
// written by hand and not by the code; the order example checks the order, the count and the coverage of its cases.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalize } from '../src/core/normalize.mjs';
import { FEATURES, vectors } from '../src/core/vectors.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

/** The order example of docs/spec/fsm.md, B-1. */
const order = () => ({
  machine: 'order',
  states: [
    { key: 'draft', code: 1, initial: true }, { key: 'paid', code: 2 },
    { key: 'shipped', code: 3 }, { key: 'done', code: 4, final: true },
    { key: 'canceled', code: 5, final: true },
  ],
  events: [
    { key: 'next', edges: [{ from: 'draft', to: 'paid' }, { from: 'paid', to: 'shipped' }, { from: 'shipped', to: 'done' }] },
    { key: 'prev', edges: [{ from: 'paid', to: 'draft' }, { from: 'shipped', to: 'paid' }] },
    { key: 'cancel', edges: [{ from: 'draft', to: 'canceled' }, { from: 'paid', to: 'canceled' }] },
  ],
});

/** A two-state machine: start (initial) -go-> end (final). */
const twoStep = () => ({
  machine: 'two_step',
  states: [{ key: 'start', code: 1, initial: true }, { key: 'end', code: 2, final: true }],
  events: [{ key: 'go', edges: [{ from: 'start', to: 'end' }] }],
});

/** The lock that holds the codes of `definition` and the reserved codes `reserved`. */
const lockOf = (definition, reserved = []) => ({
  [definition.machine]: { codes: Object.fromEntries(definition.states.map(state => [state.code, state.key])), reserved },
});

/** The vectors of `definition` with the lock of its codes and `reserved`. */
const generate = (definition, reserved) => vectors(normalize(definition), lockOf(definition, reserved));

const ids = result => result.cases.map(entry => entry.id);
const find = (result, id) => result.cases.find(entry => entry.id === id);

test('the two-state machine gives exactly the hand-written cases, in order and with the same key order', () => {
  const expected = JSON.parse(readFileSync(path.join(HERE, 'fixtures/vectors/two_step.json'), 'utf8'));
  const actual = generate(twoStep());
  assert.deepEqual(actual, expected);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
});

test('a two-state machine has no conflict case, because a third state does not exist', () => {
  assert.deepEqual(ids(generate(twoStep())).filter(id => id.startsWith('two_step_persist_')), [
    'two_step_persist_first',
    'two_step_persist_retry',
  ]);
});

test('the order example has 106 cases, the first is order_initial and the last order_persist_conflict', () => {
  const result = generate(order());
  assert.equal(result.machine, 'order');
  assert.equal(result.cases.length, 106);
  assert.equal(result.cases[0].id, 'order_initial');
  assert.equal(result.cases.at(-1).id, 'order_persist_conflict');
});

test('the order example has these cases per feature', () => {
  const counts = {};
  for (const entry of generate(order()).cases) counts[entry.feature] = (counts[entry.feature] ?? 0) + 1;
  assert.deepEqual(counts, {
    initial: 1, code: 7, key: 7, from_code: 14, is_final: 7, events_from: 5, target: 15, apply: 47, persist: 3,
  });
});

test('the cases of a state follow the declaration order: code, key, from_code, is_final, events_from', () => {
  const list = ids(generate(order()));
  assert.deepEqual(list.slice(1, 6), [
    'order_code_s0', 'order_key_s0', 'order_from_code_s0', 'order_is_final_s0', 'order_events_from_s0',
  ]);
  assert.deepEqual(list.slice(26, 29), ['order_from_code_zero', 'order_from_code_unknown', 'order_from_code_negative']);
  assert.equal(list.indexOf('order_from_code_int64_max'), 30);
  assert.equal(list.indexOf('order_from_code_string'), 31);
  assert.equal(list.indexOf('order_code_v0'), 35);
  assert.equal(list.indexOf('order_target_s0_e0'), 45);
  assert.equal(list.indexOf('order_apply_s0_e0_s0'), 60);
});

test('an id is built from indexes: a state is s<i> and an event e<j>, both 0-based, a reserved code r<code>', () => {
  const list = ids(generate(order(), [7]));
  assert.ok(list.includes('order_from_code_r7'));
  assert.ok(list.includes('order_target_s4_e2'));
  assert.ok(list.includes('order_apply_s1_e1_s0'));
  assert.ok(list.includes('order_persist_conflict'));
});

test('every id is unique, starts with the machine and holds lower-case words joined by single underscores', () => {
  for (const definition of [order(), twoStep()]) {
    const list = ids(generate(definition));
    assert.equal(new Set(list).size, list.length, `${definition.machine} has a repeated id`);
    for (const id of list) {
      assert.match(id, /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/, id);
      assert.ok(id.startsWith(`${definition.machine}_`), id);
    }
  }
});

test('every feature of contracts/features.json is the feature set of the oracle and has a case in the order example', () => {
  const registered = JSON.parse(readFileSync(path.join(ROOT, 'contracts/features.json'), 'utf8')).features;
  assert.deepEqual([...FEATURES], registered);
  const used = new Set(generate(order()).cases.map(entry => entry.feature));
  assert.deepEqual(registered.filter(feature => !used.has(feature)), []);
});

const NO_FIELDS = { expected: null, actual: null, event: null };

test('from_code: zero, the smallest positive code that is neither a code nor reserved, and each reserved code', () => {
  const result = generate(order(), [7, 9]);
  assert.deepEqual(find(result, 'order_from_code_zero'), {
    feature: 'from_code', id: 'order_from_code_zero', name: 'from_code__order_from_code_zero', input: '0', expect: { error: 'E_UNKNOWN_CODE', ...NO_FIELDS },
  });
  assert.deepEqual(find(result, 'order_from_code_unknown'), {
    feature: 'from_code', id: 'order_from_code_unknown', name: 'from_code__order_from_code_unknown', input: '6', expect: { error: 'E_UNKNOWN_CODE', ...NO_FIELDS },
  });
  assert.deepEqual(find(result, 'order_from_code_r7'), {
    feature: 'from_code', id: 'order_from_code_r7', name: 'from_code__order_from_code_r7', input: '7', expect: { error: 'E_RESERVED_CODE', ...NO_FIELDS },
  });
  assert.deepEqual(find(result, 'order_from_code_r9'), {
    feature: 'from_code', id: 'order_from_code_r9', name: 'from_code__order_from_code_r9', input: '9', expect: { error: 'E_RESERVED_CODE', ...NO_FIELDS },
  });
});

test('from_code: a negative code, 2^31 and the 64-bit maximum are E_UNKNOWN_CODE, given as exact decimal strings', () => {
  const result = generate(order());
  assert.deepEqual(find(result, 'order_from_code_negative').input, '-1');
  assert.deepEqual(find(result, 'order_from_code_int32_overflow').input, '2147483648');
  assert.deepEqual(find(result, 'order_from_code_int64_max'), {
    feature: 'from_code', id: 'order_from_code_int64_max', name: 'from_code__order_from_code_int64_max', input: '9223372036854775807', expect: { error: 'E_UNKNOWN_CODE', ...NO_FIELDS },
  });
});

test('every from_code input is a decimal string unless it names its type, so that no value of the 64-bit range is rounded', () => {
  for (const entry of generate(order()).cases.filter(item => item.feature === 'from_code')) {
    if (entry.input_type === undefined) assert.match(entry.input, /^-?[0-9]+$/, entry.id);
    else assert.ok(['string', 'bool', 'float'].includes(entry.input_type), entry.id);
  }
});

test('from_code of a value that is not an int is E_UNKNOWN_CODE, for every kind (B-6)', () => {
  const result = generate(order());
  const expect = { error: 'E_UNKNOWN_CODE', ...NO_FIELDS };
  assert.deepEqual(find(result, 'order_from_code_string'), {
    feature: 'from_code', id: 'order_from_code_string', name: 'from_code__order_from_code_string', input: '1', input_type: 'string', expect,
  });
  assert.deepEqual(find(result, 'order_from_code_bool'), {
    feature: 'from_code', id: 'order_from_code_bool', name: 'from_code__order_from_code_bool', input: 'true', input_type: 'bool', expect,
  });
  // The floats are non-integers: npm's number holds 1.0 as the int 1 (fsm.md, B-6), so an integer-valued float is no vector.
  assert.deepEqual(find(result, 'order_from_code_float'), {
    feature: 'from_code', id: 'order_from_code_float', name: 'from_code__order_from_code_float', input: '1.5', input_type: 'float', expect,
  });
  assert.deepEqual(find(result, 'order_from_code_fraction'), {
    feature: 'from_code', id: 'order_from_code_fraction', name: 'from_code__order_from_code_fraction', input: '1.25', input_type: 'float', expect,
  });
});

test('an invalid state value (0 and the unknown code) is given to code, key, is_final and apply, for every kind (B-6)', () => {
  const result = generate(order());
  const expect = { error: 'E_UNKNOWN_CODE', ...NO_FIELDS };
  assert.deepEqual(find(result, 'order_code_v0'), { feature: 'code', id: 'order_code_v0', name: 'code__order_code_v0', value: 0, expect });
  assert.deepEqual(find(result, 'order_is_final_v6'), { feature: 'is_final', id: 'order_is_final_v6', name: 'is_final__order_is_final_v6', value: 6, expect });
  assert.deepEqual(find(result, 'order_key_v0'), { feature: 'key', id: 'order_key_v0', name: 'key__order_key_v0', code: 0, expect });
  assert.deepEqual(find(result, 'order_apply_expected_v0_e0_s0'), {
    feature: 'apply', id: 'order_apply_expected_v0_e0_s0', name: 'apply__order_apply_expected_v0_e0_s0', expected_value: 0, event: 'next', actual: 'draft', expect,
  });
  assert.deepEqual(find(result, 'order_apply_actual_v6_e0_s0'), {
    feature: 'apply', id: 'order_apply_actual_v6_e0_s0', name: 'apply__order_apply_actual_v6_e0_s0', expected: 'draft', event: 'next', actual_value: 6, expect,
  });
});

test('a machine without events has no invalid apply case, because the apply needs an event', () => {
  const track = { machine: 'track', states: [{ key: 'only', code: 1, initial: true, final: true }], events: [] };
  assert.deepEqual(ids(generate(track)).filter(id => id.includes('_apply_')), []);
});

test('every implementation runs every case: no case carries a kinds field, and the invalid state values are cases (B-6)', () => {
  const { cases } = generate(order());
  assert.ok(cases.some(entry => entry.value !== undefined), 'the invalid state values are cases');
  assert.ok(cases.every(entry => !('kinds' in entry)), 'no case names the kinds that run it');
});

test('from_code unknown is the smallest gap: codes 1 and 3 leave 2', () => {
  const gap = {
    machine: 'gap',
    states: [{ key: 'a', code: 1, initial: true }, { key: 'b', code: 3, final: true }],
    events: [{ key: 'go', edges: [{ from: 'a', to: 'b' }] }],
  };
  assert.deepEqual(find(generate(gap), 'gap_from_code_unknown').input, '2');
});

test('from_code unknown skips the reserved codes that follow the codes of the states', () => {
  const result = generate(twoStep(), [3, 4]);
  assert.deepEqual(find(result, 'two_step_from_code_unknown').input, '5');
  assert.deepEqual(find(result, 'two_step_from_code_r3').expect, { error: 'E_RESERVED_CODE', ...NO_FIELDS });
  assert.deepEqual(find(result, 'two_step_from_code_r4').expect, { error: 'E_RESERVED_CODE', ...NO_FIELDS });
});

test('target gives the target of a defined pair and E_INVALID_TRANSITION for an undefined one', () => {
  const result = generate(twoStep());
  assert.deepEqual(find(result, 'two_step_target_s0_e0'), {
    feature: 'target', id: 'two_step_target_s0_e0', name: 'target__two_step_target_s0_e0', state: 'start', event: 'go', expect: { state: 'end' },
  });
  assert.deepEqual(find(result, 'two_step_target_s1_e0').expect, { error: 'E_INVALID_TRANSITION', expected: 2, actual: null, event: 1 });
});

test('apply: changed for the expected state, unchanged for the target, E_CONFLICT for every other state', () => {
  const result = generate(order());
  assert.deepEqual(find(result, 'order_apply_s0_e0_s0'), {
    feature: 'apply', id: 'order_apply_s0_e0_s0', name: 'apply__order_apply_s0_e0_s0', expected: 'draft', event: 'next', actual: 'draft', expect: { to: 'paid', changed: true },
  });
  assert.deepEqual(find(result, 'order_apply_s0_e0_s1').expect, { to: 'paid', changed: false });
  // E_CONFLICT carries the codes of expected and actual and the event position (docs/spec/fsm.md, B-4 and B-6).
  assert.deepEqual(find(result, 'order_apply_s0_e0_s2').expect, { error: 'E_CONFLICT', expected: 1, actual: 3, event: 1 });
  assert.deepEqual(find(result, 'order_apply_s0_e0_s3').expect, { error: 'E_CONFLICT', expected: 1, actual: 4, event: 1 });
  assert.deepEqual(find(result, 'order_apply_s0_e0_s4').expect, { error: 'E_CONFLICT', expected: 1, actual: 5, event: 1 });
});

test('apply for an undefined pair expects E_INVALID_TRANSITION with the state as expected and as actual', () => {
  assert.deepEqual(find(generate(order()), 'order_apply_s0_e1_s0'), {
    feature: 'apply', id: 'order_apply_s0_e1_s0', name: 'apply__order_apply_s0_e1_s0', expected: 'draft', event: 'prev', actual: 'draft',
    expect: { error: 'E_INVALID_TRANSITION', expected: 1, actual: null, event: 2 },
  });
});

test('persist: first, retry and conflict on the first transition of the order example', () => {
  const result = generate(order());
  assert.deepEqual(find(result, 'order_persist_first'), {
    feature: 'persist', id: 'order_persist_first', name: 'persist__order_persist_first', scenario: 'first', expected: 'draft', event: 'next', stored: 'draft',
    expect: { stored_after: 'paid', changed: true },
  });
  assert.deepEqual(find(result, 'order_persist_retry'), {
    feature: 'persist', id: 'order_persist_retry', name: 'persist__order_persist_retry', scenario: 'retry', expected: 'draft', event: 'next', stored: 'paid',
    expect: { stored_after: 'paid', changed: false },
  });
  assert.deepEqual(find(result, 'order_persist_conflict'), {
    feature: 'persist', id: 'order_persist_conflict', name: 'persist__order_persist_conflict', scenario: 'conflict', expected: 'draft', event: 'next', stored: 'shipped',
    expect: { error: 'E_CONFLICT', expected: 1, actual: 3, event: 1, stored_after: 'shipped' },
  });
});

test('two definitions that threw before, because their names collided, give their vectors with unique ids', () => {
  const collide = {
    machine: 'm',
    states: [{ key: 'a', code: 1, initial: true }, { key: 'a_b', code: 2 }],
    events: [{ key: 'b_c', edges: [{ from: 'a', to: 'a_b' }] }, { key: 'c', edges: [{ from: 'a_b', to: 'a' }] }],
  };
  const result = generate(collide);
  assert.equal(new Set(ids(result)).size, result.cases.length);
  assert.deepEqual(find(result, 'm_target_s0_e0').expect, { state: 'a_b' });
  assert.deepEqual(find(result, 'm_target_s1_e1').expect, { state: 'a' });
  assert.deepEqual(find(result, 'm_apply_s0_e0_s1').expect, { to: 'a_b', changed: false });
});

test('a state named zero gives its vectors, and its code case does not collide with the zero code case', () => {
  const zero = {
    machine: 'zero_state',
    states: [{ key: 'zero', code: 1, initial: true }, { key: 'end', code: 2, final: true }],
    events: [{ key: 'go', edges: [{ from: 'zero', to: 'end' }] }],
  };
  const result = generate(zero);
  assert.equal(new Set(ids(result)).size, result.cases.length);
  assert.deepEqual(find(result, 'zero_state_code_s0').expect, 1);
  assert.deepEqual(find(result, 'zero_state_from_code_zero').expect, { error: 'E_UNKNOWN_CODE', ...NO_FIELDS });
  assert.deepEqual(find(result, 'zero_state_from_code_s0').expect, { state: 'zero' });
  assert.deepEqual(find(result, 'zero_state_persist_first').expect, { stored_after: 'end', changed: true });
});

test('a one-state machine that is initial and final, with no event, gives the state cases and no persist case', () => {
  const track = { machine: 'track', states: [{ key: 'only', code: 1, initial: true, final: true }], events: [] };
  const result = generate(track);
  assert.deepEqual(ids(result), [
    'track_initial',
    'track_code_s0',
    'track_key_s0',
    'track_from_code_s0',
    'track_is_final_s0',
    'track_events_from_s0',
    'track_from_code_zero',
    'track_from_code_unknown',
    'track_from_code_negative',
    'track_from_code_int32_overflow',
    'track_from_code_int64_max',
    'track_from_code_string',
    'track_from_code_bool',
    'track_from_code_float',
    'track_from_code_fraction',
    'track_code_v0',
    'track_is_final_v0',
    'track_key_v0',
    'track_code_v2',
    'track_is_final_v2',
    'track_key_v2',
  ]);
  assert.deepEqual(find(result, 'track_is_final_s0').expect, true);
  assert.deepEqual(find(result, 'track_events_from_s0').expect, []);
  assert.deepEqual(find(result, 'track_from_code_unknown').input, '2');
});

test('a lock without an entry for the machine makes vectors throw', () => {
  assert.throws(() => vectors(normalize(twoStep()), {}), /the lock has no entry for machine two_step/);
});
