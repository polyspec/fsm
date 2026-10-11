// The oracle of the conformance vectors (docs/plans/fsm-v1.md, C-4; docs/spec/fsm.md, B-4): the expected result of
// every operation of one machine, computed from its IR (normalize.mjs) and its lock (the reserved codes). No language
// computes an expectation; each language only checks its own result against these cases. The core imports nothing from node:.

/** The features of contracts/features.json. A case names one of them, and the oracle refuses any other name. */
export const FEATURES = Object.freeze([
  'initial', 'code', 'key', 'from_code', 'is_final', 'events_from', 'target', 'apply', 'persist',
]);

/**
 * The kinds whose state type admits any integer, so that a case with an invalid state value (a value that is no state) can run
 * in them. The rust and php kinds have an enum for the state, so no such value exists there (docs/plans/fsm-v1.md, C-4).
 */
export const RAW_STATE_KINDS = Object.freeze(['go', 'npm', 'python']);

/**
 * The kinds whose language can hold an input that is not an int (docs/spec/fsm.md, B-6): php and php-ext (any zval) and python
 * (any object). A typed input of from_code is given to these kinds only; go, rust and npm cannot hold it (npm's number holds 2.0 as
 * the int 2, and no npm value is a string or a bool, so only the non-integer fraction is given to npm too).
 */
export const TYPED_KINDS = Object.freeze(['php', 'php-ext', 'python']);

/**
 * The cases of `vectorList` (the list of { machine, cases } of vectors) that the kind `kind` runs: a case without a `kinds` list is
 * run by every kind, and a case with one only by the kinds it names. The `kinds` field is removed, so the native module of the
 * kind holds the data of its cases alone.
 */
export function forKind(vectorList, kind) {
  return vectorList.map(({ machine, cases }) => ({
    machine,
    cases: cases
      .filter(entry => entry.kinds === undefined || entry.kinds.includes(kind))
      .map(({ kinds, ...entry }) => entry),
  }));
}

/**
 * The vectors of `ir` (the IR of normalize) with `lock` (the lock of the machine, which holds its reserved codes):
 * { machine, cases: [{ feature, id, name, ...data, expect }] }. The cases follow docs/plans/fsm-v1.md, C-4: initial; per state
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
  // The fields of an error result (docs/spec/fsm.md, B-4 and B-6): the state codes of expected and actual, and the event as its
  // declaration position from 1. A field that the error does not use is null, so every error case names all four fields.
  const codeOf = key => states[stateIndex.get(key)].code;
  const positionOf = key => eventIndex.get(key) + 1;
  const failure = (code, fields = {}) => ({ error: code, expected: null, actual: null, event: null, ...fields });
  const cases = [];
  const ids = new Set();
  const add = (feature, suffix, data, expect, kinds) => {
    if (!FEATURES.includes(feature)) throw new Error(`vectors: ${feature} is not a feature of contracts/features.json`);
    const id = `${machine}_${suffix}`;
    // Internal assertion: ids are unique by construction (every key is an index), so this never fails.
    if (ids.has(id)) throw new Error(`vectors: internal error, the id ${id} is given twice`);
    ids.add(id);
    // name is the case name of every language (docs/plans/fsm-v1.md, C-4): `<feature>__<id>`, the name that the parity check of
    // kit reads at $.machines[*].cases[*].name.
    cases.push({ feature, id, name: `${feature}__${id}`, ...data, expect, ...(kinds === undefined ? {} : { kinds }) });
  };

  add('initial', 'initial', {}, { state: initial });
  for (const state of states) {
    add('code', `code_${s(state.key)}`, { state: state.key }, state.code);
    add('key', `key_${s(state.key)}`, { code: state.code }, state.key);
    add('from_code', `from_code_${s(state.key)}`, { input: String(state.code) }, { state: state.key });
    add('is_final', `is_final_${s(state.key)}`, { state: state.key }, state.final);
    const from = events.filter(event => toOf(state.key, event.key) !== undefined).map(event => event.key);
    add('events_from', `events_from_${s(state.key)}`, { state: state.key }, from);
  }

  // The codes that are no state: 0, the first positive code that no state or reserved code takes, and the edges of the 32-bit
  // range and of the 64-bit range. Every one of them is E_UNKNOWN_CODE, and the decimal strings keep the 64-bit maximum exact.
  add('from_code', 'from_code_zero', { input: '0' }, failure('E_UNKNOWN_CODE'));
  const taken = new Set([...states.map(state => state.code), ...reserved]);
  let unknown = 1;
  while (taken.has(unknown)) unknown += 1;
  add('from_code', 'from_code_unknown', { input: String(unknown) }, failure('E_UNKNOWN_CODE'));
  for (const code of reserved) add('from_code', `from_code_r${code}`, { input: String(code) }, failure('E_RESERVED_CODE'));
  add('from_code', 'from_code_negative', { input: '-1' }, failure('E_UNKNOWN_CODE'));
  add('from_code', 'from_code_int32_overflow', { input: '2147483648' }, failure('E_UNKNOWN_CODE'));
  add('from_code', 'from_code_int64_max', { input: '9223372036854775807' }, failure('E_UNKNOWN_CODE'));

  // The inputs that are not an int, given to the kinds that can hold them (B-6): a string and a bool are no code in those kinds,
  // whatever their text, and a float is no code even when it has the value of a state. Each one names its state code, so that a
  // coercion of the value would give that state. input_type names the type: string, bool or float (the text is the literal).
  const typedCode = String(states[0].code);
  add('from_code', 'from_code_string', { input: typedCode, input_type: 'string' }, failure('E_UNKNOWN_CODE'), TYPED_KINDS);
  add('from_code', 'from_code_bool', { input: 'true', input_type: 'bool' }, failure('E_UNKNOWN_CODE'), TYPED_KINDS);
  add('from_code', 'from_code_float', { input: `${typedCode}.0`, input_type: 'float' }, failure('E_UNKNOWN_CODE'), TYPED_KINDS);
  add('from_code', 'from_code_fraction', { input: `${typedCode}.5`, input_type: 'float' }, failure('E_UNKNOWN_CODE'),
    [...TYPED_KINDS, 'npm']);

  // An invalid state value (0 and the unknown code) for the functions that take a state, in the kinds whose state type admits it.
  // A state argument is a key in every other case, and an integer here (`value`, or `expected_value` and `actual_value` for apply).
  for (const value of [0, unknown]) {
    add('code', `code_v${value}`, { value }, failure('E_UNKNOWN_CODE'), RAW_STATE_KINDS);
    add('is_final', `is_final_v${value}`, { value }, failure('E_UNKNOWN_CODE'), RAW_STATE_KINDS);
    add('key', `key_v${value}`, { code: value }, failure('E_UNKNOWN_CODE'), RAW_STATE_KINDS);
    if (events.length > 0) {
      const first = states[0].key;
      const event = events[0].key;
      add('apply', `apply_expected_v${value}_e0_s0`, { expected_value: value, event, actual: first },
        failure('E_UNKNOWN_CODE'), RAW_STATE_KINDS);
      add('apply', `apply_actual_v${value}_e0_s0`, { expected: first, event, actual_value: value },
        failure('E_UNKNOWN_CODE'), RAW_STATE_KINDS);
    }
  }

  for (const state of states) {
    for (const event of events) {
      const to = toOf(state.key, event.key);
      add('target', `target_${s(state.key)}_${e(event.key)}`, { state: state.key, event: event.key },
        to === undefined ? failure('E_INVALID_TRANSITION', { expected: codeOf(state.key), event: positionOf(event.key) })
          : { state: to });
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
        const conflict = failure('E_CONFLICT', { expected: codeOf(state.key), actual: codeOf(actual), event: positionOf(event.key) });
        if (actual === state.key) add('apply', suffix, data, { to, changed: true });
        else if (actual === to) add('apply', suffix, data, { to, changed: false });
        else add('apply', suffix, data, conflict);
      }
    }
  }

  for (const state of states) {
    for (const event of events) {
      if (toOf(state.key, event.key) === undefined) {
        add('apply', `apply_${s(state.key)}_${e(event.key)}_${s(state.key)}`,
          { expected: state.key, event: event.key, actual: state.key },
          failure('E_INVALID_TRANSITION', { expected: codeOf(state.key), event: positionOf(event.key) }));
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
    if (third !== undefined) {
      persist('conflict', third, {
        ...failure('E_CONFLICT', { expected: codeOf(first.state), actual: codeOf(third), event: positionOf(first.event) }),
        stored_after: third,
      });
    }
  }

  return { machine, cases };
}
