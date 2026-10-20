// Tests of the edit screens over HTTP (docs/plans/fsm-v1/plan.md, C-7), with the server process of src/main.mjs as the S-16 tests
// run it: a save of the edit form with the session cookie and the CSRF token of the page writes the project and redirects to
// its detail; a save without the token is 403 over the wire; and a rename and a delete reach the store the same way.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { orderProject, startGui } from './helpers.mjs';
import { csrfOf, editPairs, orderRows } from './edit-support.mjs';


/** The body of a form POST as the browser sends it. */
const body = pairs => new URLSearchParams(pairs).toString();
/** The lock file of the project, parsed. */
const lockOf = root => JSON.parse(readFileSync(path.join(root, 'fsm.lock.json'), 'utf8'));

test('a save, a rename and a delete over HTTP write the project, and a save without the token is 403', async t => {
  const root = orderProject();
  const { child, url } = await startGui(root);
  t.after(() => child.kill('SIGTERM'));

  // The page sets the session cookie; the POST sends it back with the token that the page holds.
  const opened = await fetch(`${url}/machines/order/edit`, { headers: { Accept: 'text/html' } });
  assert.equal(opened.status, 200);
  const cookie = opened.headers.get('set-cookie').split(';')[0];
  const csrf = csrfOf(await opened.text());
  const form = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html', Cookie: cookie };

  const denied = await fetch(`${url}/machines/order/edit`, {
    method: 'POST',
    headers: form,
    body: body(editPairs(orderRows())),
    redirect: 'manual',
  });
  assert.equal(denied.status, 403);

  const rows = orderRows();
  rows.states.push({ key: 'archived', code: '', final: true, persisted: false, rk: '__0000000000006__' });
  rows.events.push({ key: 'archive', edges: [{ from: 'paid', to: 'archived' }] });
  const saved = await fetch(`${url}/machines/order/edit`, {
    method: 'POST',
    headers: form,
    body: body([['_csrf', csrf], ...editPairs(rows)]),
    redirect: 'manual',
  });
  assert.equal(saved.status, 303);
  assert.equal(saved.headers.get('location'), '/machines/order');
  assert.equal(lockOf(root).order.codes['6'], 'archived');

  const renamed = await fetch(`${url}/machines/order/rename`, { headers: { Accept: 'text/html', Cookie: cookie } });
  const renameCsrf = csrfOf(await renamed.text());
  const rename = await fetch(`${url}/machines/order/rename`, {
    method: 'POST',
    headers: form,
    body: body([
      ['_csrf', renameCsrf],
      ['form[states][__0000000000002__][key]', 'paid'],
      ['form[states][__0000000000002__][to]', 'confirmed'],
    ]),
    redirect: 'manual',
  });
  assert.equal(rename.status, 303);
  assert.equal(lockOf(root).order.codes['2'], 'confirmed');

  const detail = await fetch(`${url}/machines/order/edit`, { headers: { Accept: 'text/html', Cookie: cookie } });
  const deleteCsrf = csrfOf(await detail.text());
  const deleted = await fetch(`${url}/machines/order/delete`, {
    method: 'POST',
    headers: form,
    body: body([['_csrf', deleteCsrf]]),
    redirect: 'manual',
  });
  assert.equal(deleted.status, 303);
  assert.deepEqual(lockOf(root).order, { codes: {}, reserved: [1, 2, 3, 4, 5, 6] });
});
