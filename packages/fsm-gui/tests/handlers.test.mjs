// Tests of the loaders of packages/fsm-gui/src/handlers.mjs (docs/plans/fsm-v1.md, C-7) through the hyper application
// without HTTP: the machine list, the machine detail with the canonical Mermaid text byte for byte, an unknown machine that
// answers 404, and the findings of the project, which every page shows as errors.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { jsonStore } from '../../fsm-compiler/src/store-json/store.mjs';
import {
  BAD_JSON_TEXT, ORDER_JSON_TEXT, ORDER_LOCK_TEXT, ORDER_MERMAID_TEXT,
} from './canonical.mjs';
import { get, mermaidText, openApp, tempProject } from './helpers.mjs';

test('the machine list shows every machine of the project as a link to its detail', async () => {
  const root = tempProject({ 'machines/order.fsm.json': ORDER_JSON_TEXT, 'fsm.lock.json': ORDER_LOCK_TEXT });
  const app = await openApp(jsonStore(root));
  const response = await get(app, '/');
  assert.equal(response.status, 200);
  assert.match(response.body, /<a href="\/machines\/order">order<\/a>/);
  assert.match(response.body, /<h1>Machines<\/h1>/);
});

test('the machine detail shows the canonical Mermaid text byte for byte in the mermaid element', async () => {
  const root = tempProject({ 'machines/order.fsm.json': ORDER_JSON_TEXT, 'fsm.lock.json': ORDER_LOCK_TEXT });
  const app = await openApp(jsonStore(root));
  const response = await get(app, '/machines/order');
  assert.equal(response.status, 200);
  assert.equal(mermaidText(response.body), ORDER_MERMAID_TEXT);
  assert.match(response.body, /<pre class="mermaid">/);
});

test('the machine detail lists the states with their codes and flags, and the events with their edges', async () => {
  const root = tempProject({ 'machines/order.fsm.json': ORDER_JSON_TEXT, 'fsm.lock.json': ORDER_LOCK_TEXT });
  const app = await openApp(jsonStore(root));
  const body = (await get(app, '/machines/order')).body;
  assert.match(body, /<tr><td>draft<\/td><td>1<\/td><td>yes<\/td><td>-<\/td><\/tr>/);
  assert.match(body, /<tr><td>done<\/td><td>4<\/td><td>-<\/td><td>yes<\/td><\/tr>/);
  assert.match(body, /<tr><td>prev<\/td><td>shipped<\/td><td>paid<\/td><\/tr>/);
  assert.match(body, /<tr><td>cancel<\/td><td>paid<\/td><td>canceled<\/td><\/tr>/);
});

test('an unknown machine answers 404', async () => {
  const root = tempProject({ 'machines/order.fsm.json': ORDER_JSON_TEXT, 'fsm.lock.json': ORDER_LOCK_TEXT });
  const app = await openApp(jsonStore(root));
  assert.equal((await get(app, '/machines/missing')).status, 404);
  assert.equal((await get(app, '/machines/Not%20A%20Key')).status, 404);
});

test('a load finding is rendered as an error on the list and on the detail page', async () => {
  const root = tempProject({
    'machines/order.fsm.json': ORDER_JSON_TEXT,
    'fsm.lock.json': ORDER_LOCK_TEXT,
    'machines/broken.fsm.json': '{ "machine": ',
  });
  const app = await openApp(jsonStore(root));
  const list = (await get(app, '/')).body;
  assert.match(list, /role="alert"/);
  assert.match(list, /<code>E_SCHEMA<\/code>/);
  assert.match(list, /machines\/broken\.fsm\.json is not valid JSON/);
  const detail = (await get(app, '/machines/order')).body;
  assert.match(detail, /<code>E_SCHEMA<\/code>/);
  assert.match(detail, /machines\/broken\.fsm\.json is not valid JSON/);
});

test('a machine with a validation finding is listed with its finding and gets no diagram', async () => {
  const root = tempProject({ 'machines/bad.fsm.json': BAD_JSON_TEXT });
  const app = await openApp(jsonStore(root));
  const list = (await get(app, '/')).body;
  assert.match(list, /<code>E_INITIAL_COUNT<\/code> <strong>bad<\/strong>/);
  const detail = await get(app, '/machines/bad');
  assert.equal(detail.status, 200);
  assert.match(detail.body, /<code>E_INITIAL_COUNT<\/code>/);
  assert.equal(mermaidText(detail.body), null);
  assert.match(detail.body, /The diagram is not shown while the machine has errors\./);
});

test('the store of the list is the store of the project: a machine added on disk is listed on the next request', async () => {
  const root = tempProject({ 'machines/order.fsm.json': ORDER_JSON_TEXT, 'fsm.lock.json': ORDER_LOCK_TEXT });
  const app = await openApp(jsonStore(root));
  assert.doesNotMatch((await get(app, '/')).body, /href="\/machines\/track"/);
  writeFileSync(path.join(root, 'machines', 'track.fsm.json'), '{ "machine": "track", "states": [{ "key": "only", "code": 1, "initial": true, "final": true }], "events": [] }\n');
  assert.match((await get(app, '/')).body, /href="\/machines\/track">track<\/a>/);
});
