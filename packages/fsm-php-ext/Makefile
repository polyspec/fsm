# The php-ext package (docs/plans/fsm-v1.md, C-2): the fsm machines as one PHP extension built with phpize. gen writes the
# generated files of the extension (src/) and of the tests with the fsm-gen of the compiler, and of the orm model with orm-gen
# from the root schema/persist.dbs. Its tests and its persist example are copies of the php package's files, made by gen, so
# gen-check proves that they are the same bytes. DEST ?= . names the directory of the generated files, so that gen-check can write
# them into var/gen-check/php-ext and compare them with the working tree. NAMESPACE and EXTENSION are the namespace of the
# generated code and the name of the extension: the test bench uses Polyspec\FsmTest and polyspec_fsm_test.
# The test target builds the extension in src/ (phpize, ./configure, make) and runs phpunit with the built module loaded; its
# --results and --inputs paths are relative to the checkout root, as in the php package.
ROOT := ../..
DEST ?= .
PHP := $(ROOT)/packages/fsm-php
FSM_GEN := node $(ROOT)/packages/fsm-compiler/src/cli/fsm-gen.mjs
NAMESPACE := Polyspec\FsmTest
EXTENSION := polyspec_fsm_test
MODULE := packages/fsm-php-ext/src/modules/$(EXTENSION).so

.PHONY: install gen build test clean

# install installs the dependencies of composer.lock (the orm release and phpunit); gen and test need them.
install:
	composer install --no-interaction --no-progress

gen:
	mkdir -p $(DEST)/src $(DEST)/tests $(DEST)/examples
	$(FSM_GEN) gen --project $(ROOT) --kind php-ext --php-namespace '$(NAMESPACE)' --php-ext-name $(EXTENSION) --out $(DEST)/src
	$(FSM_GEN) vectors --project $(ROOT) --kind php-ext --php-namespace '$(NAMESPACE)' --out $(DEST)/tests/ConformanceTest.php
	cp $(PHP)/tests/ConformanceCase.php $(DEST)/tests/ConformanceCase.php
	cp $(PHP)/examples/persist.php $(DEST)/examples/persist.php
	./vendor/bin/orm-gen gen --out $(DEST)/examples/model --namespace '$(NAMESPACE)\Model' $(ROOT)/schema/persist.dbs

# build compiles the extension in src/ with phpize, ./configure and make; the module is then src/modules/<extension>.so.
build:
	cd src && phpize && ./configure && make

# test builds the extension and runs the conformance cases and the persist example with the built module.
test: build
	node $(ROOT)/scripts/kit/run-tests.mjs phpunit --php-extension $(MODULE) --cwd packages/fsm-php-ext --results .results/php-ext.json --inputs packages/fsm-php-ext --inputs schema/persist.dbs -- tests

# clean removes the phpize output of src/ (the generated files and config.m4 stay). gen does not need it: it skips the git-ignored files.
clean:
	cd src && phpize --clean
