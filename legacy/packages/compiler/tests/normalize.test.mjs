// Tests of the IR of packages/compiler/src/core/normalize.mjs (docs/plans/fsm-v1/plan.md, C-5): the IR keeps the
// declaration order of the states and the events, and its transitions follow that order, so every backend reads one IR.
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalize } from '../src/core/normalize.mjs';
import { fiveStateOrder as order } from './order-machines.mjs';

test('the IR of the order example has the exact states, events and transitions', () => {
  assert.deepEqual(normalize(order()), {
    machine: 'order',
    initial: 'draft',
    states: [
      { key: 'draft', code: 1, final: false },
      { key: 'paid', code: 2, final: false },
      { key: 'shipped', code: 3, final: false },
      { key: 'done', code: 4, final: true },
      { key: 'canceled', code: 5, final: true },
    ],
    events: [{ key: 'next' }, { key: 'prev' }, { key: 'cancel' }],
    transitions: [
      { state: 'draft', event: 'next', to: 'paid' },
      { state: 'draft', event: 'cancel', to: 'canceled' },
      { state: 'paid', event: 'next', to: 'shipped' },
      { state: 'paid', event: 'prev', to: 'draft' },
      { state: 'paid', event: 'cancel', to: 'canceled' },
      { state: 'shipped', event: 'next', to: 'done' },
      { state: 'shipped', event: 'prev', to: 'paid' },
    ],
  });
});

test('the IR follows the declaration order, not the codes or the sorted keys', () => {
  const definition = {
    machine: 'swap',
    states: [{ key: 'start', code: 9, initial: true }, { key: 'end', code: 1, final: true }],
    events: [
      { key: 'zed', edges: [{ from: 'start', to: 'end' }] },
      { key: 'abe', edges: [{ from: 'start', to: 'end' }] },
    ],
  };
  assert.deepEqual(normalize(definition), {
    machine: 'swap',
    initial: 'start',
    states: [{ key: 'start', code: 9, final: false }, { key: 'end', code: 1, final: true }],
    events: [{ key: 'zed' }, { key: 'abe' }],
    transitions: [
      { state: 'start', event: 'zed', to: 'end' },
      { state: 'start', event: 'abe', to: 'end' },
    ],
  });
});

test('normalize throws a programming error for a definition that is not valid', () => {
  assert.throws(() => normalize({ machine: 'order', states: [], events: [] }), /is not valid/);
});
