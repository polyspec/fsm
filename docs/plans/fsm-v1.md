<!-- doc-id: plan-fsm-v1 -->
# fsm v1 plan

[한국어](fsm-v1.ko.md)

## Context
- A state is stored as an integer code (key = value). Event transitions are **idempotent and deterministic**. The same rules apply to six targets: go, npm (js+d.ts), php, php-ext, python and rust.
- The output is generated files per language. There is no parsing at runtime, and the generated code has no runtime dependency.
- Definitions have three first-class stores: **JSON, Mermaid `stateDiagram-v2` and DB (orm)**. One compiler core owns the rules: validation, lock and generation.
- The model is kept simple enough that all three media hold it losslessly **with their official syntax only**. If a medium cannot hold part of the model, that is a sign the model is too complex.
- Tools: the GUI uses hyper (Node server), CRUD screens use crudui, and DB access uses orm.
- The repository started under its old name `status`; S-01 committed this plan with the kit adoption, and S-18 renamed the library, its packages, commands and files to fsm (R12). It adopts kit.
- The six language packages have identical folder structure. Only language-inherent differences are allowed, and they are declared in `contracts/layout.json`.
- The language packages are not published libraries. They are consumer-side test beds.
- Fixed decisions
  - Value model: enum only, no bit flags.
  - Transitions: an explicit graph.
  - Runtime: generated code only.
- Principle: standards are **enforced by tools**. Layout, feature↔test correspondence and parity between languages are judged by check tools that have RED tests.

## 0. Scope (the only basis for audits and implementation)

**Requirements R1–R12 (this list alone is the v1 scope)**

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
| R11 | Documentation: the root README and every package README (English and Korean) explain the library completely for its users, and a documentation site is published on GitHub Pages | user instruction |
| R12 | The library is named fsm: repository polyspec/fsm, and every package, command, file and generated module carries the name | user instruction |

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
    - compiler → `packages/fsm-compiler/tests`
    - DB store → `packages/fsm-db/tests`
    - GUI → `packages/fsm-gui/tests`
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
  - `name-check` (`scripts/check-name.mjs`, RED tests in `tests/check-name/`): no tracked file or path names the library by its old name `status`. Each occurrence is judged on its own: the spans that an allowed entry names are removed from its line, and the rest must hold no such word. The allowed entries are a state value of the consumer status column (its accessors and column words), an exit, HTTP or test result word of a process or request, the vendored kit, the CHANGELOG bullets up to the rename (S-01 to S-18) and the rename words of the plan and the rules; each entry is in `ALLOWED` with its reason and matches exact phrases only (R12).
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
  - A branch or worktree is named `{type}/{shortname}-{id}` / `fsm-{shortname}-{id}` and is deleted right after merge.
  - Experimental code is removed before commit. If it cannot be removed at once, a sub-item records the removal condition.

## B. State machine definition (fixed in `docs/spec/fsm.md`)

The definition (B-0 to B-6) is fixed in [docs/spec/fsm.md](../spec/fsm.md) (S-02); that document is the only source of the definition.

## C. Structure and enforcement tools

### C-1. Repository
```
fsm/
  AGENTS.md(.ko) README.md(.ko) CHANGELOG.md(.ko) Makefile kit.json .kit/ .node-version rust-toolchain.toml .githooks/
  .gitignore            # anchored only: /var/, /.results/, /packages/*/node_modules/, /packages/*/vendor/, /packages/*/target/, /packages/fsm-python/**/__pycache__/, php-ext phpize output under /packages/fsm-php-ext/src/ (exact patterns fixed in S-14; config.m4 and generated sources stay unignored), /packages/fsm-gui/build/, /packages/fsm-gui/public/assets/, /packages/fsm-php*/.phpunit.result.cache, /packages/fsm-php*/.phpunit.cache/
  config/{checklist,documents,owner-checks,commits,toolchain,dependency-policy,dependency-review}.json
  scripts/kit/ tests/kit/                    # vendored from kit
  scripts/check-layout.mjs scripts/check-parity.mjs scripts/check-name.mjs scripts/gen-check.mjs scripts/check-python-lock.mjs   tests/check-layout/ tests/check-name/ tests/check-parity/ tests/docs-build/ tests/gen-check/ tests/python-tools/ tests/check-python-lock/
  contracts/layout.json (tools, kinds, canonical tree, allowed differences)   contracts/features.json
  docs/spec/fsm.md(.ko)  docs/plans/execution-checklist.md(.ko)  docs/plans/fsm-v1.md(.ko)
  docs/package.json docs/package-lock.json docs/.vitepress/config.mts   # the documentation site (C-8)
  schema/fsm.schema.json  schema/fsm.dbs  schema/persist.dbs   # persist.dbs = shared by the six language package examples
  fsm.config.json  machines/order.fsm.json  fsm.lock.json  conformance/vectors/<machine>.json
  packages/fsm-compiler/  {src/core/, src/backends/, src/store-json/, src/store-lock/, src/store-mermaid/, src/cli/, tests/}  # imports only the set of C-5 (no npm package)
  packages/fsm-db/        {src/, tests/}   # DbStore + fsm-db CLI, depends on orm
  packages/fsm-gui/       {app/app.json, templates/, client/main.ts, public/assets/, build/, src/, crud/*.yml, tests/}
  packages/fsm-{go,npm,php,php-ext,python,rust}/
```
- External dependencies are pinned to release tags: orm v0.0.7, ordered-json v0.0.7, hyper v0.0.11, template v0.0.5, crudui v0.0.5, mermaid (exact npm version).
  - npm: the release asset URL in `dependencies`; transitive `@polyspec/*` with the same URLs in `overrides`
  - composer: the dist zip of a `package` repository, `config.platform.php` 8.4.x
  - go: `require github.com/polyspec/orm v0.0.7`
  - python: `polyspec-orm @ git+https://github.com/polyspec/orm@v0.0.7#subdirectory=packages/orm-python`
  - cargo: `{ git = "https://github.com/polyspec/orm.git", tag = "v0.0.7" }`
  - `.node-version` holds an exact 26.y.z release (required by hyper; kit toolchain-declared.mjs accepts only `<major>.<minor>.<patch>`).
- The pins live in the manifests and lock files and are listed in `config/dependency-policy.json`. The kit gate does not check npm URLs, the Composer `package` dist URL, python `git+…@tag` or cargo tags; pin verification is a review rule (no R requires a tool for it), except the python lock, which `make python-lock-check` checks (the decision below).
  - Decision (python lock, S-34): the python tree is locked by `packages/fsm-python/uv.lock` (`uv lock`, version 1): every registry package with its exact version and the sha256 of each artifact, every git package at the commit of its tag (orm and ordered-json at `v0.0.7`). `make -C packages/fsm-python install` exports `pylock.toml` from it (`uv export --format pylock.toml --frozen --no-emit-project`, PEP 751) and installs that file with `uv pip install --link-mode copy` into a venv made by the install-tools Python with `--copies --without-pip` (S-41: uv venv and uv sync write symbolic links, which the kit runner refuses), so uv checks each artifact against its hash (measured: a tampered wheel hash is refused with `Hash mismatch for pyyaml==6.0.3`). The form is uv.lock and not a requirements file with hashes, because `pip install --require-hashes` refuses a git requirement (measured with pip 26.2.1: `Can't verify hashes for these requirements because we don't have a way to hash version control repositories`), so the git packages would need a second install step. The kit gate reads only the build-system and optional requirements of a Python manifest (`pythonManifests`) and no Python lock, so it passes an unpinned runtime dependency (measured: a copy of the tracked files with `requests>=2` added to pyproject.toml and no lock passes `check-dependency-policy.mjs`). `scripts/check-python-lock.mjs` (`make python-lock-check`) checks the lock by the rules pin, commit, tag, current, closure and export: `pylock.toml` (S-34-2, the PEP 751 file that the kit gate reads through the required policy field `pythonLocks`, kit K36) has the body of a fresh `uv export --format pylock.toml --frozen --no-emit-project` of uv.lock. The kit review record (`config/dependency-review.json`) then covers every transitive python package of pylock.toml: its latest release and advisories (23 registry dependencies at review; S-34-1), and its git packages (`vcs`: polyspec-orm and polyspec-ordered-json at `v0.0.7`, by commit). Decision (S-34-1, S-34-2): the python lock is the one kit format, and the kit gate covers it. The build backend `setuptools==84.0.0` is pinned by version in pyproject.toml and built in an isolated environment, which uv does not hash.

### C-2. Canonical structure of a language package (identical for all six)
```
packages/fsm-<kind>/
  README.md README.ko.md
  Makefile          # gen (gen + vectors --kind; flags only here; DEST ?= .)
                    # test (run-tests --cwd packages/fsm-<kind> --results .results/<kind>.json; paths resolve against the checkout root)
  <manifest>        # [allowed difference] depends on orm (SQLite) for tests and examples
  <lock>            # [allowed difference] go.sum, package-lock.json, composer.lock, Cargo.lock (read by the kit dependency gate); python has `uv.lock` (S-34; `python-lock-check` reads it) and `pylock.toml`, its export that `uv pip install` reads (S-41; S-34-2 commits it)
  src/…             # fsm-gen output only
  tests/conformance.<ext>   # hand-written check functions; except in rust, iterates the vectors and registers one test per case
  tests/vectors.<ext>       # fsm-gen output (language-native data); in rust, one #[test] per case
  examples/persist.<ext>    # B-4 orm persistence; tests run it with the persist vectors
  examples/model/           # orm-generated model from the root schema/persist.dbs (committed, covered by gen-check); rust uses build.rs as an allowed difference
```
- `make gen` produces the fsm-gen output and the orm-gen output together; the `generated` globs of the kind in `contracts/layout.json` name the files it writes, and `gen-check` compares exactly those files.

| kind | manifest | src | tests |
|---|---|---|---|
| go | go.mod | `src/order/order.go`, `src/fsm/fsm.go` (in Go a package is a directory) | `conformance_test.go` (generic: it runs each case through the adapter of its machine), `vectors_test.go` (generated: the vector cases, the key tables of every machine and one adapter per machine, which implements the interface of `conformance_test.go`; its only imports are the machine packages `<module>/src/<machine>`, so `vectors --kind go` takes `--go-module`; the persist example belongs to the test bed and is not imported, because `decide` returns the func type that `examples.Decide` names (S-26-1-1)) |
| npm | package.json | `order.js/.d.ts`, `fsm.js/.d.ts`, `index.js/.d.ts` (`export * as order`) | `conformance.test.mjs`, `vectors.mjs` |
| php | composer.json | `Order/{State,Event,Step}.php`, `Order/functions.php`, `Fsm/Code.php` (error code enum, its own file for PSR-4), `Fsm/Error.php`, and the loader `functions.php` (requires every machine's `Order/functions.php`; composer `autoload.files` names only this file, because PSR-4 cannot load functions) | `ConformanceTest.php`, `Vectors.php` |
| php-ext | composer.json (`type: php-ext`, `extension-name`, `build-path: src`) | `config.m4`, `order.c`, `fsm.c` (shared `<ns>\Fsm\Error` and error code constants), `php_<ext>.h`, `<ext>.stub.php`, `<ext>_arginfo.h` | tests **byte-identical** to php; `make test` builds with phpize, then runs with `--php-extension <.so>`; gen requires `--php-namespace` and `--php-ext-name` |
| python | pyproject.toml | `polyspec_fsm/{__init__,order,fsm}.py` | `test_conformance.py` (generates methods named exactly after the cases), `vectors.py` |
| rust | Cargo.toml (`autotests=false`, `autoexamples=false`, `[[test]] conformance`, build-dep `polyspec-orm-build`, dev-dep `tokio`) + `build.rs` | `lib.rs` (`pub mod order; pub mod fsm;`), `order.rs`, `fsm.rs` | `conformance.rs` (`mod vectors;`, `#[path="../examples/persist.rs"] mod persist;`); persist cases are `#[tokio::test]`; generated `tests/vectors.rs` starts with `#![allow(non_snake_case)]` |

- check-layout fails when:
  - the set of `packages/fsm-*` directories, excluding the tool packages `fsm-compiler`, `fsm-db` and `fsm-gui` that `layout.json` lists under `tools`, differs from `kinds`
  - tracked files or non-ignored new files deviate from the canonical tree (added, missing, renamed)
  - the php and php-ext tests are not byte-identical
  - layout.json is malformed
  - a test file that a kind allows (a `tests/` glob beyond its required set) has no entry in `differences` of layout.json with its reason, or a declared difference names no allowed glob of its kind
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
- a vector case did not run in some kind that its `kinds` admits (a case without `kinds` is admitted by every kind), or a kind ran a case that its `kinds` excludes
- a result holds a case that is not in the vectors
- a feature in features.json has zero vector cases
- a case has any status other than `pass` (`fail`, `timeout` and `skip` all fail)
- a result id yields two or more distinct case names, or yields none and is not the parent of a matched id (an id that a matched id extends with ` › `, such as the Go test function that runs the cases as subtests)
- without `--kind`: the record `.results/<target>.json` of a tool test named by `--tools` (`TOOL_TESTS` of the Makefile: layout-test, parity-test, gen-check-test, compiler-test, db-test, gui-test as their items add them) is missing, stale or holds a case that is not `pass`
- `elapsedMs > 600000` in any `.results/*.json` (with `--kind`: only that kind's result)

Case name extraction: `/\btest_[a-z][a-z0-9]*(?:_[a-z0-9]+)*__[a-z][a-z0-9]*(?:_[a-z0-9]+)*\b/` is applied to each result id. An id with exactly one distinct match is that case; an id with zero or with two or more distinct matches is judged by the result-id bullet above. There are no per-tool rules.

`contracts/features.json` = `{schema: 1, features: [initial, code, key, from_code, is_final, events_from, target, apply, persist]}`. A vector file is `conformance/vectors/<machine>.json` = `{machine, cases: [{feature, id, …}]}`; the case name is `test_<feature>__<id>`.

Conformance machines (`machines/`, S-25): every kind runs the vectors of every machine in `machines/`, so the definition's shapes are covered by all six kinds: `order` (the example); `standby` (no events: one state, which is initial and final); `in_review` (underscore keys in the machine, state and event keys); `ticket` (reserved codes 2 and 4, which are states removed after a first lock; the lock keeps them as reserved); `limits` (the code 2147483647). Each kind passes 209 cases (`vector-parity-check`).

Vectors (exhaustive; the core generates the oracle):
- `initial`
- per state: the `code`/`key`/`from_code` round trip, `is_final`, `events_from`
- `target` for every (state, event)
- for each defined (expected, event)
  - actual = expected → `Changed`
  - actual = to → `Unchanged`
  - every other defined state → `E_CONFLICT`
- undefined (state, event) → `E_INVALID_TRANSITION`
- `from_code`: 0, an unknown code, each reserved code, a negative code, 2^31 and the 64-bit maximum (each E_UNKNOWN_CODE, except the reserved code)
- invalid state values (S-26): 0 and the unknown code for `code`, `is_final`, `key` and `apply` (expected or actual), in the kinds of the table below
- `persist`: first attempt / retry / conflict
- every error case names the four fields of fsm.Error (`code`, `expected`, `actual`, `event`, docs/spec/fsm.md, B-6); a field that does not apply is null: E_CONFLICT has the state codes of expected and actual and the event position, E_INVALID_TRANSITION the code of expected and the event position, E_UNKNOWN_CODE and E_RESERVED_CODE none
- an input of `from_code` is a decimal string, so the 64-bit range is exact in the file; the npm kind receives the nearest number, which is an unsafe integer and therefore E_UNKNOWN_CODE
- Case ids: a case id is `<machine>_<suffix>`, and every key in the suffix is replaced by its declaration index, so that
  no two ids can collide, whatever the names are. A state is `s<i>`, an event `e<j>` (both 0-based) and a reserved code
  `r<code>`. The ids are `<m>_initial`; `<m>_code_s<i>`, `<m>_key_s<i>`, `<m>_from_code_s<i>`, `<m>_is_final_s<i>`,
  `<m>_events_from_s<i>`; `<m>_from_code_zero`, `<m>_from_code_unknown`, `<m>_from_code_r<code>`, `<m>_from_code_negative`,
  `<m>_from_code_int32_overflow`, `<m>_from_code_int64_max`; `<m>_code_v<value>`, `<m>_is_final_v<value>`, `<m>_key_v<value>`,
  `<m>_apply_expected_v<value>_e0_s0`, `<m>_apply_actual_v<value>_e0_s0` (value is 0 and the unknown code); `<m>_target_s<i>_e<j>`;
  `<m>_apply_s<i>_e<j>_s<k>` (expected, event, actual); `<m>_persist_first`, `<m>_persist_retry`, `<m>_persist_conflict`.
  The case data fields keep the keys (state, event, expected, actual, ...); only the ids use indexes.
- Persist cases exist only when the machine has a transition. `conflict` exists only when a third state exists, so a
  two-state machine has `first` and `retry`, and a machine without a transition (such as a one-state machine) has no
  persist case.
- Invalid state values (S-26): whether a state argument can hold a value that is no state depends on the state type of the kind.
  A case with an invalid value names the kinds that admit it in `kinds`, and check-parity requires it of those kinds only. The
  decision per kind, recorded here for the spec B-6 rule that the functions fail with E_UNKNOWN_CODE:

  | kind | state type | invalid state value |
  |---|---|---|
  | go | `State int32` | admitted: the default branch of the switch is E_UNKNOWN_CODE |
  | npm | a number; the state is its value | admitted |
  | python | an int (the members of `IntEnum`; the functions take any int) | admitted |
  | rust | `enum State` with `#[repr(i32)]` | not admitted: the type has no value that is no state |
  | php, php-ext | `enum State: int` | not admitted: the type has no value that is no state |

- The native vector modules of rust, php and php-ext hold the cases that their kinds admit (core `forKind`), so they run 224 of
  the 270 cases of the five machines; go, npm and python run all 270.

- Concurrency of the persistence pattern (S-37, decision): the concurrency proof is written once, in npm (`packages/fsm-npm/tests/persist-dialects.test.mjs`, records `npm-persist-test`, `npm-persist-test-postgres`, `npm-persist-test-mysql`, all in `TOOL_TESTS`). Reason: the npm client opens two real connections to one database, so two transactions of one row run at the same time on PostgreSQL and MySQL, and the lock that B-4 relies on is the database's own. The other kinds do not repeat the concurrency test. Their persist cases run on PostgreSQL and MySQL through `make <kind>-persist-test-postgres` and `make <kind>-persist-test-mysql` (S-37-1, records in `TOOL_TESTS`): `FSM_TEST_DIALECT` selects the dialect, `FSM_TEST_PG_DSN` and `FSM_TEST_MYSQL_DSN` name the database, each case clears the persist table, and the cases of a server dialect run one after another (rust takes a static lock; the other kinds run sequentially). Each target stops with exit 2 when its DSN is empty (`require_dsn` in the Makefile), and the test fails too. RED per kind: before the test read `FSM_TEST_DIALECT`, the target passed with 11 persist cases on SQLite under the PostgreSQL target (rust, php, php-ext, python); go failed with `driver "postgres" is not registered` until its example imported `orm/pg`. On SQLite the two transitions run one after the other, because the SQLite driver is synchronous: a second `BEGIN IMMEDIATE` in the same process blocks the thread that would commit the first, and fails with `CANCELED: sqlite: database is locked` after the 5000 ms busy timeout. RED: with `forUpdate()` removed from `examples/persist.mjs`, both transitions report Changed on PostgreSQL 17.11 and on MySQL 8.4.11, and both tests fail; the restored pattern passes on the three dialects.

- Name (S-35-2, decision): the target that checks the vector records is `vector-parity-check` (scripts/check-parity.mjs). Kit v0.0.23 defines its own `parity-check` (kit K33, the language-parity checker of config/parity.json), so that name belongs to kit. S-35-2 renamed the fsm target, but `CHECK_TARGETS` kept the name `parity-check`, so `make check` ran kit's target and not this check; S-42 fixed the list.
- Kit K33 against this check (S-42, decision: one tool, `vector-parity-check`; kit's `parity-check` is in no target of this repository and nothing runs it). Kit's checker runs each binding itself and reads no result record, so it cannot state the rules that concern records and vector data. The rules that kit K33 does not cover:
  - a `.results/<kind>.json` that is missing, stale (inputs digest) or covers another package, and a record over 600000 ms: kit has no record and no time limit (its `execute` is a `spawnSync` without timeout, and its bindings do not run through `run-tests.mjs`).
  - a case that ran twice in one run: kit keeps one outcome per case name, so a second line for a case is not seen.
  - `kinds`: a case that a kind admits and did not run, a case that a kind ran although its `kinds` excludes it, and an empty or unknown `kinds` list. A kit suite unit has no per-case admission; the only way to express it is one vector file per admission, which changes the generated vectors.
  - features: a feature with no case, a case of a feature that `contracts/features.json` does not list, and the case id form with its machine prefix. Kit reads no features file and no vector id rule.
  - the owner checks `parity-<kind>` (plan D) and the tool records of `TOOL_TESTS`: kit's check is whole-repository and has no tool test.
  - a case id that names two cases, or names none and is no parent: kit reads only the harness lines `PASS|FAIL <unit>/<case>` and has no rule for another line.
  - the `timeout` outcome of a case: a binding has no time limit in kit, so a hung binding is not a finding.
  Adoption would also change every package: the harness of each language (node, php, python, cargo) would print `PASS <unit>/<case>`, Go would run each case as the subtest `<symbol>/<case>`, and each binding runs twice (R3), so the test time of each kind doubles. The kit items that would make adoption possible are proposed in the S-42 report, not in this plan.

### C-5. compiler `packages/fsm-compiler`
- Imports (S-32): `packages/fsm-compiler/src` imports only (1) node built-ins, by their `node:` specifier; (2) its own files, by a relative path that stays in `src`; (3) the vendored kit of this clone, `scripts/kit/` (a relative path, never a copy). No npm package, no bare built-in name and no dynamic `import()` or `require()`. `src/core` imports no `node:` module at all. `packages/fsm-compiler/tests/imports.test.mjs` scans every import specifier of `src` and fails on anything else.
- Parts
  - `src/core`: object → validate → normalize → backends, plus `run` and `copy`. It has zero `node:` imports, and the GUI imports it as is.
  - `src/backends/<kind>.mjs`
  - `src/store-json`, `src/store-mermaid`
  - `src/cli` (`fsm-gen`)
- The command `fsm-gen` is the `bin` of `packages/fsm-compiler/package.json` (a manifest without dependencies). From a clone, `npm install -g ./packages/fsm-compiler` links it onto the PATH; `tests/command.test.mjs` installs the package offline into a temporary npm prefix and runs the command (S-18-1).
- Commands
  - `lock [--rename]`
  - `gen --kind <k> --out <dir>` (php requires `--php-namespace`; php-ext requires `--php-namespace` and `--php-ext-name`; go requires `--go-module <module path>`, because a generated machine imports the shared package `<module>/src/fsm` and the backend cannot read go.mod)
  - `vectors [--kind <k>] --out <path>` (go: `--go-module <module path>`, as for gen; the file imports only `<module>/src/<machine>`, S-26-1-1)
  - `check`: validates every definition and the lock match, and the lock keeps every committed code (B-3)
  - `copy --to json|mermaid --root <dir>`
- Root `gen-check`
  1. Run `fsm-gen vectors --out var/gen-check/conformance/vectors`.
  2. In each package of `kinds`, run `make gen DEST=$(CURDIR)/var/gen-check/<kind>`.
  3. `scripts/gen-check.mjs` compares with the working tree through kit `trackedFiles` (tracked and non-ignored files only, so ignored outputs such as `__pycache__/` and the phpize output in php-ext `src/` are not read). `conformance/vectors` and each package's `src/`, `tests/vectors.<ext>` and `examples/model/` (except rust) must hold the same file set with byte-identical content; the compared files of each package are the ones matched by its kind's `generated` globs in `contracts/layout.json`, and a kind without them is a `layout-config` finding.
  - `gen-check-test` (`tests/gen-check/`) RED: a one-byte change fixture, an added file fixture, an ignored file that must not be read

### C-6. fsm-db `packages/fsm-db`
- The command `fsm-db` is the `bin` of `packages/fsm-db/package.json`. After `make db-deps`, `npm install -g ./packages/fsm-db` links it onto the PATH; `tests/command.test.mjs` installs it offline into a temporary npm prefix, installs the schema into a new SQLite database and checks it (S-18-1).
- `schema/fsm.dbs` → orm-generated model (npm).
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
- The `fsm-db` CLI runs core `run` and `copy` with DbStore and the json/mermaid stores. `install` installs `schema/fsm.dbs` through orm `utils().schema().install` (S-15-1). The commands and their behaviour are in `docs/spec/fsm.md` (B-2) and `packages/fsm-db/README.md`.
- Tests (SQLite)
  - store contract (round trip and byte-identical results)
  - `E_STORE_NOT_EMPTY`
  - CLI run as processes: `install` on a new database (`check` fails before it with no table and passes after it), a second `install`, a partial `install` rejected by orm, and the usage of `install`
  - transaction atomicity RED
  - dialect differences are orm's own conformance responsibility
- Tests (S-37): `make db-test` runs every test of the package on SQLite. `make db-test-postgres` and `make db-test-mysql` run `tests/db-store.test.mjs`, `tests/store-contract-all.test.mjs`, `tests/cli.test.mjs` and `tests/command.test.mjs` on PostgreSQL and MySQL. Both files open the database through `tests/dialect.mjs`: `FSM_TEST_DIALECT` names the dialect (`sqlite` by default, `postgres` or `mysql`), `FSM_TEST_PG_DSN` and `FSM_TEST_MYSQL_DSN` name the database, and a missing DSN throws, so the target fails and no case is skipped; the target itself stops first with exit 2 (`require_dsn` in the Makefile). Each file installs the schema (install changes nothing on a database that holds it) and clears the six tables before a case, so a case reads only what it wrote; the files run with `--test-concurrency=1`, because they share the server. The CLI and command tests take an empty database of their own (the next bullet).
- Empty databases (S-37-2, decision): the CLI and command tests need a database with no fsm table, and a shared server has none. Each case takes its own empty database. On SQLite it is a new file of the case's temporary directory. On PostgreSQL and MySQL, `createEmptyDatabase` (`packages/fsm-db/tests/dialect.mjs`) creates a database named `fsm_test_<pid>_<time>_<random>` through the admin DSN (`FSM_TEST_PG_ADMIN_DSN` or `FSM_TEST_MYSQL_ADMIN_DSN`; locally `postgres://fsm@127.0.0.1:55432/fsm_test?sslmode=disable` and `mysql://root@127.0.0.1:33306/mysql`). PostgreSQL makes the user of `FSM_TEST_PG_DSN` the owner of the new database; MySQL grants every privilege on it to each account of the user of `FSM_TEST_MYSQL_DSN`, which it finds in `mysql.user`. The case connects with the DSN of its dialect and the new database in its path, so the server and the user stay those of the variable. The `after` hook of the file drops every database that it created (`DROP DATABASE ... WITH (FORCE)` on PostgreSQL). A statement that orm does not give (`DROP TABLE` of a partial schema) runs through the driver of the dialect (`runStatement`), with the devDependencies `pg` 8.23.1 and `mysql2` 3.24.5 of fsm-db, the versions that orm v0.0.7 resolves. Considered and not taken: one database per file (the cases change the tables, so each needs an empty one); dropping the six tables before each case (the install case needs no table, and orm has no drop); one schema per case (MySQL has no schema below a database). The missing-table check names the quoted table `machine` in each message, because the PostgreSQL server of the tests writes its messages in Korean.
- Local servers (S-37, the runs of this item): PostgreSQL 17.11 (`initdb`, `pg_ctl`, data directory and socket directory of the run) and MySQL 8.4.11 (`mysqld --initialize-insecure`, `--daemonize`), each on its own port (55432 and 33306), with the database `fsm_test` and the user `fsm`. The DSNs were `postgres://fsm@127.0.0.1:55432/fsm_test?sslmode=disable` and `mysql://fsm:fsm@127.0.0.1:33306/fsm_test`. The servers were stopped and their data directories removed after the runs.
- CI services for S-21 (the lines to copy into the job that runs `make install` and `make check`; the images are the versions above):
```yaml
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: fsm
          POSTGRES_PASSWORD: fsm
          POSTGRES_DB: fsm_test
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U fsm -d fsm_test"
          --health-interval 5s --health-timeout 5s --health-retries 10
      mysql:
        image: mysql:8.4
        env:
          MYSQL_ROOT_PASSWORD: root
          MYSQL_USER: fsm
          MYSQL_PASSWORD: fsm
          MYSQL_DATABASE: fsm_test
        ports: ['3306:3306']
        options: >-
          --health-cmd "mysqladmin ping -h 127.0.0.1 -uroot -proot"
          --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      FSM_TEST_PG_DSN: postgres://fsm:fsm@127.0.0.1:5432/fsm_test?sslmode=disable
      FSM_TEST_MYSQL_DSN: mysql://fsm:fsm@127.0.0.1:3306/fsm_test
      FSM_TEST_PG_ADMIN_DSN: postgres://fsm:fsm@127.0.0.1:5432/fsm_test?sslmode=disable
      FSM_TEST_MYSQL_ADMIN_DSN: mysql://root:root@127.0.0.1:3306/mysql
```
- The concurrency and persist tests of npm (`make npm-persist-test`, `-postgres`, `-mysql`) read the same variables; their decision is recorded in C-4.

### C-7. GUI `packages/fsm-gui` (hyper Node server + crudui + mermaid)
- The GUI is a single-editor tool. save replaces everything; the last write wins.
- Build: `hyper-build-assets --app . --api /api --output build` (hyper v0.0.11 requires `--app`, `--api` and `--output`) produces `templates.index.json`, `manifest.json` and the `public/assets` bundle (run before gui-test).
- Run: `fsm-gui [--project <dir>] [--port <n>]`, the `bin` of `packages/fsm-gui/package.json`. After `make gui-build`, `npm install -g ./packages/fsm-gui` links it onto the PATH; `tests/command.test.mjs` installs it offline into a temporary npm prefix and requests the machine list from it (S-18-1).
  - The store follows `fsm.config.json`.
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
  - `client/main.ts` binds the edit form with crudui `connectForm(crudui-form, instance)` and subscribes to the instance (S-22-1). Every change of the instance runs `patchContent(host, renderForm(instance, render))` and then `connection.sync()`, the contract of form-runtime.md. `host` is the `#fsm-form` element that wraps the server's form. `render` is the page's crudui render options (`editRenderOptions`: the action, the hidden `_csrf` and the errors of the page), embedded in the page state, so the re-rendered markup equals the server markup for the same data. Before S-22-1 a click on a row's add or remove button changed the instance but not the page, because nothing re-rendered it; the browser test found it.
  - A row added in the browser takes the next code (`client/main.ts` writes the codes into the DOM after each re-render), and a remove takes the row out of the instance.
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
  - Browser test (S-22-1, `make gui-browser-test`): `tests/browser/browser.test.mjs` drives the edit form in a headless Chromium of the pinned Playwright package (`playwright` 1.64.0, an exact devDependency of `packages/fsm-gui`; `make gui-browsers` downloads the browser, so it is ONLINE). The browser is the stamp `var/deps/playwright-<version>` (keyed on the version in `packages/fsm-gui/package-lock.json`, S-29-1): the first run downloads it, a later run with the stamp present downloads nothing. `gui-browsers` is a phony alias of that stamp for the command line, so the file target is the one the browser test needs; the alias is a deviation from the S-29-1 wording, chosen so that `make gui-browsers` keeps working. It runs `node src/main.mjs --project <temp> --port 0` on a temporary project holding the repository's `machines/order.fsm.json` and `fsm.lock.json` and `{"store":"json"}`, and checks in order: add on the last state row adds a row with the suggested code 6; a final state `refunded` with the cancel edge shipped to refunded is saved to the machine and the lock, and the show page lists it with its Mermaid svg; remove of that row and its edge, then Save, removes the state and reserves code 6; the next added row suggests 7. The first run, before the fix, failed at the first assertion (`5 !== 6`: the click left the rows unchanged).
  - `gui-test` runs the top-level `tests/*.test.mjs` files only (`$(wildcard ...)`): `node --test` on a directory also runs the nested files, so the browser test in `tests/browser/` would otherwise need a browser in `gui-test`.
  - Readiness (S-22-3): the browser test waits for the form's own readiness, not for `networkidle`. `client/main.ts` sets `data-fsm-connected="true"` on the form host `#fsm-form` after `connectForm` and the subscription are in place, and removes it when the connection is dropped (before a rebind). `openEdit` and `connected()` in the test wait for `#fsm-form[data-fsm-connected="true"]`. The layout's CSS (`#fsm-form:not([data-fsm-connected]) button[data-crudui-action] { pointer-events: none }`) keeps the row buttons from taking a click until the marker is set.
  - The first-run failure (S-22-3), cause: the first navigation of a newly downloaded Chromium is slow, not a click before the bind. Measured on four fresh downloads (`PLAYWRIGHT_BROWSERS_PATH` set to an empty directory, then `playwright install chromium`): the first case took 4.7 s, 12.4 s (failed at the 5 s limit), 2.7 s and 2.5 s, every later case at most 1.3 s. The client cannot be bound late: the bundle is a `type="module"` script in the head, which runs before `DOMContentLoaded` and delays `load`, and 30 cold trials of a click right after `load` (with CPU throttles and latencies) all added the row. So the setup of the browser test opens the edit page once with a 60 s limit, which loads the whole bundle, and every case keeps its 5 s limit. The marker `data-fsm-connected` stays as the explicit readiness signal that the cases wait for, instead of network idleness.
  - Decision (row buttons before connection): the buttons take no pointer click until the marker is set (CSS above). The window exists in principle, because the form is painted before the module runs on a slow network. Keyboard activation of a focused button before the connection is not blocked by this rule (a known gap; the form does nothing then, as before).
  - Decisions: the browser test uses the Playwright release that the dependency review of 2026-10-11 names as latest (1.64.0, recorded with `make dependency-review UPDATE=1 RECORD=1`).
  - Forms and icon (S-22-2): the crudui stylesheet is part of the bundle. `make gui-build` copies `@polyspec/crudui-generator-core/styles/crudui.css` to `public/assets/crudui.css` and passes it to `hyper-build-assets --static`, which puts a stylesheet of the layouts into the static deployment; the layout links `/assets/crudui.css`. The build could not take the stylesheet as an import of `client/main.ts`: esbuild would write a second output, and the build refuses any output that is not a `hyper-chunk-*` file (`the client build wrote N entry files`). The icon is `public/favicon.ico`, an ICO file, because browsers request `/favicon.ico` and the hyper server answers only files of `public/` (by extension: `.ico` is `application/octet-stream`); no route answers with raw bytes. `scripts/make-favicon.mjs` writes it. The stored key of a row is labeled `Key` and the new key of a new state is labeled `New key`, the label of the rename form's new key. The browser test checks each `button[data-crudui-action]` for its crudui size (28px), its icon mask on `::before` and an accessible name, the distinct labels of each row, and the ICO answer of `/favicon.ico`.

### C-8. Documentation site (`docs/.vitepress`, `make docs-build`)
- Build: `make docs-build` runs `docs-deps` (`npm ci --no-audit --no-fund` from `docs/package-lock.json`), then VitePress builds the site into `docs/.vitepress/dist`. `docs/node_modules`, `docs/.vitepress/dist` and `docs/.vitepress/cache` are git-ignored.
- Install scripts (S-20-2): npm 11 warned `npm warn install-scripts` for two install scripts that `docs/package.json` did not decide (its `allowScripts` field), so a fresh install printed a warning on every `make docs-deps`. Traced: (1) `esbuild@0.25.12` (postinstall `node install.js`) replaces the command shim `bin/esbuild` with the platform binary and checks its version. The JS API that vite uses does not need that replacement: esbuild's `lib/main.js` (`generateBinPath`) resolves `@esbuild/<platform>/bin/esbuild` itself. The script is approved for the pinned version (`"esbuild@0.25.12": true`), which keeps the installed state as it was. In the unconfigured install the postinstall still ran (the shim was replaced), so the warning did not mean a skip in npm 11.19; the decision does not depend on it. (2) `fsevents@2.3.3` (macOS only, an optional dependency of vite's watcher, chokidar) ships its prebuilt `fsevents.node` (163,626 bytes, the same size with the scripts skipped), and `require('fsevents')` loads after `npm ci --ignore-scripts`. The site runs no watcher, so the script is denied (`"fsevents": false`). The test `the docs install prints no npm warning` (tests/docs-build) runs a fresh `npm ci` of the lock and fails on any warning line; it failed on these two lines before the decision.
- Versions: `docs/package.json` pins `vitepress` 1.6.4 exactly (the release of the template repository). It also overrides `vite` to 6.4.4, because vitepress 1.6.4 requires `vite ^5.4.14`, and the 5.4.x line has moderate and high advisories with no fixed release (`npm audit` of the first lock). 6.4.4 has none, and pulls esbuild 0.25.x. `make dependency-review RECORD=1` records the lock with no advisory. The site runs no dev server; the override is accepted because `make docs-build-test` passes with it.
- Source: the documents are read in place, with no copy and no generated Markdown. The VitePress srcDir is the repository root. The include list is: `README.md` and `README.ko.md`; `packages/*/README.md` and `packages/*/README.ko.md`; `docs/spec/**`; `docs/plans/fsm-v1.md` and `docs/plans/fsm-v1.ko.md`; `docs/verification/**`; `CHANGELOG.md` and `CHANGELOG.ko.md`. Every other Markdown file is in srcExclude, computed from a walk of the repository at build time, and so are `node_modules`, `.git`, `var`, `vendor`, `target`, `tests/kit` and `docs/.vitepress`. A page outside the include list is not built.
- Images: a document shows a local image with a relative path (`docs/verification/gui.md` shows the GIFs of the GUI manual check beside it); VitePress bundles it, so a missing image fails the build, and the dead-link test of `tests/docs-build` copies the images of every document into its mirror of the site.
- Languages: there are no VitePress locales, because a locale needs a directory prefix. Each Korean document is its own page, and each page links its twin.
- Rewrites: a `README.md` renders as `index.md` of its directory, so the root is `/` and a package is `/packages/<name>/`. A `README.ko.md` keeps its own route, `/README.ko`. A relative link works in both, because twins share a directory.
- Repository links: a link from a site page to a repository file or directory that is not a site page (for example `AGENTS.md`, `schema/fsm.dbs` or `Makefile`) is rewritten to `https://github.com/polyspec/fsm/blob/main/<path>` (`tree` for a directory) by the markdown-it rule `repositoryLinks` of `docs/.vitepress/config.mts`. A link to a file that does not exist is left as written and fails the build. `ignoreDeadLinks` is not set.
- Navigation: the nav and the sidebar each have an English group and a Korean group (no locale switch). A group holds Overview, Specification, Plan, Packages, Verification and Changelog. Packages has one entry per package whose README pair exists; `fsm-compiler` and `fsm-db` join when their READMEs are written (S-19). Verification appears when its pages exist.
- Base: `VITEPRESS_BASE` (default `/`). The GitHub Pages site of polyspec/fsm is served under `/fsm/`, so the Pages workflow of S-21 sets `VITEPRESS_BASE=/fsm/`. Site routes take the base; the links to GitHub are absolute.
- Markup in prose: VitePress compiles Markdown as Vue templates, so an angle-bracket placeholder in prose (for example `<major>`) fails the build. Such a placeholder is written in a code span. The `<a id="...">` anchors of the changelogs are HTML and render.
- Vue on the root pages: the pages sit at the repository root, where no `node_modules` holds `vue`. `docs/.vitepress/config.mts` aliases `vue` to its runtime entry `dist/vue.runtime.esm-bundler.js` (the `import` condition of its exports) and `vue/server-renderer` to its ESM entry in `docs/node_modules`, so one copy of vue is bundled.
- Circular chunk (S-20-1): the build printed `Circular chunk: framework -> theme -> framework`. It is removed, and its cause is recorded here with its evidence. Reproduced: `make docs-build` printed the line. Not the cause: the vite 6.4.4 override (the same vitepress and configuration with vite 5.4.21 printed it too), and vitepress itself (a minimal vitepress 1.6.4 project with its default configuration printed nothing). The cause: the alias of `vue` to `vue/index.mjs`, which is `export * from './index.js'`, the CommonJS wrapper of `dist/vue.cjs.js`. The manual chunks of vitepress put the ESM `@vue/*` modules into `framework` and the wrapper into `theme`, which closes the cycle; a minimal project with that alias printed the line. The fix aliases `vue` to `dist/vue.runtime.esm-bundler.js`, and `make docs-build` prints no warning. `docs-build-test` fails on a warning line of the build output: a line that starts with `(!)`, `warn` or `warning`, or names a circular chunk or dependency (`tests/docs-build`).
- Tests: `tests/docs-build` (`make docs-build-test`, a root tool test with the record `.results/docs-build-test.json`) builds, in a temporary copy of the repository documents, a document with a link to a missing file, and requires the build to fail with a dead link. Then it builds the repository itself, and requires the pages `index.html`, `README.ko.html`, `packages/fsm-go/index.html`, `docs/spec/fsm.html` and `docs/plans/fsm-v1.html`, the GitHub rewrite of `AGENTS.md`, and no page for `AGENTS.md`, and no warning line in its output (S-20-1). `docs-build` and `docs-build-test` are in `CHECK_TARGETS`, with their owner rules in `config/owner-checks.json`. `config/documents.json` sets `siteLinks`, so `documents-check` accepts the link forms of the site: a link that starts with `/`, and a link without extension that names a `.md`, `.ko.md` or `index.md` file.

---

### C-9. User documentation (R11)
- The README pairs are the ones that `scripts/check-readmes.mjs` declares in `README_PAIRS`: the root, `fsm-compiler`, `fsm-db`, `fsm-gui` and the six language packages.
- Each pair has an English file and a Korean twin. The check requires the English `##` headings of its kind (the list is fixed in the script) and a Korean twin with the same number of headings per level. A heading inside a fenced code block is not a section.
- Kinds of sections: root (what fsm is and is not, the model, codes and the lock, transitions, validation errors, project files, requirements and setup, the fsm-gen CLI, the tools, generated names, checks); compiler (architecture, the store contract, commands, backend options, vectors); db (what it is, set up, the six tables, DSN, commands, moving a project to the database, checks); gui (what it does, setup, running, screens, rules; its testing section is written by S-22-2); language (generate into your project, generated files, API, errors, persistence, tests).
- The command names in the documents are `fsm-gen`, `fsm-db` and `fsm-gui`, the bare names of the commands that S-18-1 installs; the install and invocation are in the root README, and no document runs `node packages/...`.
- Every documented command is run for real through the installed command, in a temporary copy of a project, and its output is pasted. A code excerpt is copied from a repository file with its path. A snippet that is not a repository file is run in a temporary consumer project before it is written, and its output is quoted with it (the go, npm, php, python and rust APIs).
- A Korean fenced code block is identical to its English block (`documents-check` requires it), so code and command output are not translated; the prose around them is.
- The tests are `tests/check-readmes/` (`make readme-test`); `make readme-check` runs the check on the repository.

### C-10. CI and Pages (S-21)
- `.github/workflows/ci.yml` runs on every push to main and on a manual run (workflow_dispatch). Its one job, `check`, runs on ubuntu-24.04 and calls exactly two targets: `make install`, then `make check`, the full suite of CHECK_TARGETS. Before `make check` it runs `npx playwright install-deps chromium` in `packages/fsm-gui` with sudo (the system libraries of the Chromium that `gui-browser-test` drives; the browser itself is installed by `make check` through `gui-browsers`).
- The job starts PostgreSQL 17 and MySQL 8.4 as services and sets the four `FSM_TEST_*` variables. Its services and env are the yaml block of C-6, copied exactly; `make workflows-test` requires the job to contain that block, so the plan and the workflow cannot drift apart.
- The versions come from the files that declare them: Node.js from `.node-version` (setup-node); Go from `packages/fsm-go/go.mod` (setup-go, no module cache); PHP from `config/toolchain.json` (`php`, through setup-php with the extensions `pdo_pgsql` and `pdo_mysql`, which the php-ext build and the persistence tests need); Rust from `rust-toolchain.toml`, installed with rustup in the minimal profile, because `RUSTUP_AUTO_INSTALL` is `0`.
- uv is pinned in this plan as `uv==0.12.11` and installed by `pipx install` in the workflow. The interpreter of the job comes from `make install` (install-tools, the pythonBuild of `config/toolchain.json`, S-41); uv resolves the python package only. Decision: no file of the checkout pinned uv before S-21, and `config/toolchain.json` cannot hold the pin, because its schema (vendored in `scripts/kit/schema`) forbids keys it does not name. `make workflows-test` requires the workflow to install that version.
- Every action is pinned by its full commit with a version comment (`# vX`, or the tag where the tag has no `v`). The commits are the ones that the template repository verified for the same versions.
- The job uploads `var/full-run.json` and `.results/` as an artifact under `!cancelled()`, so a failed run still keeps its record.
- `.github/workflows/pages.yml` runs on every push to main and on a manual run. It runs `make docs-build` with `VITEPRESS_BASE=/fsm/` (the base of the site, read by `docs/.vitepress/config.mts`), uploads `docs/.vitepress/dist` with upload-pages-artifact and deploys it with deploy-pages. The site is published at https://polyspec.github.io/fsm/.
- Both workflows set `permissions: contents: read` at the top level, and their concurrency group does not cancel a run: a newer push does not cancel the run of an earlier one.
- The tests are `tests/workflows/` (`make workflows-test`). They read the workflows as text and need no network: every pin, the two make calls of the check job, the services and env, the versions, the artifact, the base of the site and the deployment.

## D. Checklist and owner checks

The state of every item is in [docs/plans/execution-checklist.md](execution-checklist.md), the only checklist of this plan (AGENTS.md, Checklist). This section holds no state. The kit items K17 to K19 are items of the kit repository, not of this checklist; section E names them.

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
| `tests/python-tools/**` | `python-tools-test` |
| `scripts/check-python-lock.mjs`, `tests/check-python-lock/**`, `packages/fsm-python/pyproject.toml`, `packages/fsm-python/uv.lock` | `python-lock-test python-lock-check` |
| `packages/fsm-compiler/**`, `schema/fsm.schema.json`, `machines/**`, `fsm.lock.json`, `conformance/**`, `contracts/features.json`, `fsm.config.json` | `compiler-test gen-check` |
| `schema/persist.dbs` | `gen-check packages-test` |
| `schema/fsm.dbs`, `packages/fsm-db/**` | `db-test` |
| `packages/fsm-gui/**` | `gui-test` |
| `packages/fsm-<kind>/**` | `layout-check gen-check parity-<kind> dependency-policy-check` |

- `parity-<kind>` (a literal target per kind with prerequisite `test-<kind>` and recipe `node scripts/check-parity.mjs --kind <kind>`) is the owner check of a kind. With `--kind`, check-parity reads only that kind's result and applies the C-4 conditions to it alone (every vector case ran once and passed, no unknown case, current `inputs`, `elapsedMs`); it reads neither other kinds nor the tool results. `vector-parity-check` (no prerequisite, no `--kind`) reads every kind and the tool results and runs in `check` after `packages-test`.
- Independent items may run in parallel when the checklist allows it (AGENTS.md, Checklist).
- The full suite runs once with `make check` after the last item of the checklist is committed.

## E. Order of work
1. kit K17–K19 → kit release → fsm from S-01.
2. Audits during implementation follow the audit rules of section 0. The auditor gives the exact location and replacement text, each finding is judged against its evidence, and the loop repeats until there are no core disagreements.

## Verification
- The root Makefile defines these targets after `include scripts/kit/kit.mk`:
  - `CHECK_TARGETS`, `check`
  - `layout-test`, `layout-check`, `parity-test`, `vector-parity-check`
  - `compiler-test`, `db-test`, `gui-test`, `gen-check-test`, `gen-check`
  - `python-tools-test` (`tests/python-tools`: the Python of the checkout, S-41: `var/tools/bin/python3` is made by `install-tools`, no recipe installs an interpreter with uv, there is no `install-python` target, and `config/toolchain.json` declares the `pythonBuild`; `make -n` on a copy of the Makefile, no network)
  - `python-lock-test` (`tests/check-python-lock`: the lock rules on fixtures and on the committed uv.lock, S-34) and `python-lock-check` (the same rules on `packages/fsm-python`)
  - `workflows-test` (`tests/workflows`: the CI and Pages workflows, their pins, versions and services, C-10, S-21)
  - `kit-test` (the vendored tests of `tests/kit`, run by kit.mk with `node --test`)
  - `test-<kind>`, `parity-<kind>` (`parity-<kind>: test-<kind>`), `packages-test` (the `test-<kind>` of `kinds` with `make -j6`)
- `check` = `node scripts/kit/full-run.mjs run $(CHECK_TARGETS)`
  - `CHECK_TARGETS` = `kit-check owner-validate documents-check commits-check hooks-check toolchain-check dependency-policy-check layout-test layout-check parity-test compiler-test gen-check-test gen-check db-test db-test-postgres db-test-mysql npm-persist-test npm-persist-test-postgres npm-persist-test-mysql gui-test npm-types name-test name-check docs-build docs-build-test packages-test gui-browser-test readme-test readme-check kit-test python-tools-test make-install-test rust-persist-test go-persist-test-postgres go-persist-test-mysql rust-persist-test-postgres rust-persist-test-mysql php-persist-test-postgres php-persist-test-mysql php-ext-persist-test-postgres php-ext-persist-test-mysql python-persist-test-postgres python-persist-test-mysql python-lock-test python-lock-check vector-parity-check`
- Python interpreter (S-41, the kit rule of 0.0.18): the python package runs on the Python that `make install-tools` installs, and no uv installs an interpreter. `config/toolchain.json` declares `pythonBuild` with the python-build-standalone release `3.14.8` of `20261009` and the sha256 of its `install_only` archive for each platform (`darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`), the values of the kit's own declaration. `install-tools` downloads the archive of the platform, refuses another digest, unpacks it into `var/tools/python-build` and writes the wrapper `var/tools/bin/python3`, which `make install` and every python target use. The uv-managed interpreter of `install-python` (`uv python install --no-bin 3.14`, S-11-3) is removed with its test: its interpreter was a uv download outside the declared tools, with no digest in the repository. uv stays the resolver and installer of `packages/fsm-python` (`uv export` and `uv pip install --python <venv>/bin/python --link-mode copy`, with the venv made from `var/tools/bin/python3`). `pythonBackend` is not declared, because the repository publishes no wheel.

- Package dependencies (S-29): `make install` (ONLINE, once per clone) installs the toolchains of `install-tools` into `var/tools` and every package dependency: `npm ci` of the locks of `packages/fsm-npm`, `packages/fsm-db`, `packages/fsm-gui` and `docs`; `composer install` of `packages/fsm-php` and `packages/fsm-php-ext` (keyed on `composer.lock` and `composer.json`, because the autoload of `composer.json` is not in the lock, and the stamp is touched after the install, S-29-2); the Python 3.14 of `install-tools` (`var/tools/bin/python3`, S-41) and the venv of `packages/fsm-python` (a copy of that interpreter, filled from the `pylock.toml` exported from its `uv.lock`; the python stamp is keyed on `uv.lock`); the go modules and the cargo crates (`var/deps/go` and `var/deps/rust`). Each one is a file target keyed on its lock, so a later run finds it up to date and needs no network. The targets that use a package name its file as a prerequisite: `npm-types`, `gen-check`, `test-<kind>` (and so `parity-<kind>` and `packages-test`), `db-test`, `gui-test`, `gui-browser-test` (through the browser stamp), `docs-build` and `docs-build-test`. A fresh clone runs `make install` once, then `make check`: the toolchains come only from `make install`. `make make-install-test` (`tests/make-install/`) checks the prerequisites on a copy of the Makefile, with no dependency installed and with every dependency present.
- During item work only the owner-checks mapping runs.
- GUI manual check, for each of the json, mermaid and db stores (the steps, the driver `packages/fsm-gui/scripts/manual-check.mjs` and the recorded outcome are in `docs/verification/gui.md`):
  1. Add, delete and rename states, then save (save updates the lock too).
  2. `check` passes (`fsm-gen check` for json and mermaid, `fsm-db check` for db).
  3. Mermaid renders in the browser.
