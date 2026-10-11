<!-- doc-id: execution-checklist -->
# Execution checklist

## status v1

| ID | Task | RED → GREEN | State |
|---|---|---|---|
| S-01 | git init, kit v0.0.14, config (toolchain: Node.js only; dependency policy with empty lists and its review record), hooks, AGENTS.md(.ko), this checklist, CHANGELOG, the plan, `CHECK_TARGETS` and `check` | `kit-check owner-validate documents-check commits-check toolchain-check hooks-check dependency-policy-check` pass | [o] |
| S-02 | `docs/spec/status.md(.ko)`: section B of the plan as the fixed definition | `documents-check` fails without the pair, passes with it | [o] |
| S-03 | `scripts/check-layout.mjs` + `contracts/layout.json` (tools, kinds = {}, an object of each kind with its required files and allowed globs) + `layout-test`/`layout-check` | fixtures (kinds mismatch/added/missing/renamed/php↔php-ext mismatch/malformed) RED → GREEN | [o] |
| S-04 | `scripts/check-parity.mjs` (with `--kind`) + `parity-test` | fixtures (no result/missing tool result/`--kind` reads only its kind/stale inputs/not run/unregistered/zero cases/fail/timeout/skip/0 or 2 name matches/parent id/over 10 minutes) RED → GREEN | [o] |
| S-05 | core `E_SCHEMA` + the schema correspondence test | RED → GREEN | [o] |
| S-05-1 | core graph errors | RED per error code → GREEN | [o] |
| S-05-2 | core name and code errors | RED per error code → GREEN | [o] |
| S-05-3 | core key length: machine, state and event keys are at most 64 characters (E_KEY_FORMAT), so the DB store's varchar(64) holds every valid key | 64 accepted, 65 RED → GREEN | [o] |
| S-06 | normalize/IR + lock (rename/reserved) + JsonStore + store contract + `run`/`copy` | RED per lock scenario → GREEN | [o] |
| S-06-1 | async store contract: load() and save() of every store and core run/copy return Promises, so the DB store can use the async orm client; validate, normalize, lock and vectors stay synchronous | the contract tests await a Promise from every store RED → GREEN | [o] |
| S-07 | `status.config.json` + `machines/order.status.json` + `status.lock.json` + `contracts/features.json` + vector oracle + `scripts/gen-check.mjs` + `gen-check-test` | matches the hand-written expected fixture; gen-check RED → GREEN | [o] |
| S-08 | MermaidStore (canonical parser and writer) + json↔mermaid round trip | `E_MERMAID_UNSUPPORTED`, order violation, round-trip mismatch RED → GREEN | [o] |
| S-09 | npm backend + `vectors --kind npm` (golden) | golden RED → GREEN | [o] |
| S-09-1 | npm package: conformance + persist + `examples/model/`, the kind in `kinds`, its toolchain and dependency pins, `test-npm` and `parity-npm` (creates the shared `schema/persist.dbs`) | `test-npm` RED without generated output → GREEN; `layout-check` and `parity-npm` pass | [o] |
| S-09-2 | npm type check: a package test compiles a consumer file against the generated `.d.ts` with TypeScript in strict mode (pinned devDependency), so a wrong declaration fails a tool instead of a manual check | a wrong `.d.ts` RED → GREEN | [o] |
| S-10 | go backend + `vectors --kind go` (golden) | golden RED → GREEN | [o] |
| S-10-1 | go package: conformance + persist + `examples/model/`, the kind in `kinds`, its toolchain and dependency pins, `test-go` and `parity-go` | `test-go` RED without generated output → GREEN; `layout-check` and `parity-go` pass | [o] |
| S-11 | python backend + `vectors --kind python` (golden) | golden RED → GREEN | [o] |
| S-11-1 | python package: conformance + persist + `examples/model/`, the kind in `kinds`, its toolchain and dependency pins, `test-python` and `parity-python` | `test-python` RED without generated output → GREEN; `layout-check` and `parity-python` pass | [o] |
| S-11-2 | python package: remove `PYTHON_COLORS=0` from packages/status-python/Makefile once kit K22 (run-tests python runs without color) is synced; removal condition: the kit release with K22 is adopted by `make kit-sync` | test-python passes with FORCE_COLOR set and no PYTHON_COLORS in the Makefile | [o] |
| S-11-3 | `make install-python` installs Python with uv `--no-bin`, so uv writes nothing into a user bin directory (`~/.local/bin` by default); only `var/tools/bin/python3` links to uv's managed interpreter | with `UV_PYTHON_BIN_DIR` set to a scratch directory, install-python writes `python3.14` there RED → GREEN; with `--no-bin` the directory stays empty and `~/.local/bin` is unchanged | [o] |
| S-12 | php backend + `vectors --kind php` (golden) | golden RED → GREEN | [o] |
| S-12-1 | php package: conformance + persist + `examples/model/`, the kind in `kinds`, its toolchain and dependency pins, `test-php` and `parity-php` | `test-php` RED without generated output → GREEN; `layout-check` and `parity-php` pass | [o] |
| S-13 | rust backend + `vectors --kind rust` (golden) | golden RED → GREEN | [o] |
| S-13-1 | rust package: conformance + persist + `examples/model/`, the kind in `kinds`, its toolchain and dependency pins, `test-rust` and `parity-rust` | `test-rust` RED without generated output → GREEN; `layout-check` and `parity-rust` pass | [o] |
| S-14 | php-ext backend + `vectors --kind php-ext` (golden) | golden RED → GREEN | [o] |
| S-14-1 | php-ext package: conformance + persist + `examples/model/`, the kind in `kinds`, its toolchain and dependency pins, `test-php-ext` and `parity-php-ext` | `test-php-ext` RED without generated output → GREEN; `layout-check` and `parity-php-ext` pass | [o] |
| S-14-2 | php-ext backend: the C output of the first build (object parameters as zval, the Error method table after its constructor, the format macro, the class-typed property and the persistent Code values), and the phpize ignore patterns that C-1 assigns to S-14 | the golden files are regenerated and the compiler tests pass; the package build is checked by S-14-1 | [o] |
| S-14-3 | gen and vectors --kind skip the git-ignored files of their output directory: an ignored build output (the phpize files of php-ext src/) is not hand-written, so it neither blocks the generator with E_NOT_GENERATED nor is removed; a tracked or untracked non-ignored file without the header still blocks it | gen after a php-ext build without make clean RED → GREEN, a hand-written file still E_NOT_GENERATED | [o] |
| S-15 | status-db: `schema/status.dbs` + DbStore + contract tests + copy + `db-test` | contract mismatch, `E_STORE_NOT_EMPTY`, atomicity RED → GREEN | [o] |
| S-15-1 | status-db install: a command that installs schema/status.dbs into the database of status.config.json through orm, and packages/status-db/README.md(.ko) with how to set up and use the DB store; without it a user cannot create the tables without writing code | status-db check on a new database fails with no table; status-db install then check passes RED → GREEN | [ ] |
| S-16 | GUI skeleton: hyper app + list and detail + Mermaid + `gui-test` + a test that parses the canonical form and every reserved state key of B-5 with the pinned mermaid package | handler RED → GREEN | [o] |
| S-16-1 | GUI test hang: one `make gui-test` run reported "the test did not finish" for a nested Mermaid subtest with an empty event loop and no reproduction in about 20 runs; find the cause and fix it at the cause, then remove the per-call deadline if it only hid the cause | a reproduction (or a proof of the cause) RED → GREEN | [o] |
| S-17 | GUI editing: crudui forms + validation error display + rename | `check` passes after a save | [o] |
| S-17-1 | GUI follow-up: a row added in the browser shows the code that core nextCode suggests (the page carries the next code), and a GUI test proves that deleting a state in the edit form moves its code to reserved | an added row without a code suggestion RED, a delete without a reserved code RED → GREEN | [o] |
