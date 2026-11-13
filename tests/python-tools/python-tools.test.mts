// Tests of the Python of the checkout (docs/plans/fsm-v1/checklist.md, S-41; docs/plans/fsm-v1/plan.md, C-1 and Verification).
// The Python 3.14 of the python package comes from `make install-tools`: kit installs the tools of mise.toml with mise at the
// digests of mise.lock, Python and uv among them, and their shims are var/tools/mise/shims/python3 and uv (S-44-6, kit K127).
// No recipe of fsm installs an interpreter, and the Makefile has no install-python target. The tests run `make -n` on a copy of the
// Makefile, the kit targets of the installed @polyspec/kit in a temporary directory: make only
// prints the recipes, so no network is used and nothing is installed. The package targets are targets of the root Makefile (K245).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// The tests of the python package are a package (S-395): unittest discovers a directory only as a package, and kit's runtime-targets
// refuses a tests/ folder without __init__.py on CI (run 41250601308).
test('the python tests folder is a package with __init__.py (S-395)', () => {
  assert.ok(existsSync(path.join(ROOT, 'legacy/packages/python/tests/__init__.py')), 'legacy/packages/python/tests/__init__.py is missing');
});

// The inputs of python-tools-test name files of the repository (S-396): run-tests reads each --inputs path, and CI refused one that
// names no tracked or new file, scripts/kit/kit-bootstrap.mk (run 41250601308).
test('the python-tools-test inputs name tracked files', () => {
  const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  const recipe = makefile.split('\n').find(line => line.includes('--results .results/python-tools-test.json'));
  assert.ok(recipe, 'the python-tools-test recipe is missing');
  const inputs = [...recipe.matchAll(/--inputs (\S+)/g)].map(match => match[1] ?? '');
  const missing = inputs.filter(input => !existsSync(path.join(ROOT, input)));
  assert.deepEqual(missing, [], 'python-tools-test names inputs that are not files of the repository');
});
