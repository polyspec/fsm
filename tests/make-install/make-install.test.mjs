// Tests of the package dependencies of the root Makefile (docs/plans/execution-checklist.md, S-29; docs/plans/fsm-v1.md,
// Verification): a target that needs a package dependency installs it first, once, and a later run with the dependency
// present installs nothing. The tests run `make -n` on a copy of the Makefile, the kit targets of the installed
// @polyspec/kit, config/parity.json (the kinds) and the package Makefiles in a temporary directory, with the lock or manifest
// of each dependency and, per case, the installed stamps. No dependency is installed and no network is used: make only prints the recipes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, utimesSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { put, tree } from '../support/tree.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// The lock or manifest that each dependency is keyed on: an empty file in the copy.
const LOCKS = [
  'packages/fsm-npm/package-lock.json',
  'packages/fsm-db/package-lock.json',
  'packages/fsm-gui/package-lock.json',
  'docs/package-lock.json',
  'packages/fsm-php/composer.lock',
  'packages/fsm-php/composer.json',
  'packages/fsm-php-ext/composer.lock',
  'packages/fsm-php-ext/composer.json',
  // The zips of the Composer artifact repositories (S-44-8): both Composer packages are keyed on their pins too.
  'config/composer-artifacts.txt',
  'packages/fsm-python/pylock.toml',
  'packages/fsm-python/pyproject.toml',
  'packages/fsm-go/go.sum',
  'packages/fsm-rust/Cargo.lock',
];

// The Playwright version that packages/fsm-gui pins (its devDependency, exact) and the browser stamp keyed on it (S-29-1).
const PLAYWRIGHT = '1.64.0';
const BROWSER = `var/deps/playwright-${PLAYWRIGHT}`;

// The stamps that an installed dependency leaves, each newer than its lock. var/tools/mise/shims/python3 is the shim of the
// Python that install-tools installs with mise (S-41, kit K127), which the Python environment depends on.
const STAMPS = [
  'packages/fsm-npm/node_modules/.package-lock.json',
  'packages/fsm-db/node_modules/.package-lock.json',
  'packages/fsm-gui/node_modules/.package-lock.json',
  'docs/node_modules/.package-lock.json',
  'packages/fsm-php/vendor/composer/installed.json',
  'packages/fsm-php-ext/vendor/composer/installed.json',
  'packages/fsm-python/.venv/.installed',
  'var/deps/go',
  'var/deps/rust',
];

// The install line that make prints for each dependency (its recipe as make -n shows it).
const INSTALL = {
  npm: /-C packages\/fsm-npm install/,
  db: /cd packages\/fsm-db && .*npm ci/,
  gui: /cd packages\/fsm-gui && .*npm ci/,
  docs: /cd docs && .*npm ci/,
  php: /-C packages\/fsm-php install/,
  'php-ext': /-C packages\/fsm-php-ext install/,
  python: /-C packages\/fsm-python install/,
  go: /-C packages\/fsm-go install/,
  rust: /-C packages\/fsm-rust install/,
};

// The recipe line of each target that uses dependencies, and the dependencies it needs.
const TARGETS = [
  { target: 'npm-types', line: /npm-types\.json/, needs: ['npm'] },
  { target: 'test-npm', line: /-C packages\/fsm-npm test/, needs: ['npm'] },
  { target: 'test-go', line: /-C packages\/fsm-go test/, needs: ['go'] },
  { target: 'test-php', line: /-C packages\/fsm-php test/, needs: ['php'] },
  { target: 'test-php-ext', line: /-C packages\/fsm-php-ext test/, needs: ['php-ext'] },
  { target: 'test-python', line: /-C packages\/fsm-python test/, needs: ['python'] },
  { target: 'test-rust', line: /-C packages\/fsm-rust test/, needs: ['rust'] },
  { target: 'gen-check', line: /scripts\/gen-check\.mjs/, needs: ['npm', 'go', 'php', 'php-ext', 'python'] },
  { target: 'db-test', line: /db-test\.json/, needs: ['db'] },
  { target: 'gui-test', line: /gui-test\.json/, needs: ['gui', 'db'] },
  { target: 'docs-build', line: /vitepress\.js build/, needs: ['docs'] },
  { target: 'docs-build-test', line: /docs-build-test\.json/, needs: ['docs'] },
];

const ALL = Object.keys(INSTALL);

/** A copy of the Makefile and of the files it reads, with empty locks; `installed` adds the stamps, each newer than its lock. */
function sandbox(t, { installed = false } = {}) {
  const dir = tree(t, {});
  for (const file of ['Makefile', 'scripts/kit/kit-bootstrap.mk', 'node_modules/@polyspec/kit/dist/kit.mk', 'config/parity.json']) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    copyFileSync(path.join(ROOT, file), path.join(dir, file));
  }
  for (const kind of readdirSync(path.join(ROOT, 'packages'))) {
    const makefile = path.join(ROOT, 'packages', kind, 'Makefile');
    if (existsSync(makefile)) put(dir, { [`packages/${kind}/Makefile`]: readFileSync(makefile, 'utf8') });
  }
  put(dir, Object.fromEntries(LOCKS.map(file => [file, '\n'])));
  // The GUI lock names the pinned Playwright version, which keys the browser stamp (S-29-1).
  put(dir, { 'packages/fsm-gui/package-lock.json': JSON.stringify({ packages: { 'node_modules/playwright': { version: PLAYWRIGHT } } }) });
  const now = Date.now() / 1000;
  const old = now - 3600;
  for (const file of LOCKS) utimesSync(path.join(dir, file), old, old);
  if (installed) {
    put(dir, Object.fromEntries(STAMPS.map(file => [file, '\n'])));
    put(dir, { 'var/tools/mise/shims/python3': '\n' });
    utimesSync(path.join(dir, 'var/tools/mise/shims/python3'), now - 1800, now - 1800);
    for (const file of STAMPS) utimesSync(path.join(dir, file), now, now);
  }
  return dir;
}

/** The output of `make -n <goal>` in dir, with no inherited make flags. Every recipe line is printed and no recipe runs. */
function dryRun(dir, goal) {
  const env = { ...process.env };
  delete env.MAKEFLAGS;
  delete env.MAKELEVEL;
  delete env.MFLAGS;
  const result = spawnSync('make', ['-n', goal], { cwd: dir, encoding: 'utf8', env });
  assert.equal(result.status, 0, `make -n ${goal} failed:\n${result.stdout}${result.stderr}`);
  return result.stdout;
}

/** The index of the first line of `output` that matches `pattern`, or -1. */
function lineIndex(output, pattern) {
  return output.split('\n').findIndex(line => pattern.test(line));
}

test('npm-types installs the npm dependencies before its test', (t) => {
  const out = dryRun(sandbox(t), 'npm-types');
  const install = lineIndex(out, INSTALL.npm);
  const run = lineIndex(out, /npm-types\.json/);
  assert.ok(install >= 0, `no install of the npm dependencies:\n${out}`);
  assert.ok(install < run, `the install comes after the test:\n${out}`);
});

test('gen-check installs the dependencies that generate the packages before it runs', (t) => {
  const out = dryRun(sandbox(t), 'gen-check');
  const run = lineIndex(out, /scripts\/gen-check\.mjs/);
  for (const kind of ['npm', 'go', 'php', 'php-ext', 'python']) {
    const install = lineIndex(out, INSTALL[kind]);
    assert.ok(install >= 0 && install < run, `no install of ${kind} before gen-check:\n${out}`);
  }
});

test('packages-test installs the dependencies of every kind', (t) => {
  const out = dryRun(sandbox(t), 'packages-test');
  for (const kind of ['npm', 'go', 'php', 'php-ext', 'python', 'rust']) {
    assert.ok(lineIndex(out, INSTALL[kind]) >= 0, `no install of ${kind} in packages-test:\n${out}`);
  }
});

test('the composer vendor is keyed on composer.json too: its autoload is not in composer.lock (S-29-2)', (t) => {
  for (const kind of ['php', 'php-ext']) {
    const dir = sandbox(t, { installed: true });
    const now = Date.now() / 1000;
    assert.equal(lineIndex(dryRun(dir, `test-${kind}`), INSTALL[kind]), -1, `an installed ${kind} vendor installs again`);
    utimesSync(path.join(dir, `packages/fsm-${kind}/composer.json`), now + 60, now + 60);
    assert.ok(lineIndex(dryRun(dir, `test-${kind}`), INSTALL[kind]) >= 0, `a newer composer.json of ${kind} does not install its vendor again`);
  }
});

test('the python environment is keyed on pylock.toml: a newer lock installs it again, a newer manifest alone does not', (t) => {
  const dir = sandbox(t, { installed: true });
  const now = Date.now() / 1000;
  put(dir, { 'packages/fsm-python/pyproject.toml': '\n' });
  utimesSync(path.join(dir, 'packages/fsm-python/pyproject.toml'), now + 60, now + 60);
  assert.equal(lineIndex(dryRun(dir, 'test-python'), INSTALL.python), -1, 'pyproject.toml alone reinstalls the python environment');
  utimesSync(path.join(dir, 'packages/fsm-python/pylock.toml'), now + 120, now + 120);
  assert.ok(lineIndex(dryRun(dir, 'test-python'), INSTALL.python) >= 0, 'a newer pylock.toml does not reinstall the python environment');
});

test('gui-browser-test downloads the browser once, then needs no network', (t) => {
  const dir = sandbox(t, { installed: true });
  const download = /playwright install chromium/;
  assert.ok(lineIndex(dryRun(dir, 'gui-browser-test'), download) >= 0, 'the browser is not downloaded when no stamp exists');
  put(dir, { [BROWSER]: '\n' });
  const out = dryRun(dir, 'gui-browser-test');
  assert.equal(lineIndex(out, download), -1, `the browser is downloaded again with its stamp present:\n${out}`);
  assert.ok(lineIndex(out, /browser\.test\.mjs/) >= 0, `gui-browser-test does not run its tests:\n${out}`);
});

test('the python environment is created with the Python 3.14 of install-tools', (t) => {
  const out = dryRun(sandbox(t), 'test-python');
  // install-tools takes no tool names: it installs every tool of mise.lock, the Python among them (kit K127).
  const interpreter = lineIndex(out, /install-tools\.mjs\s*$/);
  const install = lineIndex(out, INSTALL.python);
  assert.ok(interpreter >= 0 && interpreter < install, `no install-tools before the python install:\n${out}`);
});

test('install builds every dependency and the toolchains', (t) => {
  const out = dryRun(sandbox(t), 'install');
  for (const name of ALL) assert.ok(lineIndex(out, INSTALL[name]) >= 0, `install does not install ${name}:\n${out}`);
  assert.ok(lineIndex(out, /install-tools\.mjs/) >= 0, `install does not install the toolchains:\n${out}`);
});

test('the targets with a dependency present run no install', (t) => {
  const dir = sandbox(t, { installed: true });
  for (const name of ALL) {
    const out = dryRun(dir, 'install');
    assert.equal(lineIndex(out, INSTALL[name]), -1, `${name} is installed again:\n${out}`);
  }
  for (const { target, line, needs } of TARGETS) {
    const out = dryRun(dir, target);
    assert.ok(lineIndex(out, line) >= 0, `${target} does not run its recipe:\n${out}`);
    for (const name of needs) assert.equal(lineIndex(out, INSTALL[name]), -1, `${target} installs ${name} again:\n${out}`);
  }
});

test('each target installs its dependencies before its recipe', (t) => {
  const dir = sandbox(t);
  for (const { target, line, needs } of TARGETS) {
    const out = dryRun(dir, target);
    const run = lineIndex(out, line);
    assert.ok(run >= 0, `${target} does not run its recipe:\n${out}`);
    for (const name of needs) {
      const install = lineIndex(out, INSTALL[name]);
      assert.ok(install >= 0 && install < run, `${target} does not install ${name} before its recipe:\n${out}`);
    }
  }
});

// `make -n check` evaluates the Makefile and the kit targets it includes and prints the recipes without running them. A make
// warning on its stderr is a name that two definitions share (for example a repository target that replaces a kit target), so
// the test fails on any warning line (docs/plans/fsm-v1.md, C-1; docs/plans/execution-checklist.md, S-35-2).
test('make -n check prints no make warning: no target of the repository replaces a kit target (S-35-2)', () => {
  const result = spawnSync('make', ['-n', 'check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const warnings = result.stderr.split('\n').filter((line) => line.includes('warning:'));
  assert.deepEqual(warnings, []);
});

// The full suite runs kit's parity check (K33: parity-declarations-check and parity-check, config/parity.json), which runs
// every binding and checks the vector cases (S-42-1). A rebase once dropped the parity target of the suite, with no make warning
// (S-35-3).
test('make check runs the parity check of kit (S-35-3, S-42-1)', () => {
  const result = spawnSync('make', ['-n', 'check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const targets = result.stdout.split('\n').find((line) => line.includes('full-run.mjs run')).split(/\s+/);
  for (const target of ['parity-declarations-check', 'parity-check']) assert.ok(targets.includes(target), `CHECK_TARGETS does not run ${target}`);
});
