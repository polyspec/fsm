// Tests of the next code that the edit page carries (docs/plans/fsm-v1/plan.md, C-7; docs/spec/fsm.md, B-3) through the hyper
// application without HTTP, for the json, mermaid and db stores: the embedded form state of the edit page holds
// nextCode(machine, definitions, lock) of the machine being edited, so that the browser can give each added state its code. After
// a state is deleted, its code is reserved and the next code is past it; a refused save shows the same next code.
import assert from 'node:assert/strict';
import test from 'node:test';
import { openApp } from './helpers.mjs';
import {
  KINDS, csrfOf, editPairs, newSession, openProject, orderRows, page, post,
} from './edit-support.mjs';

/** The embedded form state of an edit page, parsed: the JSON of its fsm-form-state script element. */
function formStateOf(html) {
  const match = /<script type="application\/json" id="fsm-form-state">([\s\S]*?)<\/script>/.exec(html);
  if (match === null) throw new Error('the edit page has no fsm-form-state element');
  return JSON.parse(match[1]);
}

for (const kind of KINDS) {
  test(`${kind}: the edit page embeds the next code of its machine`, async t => {
    const project = await openProject(kind);
    t.after(() => project.close());
    const app = await openApp(project.store);
    const response = await page(app, '/machines/order/edit', newSession());
    assert.equal(response.status, 200);
    assert.equal(formStateOf(response.body).nextCode, 6);
  });

  test(`${kind}: after a state is deleted, the edit page embeds a next code past the reserved code`, async t => {
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
    assert.deepEqual((await project.store.load()).lock.order.reserved, [5]);
    const after = await page(app, '/machines/order/edit', session);
    assert.equal(formStateOf(after.body).nextCode, 6);
  });

  test(`${kind}: a refused save shows the page with the same next code in its form state`, async t => {
    const project = await openProject(kind);
    t.after(() => project.close());
    const app = await openApp(project.store);
    const session = newSession();
    const csrf = csrfOf((await page(app, '/machines/order/edit', session)).body);
    const rows = orderRows();
    rows.states.push({ key: 'Archived', code: '', final: true, persisted: false, rk: '__0000000000006__' });
    const response = await post(app, '/machines/order/edit', [['_csrf', csrf], ...editPairs(rows)], session);
    assert.equal(response.status, 422);
    assert.equal(formStateOf(response.body).nextCode, 6);
  });
}

for (const kind of KINDS) {
  test(`${kind}: a next code above 2147483647 is refused, and the edit page shows E_CODE_RANGE with no next code`, async t => {
    const project = await openProject(kind);
    t.after(() => project.close());
    const app = await openApp(project.store);
    const session = newSession();
    const csrf = csrfOf((await page(app, '/machines/order/edit', session)).body);
    // A state takes the largest code (2147483647, B-3), so the next code is 2147483648 and nextCode refuses it (E_CODE_RANGE).
    const rows = orderRows();
    rows.states.push({ key: 'archived', code: '2147483647', final: true, persisted: false, rk: '__0000000000006__' });
    rows.events.push({ key: 'archive', edges: [{ from: 'shipped', to: 'archived' }] });
    const saved = await post(app, '/machines/order/edit', [['_csrf', csrf], ...editPairs(rows)], session);
    assert.equal(saved.status, 303);
    const response = await page(app, '/machines/order/edit', session);
    assert.equal(response.status, 200);
    // The finding is shown on the page before any save, and the browser is given no code to suggest.
    assert.match(response.body, /E_CODE_RANGE/);
    assert.equal(formStateOf(response.body).nextCode, undefined);
  });
}
