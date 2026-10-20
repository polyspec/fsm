// The go backend (docs/spec/fsm.md, B-4 and B-6; docs/plans/fsm-v1/plan.md, C-2): the generated `src/` files of a go package.
// It takes the IRs of the machines (normalize.mjs), in definition order,
// the lock and the options { module }, the module path of the package, and returns the text of every file; it writes nothing.
// The output is deterministic: declaration order, tab indentation and a final line break. The generated code has no runtime
// dependency beyond the standard library and the shared package of the module (`<module>/src/fsm`), which the module path
// names: a Go import needs it, and the backend cannot read go.mod. The core imports nothing from node:.

import { SHARED, header, pascal, text } from './common.mjs';


/** A Go string literal of a value that holds no quote, backslash or control character (keys, codes and messages built here). */
const quoted = value => JSON.stringify(value);

/** The lines of `rows`, each a list of cells, with every column padded to its widest cell except the last one (gofmt alignment). */
function aligned(rows) {
  const widths = [];
  for (const row of rows) row.slice(0, -1).forEach((cell, index) => { widths[index] = Math.max(widths[index] ?? 0, cell.length); });
  return rows.map(row => row.map((cell, index) => (index < row.length - 1 ? cell.padEnd(widths[index] + 1) : cell)).join(''));
}

/** The shared package: the error codes of B-4, B-5 and B-6 that the functions throw, and the Error type of every machine. */
const FSM_GO = text([
  header(SHARED),
  '',
  '// Package fsm holds the error type and the error codes of the state machines (docs/spec/fsm.md, B-4 and B-6).',
  'package fsm',
  '',
  '// The error codes that the functions of every machine return.',
  'const (',
  ...aligned([
    ['\tCodeConflict', '= "E_CONFLICT"'],
    ['\tCodeInvalidTransition', '= "E_INVALID_TRANSITION"'],
    ['\tCodeUnknownCode', '= "E_UNKNOWN_CODE"'],
    ['\tCodeReservedCode', '= "E_RESERVED_CODE"'],
  ]),
  ')',
  '',
  '// Error is the error of a machine function. Expected, Actual and Event hold the arguments of the function that failed; zero',
  '// means unset, because a state code is at least 1 and an event position starts at 1.',
  'type Error struct {',
  ...aligned([
    ['\tCode', 'string'],
    ['\tMessage', 'string'],
    ['\tExpected', 'int32'],
    ['\tActual', 'int32'],
    ['\tEvent', 'int32'],
  ]),
  '}',
  '',
  '// Error returns the message of the error.',
  'func (e *Error) Error() string {',
  '\treturn e.Message',
  '}',
]);

/** The machine package of `ir` with its reserved codes from `lock`: the types, the members and the functions of B-6. */
function machineGo(ir, lock, { module }) {
  const { machine, initial, states, events, transitions } = ir;
  const reserved = [...lock[machine].reserved].sort((a, b) => a - b);
  const stateOf = key => `State${pascal(key)}`;
  const eventOf = key => `Event${pascal(key)}`;
  const outgoing = state => events.filter(event => transitions.some(item => item.state === state.key && item.event === event.key));
  const toOf = (state, event) => transitions.find(item => item.state === state && item.event === event).to;
  const lines = [
    header(machine),
    '',
    `// Package ${machine} is the state machine ${machine}: its states, its events and their functions (docs/spec/fsm.md, B-6).`,
    `package ${machine}`,
    '',
    'import (',
    '\t"fmt"',
    '',
    `\t"${module}/src/${SHARED}"`,
    ')',
    '',
    `// State is a state of ${machine}; its value is its code.`,
    'type State int32',
    '',
    `// The states of ${machine}.`,
    'const (',
    ...aligned(states.map(state => [`\t${stateOf(state.key)}`, 'State', `= ${state.code}`])),
    ')',
    '',
    `// Event is an event of ${machine}; its value is its position in the declaration, from 1.`,
    'type Event int32',
    '',
    `// The events of ${machine}.`,
    // An empty const block is written on one line, as gofmt prints it.
    ...(events.length === 0 ? ['const ()'] : [
      'const (',
      ...aligned(events.map((event, index) => [`\t${eventOf(event.key)}`, 'Event', `= ${index + 1}`])),
      ')',
    ]),
    '',
    '// Step is the result of Apply: the state that the event leads to, and whether the stored state changed.',
    'type Step struct {',
    ...aligned([['\tTo', 'State'], ['\tChanged', 'bool']]),
    '}',
    '',
    `// unknownState is the error of a value that is no state of ${machine}.`,
    'func unknownState(value int64) error {',
    `\treturn &fsm.Error{Code: fsm.CodeUnknownCode, Message: fmt.Sprintf("${machine}: %d is not a state of ${machine}", value)}`,
    '}',
    '',
    `// invalidTransition is the error of an event that has no edge from the state of ${machine}.`,
    'func invalidTransition(expected State, event Event) error {',
    `\treturn &fsm.Error{Code: fsm.CodeInvalidTransition, Message: fmt.Sprintf("${machine}: the event %d has no edge from %d", event, expected), Expected: int32(expected), Event: int32(event)}`,
    '}',
    '',
    `// Initial returns the initial state of ${machine}.`,
    'func Initial() State {',
    `\treturn ${stateOf(initial)}`,
    '}',
    '',
    '// Code returns the code of a state, which is its value; E_UNKNOWN_CODE for a value that is no state.',
    'func Code(state State) (int32, error) {',
    '\tswitch state {',
    ...states.map(state => `\tcase ${stateOf(state.key)}:\n\t\treturn ${state.code}, nil`),
    '\tdefault:',
    '\t\treturn 0, unknownState(int64(state))',
    '\t}',
    '}',
    '',
    '// Key returns the key of a state.',
    'func Key(state State) (string, error) {',
    '\tswitch state {',
    ...states.map(state => `\tcase ${stateOf(state.key)}:\n\t\treturn ${quoted(state.key)}, nil`),
    '\tdefault:',
    '\t\treturn "", unknownState(int64(state))',
    '\t}',
    '}',
    '',
    '// FromCode returns the state of a code: E_RESERVED_CODE for a reserved code, E_UNKNOWN_CODE for any other value, and for a',
    '// value that is not an integer, whatever its type (docs/spec/fsm.md, B-6).',
    'func FromCode(value any) (State, error) {',
    '\tvar code int64',
    '\tswitch v := value.(type) {',
    '\tcase int:',
    '\t\tcode = int64(v)',
    '\tcase int64:',
    '\t\tcode = v',
    '\tdefault:',
    `\t\treturn 0, &fsm.Error{Code: fsm.CodeUnknownCode, Message: fmt.Sprintf("${machine}: %v (%T) is not a code of ${machine}: a code is an integer", value, value)}`,
    '\t}',
    '\tswitch code {',
    ...states.map(state => `\tcase ${state.code}:\n\t\treturn ${stateOf(state.key)}, nil`),
    ...reserved.map(item => `\tcase ${item}:\n\t\treturn 0, &fsm.Error{Code: fsm.CodeReservedCode, Message: "${machine}: code ${item} is reserved and is no state of ${machine}"}`),
    '\tdefault:',
    '\t\treturn 0, unknownState(code)',
    '\t}',
    '}',
    '',
    '// IsFinal reports whether a state is final.',
    'func IsFinal(state State) (bool, error) {',
    '\tswitch state {',
    ...states.map(state => `\tcase ${stateOf(state.key)}:\n\t\treturn ${state.final}, nil`),
    '\tdefault:',
    '\t\treturn false, unknownState(int64(state))',
    '\t}',
    '}',
    '',
    '// EventsFrom returns the events that have an edge from a state, in declaration order.',
    'func EventsFrom(state State) ([]Event, error) {',
    '\tswitch state {',
    ...states.map((state) => {
      const list = outgoing(state).map(event => eventOf(event.key));
      return `\tcase ${stateOf(state.key)}:\n\t\treturn []Event{${list.join(', ')}}, nil`;
    }),
    '\tdefault:',
    '\t\treturn nil, unknownState(int64(state))',
    '\t}',
    '}',
    '',
    '// Target returns the state that an event leads to from the expected state; E_INVALID_TRANSITION when the event has no edge from it.',
    'func Target(expected State, event Event) (State, error) {',
    '\tswitch expected {',
    ...states.flatMap((state) => {
      const edges = outgoing(state);
      if (edges.length === 0) return [`\tcase ${stateOf(state.key)}:\n\t\treturn 0, invalidTransition(expected, event)`];
      return [
        `\tcase ${stateOf(state.key)}:`,
        '\t\tswitch event {',
        ...edges.map(edge => `\t\tcase ${eventOf(edge.key)}:\n\t\t\treturn ${stateOf(toOf(state.key, edge.key))}, nil`),
        '\t\tdefault:',
        '\t\t\treturn 0, invalidTransition(expected, event)',
        '\t\t}',
      ];
    }),
    '\tdefault:',
    '\t\treturn 0, unknownState(int64(expected))',
    '\t}',
    '}',
    '',
    '// Apply applies an event that the observed state expected leads to, when the stored state is actual (docs/spec/fsm.md, B-4).',
    'func Apply(expected State, event Event, actual State) (Step, error) {',
    '\tto, err := Target(expected, event)',
    '\tif err != nil {',
    '\t\treturn Step{}, err',
    '\t}',
    '\tif _, err := Code(actual); err != nil {',
    '\t\treturn Step{}, err',
    '\t}',
    '\tif actual == expected {',
    '\t\treturn Step{To: to, Changed: true}, nil',
    '\t}',
    '\tif actual == to {',
    '\t\treturn Step{To: to, Changed: false}, nil',
    '\t}',
    `\treturn Step{}, &fsm.Error{Code: fsm.CodeConflict, Message: fmt.Sprintf("${machine}: the stored state %d is neither %d nor %d", actual, expected, to), Expected: int32(expected), Actual: int32(actual), Event: int32(event)}`,
    '}',
  ];
  return text(lines);
}

/**
 * The files of the go package `src/` for the machines `irs` (their IRs in definition order), the lock and the options
 * { module } (the module path of the package): `<machine>/<machine>.go` per machine, then `fsm/fsm.go`. Each file is
 * { path, content }, and the path is relative to `src/`.
 */
export function files(irs, lock, { module } = {}) {
  if (typeof module !== 'string' || module === '') throw new Error('go: the module path of the package is required');
  const out = [];
  for (const ir of irs) {
    if (!Object.hasOwn(lock, ir.machine)) throw new Error(`go: the lock has no entry for machine ${ir.machine}`);
    out.push({ path: `${ir.machine}/${ir.machine}.go`, content: machineGo(ir, lock, { module }) });
  }
  out.push({ path: `${SHARED}/${SHARED}.go`, content: FSM_GO });
  return out;
}
