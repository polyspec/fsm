# The php package (docs/plans/status-v1.md, C-2). gen writes the generated files: src/ and tests/Vectors.php with the status-gen
# of the compiler, and examples/model with orm-gen from the root schema/persist.dbs. DEST names the directory of the generated
# files (DEST ?= .), so that gen-check can write them into var/gen-check/php and compare them with the working tree. NAMESPACE is
# the namespace of the generated code: the test bench uses Polyspec\StatusTest, which the php-ext package shares for its tests.
# The test target runs phpunit with this directory as its working directory (run-tests --cwd); its --results and --inputs paths
# are relative to the checkout root, as in the npm package.
ROOT := ../..
DEST ?= .
STATUS_GEN := node $(ROOT)/packages/status-compiler/src/cli/status-gen.mjs
NAMESPACE := Polyspec\StatusTest

.PHONY: install gen test

# install installs the dependencies of composer.lock (the orm release and phpunit); gen and test need them.
install:
	composer install --no-interaction --no-progress

gen:
	$(STATUS_GEN) gen --project $(ROOT) --kind php --php-namespace '$(NAMESPACE)' --out $(DEST)/src
	$(STATUS_GEN) vectors --project $(ROOT) --kind php --php-namespace '$(NAMESPACE)' --out $(DEST)/tests/Vectors.php
	./vendor/bin/orm-gen gen --out $(DEST)/examples/model --namespace '$(NAMESPACE)\Model' $(ROOT)/schema/persist.dbs

test:
	node $(ROOT)/scripts/kit/run-tests.mjs phpunit --cwd packages/status-php --results .results/php.json --inputs packages/status-php --inputs schema/persist.dbs -- tests
