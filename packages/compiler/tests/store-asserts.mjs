// The assertions that the tests of the json store and of the mermaid store share.
import assert from 'node:assert/strict';
import { bytesOf } from './checkout.mjs';
import { shapeFindings } from './order-machines.mjs';

/** Asserts that `store` loads the one machine of `root` with no finding and an empty lock. */
export async function assertLoadsOneMachine(store) {
  const loaded = await store.load();
  assert.deepEqual(loaded.lock, {});
  assert.deepEqual(shapeFindings(loaded.findings), []);
  assert.equal(loaded.definitions.length, 1);
}

/** Asserts that `store`, which reads `root`, loads without a finding and saves back exactly the bytes of `root`. */
export async function assertSaveKeepsBytes(store, root) {
  const before = bytesOf(root);
  const loaded = await store.load();
  assert.deepEqual(shapeFindings(loaded.findings), []);
  await store.save({ definitions: loaded.definitions, lock: loaded.lock });
  assert.equal(bytesOf(root), before);
}
