# The php package (docs/plans/fsm-v1.md, C-2). gen writes the generated files: src/ and tests/ConformanceTest.php with the fsm-gen
# of the compiler, and examples/model with orm-gen from the root schema/persist.dbs. DEST names the directory of the generated
# files (DEST ?= .), so that gen-check can write them into var/gen-check/php and compare them with the working tree. NAMESPACE is
# the namespace of the generated code: the test bench uses Polyspec\FsmTest, which the php-ext package shares for its tests.
# The test target runs phpunit with this directory as its working directory (run-tests --cwd); its --results and --inputs paths
# are relative to the checkout root, as in the npm package.
ROOT := ../..
# The test runner of kit, from the installed @polyspec/kit of the checkout root (make install-packages).
RUN_TESTS := node $(ROOT)/node_modules/@polyspec/kit/dist/run-tests.mjs
DEST ?= .
FSM_GEN := node $(ROOT)/packages/fsm-compiler/src/cli/fsm-gen.mjs
NAMESPACE := Polyspec\FsmTest

.PHONY: install gen test

# install installs the dependencies of composer.lock (the orm release and phpunit); gen and test need them.
install:
	composer install --no-interaction --no-progress

gen:
	$(FSM_GEN) gen --project $(ROOT) --kind php --php-namespace '$(NAMESPACE)' --out $(DEST)/src
	$(FSM_GEN) vectors --project $(ROOT) --kind php --php-namespace '$(NAMESPACE)' --out $(DEST)/tests/ConformanceTest.php
	./vendor/bin/orm-gen gen --out $(DEST)/examples/model --namespace '$(NAMESPACE)\Model' $(ROOT)/schema/persist.dbs

test:
	$(RUN_TESTS) phpunit --cwd packages/fsm-php --results .results/php.json --inputs packages/fsm-php --inputs schema/persist.dbs -- tests
