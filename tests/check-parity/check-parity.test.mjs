// Tests of scripts/check-parity.mjs: each rule that the check keeps beside kit's parity check (K33) has a failing and a passing
// case. Every case builds its checkout in a temporary directory with result records written as run-tests.mjs writes them, so no
// fixture is committed. The rules of the cases themselves (each kind runs every admitted case once and passes) are K33's.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parityFindings } from '../../scripts/check-parity.mjs';
import { inputsDigest } from '../../scripts/kit/tracked-files.mjs';
import { put, tree } from '../kit/tree.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LAYOUT = { schema: 1, tools: [], canonical: { files: [], directories: [] }, kinds: { go: { required: [], allowed: [] }, npm: { required: [], allowed: [] } } };
const FEATURES = { schema: 1, features: ['initial', 'apply'] };
const CASES = [{ feature: 'initial', id: 'order_initial', name: 'initial__order_initial' }, { feature: 'apply', id: 'order_draft_next_changed', name: 'apply__order_draft_next_changed' }];
const vectorsOf = cases => ({ machines: [{ machine: 'order', cases }] });

function checkout(t, { cases = CASES, features = FEATURES } = {}) {
  return tree(t, {
    'contracts/layout.json': JSON.stringify(LAYOUT),
    'contracts/features.json': JSON.stringify(features),
    'conformance/vectors.json': JSON.stringify(vectorsOf(cases)),
    'packages/fsm-go/a_test.go': 'package a',
    'packages/fsm-npm/a.test.mjs': 'a',
    'packages/fsm-compiler/a.mjs': 'c',
  });
}

/** Writes the record of `name` as run-tests.mjs does: the cases, the tool, the inputs and the elapsed time. */
function record(root, name, cases, { paths = [name === 'compiler-test' ? 'packages/fsm-compiler' : `packages/fsm-${name}`], elapsedMs = 1000, digest } = {}) {
  put(root, { [`.results/${name}.json`]: JSON.stringify({ tool: 'node', inputs: { paths, digest: digest ?? inputsDigest(root, paths) }, elapsedMs, cases }) });
}
const run = names => names.map(name => ({ id: `x › ${name}`, status: 'pass', elapsedMs: 1 }));
const tool = [{ id: 'packages/fsm-compiler/a.test.mjs › validates', status: 'pass', elapsedMs: 3 }];
const passing = (root) => {
  record(root, 'go', run(['initial__order_initial']));
  record(root, 'npm', run(['initial__order_initial']));
  record(root, 'compiler-test', tool);
};
const ignore = root => put(root, { '.gitignore': '/.results/\n' });
const messages = (root, options) => parityFindings(root, options).map(found => found.message);

test('every kind and every tool test has a current record within the limit, and every feature has a vector case', (t) => {
  const root = checkout(t);
  ignore(root);
  passing(root);
  assert.deepEqual(parityFindings(root, { tools: ['compiler-test'] }), []);
});

test('a missing result of a kind or of a tool test, and a stale one', (t) => {
  const root = checkout(t);
  ignore(root);
  passing(root);
  put(root, { '.results/npm.json': null, '.results/compiler-test.json': null });
  assert.deepEqual(messages(root, { tools: ['compiler-test'] }), [
    'the kind npm has no result .results/npm.json; run make test-npm',
    'the tool test compiler-test has no result .results/compiler-test.json; run make compiler-test',
  ]);
  record(root, 'npm', run(['initial__order_initial']));
  put(root, { 'packages/fsm-npm/a.test.mjs': 'changed' });
  assert.deepEqual(messages(root, { tools: [] }), ['.results/npm.json is stale: the files of packages/fsm-npm changed after the run; run make test-npm']);
});

test('a record whose inputs do not cover its package is not a record of that kind', (t) => {
  const root = checkout(t);
  ignore(root);
  passing(root);
  record(root, 'npm', run(['initial__order_initial']), { paths: ['contracts'] });
  assert.deepEqual(messages(root, { tools: [] }), ['.results/npm.json covers contracts, not packages/fsm-npm; run make test-npm']);
});

test('a feature without a vector case, and a vector case of a feature that features.json does not list', (t) => {
  const root = checkout(t, { features: { schema: 1, features: ['initial', 'apply', 'persist'] }, cases: [...CASES, { feature: 'other', id: 'order_x', name: 'other__order_x' }] });
  ignore(root);
  passing(root);
  assert.deepEqual(messages(root, { tools: [] }), [
    'conformance/vectors.json holds the case other__order_x of the feature other, which contracts/features.json does not list',
    'the feature persist has no vector case in conformance/vectors.json',
  ]);
});

test('a case of a tool test record with any status but pass fails: fail, timeout and skip', (t) => {
  const root = checkout(t);
  ignore(root);
  passing(root);
  record(root, 'compiler-test', [{ ...tool[0], status: 'skip' }, { id: 'b', status: 'timeout', elapsedMs: 1 }, { id: 'c', status: 'fail', elapsedMs: 1 }]);
  assert.deepEqual(messages(root, { tools: ['compiler-test'] }), [
    'compiler-test: packages/fsm-compiler/a.test.mjs › validates is skip; every case passes',
    'compiler-test: b is timeout; every case passes',
    'compiler-test: c is fail; every case passes',
  ]);
});

test('a record over 10 minutes fails', (t) => {
  const root = checkout(t);
  ignore(root);
  passing(root);
  record(root, 'go', run(['initial__order_initial']), { elapsedMs: 600_001 });
  assert.deepEqual(messages(root, { tools: [] }), ['.results/go.json ran 600001 ms; a test process runs at most 600000 ms']);
});

test('--kind reads only the result of its kind, never the other kinds or the tool tests', (t) => {
  const root = checkout(t);
  ignore(root);
  record(root, 'go', run(['initial__order_initial']));
  assert.deepEqual(parityFindings(root, { kind: 'go' }), []);
  assert.deepEqual(messages(root, { kind: 'npm' }), ['the kind npm has no result .results/npm.json; run make test-npm']);
  assert.deepEqual(messages(root, { kind: 'ruby' }), ['--kind ruby is not a kind of contracts/layout.json']);
});

test('the command prints each finding and exits 1, and passes on a passing checkout', (t) => {
  const root = checkout(t);
  ignore(root);
  passing(root);
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  cpSync(path.join(ROOT, 'scripts/check-parity.mjs'), path.join(root, 'scripts/check-parity.mjs'));
  cpSync(path.join(ROOT, 'scripts/kit'), path.join(root, 'scripts/kit'), { recursive: true });
  const command = (...args) => spawnSync(process.execPath, ['scripts/check-parity.mjs', ...args], { cwd: root, encoding: 'utf8' });
  const passed = command('--tools', 'compiler-test');
  assert.equal(passed.status, 0, passed.stdout + passed.stderr);
  assert.match(passed.stdout, /\[check-parity\] 2 kinds passed: the records are present, current and within 600000 ms; every feature has a vector case/);
  put(root, { '.results/npm.json': null });
  const failed = command('--kind', 'npm');
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /\[check-parity\] the kind npm has no result \.results\/npm\.json; run make test-npm/);
});

// make check runs kit's parity check (K33: parity-declarations-check and parity-check, config/parity.json) for the cases, and
// vector-parity-check (scripts/check-parity.mjs) for the rules that K33 does not take; no rule runs twice (S-42-1).
test('make check runs the parity check of kit and vector-parity-check', () => {
  const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  const targets = makefile.match(/^CHECK_TARGETS\s*:=\s*(.*)$/m)?.[1].split(/\s+/).filter(Boolean) ?? [];
  for (const target of ['parity-declarations-check', 'parity-check', 'vector-parity-check']) assert.ok(targets.includes(target), `CHECK_TARGETS lacks ${target}`);
  assert.ok(!/^parity-check\s*:/m.test(makefile), 'the Makefile redefines the kit target parity-check');
});
