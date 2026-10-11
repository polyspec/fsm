// The store contract (docs/spec/fsm.md, B-2): every store (json now, mermaid in S-08, db in S-15) passes the same cases.
// storeContract(name, makeStore) registers the node:test cases. makeStore() (sync or async) returns { store, snapshot }: a new
// empty store, and a function (sync or async) that returns every byte the store holds as one string, so that a case can
// compare what was written.
// load() and save() are async: every case checks that the call returns a Promise and awaits it.
import assert from 'node:assert/strict';
import test from 'node:test';

/** Two machines in name order: order (draft -next-> done) and track (one state that is initial and final). */
const sample = () => ({
  definitions: [
    {
      machine: 'order',
      states: [{ key: 'draft', code: 1, initial: true }, { key: 'done', code: 2, final: true }],
      events: [{ key: 'next', edges: [{ from: 'draft', to: 'done' }] }],
    },
    { machine: 'track', states: [{ key: 'only', code: 1, initial: true, final: true }], events: [] },
  ],
  lock: {
    order: { codes: { 1: 'draft', 2: 'done' }, reserved: [3] },
    track: { codes: { 1: 'only' }, reserved: [] },
  },
});

/** A store that holds only `track`: the replacement of the sample in the replace case. */
const replacement = () => ({
  definitions: [{ machine: 'track', states: [{ key: 'only', code: 1, initial: true, final: true }], events: [] }],
  lock: { track: { codes: { 1: 'only' }, reserved: [] } },
});

/**
 * The result of store.load() without its baseline, which must be a Promise. The baseline is the committed lock, which depends on
 * the store (git HEAD for the file stores, the rows for the db store), so each store's test checks it; the contract checks the rest.
 */
async function loadOf(store) {
  const pending = store.load();
  assert.ok(pending instanceof Promise, 'load() must return a Promise');
  const { baseline, ...rest } = await pending;
  assert.ok(baseline !== undefined, 'load() must return the committed lock as baseline');
  return rest;
}

/** The result of store.save(written), which must be a Promise. */
async function saveOf(store, written) {
  const pending = store.save(written);
  assert.ok(pending instanceof Promise, 'save() must return a Promise');
  return pending;
}

/** Registers the store contract cases for the store that `makeStore` creates. */
export function storeContract(name, makeStore) {
  test(`${name} store: load of an empty store is empty`, async () => {
    const { store } = await makeStore();
    assert.deepEqual(await loadOf(store), { definitions: [], lock: {}, findings: [] });
  });

  test(`${name} store: save then load returns the same definitions and lock`, async () => {
    const { store } = await makeStore();
    await saveOf(store, sample());
    assert.deepEqual(await loadOf(store), { ...sample(), findings: [] });
  });

  test(`${name} store: save twice writes identical bytes`, async () => {
    const { store, snapshot } = await makeStore();
    await saveOf(store, sample());
    const first = await snapshot();
    assert.notEqual(first, '');
    await saveOf(store, sample());
    assert.equal(await snapshot(), first);
  });

  test(`${name} store: save replaces the whole set`, async () => {
    const replaced = await makeStore();
    await saveOf(replaced.store, sample());
    await saveOf(replaced.store, replacement());
    const fresh = await makeStore();
    await saveOf(fresh.store, replacement());
    assert.deepEqual(await loadOf(replaced.store), { ...replacement(), findings: [] });
    assert.equal(await replaced.snapshot(), await fresh.snapshot());
  });
}
