// Tests of deleting a state in the edit form (docs/spec/fsm.md, B-3) through the hyper application without HTTP, for the json,
// mermaid and db stores: a save without a stored state moves the code of that state to the lock's reserved list and removes it
// from the lock's codes, and the project passes check.
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openApp } from './helpers.mjs';
import {
  KINDS, csrfOf, editPairs, newSession, openProject, orderRows, page, post,
} from './edit-support.mjs';

const GUI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FSM_GEN = path.join(GUI, '..', 'compiler', 'src', 'cli', 'fsm-gen.mjs');

for (const kind of KINDS) {
  test(`${kind}: deleting a state in the edit form moves its code to reserved and removes it from the codes`, async t => {
    const project = await openProject(kind);
    t.after(() => project.close());
    const app = await openApp(project.store);
    const session = newSession();
    const csrf = csrfOf((await page(app, '/machines/order/edit', session)).body);
    const rows = orderRows();
    const response = await post(app, '/machines/order/edit', [['_csrf', csrf], ...editPairs({
      states: rows.states.filter(state => state.key !== 'canceled'),
      events: rows.events.filter(event => event.key !== 'cancel'),
    })], session);
    assert.equal(response.status, 303);
    assert.equal(response.headers.Location, '/machines/order');
    const { definitions, lock } = await project.store.load();
    assert.deepEqual(definitions.find(definition => definition.machine === 'order').states.map(state => state.key), ['draft', 'paid', 'shipped', 'done']);
    assert.equal(Object.hasOwn(lock.order.codes, '5'), false);
    assert.deepEqual(Object.values(lock.order.codes).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), ['done', 'draft', 'paid', 'shipped']);
    assert.deepEqual(lock.order.reserved, [5]);
    if (kind !== 'db') {
      const check = spawnSync(process.execPath, [FSM_GEN, 'check', '--project', project.root], { encoding: 'utf8' });
      assert.equal(check.status, 0, check.stderr);
    }
  });
}
