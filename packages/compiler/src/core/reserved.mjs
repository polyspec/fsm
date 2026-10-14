// The fixed lists of reserved keys of docs/spec/fsm.md, B-5. A key on a list is rejected with E_KEY_RESERVED and is never
// altered. The core imports nothing from node:, so the lists are plain constants that the GUI can read in a browser.

/**
 * Machine keys of the generated files: `fsm` is the shared module, `index` the npm entry file, `lib` and `main` the rust
 * and go entries, `internal` a go package that tests cannot import, `init` a name go rejects for an imported package,
 * `testdata` and `vendor` the directories that go `./...` skips.
 */
export const MACHINE_FIXED = Object.freeze(['fsm', 'index', 'lib', 'main', 'internal', 'init', 'testdata', 'vendor']);

/**
 * Machine keys that the go test files of packages/go declare or import, by docs/spec/fsm.md B-5 (measured by S-39 with go 1.27.2):
 * `examples` is the import of the persist example in tests/vectors_test.go, `vectors` and `machines` are its package variables, and
 * `expectation` and `lookup` are package-level declarations of tests/conformance_test.go. A machine of any of these names fails
 * `go test ./...` ("redeclared in this block" or "already declared through import"). `tests` is not on the list: a machine of that
 * name builds and its tests pass.
 */
export const GO_TEST_NAMES = Object.freeze(['examples', 'vectors', 'machines', 'expectation', 'lookup']);

/** The predeclared identifiers of Go 1.25 (Go specification, Predeclared identifiers); an import of the name would shadow them. */
export const GO_PREDECLARED = Object.freeze([
  'any', 'bool', 'byte', 'comparable', 'complex64', 'complex128', 'error', 'float32', 'float64', 'int', 'int8', 'int16', 'int32',
  'int64', 'rune', 'string', 'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr', 'true', 'false', 'iota', 'nil',
  'append', 'cap', 'clear', 'close', 'complex', 'copy', 'delete', 'imag', 'len', 'make', 'max', 'min', 'new', 'panic', 'print',
  'println', 'real', 'recover',
]);

/** The keywords of Go 1.25. */
export const GO_KEYWORDS = Object.freeze([
  'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough', 'for', 'func', 'go', 'goto', 'if',
  'import', 'interface', 'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type', 'var',
]);

/**
 * The keywords of Rust, 2024 edition: the strict keywords and the reserved keywords. The weak keywords (such as `union`)
 * are identifiers, so they are not listed.
 */
export const RUST_KEYWORDS = Object.freeze([
  'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum', 'extern', 'false', 'fn', 'for', 'if',
  'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct',
  'super', 'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while',
  'abstract', 'become', 'box', 'do', 'final', 'gen', 'macro', 'override', 'priv', 'try', 'typeof', 'unsized', 'virtual', 'yield',
]);

/** The keywords of Python 3.13 (keyword.kwlist); the soft keywords (`match`, `case`, `type`, `_`) are identifiers. */
export const PYTHON_KEYWORDS = Object.freeze([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else',
  'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise',
  'return', 'try', 'while', 'with', 'yield',
]);

/** The reserved words of JavaScript (ECMAScript 2024) and the words reserved in strict mode. */
export const JS_KEYWORDS = Object.freeze([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum',
  'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null', 'return',
  'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
  'implements', 'interface', 'let', 'package', 'private', 'protected', 'public', 'static',
]);

/** The literals of the canonical form, which a machine key may not be (the mermaid title and the JSON literals). */
export const MACHINE_LITERALS = Object.freeze(['null', 'true', 'false']);

/** State and event keys whose pascal form is rejected as an enum member: `self` (rust `Self`) and `class` (php `Class`). */
export const STATE_EVENT_KEYS = Object.freeze(['self', 'class']);

/**
 * The words that a Mermaid stateDiagram-v2 state key may not be, whatever the store. The list is taken from the Mermaid
 * stateDiagram-v2 syntax; a parse test against the pinned Mermaid version checks it with the GUI, which owns the pinned package (S-16).
 */
export const MERMAID_STATE_KEYS = Object.freeze([
  'note', 'class', 'classdef', 'style', 'click', 'href', 'default', 'state', 'statediagram', 'scale', 'acctitle', 'accdescr',
  'root_start', 'root_end',
]);
