// Tests of the store selection of packages/gui/src/store.mjs (docs/spec/fsm.md, B-2): the store that
// fsm.config.json names is the store the GUI reads, and a configuration it cannot use is a finding, never a fallback.
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { openStore } from '../src/store.mjs';
import { ORDER_JSON_TEXT } from './canonical.mjs';
import { tempProject } from './helpers.mjs';

const configured = store => tempProject({ 'fsm.config.json': `${JSON.stringify(store)}\n` });

test('the json store named by fsm.config.json is selected for a project without machines', async () => {
  const opened = await openStore(configured({ store: 'json' }), {});
  assert.equal(opened.findings, undefined);
  const { definitions } = await opened.store.load();
  assert.deepEqual(definitions, []);
  await opened.close();
});

test('the mermaid store named by fsm.config.json is read from the project', async () => {
  const root = tempProject({
    'fsm.config.json': '{"store":"mermaid"}\n',
    'machines/order.fsm.mmd': '---\ntitle: order\n---\nstateDiagram-v2\n    state "draft" as draft\n    draft : 1\n    [*] --> draft\n    draft --> [*]\n',
    'fsm.lock.json': '{\n  "order": {\n    "codes": {\n      "1": "draft"\n    },\n    "reserved": []\n  }\n}\n',
  });
  const opened = await openStore(root, {});
  assert.equal(opened.findings, undefined);
  const loaded = await opened.store.load();
  assert.equal(loaded.definitions[0].machine, 'order');
  await opened.close();
});

test('the json store reads the machines of the project', async () => {
  const root = tempProject({ 'fsm.config.json': '{"store":"json"}\n', 'machines/order.fsm.json': ORDER_JSON_TEXT });
  const opened = await openStore(root, {});
  const loaded = await opened.store.load();
  assert.deepEqual(loaded.definitions.map(definition => definition.machine), ['order']);
});

test('a project without fsm.config.json is a finding of E_STORE_NOT_CONFIGURED', async () => {
  const opened = await openStore(tempProject({}), {});
  assert.equal(opened.store, undefined);
  assert.deepEqual(opened.findings.map(({ code, path: at }) => [code, at]), [['E_STORE_NOT_CONFIGURED', '$']]);
});

test('a configuration that is not valid JSON is a finding', async () => {
  const opened = await openStore(tempProject({ 'fsm.config.json': '{ "store": ' }), {});
  assert.equal(opened.findings[0].code, 'E_STORE_NOT_CONFIGURED');
  assert.match(opened.findings[0].message, /not valid JSON/);
});

test('a store that the GUI does not handle is a finding at $.store', async () => {
  const opened = await openStore(configured({ store: 'xml' }), {});
  assert.deepEqual(opened.findings.map(({ code, path: at }) => [code, at]), [['E_STORE_NOT_CONFIGURED', '$.store']]);
});

test('the db store without its DSN in the environment is a finding; the DSN is not read from anywhere else', async () => {
  const root = configured({ store: 'db', dsnEnv: 'FSM_DSN' });
  const missing = await openStore(root, {});
  assert.deepEqual(missing.findings.map(({ code, path: at }) => [code, at]), [['E_STORE_NOT_CONFIGURED', '$.dsnEnv']]);
  assert.match(missing.findings[0].message, /FSM_DSN is not set/);
  const empty = await openStore(root, { FSM_DSN: '' });
  assert.equal(empty.findings[0].path, '$.dsnEnv');
});

test('a db configuration without dsnEnv is a finding', async () => {
  const opened = await openStore(configured({ store: 'db' }), {});
  assert.equal(opened.findings[0].path, '$.dsnEnv');
});
