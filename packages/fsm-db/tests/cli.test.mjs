// Tests of the command line packages/fsm-db/src/cli/fsm-db.mjs (docs/plans/fsm-v1.md, C-6): every command runs as a
// process against a SQLite database whose DSN is in the environment variable that fsm.config.json names. Each case has
// its own temporary project and database, removed when the file's tests end.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { jsonStore } from '../../fsm-compiler/src/store-json/store.mjs';
import { SCHEMA, connect } from '../src/models/models.ts';

const CLI = new URL('../src/cli/fsm-db.mjs', import.meta.url).pathname;
const temp = [];

after(() => {
  for (const dir of temp) rmSync(dir, { recursive: true, force: true });
});

/** A project with fsm.config.json for the db store, a SQLite database with the schema, and the DSN variable name. */
async function project({ config = { store: 'db', dsnEnv: 'FSM_DSN' }, install = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fsm-db-cli-'));
  temp.push(dir);
  const file = path.join(dir, 'fsm.sqlite');
  if (config !== null) writeFileSync(path.join(dir, 'fsm.config.json'), JSON.stringify(config));
  if (install) {
    const db = await connect(`sqlite://${file}`);
    await db.utils().schema().install(SCHEMA);
    await db.close();
  }
  return { dir, dsn: `sqlite://${file}` };
}

/** Runs the command line with `args` in `dir`, with the DSN in the variable FSM_DSN unless `env` overrides it. */
function cli(args, { dir, dsn }, env = { FSM_DSN: dsn }) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--project', dir], {
    encoding: 'utf8', env: { PATH: process.env.PATH, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr.replace(/\x1b\[[0-9;]*m/g, '') };
}

/** A canonical JSON checkout with one machine, written by the JSON store, and its root. */
async function checkout(name = 'order') {
  const root = mkdtempSync(path.join(tmpdir(), 'fsm-db-json-'));
  temp.push(root);
  await jsonStore(root).save({
    definitions: [{
      machine: name,
      states: [{ key: 'draft', code: 1, initial: true }, { key: 'done', code: 2, final: true }],
      events: [{ key: 'next', edges: [{ from: 'draft', to: 'done' }] }],
    }],
    lock: { [name]: { codes: { 1: 'draft', 2: 'done' }, reserved: [] } },
  });
  return root;
}

test('no command and an unknown command exit 2 with the usage line', async () => {
  const p = await project();
  assert.equal(cli([], p).status, 2);
  const unknown = cli(['gen'], p);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /usage: fsm-db check/);
});

test('copy without a direction or without --root exits 2', async () => {
  const p = await project();
  assert.equal(cli(['copy', '--root', p.dir], p).status, 2);
  assert.equal(cli(['copy', '--to', 'json'], p).status, 2);
});

test('a missing fsm.config.json is E_STORE_NOT_CONFIGURED', async () => {
  const p = await project({ config: null });
  const result = cli(['check'], p);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[fsm-db\] E_STORE_NOT_CONFIGURED - \$: fsm.config.json is missing/);
});

test('a json project is refused: fsm-db handles the db store only', async () => {
  const p = await project({ config: { store: 'json' } });
  const result = cli(['check'], p);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /E_STORE_NOT_CONFIGURED - \$\.store: fsm-db handles the db store only/);
});

test('a DSN variable that is not set is E_STORE_NOT_CONFIGURED and nothing is connected', async () => {
  const p = await project();
  const result = cli(['check'], p, {});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /E_STORE_NOT_CONFIGURED - \$\.dsnEnv: the environment variable FSM_DSN is not set/);
});

test('copy --from json fills the empty database, and copy --to json writes the same bytes back', async () => {
  const p = await project();
  const source = await checkout();
  assert.equal(cli(['copy', '--from', 'json', '--root', source], p).status, 0);
  assert.equal(cli(['check'], p).status, 0);
  const back = mkdtempSync(path.join(tmpdir(), 'fsm-db-back-'));
  temp.push(back);
  assert.equal(cli(['copy', '--to', 'json', '--root', back], p).status, 0);
  assert.equal(readFileSync(path.join(back, 'machines/order.fsm.json'), 'utf8'), readFileSync(path.join(source, 'machines/order.fsm.json'), 'utf8'));
  assert.equal(readFileSync(path.join(back, 'fsm.lock.json'), 'utf8'), readFileSync(path.join(source, 'fsm.lock.json'), 'utf8'));
});

test('copy --from into a non-empty database is E_STORE_NOT_EMPTY and exits 1', async () => {
  const p = await project();
  const source = await checkout();
  assert.equal(cli(['copy', '--from', 'json', '--root', source], p).status, 0);
  const again = cli(['copy', '--from', 'json', '--root', source], p);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /E_STORE_NOT_EMPTY/);
});

test('lock repairs a stored lock and check then passes', async () => {
  const p = await project();
  const source = await checkout();
  assert.equal(cli(['copy', '--from', 'json', '--root', source], p).status, 0);
  assert.equal(cli(['lock'], p).status, 0);
  assert.equal(cli(['check'], p).status, 0);
});

test('a database without the schema is an unexpected rejection: printed with its stack and exit 1', async () => {
  const p = await project({ install: false });
  const result = cli(['check'], p);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^\[fsm-db\] OrmError: DRIVER: sqlite: no such table: machine\n/);
  assert.match(result.stderr, /\n\s+at /);
});

test('install creates the schema of a new database: check fails before it, install prints ok, check then passes', async () => {
  const p = await project({ install: false });
  const before = cli(['check'], p);
  assert.equal(before.status, 1);
  assert.match(before.stderr, /no such table: machine/);
  const installed = cli(['install'], p);
  assert.equal(installed.status, 0);
  assert.equal(installed.stdout, '[fsm-db] install: ok\n');
  assert.equal(installed.stderr, '');
  assert.equal(cli(['check'], p).status, 0);
});

test('a second install on a database with the schema exits 0 (the observed orm behaviour: nothing is changed)', async () => {
  const p = await project();
  const again = cli(['install'], p);
  assert.equal(again.status, 0);
  assert.equal(again.stdout, '[fsm-db] install: ok\n');
  assert.equal(cli(['check'], p).status, 0);
});

test('install on a database with only some of the tables is rejected by orm: CONFIG, printed with its stack and exit 1', async () => {
  const p = await project({ install: false });
  assert.equal(cli(['install'], p).status, 0);
  const raw = new DatabaseSync(p.dsn.replace('sqlite://', ''));
  raw.exec('drop table edge');
  raw.close();
  const result = cli(['install'], p);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^\[fsm-db\] OrmError: CONFIG: install found only some tables of the document set/);
  assert.match(result.stderr, /\n\s+at /);
});

test('install takes only --project: any other option or a missing value exits 2 with the usage lines', async () => {
  const p = await project({ install: false });
  const extra = cli(['install', '--rename', 'order.a=b'], p);
  assert.equal(extra.status, 2);
  assert.match(extra.stderr, /--rename is not an option of install/);
  assert.match(extra.stderr, /fsm-db install \[--project <dir>\]/);
  const missing = cli(['install', '--project'], p);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--project needs a value/);
});
