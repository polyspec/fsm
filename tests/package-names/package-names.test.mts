// The polyspec names of the released runtimes of fsm (S-406, S-407, S-408): the TS runtime is @polyspec/fsm, the Python wheel is
// polyspec-fsm and the Rust crate is polyspec-fsm, as the other polyspec packages name their product. The first release fixes the
// names. The packages declare no test of their own, so the parity check of kit reads them as no binding (R5); this root test reads
// their manifests instead.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

test('the TS runtime is the public package @polyspec/fsm', () => {
  const manifest: unknown = JSON.parse(read('packages/js/package.json'));
  assert.ok(typeof manifest === 'object' && manifest !== null && 'name' in manifest);
  assert.equal(manifest.name, '@polyspec/fsm');
  assert.equal('private' in manifest, false);
});

test('the Python wheel is polyspec-fsm', () => {
  const project = read('packages/python/pyproject.toml').split(/^\[project\]/m)[1] ?? '';
  assert.equal(project.match(/^name = "([^"]+)"/m)?.[1], 'polyspec-fsm');
});

test('the Rust crate is polyspec-fsm', () => {
  const crate = read('packages/rust/Cargo.toml').split(/^\[package\]/m)[1] ?? '';
  assert.equal(crate.match(/^name = "([^"]+)"/m)?.[1], 'polyspec-fsm');
});
