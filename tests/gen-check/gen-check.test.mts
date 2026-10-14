// Tests of scripts/gen-check.mts (docs/plans/fsm-v1.md, C-5): the generated files of a checkout must equal the working tree.
// Every case builds a temporary git checkout from the files of this repository (the compiler sources, the machines, the lock,
// the features and the vector files), changes one thing and runs the check of this checkout on it with --root.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VECTOR = 'contracts/conformance/vectors.json';

/** Writes `text` to `file` below `root`, creating its directories. */
function write(root, file, text) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

/**
 * A temporary git checkout with the files of this repository that gen-check reads, the kinds (the implementations of
 * config/parity.json), the generated globs of config/gen-check.json and files ({ path: text }), every file tracked; removed
 * with `t.after`. The real kinds are checked by `make gen-check`; these cases use their own.
 */
function fixture(t, kinds, generated, files) {
  const root = mkdtempSync(path.join(tmpdir(), 'gen-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(path.join(ROOT, 'packages/compiler/src'), path.join(root, 'packages/compiler/src'), { recursive: true });
  for (const entry of ['machines', 'conformance', 'schema', 'fsm.config.json', 'fsm.lock.json']) {
    cpSync(path.join(ROOT, 'contracts', entry), path.join(root, 'contracts', entry), { recursive: true });
  }
  write(root, 'config/parity.json', `${JSON.stringify({ implementations: kinds.map(name => ({ name, roots: [`packages/${name}`] })) }, null, 2)}\n`);
  write(root, 'config/gen-check.json', `${JSON.stringify({ schema: 1, generated }, null, 2)}\n`);
  for (const [file, text] of Object.entries(files)) write(root, file, text);
  spawnSync('git', ['init', '--quiet'], { cwd: root });
  spawnSync('git', ['add', '--all'], { cwd: root });
  return root;
}

/** A checkout of this repository with no kinds, so that its vector file is the only generated file. */
const checkout = t => fixture(t, [], {}, {});

/** A kind `fake` whose package generates gen/a.txt, with the generated glob `gen/**`, which the fixed patterns never covered. */
const FAKE_GENERATED = { fake: ['gen/**'] };
const FAKE_FILES = {
  // gen is phony: the directory gen/ would otherwise make the target up to date.
  'packages/fake/Makefile': '.PHONY: gen\ngen:\n\tmkdir -p $(DEST)/gen\n\tprintf \'a\\n\' > $(DEST)/gen/a.txt\n',
  'packages/fake/gen/a.txt': 'a\n',
  'packages/fake/readme.txt': 'not generated\n',
};

/** Runs scripts/gen-check.mts of this checkout on `root` and returns its status and stderr. */
function genCheck(root) {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/gen-check.mts'), '--root', root], { cwd: root, encoding: 'utf8' });
  return { status: result.status, stderr: result.stderr };
}

test('a clean checkout passes with exit 0 and no finding', (t) => {
  assert.deepEqual(genCheck(checkout(t)), { status: 0, stderr: '' });
});

test('a one-byte change to a vector file is a differs finding and exits 1', (t) => {
  const root = checkout(t);
  const bytes = readFileSync(path.join(root, VECTOR));
  bytes[bytes.length - 1] = 0x20;
  writeFileSync(path.join(root, VECTOR), bytes);
  const result = genCheck(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`^\\[gen-check\\] differs ${VECTOR}: `));
});

test('an added tracked file that a generated glob matches is an extra finding', (t) => {
  const root = fixture(t, ['fake'], FAKE_GENERATED, FAKE_FILES);
  write(root, 'packages/fake/gen/extra.txt', 'extra\n');
  spawnSync('git', ['add', 'packages/fake/gen/extra.txt'], { cwd: root });
  const result = genCheck(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^\[gen-check\] extra packages\/fake\/gen\/extra\.txt: /);
});

test('a missing vector file is a missing finding', (t) => {
  const root = checkout(t);
  rmSync(path.join(root, VECTOR));
  const result = genCheck(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`^\\[gen-check\\] missing ${VECTOR}: `));
});

test('an ignored file in the compared directory is not read, so it is no finding', (t) => {
  const root = checkout(t);
  write(root, '.gitignore', '*.tmp\n');
  write(root, 'contracts/conformance/scratch.tmp', 'not a vector\n');
  assert.deepEqual(genCheck(root), { status: 0, stderr: '' });
});

test('the files compared for a kind are exactly the files that its generated globs match', (t) => {
  const root = fixture(t, ['fake'], FAKE_GENERATED, FAKE_FILES);
  assert.deepEqual(genCheck(root), { status: 0, stderr: '' });
  writeFileSync(path.join(root, 'packages/fake/gen/a.txt'), 'changed\n');
  const changed = genCheck(root);
  assert.equal(changed.status, 1);
  assert.match(changed.stderr, /^\[gen-check\] differs packages\/fake\/gen\/a\.txt: /m);
});

test('a file that no generated glob of its kind matches is not compared, so changing it is no finding', (t) => {
  const root = fixture(t, ['fake'], FAKE_GENERATED, FAKE_FILES);
  writeFileSync(path.join(root, 'packages/fake/readme.txt'), 'edited by hand\n');
  assert.deepEqual(genCheck(root), { status: 0, stderr: '' });
});

test('a tracked file that a generated glob matches but the generator does not write is an extra finding', (t) => {
  const root = fixture(t, ['fake'], FAKE_GENERATED, { ...FAKE_FILES, 'packages/fake/gen/extra.txt': 'hand\n' });
  const result = genCheck(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^\[gen-check\] extra packages\/fake\/gen\/extra\.txt: /m);
});

test('a kind without generated globs is a gen-config finding, because gen-check cannot tell what to compare', (t) => {
  const result = genCheck(fixture(t, ['fake'], {}, FAKE_FILES));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^\[gen-check\] gen-config config\/gen-check\.json: the kind fake .*generated globs/m);
});

test('generated globs of a name that is no kind of config/parity.json are a gen-config finding', (t) => {
  const result = genCheck(fixture(t, [], FAKE_GENERATED, FAKE_FILES));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^\[gen-check\] gen-config config\/gen-check\.json: fake is no kind/m);
});
