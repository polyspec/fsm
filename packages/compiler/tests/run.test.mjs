// Tests of the commands of packages/compiler/src/core/run.mjs (docs/spec/fsm.md, B-2 and B-3): run with check,
// lock and save, the stop on the load findings, and copy. The stores are in memory: load returns what the store holds, and
// save records each write, so a case can see whether a command wrote anything. The stores and the commands are async, so
// every case awaits them, and runOf and copyOf check that the command returns a Promise.
import assert from 'node:assert/strict';
import test from 'node:test';
import { copy, run } from '../src/core/run.mjs';

/** A store in memory. `writes` lists every save, in order. `baseline` is the committed lock (B-3); it defaults to the lock. */
function memory({ definitions = [], lock = {}, findings = [], baseline = lock } = {}) {
  const store = {
    writes: [],
    load: async () => structuredClone({ definitions, lock, baseline, findings }),
    save: async written => {
      store.writes.push(structuredClone(written));
    },
  };
  return store;
}

/** The result of run(...), which must be a Promise. */
async function runOf(...args) {
  const pending = run(...args);
  assert.ok(pending instanceof Promise, 'run must return a Promise');
  return pending;
}

/** The result of copy(...), which must be a Promise. */
async function copyOf(...args) {
  const pending = copy(...args);
  assert.ok(pending instanceof Promise, 'copy must return a Promise');
  return pending;
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
  code: 'E_SCHEMA', machine: 'order', path: '$.machine', message: 'the file name is not order.fsm.json',
};

test('an unknown command throws', async () => {
  await assert.rejects(runOf('deploy', memory()), { message: 'unknown command deploy' });
});

test('check of a matching store has no findings', async () => {
  assert.deepEqual(await runOf('check', memory({ definitions: [order()], lock: orderLock() })), { findings: [] });
});

test('check reports a lock mismatch', async () => {
  const result = await runOf('check', memory({ definitions: [order()] }));
  assert.deepEqual(shape(result.findings), [{ code: 'E_LOCK_MISMATCH', machine: 'order', path: '$' }]);
});

test('check reports the validation findings alone when the definitions are invalid', async () => {
  const definition = order();
  definition.states[1].code = 1;
  const result = await runOf('check', memory({ definitions: [definition], lock: orderLock() }));
  assert.deepEqual(shape(result.findings), [{ code: 'E_DUPLICATE_CODE', machine: 'order', path: '$.states[1].code' }]);
});

test('a load finding stops check, lock and save, and nothing is written', async () => {
  const store = memory({ definitions: [order()], findings: [loadFinding] });
  assert.deepEqual(await runOf('check', store), { findings: [loadFinding] });
  assert.deepEqual(await runOf('lock', store), { findings: [loadFinding] });
  assert.deepEqual(await runOf('save', store, { definitions: [order()] }), { findings: [loadFinding] });
  assert.equal(store.writes.length, 0);
});

test('lock writes the derived lock once and returns no findings', async () => {
  const store = memory({ definitions: [order()] });
  assert.deepEqual(await runOf('lock', store), { findings: [] });
  assert.deepEqual(store.writes, [{ definitions: [order()], lock: orderLock() }]);
});

test('lock repairs a stored lock that does not match the definitions', async () => {
  const store = memory({ definitions: [order()], lock: { order: { codes: { 1: 'draft' }, reserved: [] } } });
  assert.deepEqual(await runOf('lock', store), { findings: [] });
  assert.deepEqual(store.writes, [{ definitions: [order()], lock: orderLock() }]);
});

/** The order machine with the codes of draft and paid swapped. */
const swappedOrder = () => {
  const definition = order();
  definition.states[0].code = 2;
  definition.states[1].code = 1;
  return definition;
};

/** The lock that is committed for the order machine: the codes of orderLock, reserved empty. */
const committedOrder = () => orderLock();

test('lock refuses a swap of committed codes that an empty stored lock would accept (E_LOCK_REGRESSED)', async () => {
  const store = memory({ definitions: [swappedOrder()], lock: {}, baseline: committedOrder() });
  const result = await runOf('lock', store);
  assert.deepEqual(shape(result.findings), [
    { code: 'E_LOCK_REGRESSED', machine: 'order', path: '$.codes' },
    { code: 'E_LOCK_REGRESSED', machine: 'order', path: '$.codes' },
  ]);
  assert.equal(store.writes.length, 0);
});

test('lock repairs a stored lock that lost committed codes when the definitions keep their keys', async () => {
  const store = memory({ definitions: [order()], lock: {}, baseline: committedOrder() });
  assert.deepEqual(await runOf('lock', store), { findings: [] });
  assert.deepEqual(store.writes, [{ definitions: [order()], lock: orderLock() }]);
});

test('check refuses a consistent swap of the definitions and the lock (E_LOCK_REGRESSED)', async () => {
  const lock = { order: { codes: { 1: 'paid', 2: 'draft', 3: 'done' }, reserved: [] } };
  const result = await runOf('check', memory({ definitions: [swappedOrder()], lock, baseline: committedOrder() }));
  assert.deepEqual(shape(result.findings), [
    { code: 'E_LOCK_REGRESSED', machine: 'order', path: '$.codes' },
    { code: 'E_LOCK_REGRESSED', machine: 'order', path: '$.codes' },
  ]);
});

test('lock refuses to give a committed reserved code to a state (E_LOCK_REGRESSED on reserved)', async () => {
  const baseline = { order: { codes: { 1: 'draft', 2: 'paid' }, reserved: [3] } };
  const definition = order();
  const store = memory({ definitions: [definition], lock: {}, baseline });
  const result = await runOf('lock', store);
  assert.deepEqual(shape(result.findings), [{ code: 'E_LOCK_REGRESSED', machine: 'order', path: '$.reserved' }]);
  assert.equal(store.writes.length, 0);
});

test('a rename of a committed state keeps its code and is not a regression', async () => {
  const renamed = order();
  renamed.states[1].key = 'shipped';
  renamed.events[0].edges = [{ from: 'draft', to: 'shipped' }, { from: 'shipped', to: 'done' }];
  const lock = { order: { codes: { 1: 'draft', 2: 'shipped', 3: 'done' }, reserved: [] } };
  assert.deepEqual(await runOf('check', memory({ definitions: [renamed], lock, baseline: committedOrder() })), { findings: [] });
});

test('a committed state that left the definitions stays reserved and is not a regression', async () => {
  const lock = { order: { codes: { 1: 'draft', 3: 'done' }, reserved: [2] } };
  assert.deepEqual(await runOf('check', memory({ definitions: [shortOrder()], lock, baseline: committedOrder() })), { findings: [] });
});

test('lock refused by a lock rule writes nothing', async () => {
  const definition = order();
  definition.states[1].code = 4;
  const store = memory({ definitions: [definition], lock: { order: { codes: { 1: 'draft', 3: 'done' }, reserved: [4] } } });
  const result = await runOf('lock', store);
  assert.deepEqual(shape(result.findings), [{ code: 'E_CODE_REUSED', machine: 'order', path: '$.states[1].code' }]);
  assert.equal(store.writes.length, 0);
});

test('lock with a validation finding writes nothing', async () => {
  const definition = order();
  definition.states[1].code = 1;
  const store = memory({ definitions: [definition] });
  const result = await runOf('lock', store);
  assert.deepEqual(shape(result.findings), [{ code: 'E_DUPLICATE_CODE', machine: 'order', path: '$.states[1].code' }]);
  assert.equal(store.writes.length, 0);
});

test('lock applies a rename to the definitions and to the lock', async () => {
  const store = memory({ definitions: [order()], lock: orderLock() });
  assert.deepEqual(await runOf('lock', store, { renames: [{ machine: 'order', from: 'paid', to: 'shipped' }] }), { findings: [] });
  const renamed = order();
  renamed.states[1].key = 'shipped';
  renamed.events[0].edges = [{ from: 'draft', to: 'shipped' }, { from: 'shipped', to: 'done' }];
  assert.deepEqual(store.writes, [{ definitions: [renamed], lock: { order: { codes: { 1: 'draft', 2: 'shipped', 3: 'done' }, reserved: [] } } }]);
});

test('save writes the definitions of the options and the lock derived from them', async () => {
  const store = memory({ definitions: [order()], lock: orderLock() });
  assert.deepEqual(await runOf('save', store, { definitions: [shortOrder()] }), { findings: [] });
  assert.deepEqual(store.writes, [{ definitions: [shortOrder()], lock: { order: { codes: { 1: 'draft', 3: 'done' }, reserved: [2] } } }]);
});

test('save refuses a validation finding of the options and writes nothing', async () => {
  const store = memory({ definitions: [order()], lock: orderLock() });
  const result = await runOf('save', store, { definitions: [{ machine: 'order', states: 'draft', events: [] }] });
  assert.deepEqual(shape(result.findings), [{ code: 'E_SCHEMA', machine: 'order', path: '$.states' }]);
  assert.equal(store.writes.length, 0);
});

test('save without options.definitions is a programming error and throws', async () => {
  await assert.rejects(runOf('save', memory()), /options\.definitions/);
});

test('copy writes the source into an empty target', async () => {
  const from = memory({ definitions: [order()], lock: orderLock() });
  const to = memory();
  assert.deepEqual(await copyOf(from, to), { findings: [] });
  assert.deepEqual(to.writes, [{ definitions: [order()], lock: orderLock() }]);
});

test('copy refuses a target that holds a definition with E_STORE_NOT_EMPTY and writes nothing', async () => {
  const from = memory({ definitions: [order()], lock: orderLock() });
  const to = memory({ definitions: [order()] });
  assert.deepEqual(shape((await copyOf(from, to)).findings), [{ code: 'E_STORE_NOT_EMPTY', machine: null, path: '$' }]);
  assert.equal(to.writes.length, 0);
});

test('copy refuses a target that holds only a lock machine with E_STORE_NOT_EMPTY', async () => {
  const from = memory({ definitions: [order()], lock: orderLock() });
  const to = memory({ lock: { gone: { codes: {}, reserved: [] } } });
  assert.deepEqual(shape((await copyOf(from, to)).findings), [{ code: 'E_STORE_NOT_EMPTY', machine: null, path: '$' }]);
  assert.equal(to.writes.length, 0);
});

test('copy refuses a target with load findings with E_STORE_NOT_EMPTY', async () => {
  const from = memory({ definitions: [order()], lock: orderLock() });
  const to = memory({ findings: [loadFinding] });
  assert.deepEqual(shape((await copyOf(from, to)).findings), [{ code: 'E_STORE_NOT_EMPTY', machine: null, path: '$' }]);
  assert.equal(to.writes.length, 0);
});

test('copy returns the validation findings of the source and writes nothing', async () => {
  const definition = order();
  definition.states[1].code = 1;
  const from = memory({ definitions: [definition], lock: orderLock() });
  const to = memory();
  assert.deepEqual(shape((await copyOf(from, to)).findings), [{ code: 'E_DUPLICATE_CODE', machine: 'order', path: '$.states[1].code' }]);
  assert.equal(to.writes.length, 0);
});

test('copy returns the lock mismatch of the source and writes nothing', async () => {
  const from = memory({ definitions: [order()] });
  const to = memory();
  assert.deepEqual(shape((await copyOf(from, to)).findings), [{ code: 'E_LOCK_MISMATCH', machine: 'order', path: '$' }]);
  assert.equal(to.writes.length, 0);
});

test('copy returns the load findings of the source and writes nothing', async () => {
  const from = memory({ definitions: [order()], lock: orderLock(), findings: [loadFinding] });
  const to = memory();
  assert.deepEqual(await copyOf(from, to), { findings: [loadFinding] });
  assert.equal(to.writes.length, 0);
});

test('vectors returns the vectors of every machine, in the order of the store, and writes nothing', async () => {
  const pair = {
    machine: 'pair',
    states: [{ key: 'start', code: 1, initial: true }, { key: 'end', code: 2, final: true }],
    events: [{ key: 'go', edges: [{ from: 'start', to: 'end' }] }],
  };
  const lock = { ...orderLock(), pair: { codes: { 1: 'start', 2: 'end' }, reserved: [] } };
  const store = memory({ definitions: [order(), pair], lock });
  const result = await runOf('vectors', store, {});
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.vectors.map(entry => entry.machine), ['order', 'pair']);
  assert.equal(result.vectors[0].cases[0].id, 'order_initial');
  assert.equal(result.vectors[1].cases[0].id, 'pair_initial');
  assert.equal(store.writes.length, 0);
});

test('vectors returns the check findings and no vectors when a lock does not match', async () => {
  const store = memory({ definitions: [order()] });
  const result = await runOf('vectors', store, {});
  assert.deepEqual(shape(result.findings), [{ code: 'E_LOCK_MISMATCH', machine: 'order', path: '$' }]);
  assert.equal(Object.hasOwn(result, 'vectors'), false);
});

test('vectors returns the validation findings of the definitions before any vector', async () => {
  const definition = order();
  definition.states[1].code = 1;
  const result = await runOf('vectors', memory({ definitions: [definition], lock: orderLock() }), {});
  assert.deepEqual(shape(result.findings), [{ code: 'E_DUPLICATE_CODE', machine: 'order', path: '$.states[1].code' }]);
});

test('vectors stops on the load findings of the store', async () => {
  const result = await runOf('vectors', memory({ definitions: [order()], lock: orderLock(), findings: [loadFinding] }), {});
  assert.deepEqual(result, { findings: [loadFinding] });
});
