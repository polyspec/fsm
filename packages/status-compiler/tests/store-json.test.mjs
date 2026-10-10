// Tests of the JSON store of packages/status-compiler/src/store-json/store.mjs (docs/spec/status.md, B-2 and B-3): the load
// findings, the canonical bytes of save, the deletion of undefined machine files and the round trip of a canonical checkout.
// Every case runs in its own temporary directory, which is removed when the file's tests end.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { jsonStore } from '../src/store-json/store.mjs';
import { LOCK_TEXT, ORDER_LOCK_TEXT, ORDER_TEXT, TRACK_TEXT } from './canonical-texts.mjs';
import { storeContract } from './store-contract.mjs';

const roots = [];

/** A new empty temporary directory, removed when the file's tests end. */
function tempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'status-json-'));
  roots.push(root);
  return root;
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Writes `text` to `relative` under `root`, creating the directories. */
function write(root, relative, text) {
  mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  writeFileSync(path.join(root, relative), text);
}

/** The bytes of a JSON checkout: the machine files in name order, then the lock file when it exists. */
function bytesOf(root) {
  const parts = [];
  const machines = path.join(root, 'machines');
  if (existsSync(machines)) {
    for (const name of readdirSync(machines).sort()) parts.push(`${name}\n${readFileSync(path.join(machines, name), 'utf8')}`);
  }
  const lock = path.join(root, 'status.lock.json');
  if (existsSync(lock)) parts.push(`status.lock.json\n${readFileSync(lock, 'utf8')}`);
  return parts.join('---\n');
}

/** The findings as {code, machine, path}. */
const shape = findings => findings.map(({ code, machine, path }) => ({ code, machine, path }));

storeContract('json', () => {
  const root = tempRoot();
  return { store: jsonStore(root), snapshot: () => bytesOf(root) };
});

test('json store: a missing lock file is the empty lock', () => {
  const root = tempRoot();
  write(root, 'machines/order.status.json', ORDER_TEXT);
  const loaded = jsonStore(root).load();
  assert.deepEqual(loaded.lock, {});
  assert.deepEqual(shape(loaded.findings), []);
  assert.equal(loaded.definitions.length, 1);
});

test('json store: load strips the top-level $schema', () => {
  const root = tempRoot();
  write(root, 'machines/order.status.json', ORDER_TEXT);
  const [definition] = jsonStore(root).load().definitions;
  assert.equal(Object.hasOwn(definition, '$schema'), false);
  assert.equal(definition.machine, 'order');
});

test('json store: load reads the machine files in name order', () => {
  const root = tempRoot();
  write(root, 'machines/track.status.json', TRACK_TEXT);
  write(root, 'machines/order.status.json', ORDER_TEXT);
  assert.deepEqual(jsonStore(root).load().definitions.map(definition => definition.machine), ['order', 'track']);
});

test('json store: a file whose name is not <machine>.status.json fails E_SCHEMA at $.machine', () => {
  const root = tempRoot();
  write(root, 'machines/wrong.status.json', ORDER_TEXT);
  assert.deepEqual(shape(jsonStore(root).load().findings), [{ code: 'E_SCHEMA', machine: 'order', path: '$.machine' }]);
});

test('json store: a file in machines that is not a status file fails E_SCHEMA', () => {
  const root = tempRoot();
  write(root, 'machines/notes.txt', 'not a machine');
  assert.deepEqual(shape(jsonStore(root).load().findings), [{ code: 'E_SCHEMA', machine: null, path: '$' }]);
});

test('json store: a *.status.mmd file in machines fails E_STORE_MIXED', () => {
  const root = tempRoot();
  write(root, 'machines/order.status.mmd', '---\ntitle: order\n---\n');
  assert.deepEqual(shape(jsonStore(root).load().findings), [{ code: 'E_STORE_MIXED', machine: null, path: '$' }]);
});

test('json store: a machine file that is not valid JSON fails E_SCHEMA', () => {
  const root = tempRoot();
  write(root, 'machines/order.status.json', '{ "machine": ');
  assert.deepEqual(shape(jsonStore(root).load().findings), [{ code: 'E_SCHEMA', machine: null, path: '$' }]);
});

test('json store: a lock whose entries do not have the lock shape fails E_SCHEMA at the entry', () => {
  const codes = tempRoot();
  write(codes, 'status.lock.json', '{ "order": { "codes": { "x": "draft" }, "reserved": [] } }');
  assert.deepEqual(shape(jsonStore(codes).load().findings), [{ code: 'E_SCHEMA', machine: 'order', path: '$.order.codes' }]);
  const reserved = tempRoot();
  write(reserved, 'status.lock.json', '{ "order": { "codes": {}, "reserved": ["3"] } }');
  assert.deepEqual(shape(jsonStore(reserved).load().findings), [{ code: 'E_SCHEMA', machine: 'order', path: '$.order.reserved' }]);
});

test('json store: save writes the canonical bytes whatever the key order of the input', () => {
  const root = tempRoot();
  const definitions = [
    {
      machine: 'order',
      states: [{ code: 1, key: 'draft', initial: true }, { code: 2, key: 'done', final: true }],
      events: [{ edges: [{ to: 'done', from: 'draft' }], key: 'next' }],
    },
    { machine: 'track', states: [{ final: true, initial: true, code: 1, key: 'only' }], events: [] },
  ];
  const lock = { track: { reserved: [], codes: { 1: 'only' } }, order: { reserved: [3], codes: { 2: 'done', 1: 'draft' } } };
  jsonStore(root).save({ definitions, lock });
  assert.equal(readFileSync(path.join(root, 'machines/order.status.json'), 'utf8'), ORDER_TEXT);
  assert.equal(readFileSync(path.join(root, 'machines/track.status.json'), 'utf8'), TRACK_TEXT);
  assert.equal(readFileSync(path.join(root, 'status.lock.json'), 'utf8'), LOCK_TEXT);
});

test('json store: save deletes the machine files that are no longer defined', () => {
  const root = tempRoot();
  write(root, 'machines/order.status.json', ORDER_TEXT);
  write(root, 'machines/track.status.json', TRACK_TEXT);
  const track = { machine: 'track', states: [{ key: 'only', code: 1, initial: true, final: true }], events: [] };
  jsonStore(root).save({ definitions: [track], lock: { track: { codes: { 1: 'only' }, reserved: [] } } });
  assert.equal(existsSync(path.join(root, 'machines/order.status.json')), false);
  assert.equal(readFileSync(path.join(root, 'machines/track.status.json'), 'utf8'), TRACK_TEXT);
});

test('json store: a canonical checkout changes no byte on save(load())', () => {
  const root = tempRoot();
  write(root, 'machines/order.status.json', ORDER_TEXT);
  write(root, 'machines/track.status.json', TRACK_TEXT);
  write(root, 'status.lock.json', LOCK_TEXT);
  const before = bytesOf(root);
  const store = jsonStore(root);
  const loaded = store.load();
  assert.deepEqual(shape(loaded.findings), []);
  store.save({ definitions: loaded.definitions, lock: loaded.lock });
  assert.equal(bytesOf(root), before);
});

test('json store: the lock of a single machine is written as ORDER_LOCK_TEXT', () => {
  const root = tempRoot();
  jsonStore(root).save({
    definitions: [{ machine: 'order', states: [{ key: 'draft', code: 1, initial: true }, { key: 'done', code: 2, final: true }], events: [{ key: 'next', edges: [{ from: 'draft', to: 'done' }] }] }],
    lock: { order: { codes: { 1: 'draft', 2: 'done' }, reserved: [] } },
  });
  assert.equal(readFileSync(path.join(root, 'status.lock.json'), 'utf8'), ORDER_LOCK_TEXT);
});
