// The validation of a definition: the rules of docs/spec/fsm.md, B-5. validate(definitions) returns every finding of
// the machines, each as { code, machine, path, message }, in document order within a machine and in input order across
// machines. An empty array means that the definitions are valid. The core imports nothing from node:, so the GUI runs it
// in a browser. Its findings are returned, never thrown, and no rule falls back to a default value.

import {
  GO_KEYWORDS, GO_PREDECLARED, JS_KEYWORDS, MACHINE_FIXED, MACHINE_LITERALS, MERMAID_STATE_KEYS, PYTHON_KEYWORDS, RUST_KEYWORDS,
  STATE_EVENT_KEYS,
} from './reserved.mjs';

/** The key format of a machine, state and event (B-5): lower case letters and digits joined by single underscores. */
export const KEY_PATTERN = /^[a-z][a-z0-9]*(_[a-z][a-z0-9]*)*$/;
const KEY_MAX = 64;
const CODE_MAX = 2147483647;
const MACHINE_RESERVED = new Set([...MACHINE_FIXED, ...GO_PREDECLARED, ...GO_KEYWORDS, ...RUST_KEYWORDS, ...PYTHON_KEYWORDS, ...JS_KEYWORDS, ...MACHINE_LITERALS]);
const STATE_RESERVED = new Set([...STATE_EVENT_KEYS, ...MERMAID_STATE_KEYS]);
const EVENT_RESERVED = new Set(STATE_EVENT_KEYS);

const MACHINE_FIELDS = ['machine', 'states', 'events'];
const STATE_FIELDS = ['key', 'code', 'initial', 'final'];
const EVENT_FIELDS = ['key', 'edges'];
const EDGE_FIELDS = ['from', 'to'];

const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);
const kindOf = value => (value === null ? 'null' : Array.isArray(value) ? 'an array' : `a ${typeof value}`);
const finding = (code, machine, path, message) => ({ code, machine, path, message });
/**
 * The E_KEY_FORMAT faults of a key that breaks the pattern or the length bound (B-5): one message, or none (an empty array) when the
 * key is valid. A key that breaks the pattern is reported by the pattern message alone.
 */
const keyFormatFaults = (kind, key) => {
  if (!KEY_PATTERN.test(key)) return [`${kind} key ${key} is not lower case letters and digits joined by single underscores`];
  if (key.length > KEY_MAX) return [`${kind} key ${key} is ${key.length} characters; the maximum is ${KEY_MAX}`];
  return [];
};

/** The findings of a definition that is not a valid structure (E_SCHEMA); its later rules are skipped. */
function structure(definition) {
  const found = [];
  const name = isObject(definition) && typeof definition.machine === 'string' ? definition.machine : null;
  const fail = (path, message) => found.push(finding('E_SCHEMA', name, path, message));
  if (!isObject(definition)) {
    fail('$', `the machine definition is ${kindOf(definition)}; it must be an object`);
    return found;
  }
  fields(definition, '$', MACHINE_FIELDS, ['machine', 'states', 'events'], 'a machine', fail);
  if (Object.hasOwn(definition, 'machine') && typeof definition.machine !== 'string') fail('$.machine', `machine is ${kindOf(definition.machine)}; it must be a string`);
  if (Object.hasOwn(definition, 'states')) {
    if (!Array.isArray(definition.states)) fail('$.states', `states is ${kindOf(definition.states)}; it must be an array`);
    else definition.states.forEach((state, index) => checkState(state, `$.states[${index}]`, fail));
  }
  if (Object.hasOwn(definition, 'events')) {
    if (!Array.isArray(definition.events)) fail('$.events', `events is ${kindOf(definition.events)}; it must be an array`);
    else definition.events.forEach((event, index) => checkEvent(event, `$.events[${index}]`, fail));
  }
  return found;
}

/** The E_SCHEMA rules of one state at `path`. */
function checkState(state, path, fail) {
  if (!isObject(state)) {
    fail(path, `the state is ${kindOf(state)}; it must be an object`);
    return;
  }
  fields(state, path, STATE_FIELDS, ['key', 'code'], 'a state', fail);
  if (Object.hasOwn(state, 'key') && typeof state.key !== 'string') fail(`${path}.key`, `key is ${kindOf(state.key)}; it must be a string`);
  if (Object.hasOwn(state, 'code') && !Number.isInteger(state.code)) fail(`${path}.code`, `code is ${JSON.stringify(state.code)}; it must be an integer`);
  flag(state, 'initial', path, fail);
  flag(state, 'final', path, fail);
}

/** The E_SCHEMA rules of one event at `path`, and of its edges. */
function checkEvent(event, path, fail) {
  if (!isObject(event)) {
    fail(path, `the event is ${kindOf(event)}; it must be an object`);
    return;
  }
  fields(event, path, EVENT_FIELDS, ['key', 'edges'], 'an event', fail);
  if (Object.hasOwn(event, 'key') && typeof event.key !== 'string') fail(`${path}.key`, `key is ${kindOf(event.key)}; it must be a string`);
  if (!Object.hasOwn(event, 'edges')) return;
  if (!Array.isArray(event.edges)) {
    fail(`${path}.edges`, `edges is ${kindOf(event.edges)}; it must be an array`);
    return;
  }
  if (event.edges.length === 0) fail(`${path}.edges`, 'edges is empty; an event has at least one edge');
  event.edges.forEach((edge, index) => {
    const at = `${path}.edges[${index}]`;
    if (!isObject(edge)) {
      fail(at, `the edge is ${kindOf(edge)}; it must be an object with the fields from and to`);
      return;
    }
    fields(edge, at, EDGE_FIELDS, ['from', 'to'], 'an edge', fail);
    for (const field of EDGE_FIELDS) {
      if (Object.hasOwn(edge, field) && typeof edge[field] !== 'string') fail(`${at}.${field}`, `${field} is ${kindOf(edge[field])}; it must be a string`);
    }
  });
}

/** Reports the required fields that are missing at `path` and the fields that the object does not allow. */
function fields(value, path, allowed, required, what, fail) {
  for (const key of required) if (!Object.hasOwn(value, key)) fail(path, `${what} lacks ${key}; it is required`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key}`, `${key} is not a field of ${what}`);
}

/** Reports `initial` or `final` when it is present and not true: the canonical form omits a false flag. */
function flag(value, field, path, fail) {
  if (Object.hasOwn(value, field) && value[field] !== true) fail(`${path}.${field}`, `${field} is ${JSON.stringify(value[field])}; it must be true when present, because the canonical form omits it`);
}

/**
 * The graph rules of a machine whose structure is valid (B-5). An edge whose endpoint is not a state is reported and left
 * out of the reachability search. Reachability is checked only when there is exactly one initial state; otherwise
 * E_INITIAL_COUNT is the finding.
 */
function graph(definition) {
  const found = [];
  const { machine, states } = definition;
  const report = (code, path, message) => found.push(finding(code, machine, path, message));
  const keys = new Set(states.map(state => state.key));
  const finals = new Set(states.filter(state => state.final === true).map(state => state.key));
  const initials = states.filter(state => state.initial === true).map(state => state.key);
  const outgoing = new Set();
  const edges = [];
  if (initials.length !== 1) report('E_INITIAL_COUNT', '$.states', `the machine has ${initials.length} initial states; it needs exactly one`);
  definition.events.forEach((event, eventIndex) => {
    const targets = new Map();
    const seen = new Set();
    const nondeterministic = new Set();
    event.edges.forEach((edge, edgeIndex) => {
      const at = `$.events[${eventIndex}].edges[${edgeIndex}]`;
      const { from, to } = edge;
      if (!keys.has(from)) report('E_UNKNOWN_STATE_REF', `${at}.from`, `${from} is not a state of the machine`);
      if (!keys.has(to)) report('E_UNKNOWN_STATE_REF', `${at}.to`, `${to} is not a state of the machine`);
      if (from === to) report('E_SELF_LOOP', at, `the edge of ${event.key} leaves ${from} and enters it; a self transition is not allowed`);
      const pair = JSON.stringify([from, to]);
      if (seen.has(pair)) {
        report('E_DUPLICATE_EDGE', at, `the edge ${from} -> ${to} repeats an edge of event ${event.key}`);
      } else if (!targets.has(from)) {
        targets.set(from, to);
      } else if (targets.get(from) !== to && !nondeterministic.has(from)) {
        nondeterministic.add(from);
        report('E_NONDETERMINISTIC', at, `event ${event.key} leaves ${from} for ${targets.get(from)} and for ${to}; one state and event have one target`);
      }
      seen.add(pair);
      if (finals.has(from)) report('E_FINAL_OUTGOING', at, `final state ${from} has an outgoing edge of event ${event.key}`);
      outgoing.add(from);
      if (keys.has(from) && keys.has(to)) edges.push([from, to]);
    });
  });
  if (initials.length === 1) {
    const reached = new Set(initials);
    const pending = [...initials];
    while (pending.length > 0) {
      const current = pending.pop();
      for (const [from, to] of edges) {
        if (from === current && !reached.has(to)) {
          reached.add(to);
          pending.push(to);
        }
      }
    }
    states.forEach((state, index) => {
      if (!reached.has(state.key)) report('E_UNREACHABLE', `$.states[${index}]`, `state ${state.key} is not reachable from the initial state`);
    });
  }
  states.forEach((state, index) => {
    if (state.final !== true && !outgoing.has(state.key)) report('E_DEAD_END', `$.states[${index}]`, `state ${state.key} is not final and has no outgoing edge`);
  });
  return found;
}

/** The position of every JSON path of `value` in document order (pre-order, keys in their order, indexes in order). */
function positions(value) {
  const found = new Map();
  const visit = (node, path) => {
    found.set(path, found.size);
    if (Array.isArray(node)) node.forEach((item, index) => visit(item, `${path}[${index}]`));
    else if (isObject(node)) for (const key of Object.keys(node)) visit(node[key], `${path}.${key}`);
  };
  visit(value, '$');
  return found;
}

/** The name rules of a machine whose structure is valid (B-5): the key format, the reserved keys and the repeated keys. */
function names(definition) {
  const found = [];
  const { machine, states, events } = definition;
  const report = (code, path, message) => found.push(finding(code, machine, path, message));
  for (const fault of keyFormatFaults('machine', machine)) report('E_KEY_FORMAT', '$.machine', fault);
  if (MACHINE_RESERVED.has(machine.replaceAll('_', ''))) report('E_KEY_RESERVED', '$.machine', `machine key ${machine} is reserved (docs/spec/fsm.md, B-5), after its underscores are removed`);
  const stateKeys = new Set();
  states.forEach((state, index) => {
    const path = `$.states[${index}].key`;
    for (const fault of keyFormatFaults('state', state.key)) report('E_KEY_FORMAT', path, fault);
    if (STATE_RESERVED.has(state.key)) report('E_KEY_RESERVED', path, `state key ${state.key} is reserved (docs/spec/fsm.md, B-5)`);
    if (stateKeys.has(state.key)) report('E_DUPLICATE_KEY', path, `state key ${state.key} repeats a state of the machine`);
    stateKeys.add(state.key);
  });
  const eventKeys = new Set();
  events.forEach((event, index) => {
    const path = `$.events[${index}].key`;
    for (const fault of keyFormatFaults('event', event.key)) report('E_KEY_FORMAT', path, fault);
    if (EVENT_RESERVED.has(event.key)) report('E_KEY_RESERVED', path, `event key ${event.key} is reserved (docs/spec/fsm.md, B-5)`);
    if (eventKeys.has(event.key)) report('E_DUPLICATE_KEY', path, `event key ${event.key} repeats an event of the machine`);
    eventKeys.add(event.key);
  });
  return found;
}

/** The code rules of a machine whose structure is valid (B-5): the range and the repeated codes. */
function codes(definition) {
  const found = [];
  const { machine, states } = definition;
  const seen = new Set();
  states.forEach((state, index) => {
    const path = `$.states[${index}].code`;
    if (state.code < 1 || state.code > CODE_MAX) found.push(finding('E_CODE_RANGE', machine, path, `code ${state.code} is outside 1 to ${CODE_MAX}`));
    if (seen.has(state.code)) found.push(finding('E_DUPLICATE_CODE', machine, path, `code ${state.code} is used by another state of the machine`));
    seen.add(state.code);
  });
  return found;
}

/**
 * E_DUPLICATE_KEY of a machine whose key equals the key of an earlier machine with a valid structure, or equals it after
 * its underscores are removed. The earlier machines with a structural error are not compared (their keys are not valid).
 */
function repeatedMachine(definition, earlier) {
  const compact = key => key.replaceAll('_', '');
  const match = earlier.find(entry => compact(entry.machine) === compact(definition.machine));
  if (match === undefined) return [];
  const message = match.machine === definition.machine
    ? `machine key ${definition.machine} repeats the machine at index ${match.index}`
    : `machine key ${definition.machine} equals machine key ${match.machine} at index ${match.index} after its underscores are removed`;
  return [finding('E_DUPLICATE_KEY', definition.machine, '$.machine', message)];
}

/** The findings of one machine in document order. */
function inDocumentOrder(definition, found) {
  const order = positions(definition);
  for (const item of found) {
    if (!order.has(item.path)) throw new Error(`internal: the finding ${item.code} names ${item.path}, which is not in the definition`);
  }
  return found.sort((a, b) => order.get(a.path) - order.get(b.path));
}

/** The findings of every definition of `definitions` (an array of machine objects, without $schema). */
export function validate(definitions) {
  if (!Array.isArray(definitions)) return [finding('E_SCHEMA', null, '$', `the definitions are ${kindOf(definitions)}; they must be an array of machines`)];
  const found = [];
  const valid = [];
  definitions.forEach((definition, index) => {
    const problems = structure(definition);
    if (problems.length > 0) {
      found.push(...inDocumentOrder(definition, problems));
      return;
    }
    const own = [...repeatedMachine(definition, valid), ...names(definition), ...codes(definition), ...graph(definition)];
    valid.push({ machine: definition.machine, index });
    found.push(...inDocumentOrder(definition, own));
  });
  return found;
}
