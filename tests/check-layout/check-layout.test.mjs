// Tests of scripts/check-layout.mjs: each rule of the canonical package layout has a failing and a passing case. Every case
// builds its checkout in a temporary directory, so no fixture is committed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { layoutFindings } from '../../scripts/check-layout.mjs';
import { put, tree } from '../kit/tree.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const LAYOUT = {
  schema: 1,
  tools: ['status-compiler'],
  canonical: { files: ['README.md', 'README.ko.md', 'Makefile'], directories: ['src', 'tests', 'examples'] },
  kinds: {
    npm: { required: ['package.json', 'tests/conformance.test.mjs', 'tests/vectors.mjs', 'examples/persist.mjs'], allowed: ['src/*.js', 'src/*.d.ts'] },
    php: { required: ['composer.json', 'tests/ConformanceTest.php', 'tests/Vectors.php', 'examples/persist.php'], allowed: ['src/**/*.php'] },
    'php-ext': { required: ['composer.json', 'tests/ConformanceTest.php', 'tests/Vectors.php', 'examples/persist.php', 'src/config.m4'], allowed: ['src/*.c', 'src/*.h', 'src/*.stub.php'] },
  },
};

const npm = {
  'packages/status-npm/README.md': 'r', 'packages/status-npm/README.ko.md': 'r', 'packages/status-npm/Makefile': 'm',
  'packages/status-npm/package.json': '{}', 'packages/status-npm/src/order.js': 'x', 'packages/status-npm/src/order.d.ts': 'x',
  'packages/status-npm/tests/conformance.test.mjs': 't', 'packages/status-npm/tests/vectors.mjs': 'v', 'packages/status-npm/examples/persist.mjs': 'p',
};
const php = (kind, extra = {}) => ({
  [`packages/status-${kind}/README.md`]: 'r', [`packages/status-${kind}/README.ko.md`]: 'r', [`packages/status-${kind}/Makefile`]: 'm',
  [`packages/status-${kind}/composer.json`]: '{}', [`packages/status-${kind}/tests/ConformanceTest.php`]: 'same', [`packages/status-${kind}/tests/Vectors.php`]: 'same',
  [`packages/status-${kind}/examples/persist.php`]: 'p',
  ...(kind === 'php' ? { 'packages/status-php/src/Order/State.php': 's' } : {}), ...extra,
});
const ext = { 'packages/status-php-ext/src/config.m4': 'c', 'packages/status-php-ext/src/order.c': 'c' };
const tool = { 'packages/status-compiler/src/core.mjs': 'c' };

function checkout(t, files, layout = LAYOUT) {
  return tree(t, { 'contracts/layout.json': JSON.stringify(layout), ...files });
}
const rules = (root) => layoutFindings(root).map(found => found.rule);

test('a checkout whose packages follow the canonical layout passes, and the tool packages are not kinds', (t) => {
  const root = checkout(t, { ...npm, ...php('php'), ...php('php-ext', ext), ...tool });
  assert.deepEqual(layoutFindings(root), []);
});

test('layout-kinds: a package directory that is neither a tool nor a kind, and a kind without its package', (t) => {
  const extra = checkout(t, { ...npm, ...php('php'), ...php('php-ext', ext), ...tool, 'packages/status-ruby/README.md': 'r' });
  const found = layoutFindings(extra);
  assert.deepEqual(found.map(entry => entry.rule), ['layout-kinds']);
  assert.match(found[0].message, /packages\/status-ruby is neither a tool nor a kind of contracts\/layout\.json/);
  const missing = checkout(t, { ...npm, ...php('php'), ...tool });
  assert.deepEqual(layoutFindings(missing).map(entry => entry.message), ['the kind php-ext has no package packages/status-php-ext']);
});

test('layout-file: a file that no canonical or kind rule allows, which also catches a renamed file', (t) => {
  const root = checkout(t, { ...npm, ...php('php'), ...php('php-ext', ext), ...tool, 'packages/status-npm/src/helper.py': 'x', 'packages/status-npm/notes.txt': 'n' });
  const found = layoutFindings(root);
  assert.deepEqual(found.map(entry => entry.rule), ['layout-file', 'layout-file']);
  assert.match(found[0].message, /packages\/status-npm\/notes\.txt is not in the canonical layout of npm/);
});

test('layout-missing: a canonical file, a required file of the kind and a canonical directory without a file', (t) => {
  const files = { ...npm, ...php('php'), ...php('php-ext', ext), ...tool };
  delete files['packages/status-npm/README.ko.md'];
  delete files['packages/status-npm/tests/vectors.mjs'];
  delete files['packages/status-npm/src/order.js'];
  delete files['packages/status-npm/src/order.d.ts'];
  const messages = layoutFindings(checkout(t, files)).map(entry => `${entry.rule}: ${entry.message}`);
  assert.deepEqual(messages, [
    'layout-missing: packages/status-npm/README.ko.md is missing; every npm package has it',
    'layout-missing: packages/status-npm/tests/vectors.mjs is missing; every npm package has it',
    'layout-missing: packages/status-npm/src/ holds no file; every package has src/, tests/ and examples/',
  ]);
});

test('layout-php-twin: the tests of php and php-ext hold the same files with the same bytes', (t) => {
  const differ = checkout(t, { ...npm, ...php('php'), ...php('php-ext', { ...ext, 'packages/status-php-ext/tests/Vectors.php': 'other' }), ...tool });
  const found = layoutFindings(differ);
  assert.deepEqual(found.map(entry => entry.rule), ['layout-php-twin']);
  assert.match(found[0].message, /tests\/Vectors\.php differs between packages\/status-php and packages\/status-php-ext/);
});

test('an ignored file does not count, and an untracked file that Git does not ignore does', (t) => {
  const root = checkout(t, { ...npm, ...php('php'), ...php('php-ext', ext), ...tool, '.gitignore': '/packages/*/node_modules/\n', 'packages/status-npm/node_modules/x/index.js': 'i' });
  assert.deepEqual(rules(root), []);
  put(root, { 'packages/status-npm/stray.js': 's' });
  assert.deepEqual(rules(root), ['layout-file']);
});

test('layout-config: contracts/layout.json is checked against its own schema and names only known kinds', (t) => {
  const bad = checkout(t, {}, { schema: 1, tools: [], canonical: { files: [], directories: [] }, kinds: { ruby: { required: [], allowed: [] } } });
  const found = layoutFindings(bad);
  assert.deepEqual(found.map(entry => entry.rule), ['layout-config']);
  assert.match(found[0].message, /\$\.kinds\.ruby is not in the schema/);
  const missingFile = tree(t, {});
  assert.deepEqual(layoutFindings(missingFile).map(entry => entry.message), ['contracts/layout.json does not exist; it declares the tools, the kinds and the canonical layout']);
});

test('the command prints each finding and exits 1, and passes on the layout of this repository', (t) => {
  const root = checkout(t, { ...npm, ...tool, 'packages/status-npm/notes.txt': 'n' }, { ...LAYOUT, kinds: { npm: LAYOUT.kinds.npm } });
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  cpSync(path.join(ROOT, 'scripts/check-layout.mjs'), path.join(root, 'scripts/check-layout.mjs'));
  cpSync(path.join(ROOT, 'scripts/kit'), path.join(root, 'scripts/kit'), { recursive: true });
  const failed = spawnSync(process.execPath, ['scripts/check-layout.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.match(failed.stderr, /\[check-layout\] layout-file: packages\/status-npm\/notes\.txt is not in the canonical layout of npm/);
  const own = spawnSync(process.execPath, ['scripts/check-layout.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(own.status, 0, own.stdout + own.stderr);
});
