// Tests of the php-ext persist recipes of the Makefile (docs/plans/kit-standard/checklist.md, S-398 and S-399).
// run-tests records the digest of the --inputs of a run; kit refuses an --inputs path that names no tracked file, because an ignored
// output such as var/php-ext never changes the digest of a run (kit tracked-files, inputsDigest). The recipe is read from the
// Makefile, not run: the run needs a PHP extension and a database that a checkout does not have.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The recipe lines of the Makefile target, from its rule line up to the next blank line. */
function recipe(target: string): string {
  const makefile = readFileSync(path.join(ROOT, 'Makefile'), 'utf8');
  const start = makefile.indexOf(`\n${target}:`);
  assert.notEqual(start, -1, `the Makefile has no ${target} target`);
  const end = makefile.indexOf('\n\n', start + 1);
  return makefile.slice(start, end === -1 ? undefined : end);
}

/** The --inputs paths of a recipe. */
function inputsOf(text: string): string[] {
  return [...text.matchAll(/--inputs (\S+)/g)].map(match => match[1] ?? '');
}

/** The git-tracked files of the checkout, as run-tests reads them. */
function tracked(): string[] {
  const result = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split('\0').filter(Boolean);
}

/** The --inputs paths that name no tracked file, in the way inputsDigest matches them. */
function untracked(paths: string[]): string[] {
  const files = tracked();
  return paths.filter(input => {
    const prefix = input.replace(/\/+$/, '');
    return !files.some(file => file === prefix || file.startsWith(`${prefix}/`));
  });
}

test('php-ext persist postgres names only tracked inputs (S-398)', () => {
  const inputs = inputsOf(recipe('php-ext-persist-test-postgres'));
  assert.ok(inputs.length > 0, 'php-ext-persist-test-postgres names no --inputs');
  assert.deepEqual(untracked(inputs), [], 'php-ext-persist-test-postgres names an input that no tracked file lies under');
});

test('php-ext persist mysql names only tracked inputs (S-399)', () => {
  const inputs = inputsOf(recipe('php-ext-persist-test-mysql'));
  assert.ok(inputs.length > 0, 'php-ext-persist-test-mysql names no --inputs');
  assert.deepEqual(untracked(inputs), [], 'php-ext-persist-test-mysql names an input that no tracked file lies under');
});

test('the php-ext persist test folder is a declared tool test of the root tests (S-401)', () => {
  const layout = readFileSync(path.join(ROOT, 'config/layout.yml'), 'utf8');
  assert.ok(layout.includes('- "!tests/php-ext-persist"'), 'config/layout.yml does not declare tests/php-ext-persist as a tool test (S7)');
});
