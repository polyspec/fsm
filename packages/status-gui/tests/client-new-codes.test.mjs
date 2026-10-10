// Tests of the codes that the browser gives the states added in the edit form (docs/plans/status-v1.md, C-7; docs/spec/status.md,
// B-3). The function is the one that client/main.ts calls with the next code of the page: a stored state keeps its code, and the
// added states take the next code and the codes after it, in the order of the rows. The server still checks every code on save.
import assert from 'node:assert/strict';
import test from 'node:test';
import { codesOfAddedRows } from '../client/new-codes.ts';

test('a stored state keeps its code, and an added state takes the next code', () => {
  assert.deepEqual(codesOfAddedRows([{ persisted: '1', code: '5' }, { persisted: '', code: '' }], 6), ['5', '6']);
});

test('several added states get consecutive codes in the order of the rows, between the stored ones', () => {
  const rows = [
    { persisted: '1', code: '1' },
    { persisted: '', code: '' },
    { persisted: '1', code: '2' },
    { persisted: '', code: '' },
    { persisted: '', code: '' },
  ];
  assert.deepEqual(codesOfAddedRows(rows, 6), ['1', '6', '2', '7', '8']);
});

test('the codes of the added states follow their rows when a row above them is removed', () => {
  const before = [{ persisted: '1', code: '4' }, { persisted: '', code: '5' }, { persisted: '', code: '6' }];
  assert.deepEqual(codesOfAddedRows(before, 5), ['4', '5', '6']);
  assert.deepEqual(codesOfAddedRows([before[0], before[2]], 5), ['4', '5']);
});

test('a form with stored states only keeps every code', () => {
  assert.deepEqual(codesOfAddedRows([{ persisted: '1', code: '1' }, { persisted: '1', code: '2' }], 3), ['1', '2']);
  assert.deepEqual(codesOfAddedRows([], 3), []);
});
