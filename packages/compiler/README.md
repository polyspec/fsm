<!-- doc-id: readme-compiler -->
# @polyspec/fsm-compiler

[한국어](README.ko.md)

The compiler of fsm and its command line, `fsm-gen` (`docs/spec/fsm.md`, B-2; `docs/plans/fsm-v1/plan.md`, C-5). It reads a
definition, checks it, derives the lock, writes the conformance vectors and generates the source of the six languages. It
has no dependency, and the root README explains how to use it in a project. This README is for someone who changes or reads
the compiler.

## Architecture

The package has five parts. The core is the only part that holds the rules; the other four convert or write.

| Part | Files | Role |
|---|---|---|
| core | `src/core/validate.mjs`, `normalize.mjs`, `lock.mjs`, `reserved.mjs`, `vectors.mjs`, `run.mjs` | the rules of `docs/spec/fsm.md`, B-5, B-3 and B-4: `validate` returns the findings, `normalize` turns a definition into the intermediate form, `lock` derives the lock and `nextCode`, `vectors` is the oracle of the conformance cases, and `run` and `copy` are the commands |
| backends | `src/backends/index.mjs` (the kinds), `go.mjs`, `npm.mjs`, `php.mjs`, `php-ext.mjs`, `python.mjs`, `rust.mjs` | one file per language: `files(irs, lock, options)` returns the generated files |
| stores | `src/store-json/store.mjs`, `src/store-mermaid/store.mjs` with `parse.mjs` and `write.mjs`, `src/store-lock/lock-file.mjs` | the file stores: they convert between files and the objects of the core, and write each file atomically |
| io | `src/io/files.mjs`, `src/io/git.mjs` | the atomic write of a file and the git commands of the stores and the cli, on `node:fs` and `node:child_process` |
| cli | `src/cli/fsm-gen.mjs`, `src/cli/write-generated.mjs` | the command line, which chooses the store from `fsm.config.json`, prints the findings and sets the exit code; `write-generated.mjs` writes the generated files and refuses files without the header |

The core imports nothing from `node:`, so the GUI (`packages/gui`) imports it as it is. The tests of the compiler are in
`packages/compiler/tests/` (`make compiler-test`): the rules, the stores, the backends against the golden files in
`tests/golden/`, and the command line run as processes.

A command follows one path: the store loads the definitions and the lock, the core validates them and checks the lock, and
only then does the backend or the store write. A finding stops the command before anything is written.

## The store contract

A store is an object with two async methods:

```text
load()            → Promise<{ definitions, lock, findings }>
save({ definitions, lock }) → Promise<void>
```

- `load` returns the definitions as objects, in the order of the store, and the lock as an object by machine. A file that
  cannot be read is a finding, and the other files are still loaded.
- `save` writes the definitions and the lock. It writes atomically (a temporary file and a rename for each file), so each file
  is either old or new; across files the write is not atomic, and a stop in the middle leaves `E_LOCK_MISMATCH` for the next
  command to report.
- A store does not validate. The core does, in `run` and in `copy`, before a store is asked to write.
- The database store (`DbStore` in `packages/db/src/db-store.mjs`) implements the same contract and writes everything in
  one transaction. Its load returns the same objects, so every command gives the same result on the json, mermaid and db stores.

`run(command, store, options)` runs `check`, `lock`, `save`, `vectors` and `gen`. `copy(from, to)` loads `from`, checks that
`to` is empty (`E_STORE_NOT_EMPTY`), validates and checks the lock of `from`, and then calls `to.save` once with the definitions
and the lock of `from`, unchanged. Both functions return `{ findings }`; `vectors` and `gen` also return their output.

## Commands

| Command | Reads | Writes | Notes |
|---|---|---|---|
| `check` | the store | nothing | validates every definition, then compares the lock with the definitions |
| `lock [--rename machine.old=new]...` | the store | the definitions and the lock | derives the lock with the lock rules (`E_CODE_REUSED`, `E_CODE_KEY_CHANGED`, `E_CODE_CHANGED`); a vanished code moves to `reserved`; `--rename` keeps the code of the renamed state |
| `save` | `options.definitions` | the definitions and the lock | the core command of the GUI: the same rules as `lock`, one machine per save; there is no command-line form |
| `copy --to json\|mermaid --root <dir>` | the project store | the target store under `<dir>` | the target must be empty; the lock is copied unchanged |
| `vectors --out <file>` | the store | `{ machines: [{ machine, cases }] }` | stops on any finding of `check` |
| `gen --kind <kind> --out <dir>` | the store | the generated files of one kind | stops on any finding of `check`; the output directory is written as described in the root README |

The command line is `packages/compiler/src/cli/fsm-gen.mjs`. Its `--project <dir>` defaults to the current directory, and
the store is chosen by `<project>/fsm.config.json`: `json` or `mermaid`. Any other store is `E_STORE_NOT_CONFIGURED`.

Real runs of each command on the `order` example (the output of `[fsm-gen] <command>: ok` on standard output, exit 0):

```sh
$ fsm-gen check --project ./order-machines
[fsm-gen] check: ok
$ fsm-gen lock --project ./order-machines --rename order.draft=created
[fsm-gen] lock: ok
$ fsm-gen copy --to mermaid --root ./order-mermaid --project ./order-machines
[fsm-gen] copy: ok
$ fsm-gen vectors --project ./order-machines --out ./vectors
[fsm-gen] vectors: ok
$ fsm-gen gen --project ./order-machines --kind rust --out ./app/src
[fsm-gen] gen: ok
```

Exit codes: 0 for success, 1 for a finding (one line per finding on standard error, `[fsm-gen] <code> <machine> <path>: <message>`)
or for an unexpected rejection (printed with its stack), 2 for a usage error. An unknown command, an option that the command
does not take, a missing `--root`, `--to` or `--out`, and a value out of its form are all usage errors.

## Backend options

The options are the ones of `gen` and `vectors` (the command line refuses an option that the kind does not take).

| Option | Kinds | Rule | Why |
|---|---|---|---|
| `--kind <kind>` | `gen` | one of `go`, `npm`, `php`, `php-ext`, `python`, `rust` (`backends/index.mjs`) | selects the backend |
| `--go-module <module path>` | `gen --kind go` (required) | the module path of the package | a generated machine imports `<module>/src/fsm` for the shared `Error` and codes; the backend cannot read `go.mod`, so the module is given |
| `--php-namespace <ns>` | `php`, `php-ext` for `gen` (required) | letters and digits separated by single backslashes, such as `Acme\Fsm` | the namespace of the machine modules is `<ns>\<Pascal machine key>`, and the shared `<ns>\Fsm` holds `Error` and `Code` |
| `--php-ext-name <name>` | `gen --kind php-ext` (required) | lower-case letters, digits and underscores, starting with a letter, such as `acme_fsm` | the name of the extension, its `config.m4` and its header and arginfo files |

The php-ext backend's output is the one the PHPUnit files of the php package run against, with the extension loaded.

## Vectors

The vectors are the expected result of every operation of a machine, computed by the core from its definition and its lock
(`src/core/vectors.mjs`). No language computes an expectation; each language checks its own result against these cases.

- The features are fixed in `contracts/features.json` and in `FEATURES` of `vectors.mjs`: `initial`, `code`, `key`, `from_code`,
  `is_final`, `events_from`, `target`, `apply` and `persist`.
- The cases are: `initial`; per state `code`, `key`, `from_code`, `is_final` and `events_from`; the `from_code` errors (0, an
  unknown code, each reserved code); `target` for every (state, event); `apply` for every defined (expected, event) and for
  each undefined one; and the persistence cases `first`, `retry` and `conflict` for a machine that has a transition.
- A case id is `<machine>_<suffix>`, where every key in the suffix is replaced by its declaration index: a state is `s<i>`, an
  event `e<j>` (both 0-based) and a reserved code `r<code>`. So `order_apply_s0_e0_s0` is `apply` from the first state (`draft`)
  with the first event (`next`) when the stored state is also the first state. Ids cannot collide, whatever the names are.
- The case name is `<feature>__<id>`, the `name` of the case (php: the data set `<feature>__<id>` of the method `testConformance`; python: the method `test_<feature>__<id>`).
- The example `order` has 89 cases (in `contracts/conformance/vectors.json`, written by `fsm-gen vectors --out`). The counts by feature are
  `initial` 1, `code` 5, `key` 5, `from_code` 7, `is_final` 5, `events_from` 5, `target` 15, `apply` 43 and `persist` 3.

`fsm-gen vectors --out <file>` writes the common form, one file for every machine (`contracts/conformance/vectors.json` in this repository). Each
language package reads that file when its conformance test runs and decodes the inputs in its own way (docs/spec/fsm.md, B-6); the compiler writes
no test. The package runs one test per case, and kit's parity check (`make parity-check`) requires every case to run once and pass in every kind that admits it.

## Checks

`make compiler-test` runs the tests of this package through kit's test runner (`run-tests` of `@polyspec/kit`). The tests install the package offline
into a temporary npm prefix and run the `fsm-gen` command from there, so the installed command is the one that is tested.
A change of the rules in `src/core` is also checked by the vector cases of every language package.
