# The python package (docs/plans/status-v1.md, C-2). install creates the virtual environment .venv with PYTHON, which must be
# Python 3.14 (config/toolchain.json python), and installs the orm pinned in pyproject.toml into it (ONLINE). PYTHON defaults to
# the absolute path of var/tools/bin/python3, which the root `make install-python` links to the uv-managed Python 3.14; an absolute
# path is used, not a PATH lookup, because a venv made through PATH resolved to the system 3.9 in make -C. gen writes the
# generated files: src/polyspec_status/ and tests/vectors.py with the status-gen of the compiler, and examples/model/ with orm-gen
# from the root schema/persist.dbs. DEST names the directory of the generated files (DEST ?= .), so that gen-check can write them
# into var/gen-check/python and compare them with the working tree. test runs offline with the venv first on PATH, so that
# python3 is the Python of the venv, and it runs from the checkout root with root-relative paths, because the kit reporter names
# the file group relative to the working directory.
ROOT := ../..
DEST ?= .
PYTHON ?= $(abspath $(ROOT))/var/tools/bin/python3
VENV := .venv
STATUS_GEN := node $(ROOT)/packages/status-compiler/src/cli/status-gen.mjs

# No bytecode: a __pycache__ written into src/ is a file without the generated header, which gen refuses.
export PYTHONDONTWRITEBYTECODE := 1

.PHONY: install gen test

# install creates the venv of PYTHON and installs the pinned dependencies of pyproject.toml; gen and test need them.
install:
	@$(PYTHON) -c 'import sys; sys.exit(0 if sys.version_info[:2] == (3, 14) else "PYTHON must be Python 3.14, it is " + sys.version.split()[0])' || { echo "install: run make install-python at the root, or use PYTHON=<path to python3.14>"; exit 1; }
	$(PYTHON) -m venv $(VENV)
	$(VENV)/bin/python -m pip install --no-input -e .

gen:
	$(STATUS_GEN) gen --project $(ROOT) --kind python --out $(DEST)/src/polyspec_status
	$(STATUS_GEN) vectors --project $(ROOT) --kind python --out $(DEST)/tests/vectors.py
	$(VENV)/bin/orm-gen gen --schema $(ROOT)/schema/persist.dbs --out $(DEST)/examples/model

test:
	@test -x $(VENV)/bin/python || { echo "test: $(VENV) is missing; run make install first"; exit 1; }
	PATH=$(CURDIR)/$(VENV)/bin:$$PATH node $(ROOT)/scripts/kit/run-tests.mjs python --results .results/python.json --inputs packages/status-python --inputs schema/persist.dbs -- discover -s packages/status-python/tests -t packages/status-python/tests
