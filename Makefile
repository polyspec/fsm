# The tools of every run are the releases that the tracked declaration files name: Node.js in .node-version. Each language
# package item adds the declaration of its toolchain (config/toolchain.json).
export PATH := $(CURDIR)/var/tools/bin:$(PATH)

# The shared targets of kit: the gates, the document, owner and commit checks, the toolchains, the layout check and the dependency
# gate. scripts/kit/kit-bootstrap.mk is a copy of the package @polyspec/kit (make kit-sync); it includes the kit.mk of the
# installed package, which runs its built tools ($(KIT)/<tool>.$(KIT_EXT)), and before the package is installed it runs only
# make install-tools TOOLS=npm and make install-packages (S-44). The tools read the configuration in config/*.json.
include scripts/kit/kit-bootstrap.mk

# The test runner of kit: every test target runs its tool through it (AGENTS.md, Rules).
RUN_TESTS := node $(KIT)/run-tests.$(KIT_EXT)

# The targets of the full suite that make check runs through the guard of kit's full-run. Each checklist item appends the
# targets that it defines (docs/plans/fsm-v1.md, Verification).
# The kinds are the implementations of config/parity.json, the one list of the languages of fsm (S-44), so the Makefile cannot
# name a kind that parity lacks. Each kind has test-<kind> (its package tests) as a literal target, added by its package item;
# kit's parity-check runs the vectors of every kind (S-42-1).
KINDS := $(shell node -p "require('./config/parity.json').implementations.map(implementation => implementation.name).join(' ')")

CHECK_TARGETS := kit-check owner-validate documents-check commits-check hooks-check toolchain-check dependency-policy-check layout-check compiler-test gen-check-test gen-check db-test db-test-postgres db-test-mysql npm-persist-test npm-persist-test-postgres npm-persist-test-mysql gui-test npm-types name-test name-check docs-build docs-build-test packages-test gui-browser-test readme-test readme-check python-tools-test make-install-test rust-persist-test go-persist-test-postgres go-persist-test-mysql rust-persist-test-postgres rust-persist-test-mysql php-persist-test-postgres php-persist-test-mysql php-ext-persist-test-postgres php-ext-persist-test-mysql python-persist-test-postgres python-persist-test-mysql python-lock-check workflows-test parity-declarations-check parity-check

.PHONY: go-persist-test-postgres go-persist-test-mysql rust-persist-test-postgres rust-persist-test-mysql php-persist-test-postgres php-persist-test-mysql php-ext-persist-test-postgres php-ext-persist-test-mysql python-persist-test-postgres python-persist-test-mysql check compiler-test gen-check-test gen-check name-test name-check docs-deps docs-build docs-build-test db-deps db-test db-test-postgres db-test-mysql npm-persist-test npm-persist-test-postgres npm-persist-test-mysql gui-deps gui-build gui-test parity-check packages-test test-npm test-go test-php test-rust rust-persist-test npm-types test-python test-php-ext gui-browsers gui-browser-test readme-test readme-check python-tools-test install make-install-test workflows-test






# ---- Package dependencies (docs/plans/fsm-v1.md, Verification; docs/plans/execution-checklist.md, S-29) ------------------------
# A dependency is a file target keyed on the lock or manifest it installs from. A fresh clone installs it once; a later run finds
# the file newer than its lock, runs nothing and needs no network. A target that uses a package names its file as a prerequisite,
# so make installs what that target needs before the target's recipe and nothing else. go and cargo leave no file of their own:
# their stamps are var/deps/go and var/deps/rust. The python environment is keyed on the pylock.toml of packages/python and on the
# Python 3.14 that install-tools installs with mise, whose shim is var/tools/mise/shims/python3 (S-41, S-44-2).
# install builds every dependency, with the toolchains of install-tools. ONLINE marks each download, as it does in kit.mk.
NPM_DEP := packages/js/node_modules/.package-lock.json
PHP_DEP := packages/php/vendor/composer/installed.json
PHP_EXT_DEP := packages/php-ext/vendor/composer/installed.json
PYTHON_BIN := var/tools/mise/shims/python3
PYTHON_DEP := packages/python/.venv/.installed
PYTHON_LOCK := packages/python/pylock.toml
GO_DEP := var/deps/go
RUST_DEP := var/deps/rust
DB_DEP := packages/db/node_modules/.package-lock.json
GUI_DEP := packages/gui/node_modules/.package-lock.json
DOCS_DEP := docs/node_modules/.package-lock.json
PACKAGE_DEPS := $(NPM_DEP) $(PHP_DEP) $(PHP_EXT_DEP) $(PYTHON_DEP) $(GO_DEP) $(RUST_DEP) $(DB_DEP) $(GUI_DEP) $(DOCS_DEP)

$(NPM_DEP): packages/js/package-lock.json
	$(ONLINE) $(MAKE) -C packages/js install

$(PHP_DEP): packages/php/composer.lock packages/php/composer.json config/composer-artifacts.txt
	$(ONLINE) $(MAKE) -C packages/php install
	touch $@

$(PHP_EXT_DEP): packages/php-ext/composer.lock packages/php-ext/composer.json config/composer-artifacts.txt
	$(ONLINE) $(MAKE) -C packages/php-ext install
	touch $@

# The polyspec packages of Composer (orm and ordered-json) are on no registry: their releases publish the zips that
# config/composer-artifacts.txt names, one `<sha256> <url>` per line, and Composer reads them from an artifact repository, the
# folder artifacts/ of each Composer package that its composer.json names. composer-artifacts downloads each zip into DIR and
# checks its sha256 before Composer reads it; the install of each Composer package runs it, and composer.lock records the dist
# of each zip with its shasum. kit K140 brings one tool for a pinned download; it replaces this recipe (S-44-8-1).
.PHONY: composer-artifacts
composer-artifacts:
	@test -n "$(DIR)" || { echo "composer-artifacts: DIR=<folder> names the artifact repository"; exit 2; }
	rm -rf $(DIR) && mkdir -p $(DIR)
	while read -r sum url; do curl --fail --silent --show-error --location --output $(DIR)/$${url##*/} "$$url" && echo "$$sum  $(DIR)/$${url##*/}" | shasum -a 256 -c - || exit 1; done < config/composer-artifacts.txt

$(PYTHON_BIN):
	$(ONLINE) $(MAKE) install-tools

$(PYTHON_DEP): $(PYTHON_LOCK) $(PYTHON_BIN)
	$(ONLINE) $(MAKE) -C packages/python install
	touch $@

$(GO_DEP): packages/go/go.sum
	mkdir -p $(dir $@)
	$(ONLINE) $(MAKE) -C packages/go install
	touch $@

$(RUST_DEP): packages/rust/Cargo.lock
	mkdir -p $(dir $@)
	$(ONLINE) $(MAKE) -C packages/rust install
	touch $@

$(DB_DEP): packages/db/package-lock.json
	cd packages/db && $(ONLINE) npm ci --allow-remote=root --no-audit --no-fund

# The GUI installs after the db packages, because its tests run the db store (order only: a db install does not reinstall the GUI).
$(GUI_DEP): packages/gui/package-lock.json | $(DB_DEP)
	cd packages/gui && $(ONLINE) npm ci --allow-remote=root --no-audit --no-fund

$(DOCS_DEP): docs/package-lock.json
	cd docs && $(ONLINE) npm ci --allow-remote=root --no-audit --no-fund

# install is for a fresh clone and for CI, which runs `make install` once and then `make check`. It installs the toolchains of
# install-tools into var/tools and every package dependency above; a later run downloads nothing.
install: install-tools $(PACKAGE_DEPS)

# check runs the full suite once per committed tree, when no item of docs/plans/execution-checklist.md is [~] (kit's
# full-run); it records its result in var/full-run.json.
check:
	node $(KIT)/full-run.$(KIT_EXT) run $(CHECK_TARGETS)

# commit-msg-check is the check of the commit-msg hook (.githooks/commit-msg): kit's commit check on the message being committed,
# whose file git passes to the hook as MESSAGE.
.PHONY: commit-msg-check
commit-msg-check:
	@test -n "$(MESSAGE)" || { echo "commit-msg-check: MESSAGE is required: the message file that git passes to the commit-msg hook"; exit 2; }
	node $(KIT)/check-commits.$(KIT_EXT) --message $(MESSAGE)

# make-install-test runs the tests of the package dependencies (tests/make-install): a target that needs a dependency installs it
# first, and a present dependency is not installed again (docs/plans/execution-checklist.md, S-29).
make-install-test:
	$(RUN_TESTS) node --results .results/make-install-test.json --inputs Makefile --inputs scripts/kit/kit-bootstrap.mk --inputs config/parity.json --inputs packages --inputs tests/make-install -- tests/make-install

# workflows-test runs the tests of the CI and Pages workflows (.github/workflows): every action is pinned to a verified commit,
# the check job runs make install and make check with the services of plan C-6, and each version comes from the file that
# declares it (docs/plans/fsm-v1.md, C-10; docs/plans/execution-checklist.md, S-21). It reads the workflows as text, offline.
workflows-test:
	$(RUN_TESTS) node --results .results/workflows-test.json --inputs .github/workflows --inputs config/toolchain.json --inputs .node-version --inputs rust-toolchain.toml --inputs packages/go/go.mod --inputs Makefile --inputs docs/plans/fsm-v1.md --inputs tests/workflows -- tests/workflows/workflows.test.mts

# name-test runs the tests of scripts/check-name.mts; name-check fails while a tracked file or path names the library by its old
# outside the allowlist of the checker (docs/plans/execution-checklist.md, S-18; the library is named fsm).
name-test:
	$(RUN_TESTS) node --results .results/name-test.json --inputs scripts/check-name.mts --inputs tests/check-name -- tests/check-name

name-check:
	node scripts/check-name.mts

# readme-test runs the tests of scripts/check-readmes.mts; readme-check requires every declared README pair to have its required
# sections and a Korean twin with the same headings (docs/plans/fsm-v1.md, C-9; docs/plans/execution-checklist.md, S-19).
readme-test:
	$(RUN_TESTS) node --results .results/readme-test.json --inputs scripts/check-readmes.mts --inputs tests/check-readmes -- tests/check-readmes

readme-check:
	node scripts/check-readmes.mts

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
	$(RUN_TESTS) node --timeout 600 --results .results/docs-build-test.json --inputs docs --inputs packages --inputs tests/docs-build --inputs README.md --inputs README.ko.md --inputs AGENTS.md --inputs AGENTS.ko.md --inputs CHANGELOG.md --inputs CHANGELOG.ko.md -- tests/docs-build

# compiler-test runs the tests of packages/compiler, the core validation of a definition (docs/plans/fsm-v1.md, C-5)
# with the editor schema contracts/schema/fsm.schema.json, which the tests check against the core.
compiler-test:
	$(RUN_TESTS) node --results .results/compiler-test.json --inputs packages/compiler --inputs contracts -- packages/compiler/tests

# gen-check-test runs the tests of scripts/gen-check.mts; gen-check regenerates the generated files into var/gen-check and
# requires them to equal the working tree (docs/plans/fsm-v1.md, C-5).
gen-check-test:
	$(RUN_TESTS) node --results .results/gen-check-test.json --inputs scripts/gen-check.mts --inputs tests/gen-check -- tests/gen-check

gen-check: $(NPM_DEP) $(GO_DEP) $(PHP_DEP) $(PHP_EXT_DEP) $(PYTHON_DEP)
	node scripts/gen-check.mts

# db-test-postgres and db-test-mysql run the DB store tests on the server dialects that the documents name (docs/plans/fsm-v1.md, C-6):
# db-store.test.mjs and store-contract-all.test.mjs, which open the database of FSM_TEST_PG_DSN or FSM_TEST_MYSQL_DSN through the dialect
# helper of tests/dialect.mjs. The DSN names the server and its user; a missing DSN fails the target and never skips it. The CLI and
# command tests (cli.test.mjs, command.test.mjs) run on the same dialect with an empty database of their own, which the admin DSN
# (FSM_TEST_PG_ADMIN_DSN, FSM_TEST_MYSQL_ADMIN_DSN) creates and drops (docs/plans/fsm-v1.md, C-6; docs/plans/execution-checklist.md,
# S-37-2). The files share the server, so they run one after the other.
DB_DIALECT_TESTS := packages/db/tests/db-store.test.mjs packages/db/tests/store-contract-all.test.mjs packages/db/tests/cli.test.mjs packages/db/tests/command.test.mjs
db-test-postgres: $(DB_DEP)
	@$(call require_dsn,FSM_TEST_PG_DSN)
	@$(call require_dsn,FSM_TEST_PG_ADMIN_DSN)
	FSM_TEST_DIALECT=postgres $(RUN_TESTS) node --results .results/db-test-postgres.json --inputs packages/db/src --inputs packages/db/tests --inputs packages/db/package.json --inputs packages/db/package-lock.json --inputs packages/db/schema --inputs packages/compiler -- --test-concurrency=1 $(DB_DIALECT_TESTS)

db-test-mysql: $(DB_DEP)
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	@$(call require_dsn,FSM_TEST_MYSQL_ADMIN_DSN)
	FSM_TEST_DIALECT=mysql $(RUN_TESTS) node --results .results/db-test-mysql.json --inputs packages/db/src --inputs packages/db/tests --inputs packages/db/package.json --inputs packages/db/package-lock.json --inputs packages/db/schema --inputs packages/compiler -- --test-concurrency=1 $(DB_DIALECT_TESTS)

# db-deps installs the packages of packages/db (orm and ordered-json from their release tarballs, pinned in its
# package-lock.json). db-test runs the tests of packages/db: the DB store against the store contract, the round trips
# of json and db, the atomicity of save, the CLI, and the generated models, which orm-gen must reproduce from packages/db/schema/fsm.dbs
# (docs/plans/fsm-v1.md, C-6).
db-deps: $(DB_DEP)

db-test: $(DB_DEP)
	$(RUN_TESTS) node --results .results/db-test.json --inputs packages/db/src --inputs packages/db/tests --inputs packages/db/package.json --inputs packages/db/package-lock.json --inputs packages/db/schema --inputs packages/compiler -- packages/db/tests

# gui-deps installs the packages of packages/gui (hyper v0.0.13, crudui v0.0.5, the template v0.0.5, mermaid, htmx and
# yaml, pinned in its package.json and package-lock.json; docs/plans/fsm-v1.md, C-1). The db store of the GUI is the one of
# packages/db, whose orm packages db-deps installs first.
gui-deps: $(GUI_DEP)

# gui-build builds the browser assets of the GUI with the hyper v0.0.13 asset build: the templates, the client bundle that holds
# mermaid, build/templates.index.json and build/manifest.json (docs/plans/fsm-v1.md, C-7). gui-test runs it first. The crudui
# stylesheet is copied into public/assets and given to the build with --static, which puts it in the static deployment (the way
# hyper-build-assets takes the stylesheets that the layouts link); the layout links it as /assets/crudui.css (S-22-2).
gui-build: $(GUI_DEP)
	cd packages/gui && mkdir -p public/assets && cp node_modules/@polyspec/crudui-generator-core/styles/crudui.css public/assets/crudui.css && node_modules/.bin/hyper-build-assets --app . --api /api --output build --static public/assets/crudui.css

# gui-test runs the tests of packages/gui (docs/plans/fsm-v1.md, C-7): the handlers and the server entry through the
# built application, the store selection and the pinned Mermaid parse test. The compiler sources are inputs of the GUI. The
# browser test is in tests/browser and runs with gui-browser-test, so gui-test takes the test files of tests/ only.
gui-test: gui-build $(DB_DEP)
	$(RUN_TESTS) node --results .results/gui-test.json --inputs packages/gui --inputs packages/compiler/src --inputs packages/db -- $(wildcard packages/gui/tests/*.test.mjs)

# GUI_BROWSERS is the stamp of the Chromium that the GUI browser test drives, keyed on the Playwright version that
# packages/gui/package-lock.json pins (devDependency, exact). A new version is a new stamp, so it downloads once; a later run
# with the stamp present downloads nothing (docs/plans/execution-checklist.md, S-29-1). The download comes from the Playwright CDN,
# so it is ONLINE; the browser goes into the user's Playwright cache and no tracked file changes (docs/plans/fsm-v1.md, C-7).
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
# (docs/plans/execution-checklist.md, S-22-1 and S-22-2). It needs the browser of gui-browsers and the built assets of gui-build.
gui-browser-test: $(GUI_BROWSERS) gui-build $(DB_DEP)
	$(RUN_TESTS) node --timeout 120 --results .results/gui-browser-test.json --inputs packages/gui --inputs packages/compiler/src --inputs packages/db -- packages/gui/tests/browser/browser.test.mjs packages/gui/tests/browser/diagram.test.mjs

# packages-test runs the test of every kind with make -j6 (docs/plans/fsm-v1.md, Verification). It refuses an empty kind list,
# because make with no goal would run the default goal, check, from inside check.
packages-test:
	$(if $(KINDS),,$(error config/parity.json declares no kind))
	$(MAKE) -j6 $(addprefix test-,$(KINDS))

# test-npm runs the tests of packages/js: the conformance cases and the persist example (docs/plans/fsm-v1.md, C-2).
test-npm: $(NPM_DEP)
	$(MAKE) -C packages/js test

# npm-persist-test runs the persist cases of packages/js on a dialect: the persist vector cases of tests/conformance.test.mjs and
# tests/persist.test.mjs, whose two transitions of one row give one Changed and one Unchanged or one E_CONFLICT, and whose
# deadlock runs the transaction again while another database error does not (docs/spec/fsm.md, B-4; docs/plans/fsm-v1.md, C-4).
# The three targets run them on each dialect: sqlite (a temporary file), postgres (FSM_TEST_PG_DSN) and mysql (FSM_TEST_MYSQL_DSN).
# The two files run one after the other: on a server dialect they share the persist table, which each case clears.
NPM_PERSIST_TESTS := --test-concurrency=1 --test-name-pattern=persist packages/js/tests/conformance.test.mjs packages/js/tests/persist.test.mjs
npm-persist-test: $(NPM_DEP) $(DB_DEP)
	FSM_TEST_DIALECT=sqlite $(RUN_TESTS) node --results .results/npm-persist-test.json --inputs packages/js --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json --inputs packages/db/tests/dialect.mjs --inputs packages/db/src/models -- $(NPM_PERSIST_TESTS)

npm-persist-test-postgres: $(NPM_DEP) $(DB_DEP)
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres $(RUN_TESTS) node --results .results/npm-persist-test-postgres.json --inputs packages/js --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json --inputs packages/db/tests/dialect.mjs --inputs packages/db/src/models -- $(NPM_PERSIST_TESTS)

npm-persist-test-mysql: $(NPM_DEP) $(DB_DEP)
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql $(RUN_TESTS) node --results .results/npm-persist-test-mysql.json --inputs packages/js --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json --inputs packages/db/tests/dialect.mjs --inputs packages/db/src/models -- $(NPM_PERSIST_TESTS)

# npm-types runs tests/npm-types: tsc compiles tests/npm-types/consumer.ts against the generated
# declarations in strict mode, so a wrong declaration fails (docs/plans/execution-checklist.md, S-09-2). It is a tool test with
# its own record, so the conformance test of the npm kind holds only vector cases for kit's parity check.
npm-types: $(NPM_DEP)
	$(RUN_TESTS) node --results .results/npm-types.json --inputs packages/js -- tests/npm-types


# test-go runs the tests of packages/go: the conformance cases and the persist example (docs/plans/fsm-v1.md, C-2).
test-go: $(GO_DEP)
	$(MAKE) -C packages/go test

# test-php runs the tests of packages/php: the conformance cases and the persist example (docs/plans/fsm-v1.md, C-2).
test-php: $(PHP_DEP)
	$(MAKE) -C packages/php test
# test-rust runs the tests of packages/rust: the conformance cases and the persist example (docs/plans/fsm-v1.md, C-2).
test-rust: $(RUST_DEP)
	$(MAKE) -C packages/rust test
# rust-persist-test runs tests/persist.rs of packages/rust on sqlite: two transitions of one row at the same time, and a deadlock
# runs the persistence transaction again while another database error does not (docs/spec/fsm.md, B-4; S-31, S-44-9).
rust-persist-test: $(RUST_DEP)
	$(RUN_TESTS) cargo --results .results/rust-persist-test.json --inputs packages/rust --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- --manifest-path packages/rust/Cargo.toml --test persist
# python-tools-test runs the tests of the Python of the checkout (tests/python-tools, S-41): the interpreter var/tools/mise/shims/python3
# is made by install-tools, no recipe installs an interpreter with uv, there is no install-python target, and config/toolchain.json
# declares the pythonBuild. It runs make -n on a copy of the Makefile, with no network and nothing installed.
python-tools-test:
	$(RUN_TESTS) node --results .results/python-tools-test.json --inputs Makefile --inputs config/parity.json --inputs scripts/kit/kit-bootstrap.mk --inputs config/toolchain.json --inputs packages/python/Makefile --inputs tests/python-tools -- tests/python-tools

# test-python runs the tests of packages/python: the conformance cases and the persist example, offline, with the Python 3.14
# venv of `make -C packages/python install` (docs/plans/fsm-v1.md, C-2).
test-python: $(PYTHON_DEP)
	$(MAKE) -C packages/python test

# test-php-ext builds the extension of packages/php-ext and runs its tests: the conformance cases and the persist example
# (docs/plans/fsm-v1.md, C-2).
test-php-ext: $(PHP_EXT_DEP)
	$(MAKE) -C packages/php-ext test

# ---- Persist cases on the server dialects (docs/spec/fsm.md, B-4; docs/plans/fsm-v1.md, C-6; docs/plans/execution-checklist.md, S-37-1)
# Each kind runs its persist cases on PostgreSQL and MySQL with the DSN variables of npm (FSM_TEST_PG_DSN, FSM_TEST_MYSQL_DSN). The
# test selects the dialect with FSM_TEST_DIALECT and fails when its DSN is empty; require_dsn makes the target itself stop first
# with exit 2, so a missing DSN is a failed target and never a skipped dialect. The persist cases of sqlite run in test-<kind>.
define require_dsn
test -n "$${$(1)}" || { echo "$@ needs $(1): a server dialect never skips (docs/plans/fsm-v1.md, C-6)" >&2; exit 2; }
endef

go-persist-test-postgres: $(GO_DEP)
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres GOPROXY=off $(RUN_TESTS) go --cwd packages/go --results .results/go-persist-test-postgres.json --inputs packages/go --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- ./tests -run 'TestConformance/test_persist__|TestPersist'

go-persist-test-mysql: $(GO_DEP)
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql GOPROXY=off $(RUN_TESTS) go --cwd packages/go --results .results/go-persist-test-mysql.json --inputs packages/go --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- ./tests -run 'TestConformance/test_persist__|TestPersist'

rust-persist-test-postgres: $(RUST_DEP)
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres $(RUN_TESTS) cargo --results .results/rust-persist-test-postgres.json --inputs packages/rust --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- --manifest-path packages/rust/Cargo.toml --test conformance --test persist persist

rust-persist-test-mysql: $(RUST_DEP)
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql $(RUN_TESTS) cargo --results .results/rust-persist-test-mysql.json --inputs packages/rust --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- --manifest-path packages/rust/Cargo.toml --test conformance --test persist persist

php-persist-test-postgres: $(PHP_DEP)
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres $(RUN_TESTS) phpunit --cwd packages/php --results .results/php-persist-test-postgres.json --inputs packages/php --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- tests --filter '/persist/i'

php-persist-test-mysql: $(PHP_DEP)
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql $(RUN_TESTS) phpunit --cwd packages/php --results .results/php-persist-test-mysql.json --inputs packages/php --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- tests --filter '/persist/i'

php-ext-persist-test-postgres: $(PHP_EXT_DEP)
	@$(call require_dsn,FSM_TEST_PG_DSN)
	$(MAKE) -C packages/php-ext build
	FSM_TEST_DIALECT=postgres $(RUN_TESTS) phpunit --php-extension packages/php-ext/src/modules/polyspec_fsm_test.so --cwd packages/php-ext --results .results/php-ext-persist-test-postgres.json --inputs packages/php-ext --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- tests --filter '/persist/i'

php-ext-persist-test-mysql: $(PHP_EXT_DEP)
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	$(MAKE) -C packages/php-ext build
	FSM_TEST_DIALECT=mysql $(RUN_TESTS) phpunit --php-extension packages/php-ext/src/modules/polyspec_fsm_test.so --cwd packages/php-ext --results .results/php-ext-persist-test-mysql.json --inputs packages/php-ext --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- tests --filter '/persist/i'

python-persist-test-postgres: $(PYTHON_DEP)
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres $(RUN_TESTS) python --venv packages/python/.venv --results .results/python-persist-test-postgres.json --inputs packages/python --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- discover -s packages/python/tests -t packages/python/tests -k persist

python-persist-test-mysql: $(PYTHON_DEP)
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql $(RUN_TESTS) python --venv packages/python/.venv --results .results/python-persist-test-mysql.json --inputs packages/python --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- discover -s packages/python/tests -t packages/python/tests -k persist
