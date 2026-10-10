// Tests of scripts/gen-check.mjs (docs/plans/status-v1.md, C-5): the generated files of a checkout must equal the working tree.
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

/** A temporary git checkout with the files of this repository that gen-check reads, every file tracked; removed with `t.after`. */
function checkout(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'gen-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(path.join(ROOT, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  cpSync(path.join(ROOT, 'packages/status-compiler/src'), path.join(root, 'packages/status-compiler/src'), { recursive: true });
  for (const entry of ['contracts', 'machines', 'conformance', 'status.config.json', 'status.lock.json']) {
    cpSync(path.join(ROOT, entry), path.join(root, entry), { recursive: true });
  }
  spawnSync('git', ['init', '--quiet'], { cwd: root });
  spawnSync('git', ['add', '--all'], { cwd: root });
  return root;
}

/** Writes `text` to `file` below `root`, creating its directories. */
function write(root, file, text) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

/** Runs scripts/gen-check.mjs in `root` and returns its status and stderr. */
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
