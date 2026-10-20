// Tests of the Python of the checkout (docs/plans/fsm-v1/checklist.md, S-41; docs/plans/fsm-v1/plan.md, C-1 and Verification).
// The Python 3.14 of the python package comes from `make install-tools`: kit installs the tools of mise.toml with mise at the
// digests of mise.lock, Python and uv among them, and their shims are var/tools/mise/shims/python3 and uv (S-44-6, kit K127).
// No recipe of fsm installs an interpreter, and the Makefile has no install-python target. The tests run `make -n` on a copy of the
// Makefile, the kit targets of the installed @polyspec/kit and config/parity.json (the kinds) in a temporary directory: make only
// prints the recipes, so no network is used and nothing is installed. The package targets are targets of the root Makefile (K245).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cleanEnv, copyMakeFiles, lineIndex } from '../support/make-sandbox.mts';
import { put, tree } from '../support/tree.mts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PYTHON_BIN = 'var/tools/mise/shims/python3';
// The recipe of make install-tools: kit's install-tools with no TOOLS, which installs every tool of mise.lock.
const INSTALL_TOOLS = /install-tools\.mjs\s*$/;
const UV_INTERPRETER = /uv python/;

// The lock or manifest that each package dependency is keyed on: an empty file in the copy (make -n reads none of them).
const LOCKS = [
  'packages/js/package-lock.json',
  'packages/db/package-lock.json',
  'packages/gui/package-lock.json',
  'docs/package-lock.json',
  'packages/php/composer.lock',
  'packages/php/composer.json',
  'packages/php-ext/composer.lock',
  'packages/php-ext/composer.json',
  'config/release-assets.json',
  'packages/python/pylock.toml',
  'packages/python/pyproject.toml',
  'packages/go/go.sum',
  'packages/rust/Cargo.lock',
];

/** A copy of the Makefile and of the files that it reads, without any installed dependency. */
function sandbox(t: TestContext): string {
  const dir = tree(t, {});
  copyMakeFiles(ROOT, dir);
  put(dir, Object.fromEntries(LOCKS.map(file => [file, '\n'])));
  return dir;
}

/** The result of `make -n <goal>` in dir, with no inherited make flags. */
function dryRun(dir: string, goal: string) {
  return spawnSync('make', ['-n', goal], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
}

/** The output of `make -n <goal>`, which must succeed. */
function printed(dir: string, goal: string): string {
  const result = dryRun(dir, goal);
  assert.equal(result.status, 0, `make -n ${goal} failed:\n${result.stdout}${result.stderr}`);
  return result.stdout;
}

test('the interpreter var/tools/mise/shims/python3 is made by install-tools, never by uv', (t) => {
  const out = printed(sandbox(t), PYTHON_BIN);
  assert.ok(lineIndex(out, INSTALL_TOOLS) >= 0, `var/tools/mise/shims/python3 is not made by install-tools:\n${out}`);
  assert.equal(lineIndex(out, UV_INTERPRETER), -1, `var/tools/mise/shims/python3 is made with uv:\n${out}`);
});

test('make install prints no uv interpreter install and runs install-tools', (t) => {
  const out = printed(sandbox(t), 'install');
  assert.equal(lineIndex(out, UV_INTERPRETER), -1, `make install installs an interpreter with uv:\n${out}`);
  assert.ok(lineIndex(out, /install-tools\.mjs/) >= 0, `make install does not run install-tools:\n${out}`);
});

test('the python package environment follows the install-tools interpreter', (t) => {
  const out = printed(sandbox(t), 'test-python');
  const interpreter = lineIndex(out, INSTALL_TOOLS);
  const venv = lineIndex(out, /fsm-python-install/);
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

test('the python package runs the uv and the Python of the shims of mise, never those of PATH (S-44-2, S-44-6)', () => {
  assert.match(makefileOf(), /^UV := var\/tools\/mise\/shims\/uv$/m);
  assert.match(makefileOf(), /^PYTHON_BIN := var\/tools\/mise\/shims\/python3$/m);
});

// The package venv is made by kit's python-venv (uv venv) and accepted by kit's runner; kit tests both itself (S-44).
test('make -n fsm-python-install makes the venv with the kit python-venv, never with -m venv (S-41-1, kit K44)', (t) => {
  const out = printed(sandbox(t), 'fsm-python-install');
  assert.match(out, /python-venv DIR=packages\/python\/\.venv/, `install does not call the kit python-venv:\n${out}`);
  assert.doesNotMatch(out, /-m venv/, `install runs -m venv itself:\n${out}`);
});

test("the python install lists pylock.toml, which kit's python-lock writes, and writes no lock of its own (S-44)", () => {
  const makefile = makefileOf();
  assert.match(makefile, /\$\(UV\) pip install --python \$\(PY_VENV\)\/bin\/python --link-mode copy -r packages\/python\/pylock\.toml/);
  assert.doesNotMatch(makefile, /\$\(UV\) (export|lock)\b/, "the Makefile writes or checks a lock itself; kit's python-lock does");
  assert.doesNotMatch(makefile, /-m venv/, 'the Makefile runs -m venv itself; the kit python-venv makes the venv');
  assert.match(makefile, /python-venv DIR=\$\(PY_VENV\)/);
  assert.match(makefile, /--link-mode copy/);
  const recipes = makefile.split('\n').filter(line => !line.startsWith('#')).join('\n');
  assert.doesNotMatch(recipes, /(^|[^$(\w])uv (venv|sync)\b/m, 'a recipe runs uv venv or uv sync');
});

test('test-python runs the runner with --venv and no PATH entry for the venv', (t) => {
  const out = printed(sandbox(t), 'test-python');
  assert.match(out, /run-tests\.mjs python --venv /, 'test-python does not pass --venv to the runner');
  assert.doesNotMatch(makefileOf(), /PATH=\$\(CURDIR\)\/\$\(VENV\)/);
  assert.doesNotMatch(readFileSync(path.join(ROOT, 'Makefile'), 'utf8'), /PATH=\$\(CURDIR\)\/packages\/python/);
});

/** The text of the root Makefile, which holds every target of the runtime packages (K245). */
function makefileOf(): string {
  return readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
}
