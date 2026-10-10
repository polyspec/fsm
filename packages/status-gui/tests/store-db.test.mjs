// Tests of the db store of the GUI (docs/spec/status.md, B-2; docs/plans/status-v1.md, C-6 and C-7): the database that the
// DSN in the environment names is read through the DB store of packages/status-db, and the list page shows its machines. The
// database is a SQLite file in a temporary project, with the schema of schema/status.dbs installed by the same orm package.
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { dbStore } from '../../status-db/src/db-store.mjs';
import { SCHEMA, connect } from '../../status-db/src/models/models.ts';
import { jsonStore } from '../../status-compiler/src/store-json/store.mjs';
import { openStore } from '../src/store.mjs';
import { ORDER_JSON_TEXT, ORDER_LOCK_TEXT } from './canonical.mjs';
import { get, openApp, tempProject } from './helpers.mjs';

test('the db store named by status.config.json reads the machines of the database that the DSN names', async () => {
  const root = tempProject({
    'status.config.json': '{"store":"db","dsnEnv":"STATUS_DSN"}\n',
    'machines/order.status.json': ORDER_JSON_TEXT,
    'status.lock.json': ORDER_LOCK_TEXT,
  });
  const dsn = `sqlite://${path.join(root, 'status.sqlite')}`;
  const seed = await connect(dsn);
  await seed.utils().schema().install(SCHEMA);
  await dbStore(seed).save(await jsonStore(root).load());
  await seed.close();

  const opened = await openStore(root, { STATUS_DSN: dsn });
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
