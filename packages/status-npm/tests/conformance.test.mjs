// The conformance tests of the npm package (docs/plans/status-v1.md, C-4). Every vector case of tests/vectors.mjs (generated from
// the core oracle) is one node:test test named test_<feature>__<id>: it calls the generated function of src/ and asserts the
// expected value or the error code. The persist cases run the B-4 example (examples/persist.mjs) on SQLite and assert the
// stored value after the run. The names are the notation of docs/spec/status.md, B-6: a key becomes a member by pascal case.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as api from '../src/index.js';
import { open, seed, statusOf, transition } from '../examples/persist.mjs';
import { vectors } from './vectors.mjs';

/** The member of a key: its pascal notation (docs/spec/status.md, B-6). */
const member = key => key.split('_').map(word => word[0].toUpperCase() + word.slice(1)).join('');

/** The state value of a key of the machine module `machine`. */
function stateOf(machine, key) {
  const value = machine.State[member(key)];
  assert.ok(value !== undefined, `${key} is no state of the machine`);
  return value;
}

/** The event value of a key of the machine module `machine`. */
function eventOf(machine, key) {
  const value = machine.Event[member(key)];
  assert.ok(value !== undefined, `${key} is no event of the machine`);
  return value;
}

/** Asserts that `fn` throws a status.Error whose code is `code`. */
function assertCode(fn, code) {
  assert.throws(fn, error => error instanceof api.status.Error && error.code === code, `expected ${code}`);
}

/** Runs the persist case `c` of `machine` on a new SQLite database, and asserts the stored state after the run. */
async function persistCase(machine, c) {
  const dir = mkdtempSync(path.join(tmpdir(), 'status-npm-persist-'));
  const db = await open(`sqlite://${dir}/persist.db`);
  try {
    await seed(db, 1, stateOf(machine, c.stored));
    const expected = stateOf(machine, c.expected);
    const event = eventOf(machine, c.event);
    if (c.expect.error !== undefined) {
      await assert.rejects(transition(db, machine, 1, expected, event), error => error instanceof api.status.Error && error.code === c.expect.error);
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
      assert.equal(machine.code(stateOf(machine, c.state)), c.expect);
      return;
    case 'key':
      assert.equal(machine.key(c.code), c.expect);
      return;
    case 'from_code':
      if (c.expect.error !== undefined) assertCode(() => machine.fromCode(c.input), c.expect.error);
      else assert.equal(machine.fromCode(c.input), stateOf(machine, c.expect.state));
      return;
    case 'is_final':
      assert.equal(machine.isFinal(stateOf(machine, c.state)), c.expect);
      return;
    case 'events_from':
      assert.deepEqual(machine.eventsFrom(stateOf(machine, c.state)), c.expect.map(key => eventOf(machine, key)));
      return;
    case 'target':
      if (c.expect.error !== undefined) assertCode(() => machine.target(stateOf(machine, c.state), eventOf(machine, c.event)), c.expect.error);
      else assert.equal(machine.target(stateOf(machine, c.state), eventOf(machine, c.event)), stateOf(machine, c.expect.state));
      return;
    case 'apply': {
      const expected = stateOf(machine, c.expected);
      const event = eventOf(machine, c.event);
      const actual = stateOf(machine, c.actual);
      if (c.expect.error !== undefined) assertCode(() => machine.apply(expected, event, actual), c.expect.error);
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
    test(`test_${c.feature}__${c.id}`, async () => {
      if (c.feature === 'persist') await persistCase(machine, c);
      else await check(machine, c);
    });
  }
}
