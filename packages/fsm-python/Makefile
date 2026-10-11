# The python package (docs/plans/fsm-v1.md, C-2; docs/plans/execution-checklist.md, S-41, S-41-1 and S-34). install makes the virtual
# environment .venv with the Python of the checkout, var/tools/bin/python3, which `make install-tools` installs from the
# pythonBuild of config/toolchain.json (python-build-standalone, verified by sha256). The venv is made by the kit tool
# (`make python-venv DIR=...` at the checkout root, scripts/kit/python-venv.mjs, kit K44), which runs CPython's venv module with
# --copies and --without-pip, and removes the lib64 link that CPython makes on 64-bit Linux, so every file of it is a copy and no link
# points outside the venv. uv then fills it with --link-mode copy (uv venv and uv sync write links, which the kit refuses for
# --venv): the locked packages of pylock.toml (PEP 751, exported from uv.lock by uv export --frozen, so each registry artifact is
# checked against its hash and each git package is at the commit the lock records; docs/plans/fsm-v1.md, C-1), then the project
# itself, editable (ONLINE).
# gen writes the generated files: src/polyspec_fsm/ and tests/vectors.py with the fsm-gen of the compiler, and examples/model/
# with orm-gen from the root schema/persist.dbs. DEST names the directory of the generated files (DEST ?= .), so that gen-check
# can write them into var/gen-check/python and compare them with the working tree. test runs the tests through the kit runner
# with --venv, which runs the venv interpreter only when pyvenv.cfg names the install-tools Python and no link exists (kit K37);
# it runs from the checkout root with root-relative paths, because the kit reporter names the file group relative to the working
# directory.
ROOT := ../..
DEST ?= .
# PYTHON is not an override: the kit tool makes the venv from var/tools/bin/python3 of the checkout, and this check names that
# interpreter too.
PYTHON := $(abspath $(ROOT))/var/tools/bin/python3
VENV := .venv
PYLOCK := pylock.toml
UV ?= uv
FSM_GEN := node $(ROOT)/packages/fsm-compiler/src/cli/fsm-gen.mjs

# No bytecode: a __pycache__ written into src/ is a file without the generated header, which gen refuses.
export PYTHONDONTWRITEBYTECODE := 1

.PHONY: install gen test lock-check

# $(PYLOCK) is exported from uv.lock (the lock of the project, which `uv lock` writes). S-34 commits it; until then this target
# writes it, so a later run finds it up to date and needs no network.
$(PYLOCK): uv.lock pyproject.toml
	$(UV) export --format pylock.toml --frozen --no-emit-project -o $(PYLOCK)

# install makes the venv from scratch: the kit tool makes it (copied, no pip, no link), then the locked packages and the project
# with uv --link-mode copy. The check of the interpreter version runs first, so a wrong Python fails before a venv is made. The
# venv is removed first, so every install is a fresh venv and a stale venv of another Python never reaches the kit tool, which
# refuses it (a venv of another Python is an error there: remove the directory and make install again).
install: $(PYLOCK)
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
	node $(ROOT)/scripts/kit/run-tests.mjs python --venv $(CURDIR)/$(VENV) --results .results/python.json --inputs packages/fsm-python --inputs schema/persist.dbs -- discover -s packages/fsm-python/tests -t packages/fsm-python/tests

# lock-check is uv's own check of the lock (S-34-3): uv.lock is current for pyproject.toml (`uv lock --check`, offline), and the
# committed pylock.toml has the body of a fresh export of it (the header names the command, so it is not compared). pyproject.toml
# takes orm and ordered-json from the archives of their release tags, so the lock holds registry packages and archives only.
lock-check:
	$(UV) lock --check --offline
	rm -rf $(ROOT)/var/python-lock && mkdir -p $(ROOT)/var/python-lock
	$(UV) export --format pylock.toml --frozen --no-emit-project --color never -o $(ROOT)/var/python-lock/pylock.toml
	grep -v '^#' $(PYLOCK) > $(ROOT)/var/python-lock/committed.toml
	grep -v '^#' $(ROOT)/var/python-lock/pylock.toml > $(ROOT)/var/python-lock/fresh.toml
	diff $(ROOT)/var/python-lock/committed.toml $(ROOT)/var/python-lock/fresh.toml || { echo "lock-check: $(PYLOCK) is not the export of uv.lock; run uv export --format pylock.toml --frozen --no-emit-project -o $(PYLOCK)"; exit 1; }
