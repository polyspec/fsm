<!-- doc-id: changelog -->
# Changelog

[한국어](CHANGELOG.ko.md)

<a id="unreleased"></a>
## Unreleased

- S-02: `docs/spec/status.md` fixes the definition: the model of three parts (machine, states with codes, events of edges), the three stores under one rule set, the lock of codes, the idempotent transition `apply(expected, event, actual)`, the validation codes and the naming rule of the six targets. The plan points to it, so the definition has one source.
- S-01: the repository adopts kit v0.0.14 (`scripts/kit/`, `tests/kit/`, `.kit/kit.lock.json`) with `config/checklist.json`, `config/commits.json`, `config/documents.json`, `config/owner-checks.json`, `config/toolchain.json` (Node.js only), `config/dependency-policy.json` and its review record; the hooks run the owner validation (pre-commit), the commit rules (commit-msg) and the push gate (pre-push). `AGENTS.md` holds the development rules, `docs/plans/status-v1.md` the plan and `docs/plans/execution-checklist.md` its items. `make check` runs the full suite once per tree.
