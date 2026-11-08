# The recipes of fsm. Every target that this repository runs, from its own recipes, its CI workflows, its Git hooks and its
# documents, is written in this Makefile; kit includes no recipe (kit docs/spec/utilities-and-recipes.md, S-424). A recipe of a
# shared tool runs a utility of the installed package @polyspec/kit with explicit arguments: node $(KIT)/<utility>.$(KIT_EXT).
# The utilities read the configuration of fsm in config/*.json.
#
# KIT is the folder of those utilities. It is read each time a recipe expands it, so a run follows an npm ci that replaces the
# package in the middle of it: the sources scripts/kit/*.mts of the kit checkout that node_modules/@polyspec/kit links during
# 0.0.x development (node strips their types outside node_modules), or the dist/*.mjs of the packed release that npm ci
# installs. A packed release holds no scripts/kit/run-tests.mts.
KIT_PACKAGE := node_modules/@polyspec/kit
kit-linked = $(wildcard $(KIT_PACKAGE)/scripts/kit/run-tests.mts)
KIT = $(realpath $(KIT_PACKAGE)/$(if $(kit-linked),scripts/kit,dist))
KIT_EXT = $(if $(kit-linked),mts,mjs)
# ONLINE marks each recipe that downloads.
ONLINE ?=

# The tools of every run are the releases that the tracked declaration files name: Node.js and the other tools of mise.toml at
# the digests of mise.lock, which make install-tools installs into the checkout's own var/tools, a worktree's too. The shims
# of mise run mise, which reads its folders and the mise.toml of this checkout from the variables below; var/tools/bin (node,
# npm, mise and the wrappers of the Composer projects) and the shims come first on PATH, and a recipe starts a tool by its
# absolute path. Each language package item adds the declaration of its toolchain (config/toolchain.json).
KIT_TOOLS := $(CURDIR)/var/tools
export MISE_DATA_DIR := $(KIT_TOOLS)/mise
export MISE_CACHE_DIR := $(KIT_TOOLS)/mise/cache
export MISE_STATE_DIR := $(KIT_TOOLS)/mise/state
export MISE_CONFIG_DIR := $(KIT_TOOLS)/mise/config
export MISE_GLOBAL_CONFIG_FILE := $(CURDIR)/mise.toml
# mise install records the trust of the root of the global config, the home folder unless this names the checkout.
export MISE_GLOBAL_CONFIG_ROOT := $(CURDIR)
MISE_ENVIRONMENT := MISE_DATA_DIR MISE_CACHE_DIR MISE_STATE_DIR MISE_CONFIG_DIR MISE_GLOBAL_CONFIG_FILE MISE_GLOBAL_CONFIG_ROOT
# kit 0.0.98's run-tests dropped NODE_TEST_CONTEXT, so a node --test that a recipe starts from inside a node test runs as
# its own run, not as a child of that test (kit K1094); no recipe passes it on.
unexport NODE_TEST_CONTEXT
export PATH := $(KIT_TOOLS)/bin:$(KIT_TOOLS)/mise/shims:$(PATH)
NODE := $(KIT_TOOLS)/bin/node
NPM := $(KIT_TOOLS)/bin/npm
ALINT := $(KIT_TOOLS)/mise/shims/alint

# The test runner of kit: every test target runs its tool through it (AGENTS.md, Rules).
RUN_TESTS = node $(KIT)/run-tests.$(KIT_EXT)

# ---- Tools and packages ----------------------------------------------------------------------------------------------
# The bootstrap order of a checkout: the mise, node and npm of mise.toml (install-tools TOOLS=npm), the packages of
# package-lock.json with that npm, @polyspec/kit included (install-packages), every other tool of mise.toml (install-tools), and
# the declared symbol extractors of config/toolchain.json (kit-install-declared). install-kit runs them in that order; make
# install adds the package dependencies of fsm and then the links. Each of them downloads, so it runs ONLINE.
.PHONY: install-kit install-tools install-packages install-link kit-install-declared kit-install-symbols toolchain-lock
install-kit:
	$(MAKE) --no-print-directory install-tools TOOLS=npm
	$(MAKE) --no-print-directory install-packages
	$(MAKE) --no-print-directory install-tools
	$(MAKE) --no-print-directory kit-install-declared

# The home and the cache of the Composer that install-tools and install-symbols run, the folders of var/tools that kit 0.0.98
# set (kit K1095).
COMPOSER_TOOL_ENV = COMPOSER_HOME=$(CURDIR)/var/tools/composer/home COMPOSER_CACHE_DIR=$(CURDIR)/var/tools/composer/cache
# TOOLS=npm runs the bootstrap of kit, which imports only the built-ins of Node.js, with the node of the machine: it installs the
# node of var/tools. Any other TOOLS names tools of mise.toml; without TOOLS every tool is installed.
install-tools:
ifeq ($(TOOLS),npm)
	$(ONLINE) node $(KIT)/bootstrap/bootstrap.$(KIT_EXT)
else
	$(COMPOSER_TOOL_ENV) $(ONLINE) $(NODE) $(KIT)/install-tools.$(KIT_EXT) --no-self-update $(TOOLS)
endif

# npm ci of the root lock as it is; npm reads allow-remote=root of .npmrc, since package.json pins @polyspec/kit by the URL of its
# release asset.
install-packages:
	$(ONLINE) $(NPM) ci

# The links of 0.0.x development (.links of the main checkout, kit docs/operations/local-links.md): make install links after every
# install, and CI, which has no .links, links nothing. PROJECT and RUNTIME select the project and the runtime.
install-link:
	$(NODE) $(KIT)/link.$(KIT_EXT) link$(if $(PROJECT), --project $(PROJECT))$(if $(RUNTIME), --runtime $(RUNTIME))

kit-install-declared:
	$(COMPOSER_TOOL_ENV) $(ONLINE) $(NODE) $(KIT)/install-symbols.$(KIT_EXT) --declared

kit-install-symbols:
	$(COMPOSER_TOOL_ENV) $(ONLINE) $(NODE) $(KIT)/install-symbols.$(KIT_EXT) $(EXTRACTORS)

# toolchain-lock writes mise.lock with mise lock for each platform that has the archives of the tools. mise locks a pypi: tool
# with uv, which takes the first uv on PATH and a managed Python of the home before PATH, so mise first locks and installs uv and
# python, and the full lock names that Python as UV_PYTHON.
TOOLCHAIN_LOCK_PLATFORMS := linux-x64,linux-arm64,macos-arm64,macos-x64,windows-x64,windows-arm64
toolchain-lock:
	@test -x $(KIT_TOOLS)/bin/mise || { echo "[toolchain-lock] $(KIT_TOOLS)/bin/mise is missing; run make install-tools TOOLS=npm" >&2; exit 1; }
	$(ONLINE) $(KIT_TOOLS)/bin/mise lock uv python --global --platform $(TOOLCHAIN_LOCK_PLATFORMS)
	$(ONLINE) $(KIT_TOOLS)/bin/mise install --locked uv python
	UV_PYTHON="$$($(KIT_TOOLS)/bin/mise which python3)" $(ONLINE) $(KIT_TOOLS)/bin/mise lock --global --platform $(TOOLCHAIN_LOCK_PLATFORMS)

# python-venv makes the virtual environment DIR from the python3 of mise.toml with uv venv; a venv of that Python is kept.
.PHONY: python-venv
python-venv:
	@test -n "$(DIR)" || { echo "python-venv: DIR is required, for example make python-venv DIR=packages/python/.venv"; exit 1; }
	$(NODE) $(KIT)/python-venv.$(KIT_EXT) $(DIR)

# ---- Links and worktrees ---------------------------------------------------------------------------------------------
.PHONY: link link-check unlink worktree-setup land
link:
	$(NODE) $(KIT)/link.$(KIT_EXT) link$(if $(PROJECT), --project $(PROJECT))$(if $(RUNTIME), --runtime $(RUNTIME))

link-check:
	$(NODE) $(KIT)/link-check.$(KIT_EXT)$(if $(PROJECT), --project $(PROJECT))

unlink:
	$(NODE) $(KIT)/link.$(KIT_EXT) unlink$(if $(PROJECT), --project $(PROJECT))$(if $(RUNTIME), --runtime $(RUNTIME))

# The worktree of a row (kit K1107), as kit 0.0.98 made it: ../<main checkout>-<NAME>-<ID> on <TYPE or fix>/<NAME>-<ID> from main;
# a worktree without node_modules first gets npm ci of the npm of var/tools, then make install and make link-check run in it. The
# worktree runs its own tools in a make of its own (kit K858): the recipe drops the flags of this make and this var/tools from PATH.
WORKTREE_MAIN = $(patsubst %/.git,%,$(shell git rev-parse --path-format=absolute --git-common-dir))
WORKTREE_DECLARATION = --folder $(WORKTREE_MAIN)-$(NAME)-$(ID) --branch $(or $(TYPE),fix)/$(NAME)-$(ID) --base main --prepare 'test -d node_modules || PATH="$(KIT_TOOLS)/bin:$$PATH" $(NPM) ci --ignore-scripts' --make install --make link-check
WORKTREE_ENVIRONMENT = env -u MAKEFLAGS -u MFLAGS -u MAKELEVEL PATH="$$(printf '%s' "$$PATH" | awk -v RS=: -v ORS=: -v tools='$(KIT_TOOLS)' 'index($$0, tools) != 1' | sed 's/:$$//')"
# worktree-setup creates or reuses the worktree of a row from main, runs make install and make link-check in it.
worktree-setup:
	$(ONLINE) $(WORKTREE_ENVIRONMENT) $(NODE) $(KIT)/worktree-setup.$(KIT_EXT) $(WORKTREE_DECLARATION)

# land merges the branch BRANCH into main fast-forward after the static gates of kit-gates that its changed paths select.
land:
	$(NODE) $(KIT)/land.$(KIT_EXT) $(BRANCH) main

# ---- Git hooks and merge drivers -------------------------------------------------------------------------------------
# The hooks of fsm are its own files under .githooks, which HOOK_DECLARATION lists: pre-commit runs staged-generated-hook
# and commit-msg runs commit-msg-hook. make hooks points core.hooksPath at .githooks, makes each listed hook executable and
# declares the merge drivers of the changelogs and checklists, which git runs as make twin-merge.
.PHONY: hooks hooks-check staged-generated-hook commit-msg-hook twin-merge
# The declaration of make hooks (kit K1099): the hooks pre-commit and commit-msg of .githooks,
# the merges of the changelogs and checklists (kit K354) and their drivers, which run twin-merge of this checkout.
TWIN_MERGE_DRIVER := make --no-print-directory twin-merge MERGE="%O %A %B %P"
HOOK_DECLARATION := --hooks-path .githooks --hook pre-commit --hook commit-msg --merge 'CHANGELOG.md=kit-changelog' --merge 'CHANGELOG.ko.md=kit-twin' \
	--merge 'docs/plans/*/checklist.md=kit-checklist' --merge 'docs/plans/*/checklist.ko.md=kit-twin' \
	--driver 'kit-twin=$(TWIN_MERGE_DRIVER)' --driver 'kit-changelog=$(TWIN_MERGE_DRIVER)' --driver 'kit-checklist=$(TWIN_MERGE_DRIVER)'
hooks:
	$(NODE) $(KIT)/git-hooks.$(KIT_EXT) install $(HOOK_DECLARATION)

hooks-check:
	$(NODE) $(KIT)/git-hooks.$(KIT_EXT) check $(HOOK_DECLARATION)

staged-generated-hook:
	$(NODE) $(KIT)/generated-files.$(KIT_EXT) staged --binary ELF --binary Mach-O --binary PE

commit-msg-hook:
	$(NODE) $(KIT)/check-commits.$(KIT_EXT) --message $(MESSAGE) --rules commit-ai-footer,commit-ai-identity

twin-merge:
	@$(NODE) $(KIT)/twin-merge.$(KIT_EXT) $(MERGE)

# ---- Plans, commits and documents ------------------------------------------------------------------------------------
.PHONY: plan-new plan-split item-new item-edit item-state item-test commit documents-stamp text-absent
# The texts of a row reach the utility unexpanded: each text that is set is passed as its raw value ($(value)), in single quotes,
# so a text that names a make or shell variable is stored as written, and an unset text stays unset.
raw_text = $(foreach v,$(1),$(if $(filter undefined,$(origin $(v))),,$(v)='$(subst ','\'',$(value $(v)))'))

plan-new:
	NAME_PATTERN='^[a-z][a-z0-9-]*$$' $(NODE) $(KIT)/plan.$(KIT_EXT) plan-new

plan-split:
	$(NODE) $(KIT)/plan.$(KIT_EXT) plan-split

item-new:
	$(call raw_text,TASK TASK_KO DELIVERABLES VERIFICATION) $(NODE) $(KIT)/plan.$(KIT_EXT) item-new

item-edit:
	$(call raw_text,TASK TASK_KO DELIVERABLES VERIFICATION CAUSE RETRY CAUSE_KO RETRY_KO) DONE_STAYS=1 $(NODE) $(KIT)/plan.$(KIT_EXT) item-edit

item-state:
	$(NODE) $(KIT)/plan.$(KIT_EXT) item-state

item-test:
	$(NODE) $(KIT)/plan.$(KIT_EXT) item-test

commit:
	$(NODE) $(KIT)/plan.$(KIT_EXT) commit

documents-stamp:
	$(NODE) $(KIT)/documents-stamp.$(KIT_EXT) $(PATHS)

# FILE and TEXT reach the utility through its environment, unexpanded, since a stale text may hold a backquote, a $ or a quote.
unexport TEXT
text-absent: export KIT_TEXT_ABSENT_FILE = $(value FILE)
text-absent: export KIT_TEXT_ABSENT_TEXT = $(value TEXT)
text-absent:
	$(NODE) $(KIT)/text-absent.$(KIT_EXT)

# ---- Checks ----------------------------------------------------------------------------------------------------------
.PHONY: layout-check docs-check rules-check owner-check owner-validate rebuild-check language-check duplication-check suppression-check
# alint checks the tree against config/layout.yml, which extends config/layout.kit.yml, the common layout rules that fsm took from
# kit, with the map of fsm; then Git must ignore each install folder and track no generated file.
layout-check:
	@test -x $(ALINT) || { echo "layout-check: $(ALINT) is missing; run make install-tools"; exit 1; }
	$(ALINT) check --config config/layout.yml --color never --compact .
	$(NODE) $(KIT)/generated-files.$(KIT_EXT) installs var package.json=node_modules pyproject.toml=.venv composer.json=vendor
	$(NODE) $(KIT)/generated-files.$(KIT_EXT) tracked --binary ELF --binary Mach-O --binary PE

docs-check:
	$(NODE) $(KIT)/check-documents.$(KIT_EXT) --checklist-place --private-path /Users/ --private-path /home/ --kit-rows

rules-check:
	$(NODE) $(KIT)/check-rules.$(KIT_EXT)

owner-check:
	$(NODE) $(KIT)/owner-check.$(KIT_EXT) --every-path $(if $(PATHS),--paths "$(PATHS)") $(if $(BASE),--base $(BASE))

owner-validate:
	$(NODE) $(KIT)/owner-check.$(KIT_EXT) --every-path --validate

# The tool sources of rebuild-check, the values that kit 0.0.98 fixed (kit K1080): the scripts and generators, each glob quoted.
REBUILD_SOURCES := --source 'scripts/**/*.{mts,mjs,cjs,js,ts,py,php,sh,mk}' --source 'packages/*/{scripts,tools,bin}/**/*.{mts,mjs,cjs,js,ts,py,php,sh,mk}' --source 'packages/*/*/{scripts,tools,bin}/**/*.{mts,mjs,cjs,js,ts,py,php,sh,mk}' --source '**/*_generate.go' --source '**/*.generate.{mts,mjs,cjs,js,ts,py,php,sh,mk}' --source 'benchmarks/**/*.{mts,mjs,cjs,js,ts,py,php,sh,mk}' --source 'examples/**/*.{mts,mjs,cjs,js,ts,py,php,sh,mk}' --source 'tests/fixtures/*/generate.*'
# The files among the sources that are no tool source (kit K1080): the .d.ts declarations and the tests.
REBUILD_EXCLUDES := --exclude '**/*.d.ts' --exclude '*/**/{test,tests}/**' --exclude 'test/**' --exclude 'tests/**/{*_generate.go,*.generate.*}' --exclude '**/*.{test,spec}.{js,jsx,ts,tsx,cjs,cts,mjs,mts}' --exclude '**/{*_test.go,test_*.py,*_test.py,*Test.php}'
rebuild-check:
	$(NODE) $(KIT)/rebuild-check.$(KIT_EXT) $(REBUILD_SOURCES) $(REBUILD_EXCLUDES)

language-check:
	$(NODE) $(KIT)/language-check.$(KIT_EXT) --forbid '\p{Script=Hangul}'

duplication-check:
	$(NODE) $(KIT)/duplication-check.$(KIT_EXT)

suppression-check:
	$(NODE) $(KIT)/suppression-check.$(KIT_EXT)

# ---- Lint ------------------------------------------------------------------------------------------------------------
# Each lint utility runs the tools of var/tools or of the kit package, and each tool reads the configuration of fsm by its own
# discovery: .oxlintrc.json and knip.jsonc, ruff.toml and [tool.vulture] of packages/python/pyproject.toml, phpcs.xml.dist and
# phpstan.dist.neon, .golangci.yml, and clippy.toml with the [workspace.lints] of packages/rust/Cargo.toml.
.PHONY: lint-ts lint-php lint-python lint-go lint-rust lint-php-ext
# lint-ts reads the packages of every npm folder, docs/.vitepress/config.mts among them, and the generated TypeScript, so it
# takes the setup of the ts runtime of config/ci.json first, as CI does (S-439).
lint-ts: deps-node fsm-js-gen
	$(NODE) $(KIT)/lint-ts.$(KIT_EXT)

lint-php:
	$(NODE) $(KIT)/lint-php.$(KIT_EXT) --memory-limit=-1

lint-python:
	$(NODE) $(KIT)/lint-python.$(KIT_EXT)

lint-go:
	$(NODE) $(KIT)/lint-go.$(KIT_EXT)

lint-rust:
	$(NODE) $(KIT)/lint-rust.$(KIT_EXT) --locked

lint-php-ext:
	$(NODE) $(KIT)/php-extension.$(KIT_EXT) check --extension packages/php-ext --build-dir var/php-ext --skip vendor --skip node_modules --library packages/php

# ---- Build and test of the runtimes ----------------------------------------------------------------------------------
# The tasks of each runtime that packages/ holds: runtime-targets runs the build or the unit tests of each package of the runtime
# with the tools of its ecosystem; CASES=<pattern> is the name filter of its runner. fsm adds its own steps to a task as
# prerequisites (test-go: fsm-go-test). The PHP extension builds with phpize into $(PHP_EXT_MODULE).
.PHONY: build test lint build-go build-js build-php build-python build-rust build-php-ext test-go test-js test-php test-python test-rust test-php-ext
# build, test and lint run the target of each runtime of packages/ (go, js, php, php-ext, python, rust); the lint of the
# JavaScript package is lint-ts (kit K1106).
build:
	$(MAKE) --no-print-directory build-go build-js build-php build-php-ext build-python build-rust
test:
	$(MAKE) --no-print-directory test-go test-js test-php test-php-ext test-python test-rust
lint:
	$(MAKE) --no-print-directory lint-go lint-php lint-php-ext lint-python lint-rust lint-ts

# The JavaScript and PHP packages have no build step. The runner arguments are those that kit 0.0.98 passed (kit K1094, K1106):
# go -count=1 -timeout=0, one test at a time in node and cargo, and the 30 s test timeout of node.
build-go:
	$(NODE) $(KIT)/runtime-targets.$(KIT_EXT) build --roots packages/go -- $(GO) build ./...
build-js build-php:
build-python:
	$(NODE) $(KIT)/runtime-targets.$(KIT_EXT) build --roots packages/python -- $(UV) build
build-rust:
	$(NODE) $(KIT)/runtime-targets.$(KIT_EXT) build --roots packages/rust -- cargo build --locked

test-go:
	$(NODE) $(KIT)/runtime-targets.$(KIT_EXT) test --runner go --roots packages/go -- -count=1 -timeout=0
test-js:
	$(NODE) $(KIT)/runtime-targets.$(KIT_EXT) test --runner node --roots packages/js -- --test-timeout=30000 --test-concurrency=1
test-php:
	$(NODE) $(KIT)/runtime-targets.$(KIT_EXT) test --runner php --roots packages/php
test-python:
	PYTHONUNBUFFERED=1 NO_COLOR=1 PYTHON_COLORS=0 $(NODE) $(KIT)/runtime-targets.$(KIT_EXT) test --runner python --roots packages/python --venv .venv
test-rust:
	$(NODE) $(KIT)/runtime-targets.$(KIT_EXT) test --runner cargo --roots packages/rust -- -- --test-threads=1

build-php-ext:
	$(ONLINE) $(NODE) $(KIT)/php-extension.$(KIT_EXT) build --extension packages/php-ext --build-dir var/php-ext --skip vendor --skip node_modules --library packages/php

test-php-ext: build-php-ext
	$(NODE) $(KIT)/php-extension.$(KIT_EXT) test --extension packages/php-ext --build-dir var/php-ext --skip vendor --skip node_modules --library packages/php -- --roots packages/php

# ---- CI --------------------------------------------------------------------------------------------------------------
# kit-gates is every gate of fsm, and land runs those of them that the changed paths of a branch select. The CI pipeline
# (.github/workflows/ci-pipeline.yml) runs its partitions, each in a job that installs only what it needs; kit-gates-static runs
# past failures, so one run names every static gate that fails.
.PHONY: kit-gates kit-gates-static kit-gates-runtime-ts kit-gates-runtime-php kit-gates-runtime-python kit-gates-runtime-go kit-gates-runtime-rust kit-gates-runtime-php-ext
KIT_STATIC_GATES := layout-check docs-check rules-check owner-validate rebuild-check language-check duplication-check suppression-check
KIT_GATE_TARGETS := $(KIT_STATIC_GATES) lint-ts lint-php lint-python lint-go lint-rust lint-php-ext test-php-ext
kit-gates: $(KIT_GATE_TARGETS)

ifneq ($(filter kit-gates-static,$(MAKECMDGOALS)),)
MAKEFLAGS += -k
endif
kit-gates-static: $(KIT_STATIC_GATES)
	@echo "[kit-gates-static] every shared gate passed"
kit-gates-runtime-ts: lint-ts
kit-gates-runtime-php: lint-php
kit-gates-runtime-python: lint-python
kit-gates-runtime-go: lint-go
kit-gates-runtime-rust: lint-rust
kit-gates-runtime-php-ext: lint-php-ext test-php-ext

# The plan, the setup and the context of the jobs of the CI pipeline, from config/ci.json.
.PHONY: kit-ci-plan kit-ci-setup kit-ci-context-prepare kit-ci-context-cleanup ci-targets ci-summary
kit-ci-plan:
	$(NODE) $(KIT)/ci-setup.$(KIT_EXT) --plan

kit-ci-setup:
	$(NODE) $(KIT)/ci-setup.$(KIT_EXT) --setup $(GROUP) $(RUNTIME)

kit-ci-context-prepare:
	$(NODE) $(KIT)/ci-setup.$(KIT_EXT) --context-prepare $(GROUP) $(RUNTIME)

kit-ci-context-cleanup:
	$(NODE) $(KIT)/ci-setup.$(KIT_EXT) --context-cleanup $(GROUP) $(RUNTIME)

# ci-targets runs TARGETS past failures and writes the report CI_REPORT (logs, record.json, summary.md).
CI_REPORT ?= var/report/ci-targets
ci-targets:
	$(NODE) $(KIT)/ci-targets.$(KIT_EXT) -k $(CI_REPORT) $(TARGETS)

ci-summary:
	$(NODE) $(KIT)/ci-targets.$(KIT_EXT) --summary $(CI_REPORT)

# ---- Release ---------------------------------------------------------------------------------------------------------
# The steps of the release workflow (.github/workflows/release.yml, config/release.json), in its order. release-tag tags the
# commit of the successful CI run RUN with vX.Y.Z, X.Y.Z the newest section of the change log, and appends TAG and VERSION to
# GITHUB_ENV; the later steps read TAG. fsm needs no preparation before release-tools, so release-prepare does nothing.
.PHONY: release-candidate release-prepare release-tools release-tools-path release-tag release-assets release-candidate-assets release-publish release-undraft release-coverage
release-candidate:
	RELEASE_ASSETS=var/release/assets $(NODE) $(KIT)/release-run.$(KIT_EXT) prepare "$(VERSION)"

release-prepare:
	@:

release-tools:
	$(ONLINE) $(NODE) $(KIT)/release-tools.$(KIT_EXT)

# The steps of the workflow after release-tools run with var/tools/bin and the shims on PATH and with the environment of mise.
release-tools-path:
	@test -n "$$GITHUB_PATH" || { echo 'release-tools-path: GITHUB_PATH is not set; run it in the release workflow between steps'; exit 1; }
	@test -n "$$GITHUB_ENV" || { echo 'release-tools-path: GITHUB_ENV is not set; run it in the release workflow between steps'; exit 1; }
	@echo "$(KIT_TOOLS)/mise/shims" >> "$$GITHUB_PATH"
	@echo "$(KIT_TOOLS)/bin" >> "$$GITHUB_PATH"
	@for name in $(MISE_ENVIRONMENT); do echo "$$name=$$(printenv $$name)"; done >> "$$GITHUB_ENV"

release-tag:
	@test -n "$$RUN" || { echo "release-tag: RUN is required, for example make release-tag RUN=123"; exit 1; }
	RELEASE_MAIN=origin/main $(NODE) $(KIT)/release-run.$(KIT_EXT) tag "$$RUN"$(if $(AUTO), --auto)

release-assets:
	@test -n "$$TAG" || { echo "release-assets: TAG is required, for example make release-assets TAG=v0.0.1"; exit 1; }
	RELEASE_ASSETS=var/release/assets $(ONLINE) $(NODE) $(KIT)/release.$(KIT_EXT) assets "$$TAG"

release-candidate-assets:
	@test -n "$$VERSION" || { echo "release-candidate-assets: VERSION is required, for example make release-candidate-assets VERSION=0.0.1"; exit 1; }
	RELEASE_ASSETS=var/release/assets $(ONLINE) $(NODE) $(KIT)/release.$(KIT_EXT) candidate-assets "$$VERSION"

release-publish:
	@test -n "$$TAG" || { echo "release-publish: TAG is required, for example make release-publish TAG=v0.0.1"; exit 1; }
	RELEASE_ASSETS=var/release/assets RELEASE_RECORDS=var/release $(NODE) $(KIT)/release.$(KIT_EXT) publish "$$TAG"

release-undraft:
	@test -n "$$TAG" || { echo "release-undraft: TAG is required, for example make release-undraft TAG=v0.0.1"; exit 1; }
	RELEASE_RECORDS=var/release $(NODE) $(KIT)/release.$(KIT_EXT) undraft "$$TAG"

release-coverage:
	$(NODE) $(KIT)/release.$(KIT_EXT) coverage

# The release builds the released versions, so its Go runs without the go.work that make link writes in each Go module.
release-prepare release-tools release-tag release-assets release-candidate-assets release-publish release-undraft release-coverage: export GOWORK := off


# The targets of the full suite that make check runs, past failures. Each checklist item appends the targets that it defines
# (docs/plans/fsm-v1/plan.md, Verification). The gates of KIT_GATE_TARGETS run in the jobs of the CI pipeline, and CI links
# nothing: the own suite of ci.yml is CHECK_TARGETS without them.
CI_SUITE_TARGETS = $(filter-out $(KIT_GATE_TARGETS),$(CHECK_TARGETS))

CHECK_TARGETS := owner-validate docs-check hooks-check layout-check lint-ts compiler-test db-test db-test-postgres db-test-mysql npm-persist-test npm-persist-test-postgres npm-persist-test-mysql gui-test npm-types name-test name-check docs-build docs-build-test packages-test gui-browser-test readme-test readme-check python-tools-test make-install-test rust-persist-test go-persist-test-postgres go-persist-test-mysql rust-persist-test-postgres rust-persist-test-mysql php-persist-test-postgres php-persist-test-mysql php-ext-persist-test-postgres php-ext-persist-test-mysql python-persist-test-postgres python-persist-test-mysql workflows-test rules-check rebuild-check language-check duplication-check lint-php lint-python lint-go lint-rust lint-php-ext test-php-ext suppression-check

.PHONY: go-persist-test-postgres go-persist-test-mysql rust-persist-test-postgres rust-persist-test-mysql php-persist-test-postgres php-persist-test-mysql php-ext-persist-test-postgres php-ext-persist-test-mysql python-persist-test-postgres python-persist-test-mysql check compiler-test name-test name-check docs-deps docs-build docs-build-test db-deps db-test db-test-postgres db-test-mysql npm-persist-test npm-persist-test-postgres npm-persist-test-mysql gui-deps gui-build gui-test packages-test rust-persist-test npm-types gui-browsers gui-browser-test readme-test readme-check python-tools-test install make-install-test workflows-test fsm-install fsm-js-test fsm-go-test fsm-php-test fsm-rust-test fsm-python-test fsm-php-ext-test

# ---- Package dependencies (docs/plans/fsm-v1/plan.md, Verification; docs/plans/fsm-v1/checklist.md, S-29) ------------------------
# A dependency is a file target keyed on the lock or manifest it installs from. A fresh clone installs it once; a later run finds
# the stamp of the same lock content, runs nothing and needs no network. The npm stamps are var/deps/npm/<dir>-<sha256 of the lock>,
# so a changed lock is a new stamp and an mtime cannot hide it (S-358). A target that uses a package names its file as a prerequisite,
# so make installs what that target needs before the target's recipe and nothing else. go and cargo leave no file of their own:
# their stamps are var/deps/go and var/deps/rust. The python environment is keyed on the pylock.toml of packages/python and on the
# Python 3.14 that install-tools installs with mise, whose shim is var/tools/mise/shims/python3 (S-41, S-44-2).
# install builds every dependency, with the toolchains of install-tools. ONLINE marks each download.
# npm_stamp is the stamp of the npm install of the directory $(1): the first 16 hex digits of the sha256 of its lock.
npm_stamp = var/deps/npm/$(subst /,-,$(1))-$(shell shasum -a 256 $(1)/package-lock.json | cut -c1-16)
NPM_DEP := $(call npm_stamp,packages/js)
PHP_DEP := packages/php/vendor/composer/installed.json
PHP_EXT_DEP := packages/php-ext/vendor/composer/installed.json
PYTHON_BIN := $(KIT_TOOLS)/mise/shims/python3
PYTHON_DEP := packages/python/.venv/.installed
PYTHON_LOCK := packages/python/pylock.toml
GO_DEP := var/deps/go
RUST_DEP := var/deps/rust
DB_DEP := $(call npm_stamp,packages/db)
GUI_DEP := $(call npm_stamp,packages/gui)
DOCS_DEP := $(call npm_stamp,docs)
# The npm projects install first: the PHP and Python installs run install-link, which needs every linked project installed.
PACKAGE_DEPS := $(NPM_DEP) $(DB_DEP) $(GUI_DEP) $(DOCS_DEP) $(PHP_DEP) $(PHP_EXT_DEP) $(PYTHON_DEP) $(GO_DEP) $(RUST_DEP)

$(NPM_DEP): packages/js/package-lock.json
	mkdir -p $(dir $@)
	$(ONLINE) $(MAKE) fsm-js-install
	touch $@

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

deps-rust: $(RUST_DEP)

deps-node: $(NPM_DEP) $(DB_DEP) $(GUI_DEP) $(DOCS_DEP)

$(GO_DEP): packages/go/go.sum
	mkdir -p $(dir $@)
	$(ONLINE) $(MAKE) fsm-go-install
	touch $@

$(RUST_DEP): packages/rust/Cargo.lock
	mkdir -p $(dir $@)
	$(ONLINE) $(MAKE) fsm-rust-install
	touch $@

$(DB_DEP): packages/db/package-lock.json
	mkdir -p $(dir $@)
	cd packages/db && $(ONLINE) $(NPM) ci --allow-remote=root --no-audit --no-fund
	touch $@

# The GUI installs after the db packages, because its tests run the db store (order only: a db install does not reinstall the GUI).
$(GUI_DEP): packages/gui/package-lock.json | $(DB_DEP)
	mkdir -p $(dir $@)
	cd packages/gui && $(ONLINE) $(NPM) ci --allow-remote=root --no-audit --no-fund
	touch $@

$(DOCS_DEP): docs/package-lock.json
	mkdir -p $(dir $@)
	cd docs && $(ONLINE) $(NPM) ci --allow-remote=root --no-audit --no-fund
	touch $@

# ---- Runtime packages (K245, S-44): the install, gen, build, clean and test of each runtime package are targets of this Makefile,
# named fsm-<package>-<task> with the folder name of the package. gen writes the generated files of the package, which no checkout tracks.
# The tasks of each runtime above join them by a prerequisite (test-go: fsm-go-test, K246-2).
FSM_GEN := $(NODE) packages/compiler/src/cli/fsm-gen.mjs
GO_MODULE := github.com/polyspec/fsm/packages/go
PHP_NAMESPACE := Polyspec\FsmTest
PHP_EXT_NAME := polyspec_fsm
PHP_EXT_MODULE := var/php-ext/$(PHP_EXT_NAME).so
PY_VENV := packages/python/.venv
# uv is the one of config/toolchain.json that install-tools installs (S-44-2), never a uv of PATH.
UV := $(KIT_TOOLS)/mise/shims/uv
# The tools of the packages, by the absolute path of their shims, so a recipe never runs a tool of the machine's PATH.
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
	GOPROXY=off $(RUN_TESTS) go --cwd packages/go --results .results/go.json --inputs packages/go --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- -count=1 -timeout=0 ./tests

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
	$(RUN_TESTS) node --timeout 30 --results .results/npm.json --inputs packages/js --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- --test-concurrency=1 packages/js/tests/conformance.test.mjs

# fsm-php-install installs the Composer dependencies of packages/php from the release packages.json of composer.json (K865,
# K871), then installs the dependencies of composer.lock, and links right after the install (P30), so the vendor
# installed from the tracked lock never replaces the links.
.PHONY: fsm-php-install fsm-php-gen fsm-php-test
fsm-php-install:
	cd packages/php && $(COMPOSER) install --no-interaction --no-progress
	$(MAKE) --no-print-directory install-tools TOOLS=uv
	$(MAKE) --no-print-directory install-link

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
	$(MAKE) --no-print-directory install-tools TOOLS=uv
	$(MAKE) --no-print-directory install-link

# fsm-php-ext-gen writes the generated files of the extension (src/): fsm-gen writes the C files and the stub, and scripts/php-ext-arginfo.mts
# writes the arginfo header from the stub with the gen_stub.php of the PHP (ONLINE: it downloads its PHP-Parser once; S-379, as orm does). The extension has no test of its own: test-php-ext runs the
# PHPUnit files of packages/php with the extension that build-php-ext built from src/, so the model of the php package is
# generated first.
fsm-php-ext-gen: $(PHP_EXT_DEP) fsm-php-gen
fsm-php-ext-gen:
	mkdir -p packages/php-ext/src
	$(FSM_GEN) gen --project contracts --kind php-ext --php-namespace '$(PHP_NAMESPACE)' --php-ext-name $(PHP_EXT_NAME) --out packages/php-ext/src
	$(NODE) scripts/php-ext-arginfo.mts

# fsm-python-install makes the venv .venv with the Python of the checkout, var/tools/mise/shims/python3, which install-tools
# installs with uv. The venv is made by python-venv, and uv fills it with --link-mode copy: the locked packages of pylock.toml
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
	$(MAKE) install-link
	$(MAKE) fsm-python-src
	$(PY_VENV)/bin/orm-gen gen --set contracts/schema/dbspec-set.json --out packages/python/examples/model
	$(UV) pip install --python $(PY_VENV)/bin/python --link-mode copy --no-deps packages/python
	rm -rf packages/python/build
	$(MAKE) install-link

# fsm-python-src generates the ignored src/polyspec_fsm of packages/python with node alone: the package build of a clean checkout
# (CI, a worktree) needs it before the install, and it needs no venv, so the install does not depend on the venv.
.PHONY: fsm-python-src
fsm-python-src:
	$(FSM_GEN) gen --project contracts --kind python --out packages/python/src/polyspec_fsm

# build-python of a fresh worktree builds packages/python, which needs its generated sources first (S-337).
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
	PYTHONUNBUFFERED=1 NO_COLOR=1 PYTHON_COLORS=0 $(RUN_TESTS) python --venv $(CURDIR)/$(PY_VENV) --results .results/python.json --inputs packages/python --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- discover -s packages/python/tests -t packages/python/tests

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
	$(RUN_TESTS) cargo --results .results/rust.json --inputs packages/rust --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- --manifest-path packages/rust/Cargo.toml --test conformance -- --test-threads=1

# fsm-gen generates the files of every kind, which no checkout tracks: fsm-gen and orm-gen write them (AGENTS.md, Generated files). The
# gate that reads them (the layout) and every test of a kind depend on the gen of
# its kind, so a fresh checkout generates what it reads.
.PHONY: fsm-gen
fsm-gen: fsm-go-gen fsm-js-gen fsm-php-gen fsm-php-ext-gen fsm-python-gen fsm-rust-gen
layout-check: fsm-gen

# install is for a fresh clone and for CI, which runs `make install` once and then `make check`: the bootstrap of install-kit,
# the package dependencies above, so a later run downloads nothing, and then the links of install-link.
install: fsm-install
	$(MAKE) --no-print-directory install-link
fsm-install: install-kit $(PACKAGE_DEPS)

# check runs the full suite once per committed tree, after the last item is committed; ci-targets runs the targets to their end.
# ci-suite runs the suite of ci.yml.
.PHONY: ci-suite
ci-suite:
	$(MAKE) ci-targets TARGETS="$(CI_SUITE_TARGETS)"

check:
	$(MAKE) ci-targets TARGETS="$(CHECK_TARGETS)"

# make-install-test runs the tests of the package dependencies (tests/make-install): a target that needs a dependency installs it
# first, and a present dependency is not installed again (docs/plans/fsm-v1/checklist.md, S-29).
make-install-test:
	$(RUN_TESTS) node --timeout 30 --results .results/make-install-test.json --inputs Makefile --inputs packages --inputs tests/make-install -- --test-concurrency=1 $(or $(TESTS),tests/make-install)

# package-names-test runs the tests of the polyspec names of the released runtimes (tests/package-names, S-410): the TS runtime, the Python
# wheel and the Rust crate name their packages polyspec-fsm, as the other polyspec packages do.
package-names-test:
	$(RUN_TESTS) node --timeout 30 --results .results/package-names-test.json --inputs packages/js/package.json --inputs packages/python/pyproject.toml --inputs packages/rust/Cargo.toml --inputs tests/package-names -- --test-concurrency=1 $(or $(TESTS),tests/package-names/package-names.test.mts)

# workflows-test runs the tests of the CI and Pages workflows (.github/workflows): every action is pinned to a verified commit,
# the check job runs make install and make check with the services of plan C-6, and each version comes from the file that
# declares it (docs/plans/fsm-v1/plan.md, C-10; docs/plans/fsm-v1/checklist.md, S-21). It reads the workflows as text, offline.
workflows-test:
	$(RUN_TESTS) node --timeout 30 --results .results/workflows-test.json --inputs .github/workflows --inputs config/toolchain.json --inputs .php-version --inputs mise.toml --inputs rust-toolchain.toml --inputs packages/go/go.mod --inputs Makefile --inputs docs/plans/fsm-v1/plan.md --inputs tests/workflows -- --test-concurrency=1 tests/workflows/workflows.test.mts

# name-test runs the tests of scripts/check-name.mts; name-check fails while a tracked file or path names the library by its old
# outside the allowlist of the checker (docs/plans/fsm-v1/checklist.md, S-18; the library is named fsm).
name-test:
	$(RUN_TESTS) node --timeout 30 --results .results/name-test.json --inputs scripts/check-name.mts --inputs tests/check-name -- --test-concurrency=1 tests/check-name

name-check:
	$(NODE) scripts/check-name.mts

# readme-test runs the tests of scripts/check-readmes.mts; readme-check requires every declared README pair to have its required
# sections and a Korean twin with the same headings (docs/plans/fsm-v1/plan.md, C-9; docs/plans/fsm-v1/checklist.md, S-19).
readme-test:
	$(RUN_TESTS) node --timeout 30 --results .results/readme-test.json --inputs scripts/check-readmes.mts --inputs tests/check-readmes -- --test-concurrency=1 tests/check-readmes

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
	$(RUN_TESTS) node --timeout 600 --results .results/docs-build-test.json --inputs docs --inputs packages --inputs tests/docs-build --inputs README.md --inputs README.ko.md --inputs AGENTS.md --inputs AGENTS.ko.md --inputs CHANGELOG.md --inputs CHANGELOG.ko.md -- --test-concurrency=1 tests/docs-build

# compiler-test runs the tests of packages/compiler, the core validation of a definition (docs/plans/fsm-v1/plan.md, C-5)
# with the editor schema contracts/schema/fsm.schema.json, which the tests check against the core.
compiler-test:
	$(RUN_TESTS) node --timeout 30 --results .results/compiler-test.json --inputs packages/compiler --inputs contracts -- --test-concurrency=1 packages/compiler/tests

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
	FSM_TEST_DIALECT=postgres $(RUN_TESTS) node --timeout 30 --results .results/db-test-postgres.json --inputs packages/db/src --inputs packages/db/tests --inputs packages/db/package.json --inputs packages/db/package-lock.json --inputs packages/db/schema --inputs packages/compiler -- --test-concurrency=1 --test-concurrency=1 $(DB_DIALECT_TESTS)

db-test-mysql: $(DB_DEP) fsm-db-gen
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	@$(call require_dsn,FSM_TEST_MYSQL_ADMIN_DSN)
	FSM_TEST_DIALECT=mysql $(RUN_TESTS) node --timeout 30 --results .results/db-test-mysql.json --inputs packages/db/src --inputs packages/db/tests --inputs packages/db/package.json --inputs packages/db/package-lock.json --inputs packages/db/schema --inputs packages/compiler -- --test-concurrency=1 --test-concurrency=1 $(DB_DIALECT_TESTS)

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
	$(RUN_TESTS) node --timeout 30 --results .results/db-test.json --inputs packages/db/src --inputs packages/db/tests --inputs packages/db/package.json --inputs packages/db/package-lock.json --inputs packages/db/schema --inputs packages/compiler -- --test-concurrency=1 packages/db/tests

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
	$(RUN_TESTS) node --timeout 30 --results .results/gui-test.json --inputs packages/gui --inputs packages/compiler/src --inputs packages/db -- --test-concurrency=1 $(wildcard packages/gui/tests/*.test.mjs)

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
	$(RUN_TESTS) node --timeout 120 --results .results/gui-browser-test.json --inputs packages/gui --inputs packages/compiler/src --inputs packages/db -- --test-concurrency=1 packages/gui/tests/browser/browser.test.mjs packages/gui/tests/browser/diagram.test.mjs

# packages-test runs the test of every kind with make -j6 (docs/plans/fsm-v1/plan.md, Verification).
packages-test:
	$(MAKE) -j6 test-go test-js test-php test-php-ext test-python test-rust

# test-js is the task of its runtime (Build and test of the runtimes); the tests of packages/js are its prerequisite (K246).
test-js: fsm-js-test

# npm-persist-test runs the persist cases of packages/js on a dialect: the persist vector cases of tests/conformance.test.mjs and
# tests/persist.test.mjs, whose two transitions of one row give one Changed and one Unchanged or one E_CONFLICT, and whose
# deadlock runs the transaction again while another database error does not (docs/spec/fsm.md, B-4; docs/plans/fsm-v1/plan.md, C-4).
# The three targets run them on each dialect: sqlite (a temporary file), postgres (FSM_TEST_PG_DSN) and mysql (FSM_TEST_MYSQL_DSN).
# The two files run one after the other: on a server dialect they share the persist table, which each case clears.
NPM_PERSIST_TESTS := --test-concurrency=1 --test-name-pattern=persist packages/js/tests/conformance.test.mjs packages/js/tests/persist.test.mjs
npm-persist-test: $(NPM_DEP) $(DB_DEP) fsm-js-gen fsm-db-gen
	FSM_TEST_DIALECT=sqlite $(RUN_TESTS) node --timeout 30 --results .results/npm-persist-test.json --inputs packages/js --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json --inputs packages/db/tests/dialect.mjs -- --test-concurrency=1 $(NPM_PERSIST_TESTS)

npm-persist-test-postgres: $(NPM_DEP) $(DB_DEP) fsm-js-gen fsm-db-gen
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres $(RUN_TESTS) node --timeout 30 --results .results/npm-persist-test-postgres.json --inputs packages/js --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json --inputs packages/db/tests/dialect.mjs -- --test-concurrency=1 $(NPM_PERSIST_TESTS)

npm-persist-test-mysql: $(NPM_DEP) $(DB_DEP) fsm-js-gen fsm-db-gen
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql $(RUN_TESTS) node --timeout 30 --results .results/npm-persist-test-mysql.json --inputs packages/js --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json --inputs packages/db/tests/dialect.mjs -- --test-concurrency=1 $(NPM_PERSIST_TESTS)

# npm-types runs tests/npm-types: tsc compiles tests/npm-types/consumer.ts against the generated
# declarations in strict mode, so a wrong declaration fails (docs/plans/fsm-v1/checklist.md, S-09-2). It is a tool test with
# its own record, so the conformance test of the npm kind holds only vector cases.
npm-types: $(NPM_DEP) fsm-js-gen
	$(RUN_TESTS) node --timeout 30 --results .results/npm-types.json --inputs packages/js -- --test-concurrency=1 tests/npm-types


# test-go is the task of its runtime (Build and test of the runtimes); the tests of packages/go are its prerequisite (K246-2).
test-go: fsm-go-test

# test-php is the task of its runtime (Build and test of the runtimes); the tests of packages/php are its prerequisite (K246-2).
test-php: fsm-php-test

# test-rust is the task of its runtime (Build and test of the runtimes); the tests of packages/rust are its prerequisite (K246-2).
test-rust: fsm-rust-test
# rust-persist-test runs tests/persist.rs of packages/rust on sqlite: two transitions of one row at the same time, and a deadlock
# runs the persistence transaction again while another database error does not (docs/spec/fsm.md, B-4; S-31, S-44-9).
rust-persist-test: $(RUST_DEP) fsm-rust-gen
	$(RUN_TESTS) cargo --results .results/rust-persist-test.json --inputs packages/rust --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- --manifest-path packages/rust/Cargo.toml --test persist -- --test-threads=1
# python-tools-test runs the tests of the Python of the checkout (tests/python-tools, S-41): the interpreter var/tools/mise/shims/python3
# is made by install-tools, no recipe installs an interpreter with uv, there is no install-python target, and config/toolchain.json
# declares the pythonBuild. It runs make -n on a copy of the Makefile, with no network and nothing installed.
python-tools-test:
	$(RUN_TESTS) node --timeout 30 --results .results/python-tools-test.json --inputs Makefile --inputs config/toolchain.json --inputs tests/python-tools -- --test-concurrency=1 tests/python-tools

# test-python is the task of its runtime (Build and test of the runtimes); the tests of packages/python are its prerequisite (K246-2).
test-python: fsm-python-test

# test-php-ext is the task of its runtime (Build and test of the runtimes); the tests of packages/php-ext are its prerequisite (K246-2).
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
	FSM_TEST_DIALECT=postgres GOPROXY=off $(RUN_TESTS) go --cwd packages/go --results .results/go-persist-test-postgres.json --inputs packages/go --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- -count=1 -timeout=0 ./tests -run 'TestConformance/test_persist__|TestPersist'

go-persist-test-mysql: $(GO_DEP) fsm-go-gen
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql GOPROXY=off $(RUN_TESTS) go --cwd packages/go --results .results/go-persist-test-mysql.json --inputs packages/go --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- -count=1 -timeout=0 ./tests -run 'TestConformance/test_persist__|TestPersist'

rust-persist-test-postgres: $(RUST_DEP) fsm-rust-gen
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres $(RUN_TESTS) cargo --results .results/rust-persist-test-postgres.json --inputs packages/rust --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- --manifest-path packages/rust/Cargo.toml --test conformance --test persist persist -- --test-threads=1

rust-persist-test-mysql: $(RUST_DEP) fsm-rust-gen
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql $(RUN_TESTS) cargo --results .results/rust-persist-test-mysql.json --inputs packages/rust --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- --manifest-path packages/rust/Cargo.toml --test conformance --test persist persist -- --test-threads=1

php-persist-test-postgres: $(PHP_DEP) fsm-php-gen
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres $(RUN_TESTS) phpunit --cwd packages/php --results .results/php-persist-test-postgres.json --inputs packages/php --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- tests --filter '/persist/i'

php-persist-test-mysql: $(PHP_DEP) fsm-php-gen
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql $(RUN_TESTS) phpunit --cwd packages/php --results .results/php-persist-test-mysql.json --inputs packages/php --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- tests --filter '/persist/i'

php-ext-persist-test-postgres: $(PHP_EXT_DEP) fsm-php-gen build-php-ext
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres $(RUN_TESTS) phpunit --php-extension $(PHP_EXT_MODULE) --cwd packages/php --results .results/php-ext-persist-test-postgres.json --inputs packages/php --inputs packages/compiler/src --inputs scripts/php-ext-arginfo.mts --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- tests --filter '/persist/i'

php-ext-persist-test-mysql: $(PHP_EXT_DEP) fsm-php-gen build-php-ext
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql $(RUN_TESTS) phpunit --php-extension $(PHP_EXT_MODULE) --cwd packages/php --results .results/php-ext-persist-test-mysql.json --inputs packages/php --inputs packages/compiler/src --inputs scripts/php-ext-arginfo.mts --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- tests --filter '/persist/i'

python-persist-test-postgres: $(PYTHON_DEP) fsm-python-gen
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres PYTHONUNBUFFERED=1 NO_COLOR=1 PYTHON_COLORS=0 $(RUN_TESTS) python --venv packages/python/.venv --results .results/python-persist-test-postgres.json --inputs packages/python --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- discover -s packages/python/tests -t packages/python/tests -k persist

python-persist-test-mysql: $(PYTHON_DEP) fsm-python-gen
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql PYTHONUNBUFFERED=1 NO_COLOR=1 PYTHON_COLORS=0 $(RUN_TESTS) python --venv packages/python/.venv --results .results/python-persist-test-mysql.json --inputs packages/python --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- discover -s packages/python/tests -t packages/python/tests -k persist

# examples-model generates the ignored examples/model of the Go examples before build-go compiles them (S-304): the build does not
# depend on a leftover of an earlier run. It runs the orm-gen of packages/go with the Go of the checkout's tools, as fsm-go-gen does.
build-go: examples-model
.PHONY: examples-model
examples-model:
	mkdir -p packages/go/examples
	cd packages/go && $(KIT_TOOLS)/mise/shims/go tool orm-gen gen --set $(abspath contracts/schema/dbspec-set.json) --lang go --out examples/model --scan ./examples/...
