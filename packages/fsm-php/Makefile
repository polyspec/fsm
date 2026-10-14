# The php package (docs/plans/fsm-v1.md, C-2). gen writes the generated files: src/ and tests/ConformanceTest.php with the fsm-gen
# of the compiler, and examples/model with orm-gen from the root schema/persist.dbs. DEST names the directory of the generated
# files (DEST ?= .), so that gen-check can write them into var/gen-check/php and compare them with the working tree. NAMESPACE is
# the namespace of the generated code: the test bench uses Polyspec\FsmTest, which the php-ext package shares for its tests.
# The test target runs phpunit with this directory as its working directory (run-tests --cwd); its --results and --inputs paths
# are relative to the checkout root, as in the npm package.
ROOT := ../..
# The test runner of kit, from the installed @polyspec/kit of the checkout root (make install-packages). It takes its working
# directory as the checkout root, so the test target runs it there and names every path from the root.
RUN_TESTS := node node_modules/@polyspec/kit/dist/run-tests.mjs
DEST ?= .
FSM_GEN := node $(ROOT)/packages/fsm-compiler/src/cli/fsm-gen.mjs
NAMESPACE := Polyspec\FsmTest

.PHONY: install gen test

# install downloads the release zips of orm and ordered-json into artifacts/, the artifact repository of composer.json, with
# the composer-artifacts target of the root, then installs the dependencies of composer.lock; gen and test need them.
install:
	$(MAKE) -C $(ROOT) composer-artifacts DIR=packages/fsm-php/artifacts
	composer install --no-interaction --no-progress

gen:
	$(FSM_GEN) gen --project $(ROOT) --kind php --php-namespace '$(NAMESPACE)' --out $(DEST)/src
	$(FSM_GEN) vectors --project $(ROOT) --kind php --php-namespace '$(NAMESPACE)' --out $(DEST)/tests/ConformanceTest.php
	./vendor/bin/orm-gen gen --set $(ROOT)/schema/dbspec-set.json --out $(DEST)/examples/model --namespace '$(NAMESPACE)\Model'

test:
	cd $(ROOT) && $(RUN_TESTS) phpunit --cwd packages/fsm-php --results .results/php.json --inputs packages/fsm-php --inputs schema/persist.dbs --inputs schema/dbspec-set.json -- tests
