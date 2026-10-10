<!-- doc-id: plan-status-v1 -->
# status v1 plan

[한국어](status-v1.ko.md)

## Context
- A state is stored as an integer code (key = value). Event transitions are **idempotent and deterministic**. The same rules apply to six targets: go, npm (js+d.ts), php, php-ext, python and rust.
- The output is generated files per language. There is no parsing at runtime, and the generated code has no runtime dependency.
- Definitions have three first-class stores: **JSON, Mermaid `stateDiagram-v2` and DB (orm)**. One compiler core owns the rules: validation, lock and generation.
- The model is kept simple enough that all three media hold it losslessly **with their official syntax only**. If a medium cannot hold part of the model, that is a sign the model is too complex.
- Tools: the GUI uses hyper (Node server), CRUD screens use crudui, and DB access uses orm.
- `status/` holds only this plan (`docs/plans/status-v1.md(.ko)`) and is not yet a git repository; S-01 commits the plan with the kit adoption. It adopts kit.
- The six language packages have identical folder structure. Only language-inherent differences are allowed, and they are declared in `contracts/layout.json`.
- The language packages are not published libraries. They are consumer-side test beds.
- Fixed decisions
  - Value model: enum only, no bit flags.
  - Transitions: an explicit graph.
  - Runtime: generated code only.
- Principle: standards are **enforced by tools**. Layout, feature↔test correspondence and parity between languages are judged by check tools that have RED tests.

## 0. Scope (the only basis for audits and implementation)

**Requirements R1–R10 (this list alone is the v1 scope)**

| id | Requirement | Source |
|---|---|---|
| R1 | A state is an enum with an integer code (key = value). A code never changes and is never reused | initial request |
| R2 | Event transitions, including previous/next, are idempotent and deterministic | initial request |
| R3 | Generated files for six targets (go, npm js+d.ts, php, php-ext, python, rust), with no runtime parsing and no runtime dependency | initial request |
| R4 | Three definition stores (JSON, Mermaid, DB) and one rule set | user instruction |
| R5 | State management GUI: hyper + crudui + Mermaid display | user instruction |
| R6 | DB access through orm, for the definition DB store and the consumer persistence example | user instruction |
| R7 | Adopt kit. Language packages share one structure; only language-inherent differences are allowed | user instruction |
| R8 | Standards are enforced by tools (layout, feature↔test, language parity). Development order is RED→GREEN | user instruction |
| R9 | Test execution rules: per-case progress and timeout, 10-minute ceiling, owner checks, full suite once | user instruction |
| R10 | Checklist, commit and document discipline (section A) | user instruction |

**Out of v1 scope (not subject to audit findings)**
- The not-adopted list in B-0
- Concurrency between several editors (the GUI has one editor)
- Package publishing and release (the language packages are test beds)
- Differences between DB dialects (owned by orm)
- Performance tuning, i18n, authentication and authorization

**Audit rules (convergence condition)**
- Each finding names the R-id it violates or the plan location it contradicts. A finding with neither is rejected as out of scope.
- Only three kinds of finding are core:
  1. An R violation.
  2. An internal contradiction in the plan.
  3. An implementation shown to be impossible against real code or tools.
- Everything else is minor: wording, a preferred alternative design, features out of scope. Minor findings do not block the plan and are handled when the item is implemented.
- The plan is fixed when there are zero core findings. Changing the scope itself needs a user decision.
- Audits during implementation follow the same rules, limited to the deliverables of the checklist item and its RED/GREEN criteria.

---

## A. Development discipline (written once in AGENTS.md; never in the checklist or CHANGELOG)
- Basis of judgement
  - The basis of every decision is "what is right". "The existing principle says so" is not a reason.
  - A standard can be corrected, but only with evidence. Lowering a standard because it is hard to reach during testing is forbidden.
  - When a judgement is hard or new reasoning appears, verify it adversarially with agents. Ask the agents for concrete fixes too, and repeat until there is no disagreement.
  - Record each decision in the related document.
- kit rules
  - English is canonical. A `.ko.md` file carries `source-sha256`, and technical terms stay in English.
  - Vendored files are never edited. The same tree gives the same result.
  - Changes to shared tools are made in kit and run through the kit checklist (K items).
- Development cycle: reproduce with RED → implement → verify with GREEN. Each item states an observable criterion.
- Fixtures of the root tool tests (check-layout, check-parity, gen-check) are built by the tests in temporary directories, never committed, so no kit gate reads them.
- Test location
  - The base test of a feature lives in the package that owns it.
    - compiler → `packages/status-compiler/tests`
    - DB store → `packages/status-db/tests`
    - GUI → `packages/status-gui/tests`
  - Language packages hold only consumer-side tests.
  - The root holds only the tests of the root tools (check-layout, check-parity, gen-check) and the vendored `tests/kit/`.
- Test execution
  - Every test runs through kit `run-tests.mjs`. That runner enforces per-case progress and elapsed-time output and a per-case timeout. There is no overall timeout.
  - One vector case = one language test.
  - compiler-test, db-test, gui-test and every language test write `.results/<target>.json` through `run-tests --results`. check-parity requires these files (so every test provably ran through the runner) and checks `elapsedMs ≤ 600000` for each. The target is seconds.
  - Parallel runs happen only through `make -j6` in `packages-test`.
  - While an item is in development, only the owner checks of the owner-checks mapping (section D) run.
  - The full suite runs once per tree with `full-run.mjs` after the last item is committed. It is not a checklist item.
- No hidden errors: no fallback, no silent conversion or drop, no null return. No backward-compatibility layer.
- Checklist
  - Only `docs/plans/execution-checklist.md(.ko)`. The format is the kit table (`| id | item | RED → GREEN | state |`).
  - States are `[ ] [~] [o] [!] [-]`. An `[o]` item is never reopened; a sub-id is created instead.
- Commits
  - Format: `type(scope): Subject (#S-xx)`, in English. The subject is at most 50 characters, starts with a capital, has no period and is imperative. The body wraps at 72 characters and states What/Why.
  - When an item becomes `[o]`, the root CHANGELOG and the checklist are updated and committed.
- Enforcement
  - kit tools
    - `commits-check` + commit-msg hook: subject format, length, body width
    - `documents-check`: checklist format
    - `push-gate`: no push in the `[~]` state
    - `owner-validate`: path ownership
  - K19: a commit that moves an item to `[o]` must also change the CHANGELOG. One commit changes the state of at most one item.
  - **Review rules (no tool)**
    - Branch/worktree naming and deletion right after merge
    - No external sources in git files (only adopt/not-adopt verdicts, in generic wording). polyspec repositories (kit, orm, hyper, crudui, template and others) are internal libraries and may be cited.
    - Imperative commit subject, What/Why body
    - RED→implement→GREEN order
    - No fallback, no backward compatibility
    - Experimental code removed
    - No reopening `[o]`
    - WIP control (no growing number of `[~]`; finishing comes first)
    - Technical terms in English
    - Basis of judgement: evidence-based decisions, no lowered standard, adversarial verification, decisions recorded in the related document
    - The same tree gives the same result (kit tools enforce it for their own checks only)
    - Each checklist item states an observable RED → GREEN criterion
    - Test location (compiler, DB store and GUI tests in their packages; only consumer-side tests in language packages)
    - Parallel runs only through `make -j6` in `packages-test`; only owner checks during an item
    - Commit messages in English
    - A conformance check function asserts the expected value of its vector (check-parity counts cases, not assertions)
    - Dependency pins (release tags in manifests and lock files)
- Branches and worktrees
  - Work directly on main is allowed.
  - A branch or worktree is named `{type}/{shortname}-{id}` / `status-{shortname}-{id}` and is deleted right after merge.
  - Experimental code is removed before commit. If it cannot be removed at once, a sub-item records the removal condition.

## B. State machine definition (fixed in `docs/spec/status.md`)

### B-0. Adoption verdicts
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

### B-1. Definition model
A definition has only three parts:
- the machine name
- states: key, code, initial, final
- events: key, list of edges `[from, to]…`

| Concept | JSON | Mermaid (official syntax) | DB (orm) |
|---|---|---|---|
| Machine | `"machine": "order"` | frontmatter `title: order` | `machine(name)` |
| State·code | `{"key":"draft","code":1}` | `draft : 1` (state description) | `state(machine, key, code, initial, final, position)` |
| initial | `"initial": true` | `[*] --> draft` | `initial` |
| final | `"final": true` | `done --> [*]` | `final` |
| Edge | `{"key":"next","edges":[["draft","paid"],…]}` | `draft --> paid : next` | `edge(machine, event, from, to, position)` + `event(machine, key, position)` |

Example (`order`, an order lifecycle, is only an example machine key):
```json
{
  "$schema": "../schema/status.schema.json",
  "machine": "order",
  "states": [
    { "key": "draft", "code": 1, "initial": true }, { "key": "paid", "code": 2 },
    { "key": "shipped", "code": 3 }, { "key": "done", "code": 4, "final": true },
    { "key": "canceled", "code": 5, "final": true }
  ],
  "events": [
    { "key": "next",   "edges": [["draft", "paid"], ["paid", "shipped"], ["shipped", "done"]] },
    { "key": "prev",   "edges": [["paid", "draft"], ["shipped", "paid"]] },
    { "key": "cancel", "edges": [["draft", "canceled"], ["paid", "canceled"]] }
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
- IR = `δ: (state, event) → to`.
- The code range is `1..2147483647`, the same 32-bit range in every target. 0 means unset.
- `schema/status.schema.json` serves editors and uses only the keywords that kit `schema-validate.mjs` supports. The authority is core validate.

### B-2. Three stores, one rule set
- The core handles a definition only as an **object** (validate → normalize → emit). A store only converts between the object and its medium.

| store | Definition | lock | Package |
|---|---|---|---|
| `json` | `machines/*.status.json` | `status.lock.json` | status-compiler |
| `mermaid` | `machines/*.status.mmd` | `status.lock.json` | status-compiler |
| `db` | orm definition tables | orm lock tables | status-db |

- The store contract is `{load() → {definitions, lock}, save({definitions, lock})}`.
  - A store converts and writes atomically. It does not validate.
  - Writes: json and mermaid use a temporary file + rename per file (per-file atomicity only); db replaces everything inside one transaction. If a file store write stops halfway, the next `gen`/`vectors`/`check` reports `E_LOCK_MISMATCH`, and recovery is through git.
- The commands (`lock`, `save`, `gen`, `vectors`, `check`) run through one core function `run(command, store, options)`.
  - `save` (GUI save, one machine per save) and `lock` call `store.save` once, and only after the new definitions pass every rule of B-5 except `E_LOCK_MISMATCH` and the lock rules pass between the stored lock and the new definitions. The lock they write is derived from the new definitions, so it matches them by construction.
- One file at the project root, `status.config.json`, names the source store.
  - Format: `{"store":"json"|"mermaid"}` or `{"store":"db","dsnEnv":"STATUS_DSN"}`
  - status-gen, status-db and status-gui read this file. If a tool cannot handle the configured store (for example status-gen with `db`), it fails with `E_STORE_NOT_CONFIGURED`.
  - A file in `machines/` whose format differs from the configuration fails with `E_STORE_MIXED`.
- `copy(from, to)` is a core migration function outside `run` (`to.save(from.load())`). The CLI is `copy --to json|mermaid --root <dir>` or `copy --to db` (the DSN comes from the environment variable named by `--dsn-env`). If the target root already holds `machines/` or `status.lock.json` (for db: definition or lock rows), it fails with `E_STORE_NOT_EMPTY`.
  - status-gen provides json↔mermaid migration (keeping zero dependencies).
  - status-db provides db↔json/mermaid migration.
  - Changing `status.config.json` after a migration is a human decision.
- Store contract tests enforce that there is one rule set.
  - Every fixture round-trips json → db → mermaid → json byte-identically.
  - `run` gives byte-identical results on all three stores.

### B-3. Code immutability (lock)
- The code is the identity; the key is the name. A released code never changes meaning and is never reused.
- lock = `{machine: {codes: {code: key}, reserved: [code…]}}`. Only `lock` (for hand-edited definitions), `save` (GUI) and `copy` (which writes the source lock unchanged after validating the source with every rule of B-5) update the lock. `lock` and `save` apply the same lock rules (`E_CODE_REUSED`, `E_CODE_KEY_CHANGED`, a vanished code → reserved); all three write the definitions and the lock in the same `store.save`.
- `lock` refuses:
  - `E_CODE_REUSED`: reuse of a reserved code
  - `E_CODE_KEY_CHANGED`: a key change on an existing code. A rename happens only through `lock --rename m.old=new`, which changes the definition and the lock together.
- The code of a state that vanished from the definition moves to reserved. When a whole machine vanishes, all its codes move to its reserved and its lock entry stays (C-6).
- `gen`/`vectors`/`check` fail with `E_LOCK_MISMATCH` unless every defined machine's lock `codes` equals `{code: key}` of its states and its `reserved` shares no code with them, and every lock machine that is not defined has empty `codes`.
- The default for a new code is core `nextCode(machine, definitions, lock)` = max(definition ∪ lock codes ∪ reserved)+1. Past the range it fails with `E_CODE_RANGE`. The GUI only suggests this value and owns no rule.
- A new record starts only in `initial`. Migrating data of a deleted state is a consumer DB task.

### B-4. Transition semantics (idempotency)
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

### B-5. Validation rules (one error code = one RED case, no warnings)
- Structure
  - `E_SCHEMA`: a missing required field, an unknown field, a type violation, empty `edges` (an event has at least one edge), file name ≠ `<machine>.status.json|mmd` (with the JSON path)
- Graph
  - `E_SELF_LOOP`: an edge with from == to
  - `E_NONDETERMINISTIC`: two or more targets for the same (state, event)
  - `E_DUPLICATE_EDGE`: the same edge repeated within one event
  - `E_INITIAL_COUNT`: not exactly one initial state
  - `E_FINAL_OUTGOING`: an edge leaving a final state
  - `E_UNREACHABLE`: a state unreachable from the initial state
  - `E_DEAD_END`: a non-final state with no outgoing edge
- Names
  - `E_KEY_FORMAT`: a machine, state or event key that is not `^[a-z][a-z0-9]*(_[a-z][a-z0-9]*)*$`
  - `E_DUPLICATE_KEY`: a repeated machine key, a state key or an event key repeated within a machine, or two machine keys equal after removing `_` (`ab` and `a_b` both give php `<ns>\Ab`)
  - `E_KEY_RESERVED`: one fixed list in `docs/spec/status.md`, applied to every definition whatever the kind or store. (1) Machine keys, compared after removing `_`: `status` (shared module), `index` (npm `index.js`), `lib` and `main` (rust `src/lib.rs`/`src/main.rs`, go `package main`), `internal` (a go internal package cannot be imported from `tests/`), `init` (go rejects importing a package under the name `init`), `testdata` and `vendor` (skipped by go `./...`), the go predeclared identifiers (`error`, `string`, `int`, `len`, `nil` and the rest; an imported package of that name would shadow them), and the keywords of go, rust (pinned edition), python and js, because in those four the machine key is the module name as is. (2) State and event keys whose pascal form is rejected as an enum member: `self` (rust `Self`) and `class` (php `Class`). (3) Mermaid reserved words, always applied whatever the store: state keys `note, class, classdef, style, click, href, default, state, statediagram, scale, acctitle, accdescr, root_start, root_end`; machine keys `null, true, false` (based on the pinned mermaid version; a test parses the canonical form with each listed word as a state key in every position and as the title, and requires a parse failure or an id clash for each). Names are rejected, never altered.
- Code and lock
  - `E_DUPLICATE_CODE`, `E_CODE_RANGE`, `E_UNKNOWN_STATE_REF`, `E_LOCK_MISMATCH`, `E_CODE_REUSED`, `E_CODE_KEY_CHANGED`
- Store
  - `E_MERMAID_UNSUPPORTED`, `E_STORE_MIXED`, `E_STORE_NOT_EMPTY`, `E_STORE_NOT_CONFIGURED`

### B-6. Naming rule (one rule for all languages + a notation table per language)
`order` in this document is an example machine key (an order lifecycle). Every generated name comes mechanically from the rule below. There are no suffixes or compromise names (`OrderMachine`, `OrderStatus`).

**Common rule: one machine = one module**
- Module name = machine key.
- The names inside a module are the same in every language.
  - Types: `State` (state enum), `Event` (event enum), `Step` (result of apply)
  - Members: state and event keys
  - Functions: `initial`, `code`, `key`, `from_code`, `is_final`, `events_from`, `target`, `apply` (= the features.json ids)
- The shared module `status` holds the type `Error` (fields `code`, `expected`, `actual`, `event`) and the error code constants. Therefore the machine key `status` is reserved (`E_KEY_RESERVED`).
- The only difference between languages is the **notation conversion** in the table below. Exactly four conversion functions are used: `snake` (unchanged), `pascal`, `camel`, `upper`. Given the key format (`E_KEY_FORMAT`), all four are one-to-one.

| Concept | go | rust | npm | python | php / php-ext |
|---|---|---|---|---|---|
| Module | package `order` (`src/order/`) | `mod order` | `order.js` | module `order` | namespace `<ns>\Order` (pascal) |
| Types | `State` `Event` `Step` | same | same | same | same |
| State member | `StateDraft` (pascal, prefixed with the type name because Go has no scoped enum) | `State::Draft` | `State.Draft` | `State.DRAFT` (upper) | `State::Draft` |
| Event member | `EventNext` | `Event::Next` | `Event.Next` | `Event.NEXT` | `Event::Next` |
| Function | `Apply`, `FromCode` (pascal, export required) | `apply`, `from_code` (snake) | `apply`, `fromCode` (camel) | `apply`, `from_code` (snake) | `apply`, `fromCode` (camel, namespace function) |
| Call | `order.Apply(…)` | `order::apply(…)` | `order.apply(…)` | `order.apply(…)` | `Order\apply(…)` |
| Error | `status.Error` | `status::Error` | `status.Error` | `status.Error` | `<ns>\Status\Error` |

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
- Errors are reported only through `status.Error`; nothing returns null.
- The only function that takes a raw integer is `from_code`.
  - Its argument is the language's 64-bit signed integer (go `int64`, rust `i64`, php/python `int`; npm `number`, which is a double: a non-integer or unsafe-integer input is `E_UNKNOWN_CODE`). The caller passes the DB value without narrowing it.
  - 0, out of range or an unknown code → `E_UNKNOWN_CODE`; a reserved code → `E_RESERVED_CODE`.
- The consumer's status column is dbspec `i32`.
- In go/npm/python a state type can hold any integer, so the default branch of the switch throws `E_UNKNOWN_CODE`.
- File header: `Code generated by status-gen from <machine>; DO NOT EDIT.`

## C. Structure and enforcement tools

### C-1. Repository
```
status/
  AGENTS.md(.ko) README.md(.ko) CHANGELOG.md(.ko) Makefile kit.json .kit/ .node-version rust-toolchain.toml .githooks/
  .gitignore            # anchored only: /var/, /.results/, /packages/*/node_modules/, /packages/*/vendor/, /packages/*/target/, /packages/status-python/**/__pycache__/, php-ext phpize output under /packages/status-php-ext/src/ (exact patterns fixed in S-14; config.m4 and generated sources stay unignored), /packages/status-gui/build/, /packages/status-gui/public/assets/, /packages/status-php*/.phpunit.result.cache, /packages/status-php*/.phpunit.cache/
  config/{checklist,documents,owner-checks,commits,toolchain,dependency-policy,dependency-review}.json
  scripts/kit/ tests/kit/                    # vendored from kit
  scripts/check-layout.mjs scripts/check-parity.mjs scripts/gen-check.mjs   tests/check-layout/ tests/check-parity/ tests/gen-check/
  contracts/layout.json (tools, kinds, canonical tree, allowed differences)   contracts/features.json
  docs/spec/status.md(.ko)  docs/plans/execution-checklist.md(.ko)  docs/plans/status-v1.md(.ko)
  schema/status.schema.json  schema/status.dbs  schema/persist.dbs   # persist.dbs = shared by the six language package examples
  status.config.json  machines/order.status.json  status.lock.json  conformance/vectors/<machine>.json
  packages/status-compiler/  {src/core/, src/backends/, src/store-json/, src/store-mermaid/, src/cli/, tests/}  # zero dependencies
  packages/status-db/        {src/, tests/}   # DbStore + status-db CLI, depends on orm
  packages/status-gui/       {app/app.json, templates/, client/main.ts, public/assets/, build/, src/, crud/*.yml, tests/}
  packages/status-{go,npm,php,php-ext,python,rust}/
```
- External dependencies are pinned to release tags: orm v0.0.7, ordered-json v0.0.7, hyper v0.0.11, template v0.0.5, crudui v0.0.5, mermaid (exact npm version).
  - npm: the release asset URL in `dependencies`; transitive `@polyspec/*` with the same URLs in `overrides`
  - composer: the dist zip of a `package` repository, `config.platform.php` 8.4.x
  - go: `require github.com/polyspec/orm v0.0.7`
  - python: `polyspec-orm @ git+https://github.com/polyspec/orm@v0.0.7#subdirectory=packages/orm-python`
  - cargo: `{ git = "https://github.com/polyspec/orm.git", tag = "v0.0.7" }`
  - `.node-version` holds an exact 26.y.z release (required by hyper; kit toolchain-declared.mjs accepts only <major>.<minor>.<patch>).
- The pins live in the manifests and lock files and are listed in `config/dependency-policy.json`. The kit gate does not check npm URLs, the Composer `package` dist URL, python `git+…@tag` or cargo tags; pin verification is a review rule (no R requires a tool for it).

### C-2. Canonical structure of a language package (identical for all six)
```
packages/status-<kind>/
  README.md README.ko.md
  Makefile          # gen (gen + vectors --kind; flags only here; DEST ?= .)
                    # test (run-tests --cwd packages/status-<kind> --results .results/<kind>.json; paths resolve against the checkout root)
  <manifest>        # [allowed difference] depends on orm (SQLite) for tests and examples
  <lock>            # [allowed difference] go.sum, package-lock.json, composer.lock, Cargo.lock (read by the kit dependency gate); python has none
  src/…             # status-gen output only
  tests/conformance.<ext>   # hand-written check functions; except in rust, iterates the vectors and registers one test per case
  tests/vectors.<ext>       # status-gen output (language-native data); in rust, one #[test] per case
  examples/persist.<ext>    # B-4 orm persistence; tests run it with the persist vectors
  examples/model/           # orm-generated model from the root schema/persist.dbs (committed, covered by gen-check); rust uses build.rs as an allowed difference
```
- `make gen` produces the status-gen output and the orm-gen output together.

| kind | manifest | src | tests |
|---|---|---|---|
| go | go.mod | `src/order/order.go`, `src/status/status.go` (in Go a package is a directory) | `conformance_test.go`, `vectors_test.go` |
| npm | package.json | `order.js/.d.ts`, `status.js/.d.ts`, `index.js/.d.ts` (`export * as order`) | `conformance.test.mjs`, `vectors.mjs` |
| php | composer.json | `Order/{State,Event,Step}.php`, `Order/functions.php`, `Status/Error.php` | `ConformanceTest.php`, `Vectors.php` |
| php-ext | composer.json (`type: php-ext`, `extension-name`, `build-path: src`) | `config.m4`, `order.c`, `status.c` (shared `<ns>\Status\Error` and error code constants), `php_<ext>.h`, `<ext>.stub.php`, `<ext>_arginfo.h` | tests **byte-identical** to php; `make test` builds with phpize, then runs with `--php-extension <.so>`; gen requires `--php-namespace` and `--php-ext-name` |
| python | pyproject.toml | `polyspec_status/{__init__,order,status}.py` | `test_conformance.py` (generates methods named exactly after the cases), `vectors.py` |
| rust | Cargo.toml (`autotests=false`, `autoexamples=false`, `[[test]] conformance`, build-dep `polyspec-orm-build`, dev-dep `tokio`) + `build.rs` | `lib.rs` (`pub mod order; pub mod status;`), `order.rs`, `status.rs` | `conformance.rs` (`mod vectors;`, `#[path="../examples/persist.rs"] mod persist;`); persist cases are `#[tokio::test]`; generated `tests/vectors.rs` starts with `#![allow(non_snake_case)]` |

- check-layout fails when:
  - the set of `packages/status-*` directories, excluding the tool packages `status-compiler`, `status-db` and `status-gui` that `layout.json` lists under `tools`, differs from `kinds`
  - tracked files or non-ignored new files deviate from the canonical tree (added, missing, renamed)
  - the php and php-ext tests are not byte-identical
  - layout.json is malformed
- Kinds are added one at a time by the package items.

### C-3. Result records (K18)
- The counts that kit `test-progress.mjs` writes in `close()` gain `cases: [{id, status, elapsedMs}]`.
- With `run-tests --results <file>`, the runner adds `{tool, inputs, elapsedMs}` and writes the file once through a temporary file + rename.
- `inputs` = kit `inputsDigest(root, paths)`, built from the paths and sha256 of tracked and non-ignored new files under `paths` (the package directory and `schema/persist.dbs`).
- A case name is `test_<featureId>__<vectorId>`.
  - Both ids match `^[a-z][a-z0-9]*(_[a-z0-9]+)*$` and contain no `__`.
  - A vectorId starts with `<machine>_`.
  - Language tests use this name as is.

### C-4. `check-parity.mjs`
Fails when (no exemptions):
- `.results/<kind>.json` of a kind in `kinds` is missing, or its `inputs` differs from the current digest
- a vector case did not run in some kind
- a result holds a case that is not in the vectors
- a feature in features.json has zero vector cases
- a case has any status other than `pass` (`fail`, `timeout` and `skip` all fail)
- a result id yields two or more distinct case names, or yields none and is not the parent of a matched id (an id that a matched id extends with ` › `, such as the Go test function that runs the cases as subtests)
- without `--kind`: `.results/<target>.json` of compiler-test, db-test or gui-test is missing
- `elapsedMs > 600000` in any `.results/*.json` (with `--kind`: only that kind's result)

Case name extraction: `/\btest_[a-z][a-z0-9]*(?:_[a-z0-9]+)*__[a-z][a-z0-9]*(?:_[a-z0-9]+)*\b/` is applied to each result id. An id with exactly one distinct match is that case; an id with zero or with two or more distinct matches is judged by the result-id bullet above. There are no per-tool rules.

`contracts/features.json` = `initial`, `code`, `key`, `from_code`, `is_final`, `events_from`, `target`, `apply`, `persist`.

Vectors (exhaustive; the core generates the oracle):
- `initial`
- per state: the `code`/`key`/`from_code` round trip, `is_final`, `events_from`
- `target` for every (state, event)
- for each defined (expected, event)
  - actual = expected → `Changed`
  - actual = to → `Unchanged`
  - every other defined state → `E_CONFLICT`
- undefined (state, event) → `E_INVALID_TRANSITION`
- `from_code`: 0, an unknown code, each reserved code
- `persist`: first attempt / retry / conflict

### C-5. compiler `packages/status-compiler`
- Parts
  - `src/core`: object → validate → normalize → backends, plus `run` and `copy`. It has zero `node:` imports, and the GUI imports it as is.
  - `src/backends/<kind>.mjs`
  - `src/store-json`, `src/store-mermaid`
  - `src/cli` (`status-gen`)
- Commands
  - `lock [--rename]`
  - `gen --kind <k> --out <dir>` (php requires `--php-namespace`; php-ext requires `--php-namespace` and `--php-ext-name`)
  - `vectors [--kind <k>] --out <path>`
  - `check`: validates every definition and the lock match
  - `copy --to json|mermaid --root <dir>`
- Root `gen-check`
  1. Run `status-gen vectors --out var/gen-check/conformance/vectors`.
  2. In each package of `kinds`, run `make gen DEST=$(CURDIR)/var/gen-check/<kind>`.
  3. `scripts/gen-check.mjs` compares with the working tree through kit `trackedFiles` (tracked and non-ignored files only, so ignored outputs such as `__pycache__/` and the phpize output in php-ext `src/` are not read). `conformance/vectors` and each package's `src/`, `tests/vectors.<ext>` and `examples/model/` (except rust) must hold the same file set with byte-identical content.
  - `gen-check-test` (`tests/gen-check/`) RED: a one-byte change fixture, an added file fixture, an ignored file that must not be read

### C-6. status-db `packages/status-db`
- `schema/status.dbs` → orm-generated model (npm).
  - Definition tables
    - `machine(name PK)` (machine order is by name)
    - `state(machine, key, code i32, position, initial, final)`: PK(machine,key), unique(machine,code), unique(machine,position)
    - `event(machine, key, position)`: PK(machine,key)
    - `edge(machine, event, from, to, position)`: PK(machine,event,from). FK (machine,event)→event, (machine,from)·(machine,to)→state, with leading indexes
  - Lock tables
    - `lock_code(machine, code i32, key)`: PK(machine,code)
    - `lock_reserved(machine, code i32)`: PK(machine,code)
    - No FK to machine, because the lock of a machine removed from the definitions must remain.
- `DbStore` implements the store contract. `save` replaces everything inside one transaction. Validation is finished by core `run` before the store is called.
- The `status-db` CLI runs core `run` and `copy` with DbStore and the json/mermaid stores.
- Tests (SQLite)
  - store contract (round trip and byte-identical results)
  - `E_STORE_NOT_EMPTY`
  - transaction atomicity RED
  - dialect differences are orm's own conformance responsibility

### C-7. GUI `packages/status-gui` (hyper Node server + crudui + mermaid)
- The GUI is a single-editor tool. save replaces everything; the last write wins.
- Build: `hyper-build-assets --app . --api /api --output build` (hyper v0.0.11 requires `--app`, `--api` and `--output`) produces `templates.index.json`, `manifest.json` and the `public/assets` bundle (run before gui-test).
- Run: `status-gui`
  - The store follows `status.config.json`.
  - `App.open({manifest, templates: {index: build/templates.index.json, root: public}, handlers, timezone: 'UTC'})` with absolute paths; `var/sessions` is created before `FileSessions` opens it
  - `app.server(new FileSessions({directory: var/sessions}), {files: public})`
- Screens
  - Machine list (crudui list)
  - Machine detail: states, events and edges, Mermaid diagram
    - The canonical output of the mermaid store goes into `<pre class="mermaid">`.
    - `client/main.ts` imports npm `mermaid` and calls `mermaid.run()` on first load and on every `htmx:after:settle`.
    - The bundle is served from `public/assets`, so it works offline.
  - State, event and edge forms
  - rename
- Forms (crudui)
  - The server loader/action runs generator-core `compileForm`/`createForm` → generator-html `renderForm(instance, {action, hidden: {_csrf}, errors, formErrors})` and puts the resulting string into the template with `{= form | raw}`.
  - `connectForm` in `client/main.ts` handles adding and removing rows.
  - `crud/*.yml` holds no validation rules, and form-binding is not used. The only rules are the core's.
  - `src/form-data.mjs` parses the flat `form[…]` names of a submitted body into crudui row-key objects. An invalid or duplicate name is `BadRequest` (with a RED test).
  - A core error carries `{machine, path}` (the definition JSON path).
    - The GUI converts it to a crudui data path and puts it in `errors`.
    - An error with no node (such as `E_KEY_RESERVED`) goes into `formErrors`.
    - The response is `Result.invalid({form})` (422).
- Rules
  - Every save goes through core `run save`.
  - The core rejects a key change on an existing code with `E_CODE_KEY_CHANGED`. Renames happen only on the rename screen (`lock --rename`).
  - The GUI owns no rules.
- Tests
  - hyper handler unit tests (node:test)
  - `check` passes after a save
  - crudui owns form rendering correctness; hyper owns routing correctness.

---

## D. Checklist draft

**kit checklist (done first in the kit repository → release → kit-sync in status; written in kit's own 5-column format when added there)**

| id | Item | RED → GREEN | State |
|---|---|---|---|
| K17 | `run-tests python`: read the stderr of `python3 -m unittest -v`, with one line parser shared with cargo; the runner enforces the timeout; update tool-inventory(.ko) | PATH stub python3: pass/fail/timeout/no-test RED | [ ] |
| K18 | `run-tests --results` (counts `cases` + `inputs` + `elapsedMs`), `inputsDigest`, update tool-inventory | fixture node/vitest tests + PATH stub go/cargo/phpunit/python3 RED | [ ] |
| K19 | `check-commits` rule: a commit that moves an item to `[o]` also changes the changelog (en and ko), and one commit changes the state of at most one item; add `done` and `changelog` to the schemas; a row added in the commit is not a state change | git fixture RED | [ ] |

**status checklist**

| id | Item | RED → GREEN | State |
|---|---|---|---|
| S-01 | git init, kit-sync, config (toolchain: node only; dependency-policy with empty lists + `config/dependency-review.json` from `make dependency-review RECORD=1`), hooks, AGENTS.md(.ko) section A, the checklist with every S row of section D (S-01 `[o]`, the rest `[ ]`), CHANGELOG, this plan, `CHECK_TARGETS` (only the targets defined so far; each item appends its own) and `check` | `kit-check owner-validate documents-check commits-check toolchain-check hooks-check dependency-policy-check` | [ ] |
| S-02 | `docs/spec/status.md(.ko)` section B | `documents-check` | [ ] |
| S-03 | `check-layout` + `layout.json` (kinds = []) + `layout-test`/`layout-check` | fixtures (kinds mismatch/added/missing/renamed/php↔php-ext mismatch/malformed) RED | [ ] |
| S-04 | `check-parity` + `parity-test` | fixtures (no result/missing tool result/`--kind` reads only its kind/stale inputs/not run/unregistered/zero cases/fail/timeout/skip/0 or 2 name matches/parent id/over 10 minutes) RED | [ ] |
| S-05 | core `E_SCHEMA` + schema correspondence test | RED | [ ] |
| S-05-1 | core graph errors | RED per error code | [ ] |
| S-05-2 | core name/code errors | RED per error code | [ ] |
| S-06 | normalize/IR + lock (rename/reserved) + JsonStore + store contract + `run`/`copy` | RED per lock scenario | [ ] |
| S-07 | `status.config.json` (`{"store":"json"}`) + `machines/order.status.json` + `status.lock.json` + `contracts/features.json` + vector oracle (rejects unregistered featureId) + `gen-check` + `gen-check-test` | matches hand-written expected fixture, gen-check RED | [ ] |
| S-08 | MermaidStore (canonical parser and writer) + json↔mermaid round trip | `E_MERMAID_UNSUPPORTED`, order violation, round-trip mismatch RED | [ ] |
| S-09 / S-09-1 | npm backend + `vectors --kind npm` (golden) / npm package (conformance + persist + root `schema/persist.dbs` (created here, shared afterwards) + `examples/model/` (orm-gen, covered by gen-check), add the kind, add toolchain and dependency-policy, `test-npm`) | RED with no generated output → pass, layout and parity | [ ] |
| S-10 … S-14 (+ `-1`) | the same for go, python, php, rust, php-ext | same | [ ] |
| S-15 | status-db: dbs + DbStore + contract tests + copy + `db-test` | contract mismatch, `E_STORE_NOT_EMPTY`, atomicity RED | [ ] |
| S-16 | GUI skeleton: hyper app + list and detail + Mermaid + `gui-test` | handler RED | [ ] |
| S-17 | GUI editing: crudui forms + validation error display + lock/rename | `check` passes after a save | [ ] |

owner-checks mapping (each item adds its own part):

| Path | Owner checks |
|---|---|
| `scripts/kit/**`, `tests/kit/**`, `.kit/**`, `kit.json`, `config/**`, `Makefile`, `.gitignore`, `.node-version`, `rust-toolchain.toml` | `kit-check owner-validate documents-check commits-check toolchain-check dependency-policy-check` |
| `.githooks/**` | `hooks-check` |
| `**/*.md` | `documents-check` |
| `scripts/check-layout.mjs`, `tests/check-layout/**` | `layout-test layout-check` |
| `contracts/layout.json` | `layout-test layout-check gen-check packages-test` |
| `scripts/gen-check.mjs`, `tests/gen-check/**` | `gen-check-test gen-check` |
| `scripts/check-parity.mjs`, `tests/check-parity/**` | `parity-test` |
| `packages/status-compiler/**`, `schema/status.schema.json`, `machines/**`, `status.lock.json`, `conformance/**`, `contracts/features.json`, `status.config.json` | `compiler-test gen-check` |
| `schema/persist.dbs` | `gen-check packages-test` |
| `schema/status.dbs`, `packages/status-db/**` | `db-test` |
| `packages/status-gui/**` | `gui-test` |
| `packages/status-<kind>/**` | `layout-check gen-check parity-<kind> dependency-policy-check` |

- `parity-<kind>` (a literal target per kind with prerequisite `test-<kind>` and recipe `node scripts/check-parity.mjs --kind <kind>`) is the owner check of a kind. With `--kind`, check-parity reads only that kind's result and applies the C-4 conditions to it alone (every vector case ran once and passed, no unknown case, current `inputs`, `elapsedMs`); it reads neither other kinds nor the tool results. `parity-check` (no prerequisite, no `--kind`) reads every kind and the tool results and runs in `check` after `packages-test`.
- Independent items (S-03, S-04, S-05) may run in parallel.
- The full suite runs once with `make check` after S-17 is committed.

## E. Order of work
1. kit K17–K19 → kit release → status from S-01.
2. Audits during implementation follow the audit rules of section 0. The auditor gives the exact location and replacement text, each finding is judged against its evidence, and the loop repeats until there are no core disagreements.

## Verification
- The root Makefile defines these targets after `include scripts/kit/kit.mk`:
  - `CHECK_TARGETS`, `check`
  - `layout-test`, `layout-check`, `parity-test`, `parity-check`
  - `compiler-test`, `db-test`, `gui-test`, `gen-check-test`, `gen-check`
  - `test-<kind>`, `parity-<kind>` (`parity-<kind>: test-<kind>`), `packages-test` (the `test-<kind>` of `kinds` with `make -j6`)
- `check` = `node scripts/kit/full-run.mjs run $(CHECK_TARGETS)`
  - `CHECK_TARGETS` = `kit-check owner-validate documents-check commits-check hooks-check toolchain-check dependency-policy-check layout-test layout-check parity-test compiler-test db-test gui-test gen-check-test gen-check packages-test parity-check`
- During item work only the owner-checks mapping runs.
- GUI manual check, for each of the json, mermaid and db stores:
  1. Add, delete and rename states, then save (save updates the lock too).
  2. `check` passes (`status-gen check` for json and mermaid, `status-db check` for db).
  3. Mermaid renders in the browser.
