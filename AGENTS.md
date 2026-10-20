<!-- doc-id: agents -->
# Development

[한국어](AGENTS.ko.md)

The working principles of every polyspec repository are [PRINCIPLES.md](PRINCIPLES.md), a copy of kit. This file states
only the rules of fsm.

## Purpose

fsm defines state machines once and generates code for go, npm (js + d.ts), php, php-ext, python and rust. The plan,
the scope (R1–R12) and the design are in `docs/plans/fsm-v1/plan.md`; the definition is fixed in `docs/spec/fsm.md`.

## Rules

- Own: The shared tools are the package `@polyspec/kit`, a devDependency of the root `package.json` pinned to the asset URL of its
  release with its integrity. The files of its `kit.copies` (`scripts/kit/kit-bootstrap.mk`, `scripts/kit/bootstrap/`, the
  release workflow, `PRINCIPLES.md`, `config/layout.kit.yml` and the lint configuration) are copies that `make kit-sync`
  writes from the installed package and `make kit-check` compares; they are changed in kit, never here. fsm imports no file
  of kit: it runs a kit tool through its make target or `$(KIT)/<tool>.$(KIT_EXT)`, imports only what the package exports
  (`@polyspec/kit/tracked-files`), and takes a generic need from its ecosystem library (ajv, picomatch, `node:`) declared in
  its own `package.json`. Behavior of kit is tested in kit.
  Enforced by: `make kit-check`
- Refines P30: The link of fsm runs from the repository root (`kit link <checkout>...`, never with `--project`, which skips the
  nested projects such as `packages/gui`, `packages/db` and `packages/php`) and is never committed.
  Enforced by: `make link-state-check`
- Refines S7: The base test of a feature lives in the package that owns it (compiler, DB store, GUI). Language packages hold only
  consumer-side tests. The root holds only the tests of its own tools and their shared helper `tests/support/`. Fixtures of the
  root tool tests are built in temporary directories and never committed.
  Enforced by: `make layout-check`, `make parity-declarations-check`
- Refines S3: Every test of the `Makefile` runs through `$(RUN_TESTS)`, kit's test runner, which prints the start, the progress, the result and
  the elapsed time of each case and gives each case its own timeout. No run has an overall timeout, and no test process runs
  longer than 10 minutes; a longer one is reported with its reason.
  Enforced by: none, the runner is a judgement of the test scripts.
- Refines P20: During an item only the owner checks of the changed paths run (`config/owner-checks.json`). The full suite runs once per
  tree with `make check` after the last item is committed.
  Enforced by: `make owner-validate`
- Own: A change of a public API or of how the library is used updates, in the same item, the README of the root and of every
  package it concerns (English and Korean) and the documentation site.
  Enforced by: none, a judgement at review; `make readme-check` checks only the sections of each README pair.
- Own: git files name no external source: only adopt / not-adopt verdicts in generic wording. polyspec repositories (kit, orm,
  hyper, crudui, template and others) are internal libraries and may be cited.
  Enforced by: none, a judgement at review.
- Own: No symbolic links and no relative paths in what this repository creates (tracked files, configuration, scripts,
  generated output). Paths are resolved declaratively (named in a tracked file) or by discovery (a stated discovery rule).
  Enforced by: none, a judgement at review.
- Own: No tracked file names the library by its old name `status`, except the reasoned entries of `scripts/check-name.mts`.
  Enforced by: `make name-check`
- Own: Every README pair (root, compiler, db, GUI, language packages) has its required sections and a Korean twin with the same
  headings (`scripts/check-readmes.mts`).
  Enforced by: `make readme-check`

## Generated files

- Own: Generated files are never tracked in Git. This covers dependency installs (`node_modules/`, `vendor/`, virtual environments), build output (`dist/`, `target/`, `*.tsbuildinfo`), caches (`.cache/`, `__pycache__/`, `.pytest_cache/`), test run artifacts (`test-results/`, `playwright-report/`, PHPUnit caches) and tool downloads (`var/`). The only exceptions are the files the repository deliberately needs: lock files (`package-lock.json`, `composer.lock`, `Cargo.lock`, uv locks, `mise.lock`), committed generated documents that this file names, and test fixtures. Each `.gitignore` covers these paths; a new generator adds its ignore entry in the same commit.
  Enforced by: none, a judgement at review; `make kit-check` checks the copies of kit only.

## Checklist

- Refines P24: `docs/plans/fsm-v1/checklist.md` is the only checklist of this plan. An `[o]` task is never reopened; a new issue gets a sub-id such as `S-07-1`.
  Enforced by: `make docs-check`

## Parallel records

- Own: Parallel branches meet in the shared records. A merge keeps both sides: every CHANGELOG bullet in item order and, for each checklist row, the further state; then `make documents-stamp` restamps the Korean documents.
  Enforced by: `make docs-check`
