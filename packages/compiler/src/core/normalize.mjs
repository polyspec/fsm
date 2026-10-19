// The IR of a valid definition (docs/plans/fsm-v1/plan.md, C-5): one plain JSON object that every backend consumes. The states
// and the events keep their declaration order, and the transitions follow the state order, then the event order.
// The core imports nothing from node:, so the GUI runs it in a browser.

import { validate } from './validate.mjs';

/**
 * The IR of `definition`: { machine, initial, states: [{key, code, final}], events: [{key}], transitions: [{state, event, to}] }.
 * The definition must pass validate; an invalid one is a programming error, so it throws instead of returning findings.
 */
export function normalize(definition) {
  const [first] = validate([definition]);
  if (first !== undefined) throw new Error(`normalize: the definition is not valid (${first.code} at ${first.path})`);
  const { machine, states, events } = definition;
  const initial = states.find(state => state.initial === true).key;
  const transitions = [];
  for (const state of states) {
    for (const event of events) {
      for (const edge of event.edges) {
        if (edge.from === state.key) transitions.push({ state: state.key, event: event.key, to: edge.to });
      }
    }
  }
  return {
    machine,
    initial,
    states: states.map(state => ({ key: state.key, code: state.code, final: state.final === true })),
    events: events.map(event => ({ key: event.key })),
    transitions,
  };
}
