// The concurrency proof of the persistence pattern (docs/spec/fsm.md, B-4; docs/plans/fsm-v1.md, C-4): two transactions of one row
// that run at the same time, each on its own connection, give the outcome that the pattern promises. Two transactions with the same
// (expected, event) give one Changed and one Unchanged; two different events from one expected state give one Changed and one
// E_CONFLICT. The dialect is FSM_TEST_DIALECT (sqlite by default; postgres and mysql take their DSN from FSM_TEST_PG_DSN and
// FSM_TEST_MYSQL_DSN, and a missing DSN fails the run). The dialect helper is the one of the fsm-db tests. On postgres and mysql
// the two transitions run at the same time. On sqlite they run one after the other: the sqlite driver is synchronous, so a second
// BEGIN IMMEDIATE in the same process blocks the one thread that would commit the first (docs/plans/fsm-v1.md, C-4).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import * as api from '../src/index.js';
import { Item, SCHEMA, connect } from '../examples/model/models.ts';
import { seed, statusOf, transition } from '../examples/persist.mjs';
import { dialectOf, serverDsn } from '../../db/tests/dialect.mjs';

const { order } = api;
const dialect = dialectOf();
const temp = [];
const dbs = [];

after(async () => {
  for (const db of dbs) await db.close();
  for (const dir of temp) rmSync(dir, { recursive: true, force: true });
});

/** Two connections to one database of the dialect, with the persist table installed and holding row 1 in the draft state. */
async function twoConnections() {
  let dsn;
  if (dialect === 'sqlite') {
    const dir = mkdtempSync(path.join(tmpdir(), 'fsm-npm-persist-'));
    temp.push(dir);
    dsn = `sqlite://${dir}/persist.db`;
  } else {
    dsn = serverDsn(dialect);
  }
  const pair = [await connect(dsn), await connect(dsn)];
  dbs.push(...pair);
  await pair[0].utils().schema().install(SCHEMA);
  await (await new Item().connect(pair[0]).gets()).delete();
  await seed(pair[0], 1, order.code(order.State.Draft));
  return pair;
}

/** Each call settled, as Promise.allSettled reports it: fulfilled with a value or rejected with a reason. Concurrent on postgres and mysql, in sequence on sqlite. */
async function together(calls) {
  const settle = call => call().then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }));
  if (dialect !== 'sqlite') return Promise.all(calls.map(settle));
  const outcomes = [];
  for (const call of calls) outcomes.push(await settle(call));
  return outcomes;
}

test('two concurrent transitions with the same (expected, event) give one Changed and one Unchanged', async () => {
  const [first, second] = await twoConnections();
  const outcomes = await together([
    () => transition(first, order, 1, order.State.Draft, order.Event.Next),
    () => transition(second, order, 1, order.State.Draft, order.Event.Next),
  ]);
  assert.ok(outcomes.every(outcome => outcome.status === 'fulfilled'), `both transitions succeed: ${outcomes.map(o => o.reason)}`);
  const steps = outcomes.map(outcome => outcome.value);
  assert.deepEqual(steps.map(step => step.changed).sort(), [false, true]);
  assert.deepEqual(steps.map(step => step.to), [order.State.Paid, order.State.Paid]);
  assert.equal(await statusOf(first, 1), order.code(order.State.Paid), 'the stored state after both runs');
});

test('two concurrent transitions with two events from one expected state give one Changed and one E_CONFLICT', async () => {
  const [first, second] = await twoConnections();
  const outcomes = await together([
    () => transition(first, order, 1, order.State.Draft, order.Event.Next),
    () => transition(second, order, 1, order.State.Draft, order.Event.Cancel),
  ]);
  const changed = outcomes.filter(outcome => outcome.status === 'fulfilled');
  const failed = outcomes.filter(outcome => outcome.status === 'rejected');
  assert.equal(changed.length, 1, 'one transition changes the row');
  assert.equal(changed[0].value.changed, true);
  assert.equal(failed.length, 1, 'the other transition fails');
  assert.ok(failed[0].reason instanceof api.fsm.Error, `want a fsm.Error, got ${failed[0].reason}`);
  assert.equal(failed[0].reason.code, 'E_CONFLICT');
  assert.equal(await statusOf(first, 1), order.code(changed[0].value.to), 'the stored state is the one the changed run reached');
});

test('the persistence pattern gives first, retry and conflict on the dialect (the persist vectors of B-4)', async () => {
  const [db] = await twoConnections();
  const first = await transition(db, order, 1, order.State.Draft, order.Event.Next);
  assert.deepEqual(first, { to: order.State.Paid, changed: true }, 'first attempt');
  const retry = await transition(db, order, 1, order.State.Draft, order.Event.Next);
  assert.deepEqual(retry, { to: order.State.Paid, changed: false }, 'retry with the same observed state');
  const conflict = await rejectionOf(transition(db, order, 1, order.State.Draft, order.Event.Cancel));
  assert.equal(conflict.code, 'E_CONFLICT');
  assert.equal(await statusOf(db, 1), order.code(order.State.Paid), 'the stored state after the three attempts');
});

/** The error of a rejected promise, which must be a fsm.Error. */
async function rejectionOf(promise) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof api.fsm.Error, `want a fsm.Error, got ${error}`);
    return error;
  }
  assert.fail('the promise must reject');
}
