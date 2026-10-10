# The tools of every run are the releases that the tracked declaration files name: Node.js in .node-version. Each language
# package item adds the declaration of its toolchain (config/toolchain.json).
export PATH := $(CURDIR)/var/tools/bin:$(PATH)

# The shared targets of kit (scripts/kit/kit.mk, vendored by make kit-sync): the gates, the document, owner and commit checks,
# the toolchains and the dependency gate. They read the configuration in config/*.json.
include scripts/kit/kit.mk

# The targets of the full suite that make check runs through the guard of scripts/kit/full-run.mjs. Each checklist item
# appends the targets that it defines (docs/plans/status-v1.md, Verification).
CHECK_TARGETS := kit-check owner-validate documents-check commits-check hooks-check toolchain-check dependency-policy-check

.PHONY: check

# check runs the full suite once per committed tree, when no item of docs/plans/execution-checklist.md is [~]
# (scripts/kit/full-run.mjs); it records its result in var/full-run.json.
check:
	node scripts/kit/full-run.mjs run $(CHECK_TARGETS)
