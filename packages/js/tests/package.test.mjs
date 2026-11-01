// The released TS runtime of fsm (S-408): the package is @polyspec/fsm, public, and ships the generated src, which prepack builds.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

test('the TS runtime is @polyspec/fsm, public, with the generated src', () => {
  assert.equal(manifest.name, '@polyspec/fsm');
  assert.equal(manifest.private, undefined);
  assert.deepEqual(manifest.files, ['src']);
  assert.match(manifest.scripts.prepack, /fsm-gen/);
});
