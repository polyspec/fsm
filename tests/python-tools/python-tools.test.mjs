// Tests of the Python of the checkout (docs/plans/execution-checklist.md, S-41; docs/plans/fsm-v1.md, C-1 and Verification).
// The Python 3.14 of the python package comes from `make install-tools`: the kit installs the uv of config/toolchain.json and
// then, with that uv, the pythonBuild into var/tools (var/tools/bin/python3). No recipe of fsm installs an interpreter, and the
// Makefile has no install-python target. The tests run `make -n` on a copy of the Makefile, the kit targets of the installed
// @polyspec/kit, config/parity.json (the kinds) and the package Makefiles in a temporary directory: make only prints the
// recipes, so no network is used and nothing is installed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { put, tree } from '../support/tree.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PYTHON_BIN = 'var/tools/bin/python3';
const INSTALL_TOOLS_PYTHON = /install-tools\.mjs python/;
const UV_INTERPRETER = /uv python/;

// The lock or manifest that each package dependency is keyed on: an empty file in the copy (make -n reads none of them).
const LOCKS = [
  'packages/fsm-npm/package-lock.json',
  'packages/fsm-db/package-lock.json',
  'packages/fsm-gui/package-lock.json',
  'docs/package-lock.json',
  'packages/fsm-php/composer.lock',
  'packages/fsm-php/composer.json',
  'packages/fsm-php-ext/composer.lock',
  'packages/fsm-php-ext/composer.json',
  'packages/fsm-python/pylock.toml',
  'packages/fsm-python/pyproject.toml',
  'packages/fsm-go/go.sum',
  'packages/fsm-rust/Cargo.lock',
];

/** A copy of the Makefile and of the files that it reads, without any installed dependency. */
function sandbox(t) {
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
  return dir;
}

/** The environment of a make run, with no inherited make flags. */
function cleanEnv() {
  const env = { ...process.env };
  delete env.MAKEFLAGS;
  delete env.MAKELEVEL;
  delete env.MFLAGS;
  return env;
}

/** The result of `make -n <goal>` in dir, with no inherited make flags. */
function dryRun(dir, goal) {
  return spawnSync('make', ['-n', goal], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
}

/** The output of `make -n <goal>`, which must succeed. */
function printed(dir, goal) {
  const result = dryRun(dir, goal);
  assert.equal(result.status, 0, `make -n ${goal} failed:\n${result.stdout}${result.stderr}`);
  return result.stdout;
}

/** The index of the first line of `output` that matches `pattern`, or -1. */
function lineIndex(output, pattern) {
  return output.split('\n').findIndex(line => pattern.test(line));
}

test('the interpreter var/tools/bin/python3 is made by install-tools, never by uv', (t) => {
  const out = printed(sandbox(t), PYTHON_BIN);
  assert.ok(lineIndex(out, INSTALL_TOOLS_PYTHON) >= 0, `var/tools/bin/python3 is not made by install-tools python:\n${out}`);
  assert.equal(lineIndex(out, UV_INTERPRETER), -1, `var/tools/bin/python3 is made with uv:\n${out}`);
});

test('make install prints no uv interpreter install and runs install-tools', (t) => {
  const out = printed(sandbox(t), 'install');
  assert.equal(lineIndex(out, UV_INTERPRETER), -1, `make install installs an interpreter with uv:\n${out}`);
  assert.ok(lineIndex(out, /install-tools\.mjs/) >= 0, `make install does not run install-tools:\n${out}`);
});

test('the python package environment follows the install-tools interpreter', (t) => {
  const out = printed(sandbox(t), 'test-python');
  const interpreter = lineIndex(out, INSTALL_TOOLS_PYTHON);
  const venv = lineIndex(out, /-C packages\/fsm-python install/);
  assert.ok(interpreter >= 0 && venv > interpreter, `the python environment does not follow install-tools python:\n${out}`);
  assert.equal(lineIndex(out, UV_INTERPRETER), -1, `test-python installs an interpreter with uv:\n${out}`);
});

test('there is no install-python target, so no uv-installed interpreter remains as an alias', (t) => {
  const result = dryRun(sandbox(t), 'install-python');
  assert.notEqual(result.status, 0, `install-python still exists and prints:\n${result.stdout}`);
});

test('the Makefile holds no uv python install and no link of a uv interpreter', () => {
  const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  assert.doesNotMatch(makefile, /python install --no-bin/);
  assert.doesNotMatch(makefile, /python find --managed-python/);
});

test('the interpreter is installed after the uv of config/toolchain.json, which installs it (S-44-2)', (t) => {
  const out = printed(sandbox(t), PYTHON_BIN);
  const uv = lineIndex(out, /install-tools\.mjs uv$/);
  assert.ok(uv >= 0 && lineIndex(out, INSTALL_TOOLS_PYTHON) > uv, `var/tools/bin/python3 is not installed after install-tools uv:\n${out}`);
});

test('the python package runs the uv of var/tools, never a uv of PATH (S-44-2)', () => {
  assert.match(makefileOf('packages/fsm-python'), /^UV := \$\(abspath \$\(ROOT\)\)\/var\/tools\/bin\/uv$/m);
});

// The package venv is made by kit's python-venv (uv venv) and accepted by kit's runner; kit tests both itself (S-44).
const PACKAGE = path.join(ROOT, 'packages/fsm-python');

test('make -n install of the package makes the venv with the kit python-venv, never with -m venv (S-41-1, kit K44)', (t) => {
  const dir = sandbox(t);
  const result = spawnSync('make', ['-n', 'install'], { cwd: path.join(dir, 'packages/fsm-python'), encoding: 'utf8', env: cleanEnv() });
  assert.equal(result.status, 0, `make -n install failed:\n${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /python-venv DIR=packages\/fsm-python\/\.venv|python-venv\.mjs packages\/fsm-python\/\.venv/, `install does not call the kit python-venv:\n${result.stdout}`);
  assert.doesNotMatch(result.stdout, /-m venv/, `install runs -m venv itself:\n${result.stdout}`);
});

test('the package Makefile installs pylock.toml, which kit's python-lock writes, and writes no lock of its own (S-44)', () => {
  const makefile = readFileSync(path.join(PACKAGE, 'Makefile'), 'utf8');
  assert.match(makefile, /\$\(UV\) pip install --python \$\(VENV\)\/bin\/python --link-mode copy -r \$\(PYLOCK\)/);
  assert.doesNotMatch(makefile, /\$\(UV\) (export|lock)\b/, 'the package Makefile writes or checks a lock itself; kit's python-lock does');
  assert.doesNotMatch(makefile, /-m venv/, 'the package Makefile runs -m venv itself; the kit python-venv makes the venv');
  assert.match(makefile, /python-venv DIR=packages\/fsm-python\/\.venv/);
  assert.match(makefile, /--link-mode copy/);
  const recipes = makefile.split('\n').filter(line => !line.startsWith('#')).join('\n');
  assert.doesNotMatch(recipes, /(^|[^$(\w])uv (venv|sync)\b/m, 'a recipe runs uv venv or uv sync');
});

test('test-python runs the runner with --venv and no PATH entry for the venv', (t) => {
  const out = printed(sandbox(t), 'test-python');
  assert.match(out, /run-tests\.mjs python --venv /, 'test-python does not pass --venv to the runner');
  assert.doesNotMatch(makefileOf('packages/fsm-python'), /PATH=\$\(CURDIR\)\/\$\(VENV\)/);
  assert.doesNotMatch(readFileSync(path.join(ROOT, 'Makefile'), 'utf8'), /PATH=\$\(CURDIR\)\/packages\/fsm-python/);
});

/** The Makefile text of the package directory relative to the checkout root. */
function makefileOf(relative) {
  return readFileSync(path.join(ROOT, relative, 'Makefile'), 'utf8');
}
