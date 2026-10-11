// Tests of the command fsm-db (docs/plans/execution-checklist.md, S-18-1): `npm install -g ./packages/fsm-db` puts fsm-db on
// the PATH. The package is installed offline into a temporary npm prefix, and the command installs the schema into a new empty
// database of FSM_TEST_DIALECT (SQLite, PostgreSQL or MySQL; dialect.mjs, emptyDatabase) and checks it, run from the bin
// directory as a shell would run it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { emptyDatabase } from './dialect.mjs';

const PACKAGE = fileURLToPath(new URL('..', import.meta.url));
const temp = mkdtempSync(path.join(tmpdir(), 'fsm-db-command-'));
const databases = [];

after(async () => {
  for (const drop of databases) await drop();
  rmSync(temp, { recursive: true, force: true });
});

test('npm install -g of the package gives the command fsm-db', async () => {
  const prefix = path.join(temp, 'prefix');
  const install = spawnSync('npm', ['install', '-g', '--prefix', prefix, '--offline', '--no-audit', '--no-fund', PACKAGE], { encoding: 'utf8' });
  assert.equal(install.status, 0, install.stdout + install.stderr);
  const project = path.join(temp, 'project');
  spawnSync('mkdir', [project]);
  writeFileSync(path.join(project, 'fsm.config.json'), JSON.stringify({ store: 'db', dsnEnv: 'FSM_DSN' }));
  const database = await emptyDatabase(project);
  databases.push(database.drop);
  const env = { PATH: process.env.PATH, FSM_DSN: database.dsn };
  const run = args => spawnSync(path.join(prefix, 'bin', 'fsm-db'), [...args, '--project', project], { encoding: 'utf8', env });
  const installed = run(['install']);
  assert.deepEqual([installed.status, installed.stdout], [0, '[fsm-db] install: ok\n'], installed.stderr);
  const checked = run(['check']);
  assert.deepEqual([checked.status, checked.stdout], [0, '[fsm-db] check: ok\n'], checked.stderr);
});
