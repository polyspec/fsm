# The go package (docs/plans/fsm-v1.md, C-2). gen writes the generated files: src/ and tests/vectors_test.go with the
# fsm-gen of the compiler, and examples/model with orm-gen from the root schema/persist.dbs. DEST names the directory of the
# generated files (DEST ?= .), so that gen-check can write them into var/gen-check/go and compare them with the working tree.
# The test target runs go in this directory, where go.mod is, and names the paths of the kit runner from the checkout root.
ROOT := ../..
# The test runner of kit, from the installed @polyspec/kit of the checkout root (make install-packages). It takes its working
# directory as the checkout root, so the test target runs it there and names every path from the root.
RUN_TESTS := node node_modules/@polyspec/kit/dist/run-tests.mjs
DEST ?= .
FSM_GEN := node $(ROOT)/packages/fsm-compiler/src/cli/fsm-gen.mjs
MODULE := github.com/polyspec/fsm-go

.PHONY: install gen test

# install downloads the modules that go.mod and go.sum name (the orm release and orm-gen); gen and test need them.
install:
	go mod download

gen:
	$(FSM_GEN) gen --project $(ROOT) --kind go --go-module $(MODULE) --out $(DEST)/src
	$(FSM_GEN) vectors --project $(ROOT) --kind go --go-module $(MODULE) --out $(DEST)/tests/vectors_test.go
	# orm-gen runs go in the module of its output directory, so the models are generated inside DEST. When DEST is another
	# directory, it receives a copy of go.mod, go.sum and examples/persist.go, which the scan reads; its src/ is the one above.
	mkdir -p $(DEST)/examples
	if [ "$(abspath $(DEST))" != "$(CURDIR)" ]; then cp go.mod go.sum $(DEST)/ && cp examples/persist.go $(DEST)/examples/; fi
	cd $(DEST) && go tool orm-gen gen --set $(CURDIR)/$(ROOT)/schema/dbspec-set.json --lang go --out examples/model --scan ./examples/...

# test runs the conformance cases and the persist example with GOPROXY=off, so that the modules must already be downloaded.
test:
	cd $(ROOT) && GOPROXY=off $(RUN_TESTS) go --cwd packages/fsm-go --results .results/go.json --inputs packages/fsm-go --inputs schema/persist.dbs --inputs schema/dbspec-set.json -- ./tests
