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
TOOL_TESTS := layout-test parity-test compiler-test gen-check-test db-test gui-test npm-types name-test
# The kinds of contracts/layout.json, read from it so that the Makefile cannot name a kind the layout lacks. Each kind has
# test-<kind> (its package tests) and parity-<kind> (its owner check) as literal targets, added by its package item.
KINDS := $(shell node -p "Object.keys(require('./contracts/layout.json').kinds).join(' ')")

CHECK_TARGETS := kit-check owner-validate documents-check commits-check hooks-check toolchain-check dependency-policy-check layout-test layout-check parity-test compiler-test gen-check-test gen-check db-test gui-test npm-types name-test name-check packages-test parity-check

.PHONY: check layout-test layout-check parity-test compiler-test gen-check-test gen-check name-test name-check db-deps db-test gui-deps gui-build gui-test parity-check packages-test test-npm parity-npm test-go parity-go test-php parity-php test-rust parity-rust npm-types install-python test-python parity-python test-php-ext parity-php-ext

# check runs the full suite once per committed tree, when no item of docs/plans/execution-checklist.md is [~]
# (scripts/kit/full-run.mjs); it records its result in var/full-run.json.
check:
	node scripts/kit/full-run.mjs run $(CHECK_TARGETS)

# layout-test runs the tests of scripts/check-layout.mjs; layout-check checks the language packages against
# contracts/layout.json (docs/plans/fsm-v1.md, C-2).
layout-test:
	node scripts/kit/run-tests.mjs node --results .results/layout-test.json --inputs scripts/check-layout.mjs --inputs tests/check-layout -- tests/check-layout

layout-check:
	node scripts/check-layout.mjs

# name-test runs the tests of scripts/check-name.mjs; name-check fails while a tracked file or path names the library by its old
# name `fsm` outside the allowlist of the checker (docs/plans/execution-checklist.md, S-18; the library is named fsm).
name-test:
	node scripts/kit/run-tests.mjs node --results .results/name-test.json --inputs scripts/check-name.mjs --inputs tests/check-name -- tests/check-name

name-check:
	node scripts/check-name.mjs

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

gen-check:
	node scripts/gen-check.mjs

# db-deps installs the packages of packages/fsm-db (orm and ordered-json from their release tarballs, pinned in its
# package-lock.json). db-test runs the tests of packages/fsm-db: the DB store against the store contract, the round trips
# of json and db, the atomicity of save, the CLI, and the generated models, which orm-gen must reproduce from schema/fsm.dbs
# (docs/plans/fsm-v1.md, C-6).
db-deps:
	cd packages/fsm-db && npm ci --no-audit --no-fund

db-test: db-deps
	node scripts/kit/run-tests.mjs node --results .results/db-test.json --inputs packages/fsm-db/src --inputs packages/fsm-db/tests --inputs packages/fsm-db/package.json --inputs packages/fsm-db/package-lock.json --inputs packages/fsm-compiler --inputs schema/fsm.dbs -- packages/fsm-db/tests

# gui-deps installs the packages of packages/fsm-gui (hyper v0.0.11, crudui v0.0.5, the template v0.0.5, mermaid, htmx and
# yaml, pinned in its package.json and package-lock.json; docs/plans/fsm-v1.md, C-1). The db store of the GUI is the one of
# packages/fsm-db, whose orm packages db-deps installs first.
gui-deps: db-deps
	cd packages/fsm-gui && npm ci --no-audit --no-fund

# gui-build builds the browser assets of the GUI with the hyper v0.0.11 asset build: the templates, the client bundle that holds
# mermaid, build/templates.index.json and build/manifest.json (docs/plans/fsm-v1.md, C-7). gui-test runs it first.
gui-build: gui-deps
	cd packages/fsm-gui && node_modules/.bin/hyper-build-assets --app . --api /api --output build

# gui-test runs the tests of packages/fsm-gui (docs/plans/fsm-v1.md, C-7): the handlers and the server entry through the
# built application, the store selection and the pinned Mermaid parse test. The compiler sources are inputs of the GUI.
gui-test: gui-build
	node scripts/kit/run-tests.mjs node --results .results/gui-test.json --inputs packages/fsm-gui --inputs packages/fsm-compiler/src --inputs packages/fsm-db --inputs schema/fsm.dbs -- packages/fsm-gui/tests

parity-check:
	node scripts/check-parity.mjs --tools $(subst $(eval) ,$(comma),$(TOOL_TESTS))

# packages-test runs the test of every kind with make -j6 (docs/plans/fsm-v1.md, Verification). It refuses an empty kind list,
# because make with no goal would run the default goal, check, from inside check.
packages-test:
	$(if $(KINDS),,$(error contracts/layout.json declares no kind))
	$(MAKE) -j6 $(addprefix test-,$(KINDS))

# test-npm runs the tests of packages/fsm-npm: the conformance cases and the persist example (docs/plans/fsm-v1.md, C-2).
test-npm:
	$(MAKE) -C packages/fsm-npm test

# npm-types runs tests/types.test.mjs of packages/fsm-npm: tsc compiles tests/types/consumer.ts against the generated
# declarations in strict mode, so a wrong declaration fails (docs/plans/execution-checklist.md, S-09-2). It is a tool test with
# its own record, so the record of the npm kind holds only vector cases for check-parity.
npm-types:
	node scripts/kit/run-tests.mjs node --results .results/npm-types.json --inputs packages/fsm-npm -- packages/fsm-npm/tests/types.test.mjs

# parity-npm is the owner check of the npm package: check-parity reads its record only and requires every vector case to have
# run once and passed (docs/plans/fsm-v1.md, C-4 and D).
parity-npm: test-npm
	node scripts/check-parity.mjs --kind npm

# test-go runs the tests of packages/fsm-go: the conformance cases and the persist example (docs/plans/fsm-v1.md, C-2).
test-go:
	$(MAKE) -C packages/fsm-go test

# parity-go is the owner check of the go package: check-parity reads its record only and requires every vector case to have run
# once and passed (docs/plans/fsm-v1.md, C-4 and D).
parity-go: test-go
	node scripts/check-parity.mjs --kind go
# test-php runs the tests of packages/fsm-php: the conformance cases and the persist example (docs/plans/fsm-v1.md, C-2).
test-php:
	$(MAKE) -C packages/fsm-php test
# parity-php is the owner check of the php package: check-parity reads its record only and requires every vector case to have
# run once and passed (docs/plans/fsm-v1.md, C-4 and D).
parity-php: test-php
	node scripts/check-parity.mjs --kind php
# test-rust runs the tests of packages/fsm-rust: the conformance cases and the persist example (docs/plans/fsm-v1.md, C-2).
test-rust:
	$(MAKE) -C packages/fsm-rust test
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

# test-python runs the tests of packages/fsm-python: the conformance cases and the persist example, offline, with the Python 3.14
# venv of `make -C packages/fsm-python install` (docs/plans/fsm-v1.md, C-2).
test-python:
	$(MAKE) -C packages/fsm-python test

# parity-python is the owner check of the python package: check-parity reads its record only and requires every vector case to have
# run once and passed (docs/plans/fsm-v1.md, C-4 and D).
parity-python: test-python
	node scripts/check-parity.mjs --kind python
# test-php-ext builds the extension of packages/fsm-php-ext and runs its tests: the conformance cases and the persist example
# (docs/plans/fsm-v1.md, C-2).
test-php-ext:
	$(MAKE) -C packages/fsm-php-ext test
# parity-php-ext is the owner check of the php-ext package: check-parity reads its record only and requires every vector case to
# have run once and passed (docs/plans/fsm-v1.md, C-4 and D).
parity-php-ext: test-php-ext
	node scripts/check-parity.mjs --kind php-ext
