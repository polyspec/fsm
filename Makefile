# The tools of every run are the releases that the tracked declaration files name: Node.js in .node-version. Each language
# package item adds the declaration of its toolchain (config/toolchain.json).
export PATH := $(CURDIR)/var/tools/bin:$(PATH)

# The shared targets of kit (scripts/kit/kit.mk, vendored by make kit-sync): the gates, the document, owner and commit checks,
# the toolchains and the dependency gate. They read the configuration in config/*.json.
include scripts/kit/kit.mk

# The targets of the full suite that make check runs through the guard of scripts/kit/full-run.mjs. Each checklist item
# appends the targets that it defines (docs/plans/status-v1.md, Verification). TOOL_TESTS are the tests of the tools, whose
# records parity-check requires.
comma := ,
TOOL_TESTS := layout-test parity-test compiler-test gen-check-test db-test
CHECK_TARGETS := kit-check owner-validate documents-check commits-check hooks-check toolchain-check dependency-policy-check layout-test layout-check parity-test compiler-test gen-check-test gen-check db-test parity-check

.PHONY: check layout-test layout-check parity-test compiler-test gen-check-test gen-check db-deps db-test parity-check

# check runs the full suite once per committed tree, when no item of docs/plans/execution-checklist.md is [~]
# (scripts/kit/full-run.mjs); it records its result in var/full-run.json.
check:
	node scripts/kit/full-run.mjs run $(CHECK_TARGETS)

# layout-test runs the tests of scripts/check-layout.mjs; layout-check checks the language packages against
# contracts/layout.json (docs/plans/status-v1.md, C-2).
layout-test:
	node scripts/kit/run-tests.mjs node --results .results/layout-test.json --inputs scripts/check-layout.mjs --inputs tests/check-layout -- tests/check-layout

layout-check:
	node scripts/check-layout.mjs

# parity-test runs the tests of scripts/check-parity.mjs. parity-check, the last target of the full suite, requires that every
# kind ran every vector case once and passed and that every tool test left a current record (docs/plans/status-v1.md, C-4).
parity-test:
	node scripts/kit/run-tests.mjs node --results .results/parity-test.json --inputs scripts/check-parity.mjs --inputs tests/check-parity -- tests/check-parity

# compiler-test runs the tests of packages/status-compiler, the core validation of a definition (docs/plans/status-v1.md, C-5)
# with the editor schema schema/status.schema.json, which the tests check against the core.
compiler-test:
	node scripts/kit/run-tests.mjs node --results .results/compiler-test.json --inputs packages/status-compiler --inputs schema --inputs machines --inputs conformance --inputs contracts/features.json --inputs status.lock.json --inputs status.config.json -- packages/status-compiler/tests

# gen-check-test runs the tests of scripts/gen-check.mjs; gen-check regenerates the generated files into var/gen-check and
# requires them to equal the working tree (docs/plans/status-v1.md, C-5).
gen-check-test:
	node scripts/kit/run-tests.mjs node --results .results/gen-check-test.json --inputs scripts/gen-check.mjs --inputs tests/gen-check -- tests/gen-check

gen-check:
	node scripts/gen-check.mjs

# db-deps installs the packages of packages/status-db (orm and ordered-json from their release tarballs, pinned in its
# package-lock.json). db-test runs the tests of packages/status-db: the DB store against the store contract, the round trips
# of json and db, the atomicity of save, the CLI, and the generated models, which orm-gen must reproduce from schema/status.dbs
# (docs/plans/status-v1.md, C-6).
db-deps:
	cd packages/status-db && npm ci --no-audit --no-fund

db-test: db-deps
	node scripts/kit/run-tests.mjs node --results .results/db-test.json --inputs packages/status-db/src --inputs packages/status-db/tests --inputs packages/status-db/package.json --inputs packages/status-db/package-lock.json --inputs packages/status-compiler --inputs schema/status.dbs -- packages/status-db/tests

parity-check:
	node scripts/check-parity.mjs --tools $(subst $(eval) ,$(comma),$(TOOL_TESTS))
