// The common suite of the legacy tests, contracts/conformance/vectors.json, with its expectations on a binding of fsm (plan f6,
// step 7a-1; docs/plans/fsm-v1/checklist.md, S-461): conformance.test.mjs runs it against the Node binding. FSM_CONTRACTS is
// the path of the folder contracts; make test-node-conformance sets it. Each machine is Machine.parse of its file and the
// reserved codes of its lock entry. A state and an event are their keys; a raw code of a vector (value, expected_value,
// actual_value) goes through key first, as the legacy tests send it through fromCode. An error is compared by its kind and by
// the fields expected, actual and event of the vector (null where the field does not apply), as the legacy tests compare them;
// the kind is the one that the mapping table contracts/conformance/changes.json gives for the vector (docs/spec/fsm.md,
// FSM-B7-6). The persist vectors are the cases of step 7p, which binds the store.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/** The largest integer of the contract int: the same value in every target (docs/spec/fsm.md, B-7). */
const INT_MAX = 2 ** 53 - 1;

/** The predicates of the rows of contracts/conformance/changes.json, by name. */
const PREDICATES = {
  input_not_int: (vector) => vector.input !== undefined && (vector.input_type !== undefined || Math.abs(Number(vector.input)) > INT_MAX),
};

/** The kind of the binding in the place of the error of `vector`: the first row of the mapping table `rows` that applies. */
function kindOf(rows, vector) {
  const row = rows.find(({ from }) => from.error === vector.expect.error && (from.when === undefined || PREDICATES[from.when](vector)));
  assert.ok(row !== undefined, `no row of contracts/conformance/changes.json maps ${vector.expect.error} of ${vector.id}`);
  return row.to.kind;
}

/** The input of a from_code vector as the legacy npm test decodes it (legacy/packages/js/tests/conformance.test.mjs, inputOf). */
function inputOf(vector) {
  if (vector.input_type === undefined || vector.input_type === 'float') return Number(vector.input);
  if (vector.input_type === 'string') return vector.input;
  if (vector.input_type === 'bool') return vector.input === 'true';
  throw new Error(`the input type ${JSON.stringify(vector.input_type)} of ${vector.id} is not known`);
}

/** The state argument of a vector: the key of its raw code when the vector gives one, its key otherwise. */
const stateArg = (machine, key, value) => (value !== undefined ? machine.key(value) : key);

/** The error that `call` throws, which must be an error of the binding with a kind. */
function errorOf(call) {
  try {
    call();
  } catch (error) {
    return error;
  }
  return assert.fail('the call must throw');
}

/**
 * Asserts that an error has the kind that the mapping table gives for `vector` and the fields of its expectation (null where
 * the field does not apply).
 */
function assertFields(rows, error, vector) {
  const expect = vector.expect;
  assert.deepEqual(
    { kind: error.kind, expected: error.expected ?? null, actual: error.actual ?? null, event: error.event ?? null },
    { kind: kindOf(rows, vector), expected: expect.expected, actual: expect.actual, event: expect.event },
  );
}

/** Runs the vector `vector` on `machine`, an instance of Machine, with the mapping table `rows`. */
function check(rows, machine, vector) {
  const expect = vector.expect;
  const fails = typeof expect === 'object' && expect !== null && expect.error !== undefined;
  const run = (call, compare) => (fails ? assertFields(rows, errorOf(call), vector) : compare(call()));
  switch (vector.feature) {
    case 'initial':
      return assert.equal(machine.initial(), expect.state);
    case 'code':
      return run(() => machine.code(stateArg(machine, vector.state, vector.value)), (value) => assert.equal(value, expect));
    case 'key':
      return run(() => machine.key(vector.code), (value) => assert.equal(value, expect));
    case 'from_code':
      return run(() => machine.fromCode(inputOf(vector)), (value) => assert.equal(value, expect.state));
    case 'is_final':
      return run(() => machine.isFinal(stateArg(machine, vector.state, vector.value)), (value) => assert.equal(value, expect));
    case 'events_from':
      return assert.deepEqual(machine.eventsFrom(vector.state), expect);
    case 'target':
      return run(() => machine.target(vector.state, vector.event), (value) => assert.equal(value, expect.state));
    case 'apply':
      return run(
        () => machine.apply(stateArg(machine, vector.expected, vector.expected_value), vector.event, stateArg(machine, vector.actual, vector.actual_value)),
        (step) => assert.deepEqual({ to: step.to, changed: step.changed }, { to: expect.to, changed: expect.changed }),
      );
    default:
      throw new Error(`no check for the feature ${vector.feature}; the vectors and this file must agree`);
  }
}

/** Registers one test for each vector of every machine but the persist vectors, calling the class Machine of `fsm`. */
export function runVectors(fsm) {
  const contracts = process.env.FSM_CONTRACTS;
  const { machines } = JSON.parse(readFileSync(path.join(contracts, 'conformance/vectors.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(path.join(contracts, 'fsm.lock.json'), 'utf8'));
  const { rows } = JSON.parse(readFileSync(path.join(contracts, 'conformance/changes.json'), 'utf8'));
  let count = 0;
  for (const { machine: name, cases } of machines) {
    const definition = readFileSync(path.join(contracts, `machines/${name}.fsm.json`), 'utf8');
    for (const vector of cases.filter((item) => item.feature !== 'persist')) {
      count += 1;
      test(vector.name, () => check(rows, fsm.Machine.parse(definition, lock[name].reserved), vector));
    }
  }
  assert.ok(count > 0, 'the vectors hold cases');
}
