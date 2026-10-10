// The one browser script of the status GUI (docs/plans/status-v1.md, C-7). It starts the hyper client, which renders the
// regions that the server sends, and it runs Mermaid on every diagram of the page: once when the page loads and again after
// every htmx swap, because a swap replaces the <pre class="mermaid"> element of the new page. The edit form is a crudui form:
// after the page loads and after every htmx swap, connectForm binds the rendered form to its instance, so that its add and
// remove buttons of the rows work. The instance is created from the template and the data that the server embeds in the page.
// The same embedded state carries the next code of the machine, and every state row added in the browser takes it, then the codes
// after it (new-codes.ts).
import htmx from 'htmx.org/dist/htmx.esm.js';
import mermaid from 'mermaid';
import { createApplication, Hyper, type HtmxApi, type Manifest, type TemplateIndex } from '@polyspec/hyper-client';
import { connectForm, createForm, type FormConnection, type FormTemplate } from '@polyspec/crudui-generator-core';
import type { Template } from '@polyspec/template/render';
import manifest from '../app/app.json';
import index from '@polyspec/hyper-client/templates-index';
import { codesOfAddedRows } from './new-codes';

// Mermaid reads the canonical text of each <pre class="mermaid"> element that the server wrote. The securityLevel stays
// strict, so Mermaid sanitizes the labels it renders.
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });

const app = createApplication(manifest as Manifest, index as TemplateIndex, async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`template ${url}: status ${response.status}`);
  return (await response.json()) as Template;
});
const hyper = new Hyper(app, htmx as unknown as HtmxApi, { basePath: '' });
(window as unknown as { hyper: Hyper }).hyper = hyper;

htmx.registerExtension('hyper', hyper.extension());

// The first load renders the diagrams of the page that the server sent; every later swap renders the new page's diagrams.
void mermaid.run();

// The connection of the edit form on the page: the form that the last render wrote, bound to its instance. A render replaces the
// form element, so the connection of the old element is removed before the new one is bound.
let formConnection: FormConnection | undefined;
// The observer of the edit form: a row that the browser adds or removes changes the codes of the added rows, so the codes are
// written again after every change of the rows.
let codeObserver: MutationObserver | undefined;

/** The input of the code of a state row, given the input of its persisted flag; a row without a code field is a broken form. */
function codeInputOf(persistedInput: HTMLInputElement): HTMLInputElement {
  const name = persistedInput.name.replace(/\[persisted\]$/, '[code]');
  const input = document.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (input === null) throw new Error(`the state row of ${persistedInput.name} has no code field`);
  return input;
}

/** Writes the codes of the state rows of the form: stored rows keep theirs, and each added row takes the next code. */
function fillAddedCodes(form: HTMLElement, next: number): void {
  const persisted = [...form.querySelectorAll<HTMLInputElement>('input[name^="form[states]["][name$="[persisted]"]')];
  const codes = persisted.map(codeInputOf);
  const values = codesOfAddedRows(persisted.map((input, index) => ({ persisted: input.value, code: codes[index].value })), next);
  codes.forEach((input, index) => {
    input.value = values[index];
  });
}

/** Binds the edit form of the page to its instance, when the page has one; a page without a form has no connection. */
function connectEditForm(): void {
  formConnection?.disconnect();
  formConnection = undefined;
  codeObserver?.disconnect();
  codeObserver = undefined;
  const state = document.getElementById('status-form-state');
  const form = document.querySelector<HTMLElement>('.crudui-form');
  if (state === null || form === null) return;
  const { template, data, nextCode } = JSON.parse(state.textContent ?? '') as {
    template: FormTemplate; data: Record<string, unknown>; nextCode: number | null;
  };
  formConnection = connectForm(form, createForm(template, data, { language: 'en' }));
  // A null next code is no suggestion: the save shows the finding of the core, and the added rows keep their blank codes.
  if (nextCode === null) return;
  codeObserver = new MutationObserver(() => fillAddedCodes(form, nextCode));
  codeObserver.observe(form, { childList: true, subtree: true });
  fillAddedCodes(form, nextCode);
}

connectEditForm();
document.addEventListener('htmx:after:settle', () => {
  void mermaid.run();
  connectEditForm();
});

void hyper.open();
