// Tests of the committed vector file conformance/vectors/order.json (docs/plans/status-v1.md, C-4): it has the format that
// scripts/check-parity.mjs reads (a machine and cases of feature and id, every feature covered, every id named once), and
// it is exactly what the core generates from the committed definition and lock.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalize } from '../src/core/normalize.mjs';
import { vectors } from '../src/core/vectors.mjs';
import { jsonStore } from '../src/store-json/store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FILE = path.join(ROOT, 'conformance/vectors/order.json');
const ID = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

test('the committed order vectors hold the format that check-parity reads', () => {
  const { machine, cases } = JSON.parse(readFileSync(FILE, 'utf8'));
  const features = JSON.parse(readFileSync(path.join(ROOT, 'contracts/features.json'), 'utf8')).features;
  assert.equal(machine, 'order');
  const names = new Set();
  for (const entry of cases) {
    assert.ok(features.includes(entry.feature), `${entry.id} has the feature ${entry.feature}, which contracts/features.json does not list`);
    assert.match(entry.id, ID);
    assert.ok(entry.id.startsWith(`${machine}_`), entry.id);
    names.add(`test_${entry.feature}__${entry.id}`);
  }
  assert.equal(names.size, cases.length, 'a case name occurs twice');
  for (const feature of features) assert.ok(cases.some(entry => entry.feature === feature), `no case of ${feature}`);
});

test('the committed order vectors are byte-identical to the core output for the committed machine and lock', async () => {
  const store = await jsonStore(ROOT).load();
  assert.deepEqual(store.findings, []);
  const [definition] = store.definitions;
  const generated = vectors(normalize(definition), store.lock);
  assert.equal(readFileSync(FILE, 'utf8'), `${JSON.stringify(generated, null, 2)}\n`);
});
