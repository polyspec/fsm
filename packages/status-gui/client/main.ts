// The one browser script of the status GUI (docs/plans/status-v1.md, C-7). It starts the hyper client, which renders the
// regions that the server sends, and it runs Mermaid on every diagram of the page: once when the page loads and again after
// every htmx swap, because a swap replaces the <pre class="mermaid"> element of the new page. The edit form is a crudui form:
// after the page loads and after every htmx swap, connectForm binds the rendered form to its instance, so that its add and
// remove buttons of the rows work. The instance is created from the template and the data that the server embeds in the page.
import htmx from 'htmx.org/dist/htmx.esm.js';
import mermaid from 'mermaid';
import { createApplication, Hyper, type HtmxApi, type Manifest, type TemplateIndex } from '@polyspec/hyper-client';
import { connectForm, createForm, type FormConnection, type FormTemplate } from '@polyspec/crudui-generator-core';
import type { Template } from '@polyspec/template/render';
import manifest from '../app/app.json';
import index from '@polyspec/hyper-client/templates-index';

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

/** Binds the edit form of the page to its instance, when the page has one; a page without a form has no connection. */
function connectEditForm(): void {
  formConnection?.disconnect();
  formConnection = undefined;
  const state = document.getElementById('status-form-state');
  const form = document.querySelector<HTMLElement>('.crudui-form');
  if (state === null || form === null) return;
  const { template, data } = JSON.parse(state.textContent ?? '') as { template: FormTemplate; data: Record<string, unknown> };
  formConnection = connectForm(form, createForm(template, data, { language: 'en' }));
}

connectEditForm();
document.addEventListener('htmx:after:settle', () => {
  void mermaid.run();
  connectEditForm();
});

void hyper.open();
