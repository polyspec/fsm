// The contract cases of fsm (packages/rust/interface.json, cases), which cases.test.mjs runs against the Node binding and
// cases.wasm.test.mjs against the WASM binding of the installed package. FSM_CASES is the path of contracts/cases.json; make
// test-node and make test-wasm set it. A group is named <machine>.<member>, and the case calls the member of the module of its
// machine with the case keys of its parameters; a state and an event are their key texts, and apply gives the record of its
// fields to and changed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// The parameters of each member in the order of the contract.
const PARAMETERS = {
  initial: [],
  code: ['state'],
  key: ['state'],
  from_code: ['value'],
  is_final: ['state'],
  events_from: ['state'],
  target: ['expected', 'event'],
  apply: ['expected', 'event', 'actual'],
};

const camel = (name) => name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const plain = (value) => (typeof value === 'object' && value !== null && !Array.isArray(value) ? { to: value.to, changed: value.changed } : value);

/** Registers one test for each group of the cases, calling the members of the package namespace `fsm`. */
export function runCases(fsm) {
  const cases = JSON.parse(readFileSync(process.env.FSM_CASES, 'utf8'));
  for (const [group, groupCases] of Object.entries(cases)) {
    const [machine, member] = group.split('.');
    test(group, () => {
      assert.ok(groupCases.length > 0);
      const module = fsm[camel(machine)];
      assert.equal(typeof module?.[camel(member)], 'function', `the package exports the module ${camel(machine)} with ${camel(member)}`);
      for (const kase of groupCases) {
        const call = () => module[camel(member)](...PARAMETERS[member].map((name) => kase[name]));
        if (kase.raises !== undefined) {
          const category = kase.raises.category[0].toUpperCase() + kase.raises.category.slice(1);
          assert.throws(call, (error) =>
            error.constructor === fsm[`Fsm${category}Error`] &&
            error.kind === kase.raises.kind &&
            error.status === kase.raises.status &&
            (kase.raises.message === null || error.message === kase.raises.message), kase.id);
        } else {
          assert.deepEqual(plain(call()), kase.returns, kase.id);
        }
      }
    });
  }
}
