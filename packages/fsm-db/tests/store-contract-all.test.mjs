// The store contract of docs/spec/fsm.md, B-2, proven on all three stores: json, mermaid and db (this package owns the test,
// since it depends on the compiler and not the other way round). Two promises:
//   1. every valid fixture of packages/fsm-compiler/tests/fixtures/valid round-trips json -> db -> mermaid -> json with the
//      files compared as bytes;
//   2. run gen (every kind, with its required options) and run vectors give byte-identical output on the json, mermaid and
//      db stores of the same definitions.
// The cases open their own SQLite database in a temporary directory and close it afterwards; the checkouts are temporary too.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { backendOf, KINDS } from '../../fsm-compiler/src/backends/index.mjs';
import { copy, run } from '../../fsm-compiler/src/core/run.mjs';
import { jsonStore } from '../../fsm-compiler/src/store-json/store.mjs';
import { mermaidStore } from '../../fsm-compiler/src/store-mermaid/store.mjs';
import { bytesOf, removeRoots, tempRoot, write } from '../../fsm-compiler/tests/checkout.mjs';
import { dbStore } from '../src/db-store.mjs';
import { openDialectDb } from './dialect.mjs';

const FIXTURES = fileURLToPath(new URL('../../fsm-compiler/tests/fixtures/valid/', import.meta.url));
const dbs = [];
const dirs = [];

after(async () => {
  for (const db of dbs) await db.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  removeRoots();
});

/** The valid fixtures, by name, in name order: order and two_step. */
const FIXTURE_NAMES = readdirSync(FIXTURES).filter(name => name.endsWith('.json')).sort().map(name => name.slice(0, -'.json'.length));

/** The required options of every kind (fsm-gen gen: --go-module, --php-namespace, --php-ext-name). */
const KIND_OPTIONS = {
  go: { goModule: 'example.com/fsm-contract' },
  npm: {},
  php: { phpNamespace: 'Polyspec\\FsmContract' },
  'php-ext': { phpNamespace: 'Polyspec\\FsmContract', phpExtName: 'polyspec_fsm_contract' },
  python: {},
  rust: {},
};

/**
 * A database with the schema of schema/fsm.dbs installed and no fsm row, closed after the tests: a new SQLite file, or the server
 * database of FSM_TEST_DIALECT, cleared by each call (the cases read what they need before they call it again).
 */
async function freshDb() {
  const dir = mkdtempSync(path.join(tmpdir(), 'fsm-db-contract-'));
  dirs.push(dir);
  const db = await openDialectDb(path.join(dir, 'fsm.sqlite'));
  dbs.push(db);
  return db;
}

/** A json checkout holding every valid fixture as it is written in the fixture directory, with its lock derived by run lock. */
async function fixtureCheckout(names) {
  const root = tempRoot();
  for (const name of names) write(root, `machines/${name}.fsm.json`, readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));
  const locked = await run('lock', jsonStore(root), {});
  assert.deepEqual(locked, { findings: [] });
  return root;
}

/** The bytes of a root after json -> db -> mermaid -> json, and the findings of each step that is not empty. */
async function roundTrip(source) {
  const db = await freshDb();
  const mid = tempRoot();
  const back = tempRoot();
  assert.deepEqual(await copy(jsonStore(source), dbStore(db)), { findings: [] });
  assert.deepEqual(await copy(dbStore(db), mermaidStore(mid)), { findings: [] });
  assert.deepEqual(await copy(mermaidStore(mid), jsonStore(back)), { findings: [] });
  return bytesOf(back);
}

/** The output of every command the stores serve: gen of every kind, the vectors and the vectors file of every kind. */
async function outputsOf(store) {
  const gen = {};
  const vectorFiles = {};
  for (const kind of KINDS) {
    const result = await run('gen', store, { kind, ...KIND_OPTIONS[kind] });
    assert.deepEqual(result.findings, [], `gen --kind ${kind}`);
    gen[kind] = result.files;
  }
  const vectors = await run('vectors', store, {});
  assert.deepEqual(vectors.findings, []);
  for (const kind of KINDS) vectorFiles[kind] = backendOf(kind).vectorsFile(vectors.vectors, { phpNamespace: KIND_OPTIONS[kind].phpNamespace, module: KIND_OPTIONS[kind].goModule });
  return { gen, vectors: vectors.vectors, vectorFiles };
}

/** The same definitions and lock on the json, mermaid and db stores, each in its own medium. */
async function threeStores(source) {
  const mid = tempRoot();
  const db = await freshDb();
  assert.deepEqual(await copy(jsonStore(source), mermaidStore(mid)), { findings: [] });
  assert.deepEqual(await copy(jsonStore(source), dbStore(db)), { findings: [] });
  return { json: jsonStore(source), mermaid: mermaidStore(mid), db: dbStore(db) };
}

for (const name of FIXTURE_NAMES) {
  test(`store contract: the valid fixture ${name} round-trips json -> db -> mermaid -> json byte-identically`, async () => {
    const source = await fixtureCheckout([name]);
    const original = bytesOf(source);
    assert.notEqual(original, '');
    assert.equal(await roundTrip(source), original);
  });
}

test('store contract: every valid fixture together round-trips json -> db -> mermaid -> json byte-identically', async () => {
  const source = await fixtureCheckout(FIXTURE_NAMES);
  const original = bytesOf(source);
  assert.equal(await roundTrip(source), original);
});

test('store contract: run gen (every kind) and run vectors give byte-identical output on the json, mermaid and db stores', async () => {
  const source = await fixtureCheckout(FIXTURE_NAMES);
  const stores = await threeStores(source);
  const expected = await outputsOf(stores.json);
  for (const kind of KINDS) assert.notDeepEqual(expected.gen[kind], [], `${kind} generates files`);
  assert.deepEqual(await outputsOf(stores.mermaid), expected);
  assert.deepEqual(await outputsOf(stores.db), expected);
});

/** A store that drops the flag `final` of every state on save: the defect that the contract cases must catch. */
function dropsFinal(store) {
  return {
    load: store.load,
    save: ({ definitions, lock }) => store.save({
      definitions: definitions.map(definition => ({
        ...definition,
        states: definition.states.map(({ final, ...state }) => state),
      })),
      lock,
    }),
  };
}

test('store contract: the comparison catches a store that drops final (the harness detects the defect)', async () => {
  const source = await fixtureCheckout(FIXTURE_NAMES);
  const original = bytesOf(source);
  const db = await freshDb();
  const mid = tempRoot();
  const back = tempRoot();
  assert.deepEqual(await copy(jsonStore(source), dropsFinal(dbStore(db))), { findings: [] });
  // The core refuses the dropped flag (E_DEAD_END) on the way back, or else the bytes differ: either way the contract fails.
  const toMermaid = await copy(dbStore(db), mermaidStore(mid));
  const toJson = toMermaid.findings.length === 0 ? await copy(mermaidStore(mid), jsonStore(back)) : toMermaid;
  assert.ok(toJson.findings.length > 0 || bytesOf(back) !== original, 'a store that drops final must not round-trip');

  const dropping = await freshDb();
  assert.deepEqual(await copy(jsonStore(source), dropsFinal(dbStore(dropping))), { findings: [] });
  assert.notDeepEqual(await run('gen', dbStore(dropping), { kind: 'npm' }), await run('gen', jsonStore(source), { kind: 'npm' }));
});
