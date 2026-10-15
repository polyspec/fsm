// Tests of scripts/check-name.mts (docs/plans/execution-checklist.md, S-18): a tracked file or path that names the library by
// its old name is a finding, and each allowed use of the word (a state value, an exit status, a test result, the history of
// the changelog) passes. Every case builds its checkout in a temporary directory, so no fixture is committed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { nameFindings } from '../../scripts/check-name.mts';
import { type Files, put, tree } from '../support/tree.mts';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/check-name.mts');

/** A checkout with `files` tracked (git add), and the findings of scripts/check-name.mts in it. */
function check(t: TestContext, files: Files) {
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

test('the changelog keeps the text of old bullets, and the copies of kit are not scanned', (t) => {
  const { result } = check(t, {
    'CHANGELOG.md': '- S-01: `status-gen` was named so.\n',
    'scripts/kit/kit-bootstrap.mk': '# the status of the bootstrap\n',
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

// The audit probe lines (audit 6, docs/plans/execution-checklist.md, S-27): each one still names the library through a word
// that no allowed phrase covers, so every line is a finding, and the phrases of the same line are not an allowance for it.
test('the audit probe lines are findings, one per line', (t) => {
  const { result } = check(t, {
    'README.md': [
      'Install the status library: npm i @polyspec/status-npm # status code',
      'Run `status-gen gen` and see the status column docs',
      "const s = require('status'); s.status === 'x'",
      "Use status.Error from the status package: status: 'pass'",
      '',
    ].join('\n'),
    'packages/go/examples/model/go.mod': 'module github.com/polyspec/status-go\n',
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  for (const where of ['README.md:1:', 'README.md:2:', 'README.md:3:', 'README.md:4:', 'packages/go/examples/model/go.mod:1:']) {
    assert.ok(result.stderr.includes(`[check-name] ${where} `), `${where} is a finding\n${result.stderr}`);
  }
  assert.match(result.stderr, /5 occurrence\(s\) of the old library name/);
});

test('an allowed phrase is removed from its line and the rest is scanned again', (t) => {
  const { result } = check(t, { 'packages/fsm-x/src/gen.mjs': '// the status column, read by status-gen\n' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /^\[check-name\] packages\/fsm-x\/src\/gen\.mjs:1: /m);
});

test('the consumer accessors of the status column are allowed only as exact names', (t) => {
  const { result } = check(t, {
    'packages/fsm-x/examples/persist.py': 'def status_of(db, row_id):\n    row.set_status(code)\n    row.order_by_status_asc()\n',
    'packages/fsm-x/examples/persist.rs': 'pub async fn status_of(db: &Db) {}\n',
    'packages/fsm-x/examples/persist.go': 'func StatusOf(db *orm.DB) {}\nfunc Statusify() {}\n',
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /^\[check-name\] packages\/fsm-x\/examples\/persist\.go:2: /m);
  assert.doesNotMatch(result.stderr, /persist\.(py|rs|go):1:/);
});

test('the model entry allows the generated helper names of the status column, not other words', (t) => {
  const { result } = check(t, {
    'packages/go/examples/model/item.go': [
      'func (x *ItemModel) GetStatus() int32 { return x.fStatus }',
      'func (x *ItemModel) OrderByStatusAsc(fn ...orm.Func) *ItemModel { x.m.OrderBy("status", false, fn); return x }',
      'case "status":',
      '',
    ].join('\n'),
    'packages/js/examples/model/models.ts': "x.set('status-gen', 1);\n",
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /^\[check-name\] packages\/js\/examples\/model\/models\.ts:1: /m);
  assert.doesNotMatch(result.stderr, /item\.go:/);
});

test('a CHANGELOG bullet is allowed only for an item up to the rename (S-01 to S-18)', (t) => {
  const before = check(t, {
    'CHANGELOG.md': '- S-17: the GUI reads `status-gen` (packages/status-gui).\n- S-11-2: `status-python`.\n- S-18: the rename, `status-gen` stays.\n',
  });
  assert.equal(before.result.status, 0, before.result.stdout + before.result.stderr);
  const after = check(t, { 'CHANGELOG.md': '- S-18-1: the command `status-gen` answers.\n' });
  assert.equal(after.result.status, 1, after.result.stdout + after.result.stderr);
  const note = check(t, { 'CHANGELOG.md': '- a note that names `status-gen`\n' });
  assert.equal(note.result.status, 1, note.result.stdout + note.result.stderr);
});

test('the S-18 row allows its task phrases and no other occurrence', (t) => {
  const row = '| S-18 | Rename status to fsm everywhere: the plan | a remaining `status` name that is not a state status RED (a scan) → GREEN |';
  const ok = check(t, { 'docs/plans/execution-checklist.md': `${row}\n` });
  assert.equal(ok.result.status, 0, ok.result.stdout + ok.result.stderr);
  const extra = check(t, { 'docs/plans/execution-checklist.md': '| S-18 | Rename status to fsm everywhere; status-gen stays | x | [o] |\n' });
  assert.equal(extra.result.status, 1, extra.result.stdout + extra.result.stderr);
});

test('a helper comment that names the exit status of a process is allowed', (t) => {
  const { result } = check(t, {
    'packages/compiler/tests/fsm-gen.test.mjs': '/** Runs fsm-gen with `args` and returns its status, stdout and stderr. */\n',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
