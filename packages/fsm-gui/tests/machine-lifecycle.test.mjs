// Tests of adding and deleting a machine (docs/plans/fsm-v1.md, C-7; docs/spec/fsm.md, B-3) through the hyper application
// without HTTP, for the json, mermaid and db stores: a new machine is created from its form as a minimal valid machine whose
// state takes the code that core nextCode suggests; a machine with an invalid key is refused with the finding on its field;
// deleting a machine is a save without it, after which its codes are reserved in the lock; a deleted machine that is added
// again starts after its reserved codes; and a delete needs the CSRF token of its page.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { openApp, tempProject } from './helpers.mjs';
import { openStore } from '../src/store.mjs';
import {
  KINDS, csrfOf, newSession, openProject, page, post,
} from './edit-support.mjs';

const GUI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FSM_GEN = path.join(GUI, '..', 'fsm-compiler', 'src', 'cli', 'fsm-gen.mjs');

test('the new machine page shows the findings of the project, as every page does', async t => {
  const root = tempProject({
    'fsm.config.json': '{"store":"json"}\n',
    'machines/broken.fsm.json': '{ "machine": ',
  });
  const opened = await openStore(root, {});
  t.after(() => opened.close());
  const app = await openApp(opened.store);
  const response = await page(app, '/new', newSession());
  assert.equal(response.status, 200);
  assert.match(response.body, /<code>E_SCHEMA<\/code>/);
});

for (const kind of KINDS) {
  test(`${kind}: the new machine form creates a minimal valid machine whose only state takes the next code`, async t => {
    const project = await openProject(kind);
    t.after(() => project.close());
    const app = await openApp(project.store);
    const session = newSession();
    const opened = await page(app, '/new', session);
    assert.equal(opened.status, 200);
    const csrf = csrfOf(opened.body);
    const response = await post(app, '/new', [['_csrf', csrf], ['form[machine]', 'track'], ['form[state]', 'only']], session);
    assert.equal(response.status, 303);
    assert.equal(response.headers.Location, '/machines/track');
    const loaded = await project.store.load();
    const track = loaded.definitions.find(definition => definition.machine === 'track');
    assert.deepEqual(track, { machine: 'track', states: [{ key: 'only', code: 1, initial: true, final: true }], events: [] });
    assert.deepEqual(loaded.lock.track, { codes: { 1: 'only' }, reserved: [] });
    if (kind !== 'db') {
      const check = spawnSync(process.execPath, [FSM_GEN, 'check', '--project', project.root], { encoding: 'utf8' });
      assert.equal(check.status, 0, check.stderr);
    }
  });

  test(`${kind}: a new machine with an invalid key is refused with the finding on its machine field and writes nothing`, async t => {
    const project = await openProject(kind);
    t.after(() => project.close());
    const app = await openApp(project.store);
    const session = newSession();
    const csrf = csrfOf((await page(app, '/new', session)).body);
    const before = JSON.stringify(await project.store.load());
    const response = await post(app, '/new', [['_csrf', csrf], ['form[machine]', 'Track'], ['form[state]', 'only']], session);
    assert.equal(response.status, 422);
    assert.match(response.body, /<code>E_KEY_FORMAT<\/code>/);
    const field = response.body.indexOf('data-field-path="machine"');
    assert.notEqual(field, -1);
    assert.notEqual(response.body.indexOf('crudui-node__error', field), -1);
    assert.equal(JSON.stringify(await project.store.load()), before);
  });

  test(`${kind}: deleting a machine is a save without it: its codes move to the lock's reserved list`, async t => {
    const project = await openProject(kind);
    t.after(() => project.close());
    const app = await openApp(project.store);
    const session = newSession();
    const csrf = csrfOf((await page(app, '/machines/order', session)).body);
    const response = await post(app, '/machines/order/delete', [['_csrf', csrf]], session);
    assert.equal(response.status, 303);
    assert.equal(response.headers.Location, '/');
    const loaded = await project.store.load();
    assert.equal(loaded.definitions.some(definition => definition.machine === 'order'), false);
    assert.deepEqual(loaded.lock.order, { codes: {}, reserved: [1, 2, 3, 4, 5] });
    if (kind !== 'db') {
      const check = spawnSync(process.execPath, [FSM_GEN, 'check', '--project', project.root], { encoding: 'utf8' });
      assert.equal(check.status, 0, check.stderr);
    }
  });

  test(`${kind}: a deleted machine that is added again starts after its reserved codes`, async t => {
    const project = await openProject(kind);
    t.after(() => project.close());
    const app = await openApp(project.store);
    const session = newSession();
    const csrf = csrfOf((await page(app, '/machines/order', session)).body);
    assert.equal((await post(app, '/machines/order/delete', [['_csrf', csrf]], session)).status, 303);
    const again = csrfOf((await page(app, '/new', session)).body);
    const response = await post(app, '/new', [['_csrf', again], ['form[machine]', 'order'], ['form[state]', 'draft']], session);
    assert.equal(response.status, 303);
    const loaded = await project.store.load();
    assert.deepEqual(loaded.definitions.find(definition => definition.machine === 'order').states, [{ key: 'draft', code: 6, initial: true, final: true }]);
  });

  test(`${kind}: a new machine whose key is taken is refused with E_DUPLICATE_KEY on its machine field`, async t => {
    const project = await openProject(kind);
    t.after(() => project.close());
    const app = await openApp(project.store);
    const session = newSession();
    const csrf = csrfOf((await page(app, '/new', session)).body);
    const before = JSON.stringify(await project.store.load());
    const response = await post(app, '/new', [['_csrf', csrf], ['form[machine]', 'order'], ['form[state]', 'draft']], session);
    assert.equal(response.status, 422);
    assert.match(response.body, /<code>E_DUPLICATE_KEY<\/code>/);
    assert.notEqual(response.body.indexOf('crudui-node__error', response.body.indexOf('data-field-path="machine"')), -1);
    assert.equal(JSON.stringify(await project.store.load()), before);
  });

  test(`${kind}: the delete path has no page: a GET answers 404 and writes nothing`, async t => {
    const project = await openProject(kind);
    t.after(() => project.close());
    const app = await openApp(project.store);
    const before = JSON.stringify(await project.store.load());
    assert.equal((await page(app, '/machines/order/delete', newSession())).status, 404);
    assert.equal(JSON.stringify(await project.store.load()), before);
  });

  test(`${kind}: a delete without the CSRF token of its page is 403 and writes nothing`, async t => {
    const project = await openProject(kind);
    t.after(() => project.close());
    const app = await openApp(project.store);
    const before = JSON.stringify(await project.store.load());
    assert.equal((await post(app, '/machines/order/delete', [], newSession())).status, 403);
    assert.equal(JSON.stringify(await project.store.load()), before);
  });
}
