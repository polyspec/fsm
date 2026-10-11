# The tools of every run are the releases that the tracked declaration files name: Node.js in .node-version. Each language
# package item adds the declaration of its toolchain (config/toolchain.json).
export PATH := $(CURDIR)/var/tools/bin:$(PATH)

# The shared targets of kit (scripts/kit/kit.mk, vendored by make kit-sync): the gates, the document, owner and commit checks,
# the toolchains and the dependency gate. They read the configuration in config/*.json.
include scripts/kit/kit.mk

# The targets of the full suite that make check runs through the guard of scripts/kit/full-run.mjs. Each checklist item
# appends the targets that it defines (docs/plans/fsm-v1.md, Verification). TOOL_TESTS are the tests of the tools, whose
# records parity-check requires.
comma := ,
TOOL_TESTS := layout-test parity-test compiler-test gen-check-test db-test db-test-postgres db-test-mysql npm-persist-test npm-persist-test-postgres npm-persist-test-mysql gui-test npm-types name-test docs-build-test gui-browser-test readme-test install-python-test make-install-test rust-persist-test go-persist-test-postgres go-persist-test-mysql rust-persist-test-postgres rust-persist-test-mysql php-persist-test-postgres php-persist-test-mysql php-ext-persist-test-postgres php-ext-persist-test-mysql python-persist-test-postgres python-persist-test-mysql
# The kinds of contracts/layout.json, read from it so that the Makefile cannot name a kind the layout lacks. Each kind has
# test-<kind> (its package tests) and parity-<kind> (its owner check) as literal targets, added by its package item.
KINDS := $(shell node -p "Object.keys(require('./contracts/layout.json').kinds).join(' ')")

CHECK_TARGETS := kit-check owner-validate documents-check commits-check hooks-check toolchain-check dependency-policy-check layout-test layout-check parity-test compiler-test gen-check-test gen-check db-test db-test-postgres db-test-mysql npm-persist-test npm-persist-test-postgres npm-persist-test-mysql gui-test npm-types name-test name-check docs-build docs-build-test packages-test gui-browser-test readme-test readme-check kit-test install-python-test make-install-test rust-persist-test go-persist-test-postgres go-persist-test-mysql rust-persist-test-postgres rust-persist-test-mysql php-persist-test-postgres php-persist-test-mysql php-ext-persist-test-postgres php-ext-persist-test-mysql python-persist-test-postgres python-persist-test-mysql python-lock-test python-lock-check parity-check

.PHONY: go-persist-test-postgres go-persist-test-mysql rust-persist-test-postgres rust-persist-test-mysql php-persist-test-postgres php-persist-test-mysql php-ext-persist-test-postgres php-ext-persist-test-mysql python-persist-test-postgres python-persist-test-mysql check layout-test layout-check parity-test compiler-test gen-check-test gen-check name-test name-check docs-deps docs-build docs-build-test db-deps db-test db-test-postgres db-test-mysql npm-persist-test npm-persist-test-postgres npm-persist-test-mysql gui-deps gui-build gui-test parity-check packages-test test-npm parity-npm test-go parity-go test-php parity-php test-rust parity-rust rust-persist-test npm-types install-python test-python parity-python test-php-ext parity-php-ext gui-browsers gui-browser-test readme-test readme-check install-python-test install make-install-test python-lock-test python-lock-check






# ---- Package dependencies (docs/plans/fsm-v1.md, Verification; docs/plans/execution-checklist.md, S-29) ------------------------
# A dependency is a file target keyed on the lock or manifest it installs from. A fresh clone installs it once; a later run finds
# the file newer than its lock, runs nothing and needs no network. A target that uses a package names its file as a prerequisite,
# so make installs what that target needs before the target's recipe and nothing else. go and cargo leave no file of their own:
# their stamps are var/deps/go and var/deps/rust. The python environment is keyed on the uv.lock of packages/fsm-python and on the Python 3.14 link of install-python.
# install builds every dependency, with the toolchains of install-tools. ONLINE marks each download, as it does in kit.mk.
NPM_DEP := packages/fsm-npm/node_modules/.package-lock.json
PHP_DEP := packages/fsm-php/vendor/composer/installed.json
PHP_EXT_DEP := packages/fsm-php-ext/vendor/composer/installed.json
PYTHON_BIN := var/tools/bin/python3
PYTHON_DEP := packages/fsm-python/.venv/.installed
PYTHON_LOCK := packages/fsm-python/uv.lock
GO_DEP := var/deps/go
RUST_DEP := var/deps/rust
DB_DEP := packages/fsm-db/node_modules/.package-lock.json
GUI_DEP := packages/fsm-gui/node_modules/.package-lock.json
DOCS_DEP := docs/node_modules/.package-lock.json
PACKAGE_DEPS := $(NPM_DEP) $(PHP_DEP) $(PHP_EXT_DEP) $(PYTHON_DEP) $(GO_DEP) $(RUST_DEP) $(DB_DEP) $(GUI_DEP) $(DOCS_DEP)

$(NPM_DEP): packages/fsm-npm/package-lock.json
	$(ONLINE) $(MAKE) -C packages/fsm-npm install

$(PHP_DEP): packages/fsm-php/composer.lock
	$(ONLINE) $(MAKE) -C packages/fsm-php install

$(PHP_EXT_DEP): packages/fsm-php-ext/composer.lock
	$(ONLINE) $(MAKE) -C packages/fsm-php-ext install

$(PYTHON_BIN):
	$(MAKE) install-python

$(PYTHON_DEP): $(PYTHON_LOCK) $(PYTHON_BIN)
	$(ONLINE) $(MAKE) -C packages/fsm-python install UV=$(UV)
	touch $@

$(GO_DEP): packages/fsm-go/go.sum
	mkdir -p $(dir $@)
	$(ONLINE) $(MAKE) -C packages/fsm-go install
	touch $@

$(RUST_DEP): packages/fsm-rust/Cargo.lock
	mkdir -p $(dir $@)
	$(ONLINE) $(MAKE) -C packages/fsm-rust install
	touch $@

$(DB_DEP): packages/fsm-db/package-lock.json
	cd packages/fsm-db && $(ONLINE) npm ci --no-audit --no-fund

# The GUI installs after the db packages, because its tests run the db store (order only: a db install does not reinstall the GUI).
$(GUI_DEP): packages/fsm-gui/package-lock.json | $(DB_DEP)
	cd packages/fsm-gui && $(ONLINE) npm ci --no-audit --no-fund

$(DOCS_DEP): docs/package-lock.json
	cd docs && $(ONLINE) npm ci --no-audit --no-fund

# install is for a fresh clone and for CI, which runs `make install` once and then `make check`. It installs the toolchains of
# install-tools into var/tools and every package dependency above; a later run downloads nothing.
install: install-tools $(PACKAGE_DEPS)

# check runs the full suite once per committed tree, when no item of docs/plans/execution-checklist.md is [~]
# (scripts/kit/full-run.mjs); it records its result in var/full-run.json.
check:
	node scripts/kit/full-run.mjs run $(CHECK_TARGETS)

# make-install-test runs the tests of the package dependencies (tests/make-install): a target that needs a dependency installs it
# first, and a present dependency is not installed again (docs/plans/execution-checklist.md, S-29).
make-install-test:
	node scripts/kit/run-tests.mjs node --results .results/make-install-test.json --inputs Makefile --inputs scripts/kit/kit.mk --inputs contracts/layout.json --inputs packages --inputs tests/make-install -- tests/make-install

# python-lock-test runs the tests of scripts/check-python-lock.mjs; python-lock-check checks that uv.lock of packages/fsm-python locks
# every package with an exact version, hashes (git packages: a commit) and agrees with pyproject.toml. The kit dependency gate
# reads no uv.lock, so this check covers the python lock (docs/plans/fsm-v1.md, C-1; docs/plans/execution-checklist.md, S-34).
python-lock-test:
	node scripts/kit/run-tests.mjs node --results .results/python-lock-test.json --inputs scripts/check-python-lock.mjs --inputs tests/check-python-lock --inputs packages/fsm-python/pyproject.toml --inputs $(PYTHON_LOCK) -- tests/check-python-lock

python-lock-check:
	node scripts/check-python-lock.mjs

# layout-test runs the tests of scripts/check-layout.mjs; layout-check checks the language packages against
# contracts/layout.json (docs/plans/fsm-v1.md, C-2).
layout-test:
	node scripts/kit/run-tests.mjs node --results .results/layout-test.json --inputs scripts/check-layout.mjs --inputs tests/check-layout -- tests/check-layout

layout-check:
	node scripts/check-layout.mjs

# name-test runs the tests of scripts/check-name.mjs; name-check fails while a tracked file or path names the library by its old
# outside the allowlist of the checker (docs/plans/execution-checklist.md, S-18; the library is named fsm).
name-test:
	node scripts/kit/run-tests.mjs node --results .results/name-test.json --inputs scripts/check-name.mjs --inputs tests/check-name -- tests/check-name

name-check:
	node scripts/check-name.mjs

# readme-test runs the tests of scripts/check-readmes.mjs; readme-check requires every declared README pair to have its required
# sections and a Korean twin with the same headings (docs/plans/fsm-v1.md, C-9; docs/plans/execution-checklist.md, S-19).
readme-test:
	node scripts/kit/run-tests.mjs node --results .results/readme-test.json --inputs scripts/check-readmes.mjs --inputs tests/check-readmes -- tests/check-readmes

readme-check:
	node scripts/check-readmes.mjs

# docs-deps installs the packages of the documentation site: the exact vitepress release of docs/package.json, locked in
# docs/package-lock.json (docs/plans/fsm-v1.md, C-8).
docs-deps: $(DOCS_DEP)

# docs-build builds the documentation site from the repository documents in place, into docs/.vitepress/dist; a dead link fails
# the build (docs/.vitepress/config.mts, docs/plans/fsm-v1.md, C-8).
docs-build: $(DOCS_DEP)
	node docs/node_modules/vitepress/bin/vitepress.js build docs

# docs-build-test runs the tests of the site: a dead link fails the build, and the real build produces its pages and the GitHub
# rewrite of a link to a repository file (tests/docs-build, docs/plans/fsm-v1.md, C-8). Its record names the inputs it reads.
docs-build-test: $(DOCS_DEP)
	node scripts/kit/run-tests.mjs node --timeout 600 --results .results/docs-build-test.json --inputs docs --inputs packages --inputs tests/docs-build --inputs README.md --inputs README.ko.md --inputs AGENTS.md --inputs AGENTS.ko.md --inputs CHANGELOG.md --inputs CHANGELOG.ko.md -- tests/docs-build

# parity-test runs the tests of scripts/check-parity.mjs. parity-check, the last target of the full suite, requires that every
# kind ran every vector case once and passed and that every tool test left a current record (docs/plans/fsm-v1.md, C-4).
parity-test:
	node scripts/kit/run-tests.mjs node --results .results/parity-test.json --inputs scripts/check-parity.mjs --inputs tests/check-parity -- tests/check-parity

# compiler-test runs the tests of packages/fsm-compiler, the core validation of a definition (docs/plans/fsm-v1.md, C-5)
# with the editor schema schema/fsm.schema.json, which the tests check against the core.
compiler-test:
	node scripts/kit/run-tests.mjs node --results .results/compiler-test.json --inputs packages/fsm-compiler --inputs schema --inputs machines --inputs conformance --inputs contracts/features.json --inputs fsm.lock.json --inputs fsm.config.json -- packages/fsm-compiler/tests

# gen-check-test runs the tests of scripts/gen-check.mjs; gen-check regenerates the generated files into var/gen-check and
# requires them to equal the working tree (docs/plans/fsm-v1.md, C-5).
gen-check-test:
	node scripts/kit/run-tests.mjs node --results .results/gen-check-test.json --inputs scripts/gen-check.mjs --inputs tests/gen-check -- tests/gen-check

gen-check: $(NPM_DEP) $(GO_DEP) $(PHP_DEP) $(PHP_EXT_DEP) $(PYTHON_DEP)
	node scripts/gen-check.mjs

# db-test-postgres and db-test-mysql run the DB store tests on the server dialects that the documents name (docs/plans/fsm-v1.md, C-6):
# db-store.test.mjs and store-contract-all.test.mjs, which open the database of FSM_TEST_PG_DSN or FSM_TEST_MYSQL_DSN through the dialect
# helper of tests/dialect.mjs. The DSN names the server and its user; a missing DSN fails the target and never skips it. The CLI and
# command tests (cli.test.mjs, command.test.mjs) run on the same dialect with an empty database of their own, which the admin DSN
# (FSM_TEST_PG_ADMIN_DSN, FSM_TEST_MYSQL_ADMIN_DSN) creates and drops (docs/plans/fsm-v1.md, C-6; docs/plans/execution-checklist.md,
# S-37-2). The files share the server, so they run one after the other.
DB_DIALECT_TESTS := packages/fsm-db/tests/db-store.test.mjs packages/fsm-db/tests/store-contract-all.test.mjs packages/fsm-db/tests/cli.test.mjs packages/fsm-db/tests/command.test.mjs
db-test-postgres: $(DB_DEP)
	@$(call require_dsn,FSM_TEST_PG_DSN)
	@$(call require_dsn,FSM_TEST_PG_ADMIN_DSN)
	FSM_TEST_DIALECT=postgres node scripts/kit/run-tests.mjs node --results .results/db-test-postgres.json --inputs packages/fsm-db/src --inputs packages/fsm-db/tests --inputs packages/fsm-db/package.json --inputs packages/fsm-db/package-lock.json --inputs packages/fsm-compiler --inputs schema/fsm.dbs -- --test-concurrency=1 $(DB_DIALECT_TESTS)

db-test-mysql: $(DB_DEP)
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	@$(call require_dsn,FSM_TEST_MYSQL_ADMIN_DSN)
	FSM_TEST_DIALECT=mysql node scripts/kit/run-tests.mjs node --results .results/db-test-mysql.json --inputs packages/fsm-db/src --inputs packages/fsm-db/tests --inputs packages/fsm-db/package.json --inputs packages/fsm-db/package-lock.json --inputs packages/fsm-compiler --inputs schema/fsm.dbs -- --test-concurrency=1 $(DB_DIALECT_TESTS)

# db-deps installs the packages of packages/fsm-db (orm and ordered-json from their release tarballs, pinned in its
# package-lock.json). db-test runs the tests of packages/fsm-db: the DB store against the store contract, the round trips
# of json and db, the atomicity of save, the CLI, and the generated models, which orm-gen must reproduce from schema/fsm.dbs
# (docs/plans/fsm-v1.md, C-6).
db-deps: $(DB_DEP)

db-test: $(DB_DEP)
	node scripts/kit/run-tests.mjs node --results .results/db-test.json --inputs packages/fsm-db/src --inputs packages/fsm-db/tests --inputs packages/fsm-db/package.json --inputs packages/fsm-db/package-lock.json --inputs packages/fsm-compiler --inputs schema/fsm.dbs -- packages/fsm-db/tests

# gui-deps installs the packages of packages/fsm-gui (hyper v0.0.11, crudui v0.0.5, the template v0.0.5, mermaid, htmx and
# yaml, pinned in its package.json and package-lock.json; docs/plans/fsm-v1.md, C-1). The db store of the GUI is the one of
# packages/fsm-db, whose orm packages db-deps installs first.
gui-deps: $(GUI_DEP)

# gui-build builds the browser assets of the GUI with the hyper v0.0.11 asset build: the templates, the client bundle that holds
# mermaid, build/templates.index.json and build/manifest.json (docs/plans/fsm-v1.md, C-7). gui-test runs it first. The crudui
# stylesheet is copied into public/assets and given to the build with --static, which puts it in the static deployment (the way
# hyper-build-assets takes the stylesheets that the layouts link); the layout links it as /assets/crudui.css (S-22-2).
gui-build: $(GUI_DEP)
	cd packages/fsm-gui && mkdir -p public/assets && cp node_modules/@polyspec/crudui-generator-core/styles/crudui.css public/assets/crudui.css && node_modules/.bin/hyper-build-assets --app . --api /api --output build --static public/assets/crudui.css

# gui-test runs the tests of packages/fsm-gui (docs/plans/fsm-v1.md, C-7): the handlers and the server entry through the
# built application, the store selection and the pinned Mermaid parse test. The compiler sources are inputs of the GUI. The
# browser test is in tests/browser and runs with gui-browser-test, so gui-test takes the test files of tests/ only.
gui-test: gui-build $(DB_DEP)
	node scripts/kit/run-tests.mjs node --results .results/gui-test.json --inputs packages/fsm-gui --inputs packages/fsm-compiler/src --inputs packages/fsm-db --inputs schema/fsm.dbs -- $(wildcard packages/fsm-gui/tests/*.test.mjs)

# GUI_BROWSERS is the stamp of the Chromium that the GUI browser test drives, keyed on the Playwright version that
# packages/fsm-gui/package-lock.json pins (devDependency, exact). A new version is a new stamp, so it downloads once; a later run
# with the stamp present downloads nothing (docs/plans/execution-checklist.md, S-29-1). The download comes from the Playwright CDN,
# so it is ONLINE; the browser goes into the user's Playwright cache and no tracked file changes (docs/plans/fsm-v1.md, C-7).
# The stamp needs the Playwright binary of GUI_DEP, which is order-only: a changed lock that keeps the version reuses the stamp.
GUI_PLAYWRIGHT := $(shell node -p "require('./packages/fsm-gui/package-lock.json').packages['node_modules/playwright'].version" 2>/dev/null)
GUI_BROWSERS := var/deps/playwright-$(GUI_PLAYWRIGHT)

$(GUI_BROWSERS): | $(GUI_DEP)
	@test -n "$(GUI_PLAYWRIGHT)" || { echo "packages/fsm-gui/package-lock.json names no playwright version" >&2; exit 1; }
	mkdir -p $(dir $@)
	cd packages/fsm-gui && $(ONLINE) node_modules/.bin/playwright install chromium
	touch $@

# gui-browsers is the name of the stamp for people who type it; the stamp is the target that the browser test needs.
gui-browsers: $(GUI_BROWSERS)

# gui-browser-test runs the tests of tests/browser (browser.test.mjs, diagram.test.mjs; S-38 adds the drawn diagram) of packages/fsm-gui: the GUI forms in a headless Chromium on a temporary project
# (docs/plans/execution-checklist.md, S-22-1 and S-22-2). It needs the browser of gui-browsers and the built assets of gui-build.
gui-browser-test: $(GUI_BROWSERS) gui-build $(DB_DEP)
	node scripts/kit/run-tests.mjs node --timeout 120 --results .results/gui-browser-test.json --inputs packages/fsm-gui --inputs packages/fsm-compiler/src --inputs packages/fsm-db --inputs schema/fsm.dbs -- packages/fsm-gui/tests/browser/browser.test.mjs packages/fsm-gui/tests/browser/diagram.test.mjs

parity-check:
	node scripts/check-parity.mjs --tools $(subst $(eval) ,$(comma),$(TOOL_TESTS))

# packages-test runs the test of every kind with make -j6 (docs/plans/fsm-v1.md, Verification). It refuses an empty kind list,
# because make with no goal would run the default goal, check, from inside check.
packages-test:
	$(if $(KINDS),,$(error contracts/layout.json declares no kind))
	$(MAKE) -j6 $(addprefix test-,$(KINDS))

# test-npm runs the tests of packages/fsm-npm: the conformance cases and the persist example (docs/plans/fsm-v1.md, C-2).
test-npm: $(NPM_DEP)
	$(MAKE) -C packages/fsm-npm test

# npm-persist-test runs tests/persist-dialects.test.mjs of packages/fsm-npm: two concurrent transitions of one row give one Changed and one
# Unchanged, and two events from one expected state give one Changed and one E_CONFLICT (docs/spec/fsm.md, B-4; docs/plans/fsm-v1.md, C-4).
# The three targets run it on each dialect: sqlite (a temporary file), postgres (FSM_TEST_PG_DSN) and mysql (FSM_TEST_MYSQL_DSN).
NPM_PERSIST_TESTS := packages/fsm-npm/tests/persist-dialects.test.mjs
npm-persist-test: $(NPM_DEP) $(DB_DEP)
	FSM_TEST_DIALECT=sqlite node scripts/kit/run-tests.mjs node --results .results/npm-persist-test.json --inputs packages/fsm-npm --inputs schema/persist.dbs --inputs packages/fsm-db/tests/dialect.mjs --inputs packages/fsm-db/src/models -- $(NPM_PERSIST_TESTS)

npm-persist-test-postgres: $(NPM_DEP) $(DB_DEP)
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres node scripts/kit/run-tests.mjs node --results .results/npm-persist-test-postgres.json --inputs packages/fsm-npm --inputs schema/persist.dbs --inputs packages/fsm-db/tests/dialect.mjs --inputs packages/fsm-db/src/models -- $(NPM_PERSIST_TESTS)

npm-persist-test-mysql: $(NPM_DEP) $(DB_DEP)
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql node scripts/kit/run-tests.mjs node --results .results/npm-persist-test-mysql.json --inputs packages/fsm-npm --inputs schema/persist.dbs --inputs packages/fsm-db/tests/dialect.mjs --inputs packages/fsm-db/src/models -- $(NPM_PERSIST_TESTS)

# npm-types runs tests/types.test.mjs of packages/fsm-npm: tsc compiles tests/types/consumer.ts against the generated
# declarations in strict mode, so a wrong declaration fails (docs/plans/execution-checklist.md, S-09-2). It is a tool test with
# its own record, so the record of the npm kind holds only vector cases for check-parity.
npm-types: $(NPM_DEP)
	node scripts/kit/run-tests.mjs node --results .results/npm-types.json --inputs packages/fsm-npm -- packages/fsm-npm/tests/types.test.mjs

# parity-npm is the owner check of the npm package: check-parity reads its record only and requires every vector case to have
# run once and passed (docs/plans/fsm-v1.md, C-4 and D).
parity-npm: test-npm
	node scripts/check-parity.mjs --kind npm

# test-go runs the tests of packages/fsm-go: the conformance cases and the persist example (docs/plans/fsm-v1.md, C-2).
test-go: $(GO_DEP)
	$(MAKE) -C packages/fsm-go test

# parity-go is the owner check of the go package: check-parity reads its record only and requires every vector case to have run
# once and passed (docs/plans/fsm-v1.md, C-4 and D).
parity-go: test-go
	node scripts/check-parity.mjs --kind go
# test-php runs the tests of packages/fsm-php: the conformance cases and the persist example (docs/plans/fsm-v1.md, C-2).
test-php: $(PHP_DEP)
	$(MAKE) -C packages/fsm-php test
# parity-php is the owner check of the php package: check-parity reads its record only and requires every vector case to have
# run once and passed (docs/plans/fsm-v1.md, C-4 and D).
parity-php: test-php
	node scripts/check-parity.mjs --kind php
# test-rust runs the tests of packages/fsm-rust: the conformance cases and the persist example (docs/plans/fsm-v1.md, C-2).
test-rust: $(RUST_DEP)
	$(MAKE) -C packages/fsm-rust test
# rust-persist-test runs tests/persist_retry.rs of packages/fsm-rust: a deadlock runs the persistence transaction again and another
# database error does not (docs/spec/fsm.md, B-4; docs/plans/execution-checklist.md, S-31). It is a tool test with its own record.
rust-persist-test: $(RUST_DEP)
	node scripts/kit/run-tests.mjs cargo --results .results/rust-persist-test.json --inputs packages/fsm-rust --inputs schema/persist.dbs -- --manifest-path packages/fsm-rust/Cargo.toml --test persist_retry
# parity-rust is the owner check of the rust package: check-parity reads its record only and requires every vector case to have
# run once and passed (docs/plans/fsm-v1.md, C-4 and D).
parity-rust: test-rust
	node scripts/check-parity.mjs --kind rust
# install-python installs Python 3.14 (config/toolchain.json python) with uv and links var/tools/bin/python3 to it, as install-tools
# puts the other declared tools into var/tools. The interpreter is uv's managed install, so the link never points outside the
# checkout's tools; no system path changes. --no-bin keeps uv from writing an executable into a user bin directory
# (~/.local/bin by default). ONLINE, because uv downloads the interpreter. The PATH above puts var/tools/bin first,
# so toolchain-check and the python package use this python3.
UV ?= uv
install-python:
	$(ONLINE) $(UV) python install --no-bin 3.14
	mkdir -p var/tools/bin
	p="$$($(UV) python find --managed-python 3.14)" && test -x "$$p" && ln -sfn "$$p" var/tools/bin/python3

# install-python-test runs the tests of install-python in a temporary checkout with a stub uv: the target installs with --no-bin
# and writes no link outside var/tools, and a recipe without --no-bin is shown to write one (tests/install-python, S-11-3 and
# S-35). It needs no network and writes nothing outside its temporary directory.
install-python-test:
	node scripts/kit/run-tests.mjs node --results .results/install-python-test.json --inputs Makefile --inputs contracts/layout.json --inputs scripts/kit --inputs tests/install-python -- tests/install-python

# test-python runs the tests of packages/fsm-python: the conformance cases and the persist example, offline, with the Python 3.14
# venv of `make -C packages/fsm-python install` (docs/plans/fsm-v1.md, C-2).
test-python: $(PYTHON_DEP)
	$(MAKE) -C packages/fsm-python test

# parity-python is the owner check of the python package: check-parity reads its record only and requires every vector case to have
# run once and passed (docs/plans/fsm-v1.md, C-4 and D).
parity-python: test-python
	node scripts/check-parity.mjs --kind python
# test-php-ext builds the extension of packages/fsm-php-ext and runs its tests: the conformance cases and the persist example
# (docs/plans/fsm-v1.md, C-2).
test-php-ext: $(PHP_EXT_DEP)
	$(MAKE) -C packages/fsm-php-ext test
# parity-php-ext is the owner check of the php-ext package: check-parity reads its record only and requires every vector case to
# have run once and passed (docs/plans/fsm-v1.md, C-4 and D).
parity-php-ext: test-php-ext
	node scripts/check-parity.mjs --kind php-ext

# ---- Persist cases on the server dialects (docs/spec/fsm.md, B-4; docs/plans/fsm-v1.md, C-6; docs/plans/execution-checklist.md, S-37-1)
# Each kind runs its persist cases on PostgreSQL and MySQL with the DSN variables of npm (FSM_TEST_PG_DSN, FSM_TEST_MYSQL_DSN). The
# test selects the dialect with FSM_TEST_DIALECT and fails when its DSN is empty; require_dsn makes the target itself stop first
# with exit 2, so a missing DSN is a failed target and never a skipped dialect. The persist cases of sqlite run in test-<kind>.
define require_dsn
test -n "$${$(1)}" || { echo "$@ needs $(1): a server dialect never skips (docs/plans/fsm-v1.md, C-6)" >&2; exit 2; }
endef

go-persist-test-postgres: $(GO_DEP)
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres GOPROXY=off node scripts/kit/run-tests.mjs go --cwd packages/fsm-go --results .results/go-persist-test-postgres.json --inputs packages/fsm-go --inputs schema/persist.dbs -- ./tests -run 'TestConformance/test_persist__'

go-persist-test-mysql: $(GO_DEP)
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql GOPROXY=off node scripts/kit/run-tests.mjs go --cwd packages/fsm-go --results .results/go-persist-test-mysql.json --inputs packages/fsm-go --inputs schema/persist.dbs -- ./tests -run 'TestConformance/test_persist__'

rust-persist-test-postgres: $(RUST_DEP)
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres node scripts/kit/run-tests.mjs cargo --results .results/rust-persist-test-postgres.json --inputs packages/fsm-rust --inputs schema/persist.dbs -- --manifest-path packages/fsm-rust/Cargo.toml --test conformance persist

rust-persist-test-mysql: $(RUST_DEP)
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql node scripts/kit/run-tests.mjs cargo --results .results/rust-persist-test-mysql.json --inputs packages/fsm-rust --inputs schema/persist.dbs -- --manifest-path packages/fsm-rust/Cargo.toml --test conformance persist

php-persist-test-postgres: $(PHP_DEP)
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres node scripts/kit/run-tests.mjs phpunit --cwd packages/fsm-php --results .results/php-persist-test-postgres.json --inputs packages/fsm-php --inputs schema/persist.dbs -- tests --filter persist

php-persist-test-mysql: $(PHP_DEP)
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql node scripts/kit/run-tests.mjs phpunit --cwd packages/fsm-php --results .results/php-persist-test-mysql.json --inputs packages/fsm-php --inputs schema/persist.dbs -- tests --filter persist

php-ext-persist-test-postgres: $(PHP_EXT_DEP)
	@$(call require_dsn,FSM_TEST_PG_DSN)
	$(MAKE) -C packages/fsm-php-ext build
	FSM_TEST_DIALECT=postgres node scripts/kit/run-tests.mjs phpunit --php-extension packages/fsm-php-ext/src/modules/polyspec_fsm_test.so --cwd packages/fsm-php-ext --results .results/php-ext-persist-test-postgres.json --inputs packages/fsm-php-ext --inputs schema/persist.dbs -- tests --filter persist

php-ext-persist-test-mysql: $(PHP_EXT_DEP)
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	$(MAKE) -C packages/fsm-php-ext build
	FSM_TEST_DIALECT=mysql node scripts/kit/run-tests.mjs phpunit --php-extension packages/fsm-php-ext/src/modules/polyspec_fsm_test.so --cwd packages/fsm-php-ext --results .results/php-ext-persist-test-mysql.json --inputs packages/fsm-php-ext --inputs schema/persist.dbs -- tests --filter persist

python-persist-test-postgres: $(PYTHON_DEP)
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres PATH=$(CURDIR)/packages/fsm-python/.venv/bin:$$PATH node scripts/kit/run-tests.mjs python --results .results/python-persist-test-postgres.json --inputs packages/fsm-python --inputs schema/persist.dbs -- discover -s packages/fsm-python/tests -t packages/fsm-python/tests -k persist

python-persist-test-mysql: $(PYTHON_DEP)
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql PATH=$(CURDIR)/packages/fsm-python/.venv/bin:$$PATH node scripts/kit/run-tests.mjs python --results .results/python-persist-test-mysql.json --inputs packages/fsm-python --inputs schema/persist.dbs -- discover -s packages/fsm-python/tests -t packages/fsm-python/tests -k persist
