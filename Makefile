# The tools of every run are the releases that the tracked declaration files name: Node.js in mise.toml, which the bootstrap
# installs into var/tools and recipes start by $(NODE) of kit.mk (kit K171). Each language
# package item adds the declaration of its toolchain (config/toolchain.json).
# The shared targets of kit: the gates, the document, owner and commit checks, the toolchains, the layout check and the dependency
# gate. node_modules/@polyspec/kit/scripts/kit/kit-bootstrap.mk is the bootstrap of the installed package @polyspec/kit (in dev, a link
# to the kit checkout; in CI, the 0.0.70 install). It includes the kit.mk of the installed package, which runs its built tools
# ($(KIT)/<tool>.$(KIT_EXT)), and before the package is installed it runs only make install-tools TOOLS=npm and
# make install-packages (S-44). The tools read the configuration in config/*.json.
include node_modules/@polyspec/kit/scripts/kit/kit-bootstrap.mk
export PATH := $(KIT_TOOLS)/bin:$(PATH)

# The test runner of kit: every test target runs its tool through it (AGENTS.md, Rules).
RUN_TESTS := node $(KIT)/run-tests.$(KIT_EXT)

# The targets of the full suite that make check runs through the guard of kit's full-run. Each checklist item appends the
# targets that it defines (docs/plans/fsm-v1/plan.md, Verification).
# The kinds are the implementations of config/parity.json, the one list of the languages of fsm (S-44), so the Makefile cannot
# name a kind that parity lacks. Each kind has test-<kind> (its package tests) as a literal target, added by its package item;
# kit's parity-check runs the vectors of every kind (S-42-1).
KINDS := $(shell node -p "require('./config/parity.json').implementations.map(implementation => implementation.name).join(' ')")

# The kit-gates prerequisites run in the shared gates of CI (kit K870, Decision 9), and CI links nothing (kit K824): the own suite of
# ci.yml is CHECK_TARGETS without them. make check runs all of CHECK_TARGETS locally.
KIT_GATE_TARGETS := kit-check layout-check docs-check rules-check owner-validate rebuild-check language-check test-markers-check duplication-check parity-declarations-check parity-check bypass-check suppression-check divergence-check lint-ts lint-php lint-python lint-go lint-rust lint-php-ext test-php-ext link-state-check
CI_SUITE_TARGETS = $(filter-out $(KIT_GATE_TARGETS),$(CHECK_TARGETS))

CHECK_TARGETS := kit-check owner-validate docs-check hooks-check layout-check lint-ts compiler-test db-test db-test-postgres db-test-mysql npm-persist-test npm-persist-test-postgres npm-persist-test-mysql gui-test npm-types name-test name-check docs-build docs-build-test packages-test gui-browser-test readme-test readme-check python-tools-test make-install-test rust-persist-test go-persist-test-postgres go-persist-test-mysql rust-persist-test-postgres rust-persist-test-mysql php-persist-test-postgres php-persist-test-mysql php-ext-persist-test-postgres php-ext-persist-test-mysql python-persist-test-postgres python-persist-test-mysql workflows-test parity-declarations-check parity-check rules-check rebuild-check language-check test-markers-check duplication-check lint-php lint-python lint-go lint-rust lint-php-ext test-php-ext link-state-check bypass-check divergence-check suppression-check

.PHONY: go-persist-test-postgres go-persist-test-mysql rust-persist-test-postgres rust-persist-test-mysql php-persist-test-postgres php-persist-test-mysql php-ext-persist-test-postgres php-ext-persist-test-mysql python-persist-test-postgres python-persist-test-mysql check compiler-test name-test name-check docs-deps docs-build docs-build-test db-deps db-test db-test-postgres db-test-mysql npm-persist-test npm-persist-test-postgres npm-persist-test-mysql gui-deps gui-build gui-test parity-check packages-test test-js test-go test-php test-rust rust-persist-test npm-types test-python test-php-ext gui-browsers gui-browser-test readme-test readme-check python-tools-test install make-install-test workflows-test fsm-install fsm-js-test fsm-go-test fsm-php-test fsm-rust-test fsm-python-test fsm-php-ext-test






# ---- Package dependencies (docs/plans/fsm-v1/plan.md, Verification; docs/plans/fsm-v1/checklist.md, S-29) ------------------------
# A dependency is a file target keyed on the lock or manifest it installs from. A fresh clone installs it once; a later run finds
# the file newer than its lock, runs nothing and needs no network. A target that uses a package names its file as a prerequisite,
# so make installs what that target needs before the target's recipe and nothing else. go and cargo leave no file of their own:
# their stamps are var/deps/go and var/deps/rust. The python environment is keyed on the pylock.toml of packages/python and on the
# Python 3.14 that install-tools installs with mise, whose shim is var/tools/mise/shims/python3 (S-41, S-44-2).
# install builds every dependency, with the toolchains of install-tools. ONLINE marks each download, as it does in kit.mk.
NPM_DEP := packages/js/node_modules/.package-lock.json
PHP_DEP := packages/php/vendor/composer/installed.json
PHP_EXT_DEP := packages/php-ext/vendor/composer/installed.json
PYTHON_BIN := $(KIT_TOOLS)/mise/shims/python3
PYTHON_DEP := packages/python/.venv/.installed
PYTHON_LOCK := packages/python/pylock.toml
GO_DEP := var/deps/go
RUST_DEP := var/deps/rust
DB_DEP := packages/db/node_modules/.package-lock.json
GUI_DEP := packages/gui/node_modules/.package-lock.json
DOCS_DEP := docs/node_modules/.package-lock.json
PACKAGE_DEPS := $(NPM_DEP) $(PHP_DEP) $(PHP_EXT_DEP) $(PYTHON_DEP) $(GO_DEP) $(RUST_DEP) $(DB_DEP) $(GUI_DEP) $(DOCS_DEP)

$(NPM_DEP): packages/js/package-lock.json
	$(ONLINE) $(MAKE) fsm-js-install

$(PHP_DEP): packages/php/composer.lock packages/php/composer.json
	$(ONLINE) $(MAKE) fsm-php-install
	touch $@

$(PHP_EXT_DEP): packages/php-ext/composer.lock packages/php-ext/composer.json
	$(ONLINE) $(MAKE) fsm-php-ext-install
	touch $@

# The polyspec packages of Composer (orm and ordered-json) come from the packages.json of each release, a flat
# Composer repository that composer.json names (K871). Kit downloads no package (K865): composer install reads that
# repository, and composer.lock records the dist of each package.

$(PYTHON_BIN):
	$(ONLINE) $(MAKE) install-tools

$(PYTHON_DEP): $(PYTHON_LOCK) | $(PYTHON_BIN)
	$(ONLINE) $(MAKE) fsm-python-install
	touch $@

deps-go: $(GO_DEP)

$(GO_DEP): packages/go/go.sum
	mkdir -p $(dir $@)
	$(ONLINE) $(MAKE) fsm-go-install
	touch $@

$(RUST_DEP): packages/rust/Cargo.lock
	mkdir -p $(dir $@)
	$(ONLINE) $(MAKE) fsm-rust-install
	touch $@

$(DB_DEP): packages/db/package-lock.json
	cd packages/db && $(ONLINE) $(NPM) ci --allow-remote=root --no-audit --no-fund

# The GUI installs after the db packages, because its tests run the db store (order only: a db install does not reinstall the GUI).
$(GUI_DEP): packages/gui/package-lock.json | $(DB_DEP)
	cd packages/gui && $(ONLINE) $(NPM) ci --allow-remote=root --no-audit --no-fund

$(DOCS_DEP): docs/package-lock.json
	cd docs && $(ONLINE) $(NPM) ci --allow-remote=root --no-audit --no-fund

# ---- Runtime packages (K245, S-44): the install, gen, build, clean and test of each runtime package are targets of this Makefile,
# named fsm-<package>-<task> with the folder name of the package. gen writes the generated files of the package, which no checkout tracks.
# The fixed tasks of kit join them by a prerequisite (test-go: fsm-go-test, K246-2).
FSM_GEN := $(NODE) packages/compiler/src/cli/fsm-gen.mjs
GO_MODULE := github.com/polyspec/fsm/packages/go
PHP_NAMESPACE := Polyspec\FsmTest
PHP_EXT_NAME := polyspec_fsm
PHP_EXT_MODULE := var/php-ext/$(PHP_EXT_NAME).so
PY_VENV := packages/python/.venv
# uv is the one of config/toolchain.json that install-tools installs (S-44-2), never a uv of PATH.
UV := $(KIT_TOOLS)/mise/shims/uv
# The tools of the packages, by the absolute path of their shims: kit-check requires a recipe to start a tool by such a path.
GO := $(KIT_TOOLS)/mise/shims/go
COMPOSER := $(KIT_TOOLS)/mise/shims/composer

# fsm-go-install downloads the modules that go.mod and go.sum name (the orm release and orm-gen); gen and test need them.
.PHONY: deps-go fsm-go-install fsm-go-gen fsm-go-test
fsm-go-install:
	cd packages/go && $(GO) mod download

fsm-go-gen: $(GO_DEP)
fsm-go-gen:
	$(FSM_GEN) gen --project contracts --kind go --go-module $(GO_MODULE) --out packages/go/src
	# orm-gen runs go in the module of its output directory, so it runs in packages/go.
	mkdir -p packages/go/examples
	cd packages/go && $(GO) tool orm-gen gen --set $(abspath contracts/schema/dbspec-set.json) --lang go --out examples/model --scan ./examples/...

# fsm-go-test runs the conformance cases and the persist example with GOPROXY=off, so that the modules must already be downloaded.
fsm-go-test: $(GO_DEP) fsm-go-gen
	GOPROXY=off $(RUN_TESTS) go --cwd packages/go --results .results/go.json --inputs packages/go --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- ./tests

# fsm-js-install installs the dependencies of package-lock.json (the orm release); gen and test need them.
.PHONY: fsm-js-install fsm-js-gen fsm-js-test
fsm-js-install:
	cd packages/js && $(NPM) ci --allow-remote=root --no-audit --no-fund

fsm-js-gen: $(NPM_DEP)
fsm-js-gen:
	$(FSM_GEN) gen --project contracts --kind npm --out packages/js/src
	packages/js/node_modules/.bin/orm-gen gen --set contracts/schema/dbspec-set.json --out packages/js/examples/model

# fsm-js-test runs the conformance cases of the npm package; the kit reporter names every file from the checkout root.
fsm-js-test: $(NPM_DEP) fsm-js-gen
	$(RUN_TESTS) node --results .results/npm.json --inputs packages/js --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- packages/js/tests/conformance.test.mjs

# fsm-php-install installs the Composer dependencies of packages/php from the release packages.json of composer.json (K865,
# K871), then installs the dependencies of composer.lock, and links right after the install (P30), so the vendor
# installed from the tracked lock never replaces the links.
.PHONY: fsm-php-install fsm-php-gen fsm-php-test
fsm-php-install:
	cd packages/php && $(COMPOSER) install --no-interaction --no-progress
	$(MAKE) --no-print-directory link

fsm-php-gen: $(PHP_DEP)
fsm-php-gen:
	$(FSM_GEN) gen --project contracts --kind php --php-namespace '$(PHP_NAMESPACE)' --out packages/php/src
	packages/php/vendor/bin/orm-gen gen --set contracts/schema/dbspec-set.json --out packages/php/examples/model --namespace '$(PHP_NAMESPACE)\Model'

# fsm-php-test runs phpunit on the tests of packages/php (the conformance cases and the persist example).
fsm-php-test: $(PHP_DEP) fsm-php-gen
	$(RUN_TESTS) phpunit --cwd packages/php --results .results/php.json --inputs packages/php --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- tests

# fsm-php-ext-install is the install of the extension: the same Composer packages as packages/php (composer.lock).
.PHONY: fsm-php-ext-install fsm-php-ext-gen
fsm-php-ext-install:
	cd packages/php-ext && $(COMPOSER) install --no-interaction --no-progress
	$(MAKE) --no-print-directory link

# fsm-php-ext-gen writes the generated files of the extension (src/): fsm-gen writes the C files and the stub, and kit's php-ext-arginfo
# writes the arginfo header from the stub with the gen_stub.php of the PHP (ONLINE: it downloads its PHP-Parser once). The extension has no test of its own: kit's test-php-ext runs the
# PHPUnit files of packages/php with the extension that kit's build-php-ext built from src/, so the model of the php package is
# generated first.
fsm-php-ext-gen: $(PHP_EXT_DEP) fsm-php-gen
fsm-php-ext-gen:
	mkdir -p packages/php-ext/src
	$(FSM_GEN) gen --project contracts --kind php-ext --php-namespace '$(PHP_NAMESPACE)' --php-ext-name $(PHP_EXT_NAME) --out packages/php-ext/src
	$(MAKE) php-ext-arginfo

# fsm-python-install makes the venv .venv with the Python of the checkout, var/tools/mise/shims/python3, which install-tools
# installs with uv. The venv is made by kit's python-venv, and uv fills it with --link-mode copy: the locked packages of pylock.toml
# (PEP 751, written by kit's python-lock), then make link links the install folders of the
# packages to their checkouts, then the project itself, non-editable: the python extractor of kit reads the modules from the file
# list of the installed distribution (kit K788), which an editable install does not hold. make link then links the installed
# package folder to the checkout (ONLINE).
# The check of the interpreter version runs first, so a wrong Python fails before a venv is made.
.PHONY: fsm-python-install fsm-python-gen fsm-python-test
fsm-python-install:
	@$(PYTHON_BIN) -c 'import sys; sys.exit(0 if sys.version_info[:2] == (3, 14) else "PYTHON must be Python 3.14, it is " + sys.version.split()[0])' || { echo "fsm-python-install: run make install-tools at the root first"; exit 1; }
	rm -rf $(PY_VENV)
	$(MAKE) python-venv DIR=$(PY_VENV)
	$(UV) pip install --python $(PY_VENV)/bin/python --link-mode copy -r packages/python/pylock.toml
	$(MAKE) link
	$(MAKE) fsm-python-src
	$(PY_VENV)/bin/orm-gen gen --set contracts/schema/dbspec-set.json --out packages/python/examples/model
	$(UV) pip install --python $(PY_VENV)/bin/python --link-mode copy --no-deps packages/python
	rm -rf packages/python/build
	$(MAKE) link

# fsm-python-src generates the ignored src/polyspec_fsm of packages/python with node alone: the package build of a clean checkout
# (CI, a worktree) needs it before the install, and it needs no venv, so the install does not depend on the venv.
.PHONY: fsm-python-src
fsm-python-src:
	$(FSM_GEN) gen --project contracts --kind python --out packages/python/src/polyspec_fsm

# The kit build of a fresh worktree builds packages/python, which needs its generated sources first (S-337).
build-python: fsm-python-src

# No bytecode: a __pycache__ written into src/ is a file without the generated header, which gen refuses.
fsm-python-gen: $(PYTHON_DEP)
fsm-python-gen: export PYTHONDONTWRITEBYTECODE := 1
fsm-python-gen:
	$(MAKE) --no-print-directory fsm-python-src
	$(PY_VENV)/bin/orm-gen gen --set contracts/schema/dbspec-set.json --out packages/python/examples/model

# fsm-python-test runs the tests through the kit runner with --venv, which runs the venv interpreter only when pyvenv.cfg names the
# install-tools Python; it runs from the checkout root with root-relative paths.
fsm-python-test: $(PYTHON_DEP) fsm-python-gen
fsm-python-test: export PYTHONDONTWRITEBYTECODE := 1
fsm-python-test:
	@test -x $(PY_VENV)/bin/python || { echo "fsm-python-test: $(PY_VENV) is missing; run make install first"; exit 1; }
	$(RUN_TESTS) python --venv $(CURDIR)/$(PY_VENV) --results .results/python.json --inputs packages/python --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- discover -s packages/python/tests -t packages/python/tests

# fsm-rust-install fetches the crates of Cargo.lock (the orm release from its git tag); gen and test need them.
.PHONY: fsm-rust-install fsm-rust-gen fsm-rust-test
fsm-rust-install:
	cargo fetch --locked --manifest-path packages/rust/Cargo.toml

# The orm models of contracts/schema/persist.dbs are written by build.rs into OUT_DIR, so gen writes no model directory: that is the
# declared difference of rust.
fsm-rust-gen:
	$(FSM_GEN) gen --project contracts --kind rust --out packages/rust/src

# fsm-rust-test runs cargo on the conformance test of packages/rust through the kit reporter.
fsm-rust-test: $(RUST_DEP) fsm-rust-gen
	$(RUN_TESTS) cargo --results .results/rust.json --inputs packages/rust --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- --manifest-path packages/rust/Cargo.toml --test conformance

# fsm-gen generates the files of every kind, which no checkout tracks: fsm-gen and orm-gen write them (AGENTS.md, Generated files). The
# gates that read them (the layout, the parity declarations and the parity check) and every test of a kind depend on the gen of
# its kind, so a fresh checkout generates what it reads.
.PHONY: fsm-gen
fsm-gen: fsm-go-gen fsm-js-gen fsm-php-gen fsm-php-ext-gen fsm-python-gen fsm-rust-gen
layout-check parity-declarations-check parity-check: fsm-gen

# install is for a fresh clone and for CI, which runs `make install` once and then `make check`. kit's install runs its bootstrap
# as install-kit (K246-2); fsm-install adds the package dependencies above, so a later run downloads nothing.
install: fsm-install
fsm-install: install-kit $(PACKAGE_DEPS)

# check runs the full suite once per committed tree, when no item of docs/plans/fsm-v1/checklist.md is [~] (kit's
# ci-targets of kit runs the targets to their end; ci.yml runs the same list.
.PHONY: ci-suite
ci-suite:
	$(MAKE) ci-targets TARGETS="$(CI_SUITE_TARGETS)"

check:
	$(MAKE) ci-targets TARGETS="$(CHECK_TARGETS)"

# make-install-test runs the tests of the package dependencies (tests/make-install): a target that needs a dependency installs it
# first, and a present dependency is not installed again (docs/plans/fsm-v1/checklist.md, S-29).
make-install-test:
	$(RUN_TESTS) node --results .results/make-install-test.json --inputs Makefile --inputs scripts/kit/kit-bootstrap.mk --inputs config/parity.json --inputs packages --inputs tests/make-install -- tests/make-install

# workflows-test runs the tests of the CI and Pages workflows (.github/workflows): every action is pinned to a verified commit,
# the check job runs make install and make check with the services of plan C-6, and each version comes from the file that
# declares it (docs/plans/fsm-v1/plan.md, C-10; docs/plans/fsm-v1/checklist.md, S-21). It reads the workflows as text, offline.
workflows-test:
	$(RUN_TESTS) node --results .results/workflows-test.json --inputs .github/workflows --inputs config/toolchain.json --inputs .php-version --inputs mise.toml --inputs rust-toolchain.toml --inputs packages/go/go.mod --inputs Makefile --inputs docs/plans/fsm-v1/plan.md --inputs tests/workflows -- tests/workflows/workflows.test.mts

# name-test runs the tests of scripts/check-name.mts; name-check fails while a tracked file or path names the library by its old
# outside the allowlist of the checker (docs/plans/fsm-v1/checklist.md, S-18; the library is named fsm).
name-test:
	$(RUN_TESTS) node --results .results/name-test.json --inputs scripts/check-name.mts --inputs tests/check-name -- tests/check-name

name-check:
	$(NODE) scripts/check-name.mts

# readme-test runs the tests of scripts/check-readmes.mts; readme-check requires every declared README pair to have its required
# sections and a Korean twin with the same headings (docs/plans/fsm-v1/plan.md, C-9; docs/plans/fsm-v1/checklist.md, S-19).
readme-test:
	$(RUN_TESTS) node --results .results/readme-test.json --inputs scripts/check-readmes.mts --inputs tests/check-readmes -- tests/check-readmes

readme-check:
	$(NODE) scripts/check-readmes.mts

# docs-deps installs the packages of the documentation site: the exact vitepress release of docs/package.json, locked in
# docs/package-lock.json (docs/plans/fsm-v1/plan.md, C-8).
docs-deps: $(DOCS_DEP)

# docs-build builds the documentation site from the repository documents in place, into docs/.vitepress/dist; a dead link fails
# the build (docs/.vitepress/config.mts, docs/plans/fsm-v1/plan.md, C-8).
docs-build: $(DOCS_DEP)
	$(NODE) docs/node_modules/vitepress/bin/vitepress.js build docs

# docs-build-test runs the tests of the site: a dead link fails the build, and the real build produces its pages and the GitHub
# rewrite of a link to a repository file (tests/docs-build, docs/plans/fsm-v1/plan.md, C-8). Its record names the inputs it reads.
docs-build-test: $(DOCS_DEP)
	$(RUN_TESTS) node --timeout 600 --results .results/docs-build-test.json --inputs docs --inputs packages --inputs tests/docs-build --inputs README.md --inputs README.ko.md --inputs AGENTS.md --inputs AGENTS.ko.md --inputs CHANGELOG.md --inputs CHANGELOG.ko.md -- tests/docs-build

# compiler-test runs the tests of packages/compiler, the core validation of a definition (docs/plans/fsm-v1/plan.md, C-5)
# with the editor schema contracts/schema/fsm.schema.json, which the tests check against the core.
compiler-test:
	$(RUN_TESTS) node --results .results/compiler-test.json --inputs packages/compiler --inputs contracts -- packages/compiler/tests

# db-test-postgres and db-test-mysql run the DB store tests on the server dialects that the documents name (docs/plans/fsm-v1/plan.md, C-6):
# db-store.test.mjs and store-contract-all.test.mjs, which open the database of FSM_TEST_PG_DSN or FSM_TEST_MYSQL_DSN through the dialect
# helper of tests/dialect.mjs. The DSN names the server and its user; a missing DSN fails the target and never skips it. The CLI and
# command tests (cli.test.mjs, command.test.mjs) run on the same dialect with an empty database of their own, which the admin DSN
# (FSM_TEST_PG_ADMIN_DSN, FSM_TEST_MYSQL_ADMIN_DSN) creates and drops (docs/plans/fsm-v1/plan.md, C-6; docs/plans/fsm-v1/checklist.md,
# S-37-2). The files share the server, so they run one after the other.
DB_DIALECT_TESTS := packages/db/tests/db-store.test.mjs packages/db/tests/store-contract-all.test.mjs packages/db/tests/cli.test.mjs packages/db/tests/command.test.mjs
db-test-postgres: $(DB_DEP) fsm-db-gen
	@$(call require_dsn,FSM_TEST_PG_DSN)
	@$(call require_dsn,FSM_TEST_PG_ADMIN_DSN)
	FSM_TEST_DIALECT=postgres $(RUN_TESTS) node --results .results/db-test-postgres.json --inputs packages/db/src --inputs packages/db/tests --inputs packages/db/package.json --inputs packages/db/package-lock.json --inputs packages/db/schema --inputs packages/compiler -- --test-concurrency=1 $(DB_DIALECT_TESTS)

db-test-mysql: $(DB_DEP) fsm-db-gen
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	@$(call require_dsn,FSM_TEST_MYSQL_ADMIN_DSN)
	FSM_TEST_DIALECT=mysql $(RUN_TESTS) node --results .results/db-test-mysql.json --inputs packages/db/src --inputs packages/db/tests --inputs packages/db/package.json --inputs packages/db/package-lock.json --inputs packages/db/schema --inputs packages/compiler -- --test-concurrency=1 $(DB_DIALECT_TESTS)

# fsm-db-gen writes the models of packages/db/src/models with the orm-gen of its package (npm run gen): they are generated output, and
# no checkout tracks them (AGENTS.md, Generated files). The db store, its tests, the GUI and the dialect helper of the npm persist
# tests import them, so every target that runs one of those depends on it.
.PHONY: fsm-db-gen
fsm-db-gen: $(DB_DEP)
	cd packages/db && $(NPM) run gen

# db-deps installs the packages of packages/db (orm and ordered-json from their release tarballs, pinned in its
# package-lock.json). db-test runs the tests of packages/db: the DB store against the store contract, the round trips
# of json and db, the atomicity of save, the CLI, on the models that fsm-db-gen writes from packages/db/schema/fsm.dbs
# (docs/plans/fsm-v1/plan.md, C-6).
db-deps: $(DB_DEP)

db-test: $(DB_DEP) fsm-db-gen
	$(RUN_TESTS) node --results .results/db-test.json --inputs packages/db/src --inputs packages/db/tests --inputs packages/db/package.json --inputs packages/db/package-lock.json --inputs packages/db/schema --inputs packages/compiler -- packages/db/tests

# gui-deps installs the packages of packages/gui (hyper v0.0.13, crudui v0.0.5, the template v0.0.5, mermaid, htmx and
# yaml, pinned in its package.json and package-lock.json; docs/plans/fsm-v1/plan.md, C-1). The db store of the GUI is the one of
# packages/db, whose orm packages db-deps installs first.
gui-deps: $(GUI_DEP)

# gui-build builds the browser assets of the GUI with the hyper v0.0.13 asset build: the templates, the client bundle that holds
# mermaid, build/templates.index.json and build/manifest.json (docs/plans/fsm-v1/plan.md, C-7). gui-test runs it first. The crudui
# stylesheet is copied into public/assets and given to the build with --static, which puts it in the static deployment (the way
# hyper-build-assets takes the stylesheets that the layouts link); the layout links it as /assets/crudui.css (S-22-2).
gui-build: $(GUI_DEP)
	cd packages/gui && mkdir -p public/assets && cp node_modules/@polyspec/crudui-generator-core/styles/crudui.css public/assets/crudui.css && node_modules/.bin/hyper-build-assets --app . --api /api --output build --static public/assets/crudui.css

# gui-test runs the tests of packages/gui (docs/plans/fsm-v1/plan.md, C-7): the handlers and the server entry through the
# built application, the store selection and the pinned Mermaid parse test. The compiler sources are inputs of the GUI. The
# browser test is in tests/browser and runs with gui-browser-test, so gui-test takes the test files of tests/ only.
gui-test: gui-build $(DB_DEP) fsm-db-gen
	$(RUN_TESTS) node --results .results/gui-test.json --inputs packages/gui --inputs packages/compiler/src --inputs packages/db -- $(wildcard packages/gui/tests/*.test.mjs)

# GUI_BROWSERS is the stamp of the Chromium that the GUI browser test drives, keyed on the Playwright version that
# packages/gui/package-lock.json pins (devDependency, exact). A new version is a new stamp, so it downloads once; a later run
# with the stamp present downloads nothing (docs/plans/fsm-v1/checklist.md, S-29-1). The download comes from the Playwright CDN,
# so it is ONLINE; the browser goes into the user's Playwright cache and no tracked file changes (docs/plans/fsm-v1/plan.md, C-7).
# The stamp needs the Playwright binary of GUI_DEP, which is order-only: a changed lock that keeps the version reuses the stamp.
GUI_PLAYWRIGHT := $(shell node -p "require('./packages/gui/package-lock.json').packages['node_modules/playwright'].version" 2>/dev/null)
GUI_BROWSERS := var/deps/playwright-$(GUI_PLAYWRIGHT)

$(GUI_BROWSERS): | $(GUI_DEP)
	@test -n "$(GUI_PLAYWRIGHT)" || { echo "packages/gui/package-lock.json names no playwright version" >&2; exit 1; }
	mkdir -p $(dir $@)
	cd packages/gui && $(ONLINE) node_modules/.bin/playwright install chromium
	touch $@

# gui-browsers is the name of the stamp for people who type it; the stamp is the target that the browser test needs.
gui-browsers: $(GUI_BROWSERS)

# gui-browser-test runs the tests of tests/browser (browser.test.mjs, diagram.test.mjs; S-38 adds the drawn diagram) of packages/gui: the GUI forms in a headless Chromium on a temporary project
# (docs/plans/fsm-v1/checklist.md, S-22-1 and S-22-2). It needs the browser of gui-browsers and the built assets of gui-build.
gui-browser-test: $(GUI_BROWSERS) gui-build $(DB_DEP) fsm-db-gen
	$(RUN_TESTS) node --timeout 120 --results .results/gui-browser-test.json --inputs packages/gui --inputs packages/compiler/src --inputs packages/db -- packages/gui/tests/browser/browser.test.mjs packages/gui/tests/browser/diagram.test.mjs

# packages-test runs the test of every kind with make -j6 (docs/plans/fsm-v1/plan.md, Verification). It refuses an empty kind list,
# because make with no goal would run the default goal, check, from inside check.
packages-test:
	$(if $(KINDS),,$(error config/parity.json declares no kind))
	$(MAKE) -j6 test-go test-js test-php test-php-ext test-python test-rust

# test-js is the fixed task of kit; the tests of packages/js are its prerequisite (K246).
test-js: fsm-js-test

# npm-persist-test runs the persist cases of packages/js on a dialect: the persist vector cases of tests/conformance.test.mjs and
# tests/persist.test.mjs, whose two transitions of one row give one Changed and one Unchanged or one E_CONFLICT, and whose
# deadlock runs the transaction again while another database error does not (docs/spec/fsm.md, B-4; docs/plans/fsm-v1/plan.md, C-4).
# The three targets run them on each dialect: sqlite (a temporary file), postgres (FSM_TEST_PG_DSN) and mysql (FSM_TEST_MYSQL_DSN).
# The two files run one after the other: on a server dialect they share the persist table, which each case clears.
NPM_PERSIST_TESTS := --test-concurrency=1 --test-name-pattern=persist packages/js/tests/conformance.test.mjs packages/js/tests/persist.test.mjs
npm-persist-test: $(NPM_DEP) $(DB_DEP) fsm-js-gen fsm-db-gen
	FSM_TEST_DIALECT=sqlite $(RUN_TESTS) node --results .results/npm-persist-test.json --inputs packages/js --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json --inputs packages/db/tests/dialect.mjs -- $(NPM_PERSIST_TESTS)

npm-persist-test-postgres: $(NPM_DEP) $(DB_DEP) fsm-js-gen fsm-db-gen
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres $(RUN_TESTS) node --results .results/npm-persist-test-postgres.json --inputs packages/js --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json --inputs packages/db/tests/dialect.mjs -- $(NPM_PERSIST_TESTS)

npm-persist-test-mysql: $(NPM_DEP) $(DB_DEP) fsm-js-gen fsm-db-gen
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql $(RUN_TESTS) node --results .results/npm-persist-test-mysql.json --inputs packages/js --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json --inputs packages/db/tests/dialect.mjs -- $(NPM_PERSIST_TESTS)

# npm-types runs tests/npm-types: tsc compiles tests/npm-types/consumer.ts against the generated
# declarations in strict mode, so a wrong declaration fails (docs/plans/fsm-v1/checklist.md, S-09-2). It is a tool test with
# its own record, so the conformance test of the npm kind holds only vector cases for kit's parity check.
npm-types: $(NPM_DEP) fsm-js-gen
	$(RUN_TESTS) node --results .results/npm-types.json --inputs packages/js -- tests/npm-types


# test-go is the fixed task of kit; the tests of packages/go are its prerequisite (K246-2).
test-go: fsm-go-test

# test-php is the fixed task of kit; the tests of packages/php are its prerequisite (K246-2).
test-php: fsm-php-test

# test-rust is the fixed task of kit; the tests of packages/rust are its prerequisite (K246-2).
test-rust: fsm-rust-test
# rust-persist-test runs tests/persist.rs of packages/rust on sqlite: two transitions of one row at the same time, and a deadlock
# runs the persistence transaction again while another database error does not (docs/spec/fsm.md, B-4; S-31, S-44-9).
rust-persist-test: $(RUST_DEP) fsm-rust-gen
	$(RUN_TESTS) cargo --results .results/rust-persist-test.json --inputs packages/rust --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- --manifest-path packages/rust/Cargo.toml --test persist
# python-tools-test runs the tests of the Python of the checkout (tests/python-tools, S-41): the interpreter var/tools/mise/shims/python3
# is made by install-tools, no recipe installs an interpreter with uv, there is no install-python target, and config/toolchain.json
# declares the pythonBuild. It runs make -n on a copy of the Makefile, with no network and nothing installed.
python-tools-test:
	$(RUN_TESTS) node --results .results/python-tools-test.json --inputs Makefile --inputs config/parity.json --inputs scripts/kit/kit-bootstrap.mk --inputs config/toolchain.json --inputs tests/python-tools -- tests/python-tools

# test-python is the fixed task of kit; the tests of packages/python are its prerequisite (K246-2).
test-python: fsm-python-test

# test-php-ext is the fixed task of kit; the tests of packages/php-ext are its prerequisite (K246-2).
test-php-ext: fsm-php-ext-gen
build-php-ext: fsm-php-ext-gen

# ---- Persist cases on the server dialects (docs/spec/fsm.md, B-4; docs/plans/fsm-v1/plan.md, C-6; docs/plans/fsm-v1/checklist.md, S-37-1)
# Each kind runs its persist cases on PostgreSQL and MySQL with the DSN variables of npm (FSM_TEST_PG_DSN, FSM_TEST_MYSQL_DSN). The
# test selects the dialect with FSM_TEST_DIALECT and fails when its DSN is empty; require_dsn makes the target itself stop first
# with exit 2, so a missing DSN is a failed target and never a skipped dialect. The persist cases of sqlite run in test-<kind>.
define require_dsn
test -n "$${$(1)}" || { echo "$@ needs $(1): a server dialect never skips (docs/plans/fsm-v1/plan.md, C-6)" >&2; exit 2; }
endef

go-persist-test-postgres: $(GO_DEP) fsm-go-gen
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres GOPROXY=off $(RUN_TESTS) go --cwd packages/go --results .results/go-persist-test-postgres.json --inputs packages/go --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- ./tests -run 'TestConformance/test_persist__|TestPersist'

go-persist-test-mysql: $(GO_DEP) fsm-go-gen
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql GOPROXY=off $(RUN_TESTS) go --cwd packages/go --results .results/go-persist-test-mysql.json --inputs packages/go --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- ./tests -run 'TestConformance/test_persist__|TestPersist'

rust-persist-test-postgres: $(RUST_DEP) fsm-rust-gen
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres $(RUN_TESTS) cargo --results .results/rust-persist-test-postgres.json --inputs packages/rust --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- --manifest-path packages/rust/Cargo.toml --test conformance --test persist persist

rust-persist-test-mysql: $(RUST_DEP) fsm-rust-gen
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql $(RUN_TESTS) cargo --results .results/rust-persist-test-mysql.json --inputs packages/rust --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- --manifest-path packages/rust/Cargo.toml --test conformance --test persist persist

php-persist-test-postgres: $(PHP_DEP) fsm-php-gen
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres $(RUN_TESTS) phpunit --cwd packages/php --results .results/php-persist-test-postgres.json --inputs packages/php --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- tests --filter '/persist/i'

php-persist-test-mysql: $(PHP_DEP) fsm-php-gen
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql $(RUN_TESTS) phpunit --cwd packages/php --results .results/php-persist-test-mysql.json --inputs packages/php --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- tests --filter '/persist/i'

php-ext-persist-test-postgres: $(PHP_EXT_DEP) fsm-php-gen build-php-ext
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres $(RUN_TESTS) phpunit --php-extension $(PHP_EXT_MODULE) --cwd packages/php --results .results/php-ext-persist-test-postgres.json --inputs packages/php --inputs var/php-ext --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- tests --filter '/persist/i'

php-ext-persist-test-mysql: $(PHP_EXT_DEP) fsm-php-gen build-php-ext
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql $(RUN_TESTS) phpunit --php-extension $(PHP_EXT_MODULE) --cwd packages/php --results .results/php-ext-persist-test-mysql.json --inputs packages/php --inputs var/php-ext --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- tests --filter '/persist/i'

python-persist-test-postgres: $(PYTHON_DEP) fsm-python-gen
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres $(RUN_TESTS) python --venv packages/python/.venv --results .results/python-persist-test-postgres.json --inputs packages/python --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- discover -s packages/python/tests -t packages/python/tests -k persist

python-persist-test-mysql: $(PYTHON_DEP) fsm-python-gen
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql $(RUN_TESTS) python --venv packages/python/.venv --results .results/python-persist-test-mysql.json --inputs packages/python --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- discover -s packages/python/tests -t packages/python/tests -k persist

# examples-model generates the ignored examples/model of the Go examples before build-go compiles them (S-304): the build does not
# depend on a leftover of an earlier run. It runs the orm-gen of packages/go with the Go of the checkout's tools, as fsm-go-gen does.
build-go: examples-model
.PHONY: examples-model
examples-model:
	mkdir -p packages/go/examples
	cd packages/go && $(KIT_TOOLS)/mise/shims/go tool orm-gen gen --set $(abspath contracts/schema/dbspec-set.json) --lang go --out examples/model --scan ./examples/...
