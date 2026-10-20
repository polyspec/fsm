// The order machines that the unit tests of the core share (docs/spec/fsm.md, B-1), each a function that returns a new object, so a
// test may change it: of two states, of three states (draft, paid, done) with the lock that matches it, and of five states.

/** The order machine of two states: draft -next-> done. */
export const twoStateOrder = () => ({
  machine: 'order',
  states: [{ key: 'draft', code: 1, initial: true }, { key: 'done', code: 2, final: true }],
  events: [{ key: 'next', edges: [{ from: 'draft', to: 'done' }] }],
});

/** The order machine of three states: draft (initial) -next-> paid -next-> done (final). */
export const threeStateOrder = () => ({
  machine: 'order',
  states: [{ key: 'draft', code: 1, initial: true }, { key: 'paid', code: 2 }, { key: 'done', code: 3, final: true }],
  events: [{ key: 'next', edges: [{ from: 'draft', to: 'paid' }, { from: 'paid', to: 'done' }] }],
});

/** The lock that matches the order machine of three states. */
export const threeStateLock = () => ({ order: { codes: { 1: 'draft', 2: 'paid', 3: 'done' }, reserved: [] } });

/** The order machine of five states, with next, prev and cancel. */
export const fiveStateOrder = () => ({
  machine: 'order',
  states: [
    { key: 'draft', code: 1, initial: true }, { key: 'paid', code: 2 },
    { key: 'shipped', code: 3 }, { key: 'done', code: 4, final: true },
    { key: 'canceled', code: 5, final: true },
  ],
  events: [
    { key: 'next', edges: [{ from: 'draft', to: 'paid' }, { from: 'paid', to: 'shipped' }, { from: 'shipped', to: 'done' }] },
    { key: 'prev', edges: [{ from: 'paid', to: 'draft' }, { from: 'shipped', to: 'paid' }] },
    { key: 'cancel', edges: [{ from: 'draft', to: 'canceled' }, { from: 'paid', to: 'canceled' }] },
  ],
});

/** The findings as {code, machine, path}. */
export const shapeFindings = findings => findings.map(({ code, machine, path }) => ({ code, machine, path }));
