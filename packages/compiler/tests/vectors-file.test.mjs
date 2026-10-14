// Tests of the committed vector file contracts/conformance/vectors.json (docs/plans/fsm-v1.md, C-4): it has the format that the parity
// checks read (the machines, each with cases of feature, id and name, every feature covered, every name once), and it is exactly
// what the core generates from the committed definitions and lock.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalize } from '../src/core/normalize.mjs';
import { vectors } from '../src/core/vectors.mjs';
import { jsonStore } from '../src/store-json/store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FILE = path.join(ROOT, 'contracts/conformance/vectors.json');
const ID = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

test('the committed vectors hold the format that the parity checks read', () => {
  const { machines } = JSON.parse(readFileSync(FILE, 'utf8'));
  const features = JSON.parse(readFileSync(path.join(ROOT, 'contracts/features.json'), 'utf8')).features;
  assert.ok(machines.some(entry => entry.machine === 'order'), 'the order example has its vectors');
  const names = new Set();
  let count = 0;
  for (const { machine, cases } of machines) {
    for (const entry of cases) {
      assert.ok(features.includes(entry.feature), `${entry.id} has the feature ${entry.feature}, which contracts/features.json does not list`);
      assert.match(entry.id, ID);
      assert.ok(entry.id.startsWith(`${machine}_`), entry.id);
      assert.equal(entry.name, `${entry.feature}__${entry.id}`);
      names.add(entry.name);
      count += 1;
    }
  }
  assert.equal(names.size, count, 'a case name occurs twice');
  const all = machines.flatMap(entry => entry.cases);
  for (const feature of features) assert.ok(all.some(entry => entry.feature === feature), `no case of ${feature}`);
});

test('the committed vectors are byte-identical to the core output for the committed machines and lock', async () => {
  const store = await jsonStore(path.join(ROOT, 'contracts')).load();
  assert.deepEqual(store.findings, []);
  const generated = { machines: store.definitions.map(definition => vectors(normalize(definition), store.lock)) };
  assert.equal(readFileSync(FILE, 'utf8'), `${JSON.stringify(generated, null, 2)}\n`);
});
