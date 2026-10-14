// The persistence tests of the npm package beyond the vector cases (docs/spec/fsm.md, B-4; docs/plans/fsm-v1.md, C-4): two
// transitions of one row that run at the same time, each on its own connection, give the outcome that the pattern promises, and a
// deadlock runs the transaction again while another database error does not. Each test is named by its feature unit of
// config/parity.json. The dialect is FSM_TEST_DIALECT (sqlite by default; postgres and mysql take their DSN from FSM_TEST_PG_DSN
// and FSM_TEST_MYSQL_DSN, and a missing DSN fails the run), through the dialect helper of the fsm-db tests. On postgres and mysql
// the two transitions run at the same time. On sqlite they run one after the other: the sqlite driver is synchronous, so a second
// BEGIN IMMEDIATE in the same process blocks the one thread that would commit the first (docs/plans/fsm-v1.md, C-4).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { OrmError } from '@polyspec/orm';
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

/** `count` connections to one database of the dialect, with the persist table installed and holding row 1 in the draft state. */
async function connections(count) {
  let dsn;
  if (dialect === 'sqlite') {
    const dir = mkdtempSync(path.join(tmpdir(), 'fsm-npm-persist-'));
    temp.push(dir);
    dsn = `sqlite://${dir}/persist.db`;
  } else {
    dsn = serverDsn(dialect);
  }
  const opened = [];
  for (let index = 0; index < count; index++) opened.push(await connect(dsn));
  dbs.push(...opened);
  await opened[0].utils().schema().install(SCHEMA);
  await (await new Item().connect(opened[0]).gets()).delete();
  await seed(opened[0], 1, order.code(order.State.Draft));
  return opened;
}

/** Each call settled, as Promise.allSettled reports it: fulfilled with a value or rejected with a reason. Concurrent on postgres and mysql, in sequence on sqlite. */
async function together(calls) {
  const settle = call => call().then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }));
  if (dialect !== 'sqlite') return Promise.all(calls.map(settle));
  const outcomes = [];
  for (const call of calls) outcomes.push(await settle(call));
  return outcomes;
}

/** The order machine whose apply runs `fault` before it applies the event, once per attempt of the transaction. */
const faulty = fault => ({ ...order, apply: (...args) => { fault(); return order.apply(...args); } });

test('persist_concurrent_same_event', async () => {
  const [first, second] = await connections(2);
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

test('persist_concurrent_conflict', async () => {
  const [first, second] = await connections(2);
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

test('persist_retry_on_deadlock', async () => {
  const [db] = await connections(1);
  let attempts = 0;
  const step = await transition(db, faulty(() => {
    attempts += 1;
    if (attempts === 1) throw new OrmError('DEADLOCK', 'injected deadlock');
  }), 1, order.State.Draft, order.Event.Next);
  assert.equal(attempts, 2, 'the transaction runs again after a deadlock');
  assert.deepEqual(step, { to: order.State.Paid, changed: true });
  assert.equal(await statusOf(db, 1), order.code(order.State.Paid));
});

test('persist_no_retry_on_other_error', async () => {
  const [db] = await connections(1);
  let attempts = 0;
  await assert.rejects(transition(db, faulty(() => {
    attempts += 1;
    throw new OrmError('CONNECTION_LOST', 'injected');
  }), 1, order.State.Draft, order.Event.Next), error => error instanceof OrmError && error.code === 'CONNECTION_LOST');
  assert.equal(attempts, 1, 'a database error other than a deadlock is not run again');
  assert.equal(await statusOf(db, 1), order.code(order.State.Draft), 'the row keeps its state');
});
