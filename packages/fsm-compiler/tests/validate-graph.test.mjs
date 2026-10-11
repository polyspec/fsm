// Tests of the graph rules of packages/fsm-compiler/src/core/validate.mjs (docs/spec/fsm.md, B-5): each graph error
// code has a failing case, and the expected findings are listed exactly, so a stray finding also fails the case.
import assert from 'node:assert/strict';
import test from 'node:test';
import { validate } from '../src/core/validate.mjs';

/** A valid machine: draft (initial) -next-> paid -next-> done (final), and draft -cancel-> done. */
const base = () => ({
  machine: 'order',
  states: [{ key: 'draft', code: 1, initial: true }, { key: 'paid', code: 2 }, { key: 'done', code: 3, final: true }],
  events: [
    { key: 'next', edges: [{ from: 'draft', to: 'paid' }, { from: 'paid', to: 'done' }] },
    { key: 'cancel', edges: [{ from: 'draft', to: 'done' }] },
  ],
});

/** The findings of the base machine changed by `change`, as `{code, machine, path}` in document order. */
function graph(change) {
  const definition = base();
  change(definition);
  return validate([definition]).map(({ code, machine, path }) => ({ code, machine, path }));
}

const at = (code, path) => ({ code, machine: 'order', path });

test('the base machine has no findings', () => {
  assert.deepEqual(graph(() => {}), []);
});

test('an edge to a state that does not exist fails E_UNKNOWN_STATE_REF at to', () => {
  assert.deepEqual(graph(d => { d.events[0].edges[1].to = 'ghost'; }), [
    at('E_UNKNOWN_STATE_REF', '$.events[0].edges[1].to'),
  ]);
});

test('an edge from a state that does not exist fails E_UNKNOWN_STATE_REF at from', () => {
  assert.deepEqual(graph(d => { d.events[0].edges[0].from = 'ghost'; }), [
    at('E_UNREACHABLE', '$.states[1]'),
    at('E_UNKNOWN_STATE_REF', '$.events[0].edges[0].from'),
  ]);
});

test('an edge from a state to itself fails E_SELF_LOOP', () => {
  assert.deepEqual(graph(d => { d.events[1].edges[0].to = 'draft'; }), [
    at('E_SELF_LOOP', '$.events[1].edges[0]'),
  ]);
});

test('two targets for the same state and event fail E_NONDETERMINISTIC at the second target', () => {
  assert.deepEqual(graph(d => { d.events[0].edges.push({ from: 'draft', to: 'done' }); }), [
    at('E_NONDETERMINISTIC', '$.events[0].edges[2]'),
  ]);
});

test('the same edge twice in one event fails E_DUPLICATE_EDGE', () => {
  assert.deepEqual(graph(d => { d.events[0].edges.push({ from: 'draft', to: 'paid' }); }), [
    at('E_DUPLICATE_EDGE', '$.events[0].edges[2]'),
  ]);
});

test('no initial state fails E_INITIAL_COUNT at states', () => {
  assert.deepEqual(graph(d => { delete d.states[0].initial; }), [
    at('E_INITIAL_COUNT', '$.states'),
  ]);
});

test('two initial states fail E_INITIAL_COUNT at states', () => {
  assert.deepEqual(graph(d => { d.states[1].initial = true; }), [
    at('E_INITIAL_COUNT', '$.states'),
  ]);
});

test('an edge leaving a final state fails E_FINAL_OUTGOING', () => {
  assert.deepEqual(graph(d => { d.events[1].edges.push({ from: 'done', to: 'draft' }); }), [
    at('E_FINAL_OUTGOING', '$.events[1].edges[1]'),
  ]);
});

test('a final state that no edge reaches fails E_UNREACHABLE', () => {
  assert.deepEqual(graph(d => { d.states.push({ key: 'island', code: 4, final: true }); }), [
    at('E_UNREACHABLE', '$.states[3]'),
  ]);
});

test('a non-final state that no edge reaches fails E_UNREACHABLE and E_DEAD_END', () => {
  assert.deepEqual(graph(d => { d.states.push({ key: 'island', code: 4 }); }), [
    at('E_UNREACHABLE', '$.states[3]'),
    at('E_DEAD_END', '$.states[3]'),
  ]);
});

test('a non-final state with no outgoing edge fails E_DEAD_END', () => {
  assert.deepEqual(graph(d => { d.events[0].edges.splice(1, 1); }), [
    at('E_DEAD_END', '$.states[1]'),
  ]);
});

test('a machine with a structural error reports only E_SCHEMA, and skips the graph rules', () => {
  assert.deepEqual(graph(d => {
    d.events[1].edges = [{ from: 'draft', to: 'draft' }, { from: 'draft', to: 'done', note: 'x' }];
  }), [
    at('E_SCHEMA', '$.events[1].edges[1].note'),
  ]);
});
