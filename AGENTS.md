<!-- doc-id: agents -->
# Development

[한국어](AGENTS.ko.md)

## Purpose

fsm defines state machines once and generates code for go, npm (js + d.ts), php, php-ext, python and rust. The plan,
the scope (R1–R12) and the design are in `docs/plans/fsm-v1.md`; the definition is fixed in `docs/spec/fsm.md`.

## Judgement

- Every decision is judged by what is right. "The existing rule says so" is not a reason.
- A standard can be corrected with evidence. Lowering a standard because a test is hard to pass is forbidden.
- When a judgement is hard or new reasoning appears, verify it adversarially with agents: they give the exact location
  and the replacement, each finding is judged against its evidence, and the loop repeats until no core disagreement is
  left. An audit names the requirement (R-id) it violates or the contradiction it finds; other findings are minor.
- A decision is recorded in the document it concerns.

## Rules

- English documents are canonical. Every document has a `.ko.md` file with the same information and a `source-sha256`
  marker (`make documents-stamp`); Korean documents write technical terms in English.
- Vendored files (`scripts/kit/`, `tests/kit/`) are changed in kit and copied with `make kit-sync KIT_TAG=<tag>`, never
  edited here.
- Every change follows RED → implementation → GREEN. A checklist item states its observable criterion.
- The base test of a feature lives in the package that owns it (compiler, DB store, GUI). Language packages hold only
  consumer-side tests. The root holds only the tests of its own tools and the vendored `tests/kit/`. Fixtures of the
  root tool tests are built in temporary directories and never committed.
- Every test runs through `scripts/kit/run-tests.mjs`, which prints the start, the progress, the result and the elapsed
  time of each case and gives each case its own timeout. No run has an overall timeout, and no test process runs longer
  than 10 minutes; a longer one is reported with its reason.
- During an item only the owner checks of the changed paths run (`config/owner-checks.json`). The full suite runs once
  per tree with `make check` after the last item is committed.
- A change of a public API or of how the library is used updates, in the same item, the README of the root and of every
  package it concerns (English and Korean) and the documentation site.
- No hidden errors: no fallback, no silent conversion or drop, no null return, no backward-compatibility layer.
- No external sources in git files: only adopt / not-adopt verdicts in generic wording. polyspec repositories (kit, orm,
  hyper, crudui, template and others) are internal libraries and may be cited.

## Checklist

`docs/plans/execution-checklist.md` is the only checklist of this plan. A task is `[ ]` waiting, `[~]` in progress, `[o]`
done, `[!] cause: <cause>; retry: <condition>` bypassed or `[-] cause: <cause>` impossible. An `[o]` task is never
reopened; a new issue gets a sub-id such as `S-07-1`. Independent tasks may run in parallel, but finishing comes before
starting: the number of `[~]` tasks does not grow while none becomes `[o]`.

## Commits

- A commit message is `type(scope): Subject (#S-xx)` in English: a subject of at most 50 characters that starts with a
  capital, has no period and is imperative; a blank line; a body wrapped at 72 characters that says what changed and why.
  Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`.
- The uncommitted scope is at most one checklist item. When an item becomes `[o]`, the same commit updates the checklist
  and both changelogs.
- A record states the real reason. A change unrelated to the item is committed separately with its own reason.

Enforced by tools: the message format (`commits-check`, commit-msg hook), one item per commit and the changelog of a
finished item (commit-msg hook), the checklist format (`documents-check`), no push in the `[~]` state (`push-gate`) and
path ownership (`owner-validate`, pre-commit hook), and that no tracked file names the library by its
old name `status` except the reasoned entries of `scripts/check-name.mjs` (`name-check`). Review rules without a tool: imperative mood and What/Why, RED before
GREEN, the test location, branch naming and deletion, no external sources, experimental code removed, WIP control,
dependency pins, and that a conformance check asserts the expected value of its vector.

## Branches and worktrees

Work on `main` directly is allowed. A branch is `{type}/{shortname}-{id}` and a worktree `fsm-{shortname}-{id}`; both are
deleted right after the merge into `main`, because a merged branch or worktree takes space, scatters folders and hides
which branches are merged. Test or experimental code that cannot enter `main` is, once its test is done, either
cherry-picked into a proper commit when it is worth keeping or discarded, and always removed before the commit; when it
cannot be removed at once, a sub-item records the removal condition. The same holds for the worktrees and the scratch
files of a delegated agent.

An item may be delegated to an agent that works in its own worktree. Whoever delegates reviews the result before the
merge: the RED → GREEN evidence, and that every decision the item made (a new rule, tool, exception or name) is in the
documents it concerns. Knowledge kept only by its author is a reason to reject the change.

Parallel branches meet in the shared records. A merge keeps both sides: every CHANGELOG bullet in item order and, for
each checklist row, the further state; then `make documents-stamp` restamps the Korean documents.
