// The form state that the edit page embeds in its fsm-form-state script element (docs/plans/fsm-v1/plan.md, C-7; src/forms.mjs,
// editState): the compiled crudui form template, the data of the form, the next code of the machine when it has one, and the
// render options of the page. crudui decodes its own two parts, the template (decodeFormTemplate) and the render options
// (decodeFormRenderOptions), each failing with the JSON Pointer of the invalid member; fsm checks the fields of its own envelope,
// data and nextCode. The function is pure, so the test imports it without a browser.
import { decodeFormTemplate, type FormRenderOptions, type FormTemplate } from '@polyspec/crudui-generator-core';

/** A render option of the form state that is outside the contract of FormRenderOptions; the message names the member. */
export class FormRenderOptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormRenderOptionsError';
  }
}

// crudui 0.0.5 and 0.0.7 export the type of the render options but no decoder; crudui 0.0.8 adds decodeFormRenderOptions, which is
// not released (docs/rebuild/crudui-render-options.md). This decoder checks the same members of the same types, and nothing else.
const RENDER_MEMBERS = new Set(['action', 'hidden', 'formErrors', 'errors']);
const ACTION_MEMBERS = new Set(['method', 'url', 'enctype']);
const ERROR_MEMBERS = new Set(['path', 'message']);

/** The decoded form state of an edit page. */
export interface FormState {
  template: FormTemplate;
  data: Record<string, unknown>;
  /** The code that the first state added in the browser takes; absent when the machine has no next code. */
  nextCode?: number;
  render: FormRenderOptions;
}

/** Whether `value` is a plain object, as JSON.parse makes one: not null, no list and no instance of a class. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Throws naming `what` when `value` has a member outside `members`. */
function checkMembers(value: Record<string, unknown>, members: Set<string>, what: string): void {
  for (const key of Object.keys(value)) {
    if (!members.has(key)) throw new FormRenderOptionsError(`${what} has no member ${key}`);
  }
}

/** The values of a plain object as strings; throws naming `what` for another value. */
function textRecord(value: unknown, what: string): Record<string, string> {
  if (!isPlainObject(value)) throw new FormRenderOptionsError(`${what} is not an object`);
  const record: Record<string, string> = {};
  for (const [key, member] of Object.entries(value)) {
    if (typeof member !== 'string') throw new FormRenderOptionsError(`${what}.${key} is not a string`);
    record[key] = member;
  }
  return record;
}

/** A list of strings; throws naming `what` for another value. */
function textList(value: unknown, what: string): string[] {
  if (!Array.isArray(value)) throw new FormRenderOptionsError(`${what} is not a list`);
  const items: unknown[] = value;
  return items.map(item => {
    if (typeof item !== 'string') throw new FormRenderOptionsError(`${what} holds a value that is not a string`);
    return item;
  });
}

/** Decodes the render options of the form state; throws FormRenderOptionsError naming the first member outside the contract. */
function decodeRenderOptions(value: unknown): FormRenderOptions {
  if (!isPlainObject(value)) throw new FormRenderOptionsError('render options are not an object');
  checkMembers(value, RENDER_MEMBERS, 'render options');
  const options: FormRenderOptions = {};
  const { action, hidden, formErrors, errors } = value;
  if (action !== undefined) {
    const record = textRecord(action, 'render.action');
    checkMembers(record, ACTION_MEMBERS, 'render.action');
    options.action = record;
  }
  if (hidden !== undefined) options.hidden = textRecord(hidden, 'render.hidden');
  if (formErrors !== undefined) options.formErrors = textList(formErrors, 'render.formErrors');
  if (errors !== undefined) {
    if (!Array.isArray(errors)) throw new FormRenderOptionsError('render.errors is not a list');
    const items: unknown[] = errors;
    options.errors = items.map(item => {
      if (!isPlainObject(item)) throw new FormRenderOptionsError('render.errors holds a value that is not an object');
      checkMembers(item, ERROR_MEMBERS, 'render.errors');
      const { path, message } = item;
      if (typeof path !== 'string' || typeof message !== 'string') throw new FormRenderOptionsError('render.errors: path and message are strings');
      return { path, message };
    });
  }
  return options;
}

/** Decodes the JSON text of the fsm-form-state element; throws naming the first member that is not of the form state. */
export function decodeFormState(text: string): FormState {
  const value: unknown = JSON.parse(text);
  if (!isPlainObject(value)) throw new Error('the form state is not an object');
  const { template, data, nextCode, render } = value;
  if (!isPlainObject(data)) throw new Error('data of the form state is not an object');
  if (nextCode !== undefined && !Number.isSafeInteger(nextCode)) throw new Error('nextCode of the form state is not an integer');
  const state: FormState = { template: decodeFormTemplate(template), data, render: decodeRenderOptions(render) };
  if (typeof nextCode === 'number') state.nextCode = nextCode;
  return state;
}
