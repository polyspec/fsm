// The canonical Mermaid text of a machine (docs/spec/fsm.md, B-1): the frontmatter, one state line per state in state order,
// the initial line, the edges event by event (edge order within an event), and one final line per final state in state order,
// with 4 spaces of indentation and a final line break. mermaidText refuses a definition that this form cannot carry: it throws
// before anything is written. It does not check the rules of B-5; the core does before every save.

import { KEY_PATTERN } from '../core/validate.mjs';

/** True when `value` is a string in the key format of B-5. */
const isKey = value => typeof value === 'string' && KEY_PATTERN.test(value);

/** The canonical text of `definition` ({ machine, states, events }). */
export function mermaidText(definition) {
  const { machine, states, events } = definition;
  const refuse = reason => {
    throw new Error(`mermaid store cannot write ${machine}: ${reason}`);
  };
  if (!isKey(machine)) refuse(`machine key ${machine} is not lower case letters and digits joined by single underscores`);
  const described = new Set();
  for (const state of states) {
    if (!isKey(state.key)) refuse(`state key ${state.key} is not lower case letters and digits joined by single underscores`);
    if (described.has(state.key)) refuse(`state key ${state.key} is repeated`);
    if (!Number.isSafeInteger(state.code) || state.code < 0) refuse(`the code of ${state.key} is not a non-negative integer`);
    described.add(state.key);
  }
  const initials = states.filter(state => state.initial === true);
  if (initials.length !== 1) refuse('a machine must have exactly one initial state');
  const eventKeys = new Set();
  for (const event of events) {
    if (!isKey(event.key)) refuse(`event key ${event.key} is not lower case letters and digits joined by single underscores`);
    if (eventKeys.has(event.key)) refuse(`event key ${event.key} is repeated`);
    eventKeys.add(event.key);
    if (event.edges.length === 0) refuse(`event ${event.key} has no edge`);
    for (const edge of event.edges) {
      if (!described.has(edge.from) || !described.has(edge.to)) {
        refuse(`edge ${edge.from} -> ${edge.to} of ${event.key} names a state that is not a state of the machine`);
      }
    }
  }
  const lines = ['---', `title: ${machine}`, '---', 'stateDiagram-v2'];
  for (const state of states) lines.push(`    ${state.key} : ${state.code}`);
  lines.push(`    [*] --> ${initials[0].key}`);
  for (const event of events) {
    for (const edge of event.edges) lines.push(`    ${edge.from} --> ${edge.to} : ${event.key}`);
  }
  for (const state of states) {
    if (state.final === true) lines.push(`    ${state.key} --> [*]`);
  }
  return `${lines.join('\n')}\n`;
}
