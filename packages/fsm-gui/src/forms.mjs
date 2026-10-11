// The crudui forms of the GUI (docs/plans/fsm-v1.md, C-7): the machine edit form, compiled once from crud/machine.yml, and
// the data that it renders for a stored machine. A form holds no rule. Repeated rows are keyed by sequenceRowKey of their
// position in the stored definition: a row key only tells the rows of the form apart (form-runtime.md, "Row identity"), and the
// core reads the codes and keys from the field values, so two stored states with one code still get two rows.

import { readFileSync } from 'node:fs';
import { compileForm, createForm, sequenceRowKey } from '@polyspec/crudui-generator-core';
import { renderForm } from '@polyspec/crudui-generator-html';
import { parse as parseYaml } from 'yaml';
import { nextCode } from '../../fsm-compiler/src/core/lock.mjs';

/** The crudui declaration of the machine edit form (crud/machine.yml); the names of its fields are under `form[...]`. */
const EDIT_SPEC = parseYaml(readFileSync(new URL('../crud/machine.yml', import.meta.url), 'utf8'));
const EDIT_TEMPLATE = compileForm(EDIT_SPEC, { keyPrefix: 'form' });
/** The crudui declaration of the new machine form (crud/new-machine.yml). */
const NEW_SPEC = parseYaml(readFileSync(new URL('../crud/new-machine.yml', import.meta.url), 'utf8'));
const NEW_TEMPLATE = compileForm(NEW_SPEC, { keyPrefix: 'form' });
/** The crudui declaration of the rename form (crud/rename.yml). */
const RENAME_SPEC = parseYaml(readFileSync(new URL('../crud/rename.yml', import.meta.url), 'utf8'));
const RENAME_TEMPLATE = compileForm(RENAME_SPEC, { keyPrefix: 'form' });

/**
 * The form data of a stored definition: its states keyed by their codes, marked as stored, and its events keyed by their
 * positions, each with its edges keyed by their positions. Every collection is explicit, so an empty one has no row.
 */
export function editData(definition) {
  return {
    states: Object.fromEntries(definition.states.map((state, index) => [sequenceRowKey(index + 1), {
      persisted: '1',
      key: state.key,
      code: String(state.code),
      ...(state.initial === true ? { initial: '1' } : {}),
      ...(state.final === true ? { final: '1' } : {}),
    }])),
    events: Object.fromEntries(definition.events.map((event, index) => [sequenceRowKey(index + 1), {
      key: event.key,
      edges: Object.fromEntries(event.edges.map((edge, position) => [sequenceRowKey(position + 1), {
        from: edge.from,
        to: edge.to,
      }])),
    }])),
  };
}

/**
 * The data of a parsed form made complete for rendering: an absent collection is an explicit empty object, because crudui
 * gives an absent repeated collection one blank row (form-runtime.md, "Row operations").
 */
export function completeData(data) {
  return {
    states: data.states ?? {},
    events: Object.fromEntries(Object.entries(data.events ?? {}).map(([rk, row]) => [rk, { ...row, edges: row.edges ?? {} }])),
  };
}

/**
 * The next code of `machine` that the edit page carries: core nextCode of the stored definitions and lock, or null when nextCode
 * gives no code (E_CODE_RANGE). A null is not a code: the browser suggests none, and a save shows the finding of the core.
 */
export function nextCodeOf(machine, definitions, lock) {
  const next = nextCode(machine, definitions, lock);
  return next.findings.length === 0 ? next.code : null;
}

/**
 * The crudui render options of the edit form of `machine`: its action, the CSRF token of the page, and the errors of a save
 * (`formErrors` are the texts of the whole form, `errors` the { path, message } of its nodes; form-runtime.md, "Complete form").
 * The server renders the form with these options and the browser re-renders it with the same ones, so both write one markup.
 */
export function editRenderOptions(machine, { csrf, formErrors = [], errors = [] }) {
  return {
    action: { method: 'post', url: `/machines/${machine}/edit` },
    hidden: { _csrf: csrf },
    formErrors,
    errors,
  };
}

/** The HTML of the edit form of `machine` with `data`, with the render options of editRenderOptions. */
export function renderEdit(machine, data, options) {
  return renderForm(createForm(EDIT_TEMPLATE, data, { language: 'en' }), editRenderOptions(machine, options));
}

/**
 * The edit form for the browser, as the JSON text of its template, of the data it renders, of the next code of its machine and of
 * the render options, with `<` escaped so that the text can sit in a script element. The browser creates the instance that connectForm
 * binds to the rendered form, re-renders it with the same options after every change of its rows, and gives each added state the
 * next code (client/main.ts), so the data is the data the server rendered.
 */
export function editState(machine, data, next, options) {
  const render = editRenderOptions(machine, options);
  return JSON.stringify({ template: EDIT_TEMPLATE, data, nextCode: next, render }).replaceAll('<', '\\u003c');
}

/**
 * The crudui data path of the node that a core finding path names in the form of `rows` (docs/spec/fsm.md, B-5; form-data.mjs):
 * a collection, a row, or a field of a row. A row's data path is its collection's path, `.` and its row key. A finding of a
 * path that no node of the form holds has no node, and the caller shows it as a form error.
 */
function nodePath(at, rows) {
  const state = /^\$\.states\[(\d+)\]$/.exec(at);
  if (at === '$.states') return 'states';
  if (at === '$.events') return 'events';
  if (state !== null && rows.states[state[1]] !== undefined) return `states.${rows.states[state[1]].rk}`;
  const stateField = /^\$\.states\[(\d+)\]\.(key|code|initial|final)$/.exec(at);
  if (stateField !== null && rows.states[stateField[1]] !== undefined) {
    const { rk, persisted } = rows.states[stateField[1]];
    const member = stateField[2] === 'key' && !persisted ? 'newKey' : stateField[2];
    return `states.${rk}.${member}`;
  }
  const event = /^\$\.events\[(\d+)\](?:\.(key|edges))?$/.exec(at);
  if (event !== null && rows.events[event[1]] !== undefined) {
    const { rk } = rows.events[event[1]];
    return event[2] === undefined ? `events.${rk}` : `events.${rk}.${event[2]}`;
  }
  const edge = /^\$\.events\[(\d+)\]\.edges\[(\d+)\](?:\.(from|to))?$/.exec(at);
  if (edge !== null && rows.events[edge[1]] !== undefined && rows.events[edge[1]].edges[edge[2]] !== undefined) {
    const { rk, edges } = rows.events[edge[1]];
    const row = `events.${rk}.edges.${edges[edge[2]]}`;
    return edge[3] === undefined ? row : `${row}.${edge[3]}`;
  }
  return null;
}

/**
 * The crudui errors and form errors of the findings of a save: each finding whose path names a node of the form is an error of
 * that node, and every other finding is a form error. A text is `CODE: message`, the code of the finding first.
 */
export function formErrorsOf(findings, rows) {
  const errors = [];
  const formErrors = [];
  for (const { code, path: at, message } of findings) {
    const text = `${code}: ${message}`;
    const node = nodePath(at, rows);
    if (node === null) formErrors.push(text);
    else errors.push({ path: node, message: text });
  }
  return { errors, formErrors };
}

/**
 * The definition with every blank code given the code that core nextCode suggests for it, in state order, and the findings of
 * the suggestion. A state with a code keeps it. The suggestion sees the states that are already given a code, so two new states
 * get two different codes (docs/spec/fsm.md, B-3).
 */
export function suggestCodes(definitions, lock, definition) {
  const states = definition.states.map(state => ({ ...state }));
  const others = definitions.filter(item => item.machine !== definition.machine);
  for (const state of states) {
    if (state.code !== undefined) continue;
    // The probe holds the states that have a code: a blank code is not a code, and nextCode reads every code it is given.
    const given = states.filter(item => item.code !== undefined);
    const next = nextCode(definition.machine, [...others, { ...definition, states: given }], lock);
    if (next.findings.length > 0) return { definition: { ...definition, states }, findings: next.findings };
    state.code = next.code;
  }
  return { definition: { ...definition, states }, findings: [] };
}

/** The data of the rename form of a stored definition: each state keyed by its position, with its key and no new key. */
export function renameData(definition) {
  return {
    states: Object.fromEntries(definition.states.map((state, index) => [sequenceRowKey(index + 1), { key: state.key }])),
  };
}

/** The HTML of the rename form of `machine`, posted to its rename path with the CSRF token of the page. */
export function renderRename(machine, data, { csrf, formErrors = [], errors = [] }) {
  return renderForm(createForm(RENAME_TEMPLATE, data, { language: 'en' }), {
    action: { method: 'post', url: `/machines/${machine}/rename` },
    hidden: { _csrf: csrf },
    formErrors,
    errors,
  });
}

/**
 * The crudui errors and form errors of the findings of a rename: a finding of a state's key is shown on that state's new key
 * when the state is renamed, and a finding of a state row is shown on the row; any other finding is a form error.
 */
export function renameErrorsOf(findings, rows) {
  const errors = [];
  const formErrors = [];
  for (const { code, path: at, message } of findings) {
    const text = `${code}: ${message}`;
    const row = /^\$\.states\[(\d+)\](?:\.key)?$/.exec(at);
    const renamed = row !== null && rows[row[1]] !== undefined ? rows[row[1]] : undefined;
    if (at === '$.states') errors.push({ path: 'states', message: text });
    else if (renamed !== undefined && at.endsWith('.key') && renamed.to !== '') errors.push({ path: `states.${renamed.rk}.to`, message: text });
    else if (renamed !== undefined) errors.push({ path: `states.${renamed.rk}`, message: text });
    else formErrors.push(text);
  }
  return { errors, formErrors };
}

/** The HTML of the new machine form, with the values of `data` (empty for a new form), with the CSRF token of the page. */
export function renderNew(data, { csrf, formErrors = [], errors = [] }) {
  return renderForm(createForm(NEW_TEMPLATE, data, { language: 'en' }), {
    action: { method: 'post', url: '/new' },
    hidden: { _csrf: csrf },
    formErrors,
    errors,
  });
}

/**
 * The crudui errors and form errors of the findings of a new machine: the machine key's finding is shown on the machine field and
 * the finding of its only state's key on the state field; any other finding is a form error.
 */
export function newErrorsOf(findings) {
  const errors = [];
  const formErrors = [];
  for (const { code, path: at, message } of findings) {
    const text = `${code}: ${message}`;
    if (at === '$.machine') errors.push({ path: 'machine', message: text });
    else if (at === '$.states[0].key') errors.push({ path: 'state', message: text });
    else formErrors.push(text);
  }
  return { errors, formErrors };
}
