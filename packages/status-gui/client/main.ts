// The one browser script of the status GUI (docs/plans/status-v1.md, C-7). It starts the hyper client, which renders the
// regions that the server sends, and it runs Mermaid on every diagram of the page: once when the page loads and again after
// every htmx swap, because a swap replaces the <pre class="mermaid"> element of the new page.
import htmx from 'htmx.org/dist/htmx.esm.js';
import mermaid from 'mermaid';
import { createApplication, Hyper, type HtmxApi, type Manifest, type TemplateIndex } from '@polyspec/hyper-client';
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
document.addEventListener('htmx:after:settle', () => {
  void mermaid.run();
});

void hyper.open();
