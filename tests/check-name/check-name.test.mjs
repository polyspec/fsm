// Tests of scripts/check-name.mjs (docs/plans/execution-checklist.md, S-18): a tracked file or path that names the library by
// its old name is a finding, and each allowed use of the word (a state value, an exit status, a test result, the history of
// the changelog) passes. Every case builds its checkout in a temporary directory, so no fixture is committed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { nameFindings } from '../../scripts/check-name.mjs';
import { put, tree } from '../kit/tree.mjs';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/check-name.mjs');

/** A checkout with `files` tracked (git add), and the findings of scripts/check-name.mjs in it. */
function check(t, files) {
  const root = tree(t, files);
  spawnSync('git', ['add', '-A'], { cwd: root });
  return { root, result: spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' }) };
}

test('a library name in a generator is a finding with its file and line', (t) => {
  const { result } = check(t, { 'packages/fsm-x/src/gen.mjs': 'const a = 1;\nconst b = "status-gen";\n' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /^\[check-name\] packages\/fsm-x\/src\/gen\.mjs:2: /m);
  assert.match(result.stderr, /1 occurrence\(s\) of the old library name/);
});

test('a path that names the library is a finding', (t) => {
  const { result } = check(t, { 'packages/status-x/README.md': '# x\n' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /^\[check-name\] packages\/status-x\/README\.md: the path names the library/m);
});

test('an untracked file is not scanned', (t) => {
  const root = tree(t, { 'a.mjs': 'x\n' });
  put(root, { 'untracked.mjs': 'status-gen\n' });
  assert.deepEqual(nameFindings(root), []);
});

test('the consumer status column and its accessors are allowed', (t) => {
  const { result } = check(t, {
    'packages/fsm-x/examples/persist.mjs': 'await row.setStatus(code).update();\nexport async function statusOf(db, id) {}\n',
    'schema/persist.dbs': 'dbspec 1 persist\n\ntable item {\n  id i64\n  status i32\n  primary key (id)\n}\n',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('an exit status and a test result status are allowed', (t) => {
  const { result } = check(t, {
    'tests/gen-check/a.test.mjs': 'assert.equal(run.status, 0);\nassert.deepEqual(x, { status: 0, stderr: \'\' });\nconst c = { status: \'pass\' };\n',
    'scripts/a.mjs': '// the command exits with status 1 when there is one.\n',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('the changelog keeps the text of old bullets, and the vendored kit is not scanned', (t) => {
  const { result } = check(t, {
    'CHANGELOG.md': '- S-01: `status-gen` was named so.\n',
    'scripts/kit/status-table.mjs': 'export const x = 1;\n',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('a usage error exits with status 2', (t) => {
  const root = tree(t, {});
  const result = spawnSync(process.execPath, [SCRIPT, '--root', root, '--unknown'], { encoding: 'utf8' });
  assert.equal(result.status, 2, result.stdout + result.stderr);
});

test('the rules and the plan may state the old name only as the old name', (t) => {
  const allowed = check(t, { 'AGENTS.md': 'no file names the library by its old name `status`.\n' });
  assert.equal(allowed.result.status, 0, allowed.result.stdout + allowed.result.stderr);
  const plain = check(t, { 'AGENTS.md': 'status defines state machines.\n' });
  assert.equal(plain.result.status, 1, plain.result.stdout + plain.result.stderr);
  const elsewhere = check(t, { 'README.md': 'its old name `status`\n' });
  assert.equal(elsewhere.result.status, 1, elsewhere.result.stdout + elsewhere.result.stderr);
});
