// Helpers of the GUI tests: temporary projects, the hyper application of the GUI with the given store, requests without HTTP,
// and the text of the Mermaid element of a page. A temporary project is removed when the test file ends.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after } from 'node:test';
import { App, MemorySessionStore, Request } from '@polyspec/hyper-server';
import { handlers } from '../src/handlers.mjs';

const GUI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A new temporary project directory, holding the files of `files` ({ relative path: text }). */
export function tempProject(files = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'status-gui-'));
  roots.push(root);
  for (const [relative, text] of Object.entries(files)) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}

/** The hyper application of the GUI, with `store` as its store. The build (make gui-build) must have written the templates. */
export async function openApp(store) {
  if (!existsSync(path.join(GUI, 'build', 'templates.index.json'))) {
    throw new Error('build/templates.index.json is missing; run make gui-build first');
  }
  const app = await App.open({
    manifest: path.join(GUI, 'app', 'app.json'),
    templates: { index: path.join(GUI, 'build', 'templates.index.json'), root: path.join(GUI, 'public') },
    handlers,
    timezone: 'UTC',
  });
  app.bind('store', () => store);
  app.bind('assets', () => ({ hyper: '/assets/hyper-test.js' }));
  return app;
}

/** The response of a GET request to `target` through the application, without HTTP. */
export function get(app, target, accept = 'text/html') {
  return app.handle(Request.from({ method: 'GET', target, headers: { Accept: accept } }), new MemorySessionStore());
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

/** The text of the first `<pre class="mermaid">` element of an HTML page, with the entities of the template decoded; null when none. */
export function mermaidText(html) {
  const match = /<pre class="mermaid">([\s\S]*?)<\/pre>/.exec(html);
  if (match === null) return null;
  return match[1].replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ENTITIES[entity]);
}
