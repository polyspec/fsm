<!-- doc-id: changelog -->
# Changelog

[한국어](CHANGELOG.ko.md)

<a id="unreleased"></a>
## Unreleased

- S-05: core `validate` (`packages/status-compiler/src/core/validate.mjs`) reports every structural error of a definition as `E_SCHEMA` with its JSON path and skips the later rules of that machine. `schema/status.schema.json` is the editor schema, written with the keywords of kit `schema-validate.mjs`; the correspondence test checks that it and the core agree on every fixture. `make compiler-test` runs the tests through `run-tests.mjs` and records `.results/compiler-test.json`.
- The JSON store writes an edge as the object `{from, to}` instead of a pair, so the editor schema checks it exactly and a GUI form edits it as a row (`docs/spec/status.md`, B-1).
- S-04: `scripts/check-parity.mjs` (`make parity-check`, `make parity-<kind>` with `--kind`) fails unless every kind ran every vector case of `conformance/vectors` once and passed, from a current record that covers its package, every feature of `contracts/features.json` has a vector case, every test id names one case or is the parent of one, every tool test of `TOOL_TESTS` left a current passing record, and no record ran over 10 minutes. There is no exemption.
- S-03: `scripts/check-layout.mjs` (`make layout-check`) checks the language packages against `contracts/layout.json`: the package directories are exactly the tools and the kinds, every file of a kind matches its canonical layout, every canonical and required file exists, and the php and php-ext tests are the same bytes. `make layout-test` runs its tests through `run-tests.mjs` and records `.results/layout-test.json`.
- S-02: `docs/spec/status.md` fixes the definition: the model of three parts (machine, states with codes, events of edges), the three stores under one rule set, the lock of codes, the idempotent transition `apply(expected, event, actual)`, the validation codes and the naming rule of the six targets. The plan points to it, so the definition has one source.
- S-01: the repository adopts kit v0.0.14 (`scripts/kit/`, `tests/kit/`, `.kit/kit.lock.json`) with `config/checklist.json`, `config/commits.json`, `config/documents.json`, `config/owner-checks.json`, `config/toolchain.json` (Node.js only), `config/dependency-policy.json` and its review record; the hooks run the owner validation (pre-commit), the commit rules (commit-msg) and the push gate (pre-push). `AGENTS.md` holds the development rules, `docs/plans/status-v1.md` the plan and `docs/plans/execution-checklist.md` its items. `make check` runs the full suite once per tree.
