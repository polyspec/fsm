// The conformance tests of the npm package (docs/plans/fsm-v1/plan.md, C-4). Every vector case of tests/vectors.mjs (generated from
// the core oracle) is one node:test test named test_<feature>__<id>: it calls the generated function of src/ and asserts the
// expected value and, for an error, the code and the fields of fsm.Error (docs/spec/fsm.md, B-4 and B-6; a field that does not
// apply is null in the vector and undefined in the error). The persist cases run the B-4 example (examples/persist.mjs) on the
// dialect of FSM_TEST_DIALECT (sqlite by default, through the dialect helper of the fsm-db tests) and assert the stored value
// after the run. The names are the notation of docs/spec/fsm.md, B-6: a key becomes a member by pascal
// case. A state argument is a key, or an integer where the case gives one (an invalid state value).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as api from '../src/index.js';
import { open, seed, statusOf, transition } from '../examples/persist.mjs';
import { Item } from '../examples/model/models.ts';
import { dialectOf, serverDsn } from '../../db/tests/dialect.mjs';
import { vectors } from './vectors.mjs';
import { inspect } from 'node:util';

/** The member of a key: its pascal notation (docs/spec/fsm.md, B-6). */
const member = key => key.split('_').map(word => word[0].toUpperCase() + word.slice(1)).join('');

/** The state value of a key of the machine module `machine`. */
function stateOf(machine, key) {
  const value = machine.State[member(key)];
  assert.ok(value !== undefined, `${key} is no state of the machine`);
  return value;
}

/** The state argument of a case: its integer when the case gives one (`value`), its key otherwise. */
const stateArg = (machine, key, value) => (value !== undefined ? value : stateOf(machine, key));

/** The event value of a key of the machine module `machine`. */
function eventOf(machine, key) {
  const value = machine.Event[member(key)];
  assert.ok(value !== undefined, `${key} is no event of the machine`);
  return value;
}

/** The error that `fn` throws (or the promise rejects with), which must be a fsm.Error. */
function errorOf(fn) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof api.fsm.Error, `want a fsm.Error, got ${inspect(error)}`);
    return error;
  }
  assert.fail('the call must throw');
}

/** The error of a rejected promise, which must be a fsm.Error. */
async function rejectionOf(promise) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof api.fsm.Error, `want a fsm.Error, got ${inspect(error)}`);
    return error;
  }
  assert.fail('the promise must reject');
}

/** Asserts that a fsm.Error has the code of `expect` and the fields of `expect` (null where the field does not apply). */
function assertFields(error, expect) {
  assert.deepEqual(
    { code: error.code, expected: error.expected ?? null, actual: error.actual ?? null, event: error.event ?? null },
    { code: expect.error, expected: expect.expected, actual: expect.actual, event: expect.event },
  );
}

/**
 * Runs the persist case `c` of `machine` on the dialect of FSM_TEST_DIALECT: a new SQLite file, or the server database of the
 * dialect's DSN with the rows of the persist table cleared. It asserts the stored state after the run.
 */
async function persistCase(machine, c) {
  const dialect = dialectOf();
  const dir = mkdtempSync(path.join(tmpdir(), 'fsm-npm-persist-'));
  const db = await open(dialect === 'sqlite' ? `sqlite://${dir}/persist.db` : serverDsn(dialect));
  try {
    await (await new Item().connect(db).gets()).delete();
    await seed(db, 1, stateOf(machine, c.stored));
    const expected = stateOf(machine, c.expected);
    const event = eventOf(machine, c.event);
    if (c.expect.error !== undefined) {
      assertFields(await rejectionOf(transition(db, machine, 1, expected, event)), c.expect);
    } else {
      const step = await transition(db, machine, 1, expected, event);
      assert.deepEqual(step, { to: stateOf(machine, c.expect.stored_after), changed: c.expect.changed });
    }
    assert.equal(await statusOf(db, 1), stateOf(machine, c.expect.stored_after), 'the stored state after the run');
  } finally {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs the case `c` of the machine module `machine`, which is the generated module of the machine. */
async function check(machine, c) {
  switch (c.feature) {
    case 'initial':
      assert.equal(machine.initial(), stateOf(machine, c.expect.state));
      return;
    case 'code':
      if (c.expect.error !== undefined) assertFields(errorOf(() => machine.code(stateArg(machine, c.state, c.value))), c.expect);
      else assert.equal(machine.code(stateOf(machine, c.state)), c.expect);
      return;
    case 'key':
      if (c.expect.error !== undefined) assertFields(errorOf(() => machine.key(c.code)), c.expect);
      else assert.equal(machine.key(c.code), c.expect);
      return;
    case 'from_code':
      if (c.expect.error !== undefined) assertFields(errorOf(() => machine.fromCode(c.input)), c.expect);
      else assert.equal(machine.fromCode(c.input), stateOf(machine, c.expect.state));
      return;
    case 'is_final':
      if (c.expect.error !== undefined) assertFields(errorOf(() => machine.isFinal(stateArg(machine, c.state, c.value))), c.expect);
      else assert.equal(machine.isFinal(stateOf(machine, c.state)), c.expect);
      return;
    case 'events_from':
      assert.deepEqual(machine.eventsFrom(stateOf(machine, c.state)), c.expect.map(key => eventOf(machine, key)));
      return;
    case 'target':
      if (c.expect.error !== undefined) assertFields(errorOf(() => machine.target(stateOf(machine, c.state), eventOf(machine, c.event))), c.expect);
      else assert.equal(machine.target(stateOf(machine, c.state), eventOf(machine, c.event)), stateOf(machine, c.expect.state));
      return;
    case 'apply': {
      const expected = stateArg(machine, c.expected, c.expected_value);
      const event = eventOf(machine, c.event);
      const actual = stateArg(machine, c.actual, c.actual_value);
      if (c.expect.error !== undefined) assertFields(errorOf(() => machine.apply(expected, event, actual)), c.expect);
      else assert.deepEqual(machine.apply(expected, event, actual), { to: stateOf(machine, c.expect.to), changed: c.expect.changed });
      return;
    }
    default:
      throw new Error(`no check for the feature ${c.feature}; the vectors and this file must agree`);
  }
}

for (const { machine: name, cases } of vectors) {
  const machine = api[name];
  assert.ok(machine !== undefined, `src/index.js does not export the machine ${name}`);
  for (const c of cases) {
    test(c.name, async () => {
      if (c.feature === 'persist') await persistCase(machine, c);
      else await check(machine, c);
    });
  }
}
