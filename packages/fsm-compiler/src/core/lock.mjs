// The code lock of docs/spec/fsm.md, B-3. The lock is { machine: { codes: { code: key }, reserved: [code] } }. A code is
// the identity of a state and is never reused: a code that leaves the definition moves to reserved. lockMismatch compares
// a lock with the definitions, nextLock derives the lock of new definitions, and nextCode gives the code of a new state.
// Every refusal is a finding { code, machine, path, message }; nothing returns null. The core imports nothing from node:.

import { validate } from './validate.mjs';

const CODE_MAX = 2147483647;

const finding = (code, machine, path, message) => ({ code, machine, path, message });

/** True when the two objects of code -> key have the same keys and values. */
const sameEntries = (left, right) => {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && left[key] === right[key]);
};

/** The findings (E_LOCK_MISMATCH) of a lock that does not describe `definitions` (B-3). An empty array means it matches. */
export function lockMismatch(definitions, lock) {
  const found = [];
  const defined = new Set();
  for (const { machine, states } of definitions) {
    defined.add(machine);
    if (!Object.hasOwn(lock, machine)) {
      found.push(finding('E_LOCK_MISMATCH', machine, '$', `the lock has no entry for machine ${machine}`));
      continue;
    }
    const { codes, reserved } = lock[machine];
    const expected = Object.fromEntries(states.map(state => [state.code, state.key]));
    if (!sameEntries(codes, expected)) {
      found.push(finding('E_LOCK_MISMATCH', machine, '$.codes', `the lock codes of ${machine} are not the codes of its states`));
    }
    const stateCodes = new Set(states.map(state => state.code));
    if (reserved.some(code => stateCodes.has(code))) {
      found.push(finding('E_LOCK_MISMATCH', machine, '$.reserved', `a reserved code of ${machine} is the code of one of its states`));
    }
  }
  for (const machine of Object.keys(lock)) {
    if (!defined.has(machine) && Object.keys(lock[machine].codes).length > 0) {
      found.push(finding('E_LOCK_MISMATCH', machine, '$.codes', `machine ${machine} is not defined, so its lock codes must be empty`));
    }
  }
  return found;
}

/** The lock in canonical order: machines by name, codes numerically, reserved ascending. */
export function canonicalLock(lock) {
  return Object.fromEntries(Object.keys(lock).sort().map(machine => {
    const { codes, reserved } = lock[machine];
    const sortedCodes = Object.keys(codes).map(Number).sort((a, b) => a - b);
    return [machine, {
      codes: Object.fromEntries(sortedCodes.map(code => [code, codes[code]])),
      reserved: [...reserved].sort((a, b) => a - b),
    }];
  }));
}

/** Renames the state `from` to `to` in the states and in every edge of `definition`. */
function renameState(definition, from, to) {
  for (const state of definition.states) if (state.key === from) state.key = to;
  for (const event of definition.events) {
    for (const edge of event.edges) {
      if (edge.from === from) edge.from = to;
      if (edge.to === from) edge.to = to;
    }
  }
}

/**
 * The lock of `definitions` after the lock rules of B-3. `renames` is a list of { machine, from, to }, applied in order to
 * the definitions and to the lock. The result is { lock, definitions, findings }. When there are findings, nothing has
 * changed: the result carries the given lock and definitions, and the caller must not write.
 */
export function nextLock(definitions, lock, { renames = [] } = {}) {
  const initial = validate(definitions);
  if (initial.length > 0) return { lock, definitions, findings: initial };
  const working = structuredClone(definitions);
  const workingLock = structuredClone(lock);
  const found = [];
  for (const { machine, from, to } of renames) {
    const definition = working.find(item => item.machine === machine);
    if (definition === undefined) {
      found.push(finding('E_UNKNOWN_STATE_REF', machine, '$', `machine ${machine} is not defined, so state ${from} cannot be renamed`));
      continue;
    }
    if (!definition.states.some(state => state.key === from)) {
      found.push(finding('E_UNKNOWN_STATE_REF', machine, '$.states', `state ${from} is not a state of ${machine}`));
      continue;
    }
    renameState(definition, from, to);
    if (Object.hasOwn(workingLock, machine)) {
      const { codes } = workingLock[machine];
      for (const code of Object.keys(codes)) if (codes[code] === from) codes[code] = to;
    }
  }
  if (found.length === 0) found.push(...validate(working));
  if (found.length > 0) return { lock, definitions, findings: found };

  const entries = new Map();
  for (const machine of Object.keys(workingLock)) {
    const { codes, reserved } = workingLock[machine];
    entries.set(machine, {
      codes: new Map(Object.entries(codes).map(([code, key]) => [Number(code), key])),
      reserved: new Set(reserved),
    });
  }
  for (const { machine, states } of working) {
    const entry = entries.get(machine) ?? { codes: new Map(), reserved: new Set() };
    entries.set(machine, entry);
    const current = new Set();
    const lockedCodeOf = new Map([...entry.codes].map(([code, key]) => [key, code]));
    states.forEach((state, index) => {
      current.add(state.code);
      const path = `$.states[${index}].code`;
      const locked = lockedCodeOf.get(state.key);
      if (locked !== undefined && locked !== state.code) {
        found.push(finding('E_CODE_CHANGED', machine, path, `the code of ${state.key} is ${locked} in the lock; a released code never changes`));
      } else if (entry.codes.has(state.code)) {
        const owner = entry.codes.get(state.code);
        if (owner !== state.key) {
          found.push(finding('E_CODE_KEY_CHANGED', machine, path, `code ${state.code} is the code of ${owner}, not of ${state.key}; use a rename to keep the code`));
        }
      } else if (entry.reserved.has(state.code)) {
        found.push(finding('E_CODE_REUSED', machine, path, `code ${state.code} is reserved and cannot be given to ${state.key}`));
      } else {
        entry.codes.set(state.code, state.key);
      }
    });
    for (const code of [...entry.codes.keys()]) {
      if (!current.has(code)) {
        entry.codes.delete(code);
        entry.reserved.add(code);
      }
    }
  }
  const defined = new Set(working.map(definition => definition.machine));
  for (const [machine, entry] of entries) {
    if (defined.has(machine)) continue;
    for (const code of entry.codes.keys()) entry.reserved.add(code);
    entry.codes.clear();
  }
  if (found.length > 0) return { lock, definitions, findings: found };
  const next = Object.fromEntries([...entries].map(([machine, entry]) => [machine, {
    codes: Object.fromEntries(entry.codes),
    reserved: [...entry.reserved],
  }]));
  return { lock: canonicalLock(next), definitions: working, findings: [] };
}

/**
 * The next code of `machine`: the largest of its definition codes, lock codes and reserved codes, plus one. A next code above
 * 2147483647 gives no code and the finding E_CODE_RANGE, so the result is { code, findings } with code only when findings is empty.
 */
export function nextCode(machine, definitions, lock) {
  const codes = [0];
  for (const definition of definitions) {
    if (definition.machine === machine) for (const state of definition.states) codes.push(state.code);
  }
  if (Object.hasOwn(lock, machine)) {
    codes.push(...Object.keys(lock[machine].codes).map(Number), ...lock[machine].reserved);
  }
  const next = codes.reduce((largest, code) => Math.max(largest, code), 0) + 1;
  if (next > CODE_MAX) {
    return { findings: [finding('E_CODE_RANGE', machine, '$', `the next code ${next} of ${machine} is above ${CODE_MAX}`)] };
  }
  return { code: next, findings: [] };
}
