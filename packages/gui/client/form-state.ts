// The form state that the edit page embeds in its fsm-form-state script element (docs/plans/fsm-v1.md, C-7; src/forms.mjs,
// editState): the compiled crudui form template, the data of the form, the next code of the machine when it has one, and the
// render options of the page. crudui decodes its own two parts, the template (decodeFormTemplate) and the render options
// (decodeFormRenderOptions), each failing with the JSON Pointer of the invalid member; fsm checks the fields of its own envelope,
// data and nextCode. The function is pure, so the test imports it without a browser.
import { decodeFormRenderOptions, decodeFormTemplate, type FormRenderOptions, type FormTemplate } from '@polyspec/crudui-generator-core';

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

/** Decodes the JSON text of the fsm-form-state element; throws naming the first member that is not of the form state. */
export function decodeFormState(text: string): FormState {
  const value: unknown = JSON.parse(text);
  if (!isPlainObject(value)) throw new Error('the form state is not an object');
  const { template, data, nextCode, render } = value;
  if (!isPlainObject(data)) throw new Error('data of the form state is not an object');
  if (nextCode !== undefined && !Number.isSafeInteger(nextCode)) throw new Error('nextCode of the form state is not an integer');
  const state: FormState = { template: decodeFormTemplate(template), data, render: decodeFormRenderOptions(render) };
  if (typeof nextCode === 'number') state.nextCode = nextCode;
  return state;
}
