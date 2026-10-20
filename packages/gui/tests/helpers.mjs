// Helpers of the GUI tests: temporary projects, the hyper application of the GUI with the given store, requests without HTTP,
// and the text of the Mermaid element of a page. A temporary project is removed when the test file ends.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
import { MemorySessionStore, Request } from '@polyspec/hyper-server';
import { GUI, openApplication } from '../src/application.mjs';
import { ORDER_JSON_TEXT, ORDER_LOCK_TEXT } from './canonical.mjs';

const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A new temporary project directory, holding the files of `files` ({ relative path: text }). */
export function tempProject(files = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'fsm-gui-'));
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
  return openApplication(store, () => ({ hyper: '/assets/hyper-test.js' }));
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

/**
 * Starts the GUI server on `project` with port 0 and resolves with the child process and its url, from the line that the server
 * prints. The caller stops the child. A server that exits first, or prints no address in 30 seconds, rejects.
 */
export function startGui(project) {
  const child = spawn(process.execPath, [path.join(GUI, 'src', 'main.mjs'), '--project', project, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    child.stdout.on('data', chunk => {
      out += chunk;
      const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(out);
      if (match !== null) resolve({ child, url: `http://127.0.0.1:${match[1]}` });
    });
    child.stderr.on('data', chunk => {
      err += chunk;
    });
    child.on('exit', code => reject(new Error(`the GUI server exited with ${code}: ${err}`)));
    setTimeout(() => reject(new Error(`no listening line: ${out} ${err}`)), 30000).unref();
  });
}

/** A new temporary project of the json store with the order example and its lock. */
export function orderProject() {
  return tempProject({
    'fsm.config.json': '{"store":"json"}\n',
    'machines/order.fsm.json': ORDER_JSON_TEXT,
    'fsm.lock.json': ORDER_LOCK_TEXT,
  });
}
