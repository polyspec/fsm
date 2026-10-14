# The rust package (docs/plans/fsm-v1.md, C-2). gen writes the generated files: src/ and tests/conformance/vectors.rs with the fsm-gen of
# the compiler. The orm models of contracts/schema/persist.dbs are written by build.rs into OUT_DIR, so gen writes no model directory: that
# is the declared difference of rust. DEST names the directory of the generated files (DEST ?= .), so that gen-check can write them
# into var/gen-check/rust and compare them with the working tree. The test target runs cargo from the checkout root with the
# manifest path, so the paths of the kit reporter are root-relative, as in the npm package.
ROOT := ../..
# The test runner of kit, from the installed @polyspec/kit of the checkout root (make install-packages). It takes its working
# directory as the checkout root, so the test target runs it there and names every path from the root.
RUN_TESTS := node node_modules/@polyspec/kit/dist/run-tests.mjs
DEST ?= .
FSM_GEN := node $(ROOT)/packages/compiler/src/cli/fsm-gen.mjs

.PHONY: install gen test

# install fetches the crates of Cargo.lock (the orm release from its git tag); gen and test need them.
install:
	cargo fetch --locked --manifest-path Cargo.toml

gen:
	$(FSM_GEN) gen --project $(ROOT)/contracts --kind rust --out $(DEST)/src
	$(FSM_GEN) vectors --project $(ROOT)/contracts --kind rust --out $(DEST)/tests/conformance/vectors.rs

test:
	cd $(ROOT) && $(RUN_TESTS) cargo --results .results/rust.json --inputs packages/rust --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- --manifest-path packages/rust/Cargo.toml --test conformance
