// Helpers of the GUI edit tests (docs/plans/fsm-v1.md, C-7): requests that share one session, so that a POST carries the
// token of the page that the same session rendered; the form body that a browser posts for a machine; and the three stores
// (json, mermaid and db) of a project that holds the order example. A test calls openProject(kind) and gets the store of the
// project as fsm.config.json names it, so the store selection is the one the GUI uses.
import path from 'node:path';
import { MemorySessionStore, Request } from '@polyspec/hyper-server';
import { dbStore } from '../../fsm-db/src/db-store.mjs';
import { SCHEMA, connect } from '../../fsm-db/src/models/models.ts';
import { jsonStore } from '../../fsm-compiler/src/store-json/store.mjs';
import { openStore } from '../src/store.mjs';
import { ORDER_JSON_TEXT, ORDER_LOCK_TEXT, ORDER_MERMAID_TEXT } from './canonical.mjs';
import { tempProject } from './helpers.mjs';

/** The three stores that the GUI edit screens run on. */
export const KINDS = ['json', 'mermaid', 'db'];

/** The row key of a crudui repeated row whose identity is a sequence number (`sequenceRowKey`, form-runtime.md). */
export const rowKey = number => `__${String(number).padStart(13, '0')}__`;

/** A GET request of `target` in `session`, rendered as HTML. */
export function page(app, target, session) {
  return app.handle(Request.from({ method: 'GET', target, headers: { Accept: 'text/html' } }), session);
}

/** A form POST of `pairs` ([name, value] in body order) to `target` in `session`, as an urlencoded body. */
export function post(app, target, pairs, session) {
  const body = new URLSearchParams(pairs).toString();
  return app.handle(Request.from({
    method: 'POST',
    target,
    headers: { Accept: 'text/html', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new TextEncoder().encode(body),
  }), session);
}

/** A new session store, one per browser of a test. */
export const newSession = () => new MemorySessionStore();

/** The masked CSRF token of a rendered page: the value of its `_csrf` hidden field. */
export function csrfOf(html) {
  const match = /name="_csrf" value="([0-9a-f]{128})"/.exec(html);
  if (match === null) throw new Error('the page has no _csrf field');
  return match[1];
}

/**
 * The fields of a machine as the browser posts the edit form, after `_csrf`. `states` rows are { rk, persisted, key, code,
 * initial, final }: a stored row (persisted) posts its key in `key` and an empty `newKey`, a new row the reverse, as the hidden
 * fields of the form do. `events` rows are { rk, key, edges: [{ rk, from, to }] }. A row key defaults to rowKey of its position.
 */
export function editPairs({ states, events }) {
  const pairs = [];
  states.forEach((state, index) => {
    const rk = state.rk ?? rowKey(index + 1);
    const base = `form[states][${rk}]`;
    pairs.push([`${base}[persisted]`, state.persisted ? '1' : '']);
    pairs.push([`${base}[key]`, state.persisted ? state.key : '']);
    pairs.push([`${base}[newKey]`, state.persisted ? '' : state.key]);
    pairs.push([`${base}[code]`, state.code === undefined ? '' : String(state.code)]);
    if (state.initial) pairs.push([`${base}[initial]`, '1']);
    if (state.final) pairs.push([`${base}[final]`, '1']);
  });
  events.forEach((event, index) => {
    const rk = event.rk ?? rowKey(index + 1);
    pairs.push([`form[events][${rk}][key]`, event.key]);
    event.edges.forEach((edge, edgeIndex) => {
      const ek = edge.rk ?? rowKey(edgeIndex + 1);
      pairs.push([`form[events][${rk}][edges][${ek}][from]`, edge.from]);
      pairs.push([`form[events][${rk}][edges][${ek}][to]`, edge.to]);
    });
  });
  return pairs;
}

/** The rows of the order example (docs/spec/fsm.md, B-1) as editPairs rows: stored states keep their codes as keys. */
export const ORDER_STATES = [
  { code: 1, key: 'draft', persisted: true, initial: true },
  { code: 2, key: 'paid', persisted: true },
  { code: 3, key: 'shipped', persisted: true },
  { code: 4, key: 'done', persisted: true, final: true },
  { code: 5, key: 'canceled', persisted: true, final: true },
].map(state => ({ ...state, rk: rowKey(state.code) }));

export const ORDER_EVENTS = [
  { key: 'next', edges: [{ from: 'draft', to: 'paid' }, { from: 'paid', to: 'shipped' }, { from: 'shipped', to: 'done' }] },
  { key: 'prev', edges: [{ from: 'paid', to: 'draft' }, { from: 'shipped', to: 'paid' }] },
  { key: 'cancel', edges: [{ from: 'draft', to: 'canceled' }, { from: 'paid', to: 'canceled' }] },
];

/** The order example as editPairs input, with every state and edge as the browser posts them. */
export function orderRows() {
  return {
    states: ORDER_STATES.map(state => ({ ...state, code: String(state.code) })),
    events: structuredClone(ORDER_EVENTS),
  };
}

/** A project directory with the order example in the store kind, and the store that its fsm.config.json names. */
export async function openProject(kind) {
  if (kind === 'json') {
    const root = tempProject({
      'fsm.config.json': '{"store":"json"}\n',
      'machines/order.fsm.json': ORDER_JSON_TEXT,
      'fsm.lock.json': ORDER_LOCK_TEXT,
    });
    return { root, env: {}, store: (await openStore(root, {})).store, close: async () => {} };
  }
  if (kind === 'mermaid') {
    const root = tempProject({
      'fsm.config.json': '{"store":"mermaid"}\n',
      'machines/order.fsm.mmd': ORDER_MERMAID_TEXT,
      'fsm.lock.json': ORDER_LOCK_TEXT,
    });
    return { root, env: {}, store: (await openStore(root, {})).store, close: async () => {} };
  }
  if (kind !== 'db') throw new Error(`unknown store kind ${kind}`);
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
  const env = { FSM_DSN: dsn };
  const opened = await openStore(root, env);
  return { root, env, store: opened.store, close: opened.close };
}
