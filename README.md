<!-- doc-id: readme -->
# polyspec/fsm

[한국어](README.ko.md)

fsm defines a state machine once and generates code for go, npm (js + d.ts), php, php-ext, python and rust. The generated
code has no runtime dependency and does no parsing at run time. A state is an integer code, an event moves the machine along
its edges, and a transition is idempotent: a retry never advances the machine twice. The definition is held in one of three
stores (JSON, Mermaid `stateDiagram-v2`, a database through orm), and all three follow one rule set.

- Plan and scope: [docs/plans/fsm-v1/plan.md](docs/plans/fsm-v1/plan.md)
- Definition: [docs/spec/fsm.md](docs/spec/fsm.md)
- Checklist: [docs/plans/fsm-v1/checklist.md](docs/plans/fsm-v1/checklist.md)
- Development rules: [AGENTS.md](AGENTS.md)
- Documentation site: built from these documents by `make docs-build` (VitePress, `docs/.vitepress`, C-8 of the plan); once S-21 deploys it, it is served at https://polyspec.github.io/fsm/

## What fsm is and is not

fsm is a generator. You describe a machine once, in JSON, in Mermaid or in database tables, and fsm checks the description and
writes source files for your language. Your program calls the generated functions; fsm is not in the process at run time.

fsm is:

- a flat enum of states, each with an explicit integer code (the code is the identity, the key is the name);
- a set of events, where an event is a named list of edges `{from, to}`;
- a partial transition function: a pair (state, event) with no edge is an error, not a silent no-op;
- deterministic: every validation rule holds before anything is generated;
- pure functions with no runtime dependency, generated as `switch`/`match` code in each language;
- one rule set for three definition stores: JSON files, Mermaid files and orm database tables.

fsm is not (the verdicts of `docs/spec/fsm.md`, B-0):

- guards, conditions, entry and exit actions, callbacks, or any side effect in a transition;
- hierarchical or parallel states, history, timed or automatic events, event queues or extended state;
- wildcard `from`, self transitions, or typestate;
- a runtime loader of definitions: the compiler reads the definition, never your program;
- names stored as strings in the database, labels or translations;
- a sequence syntax: next and previous are ordinary events;
- a setting for the storage width: codes are always in the 32-bit range.

The language packages of this repository (`packages/go` and the others) are test beds: they hold the generated code and
check it against the conformance vectors. They are not published libraries. You use fsm by generating its code into your own
project, as the README of each language explains.

## The model

A definition has three parts: the machine name, its states and its events.

- A **state** has a key (a name such as `draft`), a code (an integer from 1 to 2147483647, unique in its machine), an optional
  `initial` flag (exactly one state per machine) and an optional `final` flag.
- An **event** has a key and a list of edges. An edge `{from, to}` says that the event moves the machine from one state to
  another. An event with several edges is still one event, such as `next` below.
- Declaration order is meaningful: it is the order of the generated code and of the lists that the functions return.

The example `order` below is an order lifecycle. `order` is only the key of this example machine; any key of the key format
(lower-case letters, digits and single underscores, at most 64 characters) works.

JSON (the same content as `machines/order.fsm.json`, written here on fewer lines):

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

Mermaid (the file `machines/order.fsm.mmd` that `fsm-gen copy --to mermaid` writes; the Mermaid store reads only this canonical
form):

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

The Mermaid form is canonical: the lines come in a fixed order (for each state its label line and its description line, the initial
line, the edges by event, the final lines), a code is written in decimal, the label of a state is its key (a label that differs is
refused), and the reader rejects any other line with `E_MERMAID_UNSUPPORTED`, which names
the line. Composite states, notes, fork and join, choices, styles and comments are not part of the form.

Database (the six tables of `packages/db/schema/fsm.dbs`, after `fsm-db copy --from json` into a new database; the rows of `order`):

| table | rows of the example |
|---|---|
| `machine` | `order` |
| `state` (machine, key, code, position, initial, final) | `draft` 1 at position 0, initial; `paid` 2; `shipped` 3; `done` 4, final; `canceled` 5, final |
| `event` (machine, key, position) | `next` 0; `prev` 1; `cancel` 2 |
| `edge` (machine, event, from, to, position) | seven rows, for example `next` from `draft` to `paid` at position 0 |
| `lock_code` (machine, code, key) | `1` `draft` through `5` `canceled` |
| `lock_reserved` (machine, code) | no rows |

The three stores hold the same definition, and every command gives the same result on each of them. The table layout is in
[packages/db/README.md](packages/db/README.md).

## Codes and the lock

The code is the identity of a state; the key is its name. Three rules keep a code meaningful, and the tools enforce them:

- A code never changes meaning. Changing the code of a state is `E_CODE_CHANGED`.
- A key is renamed only with its code kept: `fsm-gen lock --rename order.draft=created` changes the definition and the lock
  together. A key change on an existing code without `--rename` is `E_CODE_KEY_CHANGED`.
- A code is never reused. When a state disappears from the definition, its code moves to `reserved` in the lock, and no new
  state may take it (`E_CODE_REUSED`). Deleting a whole machine moves all its codes to reserved; its lock entry stays.

A code is an integer from 1 to 2147483647; 0 means "unset". The core picks a new code as the largest code it knows (in the
definition, the lock or the reserved list) plus one, and a choice past the range fails with `E_CODE_RANGE`. A new record of a
machine starts only in its initial state; moving the data of a deleted state is the consumer's task.

The lock is the file `fsm.lock.json` (in the database, the tables `lock_code` and `lock_reserved`). For each machine it holds
`codes` (code to key) and `reserved` (the codes that no state may take):

```json
{
  "order": {
    "codes": { "1": "draft", "2": "paid", "3": "shipped", "4": "done", "5": "canceled" },
    "reserved": []
  }
}
```

The lock is committed together with the definitions; it is the record of the codes that were ever released. `fsm-gen lock`
and `fsm-db lock` write it, the GUI save writes it, and `copy` writes the source lock unchanged. `check`, `vectors` and `gen`
only read it. When the lock and the definitions disagree, those three commands fail with `E_LOCK_MISMATCH`.

The committed lock is the baseline (`docs/spec/fsm.md`, B-3). The json and mermaid stores read it from git HEAD (`git show
HEAD:./fsm.lock.json`); the db store has no commit and compares with its stored rows. A lock that loses a committed code, removes a
committed reserved code from `reserved` or gives it to a state, or swaps the codes of committed keys is refused with
`E_LOCK_REGRESSED`, and nothing is written. `lock`, `save`, `check`, `gen`, `vectors` and `copy` all apply this rule. A rename of
a state that is not committed yet is accepted: it keeps the code and drops the old key. With `order` committed as above,
deleting `fsm.lock.json` and swapping the codes of `paid` and `shipped` gives (the real output of `fsm-gen lock`):

```
[fsm-gen] E_LOCK_REGRESSED order $.codes: code 2 was paid in the committed lock of order and is shipped now, while paid keeps another code
[fsm-gen] E_LOCK_REGRESSED order $.codes: code 3 was shipped in the committed lock of order and is paid now, while shipped keeps another code
```

A project outside git, or one whose `fsm.lock.json` is untracked or ignored, has an empty baseline and gets no such protection; the
lock rules then judge the stored lock alone. A database has no committed record in this version, so there `E_LOCK_REGRESSED` does
not arise; rows changed or deleted outside fsm (in SQL) are not detected.

## Transitions

A transition is computed from two states: the **expected** state, which the caller read before it asked for the event, and
the **actual** state, which the store holds now. The unit of idempotency is the pair (expected, event).

- `target(expected, event) → to` gives the state that the event leads to from `expected`. It fails with
  `E_INVALID_TRANSITION` when the event has no edge from that state.
- `apply(expected, event, actual) → Step` decides one attempt. `Step` has two fields: `to`, the target state, and `changed`,
  which says whether the stored state must be written.

| Condition | Result |
|---|---|
| the event has no edge from `expected` | `E_INVALID_TRANSITION` |
| `actual == expected` | `Changed(to)`: write `to`; `changed` is true |
| `actual == to` | `Unchanged(to)`: the machine is already in the target state; write nothing |
| anything else | `E_CONFLICT`, with `expected`, `actual` and the event in the error |

Why `expected` makes a retry safe: take `next` from `draft`. The first attempt sees `actual == draft` and returns
`Changed(paid)`, and the caller writes `paid`. If the response is lost and the caller retries with the same `expected`
(`draft`), the stored state is now `paid`, which is `to`, so the retry returns `Unchanged(paid)` and writes nothing. Without
`expected`, the retry could not tell "already moved" from "moved twice", and a second `next` would move the order on to
`shipped`. A stale request is caught the same way: if the stored state is `shipped` when a request expected `draft`, the
result is `E_CONFLICT`. De-duplicating requests with an idempotency key is the caller's job.

The persistence pattern reads the stored state under a row lock inside one transaction, applies the event to it, and writes
only when the result is `Changed`. An error of `apply` rolls the transaction back. Each language package quotes its version of
the pattern from its `examples/` directory: `packages/go/examples/persist.go`, `packages/js/examples/persist.mjs`,
`packages/php/examples/persist.php` (the same file is in `packages/php-ext/examples/`), `packages/python/examples/persist.py`
and `packages/rust/examples/persist.rs`.

## Validation errors

The core checks every definition before it writes or generates anything. Each finding has a code, the machine, a JSON path
inside the machine (such as `$.states[1].code`) and a message. A finding prints as
`[fsm-gen] <code> <machine> <path>: <message>` on standard error, and the command exits 1. The reference is
`docs/spec/fsm.md`, B-5; each code has one line here.

| Code | Meaning |
|---|---|
| `E_SCHEMA` | a field is missing, unknown or of the wrong type, an event has no edge, or a file is not named `<machine>.fsm.json` (or `.fsm.mmd`) |
| `E_SELF_LOOP` | an edge goes from a state to itself |
| `E_NONDETERMINISTIC` | one state and one event lead to two or more targets |
| `E_DUPLICATE_EDGE` | the same edge is listed twice in one event |
| `E_INITIAL_COUNT` | the machine does not have exactly one initial state |
| `E_FINAL_OUTGOING` | an edge leaves a final state |
| `E_UNREACHABLE` | a state cannot be reached from the initial state |
| `E_DEAD_END` | a state that is not final has no outgoing edge |
| `E_KEY_FORMAT` | a machine, state or event key is not lower-case letters and digits joined by single underscores, or is longer than 64 characters |
| `E_DUPLICATE_KEY` | a key repeats in its scope, or two machine keys are equal once `_` is removed |
| `E_KEY_RESERVED` | a key is on a fixed list of names that a generated file, module, language keyword or Mermaid word cannot take |
| `E_DUPLICATE_CODE` | two states of one machine have the same code |
| `E_CODE_RANGE` | a code is outside 1 to 2147483647 |
| `E_UNKNOWN_STATE_REF` | an edge names a state that the machine does not have |
| `E_LOCK_MISMATCH` | the lock does not hold exactly the codes of the states, or a machine that is not defined has codes in the lock |
| `E_LOCK_REGRESSED` | the lock loses a committed code, unreserves one or gives it to a state, or swaps the codes of committed keys (json and mermaid: against git HEAD) |
| `E_CODE_REUSED` | a state takes a code that the lock holds as reserved |
| `E_CODE_KEY_CHANGED` | a state keeps its code but its key changed, without `--rename` |
| `E_CODE_CHANGED` | a key that the lock maps to a code is given another code |
| `E_MERMAID_UNSUPPORTED` | a Mermaid file has a line outside the canonical form; the message names the line |
| `E_STORE_MIXED` | `machines/` holds files of a store other than the one `fsm.config.json` names |
| `E_STORE_NOT_EMPTY` | `copy` would write into a target that already holds definitions or a lock |
| `E_STORE_NOT_CONFIGURED` | `fsm.config.json` is missing or is not valid JSON, or it names a store that the command does not handle |
| `E_NOT_GENERATED` | a file in the output directory of `gen` or `vectors` has no generated header; nothing is written or removed |

The codes of the functions are a separate family: `E_INVALID_TRANSITION` and `E_CONFLICT` from `target` and `apply`,
`E_UNKNOWN_CODE` (a value that is no state, 0 included) and `E_RESERVED_CODE` (a reserved code) from `from_code`. They reach
your program as the `Error` of the generated language, which each language README describes.

## Project files

A fsm project is a directory. The tools read these files from its root:

```text
fsm.config.json          {"store":"json"}, {"store":"mermaid"} or {"store":"db","dsnEnv":"FSM_DSN"}
machines/                one file per machine: <machine>.fsm.json or <machine>.fsm.mmd (one format per project)
fsm.lock.json            the lock of the file stores (the db store keeps its lock in tables)
schema/fsm.schema.json   the JSON schema of a machine file, for editors; each machine file names it in `$schema`
```

The project of this repository is `contracts/`: its machines generate the six language packages, and it also holds
`schema/persist.dbs`, the example tables of the persistence pattern that the examples/ of the language packages use, and
`conformance/vectors.json`, the expected results of the vector cases that fsm-gen vectors writes. The six database tables of
the db store (dbspec `fsm`), which fsm-db install installs, are `packages/db/schema/fsm.dbs`.

`fsm.config.json` names the store, and fsm-gen, fsm-db and fsm-gui all read it. fsm-gen handles the json and mermaid stores; it
refuses `db` with `E_STORE_NOT_CONFIGURED`, and fsm-db handles only `db`. Changing the store of a project after a migration is
a decision for you: the tools do not change `fsm.config.json` for you.

## Requirements and setup

The tools run on Node.js. The pinned release is `node` of `mise.toml` (26.12.0), which `make install-tools TOOLS=npm` installs into the checkout, and npm comes with it. The generated code needs
only the toolchain of its own language:

| For | You need |
|---|---|
| fsm-gen, fsm-db, fsm-gui and the generated npm code | Node.js 26.12.0 (`mise.toml`) and npm |
| generated go code | Go 1.27.2 (`go 1.27.2` in the module) |
| generated php code | PHP 8.4 or later (the orm client requires 8.4); the checkout tests with PHP 8.4 and Composer 2.10.3 (`config/toolchain.json`) |
| generated php-ext code | the php requirements, plus `phpize`, `autoconf` and a C compiler |
| generated python code | Python 3.14 (`config/toolchain.json` `pythonBuild`); `make install` installs it into `var/tools` with the uv of `config/toolchain.json` (`make install-tools`) |
| generated rust code | Rust 1.99.0 (`rust-toolchain.toml`); the generated library uses only the standard library |

The commands come from a clone of this repository. Install each one onto your PATH from the clone: npm links the package of the
clone, so the command runs the code of that clone.

```sh
git clone https://github.com/polyspec/fsm.git
cd fsm
make install-tools TOOLS=npm                       # once, online: the npm of packageManager (package.json)
make install-packages                              # once, online: the root packages, @polyspec/kit among them
make install                                       # once, online: the toolchains and every package dependency
npm install -g ./packages/compiler             # fsm-gen: no dependencies
make db-deps && npm install -g ./packages/db   # fsm-db: needs the orm packages
make gui-build && npm install -g ./packages/gui # fsm-gui: builds the browser assets first
```

The first two commands install the shared tools of polyspec, the package `@polyspec/kit`, whose make targets the Makefile
includes (`scripts/kit/kit-bootstrap.mk`); before them, only these two targets run. `make install` downloads the toolchains of `var/tools` (the Python 3.14 of `pythonBuild` among them) and every package dependency once; a later run finds them installed and
downloads nothing. The first `npm install -g` is all that the json and mermaid stores need. `make db-deps` installs the orm
packages of `packages/db` from their release tarballs, and `make gui-build` installs the GUI and builds its browser assets.

## The fsm-gen CLI

`fsm-gen` is the compiler's command line. It has five commands. Each takes `--project <dir>`, the project root whose
`fsm.config.json` names the store, and it defaults to the current directory. The exit codes are the same for every command:

| exit | meaning |
|---|---|
| 0 | the command succeeded; stdout holds `[fsm-gen] <command>: ok` |
| 1 | a finding (one line per finding on standard error), or an unexpected rejection, printed with its stack |
| 2 | a usage error: an unknown command, an option that the command does not take, or a missing or invalid value; the usage is on standard error |

### check

Validates every definition and compares the lock with them. It writes nothing.

```sh
$ fsm-gen check --project ./order-machines
[fsm-gen] check: ok
```

### lock

Derives the lock from the definitions and writes both. `--rename machine.old=new` renames a state key and keeps its code; the
option may be repeated. Nothing is written when there is a finding.

```sh
$ fsm-gen lock --project ./order-machines --rename order.draft=created
[fsm-gen] lock: ok
```

### copy

Copies the definitions and the lock from the project store into a file store. `--to json` or `--to mermaid` names the
format, and `--root <dir>` names the target directory, which is required. A target that already holds definitions or a lock
fails with `E_STORE_NOT_EMPTY`, and nothing is written.

```sh
$ fsm-gen copy --to mermaid --root ./order-mermaid --project ./order-machines
[fsm-gen] copy: ok
```

### vectors

Writes the conformance vectors, the expected result of every operation of every machine (`docs/plans/fsm-v1/plan.md`, C-4).
Without `--kind`, `--out <file>` receives `{ machines: [{ machine, cases }] }`, one suite for every machine. With `--kind <kind>`, `--out` names the file of
the native test module of that kind. The php and php-ext kinds also need `--php-namespace`.

```sh
$ fsm-gen vectors --project ./order-machines --out ./vectors
[fsm-gen] vectors: ok
$ fsm-gen vectors --kind npm --project ./order-machines --out ./tests/vectors.mjs
[fsm-gen] vectors: ok
```

### gen

Generates the source of one language into `--out <dir>`. `--kind` is one of `go`, `npm`, `php`, `php-ext`, `python` and `rust`.
Each generated file starts with the header `Code generated by fsm-gen from <machine>; DO NOT EDIT.`. `gen` replaces the files it
wrote before and removes the stale ones among them, but it refuses to touch a file without the header (`E_NOT_GENERATED`), so
a hand-written file is never overwritten or removed. Git-ignored files of the output directory are build outputs and are skipped.

| Option | Required for | Meaning |
|---|---|---|
| `--go-module <module path>` | `go` | the module path of the package; the generated machines import `<module>/src/fsm`, so `--out` is the `src` directory of that module |
| `--php-namespace <ns>` | `php`, `php-ext` (also `vectors` for these kinds) | the namespace, such as `Acme\Fsm`: letters and digits separated by single backslashes |
| `--php-ext-name <name>` | `php-ext` | the extension name: lower-case letters, digits and underscores, starting with a letter, such as `acme_fsm` |

```sh
$ fsm-gen gen --project ./order-machines --kind go --go-module example.com/app --out ./app/src
[fsm-gen] gen: ok
$ fsm-gen gen --project ./order-machines --kind npm --out ./app/src
[fsm-gen] gen: ok
$ fsm-gen gen --project ./order-machines --kind php --php-namespace 'Acme\Fsm' --out ./app/src
[fsm-gen] gen: ok
$ fsm-gen gen --project ./order-machines --kind php-ext --php-namespace 'Acme\Fsm' --php-ext-name acme_fsm --out ./ext/src
[fsm-gen] gen: ok
$ fsm-gen gen --project ./order-machines --kind python --out ./app/order_fsm
[fsm-gen] gen: ok
$ fsm-gen gen --project ./order-machines --kind rust --out ./app/src
[fsm-gen] gen: ok
```

A missing option is a usage error (exit 2):

```sh
$ fsm-gen gen --project ./order-machines --kind go --out ./app/src
[fsm-gen] usage: gen --kind go needs --go-module <module path>, the module of the package
usage: fsm-gen check [--project <dir>]
       fsm-gen lock [--project <dir>] [--rename machine.old=new]...
       fsm-gen copy --to json|mermaid --root <dir> [--project <dir>]
       fsm-gen vectors [--kind <kind>] --out <file> [--project <dir>] [--php-namespace <ns>]
       fsm-gen gen --kind <kind> --out <dir> [--project <dir>] [--go-module <module path>] [--php-namespace <ns>] [--php-ext-name <name>]   (kind: go, npm, php, php-ext, python, rust)
```

A finding prints one line per finding, and nothing is written (exit 1). A broken definition, for example:

```sh
$ fsm-gen check --project ./broken
[fsm-gen] E_DUPLICATE_CODE order $.states[1].code: code 2 is used by another state of the machine
[fsm-gen] E_UNREACHABLE order $.states[5]: state Bad is not reachable from the initial state
[fsm-gen] E_DEAD_END order $.states[5]: state Bad is not final and has no outgoing edge
[fsm-gen] E_KEY_FORMAT order $.states[5].key: state key Bad is not lower case letters and digits joined by single underscores
```

The other two tools have their own commands: `fsm-db` for the database store and `fsm-gui` for the editor. Their usage is in
their READMEs.

## The tools

- [`fsm-gen`](packages/compiler/README.md): the compiler and its command line. It validates, locks, converts between the
  json and mermaid stores, writes the vectors and generates the six languages.
- [`fsm-db`](packages/db/README.md): the database store. It installs the six tables, checks and locks a database project,
  and copies between the database and a file store.
- [`fsm-gui`](packages/gui/README.md): a browser editor for the machines of a project, with a Mermaid diagram of each
  machine. Every save goes through the same core rules as `fsm-gen`.
- The language packages, one for each target: [go](packages/go/README.md), [npm](packages/js/README.md),
  [php](packages/php/README.md), [php-ext](packages/php-ext/README.md), [python](packages/python/README.md) and
  [rust](packages/rust/README.md). Each shows the generated code in use, its conformance tests and its persistence pattern.

## Generated names

One machine is one module. The names inside a module are the same in every language, and only the notation changes. The
table uses the machine `order` of the example above (B-6 of the definition).

| Concept | go | rust | npm | python | php / php-ext |
|---|---|---|---|---|---|
| Module | package `order` (`src/order/`) | `mod order` | `order.js` | module `order` | namespace `<ns>\Order` |
| Types | `State`, `Event`, `Step` | same | same | same | same |
| State member | `StateDraft` | `State::Draft` | `State.Draft` | `State.DRAFT` | `State::Draft` |
| Event member | `EventNext` | `Event::Next` | `Event.Next` | `Event.NEXT` | `Event::Next` |
| Functions | `Initial`, `Code`, `Key`, `FromCode`, `IsFinal`, `EventsFrom`, `Target`, `Apply` | `initial`, `code`, `key`, `from_code`, `is_final`, `events_from`, `target`, `apply` | `initial`, `code`, `key`, `fromCode`, `isFinal`, `eventsFrom`, `target`, `apply` | `initial`, `code`, `key`, `from_code`, `is_final`, `events_from`, `target`, `apply` | `initial`, `code`, `key`, `fromCode`, `isFinal`, `eventsFrom`, `target`, `apply` |
| Call | `order.Apply(…)` | `order::apply(…)` | `order.apply(…)` | `order.apply(…)` | `Order\apply(…)` |
| Error | `fsm.Error` | `fsm::Error` | `fsm.Error` | `fsm.Error` | `<ns>\Fsm\Error` |

- The shared module `fsm` holds the `Error` type and the error codes. Its machine key is reserved.
- A `State` value is the code: `type State int32` in go, `#[repr(i32)]` in rust, a frozen object and a union type in npm,
  `IntEnum` in python, `enum State: int` in php. An `Event` value is its declaration position, from 1.
- `Step` has the fields `to` and `changed`. Error codes lose their `E_` prefix in the notation of each language: `Code.Conflict`
  (npm), `Code::Conflict` (php, rust), `Code.CONFLICT` (python), `CodeConflict` (go).
- The parameters are the same in every language: `apply(expected, event, actual)` and `target(expected, event)`.

## Checks

`make check` runs the full suite of the repository once, over the committed tree (kit's `full-run.mjs run` with the
targets of `CHECK_TARGETS` in the Makefile). It needs every toolchain above. On a fresh clone, run `make install-tools TOOLS=npm`, `make install-packages` and `make install` once before it:
the toolchains come only from `make install`, while the targets of `make check` install the package dependencies they need. The
checks that the documents depend on can be run one at a time:

| command | checks |
|---|---|
| `make readme-check` | every README pair has its required sections and a Korean twin with the same headings (`scripts/check-readmes.mts`) |
| `make readme-test` | the tests of that check |
| `make workflows-test` | the CI and Pages workflows: every action is pinned to a verified commit, the check job runs `make install` and `make check` with the services of plan C-6, and each version comes from the file that declares it (`tests/workflows`) |
| `make docs-build` | the documentation site builds; a dead link fails the build |
| `make docs-build-test` | the site's dead-link failure and the real build |
| `make docs-check` | every document has its Korean twin with a current `source-sha256` stamp, and its links are valid |
| `make name-check` | no tracked file names the library by its old name |
| `make gui-test`, `make compiler-test`, `make db-test` | the tests of each tool |
| `make db-test-postgres`, `make db-test-mysql`, `make npm-persist-test-postgres`, `make npm-persist-test-mysql`, `make <kind>-persist-test-postgres`, `make <kind>-persist-test-mysql` (kind: go, rust, php, php-ext, python) | the DB store, CLI and command tests, the persistence concurrency proof of npm and the persist cases of each kind on PostgreSQL and MySQL; they read `FSM_TEST_PG_DSN` and `FSM_TEST_MYSQL_DSN` (and `FSM_TEST_PG_ADMIN_DSN` and `FSM_TEST_MYSQL_ADMIN_DSN` for the empty databases of the CLI tests), stop with exit 2 without them, and skip no dialect (plan C-6). The tests run on SQLite too (`make db-test`, `make npm-persist-test`, `make test-<kind>`) |
| `make test-go`, `make fsm-js-test`, `make test-php`, `make test-php-ext`, `make test-python`, `make test-rust` | the tests of each language package |

CI (`.github/workflows/ci.yml`) installs kit (`make install-tools TOOLS=npm`, `make install-packages`) and runs `make install` and then `make check` on every push to main, with PostgreSQL and MySQL services. The documentation site is published to https://polyspec.github.io/fsm/ by `.github/workflows/pages.yml`.

The conformance tests of each language package run the same vector cases, one test per case, named by the case name `<feature>__<id>` (php: the data set `<feature>__<id>` of the one method `testConformance`; python: the method `test_<feature>__<id>`), the name that kit's parity check (K33, `config/parity.json`) reads.
`make gen-check` checks that the generated files of the packages are the ones that `fsm-gen` writes today.
