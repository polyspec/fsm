# The python package (docs/plans/fsm-v1.md, C-2; docs/plans/execution-checklist.md, S-41, S-41-1, S-34 and S-44). install makes
# the virtual environment .venv with the Python of the checkout, var/tools/mise/shims/python3, which `make install-tools` installs with
# the uv of config/toolchain.json. The venv is made by kit's python-venv (`make python-venv DIR=...` at the checkout root, uv venv
# from that Python), and uv fills it with --link-mode copy: the locked packages of pylock.toml (PEP 751, written by kit's
# `make python-lock` from pyproject.toml and constraints.txt and checked by `make python-lock-check`, so each registry artifact is
# checked against its hash; docs/plans/fsm-v1.md, C-1), then the project itself, editable (ONLINE).
# gen writes the generated files: src/polyspec_fsm/ and tests/vectors.py with the fsm-gen of the compiler, and examples/model/
# with orm-gen from the root schema/persist.dbs. DEST names the directory of the generated files (DEST ?= .), so that gen-check
# can write them into var/gen-check/python and compare them with the working tree. test runs the tests through the kit runner
# with --venv, which runs the venv interpreter only when pyvenv.cfg names the install-tools Python; it runs from the checkout
# root with root-relative paths, because the kit reporter names the file group relative to the working directory.
ROOT := ../..
# The test runner of kit, from the installed @polyspec/kit of the checkout root (make install-packages).
RUN_TESTS := node $(ROOT)/node_modules/@polyspec/kit/dist/run-tests.mjs
DEST ?= .
# PYTHON is not an override: the kit tool makes the venv from var/tools/mise/shims/python3 of the checkout, and this check names that
# interpreter too.
PYTHON := $(abspath $(ROOT))/var/tools/mise/shims/python3
VENV := .venv
PYLOCK := pylock.toml
# uv is the one of config/toolchain.json that install-tools installs (S-44-2), never a uv of PATH.
UV := $(abspath $(ROOT))/var/tools/mise/shims/uv
FSM_GEN := node $(ROOT)/packages/fsm-compiler/src/cli/fsm-gen.mjs

# No bytecode: a __pycache__ written into src/ is a file without the generated header, which gen refuses.
export PYTHONDONTWRITEBYTECODE := 1

.PHONY: install gen test

# install makes the venv from scratch: kit's python-venv makes it, then uv installs the locked packages and the project with
# --link-mode copy. The check of the interpreter version runs first, so a wrong Python fails before a venv is made. The venv is
# removed first, so every install is a fresh venv and a stale venv of another Python never reaches kit's python-venv, which
# refuses it.
install:
	@$(PYTHON) -c 'import sys; sys.exit(0 if sys.version_info[:2] == (3, 14) else "PYTHON must be Python 3.14, it is " + sys.version.split()[0])' || { echo "install: run make install-tools at the root, or use PYTHON=<path to python3.14>"; exit 1; }
	rm -rf $(VENV)
	$(MAKE) -C $(ROOT) python-venv DIR=packages/fsm-python/.venv
	$(UV) pip install --python $(VENV)/bin/python --link-mode copy -r $(PYLOCK)
	$(UV) pip install --python $(VENV)/bin/python --link-mode copy --no-deps -e .

gen:
	$(FSM_GEN) gen --project $(ROOT) --kind python --out $(DEST)/src/polyspec_fsm
	$(FSM_GEN) vectors --project $(ROOT) --kind python --out $(DEST)/tests/vectors.py
	$(VENV)/bin/orm-gen gen --schema $(ROOT)/schema/persist.dbs --out $(DEST)/examples/model

test:
	@test -x $(VENV)/bin/python || { echo "test: $(VENV) is missing; run make install first"; exit 1; }
	$(RUN_TESTS) python --venv $(CURDIR)/$(VENV) --results .results/python.json --inputs packages/fsm-python --inputs schema/persist.dbs -- discover -s packages/fsm-python/tests -t packages/fsm-python/tests
