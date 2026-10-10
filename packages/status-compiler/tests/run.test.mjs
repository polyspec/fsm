// Tests of the commands of packages/status-compiler/src/core/run.mjs (docs/spec/status.md, B-2 and B-3): run with check,
// lock and save, the stop on the load findings, and copy. The stores are in memory: load returns what the store holds, and
// save records each write, so a case can see whether a command wrote anything.
import assert from 'node:assert/strict';
import test from 'node:test';
import { copy, run } from '../src/core/run.mjs';

/** A store in memory. `writes` lists every save, in order. */
function memory({ definitions = [], lock = {}, findings = [] } = {}) {
  const store = {
    writes: [],
    load: () => structuredClone({ definitions, lock, findings }),
    save: written => {
      store.writes.push(structuredClone(written));
    },
  };
  return store;
}

/** A valid machine: draft (initial) -next-> paid -next-> done (final). */
const order = () => ({
  machine: 'order',
  states: [{ key: 'draft', code: 1, initial: true }, { key: 'paid', code: 2 }, { key: 'done', code: 3, final: true }],
  events: [{ key: 'next', edges: [{ from: 'draft', to: 'paid' }, { from: 'paid', to: 'done' }] }],
});

/** The lock that matches the order machine above. */
const orderLock = () => ({ order: { codes: { 1: 'draft', 2: 'paid', 3: 'done' }, reserved: [] } });

/** The order machine without paid: draft -next-> done. */
const shortOrder = () => ({
  machine: 'order',
  states: [{ key: 'draft', code: 1, initial: true }, { key: 'done', code: 3, final: true }],
  events: [{ key: 'next', edges: [{ from: 'draft', to: 'done' }] }],
});

/** The findings as {code, machine, path}. */
const shape = findings => findings.map(({ code, machine, path }) => ({ code, machine, path }));

const loadFinding = {
  code: 'E_SCHEMA', machine: 'order', path: '$.machine', message: 'the file name is not order.status.json',
};

test('an unknown command throws', () => {
  assert.throws(() => run('gen', memory()), { message: 'unknown command gen' });
});

test('check of a matching store has no findings', () => {
  assert.deepEqual(run('check', memory({ definitions: [order()], lock: orderLock() })), { findings: [] });
});

test('check reports a lock mismatch', () => {
  const result = run('check', memory({ definitions: [order()] }));
  assert.deepEqual(shape(result.findings), [{ code: 'E_LOCK_MISMATCH', machine: 'order', path: '$' }]);
});

test('check reports the validation findings alone when the definitions are invalid', () => {
  const definition = order();
  definition.states[1].code = 1;
  const result = run('check', memory({ definitions: [definition], lock: orderLock() }));
  assert.deepEqual(shape(result.findings), [{ code: 'E_DUPLICATE_CODE', machine: 'order', path: '$.states[1].code' }]);
});

test('a load finding stops check, lock and save, and nothing is written', () => {
  const store = memory({ definitions: [order()], findings: [loadFinding] });
  assert.deepEqual(run('check', store), { findings: [loadFinding] });
  assert.deepEqual(run('lock', store), { findings: [loadFinding] });
  assert.deepEqual(run('save', store, { definitions: [order()] }), { findings: [loadFinding] });
  assert.equal(store.writes.length, 0);
});

test('lock writes the derived lock once and returns no findings', () => {
  const store = memory({ definitions: [order()] });
  assert.deepEqual(run('lock', store), { findings: [] });
  assert.deepEqual(store.writes, [{ definitions: [order()], lock: orderLock() }]);
});

test('lock repairs a stored lock that does not match the definitions', () => {
  const store = memory({ definitions: [order()], lock: { order: { codes: { 1: 'draft' }, reserved: [] } } });
  assert.deepEqual(run('lock', store), { findings: [] });
  assert.deepEqual(store.writes, [{ definitions: [order()], lock: orderLock() }]);
});

test('lock refused by a lock rule writes nothing', () => {
  const definition = order();
  definition.states[1].code = 4;
  const store = memory({ definitions: [definition], lock: { order: { codes: { 1: 'draft', 3: 'done' }, reserved: [4] } } });
  assert.deepEqual(shape(run('lock', store).findings), [{ code: 'E_CODE_REUSED', machine: 'order', path: '$.states[1].code' }]);
  assert.equal(store.writes.length, 0);
});

test('lock with a validation finding writes nothing', () => {
  const definition = order();
  definition.states[1].code = 1;
  const store = memory({ definitions: [definition] });
  assert.deepEqual(shape(run('lock', store).findings), [{ code: 'E_DUPLICATE_CODE', machine: 'order', path: '$.states[1].code' }]);
  assert.equal(store.writes.length, 0);
});

test('lock applies a rename to the definitions and to the lock', () => {
  const store = memory({ definitions: [order()], lock: orderLock() });
  assert.deepEqual(run('lock', store, { renames: [{ machine: 'order', from: 'paid', to: 'shipped' }] }), { findings: [] });
  const renamed = order();
  renamed.states[1].key = 'shipped';
  renamed.events[0].edges = [{ from: 'draft', to: 'shipped' }, { from: 'shipped', to: 'done' }];
  assert.deepEqual(store.writes, [{ definitions: [renamed], lock: { order: { codes: { 1: 'draft', 2: 'shipped', 3: 'done' }, reserved: [] } } }]);
});

test('save writes the definitions of the options and the lock derived from them', () => {
  const store = memory({ definitions: [order()], lock: orderLock() });
  assert.deepEqual(run('save', store, { definitions: [shortOrder()] }), { findings: [] });
  assert.deepEqual(store.writes, [{ definitions: [shortOrder()], lock: { order: { codes: { 1: 'draft', 3: 'done' }, reserved: [2] } } }]);
});

test('save refuses a validation finding of the options and writes nothing', () => {
  const store = memory({ definitions: [order()], lock: orderLock() });
  const result = run('save', store, { definitions: [{ machine: 'order', states: 'draft', events: [] }] });
  assert.deepEqual(shape(result.findings), [{ code: 'E_SCHEMA', machine: 'order', path: '$.states' }]);
  assert.equal(store.writes.length, 0);
});

test('save without options.definitions is a programming error and throws', () => {
  assert.throws(() => run('save', memory()), /options\.definitions/);
});

test('copy writes the source into an empty target', () => {
  const from = memory({ definitions: [order()], lock: orderLock() });
  const to = memory();
  assert.deepEqual(copy(from, to), { findings: [] });
  assert.deepEqual(to.writes, [{ definitions: [order()], lock: orderLock() }]);
});

test('copy refuses a target that holds a definition with E_STORE_NOT_EMPTY and writes nothing', () => {
  const from = memory({ definitions: [order()], lock: orderLock() });
  const to = memory({ definitions: [order()] });
  assert.deepEqual(shape(copy(from, to).findings), [{ code: 'E_STORE_NOT_EMPTY', machine: null, path: '$' }]);
  assert.equal(to.writes.length, 0);
});

test('copy refuses a target that holds only a lock machine with E_STORE_NOT_EMPTY', () => {
  const from = memory({ definitions: [order()], lock: orderLock() });
  const to = memory({ lock: { gone: { codes: {}, reserved: [] } } });
  assert.deepEqual(shape(copy(from, to).findings), [{ code: 'E_STORE_NOT_EMPTY', machine: null, path: '$' }]);
  assert.equal(to.writes.length, 0);
});

test('copy refuses a target with load findings with E_STORE_NOT_EMPTY', () => {
  const from = memory({ definitions: [order()], lock: orderLock() });
  const to = memory({ findings: [loadFinding] });
  assert.deepEqual(shape(copy(from, to).findings), [{ code: 'E_STORE_NOT_EMPTY', machine: null, path: '$' }]);
  assert.equal(to.writes.length, 0);
});

test('copy returns the validation findings of the source and writes nothing', () => {
  const definition = order();
  definition.states[1].code = 1;
  const from = memory({ definitions: [definition], lock: orderLock() });
  const to = memory();
  assert.deepEqual(shape(copy(from, to).findings), [{ code: 'E_DUPLICATE_CODE', machine: 'order', path: '$.states[1].code' }]);
  assert.equal(to.writes.length, 0);
});

test('copy returns the lock mismatch of the source and writes nothing', () => {
  const from = memory({ definitions: [order()] });
  const to = memory();
  assert.deepEqual(shape(copy(from, to).findings), [{ code: 'E_LOCK_MISMATCH', machine: 'order', path: '$' }]);
  assert.equal(to.writes.length, 0);
});

test('copy returns the load findings of the source and writes nothing', () => {
  const from = memory({ definitions: [order()], lock: orderLock(), findings: [loadFinding] });
  const to = memory();
  assert.deepEqual(copy(from, to), { findings: [loadFinding] });
  assert.equal(to.writes.length, 0);
});
