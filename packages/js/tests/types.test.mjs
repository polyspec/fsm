// The type check of the generated declarations (docs/spec/fsm.md, B-6; docs/plans/execution-checklist.md, S-09-2). The
// consumer file tests/types/consumer.ts uses every public name of the notation of src/*.d.ts and holds the lines that must
// fail to compile under @ts-expect-error. tsc, the TypeScript of the package's devDependencies, compiles it in strict mode and
// the test asserts that it exits with status 0: a declaration that is too loose makes a directive unused, and a declaration
// that is too narrow makes a line of the consumer fail. This is not a vector case, so it runs in its own record (make npm-types).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PACKAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSC = path.join(PACKAGE, 'node_modules/typescript/bin/tsc');
const CONSUMER = path.join(PACKAGE, 'tests/types/consumer.ts');

test('the generated declarations type-check the consumer in strict mode', () => {
  assert.ok(existsSync(TSC), `${TSC} does not exist; run make -C packages/js install`);
  const result = spawnSync(process.execPath, [TSC, '--noEmit', '--strict', '--module', 'nodenext', '--target', 'es2022', '--pretty', 'false', CONSUMER], { encoding: 'utf8' });
  assert.equal(result.error, undefined, `tsc could not run: ${result.error?.message}`);
  assert.equal(result.status, 0, `tsc reported findings:\n${result.stdout}${result.stderr}`);
});
