// Tests of the machine edit screen (docs/plans/fsm-v1.md, C-7; docs/spec/fsm.md, B-2, B-3 and B-5) through the hyper
// application without HTTP, for the json, mermaid and db stores: the form shows the stored states with read-only keys and codes;
// a malformed body is a bad request; a save that passes writes the machine and passes fsm-gen check; a refused save writes
// nothing and shows its finding on the field of the finding; an edited code or key of a stored state is refused by the core;
// and every save needs the CSRF token of its page.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { openApp, tempProject } from './helpers.mjs';
import { openStore } from '../src/store.mjs';
import {
  KINDS, csrfOf, editPairs, newSession, openProject, orderRows, page, post, rowKey,
} from './edit-support.mjs';

const GUI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FSM_GEN = path.join(GUI, '..', 'compiler', 'src', 'cli', 'fsm-gen.mjs');

/** Opens the order example of `kind` and the application over its store, and the session of one browser. */
async function editing(t, kind) {
  const project = await openProject(kind);
  t.after(() => project.close());
  const app = await openApp(project.store);
  const session = newSession();
  const opened = await page(app, '/machines/order/edit', session);
  assert.equal(opened.status, 200);
  return { project, app, session, csrf: csrfOf(opened.body) };
}

/** The definitions of the store, as the store loads them, with the lock: the state of the project before and after a request. */
async function stored(project) {
  return JSON.stringify(await project.store.load());
}

test('the edit form shows every stored state, even when two of them share a code, so that a save cannot drop one', async t => {
  const root = tempProject({
    'fsm.config.json': '{"store":"json"}\n',
    'machines/order.fsm.json': `${JSON.stringify({
      machine: 'order',
      states: [{ key: 'draft', code: 1, initial: true }, { key: 'paid', code: 1, final: true }],
      events: [{ key: 'pay', edges: [{ from: 'draft', to: 'paid' }] }],
    }, null, 2)}\n`,
    'fsm.lock.json': '{"order":{"codes":{"1":"draft"},"reserved":[]}}\n',
  });
  const opened = await openStore(root, {});
  t.after(() => opened.close());
  const app = await openApp(opened.store);
  const body = (await page(app, '/machines/order/edit', newSession())).body;
  assert.match(body, /name="form\[states\]\[__0000000000001__\]\[key\]" value="draft"/);
  assert.match(body, /name="form\[states\]\[__0000000000002__\]\[key\]" value="paid"/);
});

test('a finding that names no field of the edit form is shown as a form error', async t => {
  const root = tempProject({
    'fsm.config.json': '{"store":"json"}\n',
    'machines/index.fsm.json': `${JSON.stringify({
      machine: 'index',
      states: [{ key: 'draft', code: 1, initial: true, final: true }],
      events: [],
    }, null, 2)}\n`,
    'fsm.lock.json': '{"index":{"codes":{"1":"draft"},"reserved":[]}}\n',
  });
  const opened = await openStore(root, {});
  t.after(() => opened.close());
  const app = await openApp(opened.store);
  const session = newSession();
  const page0 = await page(app, '/machines/index/edit', session);
  assert.equal(page0.status, 200);
  const response = await post(app, '/machines/index/edit', [['_csrf', csrfOf(page0.body)], ...editPairs(indexRows())], session);
  assert.equal(response.status, 422);
  assert.match(response.body, /<p class="crudui-form__error">E_KEY_RESERVED: /);
  assert.doesNotMatch(response.body, /data-field-path="machine"/);
});

/** The rows of the machine `index`: its one stored state, draft, with code 1. */
function indexRows() {
  return { states: [{ key: 'draft', code: '1', initial: true, final: true, persisted: true, rk: rowKey(1) }], events: [] };
}

for (const kind of KINDS) {
  test(`${kind}: the edit form shows the stored states with read-only keys and codes, and the events with their edges`, async t => {
    const { app, session } = await editing(t, kind);
    const response = await page(app, '/machines/order/edit', session);
    assert.equal(response.status, 200);
    assert.match(response.body, /<form action="\/machines\/order\/edit" method="post">/);
    assert.match(response.body, /<input type="hidden" name="_csrf" value="[0-9a-f]{128}"\/>/);
    // The stored code and key are read-only inputs that the form still submits.
    assert.match(response.body, new RegExp(`readOnly=""[^>]*name="form\\[states\\]\\[${rowKey(1)}\\]\\[code\\]" value="1"`));
    assert.match(response.body, new RegExp(`readOnly=""[^>]*name="form\\[states\\]\\[${rowKey(1)}\\]\\[key\\]" value="draft"`));
    assert.match(response.body, new RegExp(`name="form\\[events\\]\\[${rowKey(3)}\\]\\[edges\\]\\[${rowKey(2)}\\]\\[to\\]" value="canceled"`));
  });

  test(`${kind}: the edit page embeds the template and the data of its form, for the browser to bind its rows`, async t => {
    const { app, session } = await editing(t, kind);
    const body = (await page(app, '/machines/order/edit', session)).body;
    const match = /<script type="application\/json" id="fsm-form-state">([\s\S]*?)<\/script>/.exec(body);
    assert.notEqual(match, null);
    const state = JSON.parse(match[1]);
    assert.equal(state.template.kind, 'crudui/form-template');
    assert.equal(state.data.states[rowKey(1)].key, 'draft');
    assert.equal(state.data.events[rowKey(3)].edges[rowKey(2)].to, 'canceled');
  });

  test(`${kind}: a malformed body is a bad request and writes nothing`, async t => {
    const { project, app, session, csrf } = await editing(t, kind);
    const before = await stored(project);
    const valid = editPairs(orderRows());
    const bodies = {
      'a name outside form': [['_csrf', csrf], ['bogus', 'x']],
      'an unclosed bracket': [['_csrf', csrf], ['form[states', 'x']],
      'a duplicate name': [['_csrf', csrf], ...valid, [`form[states][${rowKey(1)}][key]`, 'draft']],
      'an unknown member': [['_csrf', csrf], [`form[states][${rowKey(1)}][bogus]`, 'x']],
      'a row key that is not a row key': [['_csrf', csrf], ['form[states][first][key]', 'x']],
      'a code that is not an integer': [['_csrf', csrf], [`form[states][${rowKey(1)}][code]`, '1a']],
      'a key and a new key of one row': [['_csrf', csrf], [`form[states][${rowKey(1)}][key]`, 'draft'], [`form[states][${rowKey(1)}][newKey]`, 'other']],
      'an initial flag other than 1': [['_csrf', csrf], [`form[states][${rowKey(1)}][initial]`, 'on']],
      'a value at a collection': [['_csrf', csrf], ['form[states]', 'x']],
    };
    for (const [label, pairs] of Object.entries(bodies)) {
      const response = await post(app, '/machines/order/edit', pairs, session);
      assert.equal(response.status, 400, label);
      assert.equal(response.body, 'Bad Request', label);
    }
    assert.equal(await stored(project), before);
  });

  test(`${kind}: a save that passes writes the new state and event, and the project passes check`, async t => {
    const { project, app, session, csrf } = await editing(t, kind);
    const rows = orderRows();
    // A new final state, reached from paid by a new event: a valid machine with one more code.
    rows.states.push({ key: 'archived', code: '', final: true, persisted: false, rk: rowKey(6) });
    rows.events.push({ key: 'archive', edges: [{ from: 'paid', to: 'archived' }] });
    const response = await post(app, '/machines/order/edit', [['_csrf', csrf], ...editPairs(rows)], session);
    assert.equal(response.status, 303);
    assert.equal(response.headers.Location, '/machines/order');
    const loaded = await project.store.load();
    const order = loaded.definitions.find(definition => definition.machine === 'order');
    const archived = order.states.find(state => state.key === 'archived');
    assert.deepEqual(archived, { key: 'archived', code: 6, final: true });
    assert.equal(loaded.lock.order.codes['6'], 'archived');
    if (kind !== 'db') {
      const check = spawnSync(process.execPath, [FSM_GEN, 'check', '--project', project.root], { encoding: 'utf8' });
      assert.equal(check.status, 0, check.stderr);
    }
    const again = await page(app, '/machines/order', newSession());
    assert.equal(again.status, 200);
  });

  test(`${kind}: a refused save writes nothing and shows its finding on the field it names`, async t => {
    const { project, app, session, csrf } = await editing(t, kind);
    const before = await stored(project);
    const rows = orderRows();
    // A new state without a key: E_KEY_FORMAT names $.states[5].key, the newKey field of that row.
    rows.states.push({ key: '', code: '', persisted: false, rk: rowKey(6) });
    const response = await post(app, '/machines/order/edit', [['_csrf', csrf], ...editPairs(rows)], session);
    assert.equal(response.status, 422);
    assert.match(response.body, /<code>E_KEY_FORMAT<\/code>/);
    const field = response.body.indexOf(`data-field-path="states.${rowKey(6)}.newKey"`);
    assert.notEqual(field, -1);
    assert.notEqual(response.body.indexOf('crudui-node__error', field), -1);
    assert.equal(await stored(project), before);
  });

  test(`${kind}: an edited code of a stored state is refused with E_CODE_CHANGED and writes nothing`, async t => {
    const { project, app, session, csrf } = await editing(t, kind);
    const before = await stored(project);
    const rows = orderRows();
    rows.states[0].code = '9';
    const response = await post(app, '/machines/order/edit', [['_csrf', csrf], ...editPairs(rows)], session);
    assert.equal(response.status, 422);
    assert.match(response.body, /<code>E_CODE_CHANGED<\/code>/);
    assert.match(response.body, /the code of draft is 1 in the lock/);
    assert.equal(await stored(project), before);
  });

  test(`${kind}: a changed key of a stored code is refused with E_CODE_KEY_CHANGED and writes nothing`, async t => {
    const { project, app, session, csrf } = await editing(t, kind);
    const before = await stored(project);
    const rows = orderRows();
    rows.states[1].key = 'settled';
    rows.events.forEach(event => event.edges.forEach(edge => {
      if (edge.from === 'paid') edge.from = 'settled';
      if (edge.to === 'paid') edge.to = 'settled';
    }));
    const response = await post(app, '/machines/order/edit', [['_csrf', csrf], ...editPairs(rows)], session);
    assert.equal(response.status, 422);
    assert.match(response.body, /<code>E_CODE_KEY_CHANGED<\/code>/);
    assert.equal(await stored(project), before);
  });

  test(`${kind}: a save without the CSRF token of its page is 403 and writes nothing`, async t => {
    const { project, app, session, csrf } = await editing(t, kind);
    const before = await stored(project);
    const body = editPairs(orderRows());
    assert.equal((await post(app, '/machines/order/edit', body, session)).status, 403);
    assert.equal((await post(app, '/machines/order/edit', [['_csrf', csrf.replace(/^./, c => (c === '0' ? '1' : '0'))], ...body], session)).status, 403);
    assert.equal(await stored(project), before);
  });
}
