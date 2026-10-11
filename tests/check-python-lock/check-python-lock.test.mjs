// Tests of scripts/check-python-lock.mjs (docs/plans/execution-checklist.md, S-34; docs/plans/fsm-v1.md, C-1): the uv.lock of
// packages/fsm-python locks every package of the environment with an exact version and a hash (a polyspec library from the
// archive of its release tag, never from git, S-34-3),
// and it agrees with pyproject.toml. The kit gate reads only build-system and optional requirements of a Python manifest, so a
// runtime dependency without a pin passes it (the RED of S-34). Each fixture is written in a temporary directory; nothing is
// committed. The committed lock is checked too.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { check, checkExport } from '../../scripts/check-python-lock.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts/check-python-lock.mjs');
const COMMITTED = path.join(ROOT, 'packages/fsm-python');
const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;

/** A registry package block: its sdist and wheel, each with a hash unless `hashes` says otherwise. */
function registry(name, version, { deps = [], hashes = [HASH_A, HASH_A], artifacts = true } = {}) {
  const lines = [
    '[[package]]',
    `name = "${name}"`,
    `version = "${version}"`,
    'source = { registry = "https://pypi.org/simple" }',
    deps.length ? `dependencies = [\n${deps.map(dep => `    { name = "${dep}" },`).join('\n')}\n]` : 'dependencies = []',
  ];
  if (artifacts) {
    const [sdist, wheel] = hashes;
    lines.push(`sdist = { url = "https://files.example/${name}-${version}.tar.gz"${sdist ? `, hash = "${sdist}"` : ''}, size = 1 }`);
    lines.push('wheels = [');
    lines.push(`    { url = "https://files.example/${name}-${version}-py3-none-any.whl"${wheel ? `, hash = "${wheel}"` : ''}, size = 1 },`);
    lines.push(']');
  }
  return lines.join('\n');
}

/** A release archive block: its source is the archive of the tag `tag` of a polyspec repository, with the sdist hash `hash`. */
function archive(name, { tag = 'v1.0.0', url = `https://github.com/polyspec/${name}/archive/refs/tags/${tag}.tar.gz`, hash = HASH_B, deps = [] } = {}) {
  return [
    '[[package]]',
    `name = "${name}"`,
    'version = "1.0.0"',
    `source = { url = "${url}", subdirectory = "py" }`,
    deps.length ? `dependencies = [\n${deps.map(dep => `    { name = "${dep}" },`).join('\n')}\n]` : 'dependencies = []',
    hash ? `sdist = { hash = "${hash}" }` : '',
  ].filter(Boolean).join('\n');
}

/** A git package block, which the lock refuses (S-34-3). */
const git = name => ['[[package]]', `name = "${name}"`, 'version = "1.0.0"', `source = { git = "git+https://github.com/polyspec/${name}?rev=v1.0.0#${'c'.repeat(40)}" }`, 'dependencies = []'].join('\n');

/** The editable project block of the fixture, whose dependencies are `deps`. */
const project = deps => [
  '[[package]]',
  'name = "fixture-project"',
  'version = "0.0.0"',
  'source = { editable = "." }',
  `dependencies = [\n${deps.map(dep => `    { name = "${dep}" },`).join('\n')}\n]`,
  '',
  '[package.metadata]',
  `requires-dist = [${deps.map(dep => `{ name = "${dep}" }`).join(', ')}]`,
].join('\n');

const LOCK_HEAD = 'version = 1\nrevision = 3\nrequires-python = ">=3.11"\n';

/** The fixture project: pyproject.toml pins alpha and takes beta from the tag v1.0.0; the lock holds `packages`. */
const PYPROJECT = [
  '[project]',
  'name = "fixture-project"',
  'version = "0.0.0"',
  'dependencies = [',
  '    "alpha==1.0.0",',
  '    "beta @ https://github.com/polyspec/beta/archive/refs/tags/v1.0.0.tar.gz#subdirectory=py",',
  ']',
  '',
].join('\n');

function goodPackages() {
  return [
    registry('alpha', '1.0.0', { deps: ['gamma'] }),
    registry('gamma', '2.0.0'),
    archive('beta', { deps: [] }),
    project(['alpha', 'beta']),
  ];
}

/** A fixture package directory in a temporary directory: its pyproject.toml and a uv.lock made of `blocks`, or none. */
function fixture(t, { blocks = goodPackages(), pyproject = PYPROJECT, lock } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'check-python-lock-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'pkg');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'pyproject.toml'), pyproject);
  if (lock !== null) writeFileSync(path.join(dir, 'uv.lock'), lock ?? `${LOCK_HEAD}\n${blocks.join('\n\n')}\n`);
  return dir;
}

/** Whether a finding of `rule` names the package `name`: the last word of its subject is the name. */
const has = (findings, rule, name) => findings.some(finding => finding.rule === rule && finding.subject.split(' ').pop() === name);

test('the committed lock of packages/fsm-python locks every package with a version and hashes, from the registry or a release archive', () => {
  assert.deepEqual(check(COMMITTED), [], 'the committed uv.lock fails the lock check');
});

test('a fixture whose every package is locked passes', (t) => {
  assert.deepEqual(check(fixture(t)), []);
});

test('a registry package without a hash fails the pin rule', (t) => {
  const blocks = goodPackages().map(block => (block.includes('name = "gamma"') ? registry('gamma', '2.0.0', { hashes: [null, null] }) : block));
  const findings = check(fixture(t, { blocks }));
  assert.ok(has(findings, 'pin', 'gamma'), `no pin finding for gamma: ${JSON.stringify(findings)}`);
});

test('a wheel without a hash fails the pin rule even when the sdist has one', (t) => {
  const blocks = goodPackages().map(block => (block.includes('name = "gamma"') ? registry('gamma', '2.0.0', { hashes: [HASH_A, null] }) : block));
  const findings = check(fixture(t, { blocks }));
  assert.ok(has(findings, 'pin', 'gamma'), `no pin finding for the wheel: ${JSON.stringify(findings)}`);
});

test('a registry package with no artifact fails the pin rule', (t) => {
  const blocks = goodPackages().map(block => (block.includes('name = "gamma"') ? registry('gamma', '2.0.0', { artifacts: false }) : block));
  const findings = check(fixture(t, { blocks }));
  assert.ok(has(findings, 'pin', 'gamma'), `no pin finding for gamma: ${JSON.stringify(findings)}`);
});

test('a registry version other than the pin of pyproject.toml fails the pin rule', (t) => {
  const blocks = goodPackages().map(block => (block.includes('name = "alpha"') ? registry('alpha', '1.0.1', { deps: ['gamma'] }) : block));
  const findings = check(fixture(t, { blocks }));
  assert.ok(has(findings, 'pin', 'alpha'), `no pin finding for alpha: ${JSON.stringify(findings)}`);
});

test('a git source fails the archive rule: the lock holds registry packages and release archives only (S-34-3)', (t) => {
  const blocks = goodPackages().map(block => (block.includes('name = "beta"') ? git('beta') : block));
  const findings = check(fixture(t, { blocks }));
  assert.ok(has(findings, 'archive', 'beta'), `no archive finding: ${JSON.stringify(findings)}`);
});

test('an archive that is not a polyspec release tag, has no sha256, or is of another version fails the archive rule', (t) => {
  for (const block of [
    archive('beta', { url: 'https://example.com/beta-1.0.0.tar.gz' }),
    archive('beta', { hash: null }),
    archive('beta', { tag: 'v0.9.0' }),
  ]) {
    const blocks = goodPackages().map(item => (item.includes('name = "beta"') ? block : item));
    const findings = check(fixture(t, { blocks }));
    assert.ok(has(findings, 'archive', 'beta'), `no archive finding for ${block}: ${JSON.stringify(findings)}`);
  }
});

test('a release archive whose tag differs from the tag of pyproject.toml fails the tag rule', (t) => {
  const pyproject = PYPROJECT.replace('archive/refs/tags/v1.0.0.tar.gz', 'archive/refs/tags/v0.9.0.tar.gz');
  const findings = check(fixture(t, { pyproject }));
  assert.ok(has(findings, 'tag', 'beta'), `no tag finding: ${JSON.stringify(findings)}`);
});

test('a runtime dependency of pyproject.toml that the lock does not hold fails the current rule', (t) => {
  const pyproject = PYPROJECT.replace('    "beta @', '    "delta==3.0.0",\n    "beta @');
  const findings = check(fixture(t, { pyproject }));
  assert.ok(has(findings, 'current', 'delta'), `no current finding: ${JSON.stringify(findings)}`);
});

test('a dependency of a locked package that the lock does not hold fails the closure rule', (t) => {
  const blocks = goodPackages().map(block => (block.includes('name = "alpha"') ? registry('alpha', '1.0.0', { deps: ['gamma', 'omega'] }) : block));
  const findings = check(fixture(t, { blocks }));
  assert.ok(has(findings, 'closure', 'omega'), `no closure finding: ${JSON.stringify(findings)}`);
});

test('a missing uv.lock fails the lock rule', (t) => {
  const findings = check(fixture(t, { lock: null }));
  assert.ok(findings.some(finding => finding.rule === 'lock'), `no lock finding: ${JSON.stringify(findings)}`);
});

test('the command prints each finding and exits 1, and exits 0 on the committed lock', (t) => {
  const dir = fixture(t, { blocks: goodPackages().map(block => (block.includes('name = "gamma"') ? registry('gamma', '2.0.0', { hashes: [null, null] }) : block)) });
  const failed = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  assert.match(failed.stderr, /\[python-lock\] .*uv\.lock gamma:/);
  const passed = spawnSync(process.execPath, [SCRIPT, COMMITTED], { encoding: 'utf8' });
  assert.equal(passed.status, 0, passed.stdout + passed.stderr);
});

// The export rule (S-34-2): the committed pylock.toml is the body of a fresh `uv export --format pylock.toml --frozen
// --no-emit-project`. The header comment names the command and its flags, so only the body is compared.
test('a pylock.toml whose body differs from a fresh export fails the export rule', (t) => {
  const dir = fixture(t, {});
  writeFileSync(path.join(dir, 'pylock.toml'), '# header\nlock-version = "1.0"\n# stale\n');
  const findings = checkExport(dir, () => '# header\nlock-version = "1.0"\nrequires-python = ">=3.11"\n');
  assert.ok(findings.some(finding => finding.rule === 'export'), `no export finding: ${JSON.stringify(findings)}`);
});

test('a pylock.toml whose body equals a fresh export passes, whatever its header says', (t) => {
  const dir = fixture(t, {});
  writeFileSync(path.join(dir, 'pylock.toml'), '# another header\nlock-version = "1.0"\n');
  assert.deepEqual(checkExport(dir, () => '# header\nlock-version = "1.0"\n'), []);
});

test('a missing pylock.toml fails the export rule', (t) => {
  const findings = checkExport(fixture(t, {}), () => 'lock-version = "1.0"\n');
  assert.ok(findings.some(finding => finding.rule === 'export'), `no export finding: ${JSON.stringify(findings)}`);
});

test('the committed pylock.toml equals a fresh uv export of uv.lock', () => {
  assert.deepEqual(checkExport(COMMITTED), []);
});
