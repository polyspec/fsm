<!-- doc-id: changelog -->
<!-- source-sha256: 40c933c0a1365323893e0b13b391f51cb3fb606736f61a11fe46ca1d54c5cc05 -->
# 변경 기록

[English](CHANGELOG.md)

<a id="unreleased"></a>
## Unreleased

- S-02: `docs/spec/status.md`가 정의를 고정한다: 세 부분의 모델(machine, code를 가진 상태, edge로 된 event), 규칙 하나 아래의 세 store, code lock, 멱등 전이 `apply(expected, event, actual)`, 검증 코드, 여섯 타깃의 이름 규칙. 계획은 이 문서를 가리키므로 정의의 원본은 하나다.
- S-01: 저장소가 kit v0.0.14(`scripts/kit/`, `tests/kit/`, `.kit/kit.lock.json`)를 채택하고 `config/checklist.json`, `config/commits.json`, `config/documents.json`, `config/owner-checks.json`, `config/toolchain.json`(Node.js만), `config/dependency-policy.json`과 그 review 기록을 둔다. hook은 owner 검증(pre-commit), commit 규칙(commit-msg), push gate(pre-push)를 실행한다. `AGENTS.md`는 개발 규칙, `docs/plans/status-v1.md`는 계획, `docs/plans/execution-checklist.md`는 그 항목을 담는다. `make check`는 전체 스위트를 트리당 한 번 실행한다.
