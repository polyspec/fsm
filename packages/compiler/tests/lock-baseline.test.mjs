// Tests of the committed lock as the baseline of the lock rules (docs/spec/fsm.md, B-3): the file stores read the lock at git
// HEAD, and fsm-gen refuses a lock that loses or changes a committed code with E_LOCK_REGRESSED. The audit case swaps the
// codes of two states and empties fsm.lock.json: before this rule, `lock` wrote the swapped codes and printed `lock: ok`.
// Every case runs in temporary directories that are removed when the file's tests end. A git work tree is made with git in
// the directory itself, so the cases never touch the repository of the checkout.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ORDER_LOCK_TEXT, ORDER_MMD_TEXT, ORDER_TEXT } from './canonical-texts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '../src/cli/fsm-gen.mjs');
const JSON_CONFIG = '{ "store": "json" }\n';
const MERMAID_CONFIG = '{ "store": "mermaid" }\n';
const LOCK_PATH = 'fsm.lock.json';
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A new temporary directory with the files of `files` (path -> text), removed when the file's tests end. */
function project(files = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'fsm-lock-baseline-'));
  roots.push(root);
  for (const [relative, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), text);
  }
  return root;
}

/** Runs git with `args` in `root` and returns its exit code and output. */
function git(root, ...args) {
  const result = spawnSync('git', ['-c', 'user.name=fsm-test', '-c', 'user.email=fsm-test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Makes `root` a git work tree with every file of it committed. */
function commitAll(root) {
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  const committed = git(root, 'commit', '-q', '-m', 'committed state');
  assert.equal(committed.status, 0, committed.stderr);
}

/** Runs fsm-gen with `args` in `cwd` and returns its exit code, stdout and stderr. */
function gen(args, cwd = HERE) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** The order machine of ORDER_TEXT with the codes of draft and paid swapped. */
function swappedOrderText() {
  const definition = JSON.parse(ORDER_TEXT);
  definition.states[0].code = 2;
  definition.states[1].code = 1;
  return JSON.stringify(definition, null, 2);
}

/** The Mermaid order machine with the codes of draft and done swapped. */
function swappedMermaidText() {
  return ORDER_MMD_TEXT.replace('draft : 1', 'draft : @').replace('done : 2', 'done : 1').replace('draft : @', 'draft : 2');
}

test('the audit: lock refuses to swap committed codes after fsm.lock.json is emptied (E_LOCK_REGRESSED)', () => {
  const root = project({ 'fsm.config.json': JSON_CONFIG, 'machines/order.fsm.json': ORDER_TEXT });
  assert.equal(gen(['lock', '--project', root]).status, 0);
  commitAll(root);
  writeFileSync(path.join(root, 'machines/order.fsm.json'), swappedOrderText());
  writeFileSync(path.join(root, LOCK_PATH), '{}\n');
  const result = gen(['lock', '--project', root]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^\[fsm-gen\] E_LOCK_REGRESSED order \$\.codes: /m);
  assert.equal(readFileSync(path.join(root, LOCK_PATH), 'utf8'), '{}\n');
});

test('the audit on the mermaid store: lock refuses the swap of committed codes (E_LOCK_REGRESSED)', () => {
  const root = project({ 'fsm.config.json': MERMAID_CONFIG, 'machines/order.fsm.mmd': ORDER_MMD_TEXT });
  assert.equal(gen(['lock', '--project', root]).status, 0);
  commitAll(root);
  writeFileSync(path.join(root, 'machines/order.fsm.mmd'), swappedMermaidText());
  writeFileSync(path.join(root, LOCK_PATH), '{}\n');
  const result = gen(['lock', '--project', root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /E_LOCK_REGRESSED order/);
  assert.equal(readFileSync(path.join(root, LOCK_PATH), 'utf8'), '{}\n');
});

test('a deleted lock file is restored by lock when the definitions keep their committed codes', () => {
  const root = project({ 'fsm.config.json': JSON_CONFIG, 'machines/order.fsm.json': ORDER_TEXT, [LOCK_PATH]: ORDER_LOCK_TEXT });
  commitAll(root);
  rmSync(path.join(root, LOCK_PATH));
  assert.deepEqual(gen(['lock', '--project', root]), { status: 0, stdout: '[fsm-gen] lock: ok\n', stderr: '' });
  assert.equal(readFileSync(path.join(root, LOCK_PATH), 'utf8'), ORDER_LOCK_TEXT);
});

test('check refuses a committed lock that is no longer readable at HEAD (E_SCHEMA, not a silent empty baseline)', () => {
  const root = project({ 'fsm.config.json': JSON_CONFIG, 'machines/order.fsm.json': ORDER_TEXT, [LOCK_PATH]: '{ "order": 1 }\n' });
  commitAll(root);
  writeFileSync(path.join(root, LOCK_PATH), ORDER_LOCK_TEXT);
  const result = gen(['check', '--project', root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /E_SCHEMA/);
});

test('outside a git work tree there is no committed lock, so the swap is judged by the stored lock alone', () => {
  const root = project({ 'fsm.config.json': JSON_CONFIG, 'machines/order.fsm.json': swappedOrderText(), [LOCK_PATH]: '{}\n' });
  assert.deepEqual(gen(['lock', '--project', root]), { status: 0, stdout: '[fsm-gen] lock: ok\n', stderr: '' });
});

test('an untracked lock file has no committed state: nothing is released, so the stored lock alone is judged', () => {
  const root = project({ 'fsm.config.json': JSON_CONFIG, 'machines/order.fsm.json': ORDER_TEXT });
  commitAll(root);
  writeFileSync(path.join(root, LOCK_PATH), ORDER_LOCK_TEXT);
  git(root, 'rm', '-q', '--cached', LOCK_PATH);
  git(root, 'commit', '-q', '-m', 'lock untracked');
  writeFileSync(path.join(root, 'machines/order.fsm.json'), swappedOrderText());
  writeFileSync(path.join(root, LOCK_PATH), '{}\n');
  assert.deepEqual(gen(['lock', '--project', root]), { status: 0, stdout: '[fsm-gen] lock: ok\n', stderr: '' });
});

test('lock --rename of a committed state is accepted before the commit, and check then passes', () => {
  const root = project({ 'fsm.config.json': JSON_CONFIG, 'machines/order.fsm.json': ORDER_TEXT, [LOCK_PATH]: ORDER_LOCK_TEXT });
  commitAll(root);
  assert.deepEqual(gen(['lock', '--project', root, '--rename', 'order.done=shipped']), { status: 0, stdout: '[fsm-gen] lock: ok\n', stderr: '' });
  assert.deepEqual(gen(['check', '--project', root]), { status: 0, stdout: '[fsm-gen] check: ok\n', stderr: '' });
});

test('gen refuses a consistent swap of the definitions and the lock against the commit (E_LOCK_REGRESSED) and writes no file', () => {
  const root = project({ 'fsm.config.json': JSON_CONFIG, 'machines/order.fsm.json': ORDER_TEXT, [LOCK_PATH]: ORDER_LOCK_TEXT });
  commitAll(root);
  const swapped = JSON.parse(swappedOrderText());
  writeFileSync(path.join(root, 'machines/order.fsm.json'), JSON.stringify(swapped, null, 2));
  writeFileSync(path.join(root, LOCK_PATH), '{ "order": { "codes": { "1": "done", "2": "draft" }, "reserved": [] } }\n');
  const out = path.join(root, 'out');
  const result = gen(['gen', '--kind', 'npm', '--out', out, '--project', root]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^\[fsm-gen\] E_LOCK_REGRESSED order \$\.codes: /m);
  assert.equal(existsSync(out), false);
});
