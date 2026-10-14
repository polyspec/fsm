# The php-ext package (docs/plans/fsm-v1.md, C-2): the fsm machines as one PHP extension built with phpize. gen writes the
# generated files of the extension (src/) and of the tests with the fsm-gen of the compiler, and of the orm model with orm-gen
# from the root contracts/schema/persist.dbs. Its tests and its persist example are copies of the php package's files, made by gen, so
# gen-check proves that they are the same bytes. DEST ?= . names the directory of the generated files, so that gen-check can write
# them into var/gen-check/php-ext and compare them with the working tree. NAMESPACE and EXTENSION are the namespace of the
# generated code and the name of the extension: the test bench uses Polyspec\FsmTest and polyspec_fsm_test.
# The test target builds the extension in src/ (phpize, ./configure, make) and runs phpunit with the built module loaded; its
# --results and --inputs paths are relative to the checkout root, as in the php package.
ROOT := ../..
# The test runner of kit, from the installed @polyspec/kit of the checkout root (make install-packages). It takes its working
# directory as the checkout root, so the test target runs it there and names every path from the root.
RUN_TESTS := node node_modules/@polyspec/kit/dist/run-tests.mjs
DEST ?= .
PHP := $(ROOT)/packages/php
FSM_GEN := node $(ROOT)/packages/compiler/src/cli/fsm-gen.mjs
NAMESPACE := Polyspec\FsmTest
EXTENSION := polyspec_fsm_test
MODULE := packages/php-ext/src/modules/$(EXTENSION).so

.PHONY: install gen build test clean

# install downloads the release zips of orm and ordered-json into artifacts/, the artifact repository of composer.json, with
# the composer-artifacts target of the root, then installs the dependencies of composer.lock; gen and test need them.
install:
	$(MAKE) -C $(ROOT) composer-artifacts DIR=packages/php-ext/artifacts
	composer install --no-interaction --no-progress

gen:
	mkdir -p $(DEST)/src $(DEST)/tests $(DEST)/examples
	$(FSM_GEN) gen --project $(ROOT)/contracts --kind php-ext --php-namespace '$(NAMESPACE)' --php-ext-name $(EXTENSION) --out $(DEST)/src
	$(FSM_GEN) vectors --project $(ROOT)/contracts --kind php-ext --php-namespace '$(NAMESPACE)' --out $(DEST)/tests/ConformanceTest.php
	cp $(PHP)/tests/ConformanceCase.php $(DEST)/tests/ConformanceCase.php
	cp $(PHP)/examples/persist.php $(DEST)/examples/persist.php
	./vendor/bin/orm-gen gen --set $(ROOT)/contracts/schema/dbspec-set.json --out $(DEST)/examples/model --namespace '$(NAMESPACE)\Model'

# build compiles the extension in src/ with phpize, ./configure and make; the module is then src/modules/<extension>.so.
build:
	cd src && phpize && ./configure && make

# test builds the extension and runs the conformance cases and the persist example with the built module.
test: build
	cd $(ROOT) && $(RUN_TESTS) phpunit --php-extension $(MODULE) --cwd packages/php-ext --results .results/php-ext.json --inputs packages/php-ext --inputs contracts/schema/persist.dbs --inputs contracts/schema/dbspec-set.json -- tests

# clean removes the phpize output of src/ (the generated files and config.m4 stay). gen does not need it: it skips the git-ignored files.
clean:
	cd src && phpize --clean
