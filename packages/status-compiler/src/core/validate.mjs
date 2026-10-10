// The validation of a definition: the rules of docs/spec/status.md, B-5. validate(definitions) returns every finding of
// the machines, each as { code, machine, path, message }, in document order within a machine and in input order across
// machines. An empty array means that the definitions are valid. The core imports nothing from node:, so the GUI runs it
// in a browser. Its findings are returned, never thrown, and no rule falls back to a default value.

const MACHINE_FIELDS = ['machine', 'states', 'events'];
const STATE_FIELDS = ['key', 'code', 'initial', 'final'];
const EVENT_FIELDS = ['key', 'edges'];
const EDGE_FIELDS = ['from', 'to'];

const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);
const kindOf = value => (value === null ? 'null' : Array.isArray(value) ? 'an array' : `a ${typeof value}`);
const finding = (code, machine, path, message) => ({ code, machine, path, message });

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
  definitions.forEach(definition => {
    const problems = structure(definition);
    found.push(...inDocumentOrder(definition, problems));
  });
  return found;
}
