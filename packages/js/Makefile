# The npm package (docs/plans/fsm-v1.md, C-2). gen writes the generated files: src/ and tests/vectors.mjs with the fsm-gen
# of the compiler, and examples/model with orm-gen from the root contracts/schema/persist.dbs. DEST names the directory of the generated
# files (DEST ?= .), so that gen-check can write them into var/gen-check/npm and compare them with the working tree. The test
# target runs node from the checkout root with root-relative paths: node names each file relative to its working directory, and
# the kit reporter matches the file group by that name, so a working directory other than the root would be misread. The test
# target names the conformance file only: the type check of tests/types.test.mjs has its own record (make npm-types), and the
# conformance test of this kind must hold vector cases alone for kit's parity check.
ROOT := ../..
# The test runner of kit, from the installed @polyspec/kit of the checkout root (make install-packages). It takes its working
# directory as the checkout root, so the test target runs it there and names every path from the root.
RUN_TESTS := node node_modules/@polyspec/kit/dist/run-tests.mjs
DEST ?= .
FSM_GEN := node $(ROOT)/packages/compiler/src/cli/fsm-gen.mjs

.PHONY: install gen test

# install installs the dependencies of package-lock.json (the orm release); gen and test need them.
install:
	npm ci --allow-remote=root --no-audit --no-fund

gen:
	$(FSM_GEN) gen --project $(ROOT)/contracts --kind npm --out $(DEST)/src
	$(FSM_GEN) vectors --project $(ROOT)/contracts --kind npm --out $(DEST)/tests/vectors.mjs
	./node_modules/.bin/orm-gen gen --set $(ROOT)/contracts/schema/dbspec-set.json --out $(DEST)/examples/model

test:
	cd $(ROOT) && $(RUN_TESTS) node --results .results/npm.json --inputs packages/js --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- packages/js/tests/conformance.test.mjs
