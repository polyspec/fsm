// Tests of the npm backend (packages/compiler/src/backends/npm.mjs, docs/spec/fsm.md, B-4 and B-6): the files of the
// order example are the golden files under tests/golden/npm, byte for byte, in the order the backend returns them. The golden
// files were written by the generator once, after a review of its
// output against B-6 (docs/plans/fsm-v1/plan.md, C-5).
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { files } from '../src/backends/npm.mjs';
import { backendTests, orderIrs } from './backend-support.mjs';
import { inspect } from 'node:util';

const NAMES = ['order.js', 'order.d.ts', 'fsm.js', 'fsm.d.ts', 'index.js', 'index.d.ts'];

backendTests({ kind: 'npm', files, names: NAMES, fromOf: file => (file.startsWith('order.') ? 'order' : 'fsm') });

/** The generated files of the order example with reserved code 9, written to a temporary directory and imported from it. */
async function importedWithReserved(t) {
  const { irs } = await orderIrs();
  const root = mkdtempSync(path.join(tmpdir(), 'fsm-npm-backend-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');
  for (const file of files(irs, { order: { codes: {}, reserved: [9] } })) {
    if (file.path.endsWith('.js')) writeFileSync(path.join(root, 'src', file.path), file.content);
  }
  const api = await import(pathToFileURL(path.join(root, 'src/index.js')).href);
  return { order: api.order, fsm: api.fsm };
}

/** Asserts that `fn` throws a fsm.Error with `code`, and returns the error. */
function assertThrowsCode(fsm, fn, code) {
  let caught;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof fsm.Error, `expected a fsm.Error with ${code}, got ${inspect(caught)}`);
  assert.equal(caught.code, code);
  assert.equal(typeof caught.message, 'string');
  return caught;
}

test('fromCode: a reserved code is E_RESERVED_CODE, and every other non-state value is E_UNKNOWN_CODE', async (t) => {
  const { order, fsm } = await importedWithReserved(t);
  assert.equal(order.fromCode(1), order.State.Draft);
  assertThrowsCode(fsm, () => order.fromCode(9), 'E_RESERVED_CODE');
  for (const value of [0, 6, -1, 1.5, 2 ** 53 + 2, 2147483648, '1', null, undefined, NaN]) {
    assertThrowsCode(fsm, () => order.fromCode(value), 'E_UNKNOWN_CODE');
  }
});

test('the state functions check their state, and a value that is no state is E_UNKNOWN_CODE', async (t) => {
  const { order, fsm } = await importedWithReserved(t);
  assertThrowsCode(fsm, () => order.code(7), 'E_UNKNOWN_CODE');
  assertThrowsCode(fsm, () => order.key(9), 'E_UNKNOWN_CODE');
  assertThrowsCode(fsm, () => order.isFinal('1'), 'E_UNKNOWN_CODE');
  assertThrowsCode(fsm, () => order.eventsFrom(0), 'E_UNKNOWN_CODE');
  assertThrowsCode(fsm, () => order.target(0, order.Event.Next), 'E_UNKNOWN_CODE');
  assert.equal(order.code(order.State.Paid), 2);
  assert.equal(order.key(order.State.Paid), 'paid');
  assert.equal(order.isFinal(order.State.Done), true);
  assert.equal(order.isFinal(order.State.Draft), false);
  assert.deepEqual(order.eventsFrom(order.State.Draft), [order.Event.Next, order.Event.Cancel]);
  assert.deepEqual(order.eventsFrom(order.State.Done), []);
  assert.equal(order.initial(), order.State.Draft);
});

test('target: an event without an edge from the state is E_INVALID_TRANSITION with the arguments', async (t) => {
  const { order, fsm } = await importedWithReserved(t);
  assert.equal(order.target(order.State.Paid, order.Event.Prev), order.State.Draft);
  const error = assertThrowsCode(fsm, () => order.target(order.State.Done, order.Event.Next), 'E_INVALID_TRANSITION');
  assert.equal(error.expected, order.State.Done);
  assert.equal(error.event, order.Event.Next);
  assertThrowsCode(fsm, () => order.target(order.State.Draft, 99), 'E_INVALID_TRANSITION');
});

test('apply: Changed, Unchanged, E_CONFLICT with its fields, and an unknown stored state is E_UNKNOWN_CODE', async (t) => {
  const { order, fsm } = await importedWithReserved(t);
  const { Draft, Paid, Shipped } = order.State;
  const next = order.Event.Next;
  assert.deepEqual(order.apply(Draft, next, Draft), { to: Paid, changed: true });
  assert.deepEqual(order.apply(Draft, next, Paid), { to: Paid, changed: false });
  const conflict = assertThrowsCode(fsm, () => order.apply(Draft, next, Shipped), 'E_CONFLICT');
  assert.deepEqual([conflict.expected, conflict.actual, conflict.event], [Draft, Shipped, next]);
  assertThrowsCode(fsm, () => order.apply(Draft, next, 7), 'E_UNKNOWN_CODE');
  assertThrowsCode(fsm, () => order.apply(Draft, order.Event.Prev, Draft), 'E_INVALID_TRANSITION');
});
