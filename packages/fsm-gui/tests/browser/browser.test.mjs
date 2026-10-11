// The browser test of the GUI forms (docs/plans/fsm-v1.md, C-7; docs/plans/execution-checklist.md, S-22-1 and S-22-2). It runs
// the GUI server on a temporary project that holds the order machine and its lock, opens the edit form in a headless Chromium of
// the pinned Playwright package, and drives it as a user does: the add and remove buttons of the state and edge rows change the
// rows on the page, Save stores them, and the page afterwards shows the stored machine with its Mermaid diagram. Only the browser
// can see that a click changes the rows, so this test is the owner of the form behavior (make gui-browser-test).
// The browser is installed by make gui-browsers, which downloads it (ONLINE).
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

/** The state rows of the states collection of the edit form, and the edge rows of an event row. */
const STATE_ROWS = '[data-field-path="states"] > .crudui-node__body > .crudui-node--row';
const EVENT_ROWS = '[data-field-path="events"] > .crudui-node__body > .crudui-node--row';
const EDGE_ROWS = '[data-field-path$=".edges"] > .crudui-node__body > .crudui-node--row';
const ADD = 'button[data-crudui-action="add-row"]';
const REMOVE = 'button[data-crudui-action="remove-row"]';
const SAVE = '.crudui-form__footer button[type="submit"]';

let server;
let browser;
let page;
let root;
let url;
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

const readJson = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));

/** The machine's edit page, opened fresh; the test waits until the page has no pending load. */
async function openEdit() {
  await page.goto(`${url}/machines/order/edit`);
  // The client loads its chunks after the load event; the page is ready when the network is idle and the form is connected.
  await page.waitForLoadState('networkidle');
}

/** No uncaught error of the page: a script error would hide the defect that a test looks for. */
function expectNoPageErrors() {
  assert.deepEqual(pageErrors, []);
}

before(async () => {
  root = tempProject({
    'fsm.config.json': '{"store":"json"}\n',
    'machines/order.fsm.json': readFileSync(path.join(ROOT, 'machines/order.fsm.json'), 'utf8'),
    'fsm.lock.json': readFileSync(path.join(ROOT, 'fsm.lock.json'), 'utf8'),
  });
  const started = await startGui(root);
  server = started.child;
  url = started.url;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  page.setDefaultTimeout(5000);
  pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
});

after(async () => {
  await browser?.close();
  server?.kill('SIGTERM');
});

test('add on the last state row adds a row that holds the suggested code', async () => {
  await openEdit();
  const states = page.locator(STATE_ROWS);
  assert.equal(await states.count(), 5);
  await states.last().locator(ADD).click();
  assert.equal(await states.count(), 6, 'a click on the add button of a state row must add a row to the page');
  assert.equal(await states.last().locator('input[name$="[code]"]').inputValue(), '6');
  expectNoPageErrors();
});

test('a state with a key, final and a cancel edge from shipped to refunded is saved', async () => {
  const states = page.locator(STATE_ROWS);
  const added = states.last();
  await added.locator('input[name$="[newKey]"]').fill('refunded');
  await added.locator('input[name$="[final]"]').check();
  const cancel = page.locator(EVENT_ROWS, { has: page.locator('input[name$="[key]"][value="cancel"]') });
  const edges = cancel.locator(EDGE_ROWS);
  const before = await edges.count();
  await edges.last().locator(ADD).click();
  assert.equal(await edges.count(), before + 1, 'a click on the add button of the edges must add an edge row');
  await edges.last().locator('input[name$="[from]"]').fill('shipped');
  await edges.last().locator('input[name$="[to]"]').fill('refunded');
  await page.locator(SAVE).click();
  await page.waitForURL(address => new URL(address).pathname === '/machines/order');

  const machine = readJson('machines/order.fsm.json');
  assert.ok(machine.states.some(state => state.key === 'refunded' && state.code === 6 && state.final === true));
  assert.ok(machine.events.find(event => event.key === 'cancel').edges.some(edge => edge.from === 'shipped' && edge.to === 'refunded'));
  assert.equal(readJson('fsm.lock.json').order.codes['6'], 'refunded');

  const row = page.locator('tbody tr', { has: page.locator('td', { hasText: /^refunded$/ }) });
  assert.equal(await row.locator('td').nth(1).innerText(), '6');
  await page.locator('pre.mermaid svg').first().waitFor();
  expectNoPageErrors();
});

test('remove on the row and its edge, then Save, removes the state and the lock reserves its code', async () => {
  await openEdit();
  const row = page.locator(STATE_ROWS, { has: page.locator('input[name$="[key]"][value="refunded"]') });
  await row.locator(REMOVE).click();
  assert.equal(await row.count(), 0, 'a click on the remove button of a state row must take the row away');
  const cancel = page.locator(EVENT_ROWS, { has: page.locator('input[name$="[key]"][value="cancel"]') });
  const edge = cancel.locator(EDGE_ROWS, { has: page.locator('input[name$="[to]"][value="refunded"]') });
  await edge.locator(REMOVE).click();
  assert.equal(await edge.count(), 0, 'a click on the remove button of an edge row must take the row away');
  await page.locator(SAVE).click();
  await page.waitForURL(address => new URL(address).pathname === '/machines/order');

  const machine = readJson('machines/order.fsm.json');
  assert.equal(machine.states.some(state => state.key === 'refunded'), false);
  const lock = readJson('fsm.lock.json').order;
  assert.equal(lock.codes['6'], undefined);
  assert.deepEqual(lock.reserved, [6]);
  expectNoPageErrors();
});

test('a state row added after the removal suggests the next code, 7', async () => {
  await openEdit();
  const states = page.locator(STATE_ROWS);
  await states.last().locator(ADD).click();
  assert.equal(await states.count(), 6);
  assert.equal(await states.last().locator('input[name$="[code]"]').inputValue(), '7');
  expectNoPageErrors();
});
