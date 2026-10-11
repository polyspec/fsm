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
  - `name-check` (`scripts/check-name.mjs`, RED tests in `tests/check-name/`): no tracked file or path names the library by its old name `status`; each allowed occurrence (a state value, an exit, HTTP or test-result status, the vendored kit, history in the CHANGELOG) is an entry of `ALLOWED` with its reason (R12).
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
  scripts/check-layout.mjs scripts/check-parity.mjs scripts/gen-check.mjs   tests/check-layout/ tests/check-parity/ tests/gen-check/
  contracts/layout.json (tools, kinds, canonical tree, allowed differences)   contracts/features.json
  docs/spec/fsm.md(.ko)  docs/plans/execution-checklist.md(.ko)  docs/plans/fsm-v1.md(.ko)
  schema/fsm.schema.json  schema/fsm.dbs  schema/persist.dbs   # persist.dbs = shared by the six language package examples
  fsm.config.json  machines/order.fsm.json  fsm.lock.json  conformance/vectors/<machine>.json
  packages/fsm-compiler/  {src/core/, src/backends/, src/store-json/, src/store-mermaid/, src/cli/, tests/}  # zero dependencies
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
  - `.node-version` holds an exact 26.y.z release (required by hyper; kit toolchain-declared.mjs accepts only <major>.<minor>.<patch>).
- The pins live in the manifests and lock files and are listed in `config/dependency-policy.json`. The kit gate does not check npm URLs, the Composer `package` dist URL, python `git+…@tag` or cargo tags; pin verification is a review rule (no R requires a tool for it).

### C-2. Canonical structure of a language package (identical for all six)
```
packages/fsm-<kind>/
  README.md README.ko.md
  Makefile          # gen (gen + vectors --kind; flags only here; DEST ?= .)
                    # test (run-tests --cwd packages/fsm-<kind> --results .results/<kind>.json; paths resolve against the checkout root)
  <manifest>        # [allowed difference] depends on orm (SQLite) for tests and examples
  <lock>            # [allowed difference] go.sum, package-lock.json, composer.lock, Cargo.lock (read by the kit dependency gate); python has none
  src/…             # fsm-gen output only
  tests/conformance.<ext>   # hand-written check functions; except in rust, iterates the vectors and registers one test per case
  tests/vectors.<ext>       # fsm-gen output (language-native data); in rust, one #[test] per case
  examples/persist.<ext>    # B-4 orm persistence; tests run it with the persist vectors
  examples/model/           # orm-generated model from the root schema/persist.dbs (committed, covered by gen-check); rust uses build.rs as an allowed difference
```
- `make gen` produces the fsm-gen output and the orm-gen output together; the `generated` globs of the kind in `contracts/layout.json` name the files it writes, and `gen-check` compares exactly those files.

| kind | manifest | src | tests |
|---|---|---|---|
| go | go.mod | `src/order/order.go`, `src/fsm/fsm.go` (in Go a package is a directory) | `conformance_test.go`, `vectors_test.go` |
| npm | package.json | `order.js/.d.ts`, `fsm.js/.d.ts`, `index.js/.d.ts` (`export * as order`) | `conformance.test.mjs`, `vectors.mjs` |
| php | composer.json | `Order/{State,Event,Step}.php`, `Order/functions.php`, `Fsm/Code.php` (error code enum, its own file for PSR-4), `Fsm/Error.php` | `ConformanceTest.php`, `Vectors.php` |
| php-ext | composer.json (`type: php-ext`, `extension-name`, `build-path: src`) | `config.m4`, `order.c`, `fsm.c` (shared `<ns>\Fsm\Error` and error code constants), `php_<ext>.h`, `<ext>.stub.php`, `<ext>_arginfo.h` | tests **byte-identical** to php; `make test` builds with phpize, then runs with `--php-extension <.so>`; gen requires `--php-namespace` and `--php-ext-name` |
| python | pyproject.toml | `polyspec_fsm/{__init__,order,fsm}.py` | `test_conformance.py` (generates methods named exactly after the cases), `vectors.py` |
| rust | Cargo.toml (`autotests=false`, `autoexamples=false`, `[[test]] conformance`, build-dep `polyspec-orm-build`, dev-dep `tokio`) + `build.rs` | `lib.rs` (`pub mod order; pub mod fsm;`), `order.rs`, `fsm.rs` | `conformance.rs` (`mod vectors;`, `#[path="../examples/persist.rs"] mod persist;`); persist cases are `#[tokio::test]`; generated `tests/vectors.rs` starts with `#![allow(non_snake_case)]` |

- check-layout fails when:
  - the set of `packages/fsm-*` directories, excluding the tool packages `fsm-compiler`, `fsm-db` and `fsm-gui` that `layout.json` lists under `tools`, differs from `kinds`
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
- without `--kind`: the record `.results/<target>.json` of a tool test named by `--tools` (`TOOL_TESTS` of the Makefile: layout-test, parity-test, gen-check-test, compiler-test, db-test, gui-test as their items add them) is missing, stale or holds a case that is not `pass`
- `elapsedMs > 600000` in any `.results/*.json` (with `--kind`: only that kind's result)

Case name extraction: `/\btest_[a-z][a-z0-9]*(?:_[a-z0-9]+)*__[a-z][a-z0-9]*(?:_[a-z0-9]+)*\b/` is applied to each result id. An id with exactly one distinct match is that case; an id with zero or with two or more distinct matches is judged by the result-id bullet above. There are no per-tool rules.

`contracts/features.json` = `{schema: 1, features: [initial, code, key, from_code, is_final, events_from, target, apply, persist]}`. A vector file is `conformance/vectors/<machine>.json` = `{machine, cases: [{feature, id, …}]}`; the case name is `test_<feature>__<id>`.

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
- Case ids: a case id is `<machine>_<suffix>`, and every key in the suffix is replaced by its declaration index, so that
  no two ids can collide, whatever the names are. A state is `s<i>`, an event `e<j>` (both 0-based) and a reserved code
  `r<code>`. The ids are `<m>_initial`; `<m>_code_s<i>`, `<m>_key_s<i>`, `<m>_from_code_s<i>`, `<m>_is_final_s<i>`,
  `<m>_events_from_s<i>`; `<m>_from_code_zero`, `<m>_from_code_unknown`, `<m>_from_code_r<code>`; `<m>_target_s<i>_e<j>`;
  `<m>_apply_s<i>_e<j>_s<k>` (expected, event, actual); `<m>_persist_first`, `<m>_persist_retry`, `<m>_persist_conflict`.
  The case data fields keep the keys (state, event, expected, actual, ...); only the ids use indexes.
- Persist cases exist only when the machine has a transition. `conflict` exists only when a third state exists, so a
  two-state machine has `first` and `retry`, and a machine without a transition (such as a one-state machine) has no
  persist case.

### C-5. compiler `packages/fsm-compiler`
- Parts
  - `src/core`: object → validate → normalize → backends, plus `run` and `copy`. It has zero `node:` imports, and the GUI imports it as is.
  - `src/backends/<kind>.mjs`
  - `src/store-json`, `src/store-mermaid`
  - `src/cli` (`fsm-gen`)
- The command `fsm-gen` is the `bin` of `packages/fsm-compiler/package.json` (a manifest without dependencies). From a clone, `npm install -g ./packages/fsm-compiler` links it onto the PATH; `tests/command.test.mjs` installs the package offline into a temporary npm prefix and runs the command (S-18-1).
- Commands
  - `lock [--rename]`
  - `gen --kind <k> --out <dir>` (php requires `--php-namespace`; php-ext requires `--php-namespace` and `--php-ext-name`; go requires `--go-module <module path>`, because a generated machine imports the shared package `<module>/src/fsm` and the backend cannot read go.mod)
  - `vectors [--kind <k>] --out <path>`
  - `check`: validates every definition and the lock match
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

**kit checklist (done first in the kit repository → release → kit-sync in fsm; written in kit's own 5-column format when added there)**

| id | Item | RED → GREEN | State |
|---|---|---|---|
| K17 | `run-tests python`: read the stderr of `python3 -m unittest -v`, with one line parser shared with cargo; the runner enforces the timeout; update tool-inventory(.ko) | PATH stub python3: pass/fail/timeout/no-test RED | [ ] |
| K18 | `run-tests --results` (counts `cases` + `inputs` + `elapsedMs`), `inputsDigest`, update tool-inventory | fixture node/vitest tests + PATH stub go/cargo/phpunit/python3 RED | [ ] |
| K19 | `check-commits` rule: a commit that moves an item to `[o]` also changes the changelog (en and ko), and one commit changes the state of at most one item; add `done` and `changelog` to the schemas; a row added in the commit is not a state change | git fixture RED | [ ] |

**fsm checklist**

| id | Item | RED → GREEN | State |
|---|---|---|---|
| S-01 | git init, kit-sync, config (toolchain: node only; dependency-policy with empty lists + `config/dependency-review.json` from `make dependency-review RECORD=1`), hooks, AGENTS.md(.ko) section A, the checklist with every S row of section D (S-01 `[o]`, the rest `[ ]`), CHANGELOG, this plan, `CHECK_TARGETS` (only the targets defined so far; each item appends its own) and `check` | `kit-check owner-validate documents-check commits-check toolchain-check hooks-check dependency-policy-check` | [ ] |
| S-02 | `docs/spec/fsm.md(.ko)` section B | `documents-check` | [ ] |
| S-03 | `check-layout` + `layout.json` (kinds = {}, an object of each kind with its required files and allowed globs) + `layout-test`/`layout-check` | fixtures (kinds mismatch/added/missing/renamed/php↔php-ext mismatch/malformed) RED | [ ] |
| S-04 | `check-parity` + `parity-test` | fixtures (no result/missing tool result/`--kind` reads only its kind/stale inputs/not run/unregistered/zero cases/fail/timeout/skip/0 or 2 name matches/parent id/over 10 minutes) RED | [ ] |
| S-05 | core `E_SCHEMA` + schema correspondence test | RED | [ ] |
| S-05-1 | core graph errors | RED per error code | [ ] |
| S-05-2 | core name/code errors | RED per error code | [ ] |
| S-06 | normalize/IR + lock (rename/reserved) + JsonStore + store contract + `run`/`copy` | RED per lock scenario | [ ] |
| S-07 | `fsm.config.json` (`{"store":"json"}`) + `machines/order.fsm.json` + `fsm.lock.json` + `contracts/features.json` + vector oracle (rejects unregistered featureId) + `gen-check` + `gen-check-test` | matches hand-written expected fixture, gen-check RED | [ ] |
| S-08 | MermaidStore (canonical parser and writer) + json↔mermaid round trip | `E_MERMAID_UNSUPPORTED`, order violation, round-trip mismatch RED | [ ] |
| S-09 / S-09-1 | npm backend + `vectors --kind npm` (golden) / npm package (conformance + persist + root `schema/persist.dbs` (created here, shared afterwards) + `examples/model/` (orm-gen, covered by gen-check), add the kind, add toolchain and dependency-policy, `test-npm`) | RED with no generated output → pass, layout and parity | [ ] |
| S-10 … S-14 (+ `-1`) | the same for go, python, php, rust, php-ext | same | [ ] |
| S-15 | fsm-db: dbs + DbStore + contract tests + copy + `db-test` | contract mismatch, `E_STORE_NOT_EMPTY`, atomicity RED | [ ] |
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
| `packages/fsm-compiler/**`, `schema/fsm.schema.json`, `machines/**`, `fsm.lock.json`, `conformance/**`, `contracts/features.json`, `fsm.config.json` | `compiler-test gen-check` |
| `schema/persist.dbs` | `gen-check packages-test` |
| `schema/fsm.dbs`, `packages/fsm-db/**` | `db-test` |
| `packages/fsm-gui/**` | `gui-test` |
| `packages/fsm-<kind>/**` | `layout-check gen-check parity-<kind> dependency-policy-check` |

- `parity-<kind>` (a literal target per kind with prerequisite `test-<kind>` and recipe `node scripts/check-parity.mjs --kind <kind>`) is the owner check of a kind. With `--kind`, check-parity reads only that kind's result and applies the C-4 conditions to it alone (every vector case ran once and passed, no unknown case, current `inputs`, `elapsedMs`); it reads neither other kinds nor the tool results. `parity-check` (no prerequisite, no `--kind`) reads every kind and the tool results and runs in `check` after `packages-test`.
- Independent items (S-03, S-04, S-05) may run in parallel.
- The full suite runs once with `make check` after S-17 is committed.

## E. Order of work
1. kit K17–K19 → kit release → fsm from S-01.
2. Audits during implementation follow the audit rules of section 0. The auditor gives the exact location and replacement text, each finding is judged against its evidence, and the loop repeats until there are no core disagreements.

## Verification
- The root Makefile defines these targets after `include scripts/kit/kit.mk`:
  - `CHECK_TARGETS`, `check`
  - `layout-test`, `layout-check`, `parity-test`, `parity-check`
  - `compiler-test`, `db-test`, `gui-test`, `gen-check-test`, `gen-check`
  - `test-<kind>`, `parity-<kind>` (`parity-<kind>: test-<kind>`), `packages-test` (the `test-<kind>` of `kinds` with `make -j6`)
- `check` = `node scripts/kit/full-run.mjs run $(CHECK_TARGETS)`
  - `CHECK_TARGETS` = `kit-check owner-validate documents-check commits-check hooks-check toolchain-check dependency-policy-check layout-test layout-check parity-test compiler-test gen-check-test gen-check db-test gui-test npm-types name-test name-check packages-test parity-check`
- During item work only the owner-checks mapping runs.
- GUI manual check, for each of the json, mermaid and db stores:
  1. Add, delete and rename states, then save (save updates the lock too).
  2. `check` passes (`fsm-gen check` for json and mermaid, `fsm-db check` for db).
  3. Mermaid renders in the browser.
