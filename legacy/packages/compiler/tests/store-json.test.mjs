// Tests of the JSON store of packages/compiler/src/store-json/store.mjs (docs/spec/fsm.md, B-2 and B-3): the load
// findings, the canonical bytes of save, the deletion of undefined machine files and the round trip of a canonical checkout.
// Every case runs in its own temporary directory, which is removed when the file's tests end.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';
import { jsonStore } from '../src/store-json/store.mjs';
import { LOCK_TEXT, ORDER_LOCK_TEXT, ORDER_TEXT, TRACK_TEXT } from './canonical-texts.mjs';
import { bytesOf, removeRoots, tempRoot, write } from './checkout.mjs';
import { storeContract } from './store-contract.mjs';
import { assertLoadsOneMachine, assertSaveKeepsBytes } from './store-asserts.mjs';
import { shapeFindings as shape } from './order-machines.mjs';

after(removeRoots);

storeContract('json', () => {
  const root = tempRoot();
  return { store: jsonStore(root), snapshot: () => bytesOf(root) };
});

test('json store: a missing lock file is the empty lock', async () => {
  const root = tempRoot();
  write(root, 'machines/order.fsm.json', ORDER_TEXT);
  await assertLoadsOneMachine(jsonStore(root));
});

test('json store: load strips the top-level $schema', async () => {
  const root = tempRoot();
  write(root, 'machines/order.fsm.json', ORDER_TEXT);
  const [definition] = (await jsonStore(root).load()).definitions;
  assert.equal(Object.hasOwn(definition, '$schema'), false);
  assert.equal(definition.machine, 'order');
});

test('json store: load reads the machine files in name order', async () => {
  const root = tempRoot();
  write(root, 'machines/track.fsm.json', TRACK_TEXT);
  write(root, 'machines/order.fsm.json', ORDER_TEXT);
  assert.deepEqual((await jsonStore(root).load()).definitions.map(definition => definition.machine), ['order', 'track']);
});

test('json store: a file whose name is not <machine>.fsm.json fails E_SCHEMA at $.machine', async () => {
  const root = tempRoot();
  write(root, 'machines/wrong.fsm.json', ORDER_TEXT);
  assert.deepEqual(shape((await jsonStore(root).load()).findings), [{ code: 'E_SCHEMA', machine: 'order', path: '$.machine' }]);
});

test('json store: a file in machines that is not a fsm file fails E_SCHEMA', async () => {
  const root = tempRoot();
  write(root, 'machines/notes.txt', 'not a machine');
  assert.deepEqual(shape((await jsonStore(root).load()).findings), [{ code: 'E_SCHEMA', machine: null, path: '$' }]);
});

test('json store: a *.fsm.mmd file in machines fails E_STORE_MIXED', async () => {
  const root = tempRoot();
  write(root, 'machines/order.fsm.mmd', '---\ntitle: order\n---\n');
  assert.deepEqual(shape((await jsonStore(root).load()).findings), [{ code: 'E_STORE_MIXED', machine: null, path: '$' }]);
});

test('json store: a machine file that is not valid JSON fails E_SCHEMA', async () => {
  const root = tempRoot();
  write(root, 'machines/order.fsm.json', '{ "machine": ');
  assert.deepEqual(shape((await jsonStore(root).load()).findings), [{ code: 'E_SCHEMA', machine: null, path: '$' }]);
});

test('json store: a lock whose entries do not have the lock shape fails E_SCHEMA at the entry', async () => {
  const codes = tempRoot();
  write(codes, 'fsm.lock.json', '{ "order": { "codes": { "x": "draft" }, "reserved": [] } }');
  assert.deepEqual(shape((await jsonStore(codes).load()).findings), [{ code: 'E_SCHEMA', machine: 'order', path: '$.order.codes' }]);
  const reserved = tempRoot();
  write(reserved, 'fsm.lock.json', '{ "order": { "codes": {}, "reserved": ["3"] } }');
  assert.deepEqual(shape((await jsonStore(reserved).load()).findings), [{ code: 'E_SCHEMA', machine: 'order', path: '$.order.reserved' }]);
});

test('json store: save writes the canonical bytes whatever the key order of the input', async () => {
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
  await jsonStore(root).save({ definitions, lock });
  assert.equal(readFileSync(path.join(root, 'machines/order.fsm.json'), 'utf8'), ORDER_TEXT);
  assert.equal(readFileSync(path.join(root, 'machines/track.fsm.json'), 'utf8'), TRACK_TEXT);
  assert.equal(readFileSync(path.join(root, 'fsm.lock.json'), 'utf8'), LOCK_TEXT);
});

test('json store: save deletes the machine files that are no longer defined', async () => {
  const root = tempRoot();
  write(root, 'machines/order.fsm.json', ORDER_TEXT);
  write(root, 'machines/track.fsm.json', TRACK_TEXT);
  const track = { machine: 'track', states: [{ key: 'only', code: 1, initial: true, final: true }], events: [] };
  await jsonStore(root).save({ definitions: [track], lock: { track: { codes: { 1: 'only' }, reserved: [] } } });
  assert.equal(existsSync(path.join(root, 'machines/order.fsm.json')), false);
  assert.equal(readFileSync(path.join(root, 'machines/track.fsm.json'), 'utf8'), TRACK_TEXT);
});

test('json store: a canonical checkout changes no byte on save(load())', async () => {
  const root = tempRoot();
  write(root, 'machines/order.fsm.json', ORDER_TEXT);
  write(root, 'machines/track.fsm.json', TRACK_TEXT);
  write(root, 'fsm.lock.json', LOCK_TEXT);
  await assertSaveKeepsBytes(jsonStore(root), root);
});

test('json store: the lock of a single machine is written as ORDER_LOCK_TEXT', async () => {
  const root = tempRoot();
  await jsonStore(root).save({
    definitions: [{ machine: 'order', states: [{ key: 'draft', code: 1, initial: true }, { key: 'done', code: 2, final: true }], events: [{ key: 'next', edges: [{ from: 'draft', to: 'done' }] }] }],
    lock: { order: { codes: { 1: 'draft', 2: 'done' }, reserved: [] } },
  });
  assert.equal(readFileSync(path.join(root, 'fsm.lock.json'), 'utf8'), ORDER_LOCK_TEXT);
});
