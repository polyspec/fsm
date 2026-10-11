// The canonical Mermaid parser (docs/spec/fsm.md, B-1): reads the text of one machine file in the order that mermaidText
// writes. Every line outside that form is refused with one E_MERMAID_UNSUPPORTED finding, its 1-based line number in the
// message and the path $. A line is recognised by its content and then checked against the canonical form: a line with the
// right content but another indentation is refused, and its content is still recorded, so that the lines that name its state
// are not refused as well. Each line gives at most one finding. A text with any finding gives no definition, so no partial
// definition is ever returned.

import { KEY_PATTERN } from '../core/validate.mjs';

const TITLE = /^title: (\S+)$/;
const LABEL = /^ *state "([^"]*)" as (\S+)$/;
const STATE = /^ *(\S+) : (\S+)$/;
const INITIAL = /^ *\[\*\] --> (\S+)$/;
const EDGE = /^ *(\S+) --> (\S+) : (\S+)$/;
const FINAL = /^ *(\S+) --> \[\*\]$/;
const INDENT = /^ {4}\S/;
const CODE = /^(0|[1-9][0-9]*)$/;

/** True when `value` is a string in the key format of B-5. */
const isKey = value => typeof value === 'string' && KEY_PATTERN.test(value);

/**
 * Parses `text`, the content of the file <fileMachine>.fsm.mmd. Returns { findings, definition }: definition ({ machine,
 * states, events }) is present only when findings is empty. The phases are the order of the canonical form: the states, the
 * initial line, the edges, then the final lines. A line of a later phase in an earlier position is refused where it stands.
 */
export function parseMermaid(text, fileMachine) {
  const findings = [];
  const refused = new Set();
  const refuse = (line, expected) => {
    if (refused.has(line)) return;
    refused.add(line);
    findings.push({
      code: 'E_MERMAID_UNSUPPORTED',
      machine: fileMachine,
      path: '$',
      message: `line ${line} is not the canonical form: ${expected}`,
    });
  };
  if (text === '') {
    refuse(1, 'the file is empty; it starts with ---');
    return { findings, definition: undefined };
  }
  const endsWithBreak = text.endsWith('\n');
  const lines = (endsWithBreak ? text.slice(0, -1) : text).split('\n');
  if (!endsWithBreak) refuse(lines.length, 'the file does not end with a line break');
  if (lines.length < 4) {
    refuse(lines.length + 1, 'the header ---, title: <machine>, ---, stateDiagram-v2 is missing');
    return { findings, definition: undefined };
  }
  if (lines[0] !== '---') refuse(1, 'expected the line ---');
  const title = TITLE.exec(lines[1]);
  if (title === null || !isKey(title[1])) refuse(2, 'expected title: <machine key>');
  if (lines[2] !== '---') refuse(3, 'expected the line ---');
  if (lines[3] !== 'stateDiagram-v2') refuse(4, 'expected the line stateDiagram-v2');

  const states = [];
  const indexOf = new Map();
  const events = [];
  const seenEvents = new Set();
  let phase = 'states';
  let sawInitial = false;
  let pending = null;
  let lastFinal = -1;

  /** Marks the state `key` as final for the final line at `at`; returns the index of the state, or the last final index when refused. */
  const finalLine = (key, at) => {
    if (!isKey(key) || !indexOf.has(key)) {
      refuse(at, `the state ${key} of the final line is not described before it`);
      return lastFinal;
    }
    const index = indexOf.get(key);
    if (index <= lastFinal) {
      refuse(at, 'the final lines follow the order of the states');
      return lastFinal;
    }
    states[index].final = true;
    return index;
  };

  for (let index = 4; index < lines.length; index += 1) {
    const line = lines[index];
    const at = index + 1;
    if (phase === 'states') {
      const label = LABEL.exec(line);
      const state = STATE.exec(line);
      const initial = INITIAL.exec(line);
      if (pending !== null) {
        const expectedKey = pending.key;
        pending = null;
        if (state !== null && state[1] === expectedKey) {
          if (!INDENT.test(line)) refuse(at, 'a state line is indented by exactly 4 spaces');
          const code = state[2];
          if (!CODE.test(code) || !Number.isSafeInteger(Number(code))) {
            refuse(at, `the code of ${expectedKey} is not a decimal integer without a leading zero`);
          }
          states[indexOf.get(expectedKey)].code = Number(code);
        } else {
          refuse(at, `expected the description line ${expectedKey} : <code> right after its label line`);
        }
      } else if (label !== null) {
        const [, text, key] = label;
        if (!INDENT.test(line)) refuse(at, 'a state line is indented by exactly 4 spaces');
        if (!isKey(key)) {
          refuse(at, 'expected the label line state "<key>" as <key>, with a key of lower case letters and digits joined by single underscores');
        } else if (indexOf.has(key)) {
          refuse(at, `state ${key} is described twice`);
        } else {
          indexOf.set(key, states.length);
          states.push({ key, code: undefined });
          if (text !== key) refuse(at, `the label "${text}" of ${key} is not its key; the label of a state is its key`);
          pending = { key, at };
        }
      } else if (state !== null) {
        // The description is recorded, so that the lines that name its state are not refused as well (one finding per line).
        refuse(at, 'expected the label line state "<key>" as <key> before the description line of a state');
        const [, key, code] = state;
        if (isKey(key) && !indexOf.has(key)) {
          indexOf.set(key, states.length);
          states.push({ key, code: Number(code) });
        }
      } else if (initial !== null) {
        sawInitial = true;
        phase = 'edges';
        if (!INDENT.test(line)) refuse(at, 'the initial line is indented by exactly 4 spaces');
        if (!isKey(initial[1]) || !indexOf.has(initial[1])) {
          refuse(at, `the initial state ${initial[1]} is not described before the initial line`);
        } else {
          states[indexOf.get(initial[1])].initial = true;
        }
      } else {
        refuse(at, 'expected a label line state "<key>" as <key>, or the initial line [*] --> <state> after the states');
      }
    } else if (phase === 'edges') {
      const edge = EDGE.exec(line);
      const final = FINAL.exec(line);
      if (edge !== null) {
        const [, from, to, event] = edge;
        if (!INDENT.test(line)) refuse(at, 'an edge line is indented by exactly 4 spaces');
        if (!isKey(from) || !indexOf.has(from) || !isKey(to) || !indexOf.has(to) || !isKey(event)) {
          refuse(at, 'expected an edge line whose states are described and whose event has a key');
        } else if (event !== events.at(-1)?.key) {
          if (seenEvents.has(event)) {
            refuse(at, `event ${event} reappears after another event; the edges of an event are contiguous`);
          } else {
            seenEvents.add(event);
            events.push({ key: event, edges: [{ from, to }] });
          }
        } else {
          events.at(-1).edges.push({ from, to });
        }
      } else if (final !== null) {
        phase = 'finals';
        if (!INDENT.test(line)) refuse(at, 'a final line is indented by exactly 4 spaces');
        lastFinal = finalLine(final[1], at);
      } else {
        refuse(at, 'expected an edge line, or a final line [*] after the edges');
      }
    } else {
      const final = FINAL.exec(line);
      if (final === null) {
        refuse(at, 'expected a final line <state> --> [*] after the final lines');
      } else {
        if (!INDENT.test(line)) refuse(at, 'a final line is indented by exactly 4 spaces');
        lastFinal = finalLine(final[1], at);
      }
    }
  }
  if (pending !== null) refuse(pending.at, `the description line ${pending.key} : <code> after its label line is missing`);
  if (!sawInitial) refuse(lines.length + 1, 'the initial line [*] --> <state> is missing');
  if (findings.length > 0) return { findings, definition: undefined };
  return {
    findings,
    definition: {
      machine: title[1],
      states: states.map(state => {
        const out = { key: state.key, code: state.code };
        if (state.initial === true) out.initial = true;
        if (state.final === true) out.final = true;
        return out;
      }),
      events,
    },
  };
}
