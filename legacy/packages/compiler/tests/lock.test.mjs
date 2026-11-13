// Tests of the code lock of packages/compiler/src/core/lock.mjs (docs/spec/fsm.md, B-3): the mismatch between the
// lock and the definitions, every refusal of nextLock, the rename, the vanished states and machines, the canonical order
// and the next code. Each finding is compared as {code, machine, path}, so a stray finding also fails the case.
import assert from 'node:assert/strict';
import test from 'node:test';
import { lockMismatch, nextCode, nextLock } from '../src/core/lock.mjs';
import { shapeFindings as shape, threeStateLock as orderLock, threeStateOrder as order } from './order-machines.mjs';

/** The order machine whose state paid has the code `code` and comes after done in the declaration. */
const orderWithPaidAt = code => ({
  machine: 'order',
  states: [{ key: 'draft', code: 1, initial: true }, { key: 'done', code: 3, final: true }, { key: 'paid', code }],
  events: [{ key: 'next', edges: [{ from: 'draft', to: 'paid' }, { from: 'paid', to: 'done' }] }],
});

test('a lock that matches the definitions has no mismatch', () => {
  assert.deepEqual(lockMismatch([order()], orderLock()), []);
});

test('a defined machine without a lock entry is a mismatch at $', () => {
  assert.deepEqual(shape(lockMismatch([order()], {})), [{ code: 'E_LOCK_MISMATCH', machine: 'order', path: '$' }]);
});

test('a lock whose codes differ from the state codes is a mismatch at $.codes', () => {
  const lock = orderLock();
  lock.order.codes[2] = 'shipped';
  assert.deepEqual(shape(lockMismatch([order()], lock)), [{ code: 'E_LOCK_MISMATCH', machine: 'order', path: '$.codes' }]);
});

test('a state code missing from the lock is a mismatch at $.codes', () => {
  const lock = orderLock();
  delete lock.order.codes[3];
  assert.deepEqual(shape(lockMismatch([order()], lock)), [{ code: 'E_LOCK_MISMATCH', machine: 'order', path: '$.codes' }]);
});

test('a reserved code that a state uses is a mismatch at $.reserved', () => {
  const lock = orderLock();
  lock.order.reserved = [2];
  assert.deepEqual(shape(lockMismatch([order()], lock)), [{ code: 'E_LOCK_MISMATCH', machine: 'order', path: '$.reserved' }]);
});

test('a lock machine that is not defined and has codes is a mismatch at $.codes', () => {
  const lock = { ...orderLock(), gone: { codes: { 7: 'old' }, reserved: [] } };
  assert.deepEqual(shape(lockMismatch([order()], lock)), [{ code: 'E_LOCK_MISMATCH', machine: 'gone', path: '$.codes' }]);
});

test('a lock machine that is not defined and has empty codes is not a mismatch', () => {
  const lock = { ...orderLock(), gone: { codes: {}, reserved: [7] } };
  assert.deepEqual(lockMismatch([order()], lock), []);
});

test('a new state that takes a reserved code is refused with E_CODE_REUSED and the lock is not written', () => {
  const definition = order();
  definition.states.splice(2, 0, { key: 'hold', code: 4 });
  definition.events.push({ key: 'hold', edges: [{ from: 'draft', to: 'hold' }, { from: 'hold', to: 'done' }] });
  const lock = orderLock();
  lock.order.reserved = [4];
  const result = nextLock([definition], lock, { renames: [] });
  assert.deepEqual(shape(result.findings), [{ code: 'E_CODE_REUSED', machine: 'order', path: '$.states[2].code' }]);
  assert.deepEqual(result.lock, lock);
});

test('an existing code whose state key changed is refused with E_CODE_KEY_CHANGED without a rename', () => {
  const definition = order();
  definition.states[1].key = 'shipped';
  definition.events[0].edges = [{ from: 'draft', to: 'shipped' }, { from: 'shipped', to: 'done' }];
  const result = nextLock([definition], orderLock(), { renames: [] });
  assert.deepEqual(shape(result.findings), [{ code: 'E_CODE_KEY_CHANGED', machine: 'order', path: '$.states[1].code' }]);
});

test('a rename changes the key in the states, the edges and the lock, and keeps the code', () => {
  const result = nextLock([order()], orderLock(), { renames: [{ machine: 'order', from: 'paid', to: 'shipped' }] });
  const renamed = order();
  renamed.states[1].key = 'shipped';
  renamed.events[0].edges = [{ from: 'draft', to: 'shipped' }, { from: 'shipped', to: 'done' }];
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.definitions, [renamed]);
  assert.deepEqual(result.lock, { order: { codes: { 1: 'draft', 2: 'shipped', 3: 'done' }, reserved: [] } });
});

test('a rename of a state or a machine that does not exist is refused with E_UNKNOWN_STATE_REF', () => {
  const missingState = nextLock([order()], orderLock(), { renames: [{ machine: 'order', from: 'ghost', to: 'x' }] });
  assert.deepEqual(shape(missingState.findings), [{ code: 'E_UNKNOWN_STATE_REF', machine: 'order', path: '$.states' }]);
  const missingMachine = nextLock([order()], orderLock(), { renames: [{ machine: 'nope', from: 'paid', to: 'x' }] });
  assert.deepEqual(shape(missingMachine.findings), [{ code: 'E_UNKNOWN_STATE_REF', machine: 'nope', path: '$' }]);
});

test('a state that vanished moves its code to reserved', () => {
  const definition = {
    machine: 'order',
    states: [{ key: 'draft', code: 1, initial: true }, { key: 'done', code: 3, final: true }],
    events: [{ key: 'next', edges: [{ from: 'draft', to: 'done' }] }],
  };
  const result = nextLock([definition], orderLock(), { renames: [] });
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.lock, { order: { codes: { 1: 'draft', 3: 'done' }, reserved: [2] } });
});

test('a new state takes a new code and joins the codes of its machine', () => {
  const definition = order();
  definition.states.push({ key: 'hold', code: 4 });
  definition.events.push({ key: 'hold', edges: [{ from: 'draft', to: 'hold' }, { from: 'hold', to: 'done' }] });
  const result = nextLock([definition], orderLock(), { renames: [] });
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.lock, { order: { codes: { 1: 'draft', 2: 'paid', 3: 'done', 4: 'hold' }, reserved: [] } });
});

test('a machine that vanished moves all its codes to reserved and keeps its entry', () => {
  const result = nextLock([], orderLock(), { renames: [] });
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.lock, { order: { codes: {}, reserved: [1, 2, 3] } });
});

test('the result lock is canonical: machines by name, codes numerically, reserved ascending', () => {
  const zeta = {
    machine: 'zeta',
    states: [
      { key: 's10', code: 10, initial: true },
      { key: 's2', code: 2, final: true },
      { key: 's1', code: 1, final: true },
    ],
    events: [
      { key: 'e', edges: [{ from: 's10', to: 's2' }] },
      { key: 'f', edges: [{ from: 's10', to: 's1' }] },
    ],
  };
  const lock = {
    zeta: { codes: { 10: 's10', 2: 's2', 1: 's1' }, reserved: [12, 9, 3] },
    alpha: { codes: {}, reserved: [7] },
  };
  const result = nextLock([zeta], lock, { renames: [] });
  assert.deepEqual(result.findings, []);
  assert.equal(
    JSON.stringify(result.lock),
    JSON.stringify({ alpha: { codes: {}, reserved: [7] }, zeta: { codes: { 1: 's1', 2: 's2', 10: 's10' }, reserved: [3, 9, 12] } }),
  );
});

test('nextCode is the largest code of the definitions, the lock and the reserved codes plus one', () => {
  const lock = orderLock();
  lock.order.reserved = [7];
  assert.deepEqual(nextCode('order', [order()], lock), { code: 8, findings: [] });
});

test('nextCode of a machine that has no codes is 1', () => {
  assert.deepEqual(nextCode('nothing', [order()], orderLock()), { code: 1, findings: [] });
});

test('nextCode above 2147483647 is refused with E_CODE_RANGE and gives no code', () => {
  const lock = orderLock();
  lock.order.reserved = [2147483647];
  const result = nextCode('order', [order()], lock);
  assert.deepEqual(shape(result.findings), [{ code: 'E_CODE_RANGE', machine: 'order', path: '$' }]);
  assert.equal('code' in result, false);
});

test('a key that the lock maps to a code and that gets another code is refused with E_CODE_CHANGED', () => {
  const definition = order();
  definition.states[1].code = 4;
  const result = nextLock([definition], orderLock(), { renames: [] });
  assert.deepEqual(shape(result.findings), [{ code: 'E_CODE_CHANGED', machine: 'order', path: '$.states[1].code' }]);
  assert.equal(result.findings[0].message, 'the code of paid is 2 in the lock; a released code never changes');
  assert.deepEqual(result.lock, orderLock());
});

test('a key deleted from the lock codes and re-added with another code is refused with E_CODE_CHANGED', () => {
  const definition = orderWithPaidAt(5);
  const result = nextLock([definition], orderLock(), { renames: [] });
  assert.deepEqual(shape(result.findings), [{ code: 'E_CODE_CHANGED', machine: 'order', path: '$.states[2].code' }]);
});

test('a key that the lock has only as reserved history takes a new code without a finding', () => {
  const definition = orderWithPaidAt(4);
  const lock = { order: { codes: { 1: 'draft', 3: 'done' }, reserved: [2] } };
  const result = nextLock([definition], lock, { renames: [] });
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.lock, { order: { codes: { 1: 'draft', 3: 'done', 4: 'paid' }, reserved: [2] } });
});
