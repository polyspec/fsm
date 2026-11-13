// The contract cases of fsm (packages/rust/interface.json, cases), which cases.test.mjs runs against the Node binding and
// cases.wasm.test.mjs against the WASM binding of the installed package. FSM_CASES is the path of contracts/cases.json and
// FSM_INTERFACE the path of packages/rust/interface.json; make test-node and make test-wasm set them. A group is named
// <unit>.<member> (binding G-5): a static member is called on the class with the case keys of its parameters, and a method on the
// instance that the factory machine.parse gives from the case keys definition and reserved. A record result is compared by the
// fields that the contract names.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const camel = (words) => words.map((word, index) => (index === 0 ? word : word[0].toUpperCase() + word.slice(1))).join('');
const pascal = (words) => words.map((word) => word[0].toUpperCase() + word.slice(1)).join('');

/** A type of the contract that names a record unit, or undefined. */
const recordOf = (units, type) => (typeof type === 'object' && type.unit !== undefined && units.get(type.unit).kind === 'record' ? units.get(type.unit) : undefined);

/**
 * A value of the contract type `type` as a plain value: `name` gives the value of a field of a record from the record and the
 * field, so the same walk reads a result of the binding (camel case properties) and a case (snake case keys).
 */
function plain(units, type, value, name) {
  if (typeof type === 'object' && type.list !== undefined) return value.map((item) => plain(units, type.list, item, name));
  if (typeof type === 'object' && type.optional !== undefined) return value === null ? null : plain(units, type.optional, value, name);
  const record = recordOf(units, type);
  if (record === undefined) return value;
  return Object.fromEntries(record.fields.map((field) => [field.name.join('_'), plain(units, field.type, name(value, field), name)]));
}

const fromBinding = (value, field) => value[camel(field.name)];
const fromCase = (value, field) => value[field.name.join('_')];

/** Registers one test for each group of the cases, calling the members of the package namespace `fsm`. */
export function runCases(fsm) {
  const contract = JSON.parse(readFileSync(process.env.FSM_INTERFACE, 'utf8'));
  const cases = JSON.parse(readFileSync(process.env.FSM_CASES, 'utf8'));
  const units = new Map(contract.units.map((unit) => [unit.id, unit]));
  assert.ok(contract.cases.length > 0, 'the contract names its case groups');
  for (const entry of contract.cases) {
    const [unitId] = entry.member.split('.');
    const unit = units.get(unitId);
    const member = unit.members.find((item) => item.id === entry.member);
    const factory = unit.members.find((item) => item.id === `${unitId}.parse`);
    const groupCases = cases[entry.group];
    test(entry.group, () => {
      assert.ok(groupCases.length > 0, `the group ${entry.group} has cases`);
      const owner = fsm[pascal(unit.name)];
      assert.equal(typeof owner, 'function', `the package exports the class ${pascal(unit.name)}`);
      for (const kase of groupCases) {
        const argumentsOf = (target) => target.parameters.map((parameter) => kase[parameter.name.join('_')]);
        const call = () => {
          if (member.kind === 'static') return owner[camel(member.name)](...argumentsOf(member));
          return owner[camel(factory.name)](...argumentsOf(factory))[camel(member.name)](...argumentsOf(member));
        };
        if (kase.raises !== undefined) {
          const category = kase.raises.category[0].toUpperCase() + kase.raises.category.slice(1);
          assert.throws(call, (error) =>
            error.constructor === fsm[`Fsm${category}Error`] &&
            error.kind === kase.raises.kind &&
            error.status === kase.raises.status &&
            (kase.raises.message === null || error.message === kase.raises.message), kase.id);
        } else {
          assert.deepEqual(plain(units, member.returns, call(), fromBinding), plain(units, member.returns, kase.returns, fromCase), kase.id);
        }
      }
    });
  }
}
