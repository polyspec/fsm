// Tests of the package dependencies of the root Makefile (docs/plans/fsm-v1/checklist.md, S-29; docs/plans/fsm-v1/plan.md,
// Verification): a target that needs a package dependency installs it first, once, and a later run with the dependency
// present installs nothing. The tests run `make -n` on a copy of the Makefile, the kit targets of the installed
// @polyspec/kit in a temporary directory, with the lock or manifest
// of each dependency and, per case, the installed stamps. No dependency is installed and no network is used: make only prints the recipes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cleanEnv, copyMakeFiles, LOCKS, lineIndex } from '../support/make-sandbox.mts';
import { put, tree } from '../support/tree.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// The Playwright version that packages/gui pins (its devDependency, exact) and the browser stamp keyed on it (S-29-1).
const PLAYWRIGHT = '1.64.0';
const BROWSER = `var/deps/playwright-${PLAYWRIGHT}`;

// The directories whose npm install is keyed on the sha256 of its lock (S-358): the stamp is var/deps/npm/<dir>-<sha256>.
const NPM_DIRS = ['legacy/packages/js', 'legacy/packages/db', 'packages/gui', 'docs'];

/** The npm stamp of the directory `npmDir` in the sandbox `dir`, as the Makefile names it (the first 16 hex digits of the lock's sha256). */
function npmStamp(dir: string, npmDir: string): string {
  const sha = createHash('sha256').update(readFileSync(path.join(dir, npmDir, 'package-lock.json'))).digest('hex');
  return `var/deps/npm/${npmDir.replaceAll('/', '-')}-${sha.slice(0, 16)}`;
}

// The stamps that an installed dependency leaves, each newer than its lock. The npm stamps are added per sandbox by npmStamp.
// var/tools/mise/shims/python3 is the shim of the Python that install-tools installs with mise (S-41, kit K127), which the
// Python environment depends on.
const STAMPS = [
  'legacy/packages/php/vendor/composer/installed.json',
  'legacy/packages/php-ext/vendor/composer/installed.json',
  'legacy/packages/python/.venv/.installed',
  'var/deps/go',
  'var/deps/rust',
];

// The install line that make prints for each dependency (its recipe as make -n shows it).
const INSTALL: ReadonlyMap<string, RegExp> = new Map([
  ['npm', /fsm-js-install/],
  ['db', /cd legacy\/packages\/db && .*npm ci/],
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
  { target: 'legacy-test-go', line: /go --cwd legacy\/packages\/go/, needs: ['go'] },
  { target: 'legacy-test-php', line: /phpunit --cwd legacy\/packages\/php --results/, needs: ['php'] },
  { target: 'legacy-test-php-ext', line: /php-extension\.m[jt]s test/, needs: ['php-ext'] },
  { target: 'legacy-test-python', line: /run-tests\.m[jt]s python --venv/, needs: ['python'] },
  { target: 'legacy-test-rust', line: /--results \.results\/rust\.json/, needs: ['rust'] },
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
  ['legacy-test-go', 'go'],
  ['legacy-test-php', 'php'],
  ['legacy-test-php-ext', 'php-ext'],
  ['legacy-test-python', 'python'],
  ['legacy-test-rust', 'rust'],
]);

/** The line of the fsm-gen call that writes the src of the kind `kind`. */
function genLine(kind: string): RegExp {
  return new RegExp(`fsm-gen\\.mjs gen --project contracts --kind ${kind}( |$)`);
}

const ALL = [...INSTALL.keys()];

/** A copy of the Makefile and of the files it reads, with empty locks; `installed` adds the stamps, each newer than its lock. */
function sandbox(t: TestContext, { installed = false }: { installed?: boolean } = {}): string {
  const dir = copyMakeFiles(ROOT, tree(t, {}));
  put(dir, Object.fromEntries(LOCKS.map(file => [file, '\n'])));
  // The GUI lock names the pinned Playwright version, which keys the browser stamp (S-29-1).
  put(dir, { 'packages/gui/package-lock.json': JSON.stringify({ packages: { 'node_modules/playwright': { version: PLAYWRIGHT } } }) });
  const now = Date.now() / 1000;
  const old = now - 3600;
  for (const file of LOCKS) utimesSync(path.join(dir, file), old, old);
  if (installed) {
    const stamps = [...STAMPS, ...NPM_DIRS.map(npmDir => npmStamp(dir, npmDir))];
    put(dir, Object.fromEntries(stamps.map(file => [file, '\n'])));
    put(dir, { 'var/tools/mise/shims/python3': '\n' });
    utimesSync(path.join(dir, 'var/tools/mise/shims/python3'), now - 1800, now - 1800);
    for (const file of stamps) utimesSync(path.join(dir, file), now, now);
  }
  return dir;
}

/** The output of `make -n <goal>` in dir, with no inherited make flags. Every recipe line is printed and no recipe runs. */
function dryRun(dir: string, goal: string): string {
  const result = spawnSync('make', ['-n', ...goal.split(' ')], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
  assert.equal(result.status, 0, `make -n ${goal} failed:\n${result.stdout}${result.stderr}`);
  return result.stdout;
}

test('npm-types installs the npm dependencies before its test', (t) => {
  const out = dryRun(sandbox(t), 'npm-types');
  const install = lineIndex(out, installLine('npm'));
  const run = lineIndex(out, /npm-types\.json/);
  assert.ok(install >= 0, `no install of the npm dependencies:\n${out}`);
  assert.ok(install < run, `the install comes after the test:\n${out}`);
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
    assert.equal(lineIndex(dryRun(dir, `legacy-test-${kind}`), installLine(kind)), -1, `an installed ${kind} vendor installs again`);
    utimesSync(path.join(dir, `legacy/packages/${kind}/composer.json`), now + 60, now + 60);
    assert.ok(lineIndex(dryRun(dir, `legacy-test-${kind}`), installLine(kind)) >= 0, `a newer composer.json of ${kind} does not install its vendor again`);
  }
});

test('the Composer packages come from the release packages.json, so no release-assets fetch runs before composer install (K865, K871)', (t) => {
  for (const target of ['fsm-php-install', 'fsm-php-ext-install']) {
    const out = dryRun(sandbox(t), target);
    assert.ok(lineIndex(out, /composer install/) >= 0, `no composer install in ${target}:\n${out}`);
    assert.equal(lineIndex(out, /release-assets/), -1, `${target} still fetches release zips, which kit 0.0.77 removed (K865):\n${out}`);
  }
});

test('the php installs link right after composer install, so a vendor from the tracked lock never replaces the links (P30)', (t) => {
  for (const target of ['fsm-php-install', 'fsm-php-ext-install']) {
    const out = dryRun(sandbox(t), target);
    const install = lineIndex(out, /composer install/);
    const link = lineIndex(out, /(^|[ /])make\b.*\blink\b|link\.m[jt]s link/);
    assert.ok(install >= 0, `no composer install in ${target}:\n${out}`);
    assert.ok(link > install, `no make link right after the composer install of ${target}:\n${out}`);
  }
});

test('each npm install of deps-node links its project right after npm ci, so a copy from the tracked lock never replaces the links (S-366-1, P30)', (t) => {
  const lines = dryRun(sandbox(t), 'deps-node').split('\n');
  for (const npmDir of NPM_DIRS) {
    const install = lines.findIndex(line => line.includes(`cd ${npmDir} && `) && /\bnpm ci\b/.test(line));
    assert.ok(install >= 0, `no npm ci of ${npmDir} in deps-node:\n${lines.join('\n')}`);
    const next = lines.findIndex((line, index) => index > install && /\bnpm ci\b/.test(line));
    const link = lines.findIndex((line, index) => index > install && (next < 0 || index < next) && new RegExp(`link\\.m[jt]s link --project ${npmDir}( |$)`).test(line));
    assert.ok(link > install, `no link of ${npmDir} right after its npm ci in deps-node:\n${lines.join('\n')}`);
  }
});

test('an npm dependency is keyed on the content of its lock: a changed lock installs again even when its mtime is older (S-358)', (t) => {
  const dir = sandbox(t, { installed: true });
  assert.equal(lineIndex(dryRun(dir, 'npm-types'), installLine('npm')), -1, 'an installed npm dependency installs again');
  // The same lock path with other content, and an mtime older than the stamp: make by mtime alone would keep the stamp.
  writeFileSync(path.join(dir, 'legacy/packages/js/package-lock.json'), '{"changed":true}\n');
  utimesSync(path.join(dir, 'legacy/packages/js/package-lock.json'), Date.now() / 1000 - 7200, Date.now() / 1000 - 7200);
  assert.ok(lineIndex(dryRun(dir, 'npm-types'), installLine('npm')) >= 0, 'a changed npm lock does not install again');
});

test('the python environment is keyed on pylock.toml: a newer lock installs it again, a newer manifest alone does not', (t) => {
  const dir = sandbox(t, { installed: true });
  const now = Date.now() / 1000;
  put(dir, { 'legacy/packages/python/pyproject.toml': '\n' });
  utimesSync(path.join(dir, 'legacy/packages/python/pyproject.toml'), now + 60, now + 60);
  assert.equal(lineIndex(dryRun(dir, 'legacy-test-python'), installLine('python')), -1, 'pyproject.toml alone reinstalls the python environment');
  utimesSync(path.join(dir, 'legacy/packages/python/pylock.toml'), now + 120, now + 120);
  assert.ok(lineIndex(dryRun(dir, 'legacy-test-python'), installLine('python')) >= 0, 'a newer pylock.toml does not reinstall the python environment');
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

test('install builds every dependency and the toolchains', (t) => {
  const out = dryRun(sandbox(t), 'install');
  for (const name of ALL) assert.ok(lineIndex(out, installLine(name)) >= 0, `install does not install ${name}:\n${out}`);
  assert.ok(lineIndex(out, /install-tools\.m[jt]s/) >= 0, `install does not install the toolchains:\n${out}`);
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

test('the targets that read the models of legacy/packages/db generate them after the install of db and before their recipe', (t) => {
  const dir = sandbox(t);
  const targets = [
    { target: 'db-test', line: /db-test\.json/ },
    { target: 'gui-test', line: /gui-test\.json/ },
    { target: 'npm-persist-test', line: /npm-persist-test\.json/ },
  ];
  for (const { target, line } of targets) {
    const out = dryRun(dir, target);
    const run = lineIndex(out, line);
    const gen = lineIndex(out, /cd legacy\/packages\/db && .*npm run gen/);
    assert.ok(gen >= 0 && gen < run, `${target} does not generate the models of legacy/packages/db before its recipe:\n${out}`);
    assert.ok(lineIndex(out, installLine('db')) < gen, `${target} generates the models before the install of db:\n${out}`);
  }
});

test('the gate that reads generated files generates the files of every kind first', (t) => {
  const dir = sandbox(t);
  for (const gate of ['layout-check']) {
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
