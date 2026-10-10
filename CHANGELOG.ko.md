<!-- doc-id: changelog -->
<!-- source-sha256: f9e7a53c072da77275b973560a5d2f7098fb6f64af9a20d957e04605dfb344e1 -->
# 변경 기록

[English](CHANGELOG.md)

<a id="unreleased"></a>
## Unreleased

- S-01: 저장소가 kit v0.0.14(`scripts/kit/`, `tests/kit/`, `.kit/kit.lock.json`)를 채택하고 `config/checklist.json`, `config/commits.json`, `config/documents.json`, `config/owner-checks.json`, `config/toolchain.json`(Node.js만), `config/dependency-policy.json`과 그 review 기록을 둔다. hook은 owner 검증(pre-commit), commit 규칙(commit-msg), push gate(pre-push)를 실행한다. `AGENTS.md`는 개발 규칙, `docs/plans/status-v1.md`는 계획, `docs/plans/execution-checklist.md`는 그 항목을 담는다. `make check`는 전체 스위트를 트리당 한 번 실행한다.
