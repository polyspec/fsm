// Tests of the rename screen (docs/plans/fsm-v1.md, C-7; docs/spec/fsm.md, B-3) through the hyper application without HTTP,
// for the json, mermaid and db stores: the screen lists the stored states with their keys read-only; a rename changes a key,
// keeps its code and moves its edges (core run lock with renames); a refused rename writes nothing and shows its finding on the
// new key of the state it names; and a rename needs the CSRF token of its page.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { openApp } from './helpers.mjs';
import {
  KINDS, ORDER_STATES, csrfOf, newSession, openProject, page, post,
} from './edit-support.mjs';

const GUI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FSM_GEN = path.join(GUI, '..', 'fsm-compiler', 'src', 'cli', 'fsm-gen.mjs');

/** The fields of the rename form: each stored state posts its key and the new key in `to` (empty when it keeps its key). */
function renamePairs(renames = {}) {
  return ORDER_STATES.flatMap(state => [
    [`form[states][${state.rk}][key]`, state.key],
    [`form[states][${state.rk}][to]`, renames[state.key] ?? ''],
  ]);
}

/** Opens the rename screen of the order example in `kind`: the application, the session and the CSRF token of the page. */
async function renaming(t, kind) {
  const project = await openProject(kind);
  t.after(() => project.close());
  const app = await openApp(project.store);
  const session = newSession();
  const opened = await page(app, '/machines/order/rename', session);
  assert.equal(opened.status, 200);
  return { project, app, session, csrf: csrfOf(opened.body) };
}

for (const kind of KINDS) {
  test(`${kind}: the rename screen lists the stored states with read-only keys and a field for the new key`, async t => {
    const { app, session } = await renaming(t, kind);
    const response = await page(app, '/machines/order/rename', session);
    assert.match(response.body, /<form action="\/machines\/order\/rename" method="post">/);
    assert.match(response.body, /readOnly=""[^>]*name="form\[states\]\[__0000000000002__\]\[key\]" value="paid"/);
    assert.match(response.body, /name="form\[states\]\[__0000000000002__\]\[to\]"/);
  });

  test(`${kind}: a rename changes the key, keeps the code, moves the edges and passes check`, async t => {
    const { project, app, session, csrf } = await renaming(t, kind);
    const response = await post(app, '/machines/order/rename', [['_csrf', csrf], ...renamePairs({ paid: 'confirmed' })], session);
    assert.equal(response.status, 303);
    assert.equal(response.headers.Location, '/machines/order');
    const loaded = await project.store.load();
    const order = loaded.definitions.find(definition => definition.machine === 'order');
    assert.deepEqual(order.states.find(state => state.code === 2), { key: 'confirmed', code: 2 });
    assert.equal(order.events.find(event => event.key === 'next').edges[0].to, 'confirmed');
    assert.equal(loaded.lock.order.codes['2'], 'confirmed');
    assert.deepEqual(loaded.lock.order.reserved, []);
    if (kind !== 'db') {
      const check = spawnSync(process.execPath, [FSM_GEN, 'check', '--project', project.root], { encoding: 'utf8' });
      assert.equal(check.status, 0, check.stderr);
    }
  });

  test(`${kind}: a rename to an invalid or taken key is refused with the finding on its new key and writes nothing`, async t => {
    const { project, app, session, csrf } = await renaming(t, kind);
    const before = JSON.stringify(await project.store.load());
    const invalid = await post(app, '/machines/order/rename', [['_csrf', csrf], ...renamePairs({ paid: 'Not Valid' })], session);
    assert.equal(invalid.status, 422);
    assert.match(invalid.body, /<code>E_KEY_FORMAT<\/code>/);
    const field = invalid.body.indexOf('data-field-path="states.__0000000000002__.to"');
    assert.notEqual(field, -1);
    assert.notEqual(invalid.body.indexOf('crudui-node__error', field), -1);
    const taken = await post(app, '/machines/order/rename', [['_csrf', csrf], ...renamePairs({ paid: 'done' })], session);
    assert.equal(taken.status, 422);
    assert.match(taken.body, /<code>E_DUPLICATE_KEY<\/code>/);
    assert.equal(JSON.stringify(await project.store.load()), before);
  });

  test(`${kind}: a rename without the CSRF token of its page is 403 and writes nothing`, async t => {
    const { project, app, session } = await renaming(t, kind);
    const before = JSON.stringify(await project.store.load());
    assert.equal((await post(app, '/machines/order/rename', renamePairs({ paid: 'confirmed' }), session)).status, 403);
    assert.equal(JSON.stringify(await project.store.load()), before);
  });
}
