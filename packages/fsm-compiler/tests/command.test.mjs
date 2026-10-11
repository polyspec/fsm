// Tests of the command fsm-gen (docs/plans/execution-checklist.md, S-18-1): `npm install -g ./packages/fsm-compiler` puts
// fsm-gen on the PATH. The package is installed offline into a temporary npm prefix, and the command runs from its bin
// directory as a shell would run it, without naming node or the source file.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const ROOT = path.resolve(PACKAGE, '../..');
const prefix = mkdtempSync(path.join(tmpdir(), 'fsm-gen-prefix-'));

after(() => rmSync(prefix, { recursive: true, force: true }));

test('npm install -g of the package gives the command fsm-gen', () => {
  const install = spawnSync('npm', ['install', '-g', '--prefix', prefix, '--offline', '--no-audit', '--no-fund', PACKAGE], { encoding: 'utf8' });
  assert.equal(install.status, 0, install.stdout + install.stderr);
  const result = spawnSync(path.join(prefix, 'bin', 'fsm-gen'), ['check', '--project', ROOT], { encoding: 'utf8' });
  assert.deepEqual([result.status, result.stdout, result.stderr], [0, '[fsm-gen] check: ok\n', '']);
  const usage = spawnSync(path.join(prefix, 'bin', 'fsm-gen'), [], { encoding: 'utf8' });
  assert.equal(usage.status, 2, usage.stdout + usage.stderr);
});
