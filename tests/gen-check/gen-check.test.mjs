// Tests of scripts/gen-check.mjs (docs/plans/fsm-v1.md, C-5): the generated files of a checkout must equal the working tree.
// Every case builds a temporary git checkout from the files of this repository (its scripts, the compiler sources, the
// machines, the lock, the features and the vector files), changes one thing and runs the check in it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VECTOR = 'conformance/vectors/order.json';

/** Writes `text` to `file` below `root`, creating its directories. */
function write(root, file, text) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

/**
 * A temporary git checkout with the files of this repository that gen-check reads, the given layout (contracts/layout.json)
 * and files ({ path: text }), every file tracked; removed with `t.after`. The layout gives the kinds, and each kind's generated
 * globs say which files gen-check compares. The real kinds are checked by `make gen-check`; these cases use their own layout.
 */
function fixture(t, layout, files) {
  const root = mkdtempSync(path.join(tmpdir(), 'gen-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(path.join(ROOT, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  cpSync(path.join(ROOT, 'packages/fsm-compiler/src'), path.join(root, 'packages/fsm-compiler/src'), { recursive: true });
  for (const entry of ['machines', 'conformance', 'fsm.config.json', 'fsm.lock.json']) {
    cpSync(path.join(ROOT, entry), path.join(root, entry), { recursive: true });
  }
  write(root, 'contracts/layout.json', `${JSON.stringify(layout, null, 2)}\n`);
  for (const [file, text] of Object.entries(files)) write(root, file, text);
  spawnSync('git', ['init', '--quiet'], { cwd: root });
  spawnSync('git', ['add', '--all'], { cwd: root });
  return root;
}

/** The layout of a checkout without kinds: only the vector files are compared. */
const NO_KINDS = { schema: 1, tools: [], canonical: { files: [], directories: [] }, kinds: {} };

/** A checkout of this repository with no kinds, so that its vector files are the only generated files. */
const checkout = t => fixture(t, NO_KINDS, {});

/** A kind `fake` whose package generates gen/a.txt, with the generated glob `gen/**`, which the fixed patterns never covered. */
const FAKE_LAYOUT = {
  schema: 1,
  tools: [],
  canonical: { files: [], directories: [] },
  kinds: { fake: { required: [], allowed: ['**'], generated: ['gen/**'] } },
};
const FAKE_FILES = {
  // gen is phony: the directory gen/ would otherwise make the target up to date.
  'packages/fsm-fake/Makefile': '.PHONY: gen\ngen:\n\tmkdir -p $(DEST)/gen\n\tprintf \'a\\n\' > $(DEST)/gen/a.txt\n',
  'packages/fsm-fake/gen/a.txt': 'a\n',
  'packages/fsm-fake/readme.txt': 'not generated\n',
};

/** Runs scripts/gen-check.mjs in `root` and returns its fsm and stderr. */
function genCheck(root) {
  const result = spawnSync(process.execPath, ['scripts/gen-check.mjs'], { cwd: root, encoding: 'utf8' });
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

test('an added tracked file in the compared directory is an extra finding', (t) => {
  const root = checkout(t);
  write(root, 'conformance/vectors/extra.json', '{}\n');
  spawnSync('git', ['add', 'conformance/vectors/extra.json'], { cwd: root });
  const result = genCheck(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^\[gen-check\] extra conformance\/vectors\/extra\.json: /);
});

test('a missing tracked file in the compared directory is a missing finding', (t) => {
  const root = checkout(t);
  rmSync(path.join(root, VECTOR));
  const result = genCheck(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(`^\\[gen-check\\] missing ${VECTOR}: `));
});

test('an ignored file in the compared directory is not read, so it is no finding', (t) => {
  const root = checkout(t);
  write(root, '.gitignore', '*.tmp\n');
  write(root, 'conformance/vectors/scratch.tmp', 'not a vector\n');
  assert.deepEqual(genCheck(root), { status: 0, stderr: '' });
});

test('the files compared for a kind are exactly the files that its generated globs match', (t) => {
  const root = fixture(t, FAKE_LAYOUT, FAKE_FILES);
  assert.deepEqual(genCheck(root), { status: 0, stderr: '' });
  writeFileSync(path.join(root, 'packages/fsm-fake/gen/a.txt'), 'changed\n');
  const changed = genCheck(root);
  assert.equal(changed.status, 1);
  assert.match(changed.stderr, /^\[gen-check\] differs packages\/fsm-fake\/gen\/a\.txt: /m);
});

test('a file that no generated glob of its kind matches is not compared, so changing it is no finding', (t) => {
  const root = fixture(t, FAKE_LAYOUT, FAKE_FILES);
  writeFileSync(path.join(root, 'packages/fsm-fake/readme.txt'), 'edited by hand\n');
  assert.deepEqual(genCheck(root), { status: 0, stderr: '' });
});

test('a tracked file that a generated glob matches but the generator does not write is an extra finding', (t) => {
  const root = fixture(t, FAKE_LAYOUT, { ...FAKE_FILES, 'packages/fsm-fake/gen/extra.txt': 'hand\n' });
  const result = genCheck(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^\[gen-check\] extra packages\/fsm-fake\/gen\/extra\.txt: /m);
});

test('a kind without generated globs is a layout-config finding, because gen-check cannot tell what to compare', (t) => {
  const layout = { ...FAKE_LAYOUT, kinds: { fake: { required: [], allowed: ['**'] } } };
  const result = genCheck(fixture(t, layout, FAKE_FILES));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^\[gen-check\] layout-config contracts\/layout\.json: .*generated/m);
});
