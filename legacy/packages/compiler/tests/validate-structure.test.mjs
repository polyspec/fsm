// Tests of the structure rule E_SCHEMA of packages/compiler/src/core/validate.mjs (docs/spec/fsm.md, B-5): each
// structural error has a failing case with its code, machine and JSON path, and the findings come in document order.
import assert from 'node:assert/strict';
import test from 'node:test';
import { validate } from '../src/core/validate.mjs';
import { twoStateOrder as base } from './order-machines.mjs';

/** The findings of `definitions` as `{code, machine, path}`, without the messages. */
const shape = definitions => validate(definitions).map(({ code, machine, path }) => ({ code, machine, path }));

/** The one E_SCHEMA finding of a machine changed by `change`. */
function only(change) {
  const definition = base();
  change(definition);
  return shape([definition]);
}

test('a valid machine has no findings', () => {
  assert.deepEqual(validate([base()]), []);
});

test('an empty list of machines has no findings', () => {
  assert.deepEqual(validate([]), []);
});

test('definitions that are not a list fail E_SCHEMA at the root', () => {
  assert.deepEqual(shape({ machine: 'order' }), [{ code: 'E_SCHEMA', machine: null, path: '$' }]);
});

test('a machine that is not an object fails E_SCHEMA at the root', () => {
  assert.deepEqual(shape(['order']), [{ code: 'E_SCHEMA', machine: null, path: '$' }]);
});

test('a missing machine field fails E_SCHEMA at the machine object', () => {
  assert.deepEqual(only(d => { delete d.machine; }), [{ code: 'E_SCHEMA', machine: null, path: '$' }]);
});

test('a machine that is not a string fails E_SCHEMA at machine', () => {
  assert.deepEqual(only(d => { d.machine = 7; }), [{ code: 'E_SCHEMA', machine: null, path: '$.machine' }]);
});

test('a missing states field fails E_SCHEMA at the machine object', () => {
  assert.deepEqual(only(d => { delete d.states; }), [{ code: 'E_SCHEMA', machine: 'order', path: '$' }]);
});

test('states that are not an array fail E_SCHEMA at states', () => {
  assert.deepEqual(only(d => { d.states = {}; }), [{ code: 'E_SCHEMA', machine: 'order', path: '$.states' }]);
});

test('a state that is not an object fails E_SCHEMA at the state', () => {
  assert.deepEqual(only(d => { d.states[0] = 'draft'; }), [{ code: 'E_SCHEMA', machine: 'order', path: '$.states[0]' }]);
});

test('a state without a key fails E_SCHEMA at the state', () => {
  assert.deepEqual(only(d => { delete d.states[0].key; }), [{ code: 'E_SCHEMA', machine: 'order', path: '$.states[0]' }]);
});

test('a state without a code fails E_SCHEMA at the state', () => {
  assert.deepEqual(only(d => { delete d.states[0].code; }), [{ code: 'E_SCHEMA', machine: 'order', path: '$.states[0]' }]);
});

test('an unknown field of a state fails E_SCHEMA at that field', () => {
  assert.deepEqual(only(d => { d.states[0].label = 'Draft'; }), [{ code: 'E_SCHEMA', machine: 'order', path: '$.states[0].label' }]);
});

test('a state key that is not a string fails E_SCHEMA at key', () => {
  assert.deepEqual(only(d => { d.states[0].key = 1; }), [{ code: 'E_SCHEMA', machine: 'order', path: '$.states[0].key' }]);
});

test('a code that is not an integer fails E_SCHEMA at code', () => {
  assert.deepEqual(only(d => { d.states[0].code = '1'; }), [{ code: 'E_SCHEMA', machine: 'order', path: '$.states[0].code' }]);
  assert.deepEqual(only(d => { d.states[0].code = 1.5; }), [{ code: 'E_SCHEMA', machine: 'order', path: '$.states[0].code' }]);
});

test('initial false fails E_SCHEMA, because the canonical form omits it', () => {
  assert.deepEqual(only(d => { d.states[0].initial = false; }), [{ code: 'E_SCHEMA', machine: 'order', path: '$.states[0].initial' }]);
});

test('final false fails E_SCHEMA, because the canonical form omits it', () => {
  assert.deepEqual(only(d => { d.states[1].final = false; }), [{ code: 'E_SCHEMA', machine: 'order', path: '$.states[1].final' }]);
});

test('events that are not an array fail E_SCHEMA at events', () => {
  assert.deepEqual(only(d => { d.events = {}; }), [{ code: 'E_SCHEMA', machine: 'order', path: '$.events' }]);
});

test('an event without a key fails E_SCHEMA at the event', () => {
  assert.deepEqual(only(d => { delete d.events[0].key; }), [{ code: 'E_SCHEMA', machine: 'order', path: '$.events[0]' }]);
});

test('an unknown field of an event fails E_SCHEMA at that field', () => {
  assert.deepEqual(only(d => { d.events[0].label = 'Next'; }), [{ code: 'E_SCHEMA', machine: 'order', path: '$.events[0].label' }]);
});

test('an event without edges fails E_SCHEMA at the event', () => {
  assert.deepEqual(only(d => { delete d.events[0].edges; }), [{ code: 'E_SCHEMA', machine: 'order', path: '$.events[0]' }]);
});

test('edges that are not an array fail E_SCHEMA at edges', () => {
  assert.deepEqual(only(d => { d.events[0].edges = {}; }), [{ code: 'E_SCHEMA', machine: 'order', path: '$.events[0].edges' }]);
});

test('an event with no edge fails E_SCHEMA at edges', () => {
  assert.deepEqual(only(d => { d.events[0].edges = []; }), [{ code: 'E_SCHEMA', machine: 'order', path: '$.events[0].edges' }]);
});

test('an edge written as a pair fails E_SCHEMA at the edge', () => {
  assert.deepEqual(only(d => { d.events[0].edges = [['draft', 'done']]; }), [{ code: 'E_SCHEMA', machine: 'order', path: '$.events[0].edges[0]' }]);
});

test('an edge without to fails E_SCHEMA at the edge', () => {
  assert.deepEqual(only(d => { delete d.events[0].edges[0].to; }), [{ code: 'E_SCHEMA', machine: 'order', path: '$.events[0].edges[0]' }]);
});

test('an unknown field of an edge fails E_SCHEMA at that field', () => {
  assert.deepEqual(only(d => { d.events[0].edges[0].guard = 'x'; }), [{ code: 'E_SCHEMA', machine: 'order', path: '$.events[0].edges[0].guard' }]);
});

test('an edge endpoint that is not a string fails E_SCHEMA at that endpoint', () => {
  assert.deepEqual(only(d => { d.events[0].edges[0].from = 1; }), [{ code: 'E_SCHEMA', machine: 'order', path: '$.events[0].edges[0].from' }]);
});

test('a stored $schema field is an unknown field, because the store strips it', () => {
  assert.deepEqual(only(d => { d.$schema = '../schema/fsm.schema.json'; }), [{ code: 'E_SCHEMA', machine: 'order', path: '$.$schema' }]);
});

test('findings come in document order, and machines in input order', () => {
  const first = base();
  first.events[0].edges = [['draft', 'done']];
  first.states[1].code = 'two';
  const second = base();
  second.machine = 'other';
  second.states[0].initial = false;
  assert.deepEqual(shape([first, second]), [
    { code: 'E_SCHEMA', machine: 'order', path: '$.states[1].code' },
    { code: 'E_SCHEMA', machine: 'order', path: '$.events[0].edges[0]' },
    { code: 'E_SCHEMA', machine: 'other', path: '$.states[0].initial' },
  ]);
});
