# The rust package (docs/plans/status-v1.md, C-2). gen writes the generated files: src/ and tests/vectors.rs with the status-gen of
# the compiler. The orm models of schema/persist.dbs are written by build.rs into OUT_DIR, so gen writes no model directory: that
# is the declared difference of rust. DEST names the directory of the generated files (DEST ?= .), so that gen-check can write them
# into var/gen-check/rust and compare them with the working tree. The test target runs cargo from the checkout root with the
# manifest path, so the paths of the kit reporter are root-relative, as in the npm package.
ROOT := ../..
DEST ?= .
STATUS_GEN := node $(ROOT)/packages/status-compiler/src/cli/status-gen.mjs

.PHONY: install gen test

# install fetches the crates of Cargo.lock (the orm release from its git tag); gen and test need them.
install:
	cargo fetch --locked --manifest-path Cargo.toml

gen:
	$(STATUS_GEN) gen --project $(ROOT) --kind rust --out $(DEST)/src
	$(STATUS_GEN) vectors --project $(ROOT) --kind rust --out $(DEST)/tests/vectors.rs

test:
	node $(ROOT)/scripts/kit/run-tests.mjs cargo --results .results/rust.json --inputs packages/status-rust --inputs schema/persist.dbs -- --manifest-path packages/status-rust/Cargo.toml
