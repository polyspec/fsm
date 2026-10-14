// The browser test of the drawn Mermaid diagram (docs/spec/fsm.md, B-1; docs/plans/execution-checklist.md, S-38). It runs the
// GUI server on a temporary project that holds the order machine and its lock, opens the machine page in a headless Chromium
// of the pinned Playwright package, and reads the labels of the svg that Mermaid draws. A state that the diagram draws without
// its key is not named, so every state key and every code of the machine must be one of the drawn labels. The test is run by
// make gui-browser-test, which needs the browser of make gui-browsers and the built assets of make gui-build.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { tempProject } from '../helpers.mjs';

const GUI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = path.resolve(GUI, '..', '..');
const MAIN = path.join(GUI, 'src', 'main.mjs');

let server;
let browser;
let page;
let url;
let machine;
let pageErrors = [];

/** Starts the GUI on `project` with port 0 and resolves with its address, from the line that the server prints. */
function startGui(project) {
  const child = spawn(process.execPath, [MAIN, '--project', project, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
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
  });
}

/** The texts of the labels that the drawn svg of the page holds, trimmed, without repetition. */
async function drawnLabels() {
  return page.evaluate(() => {
    const svg = document.querySelector('pre.mermaid svg');
    if (svg === null) return null;
    const texts = [...svg.querySelectorAll('.nodeLabel, text, tspan, foreignObject div, foreignObject span, foreignObject p')]
      .map(element => element.textContent.trim())
      .filter(text => text !== '');
    return [...new Set(texts)];
  });
}

before(async () => {
  const root = tempProject({
    'fsm.config.json': '{"store":"json"}\n',
    'machines/order.fsm.json': readFileSync(path.join(ROOT, 'machines/order.fsm.json'), 'utf8'),
    'fsm.lock.json': readFileSync(path.join(ROOT, 'fsm.lock.json'), 'utf8'),
  });
  machine = JSON.parse(readFileSync(path.join(root, 'machines/order.fsm.json'), 'utf8'));
  const started = await startGui(root);
  server = started.child;
  url = started.url;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => pageErrors.push(error.message));
});

after(async () => {
  await browser?.close();
  server?.kill('SIGTERM');
});

test('the drawn diagram of the machine page names every state by its key and shows its code', async () => {
  await page.goto(`${url}/machines/order`);
  await page.locator('pre.mermaid svg').first().waitFor();
  await page.waitForFunction(() => document.querySelectorAll('pre.mermaid svg text').length > 0);
  const labels = await drawnLabels();
  assert.notEqual(labels, null, 'the page draws a Mermaid svg');
  for (const state of machine.states) {
    assert.ok(labels.includes(state.key), `the drawn diagram has no label ${state.key}; its labels are ${JSON.stringify(labels)}`);
    assert.ok(labels.includes(String(state.code)), `the drawn diagram has no label ${state.code}; its labels are ${JSON.stringify(labels)}`);
  }
  assert.deepEqual(pageErrors, []);
});
