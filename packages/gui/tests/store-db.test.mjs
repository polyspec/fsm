// Tests of the db store of the GUI (docs/spec/fsm.md, B-2; docs/plans/fsm-v1/plan.md, C-6 and C-7): the database that the
// DSN in the environment names is read through the DB store of packages/db, and the list page shows its machines. The
// database is a SQLite file in a temporary project, with the schema of packages/db/schema/fsm.dbs installed by the same orm package.
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { dbStore } from '../../db/src/db-store.mjs';
import { SCHEMA, connect } from '../../db/src/models/models.ts';
import { jsonStore } from '../../compiler/src/store-json/store.mjs';
import { openStore } from '../src/store.mjs';
import { ORDER_JSON_TEXT, ORDER_LOCK_TEXT } from './canonical.mjs';
import { get, openApp, tempProject } from './helpers.mjs';

test('the db store named by fsm.config.json reads the machines of the database that the DSN names', async () => {
  const root = tempProject({
    'fsm.config.json': '{"store":"db","dsnEnv":"FSM_DSN"}\n',
    'machines/order.fsm.json': ORDER_JSON_TEXT,
    'fsm.lock.json': ORDER_LOCK_TEXT,
  });
  const dsn = `sqlite://${path.join(root, 'fsm.sqlite')}`;
  const seed = await connect(dsn);
  await seed.utils().schema().install(SCHEMA);
  await dbStore(seed).save(await jsonStore(root).load());
  await seed.close();

  const opened = await openStore(root, { FSM_DSN: dsn });
  assert.equal(opened.findings, undefined);
  const loaded = await opened.store.load();
  assert.deepEqual(loaded.definitions.map(definition => definition.machine), ['order']);
  assert.equal(loaded.findings.length, 0);

  const app = await openApp(opened.store);
  const list = await get(app, '/');
  assert.match(list.body, /<a href="\/machines\/order">order<\/a>/);
  const detail = await get(app, '/machines/order');
  assert.equal(detail.status, 200);
  assert.match(detail.body, /<pre class="mermaid">---\ntitle: order\n---\nstateDiagram-v2\n/);
  await opened.close();
});
