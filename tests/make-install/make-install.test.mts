// Tests of the package dependencies of the root Makefile (docs/plans/fsm-v1/checklist.md, S-29; docs/plans/fsm-v1/plan.md,
// Verification): a target that needs a package dependency installs it first, once, and a later run with the dependency
// present installs nothing. The tests run `make -n` on a copy of the Makefile, the kit targets of the installed
// @polyspec/kit and config/parity.json (the kinds) in a temporary directory, with the lock or manifest
// of each dependency and, per case, the installed stamps. No dependency is installed and no network is used: make only prints the recipes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, utimesSync } from 'node:fs';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { put, tree } from '../support/tree.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// The lock or manifest that each dependency is keyed on: an empty file in the copy.
const LOCKS = [
  'packages/js/package-lock.json',
  'packages/db/package-lock.json',
  'packages/gui/package-lock.json',
  'docs/package-lock.json',
  'packages/php/composer.lock',
  'packages/php/composer.json',
  'packages/php-ext/composer.lock',
  'packages/php-ext/composer.json',
  // The release zips of the Composer artifact repository (S-44-8, S-44-8-1): both Composer packages are keyed on their pins
  // in config/release-assets.json too.
  'config/release-assets.json',
  'packages/python/pylock.toml',
  'packages/python/pyproject.toml',
  'packages/go/go.sum',
  'packages/rust/Cargo.lock',
];

// The Playwright version that packages/gui pins (its devDependency, exact) and the browser stamp keyed on it (S-29-1).
const PLAYWRIGHT = '1.64.0';
const BROWSER = `var/deps/playwright-${PLAYWRIGHT}`;

// The stamps that an installed dependency leaves, each newer than its lock. var/tools/mise/shims/python3 is the shim of the
// Python that install-tools installs with mise (S-41, kit K127), which the Python environment depends on.
const STAMPS = [
  'packages/js/node_modules/.package-lock.json',
  'packages/db/node_modules/.package-lock.json',
  'packages/gui/node_modules/.package-lock.json',
  'docs/node_modules/.package-lock.json',
  'packages/php/vendor/composer/installed.json',
  'packages/php-ext/vendor/composer/installed.json',
  'packages/python/.venv/.installed',
  'var/deps/go',
  'var/deps/rust',
];

// The install line that make prints for each dependency (its recipe as make -n shows it).
const INSTALL: ReadonlyMap<string, RegExp> = new Map([
  ['npm', /fsm-js-install/],
  ['db', /cd packages\/db && .*npm ci/],
  ['gui', /cd packages\/gui && .*npm ci/],
  ['docs', /cd docs && .*npm ci/],
  ['php', /fsm-php-install/],
  ['php-ext', /fsm-php-ext-install/],
  ['python', /fsm-python-install/],
  ['go', /fsm-go-install/],
  ['rust', /fsm-rust-install/],
]);

/** The install line of the dependency `name`, which INSTALL must declare. */
function installLine(name: string): RegExp {
  const pattern = INSTALL.get(name);
  if (pattern === undefined) throw new Error(`INSTALL declares no install line for the dependency ${name}`);
  return pattern;
}

// The recipe line of each target that uses dependencies, and the dependencies it needs.
const TARGETS = [
  { target: 'npm-types', line: /npm-types\.json/, needs: ['npm'] },
  { target: 'fsm-js-test', line: /--results \.results\/npm\.json/, needs: ['npm'] },
  { target: 'test-go', line: /go --cwd packages\/go/, needs: ['go'] },
  { target: 'test-php', line: /phpunit --cwd packages\/php --results/, needs: ['php'] },
  { target: 'test-php-ext', line: /phpunit --php-extension/, needs: ['php-ext'] },
  { target: 'test-python', line: /run-tests\.mjs python --venv/, needs: ['python'] },
  { target: 'test-rust', line: /--results \.results\/rust\.json/, needs: ['rust'] },
  { target: 'gen-check', line: /scripts\/gen-check\.mts/, needs: ['npm', 'go', 'php', 'php-ext', 'python'] },
  { target: 'db-test', line: /db-test\.json/, needs: ['db'] },
  { target: 'gui-test', line: /gui-test\.json/, needs: ['gui', 'db'] },
  { target: 'docs-build', line: /vitepress\.js build/, needs: ['docs'] },
  { target: 'docs-build-test', line: /docs-build-test\.json/, needs: ['docs'] },
];

// The kind whose generated files each target of TARGETS reads: no checkout tracks them, so the target generates them first
// (AGENTS.md, Generated files).
const GENERATES: ReadonlyMap<string, string> = new Map([
  ['npm-types', 'npm'],
  ['fsm-js-test', 'npm'],
  ['test-go', 'go'],
  ['test-php', 'php'],
  ['test-php-ext', 'php-ext'],
  ['test-python', 'python'],
  ['test-rust', 'rust'],
]);

/** The line of the fsm-gen call that writes the src of the kind `kind`. */
function genLine(kind: string): RegExp {
  return new RegExp(`fsm-gen\\.mjs gen --project contracts --kind ${kind}( |$)`);
}

const ALL = [...INSTALL.keys()];

/** A copy of the Makefile and of the files it reads, with empty locks; `installed` adds the stamps, each newer than its lock. */
function sandbox(t: TestContext, { installed = false }: { installed?: boolean } = {}): string {
  const dir = tree(t, {});
  for (const file of ['Makefile', 'scripts/kit/kit-bootstrap.mk', 'node_modules/@polyspec/kit/dist/kit.mk', 'config/parity.json']) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    copyFileSync(path.join(ROOT, file), path.join(dir, file));
  }
  put(dir, Object.fromEntries(LOCKS.map(file => [file, '\n'])));
  // The GUI lock names the pinned Playwright version, which keys the browser stamp (S-29-1).
  put(dir, { 'packages/gui/package-lock.json': JSON.stringify({ packages: { 'node_modules/playwright': { version: PLAYWRIGHT } } }) });
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
function dryRun(dir: string, goal: string): string {
  const env = { ...process.env };
  delete env.MAKEFLAGS;
  delete env.MAKELEVEL;
  delete env.MFLAGS;
  const result = spawnSync('make', ['-n', ...goal.split(' ')], { cwd: dir, encoding: 'utf8', env });
  assert.equal(result.status, 0, `make -n ${goal} failed:\n${result.stdout}${result.stderr}`);
  return result.stdout;
}

/** The index of the first line of `output` that matches `pattern`, or -1. */
function lineIndex(output: string, pattern: RegExp): number {
  return output.split('\n').findIndex(line => pattern.test(line));
}

/** The targets of the full-run line of `make -n check`, which must print it. */
function checkTargets(stdout: string): string[] {
  const line = stdout.split('\n').find((candidate) => candidate.includes('full-run.mjs run'));
  if (line === undefined) throw new Error(`make -n check printed no full-run line:\n${stdout}`);
  return line.split(/\s+/);
}

test('npm-types installs the npm dependencies before its test', (t) => {
  const out = dryRun(sandbox(t), 'npm-types');
  const install = lineIndex(out, installLine('npm'));
  const run = lineIndex(out, /npm-types\.json/);
  assert.ok(install >= 0, `no install of the npm dependencies:\n${out}`);
  assert.ok(install < run, `the install comes after the test:\n${out}`);
});

test('gen-check installs the dependencies that generate the packages before it runs', (t) => {
  const out = dryRun(sandbox(t), 'gen-check');
  const run = lineIndex(out, /scripts\/gen-check\.mts/);
  for (const kind of ['npm', 'go', 'php', 'php-ext', 'python']) {
    const install = lineIndex(out, installLine(kind));
    assert.ok(install >= 0 && install < run, `no install of ${kind} before gen-check:\n${out}`);
  }
});

test('packages-test installs the dependencies of every kind', (t) => {
  const out = dryRun(sandbox(t), 'packages-test');
  for (const kind of ['npm', 'go', 'php', 'php-ext', 'python', 'rust']) {
    assert.ok(lineIndex(out, installLine(kind)) >= 0, `no install of ${kind} in packages-test:\n${out}`);
  }
});

test('the composer vendor is keyed on composer.json too: its autoload is not in composer.lock (S-29-2)', (t) => {
  for (const kind of ['php', 'php-ext']) {
    const dir = sandbox(t, { installed: true });
    const now = Date.now() / 1000;
    assert.equal(lineIndex(dryRun(dir, `test-${kind}`), installLine(kind)), -1, `an installed ${kind} vendor installs again`);
    utimesSync(path.join(dir, `packages/${kind}/composer.json`), now + 60, now + 60);
    assert.ok(lineIndex(dryRun(dir, `test-${kind}`), installLine(kind)) >= 0, `a newer composer.json of ${kind} does not install its vendor again`);
  }
});

test('the Composer packages fetch the release zips of config/release-assets.json before composer install (S-44-8-1)', (t) => {
  for (const kind of ['php', 'php-ext']) {
    const dir = sandbox(t, { installed: true });
    const now = Date.now() / 1000;
    utimesSync(path.join(dir, 'config/release-assets.json'), now + 60, now + 60);
    const out = dryRun(dir, `test-${kind}`);
    const fetch = lineIndex(out, /release-assets\.mjs fetch/);
    const install = lineIndex(out, /composer install/);
    assert.ok(lineIndex(out, installLine(kind)) >= 0, `a newer config/release-assets.json does not install the ${kind} vendor again:\n${out}`);
    assert.ok(fetch >= 0 && fetch < install, `no make release-assets-fetch before the composer install of ${kind}:\n${out}`);
  }
});

test('the python environment is keyed on pylock.toml: a newer lock installs it again, a newer manifest alone does not', (t) => {
  const dir = sandbox(t, { installed: true });
  const now = Date.now() / 1000;
  put(dir, { 'packages/python/pyproject.toml': '\n' });
  utimesSync(path.join(dir, 'packages/python/pyproject.toml'), now + 60, now + 60);
  assert.equal(lineIndex(dryRun(dir, 'test-python'), installLine('python')), -1, 'pyproject.toml alone reinstalls the python environment');
  utimesSync(path.join(dir, 'packages/python/pylock.toml'), now + 120, now + 120);
  assert.ok(lineIndex(dryRun(dir, 'test-python'), installLine('python')) >= 0, 'a newer pylock.toml does not reinstall the python environment');
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
  const install = lineIndex(out, installLine('python'));
  assert.ok(interpreter >= 0 && interpreter < install, `no install-tools before the python install:\n${out}`);
});

test('install builds every dependency and the toolchains', (t) => {
  const out = dryRun(sandbox(t), 'install');
  for (const name of ALL) assert.ok(lineIndex(out, installLine(name)) >= 0, `install does not install ${name}:\n${out}`);
  assert.ok(lineIndex(out, /install-tools\.mjs/) >= 0, `install does not install the toolchains:\n${out}`);
});

test('the targets with a dependency present run no install', (t) => {
  const dir = sandbox(t, { installed: true });
  for (const name of ALL) {
    const out = dryRun(dir, 'install');
    assert.equal(lineIndex(out, installLine(name)), -1, `${name} is installed again:\n${out}`);
  }
  for (const { target, line, needs } of TARGETS) {
    const out = dryRun(dir, target);
    assert.ok(lineIndex(out, line) >= 0, `${target} does not run its recipe:\n${out}`);
    for (const name of needs) assert.equal(lineIndex(out, installLine(name)), -1, `${target} installs ${name} again:\n${out}`);
  }
});

test('each target installs its dependencies before its recipe', (t) => {
  const dir = sandbox(t);
  for (const { target, line, needs } of TARGETS) {
    const out = dryRun(dir, target);
    const run = lineIndex(out, line);
    assert.ok(run >= 0, `${target} does not run its recipe:\n${out}`);
    for (const name of needs) {
      const install = lineIndex(out, installLine(name));
      assert.ok(install >= 0 && install < run, `${target} does not install ${name} before its recipe:\n${out}`);
    }
  }
});

test('each target generates the files of its kind after the install and before its recipe', (t) => {
  const dir = sandbox(t);
  for (const [target, kind] of GENERATES) {
    const entry = TARGETS.find(candidate => candidate.target === target);
    assert.ok(entry !== undefined, `TARGETS has no ${target}`);
    const out = dryRun(dir, target);
    const run = lineIndex(out, entry.line);
    const gen = lineIndex(out, genLine(kind));
    assert.ok(gen >= 0 && gen < run, `${target} does not generate the ${kind} files before its recipe:\n${out}`);
    for (const name of entry.needs) assert.ok(lineIndex(out, installLine(name)) < gen, `${target} generates the ${kind} files before the install of ${name}:\n${out}`);
  }
});

test('the gates that read generated files generate the files of every kind first', (t) => {
  const dir = sandbox(t);
  for (const gate of ['layout-check', 'parity-declarations-check', 'parity-check UNITS=vectors']) {
    const out = dryRun(dir, gate);
    for (const kind of ['go', 'npm', 'php', 'php-ext', 'python', 'rust']) assert.ok(lineIndex(out, genLine(kind)) >= 0, `${gate} does not generate the ${kind} files:\n${out}`);
  }
});

// `make -n check` evaluates the Makefile and the kit targets it includes and prints the recipes without running them. A make
// warning on its stderr is a name that two definitions share (for example a repository target that replaces a kit target), so
// the test fails on any warning line (docs/plans/fsm-v1/plan.md, C-1; docs/plans/fsm-v1/checklist.md, S-35-2).
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
  const targets = checkTargets(result.stdout);
  for (const target of ['parity-declarations-check', 'parity-check']) assert.ok(targets.includes(target), `CHECK_TARGETS does not run ${target}`);
});

// The full suite runs kit's lint of the TypeScript (oxlint and knip with config/knip-entries.json), which stayed out of
// CHECK_TARGETS until it passed (S-44-15).
test('make check runs make lint-ts (S-44-15)', () => {
  const result = spawnSync('make', ['-n', 'check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const targets = checkTargets(result.stdout);
  assert.ok(targets.includes('lint-ts'), 'CHECK_TARGETS does not run lint-ts');
});
