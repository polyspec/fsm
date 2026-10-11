// The oracle of the conformance vectors (docs/plans/fsm-v1.md, C-4; docs/spec/fsm.md, B-4): the expected result of
// every operation of one machine, computed from its IR (normalize.mjs) and its lock (the reserved codes). No language
// computes an expectation; each language only checks its own result against these cases. The core imports nothing from node:.

/** The features of contracts/features.json. A case names one of them, and the oracle refuses any other name. */
export const FEATURES = Object.freeze([
  'initial', 'code', 'key', 'from_code', 'is_final', 'events_from', 'target', 'apply', 'persist',
]);

/**
 * The vectors of `ir` (the IR of normalize) with `lock` (the lock of the machine, which holds its reserved codes):
 * { machine, cases: [{ feature, id, ...data, expect }] }. The cases follow docs/plans/fsm-v1.md, C-4: initial; per state
 * code, key, from_code, is_final, events_from; the from_code errors; target for every (state, event); apply for every defined
 * (expected, event) and then for every undefined one; persist.
 *
 * A case id is `<machine>_<suffix>`, and every key inside a suffix is replaced by its declaration index, so that no two
 * ids can collide: a state is `s<i>`, an event `e<j>` and a reserved code `r<code>` (all indexes 0-based, the code as is).
 * An id is therefore unique by construction, and the check in `add` is an internal assertion only.
 *
 * Persist cases exist only when the machine has a transition: `first` and `retry` use its first transition, and `conflict`
 * exists only when a third state exists (a state other than the first transition's two states). A machine without a
 * transition, such as a one-state machine, gets no persist case. The oracle throws, instead of returning a result, only
 * when the lock has no entry for the machine.
 */
export function vectors(ir, lock) {
  const { machine, initial, states, events, transitions } = ir;
  if (!Object.hasOwn(lock, machine)) throw new Error(`vectors: the lock has no entry for machine ${machine}`);
  const reserved = [...lock[machine].reserved].sort((a, b) => a - b);
  const toOf = (state, event) => transitions.find(item => item.state === state && item.event === event)?.to;
  const stateIndex = new Map(states.map((state, index) => [state.key, index]));
  const eventIndex = new Map(events.map((event, index) => [event.key, index]));
  const s = key => `s${stateIndex.get(key)}`;
  const e = key => `e${eventIndex.get(key)}`;
  const cases = [];
  const ids = new Set();
  const add = (feature, suffix, data, expect) => {
    if (!FEATURES.includes(feature)) throw new Error(`vectors: ${feature} is not a feature of contracts/features.json`);
    const id = `${machine}_${suffix}`;
    // Internal assertion: ids are unique by construction (every key is an index), so this never fails.
    if (ids.has(id)) throw new Error(`vectors: internal error, the id ${id} is given twice`);
    ids.add(id);
    cases.push({ feature, id, ...data, expect });
  };

  add('initial', 'initial', {}, { state: initial });
  for (const state of states) {
    add('code', `code_${s(state.key)}`, { state: state.key }, state.code);
    add('key', `key_${s(state.key)}`, { code: state.code }, state.key);
    add('from_code', `from_code_${s(state.key)}`, { input: state.code }, { state: state.key });
    add('is_final', `is_final_${s(state.key)}`, { state: state.key }, state.final);
    const from = events.filter(event => toOf(state.key, event.key) !== undefined).map(event => event.key);
    add('events_from', `events_from_${s(state.key)}`, { state: state.key }, from);
  }

  add('from_code', 'from_code_zero', { input: 0 }, { error: 'E_UNKNOWN_CODE' });
  const taken = new Set([...states.map(state => state.code), ...reserved]);
  let unknown = 1;
  while (taken.has(unknown)) unknown += 1;
  add('from_code', 'from_code_unknown', { input: unknown }, { error: 'E_UNKNOWN_CODE' });
  for (const code of reserved) add('from_code', `from_code_r${code}`, { input: code }, { error: 'E_RESERVED_CODE' });

  for (const state of states) {
    for (const event of events) {
      const to = toOf(state.key, event.key);
      add('target', `target_${s(state.key)}_${e(event.key)}`, { state: state.key, event: event.key },
        to === undefined ? { error: 'E_INVALID_TRANSITION' } : { state: to });
    }
  }

  for (const state of states) {
    for (const event of events) {
      const to = toOf(state.key, event.key);
      if (to === undefined) continue;
      const others = states.map(item => item.key).filter(key => key !== state.key && key !== to);
      for (const actual of [state.key, to, ...others]) {
        const data = { expected: state.key, event: event.key, actual };
        const suffix = `apply_${s(state.key)}_${e(event.key)}_${s(actual)}`;
        if (actual === state.key) add('apply', suffix, data, { to, changed: true });
        else if (actual === to) add('apply', suffix, data, { to, changed: false });
        else add('apply', suffix, data, { error: 'E_CONFLICT' });
      }
    }
  }

  for (const state of states) {
    for (const event of events) {
      if (toOf(state.key, event.key) === undefined) {
        add('apply', `apply_${s(state.key)}_${e(event.key)}_${s(state.key)}`,
          { expected: state.key, event: event.key, actual: state.key }, { error: 'E_INVALID_TRANSITION' });
      }
    }
  }

  const first = transitions[0];
  if (first !== undefined) {
    const persist = (scenario, stored, expect) => add('persist', `persist_${scenario}`,
      { scenario, expected: first.state, event: first.event, stored }, expect);
    persist('first', first.state, { stored_after: first.to, changed: true });
    persist('retry', first.to, { stored_after: first.to, changed: false });
    // The conflict stores a third state. A machine with two states has none, so it has no conflict case.
    const third = states.map(state => state.key).find(key => key !== first.state && key !== first.to);
    if (third !== undefined) persist('conflict', third, { error: 'E_CONFLICT', stored_after: third });
  }

  return { machine, cases };
}
