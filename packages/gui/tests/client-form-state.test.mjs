// Tests of the decoder of the form state that the edit page embeds (docs/plans/fsm-v1/plan.md, C-7; docs/plans/fsm-v1/checklist.md,
// S-44-18). client/main.ts reads the fsm-form-state element through decodeFormState: crudui decodes the template and the render
// options, and fsm checks data and nextCode, the fields of its own envelope. The state is the one that editState of the server
// writes, so the test decodes what the page carries.
import assert from 'node:assert/strict';
import test from 'node:test';
import { FormTemplateError } from '@polyspec/crudui-generator-core';
import { decodeFormState, FormRenderOptionsError } from '../client/form-state.ts';
import { editState } from '../src/forms.mjs';

const OPTIONS = { csrf: 'token', formErrors: ['a finding of the form'], errors: [{ path: 'form.states', message: 'a finding of the states' }] };
const DATA = { machine: 'order' };

/** The JSON text that editState writes, with the next code 6 or, given findings, no next code. */
const stateText = (next = { code: 6, findings: [] }) => editState('order', DATA, next, OPTIONS).replaceAll('\\u003c', '<');

/** The JSON text of the state that editState writes, with `change` applied to the parsed object. */
function changed(change) {
  const value = JSON.parse(stateText());
  change(value);
  return JSON.stringify(value);
}

test('the state that the edit page embeds decodes to its template, data, next code and render options', () => {
  const embedded = JSON.parse(stateText());
  const state = decodeFormState(stateText());
  assert.deepEqual(state.template, embedded.template);
  assert.deepEqual(state.data, DATA);
  assert.equal(state.nextCode, 6);
  assert.deepEqual(state.render, embedded.render);
});

test('a machine without a next code has a state without nextCode', () => {
  const state = decodeFormState(stateText({ findings: [{ code: 'E_CODE_RANGE' }] }));
  assert.equal('nextCode' in state, false);
});

test('a state that is no object, or whose data is no plain object, fails naming the member', () => {
  assert.throws(() => decodeFormState('[]'), /the form state is not an object/);
  assert.throws(() => decodeFormState(changed(value => { value.data = ['order']; })), /data of the form state is not an object/);
  assert.throws(() => decodeFormState(changed(value => { delete value.data; })), /data of the form state is not an object/);
});

test('a nextCode that is no integer fails', () => {
  assert.throws(() => decodeFormState(changed(value => { value.nextCode = '6'; })), /nextCode of the form state is not an integer/);
  assert.throws(() => decodeFormState(changed(value => { value.nextCode = 6.5; })), /nextCode of the form state is not an integer/);
});

test('an invalid template or invalid render options fail with the error of crudui', () => {
  assert.throws(() => decodeFormState(changed(value => { value.template = { nodes: 'none' }; })), FormTemplateError);
  assert.throws(() => decodeFormState(changed(value => { value.render.formErrors = 'one'; })), FormRenderOptionsError);
});
