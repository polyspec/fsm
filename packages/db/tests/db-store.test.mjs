// Tests of the DB store (packages/db/src/db-store.mjs, docs/spec/fsm.md, B-2 and B-3): the store contract, the
// round trips json -> db -> json, E_STORE_NOT_EMPTY, and the atomicity of save. Every case opens its own SQLite database
// file in a temporary directory, installs the schema of schema/fsm.dbs and closes the connection afterwards.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { copy, run } from '../../compiler/src/core/run.mjs';
import { jsonStore } from '../../compiler/src/store-json/store.mjs';
import { storeContract } from '../../compiler/tests/store-contract.mjs';
import { dbStore } from '../src/db-store.mjs';
import { Edge, Event, LockCode, LockReserved, Machine, State } from '../src/models/models.ts';
import { openDialectDb } from './dialect.mjs';

const temp = [];
const dbs = [];

after(async () => {
  for (const db of dbs) await db.close();
  for (const dir of temp) rmSync(dir, { recursive: true, force: true });
});

/** A new empty temporary directory, removed when the file's tests end. */
function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'fsm-db-'));
  temp.push(dir);
  return dir;
}

/**
 * A database with the schema installed and no fsm row: a new SQLite file, or the server database of FSM_TEST_DIALECT (its rows are
 * cleared, so a second call returns the same database emptied; the cases read what they need before they call it again).
 */
async function freshDb() {
  const db = await openDialectDb(path.join(tempDir(), 'fsm.sqlite'));
  dbs.push(db);
  return db;
}

/** The text of every row of every table, one line per row in sorted order: the bytes that the store holds. */
async function tablesOf(db) {
  const tables = { machine: Machine, state: State, event: Event, edge: Edge, lock_code: LockCode, lock_reserved: LockReserved };
  const parts = [];
  for (const [name, model] of Object.entries(tables)) {
    const rows = (await new model().connect(db).gets()).toArray().map(row => JSON.stringify(row)).sort();
    parts.push(`${name}\n${rows.join('\n')}`);
  }
  return parts.join('\n---\n');
}

/** A store on a fresh database, with the snapshot of its tables. */
async function dbCase() {
  const db = await freshDb();
  return { store: dbStore(db), snapshot: () => tablesOf(db), db };
}

storeContract('db', dbCase);

/** A key of 64 characters, the longest key the core accepts (docs/spec/fsm.md, B-5). */
const LONG = `a${'b'.repeat(63)}`;

/** Two machines in name order: the 64-character machine, then order (draft -next-> paid -next-> done, and paid -back-> draft). */
const sample = () => ({
  definitions: [
    {
      machine: LONG,
      states: [{ key: LONG, code: 7, initial: true, final: true }],
      events: [],
    },
    {
      machine: 'order',
      states: [
        { key: 'draft', code: 1, initial: true },
        { key: 'paid', code: 2 },
        { key: 'done', code: 3, final: true },
      ],
      events: [
        { key: 'next', edges: [{ from: 'draft', to: 'paid' }, { from: 'paid', to: 'done' }] },
        { key: 'back', edges: [{ from: 'paid', to: 'draft' }] },
      ],
    },
  ],
  lock: {
    [LONG]: { codes: { 7: LONG }, reserved: [] },
    order: { codes: { 1: 'draft', 2: 'paid', 3: 'done' }, reserved: [4, 9] },
    retired: { codes: {}, reserved: [1] },
  },
});

/** The findings of the command as {code, machine, path}. */
const shape = findings => findings.map(({ code, machine, path }) => ({ code, machine, path }));

test('db store: a 64-character key round-trips through the tables and the store returns it unchanged', async () => {
  const { store } = await dbCase();
  await store.save(sample());
  const loaded = await store.load();
  assert.deepEqual(loaded.definitions.map(definition => definition.machine), [LONG, 'order']);
  assert.equal(loaded.definitions[0].states[0].key, LONG);
  assert.deepEqual(loaded.lock[LONG], { codes: { 7: LONG }, reserved: [] });
});

test('db store: states and edges come back in their stored position, and false flags are absent', async () => {
  const { store } = await dbCase();
  await store.save(sample());
  const [, order] = (await store.load()).definitions;
  assert.deepEqual(order.states.map(state => state.key), ['draft', 'paid', 'done']);
  assert.deepEqual(order.states[1], { key: 'paid', code: 2 });
  assert.deepEqual(order.events[0].edges, [{ from: 'draft', to: 'paid' }, { from: 'paid', to: 'done' }]);
});

test('json -> db -> json is byte-identical, with a 64-character key and reserved codes', async () => {
  const source = tempDir();
  const back = tempDir();
  await jsonStore(source).save(sample());
  const { store } = await dbCase();
  assert.deepEqual(await copy(jsonStore(source), store), { findings: [] });
  assert.deepEqual(await copy(store, jsonStore(back)), { findings: [] });
  assert.equal(bytesOf(back), bytesOf(source));
  assert.match(bytesOf(back), new RegExp(`"machine": "${LONG}"`));
});

test('db -> json -> db keeps every row', async () => {
  const { store, snapshot, db } = await dbCase();
  await store.save(sample());
  const before = await snapshot();
  const json = tempDir();
  assert.deepEqual(await copy(dbStore(db), jsonStore(json)), { findings: [] });
  const fresh = await dbCase();
  assert.deepEqual(await copy(jsonStore(json), fresh.store), { findings: [] });
  assert.equal(await fresh.snapshot(), before);
});

test('copy into a non-empty database is E_STORE_NOT_EMPTY and writes nothing', async () => {
  const source = tempDir();
  await jsonStore(source).save(sample());
  const { store, snapshot } = await dbCase();
  await store.save(sample());
  const before = await snapshot();
  assert.deepEqual(shape((await copy(jsonStore(source), store)).findings), [{ code: 'E_STORE_NOT_EMPTY', machine: null, path: '$' }]);
  assert.equal(await snapshot(), before);
});

test('a failed write inside the transaction rolls back every row it deleted and wrote', async () => {
  const { store, snapshot } = await dbCase();
  await store.save(sample());
  const before = await snapshot();
  // The core never sends this to a store: two states with one code. The unique key of the table refuses the second insert,
  // after the old rows were deleted and the first state was written. The whole save must roll back.
  const broken = sample();
  broken.definitions[1].states[1].code = 1;
  await assert.rejects(() => store.save(broken));
  assert.equal(await snapshot(), before);
  assert.deepEqual(await store.load(), { ...sample(), baseline: sample().lock, findings: [] });
});

test('a save is refused by the core before any row changes when a key is 65 characters', async () => {
  const { store, snapshot } = await dbCase();
  await store.save(sample());
  const before = await snapshot();
  const long = sample();
  long.definitions[0].machine = `${LONG}c`;
  const result = await run('save', { load: store.load, save: store.save }, { definitions: long.definitions });
  assert.equal(result.findings[0].code, 'E_KEY_FORMAT');
  assert.equal(await snapshot(), before);
});

/** The order machine of the lock cases: draft (code 1), paid (2) and done (3), with its lock. */
const committedOrder = () => ({
  definitions: [{
    machine: 'order',
    states: [{ key: 'draft', code: 1, initial: true }, { key: 'paid', code: 2 }, { key: 'done', code: 3, final: true }],
    events: [{ key: 'next', edges: [{ from: 'draft', to: 'paid' }, { from: 'paid', to: 'done' }] }],
  }],
  lock: { order: { codes: { 1: 'draft', 2: 'paid', 3: 'done' }, reserved: [] } },
});

test('a save on the database refuses a swap of the stored codes and changes no row (the stored rows are the baseline)', async () => {
  const { store, snapshot } = await dbCase();
  await store.save(committedOrder());
  const before = await snapshot();
  const swapped = committedOrder();
  swapped.definitions[0].states[0].code = 2;
  swapped.definitions[0].states[1].code = 1;
  const result = await run('save', store, { definitions: swapped.definitions });
  // The rows that load reads are the baseline, so the existing rule E_CODE_CHANGED refuses the swap (B-3); E_LOCK_REGRESSED
  // needs a committed state that is not the stored rows, which the database store does not have.
  assert.deepEqual(shape(result.findings), [
    { code: 'E_CODE_CHANGED', machine: 'order', path: '$.states[0].code' },
    { code: 'E_CODE_CHANGED', machine: 'order', path: '$.states[1].code' },
  ]);
  assert.equal(await snapshot(), before);
});

/** The bytes of a JSON checkout, as the JSON store tests read them. */
function bytesOf(root) {
  const parts = [];
  const machines = path.join(root, 'machines');
  for (const name of readdirSync(machines).sort()) parts.push(`${name}\n${readFileSync(path.join(machines, name), 'utf8')}`);
  parts.push(`fsm.lock.json\n${readFileSync(path.join(root, 'fsm.lock.json'), 'utf8')}`);
  return parts.join('---\n');
}
