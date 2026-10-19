// The parser of a submitted edit form (docs/plans/fsm-v1/plan.md, C-7; hyper HY-57 and HY-58; crudui form-runtime.md, "Row
// identity"). The flat `form[...]` fields of a body become the crudui row-key objects of the form, and those become the
// definition object of one machine, which core run save checks. A name or a value that the form cannot have produced is a
// BadRequest: it is not a finding, because the GUI never shows a finding for input that the form does not hold. The parser owns
// no rule of the definition (docs/spec/fsm.md, B-5): a key, a code or an edge that breaks a rule is passed on to the core.

import { BadRequest } from '@polyspec/hyper-server';

/** A `form[...]` name: bracketed segments, with no empty segment and no nested bracket. */
const FORM_NAME = /^form((?:\[[^[\]]+\])+)$/;
/** A member name, or a crudui row key (`__` + 13 hexadecimal digits + `__`, sequenceRowKey and createRowKey). */
const SEGMENT = /^(?:[a-zA-Z]+|__[0-9a-f]{13}__)$/;
const ROW_KEY = /^__[0-9a-f]{13}__$/;
/** A code as the form writes it: a decimal integer without a sign or a leading zero. The core checks its range. */
const CODE = /^(?:0|[1-9][0-9]{0,9})$/;

const isObject = value => typeof value === 'object' && value !== null;

/**
 * The row-key object of the `form[...]` fields of a request, `request.form()` of hyper: a map of each name to its values. The
 * token field `_csrf` is not form data. A name outside `form[...]`, a repeated name, a segment that is neither a member name nor
 * a row key, and a name whose path is both a value and a group are BadRequest.
 */
export function parseFormFields(fields) {
  const root = {};
  for (const [name, values] of fields) {
    if (name === '_csrf') continue;
    const match = FORM_NAME.exec(name);
    if (match === null || values.length !== 1) throw new BadRequest();
    const segments = match[1].slice(1, -1).split('][');
    if (!segments.every(segment => SEGMENT.test(segment))) throw new BadRequest();
    let parent = root;
    for (const segment of segments.slice(0, -1)) {
      if (!Object.hasOwn(parent, segment)) parent[segment] = {};
      else if (!isObject(parent[segment])) throw new BadRequest();
      parent = parent[segment];
    }
    const last = segments.at(-1);
    if (Object.hasOwn(parent, last)) throw new BadRequest();
    parent[last] = values[0];
  }
  return root;
}

/** The entries [row key, row] of a collection of the form, in the order the form holds them; an absent collection has none. */
function rowsOf(collection) {
  if (collection === undefined) return [];
  if (!isObject(collection)) throw new BadRequest();
  return Object.entries(collection).map(([key, row]) => {
    if (!ROW_KEY.test(key) || !isObject(row)) throw new BadRequest();
    return [key, row];
  });
}

/** The text of a member of a row: absent is empty, and a member that is not text is a BadRequest. */
function text(row, member) {
  const value = row[member] ?? '';
  if (typeof value !== 'string') throw new BadRequest();
  return value;
}

/** The members that a row of the form may hold; any other member is a BadRequest. */
function onlyMembers(row, allowed) {
  for (const member of Object.keys(row)) if (!allowed.includes(member)) throw new BadRequest();
}

/** A flag of the form: absent is no flag, `1` is set, and any other value is a BadRequest. */
function flag(row, member) {
  const value = row[member];
  if (value === undefined) return false;
  if (value !== '1') throw new BadRequest();
  return true;
}

/**
 * The definition of `machine` that a parsed form holds, with the rows of the form in the order they were written:
 * { definition, rows }. `rows.states[i]` is { rk, persisted } and `rows.events[i]` is { rk, edges: [rk] } for the rows at those
 * positions, so that a finding of the definition's path names its field. A stored state (persisted) takes its key from `key`,
 * a new state from `newKey`; both given is a BadRequest. An empty code is a new state's code that the GUI has not yet suggested,
 * and it is left out of the definition for suggestCodes.
 */
export function definitionOf(machine, data) {
  if (!isObject(data)) throw new BadRequest();
  for (const name of Object.keys(data)) if (name !== 'states' && name !== 'events') throw new BadRequest();
  const states = [];
  const stateRows = [];
  for (const [rk, row] of rowsOf(data.states)) {
    onlyMembers(row, ['persisted', 'key', 'newKey', 'code', 'initial', 'final']);
    const persisted = text(row, 'persisted');
    if (persisted !== '' && persisted !== '1') throw new BadRequest();
    const key = text(row, 'key');
    const newKey = text(row, 'newKey');
    if (key !== '' && newKey !== '') throw new BadRequest();
    const code = text(row, 'code');
    if (code !== '' && !CODE.test(code)) throw new BadRequest();
    const state = { key: key !== '' ? key : newKey };
    if (code !== '') state.code = Number(code);
    if (flag(row, 'initial')) state.initial = true;
    if (flag(row, 'final')) state.final = true;
    states.push(state);
    stateRows.push({ rk, persisted: persisted === '1' });
  }
  const events = [];
  const eventRows = [];
  for (const [rk, row] of rowsOf(data.events)) {
    onlyMembers(row, ['key', 'edges']);
    const edges = [];
    const edgeRows = [];
    for (const [ek, edge] of rowsOf(row.edges)) {
      onlyMembers(edge, ['from', 'to']);
      edges.push({ from: text(edge, 'from'), to: text(edge, 'to') });
      edgeRows.push(ek);
    }
    events.push({ key: text(row, 'key'), edges });
    eventRows.push({ rk, edges: edgeRows });
  }
  return { definition: { machine, states, events }, rows: { states: stateRows, events: eventRows } };
}

/**
 * The renames of a parsed rename form of `machine`: { renames, rows }. A state row names its stored key in `key` (read-only in
 * the form) and its new key in `to`; a row with an empty `to` keeps its key. `renames` is the list that core run lock takes, in
 * the order of the rows, and `rows` are { rk, to } of the rows at those positions, so that a finding names its field.
 */
export function renamesOf(machine, data) {
  if (!isObject(data)) throw new BadRequest();
  for (const name of Object.keys(data)) if (name !== 'states') throw new BadRequest();
  const rows = rowsOf(data.states).map(([rk, row]) => {
    onlyMembers(row, ['key', 'to']);
    return { rk, from: text(row, 'key'), to: text(row, 'to') };
  });
  const renames = rows.filter(row => row.to !== '').map(row => ({ machine, from: row.from, to: row.to }));
  return { renames, rows: rows.map(({ rk, to }) => ({ rk, to })) };
}

/** The fields of the new machine form: the machine key and the key of its only state. Any other member is a BadRequest. */
export function newMachineOf(data) {
  if (!isObject(data)) throw new BadRequest();
  onlyMembers(data, ['machine', 'state']);
  return { machine: text(data, 'machine'), state: text(data, 'state') };
}
