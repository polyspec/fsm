// Tests of the command line packages/db/src/cli/fsm-db.mjs (docs/plans/fsm-v1/plan.md, C-6): every command runs as a process
// against the database whose DSN is in the environment variable that fsm.config.json names. The database of a case is empty
// (no table): a new SQLite file on SQLite, and on PostgreSQL and MySQL a new database that the admin DSN creates and the
// file's tests drop (dialect.mjs, emptyDatabase). FSM_TEST_DIALECT names the dialect; each case has its own temporary project.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import { jsonStore } from '../../compiler/src/store-json/store.mjs';
import { mermaidStore } from '../../compiler/src/store-mermaid/store.mjs';
import { dbStore } from '../src/db-store.mjs';
import { SCHEMA, connect } from '../src/models/models.ts';
import { dialectOf, emptyDatabase, runStatement } from './dialect.mjs';

const CLI = new URL('../src/cli/fsm-db.mjs', import.meta.url).pathname;
const DIALECT = dialectOf();
const temp = [];
const databases = [];

after(async () => {
  for (const drop of databases) await drop();
  for (const dir of temp) rmSync(dir, { recursive: true, force: true });
});

/**
 * The missing table of the dialect, named by its driver: `machine`, the first table of the schema. The server writes its own
 * message in its language (the PostgreSQL server of the tests answers in Korean), so the test checks the quoted table name that
 * each message carries, not the words around it.
 */
const NO_TABLE = {
  sqlite: /no such table: machine/,
  postgres: /"machine"/,
  mysql: /\.machine'/,
}[DIALECT];

/** A project with fsm.config.json for the db store, an empty database (with the schema when `install`), and the DSN. */
async function project({ config = { store: 'db', dsnEnv: 'FSM_DSN' }, install = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fsm-db-cli-'));
  temp.push(dir);
  const database = await emptyDatabase(dir);
  databases.push(database.drop);
  if (config !== null) writeFileSync(path.join(dir, 'fsm.config.json'), JSON.stringify(config));
  if (install) {
    const db = await connect(database.dsn);
    await db.utils().schema().install(SCHEMA);
    await db.close();
  }
  return { dir, dsn: database.dsn };
}

/** Runs the command line with `args` in `dir`, with the DSN in the variable FSM_DSN unless `env` overrides it. */
function cli(args, { dir, dsn }, env = { FSM_DSN: dsn }) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--project', dir], {
    encoding: 'utf8', env: { PATH: process.env.PATH, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: stripVTControlCharacters(result.stderr) };
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
  assert.match(result.stderr, /^\[fsm-db\] OrmError: DRIVER: [^\n]*\n/);
  assert.match(result.stderr, NO_TABLE);
  assert.match(result.stderr, /\n\s+at /);
});

test('install creates the schema of a new database: check fails before it, install prints ok, check then passes', async () => {
  const p = await project({ install: false });
  const before = cli(['check'], p);
  assert.equal(before.status, 1);
  assert.match(before.stderr, NO_TABLE);
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
  await runStatement(p.dsn, 'drop table edge');
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

/** The lock of the database and its definitions, read through the DB store (the rows of the six tables). */
async function rowsOf(dsn) {
  const db = await connect(dsn);
  try {
    return await dbStore(db).load();
  } finally {
    await db.close();
  }
}

/** A canonical mermaid checkout with the same machine as checkout(), written by the mermaid store, and its root. */
async function mermaidCheckout(name = 'order') {
  const root = mkdtempSync(path.join(tmpdir(), 'fsm-db-mmd-'));
  temp.push(root);
  await mermaidStore(root).save({
    definitions: [{
      machine: name,
      states: [{ key: 'draft', code: 1, initial: true }, { key: 'done', code: 2, final: true }],
      events: [{ key: 'next', edges: [{ from: 'draft', to: 'done' }] }],
    }],
    lock: { [name]: { codes: { 1: 'draft', 2: 'done' }, reserved: [] } },
  });
  return root;
}

test('lock --rename renames the state in the rows and keeps its code: the output is ok and the rows after hold the new key', async () => {
  const p = await project();
  const source = await checkout();
  assert.equal(cli(['copy', '--from', 'json', '--root', source], p).status, 0);
  const renamed = cli(['lock', '--rename', 'order.draft=created'], p);
  assert.equal(renamed.status, 0, renamed.stderr);
  assert.equal(renamed.stdout, '[fsm-db] lock: ok\n');
  assert.equal(renamed.stderr, '');
  const { definitions, lock } = await rowsOf(p.dsn);
  assert.deepEqual(definitions, [{
    machine: 'order',
    states: [{ key: 'created', code: 1, initial: true }, { key: 'done', code: 2, final: true }],
    events: [{ key: 'next', edges: [{ from: 'created', to: 'done' }] }],
  }]);
  assert.deepEqual(lock, { order: { codes: { 1: 'created', 2: 'done' }, reserved: [] } });
  assert.equal(cli(['check'], p).status, 0);
});

test('lock --rename of an unknown state is the finding of the README and writes no row', async () => {
  const p = await project();
  const source = await checkout();
  assert.equal(cli(['copy', '--from', 'json', '--root', source], p).status, 0);
  const before = await rowsOf(p.dsn);
  const result = cli(['lock', '--rename', 'order.nope=x'], p);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '[fsm-db] E_UNKNOWN_STATE_REF order $.states: state nope is not a state of order\n');
  assert.deepEqual(await rowsOf(p.dsn), before);
});

test('copy --to mermaid --root writes the canonical mermaid files and the lock of the database', async () => {
  const p = await project();
  const source = await checkout();
  assert.equal(cli(['copy', '--from', 'json', '--root', source], p).status, 0);
  const out = mkdtempSync(path.join(tmpdir(), 'fsm-db-out-'));
  temp.push(out);
  const result = cli(['copy', '--to', 'mermaid', '--root', out], p);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '[fsm-db] copy: ok\n');
  assert.equal(result.stderr, '');
  const expected = await mermaidCheckout();
  assert.equal(readFileSync(path.join(out, 'machines/order.fsm.mmd'), 'utf8'), readFileSync(path.join(expected, 'machines/order.fsm.mmd'), 'utf8'));
  assert.equal(readFileSync(path.join(out, 'fsm.lock.json'), 'utf8'), readFileSync(path.join(expected, 'fsm.lock.json'), 'utf8'));
  assert.deepEqual(readdirSync(path.join(out, 'machines')), ['order.fsm.mmd']);
});

test('copy --from mermaid --root fills the empty database; a second copy is E_STORE_NOT_EMPTY and writes nothing', async () => {
  const p = await project();
  const source = await mermaidCheckout();
  const result = cli(['copy', '--from', 'mermaid', '--root', source], p);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '[fsm-db] copy: ok\n');
  assert.deepEqual(await rowsOf(p.dsn), {
    definitions: [{
      machine: 'order',
      states: [{ key: 'draft', code: 1, initial: true }, { key: 'done', code: 2, final: true }],
      events: [{ key: 'next', edges: [{ from: 'draft', to: 'done' }] }],
    }],
    lock: { order: { codes: { 1: 'draft', 2: 'done' }, reserved: [] } },
    // The baseline of the db store is the stored lock rows (spec B-3), so after the copy it equals the lock.
    baseline: { order: { codes: { 1: 'draft', 2: 'done' }, reserved: [] } },
    findings: [],
  });
  const before = await rowsOf(p.dsn);
  const again = cli(['copy', '--from', 'mermaid', '--root', source], p);
  assert.equal(again.status, 1);
  assert.equal(again.stdout, '');
  assert.equal(again.stderr, '[fsm-db] E_STORE_NOT_EMPTY - $: the target store is not empty, so copy writes nothing\n');
  assert.deepEqual(await rowsOf(p.dsn), before);
});
