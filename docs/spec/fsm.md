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
| State·code | `{"key":"draft","code":1}` | `state "draft" as draft` (label) and `draft : 1` (state description) | `state(machine, key, code, initial, final, position)` |
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
    state "draft" as draft
    draft : 1
    state "paid" as paid
    paid : 2
    state "shipped" as shipped
    shipped : 3
    state "done" as done
    done : 4
    state "canceled" as canceled
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
  - The line order is fixed: for each state in state order, its label line `state "<key>" as <key>` and then its description line `<key> : <code>`; then the initial line → edges in event order (edge order within an event) → finals (state order). Each state has exactly one label line and one description line, in that order. A code is decimal with no leading zero. The label is the key: a label line whose text differs from its key is refused.
  - Decision (S-38): the drawn diagram must show each state's key and code. With the pinned mermaid 12.1.0 a state with one description is drawn as that description only: `draft : 1` draws `1` and no key. The alias line `state "draft" as draft` draws `draft` as the box title, so the form draws the key as the title and the code as the description (labels `draft` and `1`; the parsed descriptions are [draft, 1]). The measurement: Chromium with mermaid 12.1.0, the labels read from the svg and the descriptions from `getStates()`.
  - Rejected alternatives, each checked against the rules of this section (official syntax only; lossless; one canonical text; simple to parse and to reject; the drawn diagram shows key and code):
    - `draft : draft` followed by `draft : 1` (two description lines): draws the same, but it is not a documented title syntax. The title would be the first description by position, an implicit rule that the reader would have to repeat.
    - `state "draft 1" as draft`: draws `draft 1`, but the code becomes free text inside a label, so the reader must split a string, and the code is no longer the description of the table above.
    - `draft : draft 1`: draws `draft 1`, but one description holds two values that the reader must split, and the key is not a title.
    - `draft : draft<br/>1`: draws two lines, but it is one description that holds two values, the same objection as `draft : draft 1`.
    - `draft : 1` (the former form): draws `1` only. It fails the requirement.
  - The chosen form keeps the key and the code in separate lines of documented syntax, so the reader checks each with a rule it already has. A label that differs from its key is refused with `E_MERMAID_UNSUPPORTED`: a second name would otherwise be dropped without a trace, because the other stores have no such name.
  - On read, any syntax outside the canonical form is rejected with `E_MERMAID_UNSUPPORTED{line}`: composite states, notes, fork/join, choice, styles, comments, order violations, a label that differs from its key. Nothing is ignored silently.
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

- The store contract is `{load() → Promise<{definitions, lock, baseline, findings}>, save({definitions, lock}) → Promise}`, where `baseline` is the committed lock (B-3). The orm client of the DB store is async, so the store contract, `run` and `copy` are async; the pure functions (validate, normalize, lock, vectors) stay synchronous, so the GUI calls them directly.
  - A store converts and writes atomically. It does not validate.
  - Writes: json and mermaid use a temporary file + rename per file (per-file atomicity only); db replaces everything inside one transaction. If a file store write stops halfway, the next `gen`/`vectors`/`check` reports `E_LOCK_MISMATCH`, and recovery is through git.
- The commands (`lock`, `save`, `gen`, `vectors`, `check`) run through one core function `run(command, store, options)`, which is async.
  - `save` (GUI save, one machine per save) and `lock` call `store.save` once, and only after the new definitions pass every rule of B-5 except `E_LOCK_MISMATCH` and the lock rules pass between the stored lock and the new definitions. The lock they write is derived from the new definitions, so it matches them by construction.
- One file at the project root, `fsm.config.json`, names the source store.
  - Format: `{"store":"json"|"mermaid"}` or `{"store":"db","dsnEnv":"FSM_DSN"}`
  - fsm-gen, fsm-db and fsm-gui read this file. If a tool cannot handle the configured store (for example fsm-gen with `db`), it fails with `E_STORE_NOT_CONFIGURED`.
  - A file in `machines/` whose format differs from the configuration fails with `E_STORE_MIXED`.
- `copy(from, to)` is an async core migration function outside `run` (`await to.save(await from.load())`). The fsm-db CLI is `copy --to json|mermaid --root <dir>` (the database is the source) or `copy --from json|mermaid --root <dir>` (the database is the target). If the target root already holds `machines/` or `fsm.lock.json` (for db: definition or lock rows), or a committed `fsm.lock.json` (git HEAD), it fails with `E_STORE_NOT_EMPTY`.
  - fsm-gen provides json↔mermaid migration (keeping the imports of plan C-5).
  - fsm-db provides db↔json/mermaid migration and the install of the schema. Its commands are `install`, `check`, `lock` and `copy`; their usage, exit codes and examples are in `packages/fsm-db/README.md`.
    - `install [--project <dir>]` installs the six tables of `schema/fsm.dbs` through orm `utils().schema().install`. On a database without the tables it creates them and prints `[fsm-db] install: ok`. On a database that already has all six tables it changes nothing and prints the same line. This is the observed behaviour of orm v0.0.7, tested in `packages/fsm-db/tests/cli.test.mjs`. On a database that has only some of the tables, orm rejects the install with `CONFIG`; the command prints the error with its stack and exits 1. There is no fallback.
    - `check`, `lock` and `copy` on a database without the tables fail with orm's `no such table` error, printed with its stack and exit 1. `install` is the only command that creates tables.
    - `lock [--project <dir>] [--rename machine.old=new]...` runs core `run lock` on the database. A renamed state keeps its code.
    - The DSN is the value of the environment variable that `dsnEnv` names in `fsm.config.json`. fsm-db reads no DSN from any other place.
    - `--project` defaults to the current directory. A usage error exits 2.
  - Changing `fsm.config.json` after a migration is a human decision.
- Store contract tests enforce that there is one rule set. They live in `packages/fsm-db/tests/store-contract-all.test.mjs`, which the fsm-db package owns because it depends on the compiler (not the other way round), and run under `make db-test`.
  - Every valid fixture of `packages/fsm-compiler/tests/fixtures/valid` (and all of them together) round-trips json → db → mermaid → json byte-identically, the files compared as bytes.
  - `run` gives byte-identical results on all three stores: `gen` of every kind with its required options (`goModule` for go, `phpNamespace` for php and php-ext, `phpExtName` for php-ext) and `vectors`, including the vectors file of every kind.
  - A store that drops a field (for example `final`) fails these cases: the core refuses the round trip, or the bytes differ.

## B-3. Code immutability (lock)
- The code is the identity; the key is the name. A released code never changes meaning and is never reused.
- lock = `{machine: {codes: {code: key}, reserved: [code…]}}`. Only `lock` (for hand-edited definitions), `save` (GUI) and `copy` (which writes the source lock unchanged after validating the source with every rule of B-5) update the lock. `lock` and `save` apply the same lock rules (`E_CODE_REUSED`, `E_CODE_KEY_CHANGED`, `E_CODE_CHANGED`, `E_LOCK_REGRESSED`, a vanished code → reserved); all three write the definitions and the lock in the same `store.save`.
- `lock` refuses:
  - `E_CODE_REUSED`: reuse of a reserved code
  - `E_CODE_KEY_CHANGED`: a key change on an existing code. A rename happens only through `lock --rename m.old=new`, which changes the definition and the lock together.
  - `E_CODE_CHANGED`: a key that the lock maps to a code is given another code by the definition, including a key that was deleted and re-added while the lock still maps it. The message gives the code the lock holds: a released code never changes. A key that the lock has only as reserved history has no code to compare, because reserved holds only codes.
  - `E_LOCK_REGRESSED`: the lock it would write loses or changes a committed code (the baseline below).
- Baseline: the committed lock. Every store's `load()` returns the committed lock as `baseline`, and every command compares its lock with it.
  - json and mermaid: `fsm.lock.json` at git HEAD, read as `git show HEAD:./fsm.lock.json` from the project directory.
  - db: the rows of the lock tables that `load` reads, before the command writes them.
  - Nothing is committed, so the baseline is the empty lock, when the project directory does not exist yet, when it is outside a git work tree, when its repository has no commit, or when `fsm.lock.json` is not tracked at HEAD (an untracked or ignored file). The lock rules then judge the stored lock alone. Outside git this is the only protection there is: a project that is not in git gets no release protection from this section (a decision of S-30, to be confirmed by the owner).
  - A committed `fsm.lock.json` that cannot be read is a finding of its own (`E_SCHEMA`) that stops every command, and no empty baseline is put in its place. Any other failure of git stops the command with an error, not with an empty baseline.
- `E_LOCK_REGRESSED`: the lock that a command keeps (for `lock` and `save` the lock it would write, for `check`, `gen`, `vectors` and `copy` the stored lock) is compared with the baseline. A committed code of a machine is judged by three rules, one finding per violation (path `$.reserved` for rule 1, `$.codes` for rules 2 and 3):
  1. A committed reserved code stays reserved: it is neither given to a state nor removed from `reserved`.
  2. A committed code stays a code with its key, or moves to `reserved` because its state left the definitions. It is never removed.
  3. While a committed key is still a key of `codes`, it keeps its committed code, so a key that moved to another code (a swap) is refused. A key that left `codes` while its code stayed is a rename and is not refused.
- A rename is therefore accepted by every command before it is committed: it keeps the code and drops the old key, and the commit records it. A loss or a swap of a committed code is refused by every command, including `lock --rename`, until the change is reverted. A whole machine that vanished keeps its codes in `reserved` (rule 2) and its lock entry (see below).
- Repair: `lock` restores a stored lock that does not match the definitions only when the lock it writes keeps every committed code (rules 1 to 3). A lock that was deleted or emptied is therefore restored from the definitions when they keep the committed codes, and refused with `E_LOCK_REGRESSED` when they do not.
- The code of a state that vanished from the definition moves to reserved. When a whole machine vanishes, all its codes move to its reserved and its lock entry stays (the DB lock tables have no machine FK, plan C-6).
- `gen`/`vectors`/`check` fail with `E_LOCK_MISMATCH` unless every defined machine's lock `codes` equals `{code: key}` of its states and its `reserved` shares no code with them, and every lock machine that is not defined has empty `codes`. They also fail with `E_LOCK_REGRESSED` for any committed code that the stored lock loses or changes (rules 1 to 3).
- The db store: its baseline is the stored rows, so the stored-lock rules above (`E_CODE_REUSED`, `E_CODE_KEY_CHANGED`, `E_CODE_CHANGED`) already refuse every change that a command could write, and `E_LOCK_REGRESSED` does not arise there through a command. A row that is changed or deleted outside fsm (in SQL) leaves no record that a command could compare with, so it is not detected. A committed record of the database is not part of this version; it needs a decision in the plan.
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
  - `E_KEY_RESERVED`: one fixed list in `docs/spec/fsm.md`, applied to every definition whatever the kind or store. (1) Machine keys, compared after removing `_`: `fsm` (shared module), `index` (npm `index.js`), `lib` and `main` (rust `src/lib.rs`/`src/main.rs`, go `package main`), `internal` (a go internal package cannot be imported from `tests/`), `init` (go rejects importing a package under the name `init`), `testdata` and `vendor` (skipped by go `./...`), the go predeclared identifiers (`error`, `string`, `int`, `len`, `nil` and the rest; an imported package of that name would shadow them), and the keywords of go, rust (pinned edition), python and js, because in those four the machine key is the module name as is. (2) State and event keys whose pascal form is rejected as an enum member: `self` (rust `Self`) and `class` (php `Class`). (3) Mermaid reserved words, always applied whatever the store: state keys `note, class, classdef, style, click, href, default, state, statediagram, scale, acctitle, accdescr, root_start, root_end`; machine keys `null, true, false` (based on the pinned mermaid version 12.1.0). The S-16 test (`packages/fsm-gui/tests/mermaid-parse.test.mjs`) checks each state key at six positions: a description line (its label line comes before it), the initial line, an edge as its source, an edge as its target, the final line, and the label line of a first state (S-38). A word is unusable at a position when mermaid fails to parse the diagram, or parses it into a model other than the one written: an id that collides with the `[*]` ids (`root_start`, `root_end`), or a line or a code that mermaid drops (`state` on a description line; `acctitle` and `accdescr` on a description or initial line). The S-38 measurement with the label line (mermaid 12.1.0, the canonical form of B-1) leaves the list unchanged: each of the 14 words above is unusable at the six positions, the ordinary words that the test samples are carried at them, and the label line alone carries each of the 14 words (`state "note" as note` with no other line naming `note` gives the id `note` with the description `note`), so the label line adds no reserved word. The machine words are checked with the YAML rule of the frontmatter, because the stateDiagram of mermaid does not read the frontmatter title. Names are rejected, never altered.
- Code and lock
  - `E_DUPLICATE_CODE`, `E_CODE_RANGE`, `E_UNKNOWN_STATE_REF`, `E_LOCK_MISMATCH`, `E_CODE_REUSED`, `E_CODE_KEY_CHANGED`, `E_CODE_CHANGED`, `E_LOCK_REGRESSED`
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
  - An `Event` of a machine without events has no representation: rust omits `#[repr(i32)]` on the empty enum `pub enum Event {}`, because rustc rejects a zero-variant enum with a representation (E0084). A machine with events keeps `#[repr(i32)]`.
- `Step` has the fields `to: State` and `changed: bool` (no variant names). `Event` values are their declaration index starting at 1 (events are not stored). Error code constants are the B-4/B-5/B-6 codes without `E_` in each language's constant notation (go `CodeConflict`, rust `Code::Conflict`, npm/php `Code.Conflict`/`Code::Conflict`, python `Code.CONFLICT`).
- Function signatures have the same parameter order in every language: `apply(expected: State, event: Event, actual: State) → Step`, `target(expected: State, event: Event) → State`.
- php loads the enums through PSR-4 (`Order/State.php`…) and the functions through `Order/functions.php` in composer `autoload.files`. php-ext registers the same namespaced enums and functions in C, and every C name derives from the php namespace and the extension name: the includes `php_<ext>.h` and `<ext>_arginfo.h`, and the Error class symbol `<namespace with \ as _>_Fsm_Error` (`Acme\Tool` gives `Acme_Tool_Fsm_Error`).
- Machines live in separate modules, so identifiers of different machines cannot collide, except that php namespaces and PSR-4 directories are case-insensitive; `E_DUPLICATE_KEY` therefore also rejects two machine keys that are equal after removing `_`. The remaining collisions are generated file and package names, language keywords and php case-insensitive names; the fixed lists of `E_KEY_RESERVED` and `E_DUPLICATE_KEY` reject them.
- Errors are reported only through `fsm.Error`; nothing returns null.
- The only function that takes a raw integer is `from_code`.
  - Its argument is the language's 64-bit signed integer (go `int64`, rust `i64`, php/python `int`; npm `number`, which is a double: a non-integer or unsafe-integer input is `E_UNKNOWN_CODE`). The caller passes the DB value without narrowing it.
  - 0, out of range or an unknown code → `E_UNKNOWN_CODE`; a reserved code → `E_RESERVED_CODE`.
- The consumer's status column is dbspec `i32`.
- In go/npm/python a state type can hold any integer, so the default branch of the switch throws `E_UNKNOWN_CODE`.
- File header: `Code generated by fsm-gen from <machine>; DO NOT EDIT.`
