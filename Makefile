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
.PHONY: bootstrap install-kit install-tools install-packages install-link kit-install-declared kit-install-symbols toolchain-lock
# bootstrap installs the lock of the root, @polyspec/kit included, before the tools of the checkout exist, since install-tools
# TOOLS=npm runs the bootstrap of the installed kit: the first step of a CI job after its checkout
# (.github/actions/kit-bootstrap). It runs the npm that devEngines of package.json names on the node of the machine, outside the
# checkout with --prefix, since an npm of another release refuses a folder whose devEngines names another npm (EBADDEVENGINES,
# kit K938-1). The folder outside is RUNNER_TEMP in a CI job and else TMPDIR. npm reads allow-remote=root of .npmrc.
BOOTSTRAP_NPM := $(abspath $(shell command -v npm))
bootstrap:
	root="$$PWD"; version="$$(node -p 'require("./package.json").devEngines.packageManager.version')"; \
	cd "$${RUNNER_TEMP:-$${TMPDIR:-/tmp}}" && npm_config_cache="$$root/var/bootstrap/npm-cache" $(ONLINE) "$(BOOTSTRAP_NPM)" exec --yes --package="npm@$$version" -- npm --prefix "$$root" ci --ignore-scripts

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
	@test -n "$(DIR)" || { echo "python-venv: DIR is required, for example make python-venv DIR=legacy/packages/python/.venv"; exit 1; }
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
# kit, with the map of fsm; then Git must ignore each install folder and track no generated file except the generated sources
# that config/generated.json tracks, which the Go module and the Rust crate release as their tagged tree (P34), and those must
# equal what fsm-gen, a prerequisite of layout-check, has just written.
TRACKED_GENERATED := legacy/packages/go/src legacy/packages/rust/src
layout-check:
	@test -x $(ALINT) || { echo "layout-check: $(ALINT) is missing; run make install-tools"; exit 1; }
	$(ALINT) check --config config/layout.yml --color never --compact .
	$(NODE) $(KIT)/generated-files.$(KIT_EXT) installs var package.json=node_modules pyproject.toml=.venv composer.json=vendor
	$(NODE) $(KIT)/generated-files.$(KIT_EXT) tracked --binary ELF --binary Mach-O --binary PE
	@git diff --quiet -- $(TRACKED_GENERATED) && test -z "$$(git ls-files --others --exclude-standard -- $(TRACKED_GENERATED))" || { git status --short -- $(TRACKED_GENERATED); echo "layout-check: the tracked generated sources $(TRACKED_GENERATED) differ from what make fsm-go-gen and fsm-rust-gen write; commit the written files (P34, S-371)"; exit 1; }

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
# discovery: .oxlintrc.json and knip.jsonc, ruff.toml and [tool.vulture] of legacy/packages/python/pyproject.toml, phpcs.xml.dist and
# phpstan.dist.neon, .golangci.yml, and clippy.toml with the [workspace.lints] of legacy/packages/rust/Cargo.toml.
.PHONY: lint-ts lint-php lint-python lint-go lint-rust lint-php-ext test-php-ext legacy-lint-php-ext
# lint-ts reads the packages of every npm folder, docs/.vitepress/config.mts among them, and the generated TypeScript, so it
# takes the setup of the ts runtime of config/ci.json first, as CI does (S-439).
lint-ts: deps-node fsm-js-gen
	$(NODE) $(KIT)/lint-ts.$(KIT_EXT)

# lint-php runs PHPStan on the tracked PHP files of each Composer project with the autoloader of that project, and the tests of
# legacy/packages/php name the classes that fsm-php-gen writes. So it takes the setup of the php runtime of config/ci.json
# first, as lint-ts does: the install of legacy/packages/php and of the PHP binding packages/php-ext, and the generated files
# (S-476). Its prerequisites are named below the files of the dependencies (Package dependencies).
lint-php:
	$(NODE) $(KIT)/lint-php.$(KIT_EXT) --memory-limit=-1

lint-python:
	$(NODE) $(KIT)/lint-python.$(KIT_EXT)

# lint-go lints every Go module of the checkout, a go.mod: legacy/packages/go, whose examples read the model that fsm-go-gen
# writes, and the binding module packages/go, whose Go files other than its conformance test are the files that bindings-go
# writes and Git ignores. A lint of a module without its generated files has no Go file to read, so lint-go generates both
# first, as the setup of the go runtime of config/ci.json does (S-477).
lint-go: fsm-go-gen bindings-go
	$(NODE) $(KIT)/lint-go.$(KIT_EXT)

# lint-rust lints the Rust workspaces of the checkout: the root workspace without the binding crates, which lint-bindings lints
# with their test features after make bindings writes their generated folders, and the workspace of legacy/packages/rust.
lint-rust:
	$(NODE) $(KIT)/lint-rust.$(KIT_EXT) --locked $(foreach crate,$(BINDING_CRATES),--exclude $(crate))

# lint-php-ext and test-php-ext are the gates of the PHP extension that PRINCIPLES.md names (S10). They run the legacy extension
# until the binding package packages/php-ext passes them.
lint-php-ext: legacy-lint-php-ext
test-php-ext: legacy-test-php-ext
legacy-lint-php-ext:
	$(NODE) $(KIT)/php-extension.$(KIT_EXT) check --extension legacy/packages/php-ext --build-dir var/php-ext --skip vendor --skip node_modules --library legacy/packages/php

# ---- Build and test of the legacy runtimes ---------------------------------------------------------------------------
# The hand-written packages and the fsm-gen output are under legacy/packages until plan V-6 (5) removes them (plan f6, step 3-2).
# Their targets are legacy-<task>-<runtime>, grouped by legacy-<task>, and build and test take legacy-build and legacy-test as
# prerequisites (structure ST-38): runtime-targets runs the build or the unit tests of each package of the runtime with the tools
# of its ecosystem; CASES=<pattern> is the name filter of its runner. fsm adds its own steps to a task as prerequisites
# (legacy-test-go: fsm-go-test). The PHP extension builds with phpize into $(PHP_EXT_MODULE).
.PHONY: build test lint legacy-build legacy-test legacy-build-go legacy-build-js legacy-build-php legacy-build-python legacy-build-rust legacy-build-php-ext legacy-test-go legacy-test-js legacy-test-php legacy-test-python legacy-test-rust legacy-test-php-ext
# legacy-build and legacy-test run the target of each legacy runtime (go, js, php, php-ext, python, rust); lint runs the lint of
# each runtime over the checkout, and the lint of the JavaScript package is lint-ts (kit K1106).
build: legacy-build
test: legacy-test test-rust
legacy-build:
	$(MAKE) --no-print-directory legacy-build-go legacy-build-js legacy-build-php legacy-build-php-ext legacy-build-python legacy-build-rust
legacy-test:
	$(MAKE) --no-print-directory legacy-test-go legacy-test-js legacy-test-php legacy-test-php-ext legacy-test-python legacy-test-rust

# test-rust runs the tests of the core crate packages/rust: one trial per case of contracts/cases.json (plan f6, step 3a).
.PHONY: test-rust
test-rust:
	$(NODE) $(KIT)/runtime-targets.$(KIT_EXT) test --runner cargo --roots packages/rust -- -p polyspec-fsm -- --test-threads=1
lint:
	$(MAKE) --no-print-directory lint-go lint-php lint-php-ext lint-python lint-rust lint-ts

# The JavaScript and PHP packages have no build step. The runner arguments are those that kit 0.0.98 passed (kit K1094, K1106):
# go -count=1 -timeout=0, one test at a time in node and cargo, and the 30 s test timeout of node.
legacy-build-go:
	$(NODE) $(KIT)/runtime-targets.$(KIT_EXT) build --roots legacy/packages/go -- $(GO) build ./...
legacy-build-js legacy-build-php:
legacy-build-python:
	$(NODE) $(KIT)/runtime-targets.$(KIT_EXT) build --roots legacy/packages/python -- $(UV) build
legacy-build-rust:
	$(NODE) $(KIT)/runtime-targets.$(KIT_EXT) build --roots legacy/packages/rust -- cargo build --locked

legacy-test-go:
	$(NODE) $(KIT)/runtime-targets.$(KIT_EXT) test --runner go --roots legacy/packages/go -- -count=1 -timeout=0
legacy-test-js:
	$(NODE) $(KIT)/runtime-targets.$(KIT_EXT) test --runner node --roots legacy/packages/js -- --test-timeout=30000 --test-concurrency=1
legacy-test-php:
	$(NODE) $(KIT)/runtime-targets.$(KIT_EXT) test --runner php --roots legacy/packages/php
legacy-test-python:
	PYTHONUNBUFFERED=1 NO_COLOR=1 PYTHON_COLORS=0 $(NODE) $(KIT)/runtime-targets.$(KIT_EXT) test --runner python --roots legacy/packages/python --venv .venv
legacy-test-rust:
	$(NODE) $(KIT)/runtime-targets.$(KIT_EXT) test --runner cargo --roots legacy/packages/rust -- -- --test-threads=1

legacy-build-php-ext:
	$(ONLINE) $(NODE) $(KIT)/php-extension.$(KIT_EXT) build --extension legacy/packages/php-ext --build-dir var/php-ext --skip vendor --skip node_modules --library legacy/packages/php

legacy-test-php-ext: legacy-build-php-ext
	$(NODE) $(KIT)/php-extension.$(KIT_EXT) test --extension legacy/packages/php-ext --build-dir var/php-ext --skip vendor --skip node_modules --library legacy/packages/php -- --roots legacy/packages/php

# ---- Bindings: generated from packages/rust/interface.json by binding (plan f6, step 3a; S-454) --------------------------------
# The contract packages/rust/interface.json binds the public members of the crate packages/rust for the five targets php, python,
# node, go and wasm, and contracts/cases.json holds its cases, taken from contracts/conformance/vectors.json. binding is not yet a
# package that package-lock.json pins: BINDING is scripts/binding.mts, which runs the generator of the commit of
# polyspec-binding-core that the root Cargo.lock pins, the one that make binding-install installs into var/binding (S-477), and a
# BINDING of the command line names the cli (packages/ts/src/cli.ts) of a binding checkout in its place. fsm pins none of the
# other tools that only the bindings use: until they are pinned, WASM_BINDGEN names the wasm-bindgen CLI of the release of
# packages/ts/wasm/Cargo.toml, MATURIN the maturin and TSC the TypeScript compiler of a binding checkout, and each target that
# needs one refuses to run without it. bindings writes the generated folders of packages/{ts,ts/wasm,python,php-ext,go/internal/ffi} and the
# Go files zz_generated_*.go of packages/go, which Git ignores; bindings-check runs the contract check, which also compares the
# tracked binding packages with what binding scaffold writes (binding L-2, CK-19) and the commit of polyspec-binding-core in the
# root Cargo.lock with the commit of the cli (CK-20).
# The binding packages and the root workspace that holds them are tracked since plan f6, step 3a; plan f6, step 3-2 moved the
# hand-written packages that held the same folders to legacy/packages.
BINDING_TARGETS := php python node wasm go
.PHONY: $(foreach target,$(BINDING_TARGETS),bindings-$(target)) bindings bindings-check lint-bindings test-bindings check-declarations node-package test-node test-node-conformance test-wasm test-wasm-conformance \
	test-python-binding test-python-conformance test-php-binding test-php-conformance test-go-binding test-go-conformance
BINDING_SCRIPT := scripts/binding.mts
BINDING ?= $(BINDING_SCRIPT)
WASM_BINDGEN ?=
MATURIN ?=
TSC ?=
# require_tool stops the target $@ when the variable $(1) is empty, naming the variable and what it holds ($(2)).
require_tool = test -n "$($(1))" || { echo "$@ needs $(1): $(2)" >&2; exit 2; }
BINDING_CRATES := polyspec-fsm-node polyspec-fsm-wasm polyspec-fsm-python polyspec-fsm-php-ext polyspec-fsm-go
BINDING_FEATURES := polyspec-fsm-node/panic-test,polyspec-fsm-wasm/panic-test,polyspec-fsm-python/panic-test,polyspec-fsm-php-ext/panic-test,polyspec-fsm-go/panic-test,polyspec-fsm-go/codec-test
BINDING_CASES := $(CURDIR)/contracts/cases.json
BINDING_INTERFACE := $(CURDIR)/packages/rust/interface.json
BINDING_VAR := $(CURDIR)/var/bindings
BINDING_TARGET := $(CURDIR)/target
# The file name extension of a library that Cargo builds as a cdylib: dylib on macOS, so on Linux.
CDYLIB := $(if $(filter Darwin,$(shell uname -s)),dylib,so)

# bindings generates the five targets, each in its own target bindings-<target>, so that a target that binding does not generate
# yet fails with its name and the targets that build on another target still run.
bindings: $(foreach target,$(BINDING_TARGETS),bindings-$(target))
$(foreach target,$(BINDING_TARGETS),bindings-$(target)):
	$(NODE) $(BINDING) generate --root $(CURDIR) --target $(@:bindings-%=%)

bindings-check:
	$(NODE) $(BINDING) check $(CURDIR)/packages/rust/interface.json

# The lint of the binding crates with their test features, after make bindings writes their generated folders; lint-rust lints
# the core crate alone.
lint-bindings: bindings
	cargo clippy --locked $(foreach crate,$(BINDING_CRATES),-p $(crate)) --all-targets --features $(BINDING_FEATURES) -- -D warnings

test-bindings: lint-bindings check-declarations test-python-binding test-python-conformance test-node test-node-conformance test-wasm test-php-binding \
	test-php-conformance test-wasm-conformance test-go-binding test-go-conformance

# The TypeScript compiler checks the generated declarations of the Node and WASM bindings in strict mode.
check-declarations: bindings-node bindings-wasm
	@$(call require_tool,TSC,the TypeScript compiler of a binding checkout)
	$(TSC) --noEmit --strict packages/ts/generated/index.d.ts
	$(TSC) --noEmit --strict packages/ts/wasm/generated/index.d.ts

# The wheel, built by maturin for the Python of mise.toml and installed into var/bindings/venv; the generated tests (binding G-5)
# on unittest.
test-python-binding: bindings-python
	@$(call require_tool,MATURIN,the maturin of a binding checkout)
	$(PYTHON_BIN) -m venv --clear $(BINDING_VAR)/venv
	rm -rf $(BINDING_VAR)/wheels
	cd packages/python && $(MATURIN) build --locked --interpreter $(BINDING_VAR)/venv/bin/python --features panic-test --out $(BINDING_VAR)/wheels
	$(BINDING_VAR)/venv/bin/pip install -q --no-index --force-reinstall $(BINDING_VAR)/wheels/*.whl
	PYTHONUNBUFFERED=1 NO_COLOR=1 PYTHON_COLORS=0 $(RUN_TESTS) python --venv $(BINDING_VAR)/venv --results .results/test-python-binding.json --inputs packages/python --inputs contracts/cases.json --inputs packages/rust/interface.json -- discover -s packages/python/generated/tests -t packages/python/generated/tests

# The common suite of the legacy tests, contracts/conformance/vectors.json, with its expectations on the Python binding that
# test-python-binding installs into var/bindings/venv (plan f6, step 7a-1; S-463).
test-python-conformance: test-python-binding
	PYTHONUNBUFFERED=1 NO_COLOR=1 PYTHON_COLORS=0 $(RUN_TESTS) python --venv $(BINDING_VAR)/venv --results .results/test-python-conformance.json --inputs packages/python/tests --inputs contracts -- discover -s packages/python/tests -t packages/python/tests

# The npm package and the platform package of the addon, packed and installed into var/bindings/node (binding T-2): the addon is
# the npm package of this machine's platform, which the package names in optionalDependencies, and the package also holds the WASM
# module and its glue, which wasm-bindgen writes into packages/ts/wasm/generated before the package is packed (binding GN-18, P-5).
PLATFORM = $(shell $(NODE) -p 'process.platform + "-" + process.arch + (process.platform === "linux" ? "-gnu" : "")')
WASM_BINDGEN_RELEASE = $(shell sed -n 's/^wasm-bindgen = "=\(.*\)"$$/\1/p' packages/ts/wasm/Cargo.toml)
node-package: bindings-node bindings-wasm
	@$(call require_tool,WASM_BINDGEN,the wasm-bindgen CLI of the release of packages/ts/wasm/Cargo.toml)
	test "$$($(WASM_BINDGEN) --version)" = "wasm-bindgen $(WASM_BINDGEN_RELEASE)"
	cargo build --locked -p polyspec-fsm-wasm --target wasm32-unknown-unknown --features panic-test
	$(WASM_BINDGEN) --target web --out-dir packages/ts/wasm/generated --out-name fsm_wasm \
		$(BINDING_TARGET)/wasm32-unknown-unknown/debug/polyspec_fsm_wasm.wasm
	cargo build --locked -p polyspec-fsm-node --features panic-test
	rm -rf $(BINDING_VAR)/node $(BINDING_VAR)/node-platform
	mkdir -p $(BINDING_VAR)/node $(BINDING_VAR)/node-platform
	cp $(BINDING_TARGET)/debug/libpolyspec_fsm_node.$(CDYLIB) $(BINDING_VAR)/node-platform/fsm.$(PLATFORM).node
	$(NODE) -e 'const p = require("./packages/ts/package.json"); require("fs").writeFileSync("$(BINDING_VAR)/node-platform/package.json", JSON.stringify({ name: p.name + "-$(PLATFORM)", version: p.version, os: [process.platform], cpu: [process.arch], main: "fsm.$(PLATFORM).node", files: ["fsm.$(PLATFORM).node"] }, null, 2) + "\n")'
	cd $(BINDING_VAR)/node-platform && $(NPM) pack --pack-destination $(BINDING_VAR)/node
	cd packages/ts && $(NPM) pack --pack-destination $(BINDING_VAR)/node
	echo '{ "private": true }' > $(BINDING_VAR)/node/package.json
	cd $(BINDING_VAR)/node && $(NPM) install --no-audit --no-fund --omit=optional ./*.tgz

# The generated tests and the contract cases of the Node binding on node --test, against the installed package.
test-node: node-package
	cp packages/ts/generated/tests/generated.test.mjs packages/ts/tests/cases.mjs packages/ts/tests/cases.test.mjs $(BINDING_VAR)/node/
	FSM_CASES=$(BINDING_CASES) FSM_INTERFACE=$(BINDING_INTERFACE) $(RUN_TESTS) node --cwd $(BINDING_VAR)/node --results .results/test-node.json --inputs packages/ts --inputs contracts/cases.json --inputs packages/rust/interface.json -- --test-concurrency=1 generated.test.mjs cases.test.mjs

# The common suite of the legacy tests, contracts/conformance/vectors.json, with its expectations on the Node binding of the
# installed package (plan f6, step 7a-1; S-461).
test-node-conformance: node-package
	cp packages/ts/tests/conformance.mjs packages/ts/tests/conformance.test.mjs $(BINDING_VAR)/node/
	FSM_CONTRACTS=$(CURDIR)/contracts $(RUN_TESTS) node --cwd $(BINDING_VAR)/node --results .results/test-node-conformance.json --inputs packages/ts --inputs contracts -- --test-concurrency=1 conformance.test.mjs

# The generated tests and the contract cases of the WASM binding through the subpath ./wasm of the installed package (binding
# P-5); --expose-gc serves the generated tests that collect instances (binding GN-18a).
test-wasm: node-package
	cp packages/ts/wasm/generated/tests/generated.test.mjs $(BINDING_VAR)/node/generated.wasm.test.mjs
	cp packages/ts/tests/cases.mjs packages/ts/tests/cases.wasm.test.mjs $(BINDING_VAR)/node/
	FSM_CASES=$(BINDING_CASES) FSM_INTERFACE=$(BINDING_INTERFACE) $(RUN_TESTS) node --cwd $(BINDING_VAR)/node --results .results/test-wasm.json --inputs packages/ts --inputs contracts/cases.json --inputs packages/rust/interface.json -- --expose-gc --test-concurrency=1 generated.wasm.test.mjs cases.wasm.test.mjs

# The common suite of the legacy tests (S-464) on the WASM binding, the subpath ./wasm of the installed package.
test-wasm-conformance: node-package
	cp packages/ts/tests/conformance.mjs packages/ts/tests/conformance.wasm.test.mjs $(BINDING_VAR)/node/
	FSM_CONTRACTS=$(CURDIR)/contracts $(RUN_TESTS) node --cwd $(BINDING_VAR)/node --results .results/test-wasm-conformance.json --inputs packages/ts --inputs contracts -- --test-concurrency=1 conformance.wasm.test.mjs

# The extension of the PHP binding, built against the PHP of var/tools and loaded into it; the stub is linted, then the generated
# tests run on the PHPUnit of legacy/packages/php-ext, the only PHPUnit that a lock of fsm installs: the composer.json that binding
# scaffold writes for packages/php-ext requires no PHPUnit.
test-php-binding: bindings-php legacy/packages/php-ext/vendor/composer/installed.json
	cargo build --locked -p polyspec-fsm-php-ext --features panic-test
	$(KIT_TOOLS)/bin/php -l packages/php-ext/generated/polyspec_fsm.stub.php
	$(RUN_TESTS) phpunit --cwd legacy/packages/php-ext --php-extension $(BINDING_TARGET)/debug/libpolyspec_fsm.$(CDYLIB) --results .results/test-php-binding.json --inputs packages/php-ext --inputs contracts/cases.json --inputs packages/rust/interface.json -- $(CURDIR)/packages/php-ext/generated/tests

# The common suite of the legacy tests, contracts/conformance/vectors.json, with its expectations on the PHP binding that
# test-php-binding builds (plan f6, step 7a-1; S-462).
test-php-conformance: test-php-binding
	$(RUN_TESTS) phpunit --cwd legacy/packages/php-ext --php-extension $(BINDING_TARGET)/debug/libpolyspec_fsm.$(CDYLIB) --results .results/test-php-conformance.json --inputs packages/php-ext/tests --inputs contracts -- $(CURDIR)/packages/php-ext/tests

# The static library with the test features (binding GN-13b), which Go links through CGO_LDFLAGS; gofmt and go vet of the Go
# packages of the binding, then their generated tests on go test, with the Go of mise.toml and GOTOOLCHAIN=local; the recipes name
# the packages of the binding.
# The packages of the generated Go binding: the root package of the module, its errors and its internal packages.
GO_BINDING_DIRS := . errors internal
GO_BINDING_PACKAGES := . ./errors/... ./internal/...
GO_BINDING_ENV := GOTOOLCHAIN=local GOPROXY=off CGO_LDFLAGS=-L$(BINDING_TARGET)/debug GOFLAGS=-tags=polyspec_panic_test,polyspec_codec_test
test-go-binding: bindings-go
	cargo build --locked -p polyspec-fsm-go --features panic-test,codec-test
	cd packages/go && test -z "$$($(KIT_TOOLS)/mise/shims/gofmt -l $(GO_BINDING_DIRS))"
	cd packages/go && $(GO_BINDING_ENV) $(GO) vet $(GO_BINDING_PACKAGES)
	$(GO_BINDING_ENV) $(RUN_TESTS) go --cwd packages/go --results .results/test-go-binding.json --inputs packages/go -- -count=1 -timeout=0 $(GO_BINDING_PACKAGES)

# The common suite of the legacy tests (S-467) on the Go binding, run by go test in packages/go/tests after test-go-binding
# builds the static library.
test-go-conformance: test-go-binding
	cd packages/go && test -z "$$($(KIT_TOOLS)/mise/shims/gofmt -l tests)"
	cd packages/go && $(GO_BINDING_ENV) $(GO) vet ./tests/...
	$(GO_BINDING_ENV) $(RUN_TESTS) go --cwd packages/go --results .results/test-go-conformance.json --inputs packages/go --inputs contracts -- -count=1 -timeout=0 ./tests/...

# ---- CI --------------------------------------------------------------------------------------------------------------
# kit-gates is every gate of fsm, and land runs those of them that the changed paths of a branch select. The CI pipeline
# (.github/workflows/ci-pipeline.yml) runs its partitions, each in a job that installs only what it needs; kit-gates-static runs
# past failures, so one run names every static gate that fails.
.PHONY: kit-gates kit-gates-static kit-gates-runtime-ts kit-gates-runtime-php kit-gates-runtime-python kit-gates-runtime-go kit-gates-runtime-rust kit-gates-runtime-php-ext
KIT_STATIC_GATES := layout-check docs-check rules-check owner-validate rebuild-check language-check duplication-check suppression-check
# The gates of the runtime php-ext are named by the targets that hold their recipes: lint-php-ext and test-php-ext only depend
# on them, and CHECK_TARGETS names the targets with the recipes, which CI_SUITE_TARGETS filters out by these names (S-474).
KIT_GATE_TARGETS := $(KIT_STATIC_GATES) lint-ts lint-php lint-python lint-go lint-rust legacy-lint-php-ext legacy-test-php-ext
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

# ci-passed is the last job of .github/workflows/ci.yml and of the pipeline: it fails unless every job of RESULTS, the JSON of
# toJSON(needs), has the result success; with FAIL_SKIPPED=1 a skipped job fails it too. RESULTS that is not set or names no job
# fails it with status 2.
.PHONY: ci-passed
ci-passed:
	$(NODE) $(KIT)/ci-passed.$(KIT_EXT)

# ci-targets runs TARGETS past failures and writes the report CI_REPORT (logs, record.json, summary.md).
CI_REPORT ?= var/report/ci-targets
ci-targets:
	$(NODE) $(KIT)/ci-targets.$(KIT_EXT) -k $(CI_REPORT) $(TARGETS)

ci-summary:
	$(NODE) $(KIT)/ci-targets.$(KIT_EXT) --summary $(CI_REPORT)

# ---- Release ---------------------------------------------------------------------------------------------------------
# The steps of the release workflow (.github/workflows/release.yml, config/release.json), in its order. release-tag tags the
# commit of the successful CI run RUN with vX.Y.Z, X.Y.Z the newest section of the change log, and appends TAG and VERSION to
# GITHUB_ENV; the later steps read TAG. release-prepare installs the PHP of var/tools (install-tools TOOLS=php), whose phpize and
# gen_stub.php fsm-php-ext-gen runs for the arginfo header of the generated extension that the php-ext archive carries (S-370);
# release-tools installs no tool for a make entry (kit K930).
.PHONY: release-candidate release-zip release-checkout release-prepare release-tools release-tools-path release-tag release-assets release-candidate-assets release-publish release-undraft release-coverage
release-candidate:
	RELEASE_ASSETS=var/release/assets $(NODE) $(KIT)/release-run.$(KIT_EXT) prepare "$(VERSION)"

# release-zip fails unless zip, which Composer needs for the release archives, is on PATH.
release-zip:
	@command -v zip >/dev/null || { echo 'release-zip: Info-ZIP is required for Composer release archives; install the zip package on the Ubuntu runner'; exit 1; }

# release-checkout checks out the tag TAG of the environment, so that the release builds the tagged commit with its own kit.
release-checkout:
	@test -n "$$TAG" || { echo "release-checkout: TAG is required, for example make release-checkout TAG=v0.0.1"; exit 1; }
	git checkout --quiet "$$TAG"

release-prepare:
	$(MAKE) --no-print-directory install-tools TOOLS=php

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
# nothing: the own suite of ci.yml is CHECK_TARGETS without them. The job check of ci.yml runs make ci-suite and names no target
# itself, so the workflow and make check cannot differ (S-474; make workflows-test).
CI_SUITE_TARGETS = $(filter-out $(KIT_GATE_TARGETS),$(CHECK_TARGETS))

CHECK_TARGETS := owner-validate docs-check hooks-check layout-check lint-ts compiler-test db-test db-test-postgres db-test-mysql npm-persist-test npm-persist-test-postgres npm-persist-test-mysql gui-test npm-types name-test name-check docs-build docs-build-test packages-test gui-browser-test readme-test readme-check python-tools-test make-install-test binding-test package-names-test rust-persist-test go-persist-test-postgres go-persist-test-mysql rust-persist-test-postgres rust-persist-test-mysql php-persist-test-postgres php-persist-test-mysql php-ext-persist-test-postgres php-ext-persist-test-mysql python-persist-test-postgres python-persist-test-mysql workflows-test container-test persist-servers-test rules-check rebuild-check language-check duplication-check lint-php lint-python lint-go lint-rust legacy-lint-php-ext legacy-test-php-ext suppression-check test-rust commit-names-test commit-names-check

.PHONY: go-persist-test-postgres go-persist-test-mysql rust-persist-test-postgres rust-persist-test-mysql php-persist-test-postgres php-persist-test-mysql php-ext-persist-test-postgres php-ext-persist-test-mysql python-persist-test-postgres python-persist-test-mysql check compiler-test name-test name-check docs-deps docs-build docs-build-test db-deps db-test db-test-postgres db-test-mysql npm-persist-test npm-persist-test-postgres npm-persist-test-mysql gui-deps gui-build gui-test packages-test rust-persist-test npm-types gui-browsers gui-browser-test readme-test readme-check python-tools-test install make-install-test workflows-test fsm-install fsm-js-test fsm-go-test fsm-php-test fsm-rust-test fsm-python-test fsm-php-ext-test

# ---- Package dependencies (docs/plans/fsm-v1/plan.md, Verification; docs/plans/fsm-v1/checklist.md, S-29) ------------------------
# A dependency is a file target keyed on the lock or manifest it installs from. A fresh clone installs it once; a later run finds
# the stamp of the same lock content, runs nothing and needs no network. The npm stamps are var/deps/npm/<dir>-<sha256 of the lock>,
# so a changed lock is a new stamp and an mtime cannot hide it (S-358). A target that uses a package names its file as a prerequisite,
# so make installs what that target needs before the target's recipe and nothing else. go and cargo leave no file of their own:
# their stamps are var/deps/go and var/deps/rust. The python environment is keyed on the pylock.toml of legacy/packages/python and on the
# Python 3.14 that install-tools installs with mise, whose shim is var/tools/mise/shims/python3 (S-41, S-44-2).
# install builds every dependency, with the toolchains of install-tools. ONLINE marks each download.
# npm_stamp is the stamp of the npm install of the directory $(1): the first 16 hex digits of the sha256 of its lock.
npm_stamp = var/deps/npm/$(subst /,-,$(1))-$(shell shasum -a 256 $(1)/package-lock.json | cut -c1-16)
NPM_DEP := $(call npm_stamp,legacy/packages/js)
PHP_DEP := legacy/packages/php/vendor/composer/installed.json
PHP_EXT_DEP := legacy/packages/php-ext/vendor/composer/installed.json
BINDING_PHP_DEP := packages/php-ext/vendor/composer/installed.json
PYTHON_BIN := $(KIT_TOOLS)/mise/shims/python3
PYTHON_DEP := legacy/packages/python/.venv/.installed
PYTHON_LOCK := legacy/packages/python/pylock.toml
GO_DEP := var/deps/go
RUST_DEP := var/deps/rust
BINDING_DEP := var/deps/binding
DB_DEP := $(call npm_stamp,legacy/packages/db)
GUI_DEP := $(call npm_stamp,packages/gui)
DOCS_DEP := $(call npm_stamp,docs)
# The npm projects install first: the PHP and Python installs run install-link, which needs every linked project installed.
# Each npm install links its own project right after npm ci (PROJECT, S-366-1), so an npm ci of a changed lock leaves no copy
# in place of a link of .links (P30).
PACKAGE_DEPS := $(NPM_DEP) $(DB_DEP) $(GUI_DEP) $(DOCS_DEP) $(PHP_DEP) $(PHP_EXT_DEP) $(BINDING_PHP_DEP) $(PYTHON_DEP) $(GO_DEP) $(RUST_DEP) $(BINDING_DEP)

$(NPM_DEP): legacy/packages/js/package-lock.json
	mkdir -p $(dir $@)
	$(ONLINE) $(MAKE) fsm-js-install
	touch $@

$(PHP_DEP): legacy/packages/php/composer.lock legacy/packages/php/composer.json
	$(ONLINE) $(MAKE) fsm-php-install
	touch $@

$(PHP_EXT_DEP): legacy/packages/php-ext/composer.lock legacy/packages/php-ext/composer.json
	$(ONLINE) $(MAKE) fsm-php-ext-install
	touch $@

# The Composer project of the PHP binding, packages/php-ext: it requires no package, and its install gives the autoloader with which
# make lint-php runs PHPStan on its tests (kit lint-php).
$(BINDING_PHP_DEP): packages/php-ext/composer.lock packages/php-ext/composer.json
	$(ONLINE) $(MAKE) binding-php-install
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

$(GO_DEP): legacy/packages/go/go.sum
	mkdir -p $(dir $@)
	$(ONLINE) $(MAKE) fsm-go-install
	touch $@

$(RUST_DEP): legacy/packages/rust/Cargo.lock
	mkdir -p $(dir $@)
	$(ONLINE) $(MAKE) fsm-rust-install
	touch $@

# The generator of the bindings at the commit of polyspec-binding-core that the root Cargo.lock pins (scripts/binding.mts, S-477):
# cargo fetches the crates of the lock with the checkout of that commit, and the npm of var/tools installs the packages that the
# lock of the generator pins. It needs the cargo of rust-toolchain.toml, which make install-tools TOOLS=rust installs. Only the
# BINDING of the repository needs the install: a cli that the command line names is installed already.
.PHONY: binding-install
binding-install:
	$(NODE) $(BINDING_SCRIPT) install $(NPM)

$(BINDING_DEP): Cargo.lock
	mkdir -p $(dir $@)
	$(ONLINE) $(MAKE) binding-install
	touch $@

$(foreach target,$(BINDING_TARGETS),bindings-$(target)) bindings-check: $(if $(filter $(BINDING_SCRIPT),$(BINDING)),$(BINDING_DEP))

# The lints that read installed and generated files install and generate them first (S-476, S-477).
lint-php: $(PHP_DEP) $(BINDING_PHP_DEP) fsm-php-gen

$(DB_DEP): legacy/packages/db/package-lock.json
	mkdir -p $(dir $@)
	cd legacy/packages/db && $(ONLINE) $(NPM) ci --allow-remote=root --no-audit --no-fund
	$(MAKE) --no-print-directory install-link PROJECT=legacy/packages/db
	touch $@

# The GUI installs after the db packages, because its tests run the db store (order only: a db install does not reinstall the GUI).
$(GUI_DEP): packages/gui/package-lock.json | $(DB_DEP)
	mkdir -p $(dir $@)
	cd packages/gui && $(ONLINE) $(NPM) ci --allow-remote=root --no-audit --no-fund
	$(MAKE) --no-print-directory install-link PROJECT=packages/gui
	touch $@

$(DOCS_DEP): docs/package-lock.json
	mkdir -p $(dir $@)
	cd docs && $(ONLINE) $(NPM) ci --allow-remote=root --no-audit --no-fund
	$(MAKE) --no-print-directory install-link PROJECT=docs
	touch $@

# ---- Runtime packages (K245, S-44): the install, gen, build, clean and test of each runtime package are targets of this Makefile,
# named fsm-<package>-<task> with the folder name of the package. gen writes the generated files of the package, which no checkout tracks.
# The tasks of each runtime above join them by a prerequisite (legacy-test-go: fsm-go-test, K246-2).
FSM_GEN := $(NODE) legacy/packages/compiler/src/cli/fsm-gen.mjs
GO_MODULE := github.com/polyspec/fsm/packages/go
PHP_NAMESPACE := Polyspec\FsmTest
PHP_EXT_NAME := polyspec_fsm
PHP_EXT_MODULE := var/php-ext/$(PHP_EXT_NAME).so
PY_VENV := legacy/packages/python/.venv
# uv is the one of config/toolchain.json that install-tools installs (S-44-2), never a uv of PATH.
UV := $(KIT_TOOLS)/mise/shims/uv
# The tools of the packages, by the absolute path of their shims, so a recipe never runs a tool of the machine's PATH.
GO := $(KIT_TOOLS)/mise/shims/go
COMPOSER := $(KIT_TOOLS)/mise/shims/composer

# fsm-go-install downloads the modules that go.mod and go.sum name (the orm release and orm-gen); gen and test need them.
.PHONY: deps-go fsm-go-install fsm-go-gen fsm-go-test
fsm-go-install:
	cd legacy/packages/go && $(GO) mod download

fsm-go-gen: $(GO_DEP)
fsm-go-gen:
	$(FSM_GEN) gen --project contracts --kind go --go-module $(GO_MODULE) --out legacy/packages/go/src
	# orm-gen runs go in the module of its output directory, so it runs in legacy/packages/go.
	mkdir -p legacy/packages/go/examples
	cd legacy/packages/go && $(GO) tool orm-gen gen --set $(abspath contracts/schema/dbspec-set.json) --lang go --out examples/model --scan ./examples/...

# fsm-go-test runs the conformance cases and the persist example with GOPROXY=off, so that the modules must already be downloaded.
fsm-go-test: $(GO_DEP) fsm-go-gen
	GOPROXY=off $(RUN_TESTS) go --cwd legacy/packages/go --results .results/go.json --inputs legacy/packages/go --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- -count=1 -timeout=0 ./tests

# fsm-js-install installs the dependencies of package-lock.json (the orm release); gen and test need them. It links the project
# right after npm ci (P30), as the PHP and Python installs do, so the copies of the tracked lock never replace the links (S-366-1).
.PHONY: fsm-js-install fsm-js-gen fsm-js-test
fsm-js-install:
	cd legacy/packages/js && $(NPM) ci --allow-remote=root --no-audit --no-fund
	$(MAKE) --no-print-directory install-link PROJECT=legacy/packages/js

fsm-js-gen: $(NPM_DEP)
fsm-js-gen:
	$(FSM_GEN) gen --project contracts --kind npm --out legacy/packages/js/src
	legacy/packages/js/node_modules/.bin/orm-gen gen --set contracts/schema/dbspec-set.json --out legacy/packages/js/examples/model

# fsm-js-test runs the conformance cases of the npm package; the kit reporter names every file from the checkout root. The cases
# import the dialect helper of legacy/packages/db/tests, which imports the models that fsm-db-gen writes, so it names that target (HR-85).
fsm-js-test: $(NPM_DEP) $(DB_DEP) fsm-js-gen fsm-db-gen
	$(RUN_TESTS) node --results .results/npm.json --inputs legacy/packages/js --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- --test-concurrency=1 legacy/packages/js/tests/conformance.test.mjs

# fsm-php-install installs the Composer dependencies of legacy/packages/php from the release packages.json of composer.json (K865,
# K871), then installs the dependencies of composer.lock, and links right after the install (P30), so the vendor
# installed from the tracked lock never replaces the links.
.PHONY: fsm-php-install fsm-php-gen fsm-php-test
fsm-php-install:
	cd legacy/packages/php && $(COMPOSER) install --no-interaction --no-progress
	$(MAKE) --no-print-directory install-tools TOOLS=uv
	$(MAKE) --no-print-directory install-link

fsm-php-gen: $(PHP_DEP)
fsm-php-gen:
	$(FSM_GEN) gen --project contracts --kind php --php-namespace '$(PHP_NAMESPACE)' --out legacy/packages/php/src
	legacy/packages/php/vendor/bin/orm-gen gen --set contracts/schema/dbspec-set.json --out legacy/packages/php/examples/model --namespace '$(PHP_NAMESPACE)\Model'

# fsm-php-test runs phpunit on the tests of legacy/packages/php (the conformance cases and the persist example).
fsm-php-test: $(PHP_DEP) fsm-php-gen
	$(RUN_TESTS) phpunit --cwd legacy/packages/php --results .results/php.json --inputs legacy/packages/php --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- tests

# fsm-php-ext-install is the install of the extension: the same Composer packages as legacy/packages/php (composer.lock).
.PHONY: fsm-php-ext-install fsm-php-ext-gen binding-php-install
binding-php-install:
	cd packages/php-ext && $(COMPOSER) install --no-interaction --no-progress

fsm-php-ext-install:
	cd legacy/packages/php-ext && $(COMPOSER) install --no-interaction --no-progress
	$(MAKE) --no-print-directory install-tools TOOLS=uv
	$(MAKE) --no-print-directory install-link

# fsm-php-ext-gen writes the generated files of the extension (src/): fsm-gen writes the C files and the stub, and scripts/php-ext-arginfo.mts
# writes the arginfo header from the stub with the gen_stub.php of the PHP (ONLINE: it downloads its PHP-Parser once; S-379, as orm does). The extension has no test of its own: legacy-test-php-ext runs the
# PHPUnit files of legacy/packages/php with the extension that legacy-build-php-ext built from src/, so the model of the php package is
# generated first.
fsm-php-ext-gen: $(PHP_EXT_DEP) fsm-php-gen
fsm-php-ext-gen:
	mkdir -p legacy/packages/php-ext/src
	$(FSM_GEN) gen --project contracts --kind php-ext --php-namespace '$(PHP_NAMESPACE)' --php-ext-name $(PHP_EXT_NAME) --out legacy/packages/php-ext/src
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
	$(UV) pip install --python $(PY_VENV)/bin/python --link-mode copy -r legacy/packages/python/pylock.toml
	$(MAKE) install-link
	$(MAKE) fsm-python-src
	$(PY_VENV)/bin/orm-gen gen --set contracts/schema/dbspec-set.json --out legacy/packages/python/examples/model
	$(UV) pip install --python $(PY_VENV)/bin/python --link-mode copy --no-deps legacy/packages/python
	rm -rf legacy/packages/python/build
	$(MAKE) install-link

# fsm-python-src generates the ignored src/polyspec_fsm of legacy/packages/python with node alone: the package build of a clean checkout
# (CI, a worktree) needs it before the install, and it needs no venv, so the install does not depend on the venv.
.PHONY: fsm-python-src
fsm-python-src:
	$(FSM_GEN) gen --project contracts --kind python --out legacy/packages/python/src/polyspec_fsm

# legacy-build-python of a fresh worktree builds legacy/packages/python, which needs its generated sources first (S-337).
legacy-build-python: fsm-python-src

# No bytecode: a __pycache__ written into src/ is a file without the generated header, which gen refuses.
fsm-python-gen: $(PYTHON_DEP)
fsm-python-gen: export PYTHONDONTWRITEBYTECODE := 1
fsm-python-gen:
	$(MAKE) --no-print-directory fsm-python-src
	$(PY_VENV)/bin/orm-gen gen --set contracts/schema/dbspec-set.json --out legacy/packages/python/examples/model

# fsm-python-test runs the tests through the kit runner with --venv, which runs the venv interpreter only when pyvenv.cfg names the
# install-tools Python; it runs from the checkout root with root-relative paths.
fsm-python-test: $(PYTHON_DEP) fsm-python-gen
fsm-python-test: export PYTHONDONTWRITEBYTECODE := 1
fsm-python-test:
	@test -x $(PY_VENV)/bin/python || { echo "fsm-python-test: $(PY_VENV) is missing; run make install first"; exit 1; }
	PYTHONUNBUFFERED=1 NO_COLOR=1 PYTHON_COLORS=0 $(RUN_TESTS) python --venv $(CURDIR)/$(PY_VENV) --results .results/python.json --inputs legacy/packages/python --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- discover -s legacy/packages/python/tests -t legacy/packages/python/tests

# fsm-rust-install fetches the crates of Cargo.lock (the orm release from its git tag); gen and test need them.
.PHONY: fsm-rust-install fsm-rust-gen fsm-rust-test
fsm-rust-install:
	cargo fetch --locked --manifest-path legacy/packages/rust/Cargo.toml

# The orm models of contracts/schema/persist.dbs are written by build.rs into OUT_DIR, so gen writes no model directory: that is the
# declared difference of rust.
fsm-rust-gen:
	$(FSM_GEN) gen --project contracts --kind rust --out legacy/packages/rust/src

# fsm-rust-test runs cargo on the conformance test of legacy/packages/rust through the kit reporter.
fsm-rust-test: $(RUST_DEP) fsm-rust-gen
	$(RUN_TESTS) cargo --results .results/rust.json --inputs legacy/packages/rust --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- --manifest-path legacy/packages/rust/Cargo.toml --test conformance -- --test-threads=1

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

# persist-images pulls the images of the PostgreSQL and MySQL servers of the tests, which config/containers.json pins by their
# digests, into the images of the container program of the platform, Apple container on Darwin and docker on Linux
# (scripts/container.mts). It is the only target that downloads them. persist-servers runs TARGETS through make ci-targets with
# both servers, each in a container of the run, and with the four FSM_TEST_* variables of those servers in the environment of
# the targets; scripts/persist-servers.mts waits for the ready line of each server and removes the containers when the targets
# end or fail and on SIGINT and SIGTERM (docs/plans/fsm-v1/plan.md, C-6; docs/plans/fsm-v1/checklist.md, S-472-1).
# PERSIST_MAKE names the make of the run for the recipe of persist-servers: make runs a recipe line that holds its variable
# MAKE also in a dry run, which would start the containers, and it only prints a line that names that make through another
# variable.
.PHONY: persist-images persist-servers container-test persist-servers-test
PERSIST_MAKE = $(MAKE)
persist-images:
	$(NODE) scripts/persist-servers.mts pull

persist-servers:
	$(NODE) scripts/persist-servers.mts run -- $(PERSIST_MAKE) ci-targets TARGETS="$(TARGETS)"

# check runs the full suite once per committed tree, after the last item is committed; ci-targets runs the targets to their end.
# ci-suite runs the suite of ci.yml. Both run their targets with the servers of persist-servers, so the PostgreSQL and MySQL
# targets use no server that is installed on the machine.
.PHONY: ci-suite
ci-suite:
	$(MAKE) persist-servers TARGETS="$(CI_SUITE_TARGETS)"

check:
	$(MAKE) persist-servers TARGETS="$(CHECK_TARGETS)"

# make-install-test runs the tests of the package dependencies (tests/make-install): a target that needs a dependency installs it
# first, and a present dependency is not installed again (docs/plans/fsm-v1/checklist.md, S-29).
make-install-test:
	$(RUN_TESTS) node --results .results/make-install-test.json --inputs Makefile --inputs config/ci.json --inputs packages --inputs tests/make-install -- --test-concurrency=1 $(or $(TESTS),tests/make-install)

# binding-test runs the tests of scripts/binding.mts (tests/binding, S-477): the commit and the checkout of the generator from
# the output of cargo metadata, and the folder of an installed generator; it runs no cargo, git or npm.
.PHONY: binding-test
binding-test:
	$(RUN_TESTS) node --results .results/binding-test.json --inputs scripts/binding.mts --inputs tests/binding --inputs tests/support/tree.mts -- --test-concurrency=1 tests/binding

# package-names-test runs the tests of the polyspec names of the released runtimes (tests/package-names, S-410): the TS runtime, the Python
# wheel and the Rust crate name their packages polyspec-fsm, as the other polyspec packages do.
package-names-test:
	$(RUN_TESTS) node --results .results/package-names-test.json --inputs legacy/packages/js/package.json --inputs legacy/packages/python/pyproject.toml --inputs legacy/packages/rust/Cargo.toml --inputs tests/package-names -- --test-concurrency=1 $(or $(TESTS),tests/package-names/package-names.test.mts)

# workflows-test runs the tests of the CI and Pages workflows (.github/workflows): every action is pinned to a verified commit,
# the check job runs make install and its suite through make persist-servers, which starts the servers of plan C-6, holds no
# block services and uploads its report, and each version comes from the file that declares it (docs/plans/fsm-v1/plan.md, C-10; docs/plans/fsm-v1/checklist.md, S-21). It reads the workflows as text, offline.
workflows-test:
	$(RUN_TESTS) node --results .results/workflows-test.json --inputs .github/workflows --inputs config/toolchain.json --inputs config/owner-checks.json --inputs config/release.json --inputs .php-version --inputs mise.toml --inputs rust-toolchain.toml --inputs legacy/packages/go/go.mod --inputs Makefile --inputs docs/plans/fsm-v1/plan.md --inputs .github/actions --inputs tests/workflows -- --test-concurrency=1 tests/workflows/workflows.test.mts tests/workflows/rules.test.mts

# container-test runs the tests of scripts/container.mts (tests/container): the command of each verb on the container program
# of each platform, Apple container on Darwin and docker on Linux, against stand-ins of the programs that the test writes, so
# it needs no container runtime (docs/plans/fsm-v1/plan.md, C-6; docs/plans/fsm-v1/checklist.md, S-472-1).
container-test:
	$(RUN_TESTS) node --results .results/container-test.json --inputs scripts/container.mts --inputs tests/container --inputs tests/support/stand-ins.mts -- --test-concurrency=1 tests/container

# persist-servers-test runs the tests of scripts/persist-servers.mts (tests/persist-servers): the start of both servers, the
# ready line of each, the DSNs of the command, a container that stops first, the signals and the removal, against stand-ins of
# the programs that the test writes, so it needs no container runtime (docs/plans/fsm-v1/plan.md, C-6; S-472-1).
persist-servers-test:
	$(RUN_TESTS) node --results .results/persist-servers-test.json --inputs scripts/persist-servers.mts --inputs scripts/container.mts --inputs config/containers.json --inputs tests/persist-servers --inputs tests/support/stand-ins.mts -- --test-concurrency=1 tests/persist-servers

# name-test runs the tests of scripts/check-name.mts; name-check fails while a tracked file or path names the library by its old
# outside the allowlist of the checker (docs/plans/fsm-v1/checklist.md, S-18; the library is named fsm).
name-test:
	$(RUN_TESTS) node --results .results/name-test.json --inputs scripts/check-name.mts --inputs tests/check-name -- --test-concurrency=1 tests/check-name

name-check:
	$(NODE) scripts/check-name.mts

# readme-test runs the tests of scripts/check-readmes.mts; readme-check requires every declared README pair to have its required
# sections and a Korean twin with the same headings (docs/plans/fsm-v1/plan.md, C-9; docs/plans/fsm-v1/checklist.md, S-19).
readme-test:
	$(RUN_TESTS) node --results .results/readme-test.json --inputs scripts/check-readmes.mts --inputs tests/check-readmes -- --test-concurrency=1 tests/check-readmes

readme-check:
	$(NODE) scripts/check-readmes.mts

# commit-names-test runs the tests of scripts/check-commit-names.mts; commit-names-check fails while a tracked document names a Git
# commit (AGENTS.md, Rules; S-469).
.PHONY: commit-names-test commit-names-check
commit-names-test:
	$(RUN_TESTS) node --results .results/commit-names-test.json --inputs scripts/check-commit-names.mts --inputs tests/check-commit-names -- --test-concurrency=1 tests/check-commit-names

commit-names-check:
	$(NODE) scripts/check-commit-names.mts

# docs-deps installs the packages of the documentation site: the exact vitepress release of docs/package.json, locked in
# docs/package-lock.json (docs/plans/fsm-v1/plan.md, C-8).
docs-deps: $(DOCS_DEP)

# docs-build builds the documentation site from the repository documents in place, into docs/.vitepress/dist; a dead link fails
# the build (docs/.vitepress/config.mts, docs/plans/fsm-v1/plan.md, C-8). scripts/docs-build.mts runs the VitePress of
# docs/node_modules and fails a build that prints an error: VitePress prints the error of a page that fails to render and ends
# with status 0 (S-473).
docs-build: $(DOCS_DEP)
	$(NODE) scripts/docs-build.mts docs

# docs-build-test runs the tests of the site: a dead link fails the build, and the real build produces its pages and the GitHub
# rewrite of a link to a repository file (tests/docs-build, docs/plans/fsm-v1/plan.md, C-8). Its record names the inputs it reads.
docs-build-test: $(DOCS_DEP)
	$(RUN_TESTS) node --results .results/docs-build-test.json --inputs docs --inputs packages --inputs tests/docs-build --inputs scripts/docs-build.mts --inputs README.md --inputs README.ko.md --inputs AGENTS.md --inputs AGENTS.ko.md --inputs CHANGELOG.md --inputs CHANGELOG.ko.md -- --test-concurrency=1 tests/docs-build

# compiler-test runs the tests of legacy/packages/compiler, the core validation of a definition (docs/plans/fsm-v1/plan.md, C-5)
# with the editor schema contracts/schema/fsm.schema.json, which the tests check against the core.
compiler-test:
	$(RUN_TESTS) node --results .results/compiler-test.json --inputs legacy/packages/compiler --inputs contracts -- --test-concurrency=1 legacy/packages/compiler/tests

# db-test-postgres and db-test-mysql run the DB store tests on the server dialects that the documents name (docs/plans/fsm-v1/plan.md, C-6):
# db-store.test.mjs and store-contract-all.test.mjs, which open the database of FSM_TEST_PG_DSN or FSM_TEST_MYSQL_DSN through the dialect
# helper of tests/dialect.mjs. The DSN names the server and its user; a missing DSN fails the target and never skips it. The CLI and
# command tests (cli.test.mjs, command.test.mjs) run on the same dialect with an empty database of their own, which the admin DSN
# (FSM_TEST_PG_ADMIN_DSN, FSM_TEST_MYSQL_ADMIN_DSN) creates and drops (docs/plans/fsm-v1/plan.md, C-6; docs/plans/fsm-v1/checklist.md,
# S-37-2). The files share the server, so they run one after the other.
DB_DIALECT_TESTS := legacy/packages/db/tests/db-store.test.mjs legacy/packages/db/tests/store-contract-all.test.mjs legacy/packages/db/tests/cli.test.mjs legacy/packages/db/tests/command.test.mjs
db-test-postgres: $(DB_DEP) fsm-db-gen
	@$(call require_dsn,FSM_TEST_PG_DSN)
	@$(call require_dsn,FSM_TEST_PG_ADMIN_DSN)
	FSM_TEST_DIALECT=postgres $(RUN_TESTS) node --results .results/db-test-postgres.json --inputs legacy/packages/db/src --inputs legacy/packages/db/tests --inputs legacy/packages/db/package.json --inputs legacy/packages/db/package-lock.json --inputs legacy/packages/db/schema --inputs legacy/packages/compiler -- --test-concurrency=1 --test-concurrency=1 $(DB_DIALECT_TESTS)

db-test-mysql: $(DB_DEP) fsm-db-gen
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	@$(call require_dsn,FSM_TEST_MYSQL_ADMIN_DSN)
	FSM_TEST_DIALECT=mysql $(RUN_TESTS) node --results .results/db-test-mysql.json --inputs legacy/packages/db/src --inputs legacy/packages/db/tests --inputs legacy/packages/db/package.json --inputs legacy/packages/db/package-lock.json --inputs legacy/packages/db/schema --inputs legacy/packages/compiler -- --test-concurrency=1 --test-concurrency=1 $(DB_DIALECT_TESTS)

# fsm-db-gen writes the models of legacy/packages/db/src/models with the orm-gen of its package (npm run gen): they are generated output, and
# no checkout tracks them (AGENTS.md, Generated files). The db store, its tests, the GUI and the dialect helper of the npm persist
# tests import them, so every target that runs one of those depends on it.
.PHONY: fsm-db-gen
fsm-db-gen: $(DB_DEP)
	cd legacy/packages/db && $(NPM) run gen

# db-deps installs the packages of legacy/packages/db (orm and ordered-json from their release tarballs, pinned in its
# package-lock.json). db-test runs the tests of legacy/packages/db: the DB store against the store contract, the round trips
# of json and db, the atomicity of save, the CLI, on the models that fsm-db-gen writes from legacy/packages/db/schema/fsm.dbs
# (docs/plans/fsm-v1/plan.md, C-6).
db-deps: $(DB_DEP)

db-test: $(DB_DEP) fsm-db-gen
	$(RUN_TESTS) node --results .results/db-test.json --inputs legacy/packages/db/src --inputs legacy/packages/db/tests --inputs legacy/packages/db/package.json --inputs legacy/packages/db/package-lock.json --inputs legacy/packages/db/schema --inputs legacy/packages/compiler -- --test-concurrency=1 legacy/packages/db/tests

# gui-deps installs the packages of packages/gui (hyper v0.0.13, crudui v0.0.5, the template v0.0.5, mermaid, htmx and
# yaml, pinned in its package.json and package-lock.json; docs/plans/fsm-v1/plan.md, C-1). The db store of the GUI is the one of
# legacy/packages/db, whose orm packages db-deps installs first.
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
	$(RUN_TESTS) node --results .results/gui-test.json --inputs packages/gui --inputs legacy/packages/compiler/src --inputs legacy/packages/db -- --test-concurrency=1 $(wildcard packages/gui/tests/*.test.mjs)

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

# gui-browser-libraries installs the system libraries of that Chromium into the machine with the package manager of the system,
# as root (sudo): a step of the CI job check, whose runner does not hold them. The Playwright of GUI_DEP names the libraries of
# its Chromium; sudo keeps the PATH of the recipe, which holds the node of var/tools. It downloads, so it is ONLINE.
.PHONY: gui-browser-libraries
gui-browser-libraries: | $(GUI_DEP)
	cd packages/gui && sudo env PATH="$$PATH" $(ONLINE) node_modules/.bin/playwright install-deps chromium

# gui-browser-test runs the tests of tests/browser (browser.test.mjs, diagram.test.mjs; S-38 adds the drawn diagram) of packages/gui: the GUI forms in a headless Chromium on a temporary project
# (docs/plans/fsm-v1/checklist.md, S-22-1 and S-22-2). It needs the browser of gui-browsers and the built assets of gui-build.
gui-browser-test: $(GUI_BROWSERS) gui-build $(DB_DEP) fsm-db-gen
	$(RUN_TESTS) node --results .results/gui-browser-test.json --inputs packages/gui --inputs legacy/packages/compiler/src --inputs legacy/packages/db -- --test-concurrency=1 packages/gui/tests/browser/browser.test.mjs packages/gui/tests/browser/diagram.test.mjs

# packages-test runs the test of every kind with make -j6 (docs/plans/fsm-v1/plan.md, Verification); the PHP extension runs through
# test-php-ext, its gate of PRINCIPLES.md (S10), which runs legacy-test-php-ext until the binding package passes it.
packages-test:
	$(MAKE) -j6 legacy-test-go legacy-test-js legacy-test-php test-php-ext legacy-test-python legacy-test-rust

# legacy-test-js is the task of its runtime (Build and test of the runtimes); the tests of legacy/packages/js are its prerequisite (K246).
legacy-test-js: fsm-js-test

# npm-persist-test runs the persist cases of legacy/packages/js on a dialect: the persist vector cases of tests/conformance.test.mjs and
# tests/persist.test.mjs, whose two transitions of one row give one Changed and one Unchanged or one E_CONFLICT, and whose
# deadlock runs the transaction again while another database error does not (docs/spec/fsm.md, B-4; docs/plans/fsm-v1/plan.md, C-4).
# The three targets run them on each dialect: sqlite (a temporary file), postgres (FSM_TEST_PG_DSN) and mysql (FSM_TEST_MYSQL_DSN).
# The two files run one after the other: on a server dialect they share the persist table, which each case clears.
NPM_PERSIST_TESTS := --test-concurrency=1 --test-name-pattern=persist legacy/packages/js/tests/conformance.test.mjs legacy/packages/js/tests/persist.test.mjs
npm-persist-test: $(NPM_DEP) $(DB_DEP) fsm-js-gen fsm-db-gen
	FSM_TEST_DIALECT=sqlite $(RUN_TESTS) node --results .results/npm-persist-test.json --inputs legacy/packages/js --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json --inputs legacy/packages/db/tests/dialect.mjs -- --test-concurrency=1 $(NPM_PERSIST_TESTS)

npm-persist-test-postgres: $(NPM_DEP) $(DB_DEP) fsm-js-gen fsm-db-gen
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres $(RUN_TESTS) node --results .results/npm-persist-test-postgres.json --inputs legacy/packages/js --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json --inputs legacy/packages/db/tests/dialect.mjs -- --test-concurrency=1 $(NPM_PERSIST_TESTS)

npm-persist-test-mysql: $(NPM_DEP) $(DB_DEP) fsm-js-gen fsm-db-gen
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql $(RUN_TESTS) node --results .results/npm-persist-test-mysql.json --inputs legacy/packages/js --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json --inputs legacy/packages/db/tests/dialect.mjs -- --test-concurrency=1 $(NPM_PERSIST_TESTS)

# npm-types runs tests/npm-types: tsc compiles tests/npm-types/consumer.ts against the generated
# declarations in strict mode, so a wrong declaration fails (docs/plans/fsm-v1/checklist.md, S-09-2). It is a tool test with
# its own record, so the conformance test of the npm kind holds only vector cases.
npm-types: $(NPM_DEP) fsm-js-gen
	$(RUN_TESTS) node --results .results/npm-types.json --inputs legacy/packages/js -- --test-concurrency=1 tests/npm-types


# legacy-test-go is the task of its runtime (Build and test of the runtimes); the tests of legacy/packages/go are its prerequisite (K246-2).
legacy-test-go: fsm-go-test

# legacy-test-php is the task of its runtime (Build and test of the runtimes); the tests of legacy/packages/php are its prerequisite (K246-2).
legacy-test-php: fsm-php-test

# legacy-test-rust is the task of its runtime (Build and test of the runtimes); the tests of legacy/packages/rust are its prerequisite (K246-2).
legacy-test-rust: fsm-rust-test
# rust-persist-test runs tests/persist.rs of legacy/packages/rust on sqlite: two transitions of one row at the same time, and a deadlock
# runs the persistence transaction again while another database error does not (docs/spec/fsm.md, B-4; S-31, S-44-9).
rust-persist-test: $(RUST_DEP) fsm-rust-gen
	$(RUN_TESTS) cargo --results .results/rust-persist-test.json --inputs legacy/packages/rust --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- --manifest-path legacy/packages/rust/Cargo.toml --test persist -- --test-threads=1
# python-tools-test runs the tests of the Python of the checkout (tests/python-tools, S-41): the interpreter var/tools/mise/shims/python3
# is made by install-tools, no recipe installs an interpreter with uv, there is no install-python target, and config/toolchain.json
# declares the pythonBuild. It runs make -n on a copy of the Makefile, with no network and nothing installed.
python-tools-test:
	$(RUN_TESTS) node --results .results/python-tools-test.json --inputs Makefile --inputs config/toolchain.json --inputs tests/python-tools -- --test-concurrency=1 tests/python-tools

# legacy-test-python is the task of its runtime (Build and test of the runtimes); the tests of legacy/packages/python are its prerequisite (K246-2).
legacy-test-python: fsm-python-test

# legacy-test-php-ext is the task of its runtime (Build and test of the runtimes); the tests of legacy/packages/php-ext are its prerequisite (K246-2).
legacy-test-php-ext: fsm-php-ext-gen
legacy-build-php-ext: fsm-php-ext-gen

# ---- Persist cases on the server dialects (docs/spec/fsm.md, B-4; docs/plans/fsm-v1/plan.md, C-6; docs/plans/fsm-v1/checklist.md, S-37-1)
# Each kind runs its persist cases on PostgreSQL and MySQL with the DSN variables of npm (FSM_TEST_PG_DSN, FSM_TEST_MYSQL_DSN). The
# test selects the dialect with FSM_TEST_DIALECT and fails when its DSN is empty; require_dsn makes the target itself stop first
# with exit 2, so a missing DSN is a failed target and never a skipped dialect. The persist cases of sqlite run in test-<kind>.
define require_dsn
test -n "$${$(1)}" || { echo "$@ needs $(1): a server dialect never skips (docs/plans/fsm-v1/plan.md, C-6)" >&2; exit 2; }
endef

go-persist-test-postgres: $(GO_DEP) fsm-go-gen
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres GOPROXY=off $(RUN_TESTS) go --cwd legacy/packages/go --results .results/go-persist-test-postgres.json --inputs legacy/packages/go --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- -count=1 -timeout=0 ./tests -run 'TestConformance/test_persist__|TestPersist'

go-persist-test-mysql: $(GO_DEP) fsm-go-gen
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql GOPROXY=off $(RUN_TESTS) go --cwd legacy/packages/go --results .results/go-persist-test-mysql.json --inputs legacy/packages/go --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- -count=1 -timeout=0 ./tests -run 'TestConformance/test_persist__|TestPersist'

rust-persist-test-postgres: $(RUST_DEP) fsm-rust-gen
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres $(RUN_TESTS) cargo --results .results/rust-persist-test-postgres.json --inputs legacy/packages/rust --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- --manifest-path legacy/packages/rust/Cargo.toml --test conformance --test persist persist -- --test-threads=1

rust-persist-test-mysql: $(RUST_DEP) fsm-rust-gen
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql $(RUN_TESTS) cargo --results .results/rust-persist-test-mysql.json --inputs legacy/packages/rust --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- --manifest-path legacy/packages/rust/Cargo.toml --test conformance --test persist persist -- --test-threads=1

php-persist-test-postgres: $(PHP_DEP) fsm-php-gen
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres $(RUN_TESTS) phpunit --cwd legacy/packages/php --results .results/php-persist-test-postgres.json --inputs legacy/packages/php --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- tests --filter '/persist/i'

php-persist-test-mysql: $(PHP_DEP) fsm-php-gen
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql $(RUN_TESTS) phpunit --cwd legacy/packages/php --results .results/php-persist-test-mysql.json --inputs legacy/packages/php --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- tests --filter '/persist/i'

php-ext-persist-test-postgres: $(PHP_EXT_DEP) fsm-php-gen legacy-build-php-ext
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres $(RUN_TESTS) phpunit --php-extension $(PHP_EXT_MODULE) --cwd legacy/packages/php --results .results/php-ext-persist-test-postgres.json --inputs legacy/packages/php --inputs legacy/packages/compiler/src --inputs scripts/php-ext-arginfo.mts --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- tests --filter '/persist/i'

php-ext-persist-test-mysql: $(PHP_EXT_DEP) fsm-php-gen legacy-build-php-ext
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql $(RUN_TESTS) phpunit --php-extension $(PHP_EXT_MODULE) --cwd legacy/packages/php --results .results/php-ext-persist-test-mysql.json --inputs legacy/packages/php --inputs legacy/packages/compiler/src --inputs scripts/php-ext-arginfo.mts --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- tests --filter '/persist/i'

python-persist-test-postgres: $(PYTHON_DEP) fsm-python-gen
	@$(call require_dsn,FSM_TEST_PG_DSN)
	FSM_TEST_DIALECT=postgres PYTHONUNBUFFERED=1 NO_COLOR=1 PYTHON_COLORS=0 $(RUN_TESTS) python --venv legacy/packages/python/.venv --results .results/python-persist-test-postgres.json --inputs legacy/packages/python --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- discover -s legacy/packages/python/tests -t legacy/packages/python/tests -k persist

python-persist-test-mysql: $(PYTHON_DEP) fsm-python-gen
	@$(call require_dsn,FSM_TEST_MYSQL_DSN)
	FSM_TEST_DIALECT=mysql PYTHONUNBUFFERED=1 NO_COLOR=1 PYTHON_COLORS=0 $(RUN_TESTS) python --venv legacy/packages/python/.venv --results .results/python-persist-test-mysql.json --inputs legacy/packages/python --inputs contracts/conformance/vectors.json --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- discover -s legacy/packages/python/tests -t legacy/packages/python/tests -k persist

# examples-model generates the ignored examples/model of the Go examples before legacy-build-go compiles them (S-304): the build does not
# depend on a leftover of an earlier run. It runs the orm-gen of legacy/packages/go with the Go of the checkout's tools, as fsm-go-gen does.
legacy-build-go: examples-model
.PHONY: examples-model
examples-model:
	mkdir -p legacy/packages/go/examples
	cd legacy/packages/go && $(KIT_TOOLS)/mise/shims/go tool orm-gen gen --set $(abspath contracts/schema/dbspec-set.json) --lang go --out examples/model --scan ./examples/...
