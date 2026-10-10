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
| S-09-2 | npm type check: a package test compiles a consumer file against the generated `.d.ts` with TypeScript in strict mode (pinned devDependency), so a wrong declaration fails a tool instead of a manual check | a wrong `.d.ts` RED → GREEN | [ ] |
| S-10 | go backend + `vectors --kind go` (golden) | golden RED → GREEN | [ ] |
| S-10-1 | go package: conformance + persist + `examples/model/`, the kind in `kinds`, its toolchain and dependency pins, `test-go` and `parity-go` | `test-go` RED without generated output → GREEN; `layout-check` and `parity-go` pass | [ ] |
| S-11 | python backend + `vectors --kind python` (golden) | golden RED → GREEN | [ ] |
| S-11-1 | python package: conformance + persist + `examples/model/`, the kind in `kinds`, its toolchain and dependency pins, `test-python` and `parity-python` | `test-python` RED without generated output → GREEN; `layout-check` and `parity-python` pass | [ ] |
| S-12 | php backend + `vectors --kind php` (golden) | golden RED → GREEN | [ ] |
| S-12-1 | php package: conformance + persist + `examples/model/`, the kind in `kinds`, its toolchain and dependency pins, `test-php` and `parity-php` | `test-php` RED without generated output → GREEN; `layout-check` and `parity-php` pass | [ ] |
| S-13 | rust backend + `vectors --kind rust` (golden) | golden RED → GREEN | [ ] |
| S-13-1 | rust package: conformance + persist + `examples/model/`, the kind in `kinds`, its toolchain and dependency pins, `test-rust` and `parity-rust` | `test-rust` RED without generated output → GREEN; `layout-check` and `parity-rust` pass | [ ] |
| S-14 | php-ext backend + `vectors --kind php-ext` (golden) | golden RED → GREEN | [ ] |
| S-14-1 | php-ext package: conformance + persist + `examples/model/`, the kind in `kinds`, its toolchain and dependency pins, `test-php-ext` and `parity-php-ext` | `test-php-ext` RED without generated output → GREEN; `layout-check` and `parity-php-ext` pass | [ ] |
| S-15 | status-db: `schema/status.dbs` + DbStore + contract tests + copy + `db-test` | contract mismatch, `E_STORE_NOT_EMPTY`, atomicity RED → GREEN | [o] |
| S-16 | GUI skeleton: hyper app + list and detail + Mermaid + `gui-test` + a test that parses the canonical form and every reserved state key of B-5 with the pinned mermaid package | handler RED → GREEN | [o] |
| S-17 | GUI editing: crudui forms + validation error display + rename | `check` passes after a save | [ ] |
