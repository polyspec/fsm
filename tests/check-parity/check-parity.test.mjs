// Tests of scripts/check-parity.mjs: each condition of the parity check has a failing and a passing case. Every case builds
// its checkout in a temporary directory with result records written as run-tests.mjs writes them, so no fixture is committed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parityFindings } from '../../scripts/check-parity.mjs';
import { inputsDigest } from '../../scripts/kit/tracked-files.mjs';
import { put, tree } from '../kit/tree.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LAYOUT = { schema: 1, tools: [], canonical: { files: [], directories: [] }, kinds: { go: { required: [], allowed: [] }, npm: { required: [], allowed: [] } } };
const FEATURES = { schema: 1, features: ['initial', 'apply'] };
const VECTORS = { machine: 'order', cases: [{ feature: 'initial', id: 'order_initial' }, { feature: 'apply', id: 'order_draft_next_changed' }] };
const NAMES = ['test_initial__order_initial', 'test_apply__order_draft_next_changed'];

function checkout(t, { vectors = VECTORS, features = FEATURES } = {}) {
  return tree(t, {
    'contracts/layout.json': JSON.stringify(LAYOUT),
    'contracts/features.json': JSON.stringify(features),
    'conformance/vectors/order.json': JSON.stringify(vectors),
    'packages/fsm-go/a_test.go': 'package a',
    'packages/fsm-npm/a.test.mjs': 'a',
    'packages/fsm-compiler/a.mjs': 'c',
  });
}

/** Writes the record of `kind` as run-tests.mjs does: the cases, the tool, the inputs and the elapsed time. */
function record(root, name, cases, { paths = [name === 'compiler-test' ? 'packages/fsm-compiler' : `packages/fsm-${name}`], elapsedMs = 1000, digest } = {}) {
  put(root, { [`.results/${name}.json`]: JSON.stringify({ tool: 'node', inputs: { paths, digest: digest ?? inputsDigest(root, paths) }, elapsedMs, cases }) });
}
const go = names => names.map(name => ({ id: `example.com/s/tests › TestConformance › ${name}`, status: 'pass', elapsedMs: 1 }));
const npm = names => names.map(name => ({ id: `packages/fsm-npm/a.test.mjs › ${name}`, status: 'pass', elapsedMs: 1 }));
const parent = { id: 'example.com/s/tests › TestConformance', status: 'pass', elapsedMs: 2 };
const passing = (root) => {
  record(root, 'go', [...go(NAMES), parent]);
  record(root, 'npm', npm(NAMES));
  record(root, 'compiler-test', [{ id: 'packages/fsm-compiler/a.test.mjs › validates', status: 'pass', elapsedMs: 3 }]);
};
const ignore = root => put(root, { '.gitignore': '/.results/\n' });
const messages = (root, options) => parityFindings(root, options).map(found => found.message);

test('every kind ran every vector case once and passed, the Go parent of the subtests counts, and the tool results exist', (t) => {
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
  record(root, 'npm', npm(NAMES));
  put(root, { 'packages/fsm-npm/a.test.mjs': 'changed' });
  assert.deepEqual(messages(root, { tools: [] }), ['.results/npm.json is stale: the files of packages/fsm-npm changed after the run; run make test-npm']);
});

test('a record whose inputs do not cover its package is not a record of that kind', (t) => {
  const root = checkout(t);
  ignore(root);
  passing(root);
  record(root, 'npm', npm(NAMES), { paths: ['contracts'] });
  assert.deepEqual(messages(root, { tools: [] }), ['.results/npm.json covers contracts, not packages/fsm-npm; run make test-npm']);
});

test('a vector case that did not run, ran twice, or a case that no vector holds', (t) => {
  const root = checkout(t);
  ignore(root);
  passing(root);
  record(root, 'npm', [...npm([NAMES[0]]), ...npm([NAMES[0]]), ...npm(['test_apply__order_unknown'])]);
  assert.deepEqual(messages(root, { tools: [] }), [
    'npm ran test_initial__order_initial 2 times; every case runs once',
    'npm did not run test_apply__order_draft_next_changed',
    'npm ran test_apply__order_unknown, which no vector of conformance/vectors holds',
  ]);
});

test('a case with a kinds list is run by those kinds only: the other kinds neither need it nor may run it', (t) => {
  const raw = 'test_apply__order_raw_only_go';
  const root = checkout(t, { vectors: { machine: 'order', cases: [...VECTORS.cases, { feature: 'apply', id: 'order_raw_only_go', kinds: ['go'] }] } });
  ignore(root);
  record(root, 'go', [...go([...NAMES, raw]), parent]);
  record(root, 'npm', npm(NAMES));
  record(root, 'compiler-test', [{ id: 'packages/fsm-compiler/a.test.mjs › validates', status: 'pass', elapsedMs: 3 }]);
  assert.deepEqual(messages(root, { tools: ['compiler-test'] }), []);
  record(root, 'npm', npm([...NAMES, raw]));
  assert.deepEqual(messages(root, { tools: [] }), ['npm ran test_apply__order_raw_only_go, which its vector does not admit for npm']);
  record(root, 'npm', npm(NAMES));
  record(root, 'go', [...go(NAMES), parent]);
  assert.deepEqual(messages(root, { tools: [] }), ['go did not run test_apply__order_raw_only_go']);
});

test('a kinds list is a non-empty list of declared kinds', (t) => {
  const root = checkout(t, { vectors: { machine: 'order', cases: [...VECTORS.cases, { feature: 'apply', id: 'order_empty', kinds: [] }, { feature: 'apply', id: 'order_ruby', kinds: ['ruby'] }] } });
  ignore(root);
  passing(root);
  assert.deepEqual(messages(root, { tools: [] }), [
    'conformance/vectors/order.json holds the case test_apply__order_empty with a kinds field that is not a non-empty list of kind names',
    'the case test_apply__order_ruby is admitted by ruby, which contracts/layout.json does not declare as a kind',
  ]);
});

test('a feature without a vector case, and a vector of a feature that features.json does not list', (t) => {
  const root = checkout(t, { features: { schema: 1, features: ['initial', 'apply', 'persist'] }, vectors: { machine: 'order', cases: [...VECTORS.cases, { feature: 'other', id: 'order_x' }] } });
  ignore(root);
  passing(root);
  const found = messages(root, { tools: [] });
  assert.ok(found.includes('the feature persist has no vector case in conformance/vectors'), found.join('\n'));
  assert.ok(found.includes('conformance/vectors/order.json holds the case order_x of the feature other, which contracts/features.json does not list'), found.join('\n'));
});

test('a case with any status but pass fails: fail, timeout and skip', (t) => {
  const root = checkout(t);
  ignore(root);
  passing(root);
  const cases = npm(NAMES);
  cases[0].status = 'skip';
  cases[1].status = 'timeout';
  record(root, 'npm', [...cases, { id: 'packages/fsm-npm/a.test.mjs › helper', status: 'fail', elapsedMs: 1 }]);
  const found = messages(root, { tools: [] });
  assert.deepEqual(found.filter(entry => / is (?:skip|timeout|fail);/.test(entry)), [
    'npm: packages/fsm-npm/a.test.mjs › test_initial__order_initial is skip; every case passes',
    'npm: packages/fsm-npm/a.test.mjs › test_apply__order_draft_next_changed is timeout; every case passes',
    'npm: packages/fsm-npm/a.test.mjs › helper is fail; every case passes',
  ]);
});

test('an id that names two cases, and an id that names none and is not the parent of a case', (t) => {
  const root = checkout(t);
  ignore(root);
  passing(root);
  record(root, 'npm', [...npm(NAMES), { id: `x › ${NAMES[0]} › ${NAMES[1]}`, status: 'pass', elapsedMs: 1 }, { id: 'packages/fsm-npm/a.test.mjs › helper', status: 'pass', elapsedMs: 1 }]);
  assert.deepEqual(messages(root, { tools: [] }), [
    `npm: the id x › ${NAMES[0]} › ${NAMES[1]} names 2 cases; a test names one case`,
    'npm: the id packages/fsm-npm/a.test.mjs › helper names no case and is not the parent of one; a test of a language package runs a vector case',
  ]);
});

test('a record over 10 minutes fails', (t) => {
  const root = checkout(t);
  ignore(root);
  passing(root);
  record(root, 'go', [...go(NAMES), parent], { elapsedMs: 600_001 });
  assert.deepEqual(messages(root, { tools: [] }), ['.results/go.json ran 600001 ms; a test process runs at most 600000 ms']);
});

test('--kind reads only the result of its kind, never the other kinds or the tool tests', (t) => {
  const root = checkout(t);
  ignore(root);
  record(root, 'go', [...go(NAMES), parent]);
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
  assert.match(passed.stdout, /\[check-parity\] 2 kinds passed; the vectors hold 2 cases, each run by every kind that admits it/);
  put(root, { '.results/npm.json': null });
  const failed = command('--kind', 'npm');
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /\[check-parity\] the kind npm has no result \.results\/npm\.json; run make test-npm/);
});
