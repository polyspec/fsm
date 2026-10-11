<!-- doc-id: spec-fsm -->
# fsm definition

[한국어](fsm.ko.md)

## B-0. Adoption verdicts
- Adopted
  - Flat enum + explicit integer code
  - Event = a named set of edges (several edges allowed)
  - Generated `switch`/`match`, partial transition function
  - A single initial state; no transition out of a final state
  - Determinism guaranteed by validation
  - Pure functions
  - Three definition media (JSON, Mermaid, DB)
- Not adopted
  - Guards and conditional branches; entry/exit, callbacks, actions
  - Hierarchical and parallel states, history, automatic and delayed events, event queues, extended state
  - Wildcard `from`, self transitions, typestate
  - The orm dbspec `state_machine` and `checkbox` settings (they would be a second definition of the status column)
  - Runtime configuration loading, storing names as strings, labels/i18n
  - A separate sequence syntax (next/prev are ordinary events)
  - A storage width setting (codes are fixed to the 32-bit range)

## B-1. Definition model
A definition has only three parts:
- the machine name
- states: key, code, initial, final
- events: key, list of edges `{from, to}`…

| Concept | JSON | Mermaid (official syntax) | DB (orm) |
|---|---|---|---|
| Machine | `"machine": "order"` | frontmatter `title: order` | `machine(name)` |
| State·code | `{"key":"draft","code":1}` | `draft : 1` (state description) | `state(machine, key, code, initial, final, position)` |
| initial | `"initial": true` | `[*] --> draft` | `initial` |
| final | `"final": true` | `done --> [*]` | `final` |
| Edge | `{"key":"next","edges":[{"from":"draft","to":"paid"},…]}` | `draft --> paid : next` | `edge(machine, event, from, to, position)` + `event(machine, key, position)` |

Example (`order`, an order lifecycle, is only an example machine key):
```json
{
  "$schema": "../schema/fsm.schema.json",
  "machine": "order",
  "states": [
    { "key": "draft", "code": 1, "initial": true }, { "key": "paid", "code": 2 },
    { "key": "shipped", "code": 3 }, { "key": "done", "code": 4, "final": true },
    { "key": "canceled", "code": 5, "final": true }
  ],
  "events": [
    { "key": "next",   "edges": [{ "from": "draft", "to": "paid" }, { "from": "paid", "to": "shipped" }, { "from": "shipped", "to": "done" }] },
    { "key": "prev",   "edges": [{ "from": "paid", "to": "draft" }, { "from": "shipped", "to": "paid" }] },
    { "key": "cancel", "edges": [{ "from": "draft", "to": "canceled" }, { "from": "paid", "to": "canceled" }] }
  ]
}
```
```
---
title: order
---
stateDiagram-v2
    draft : 1
    paid : 2
    shipped : 3
    done : 4
    canceled : 5
    [*] --> draft
    draft --> paid : next
    paid --> shipped : next
    shipped --> done : next
    paid --> draft : prev
    shipped --> paid : prev
    draft --> canceled : cancel
    paid --> canceled : cancel
    done --> [*]
    canceled --> [*]
```
- Mermaid canonical form
  - The line order is fixed: state declarations (state order) → initial → edges in event order (edge order within an event) → finals (state order). A code is decimal with no leading zero; each state has exactly one description.
  - On read, any syntax outside the canonical form is rejected with `E_MERMAID_UNSUPPORTED{line}`: composite states, notes, fork/join, choice, styles, comments, order violations. Nothing is ignored silently.
- Order rules
  - State order and event order are declaration order. They drive `events_from` and generation order.
  - Code and declaration order are independent.
- An edge is the object `{from, to}`, not a pair: the object names its fields, so the editor schema checks it exactly with the keywords of kit `schema-validate.mjs` (which has no maximum item count) and a GUI form edits it as a row with a from and a to field.
- IR = `δ: (state, event) → to`.
- The code range is `1..2147483647`, the same 32-bit range in every target. 0 means unset.
- `schema/fsm.schema.json` serves editors and uses only the keywords that kit `schema-validate.mjs` supports. The authority is core validate.

## B-2. Three stores, one rule set
- The core handles a definition only as an **object** (validate → normalize → emit). A store only converts between the object and its medium.

| store | Definition | lock | Package |
|---|---|---|---|
| `json` | `machines/*.fsm.json` | `fsm.lock.json` | fsm-compiler |
| `mermaid` | `machines/*.fsm.mmd` | `fsm.lock.json` | fsm-compiler |
| `db` | orm definition tables | orm lock tables | fsm-db |

- The store contract is `{load() → Promise<{definitions, lock}>, save({definitions, lock}) → Promise}`. The orm client of the DB store is async, so the store contract, `run` and `copy` are async; the pure functions (validate, normalize, lock, vectors) stay synchronous, so the GUI calls them directly.
  - A store converts and writes atomically. It does not validate.
  - Writes: json and mermaid use a temporary file + rename per file (per-file atomicity only); db replaces everything inside one transaction. If a file store write stops halfway, the next `gen`/`vectors`/`check` reports `E_LOCK_MISMATCH`, and recovery is through git.
- The commands (`lock`, `save`, `gen`, `vectors`, `check`) run through one core function `run(command, store, options)`, which is async.
  - `save` (GUI save, one machine per save) and `lock` call `store.save` once, and only after the new definitions pass every rule of B-5 except `E_LOCK_MISMATCH` and the lock rules pass between the stored lock and the new definitions. The lock they write is derived from the new definitions, so it matches them by construction.
- One file at the project root, `fsm.config.json`, names the source store.
  - Format: `{"store":"json"|"mermaid"}` or `{"store":"db","dsnEnv":"FSM_DSN"}`
  - fsm-gen, fsm-db and fsm-gui read this file. If a tool cannot handle the configured store (for example fsm-gen with `db`), it fails with `E_STORE_NOT_CONFIGURED`.
  - A file in `machines/` whose format differs from the configuration fails with `E_STORE_MIXED`.
- `copy(from, to)` is an async core migration function outside `run` (`await to.save(await from.load())`). The fsm-db CLI is `copy --to json|mermaid --root <dir>` (the database is the source) or `copy --from json|mermaid --root <dir>` (the database is the target). If the target root already holds `machines/` or `fsm.lock.json` (for db: definition or lock rows), it fails with `E_STORE_NOT_EMPTY`.
  - fsm-gen provides json↔mermaid migration (keeping zero dependencies).
  - fsm-db provides db↔json/mermaid migration and the install of the schema. Its commands are `install`, `check`, `lock` and `copy`; their usage, exit codes and examples are in `packages/fsm-db/README.md`.
    - `install [--project <dir>]` installs the six tables of `schema/fsm.dbs` through orm `utils().schema().install`. On a database without the tables it creates them and prints `[fsm-db] install: ok`. On a database that already has all six tables it changes nothing and prints the same line. This is the observed behaviour of orm v0.0.7, tested in `packages/fsm-db/tests/cli.test.mjs`. On a database that has only some of the tables, orm rejects the install with `CONFIG`; the command prints the error with its stack and exits 1. There is no fallback.
    - `check`, `lock` and `copy` on a database without the tables fail with orm's `no such table` error, printed with its stack and exit 1. `install` is the only command that creates tables.
    - `lock [--project <dir>] [--rename machine.old=new]...` runs core `run lock` on the database. A renamed state keeps its code.
    - The DSN is the value of the environment variable that `dsnEnv` names in `fsm.config.json`. fsm-db reads no DSN from any other place.
    - `--project` defaults to the current directory. A usage error exits 2.
  - Changing `fsm.config.json` after a migration is a human decision.
- Store contract tests enforce that there is one rule set.
  - Every fixture round-trips json → db → mermaid → json byte-identically.
  - `run` gives byte-identical results on all three stores.

## B-3. Code immutability (lock)
- The code is the identity; the key is the name. A released code never changes meaning and is never reused.
- lock = `{machine: {codes: {code: key}, reserved: [code…]}}`. Only `lock` (for hand-edited definitions), `save` (GUI) and `copy` (which writes the source lock unchanged after validating the source with every rule of B-5) update the lock. `lock` and `save` apply the same lock rules (`E_CODE_REUSED`, `E_CODE_KEY_CHANGED`, `E_CODE_CHANGED`, a vanished code → reserved); all three write the definitions and the lock in the same `store.save`.
- `lock` refuses:
  - `E_CODE_REUSED`: reuse of a reserved code
  - `E_CODE_KEY_CHANGED`: a key change on an existing code. A rename happens only through `lock --rename m.old=new`, which changes the definition and the lock together.
  - `E_CODE_CHANGED`: a key that the lock maps to a code is given another code by the definition, including a key that was deleted and re-added while the lock still maps it. The message gives the code the lock holds: a released code never changes. A key that the lock has only as reserved history has no code to compare, because reserved holds only codes.
- The code of a state that vanished from the definition moves to reserved. When a whole machine vanishes, all its codes move to its reserved and its lock entry stays (the DB lock tables have no machine FK, plan C-6).
- `gen`/`vectors`/`check` fail with `E_LOCK_MISMATCH` unless every defined machine's lock `codes` equals `{code: key}` of its states and its `reserved` shares no code with them, and every lock machine that is not defined has empty `codes`.
- The default for a new code is core `nextCode(machine, definitions, lock)` = max(definition ∪ lock codes ∪ reserved)+1. Past the range it fails with `E_CODE_RANGE`. The GUI only suggests this value and owns no rule.
- A new record starts only in `initial`. Migrating data of a deleted state is a consumer DB task.

## B-4. Transition semantics (idempotency)
The unit of idempotency is **(expected, event)**. The caller remembers the state it observed, `expected`, and passes the same value on retry. Even an event with several edges, such as `next`, never advances twice under this rule.

- `target(expected, event) → to`: `E_INVALID_TRANSITION` if undefined.
- `apply(expected, event, actual) → Step`:

| Condition | Result |
|---|---|
| δ(expected, event) undefined | `E_INVALID_TRANSITION` |
| `actual == expected` | `Changed(to)` |
| `actual == to` | `Unchanged(to)`: means "already in the target state" |
| otherwise | `E_CONFLICT{expected, actual, event}` |

- De-duplicating requests (an idempotency key) is the consumer's responsibility.
- Persistence (feature `persist`): lock with `forUpdate()` inside an orm transaction.
  - MySQL/PostgreSQL take a row lock; SQLite takes the `BEGIN IMMEDIATE` write lock.
  - `actual` is read under the lock, so the caller needs no retry loop.
  - On a deadlock orm runs the callback again. `apply` is pure, so a rerun is safe.
  ```
  db.transaction(() => {                      // go Transaction(func() error), npm/rust async
    row  = Model().connect(db).<pk>(x).forUpdate().get()   // orm error if missing
    step = apply(expected, event, from_code(row.getStatus()))
    Changed   → row.setStatus(code(step.to)).update()
    Unchanged → return without writing
    error     → throw (orm rolls back)
  })
  ```

## B-5. Validation rules (one error code = one RED case, no warnings)
- Findings: core `validate(definitions)` returns every finding as `{code, machine, path, message}`. `path` is the JSON path within the machine object (`$.states[1].code`) and `machine` its key, or null when the definition has no string key. Findings follow document order within a machine and input order across machines; a machine with an `E_SCHEMA` finding gets no other finding. The GUI maps `path` to a form field and shows a finding without a field as a form error.
- Structure
  - `E_SCHEMA`: a missing required field, an unknown field, a type violation, empty `edges` (an event has at least one edge), file name ≠ `<machine>.fsm.json|mmd` (with the JSON path)
- Graph
  - `E_SELF_LOOP`: an edge with from == to
  - `E_NONDETERMINISTIC`: two or more targets for the same (state, event)
  - `E_DUPLICATE_EDGE`: the same edge repeated within one event
  - `E_INITIAL_COUNT`: not exactly one initial state
  - `E_FINAL_OUTGOING`: an edge leaving a final state
  - `E_UNREACHABLE`: a state unreachable from the initial state
  - `E_DEAD_END`: a non-final state with no outgoing edge
- Names
  - `E_KEY_FORMAT`: a machine, state or event key that is not `^[a-z][a-z0-9]*(_[a-z][a-z0-9]*)*$` or is longer than 64 characters (the DB store keeps keys in varchar(64), and core enforces the bound so that all three stores accept the same keys)
  - `E_DUPLICATE_KEY`: a repeated machine key, a state key or an event key repeated within a machine, or two machine keys equal after removing `_` (`ab` and `a_b` both give php `<ns>\Ab`)
  - `E_KEY_RESERVED`: one fixed list in `docs/spec/fsm.md`, applied to every definition whatever the kind or store. (1) Machine keys, compared after removing `_`: `fsm` (shared module), `index` (npm `index.js`), `lib` and `main` (rust `src/lib.rs`/`src/main.rs`, go `package main`), `internal` (a go internal package cannot be imported from `tests/`), `init` (go rejects importing a package under the name `init`), `testdata` and `vendor` (skipped by go `./...`), the go predeclared identifiers (`error`, `string`, `int`, `len`, `nil` and the rest; an imported package of that name would shadow them), and the keywords of go, rust (pinned edition), python and js, because in those four the machine key is the module name as is. (2) State and event keys whose pascal form is rejected as an enum member: `self` (rust `Self`) and `class` (php `Class`). (3) Mermaid reserved words, always applied whatever the store: state keys `note, class, classdef, style, click, href, default, state, statediagram, scale, acctitle, accdescr, root_start, root_end`; machine keys `null, true, false` (based on the pinned mermaid version 12.1.0). The S-16 test (`packages/fsm-gui/tests/mermaid-parse.test.mjs`) checks each state key at five positions: a description line, the initial line, an edge as its source, an edge as its target and the final line. A word is unusable at a position when mermaid fails to parse the diagram, or parses it into a model other than the one written: an id that collides with the `[*]` ids (`root_start`, `root_end`), or a line or a code that mermaid drops (`state` on a description line; `acctitle` and `accdescr` on a description or initial line). The machine words are checked with the YAML rule of the frontmatter, because the stateDiagram of mermaid does not read the frontmatter title. Names are rejected, never altered.
- Code and lock
  - `E_DUPLICATE_CODE`, `E_CODE_RANGE`, `E_UNKNOWN_STATE_REF`, `E_LOCK_MISMATCH`, `E_CODE_REUSED`, `E_CODE_KEY_CHANGED`, `E_CODE_CHANGED`
- Store
  - `E_MERMAID_UNSUPPORTED`, `E_STORE_MIXED`, `E_STORE_NOT_EMPTY`, `E_STORE_NOT_CONFIGURED`
- Generation
  - `E_NOT_GENERATED`: `gen` or `vectors --kind` finds a file in its output directory without the generated header. Nothing is written or removed: the generator replaces only the files it wrote, so a hand-written file is never overwritten or deleted. Git-ignored files of the output directory are skipped: they are build outputs, not hand-written files (outside a git work tree nothing is ignored).

## B-6. Naming rule (one rule for all languages + a notation table per language)
`order` in this document is an example machine key (an order lifecycle). Every generated name comes mechanically from the rule below. There are no suffixes or compromise names (`OrderMachine`, `OrderFsm`).

**Common rule: one machine = one module**
- Module name = machine key.
- The names inside a module are the same in every language.
  - Types: `State` (state enum), `Event` (event enum), `Step` (result of apply)
  - Members: state and event keys
  - Functions: `initial`, `code`, `key`, `from_code`, `is_final`, `events_from`, `target`, `apply` (= the features.json ids)
- The shared module `fsm` holds the type `Error` (fields `code`, `expected`, `actual`, `event`) and the error code constants. Therefore the machine key `fsm` is reserved (`E_KEY_RESERVED`).
- The only difference between languages is the **notation conversion** in the table below. Exactly four conversion functions are used: `snake` (unchanged), `pascal`, `camel`, `upper`. Given the key format (`E_KEY_FORMAT`), all four are one-to-one.

| Concept | go | rust | npm | python | php / php-ext |
|---|---|---|---|---|---|
| Module | package `order` (`src/order/`) | `mod order` | `order.js` | module `order` | namespace `<ns>\Order` (pascal) |
| Types | `State` `Event` `Step` | same | same | same | same |
| State member | `StateDraft` (pascal, prefixed with the type name because Go has no scoped enum) | `State::Draft` | `State.Draft` | `State.DRAFT` (upper) | `State::Draft` |
| Event member | `EventNext` | `Event::Next` | `Event.Next` | `Event.NEXT` | `Event::Next` |
| Function | `Apply`, `FromCode` (pascal, export required) | `apply`, `from_code` (snake) | `apply`, `fromCode` (camel) | `apply`, `from_code` (snake) | `apply`, `fromCode` (camel, namespace function) |
| Call | `order.Apply(…)` | `order::apply(…)` | `order.apply(…)` | `order.apply(…)` | `Order\apply(…)` |
| Error | `fsm.Error` | `fsm::Error` | `fsm.Error` | `fsm.Error` | `<ns>\Fsm\Error` |

- The notation matches the generated API of polyspec orm (PHP/TS camel, Go pascal, Rust/Python snake) and each language's official naming convention. There are no exceptions beyond the table.
- The value of a state type is its integer code.
  - go: `type State int32`
  - rust: `#[repr(i32)]`
  - npm: `Object.freeze({Draft: 1})` + a `.d.ts` union
  - python: `IntEnum`
  - php: `enum State: int`
- `Step` has the fields `to: State` and `changed: bool` (no variant names). `Event` values are their declaration index starting at 1 (events are not stored). Error code constants are the B-4/B-5/B-6 codes without `E_` in each language's constant notation (go `CodeConflict`, rust `Code::Conflict`, npm/php `Code.Conflict`/`Code::Conflict`, python `Code.CONFLICT`).
- Function signatures have the same parameter order in every language: `apply(expected: State, event: Event, actual: State) → Step`, `target(expected: State, event: Event) → State`.
- php loads the enums through PSR-4 (`Order/State.php`…) and the functions through `Order/functions.php` in composer `autoload.files`. php-ext registers the same namespaced enums and functions in C.
- Machines live in separate modules, so identifiers of different machines cannot collide, except that php namespaces and PSR-4 directories are case-insensitive; `E_DUPLICATE_KEY` therefore also rejects two machine keys that are equal after removing `_`. The remaining collisions are generated file and package names, language keywords and php case-insensitive names; the fixed lists of `E_KEY_RESERVED` and `E_DUPLICATE_KEY` reject them.
- Errors are reported only through `fsm.Error`; nothing returns null.
- The only function that takes a raw integer is `from_code`.
  - Its argument is the language's 64-bit signed integer (go `int64`, rust `i64`, php/python `int`; npm `number`, which is a double: a non-integer or unsafe-integer input is `E_UNKNOWN_CODE`). The caller passes the DB value without narrowing it.
  - 0, out of range or an unknown code → `E_UNKNOWN_CODE`; a reserved code → `E_RESERVED_CODE`.
- The consumer's status column is dbspec `i32`.
- In go/npm/python a state type can hold any integer, so the default branch of the switch throws `E_UNKNOWN_CODE`.
- File header: `Code generated by fsm-gen from <machine>; DO NOT EDIT.`
