<!-- doc-id: changelog -->
<!-- source-sha256: 1ffcad1e83f22d0715377bc75bb2690ef7e648f1a1f3a53da4827c50cee79b3c -->
# 변경 기록

[English](CHANGELOG.md)

<a id="unreleased"></a>
## Unreleased

- S-04: `scripts/check-parity.mjs`(`make parity-check`, `--kind`를 쓰는 `make parity-<kind>`)는 다음을 만족하지 않으면 실패한다: 모든 kind가 자기 패키지를 덮는 최신 기록에서 `conformance/vectors`의 모든 케이스를 한 번씩 실행해 통과하고, `contracts/features.json`의 모든 기능이 vector 케이스를 가지며, 모든 test id가 케이스 하나를 가리키거나 그 부모이고, `TOOL_TESTS`의 모든 도구 테스트가 통과한 최신 기록을 남기고, 10분을 넘긴 기록이 없다. 면제는 없다.
- S-03: `scripts/check-layout.mjs`(`make layout-check`)가 언어 패키지를 `contracts/layout.json`과 대조한다: 패키지 디렉터리는 정확히 tools와 kinds이고, kind의 모든 파일은 정규 layout에 맞으며, 정규·필수 파일이 모두 있고, php와 php-ext의 테스트는 바이트가 같다. `make layout-test`는 그 테스트를 `run-tests.mjs`로 실행하고 `.results/layout-test.json`을 기록한다.
- S-02: `docs/spec/status.md`가 정의를 고정한다: 세 부분의 모델(machine, code를 가진 상태, edge로 된 event), 규칙 하나 아래의 세 store, code lock, 멱등 전이 `apply(expected, event, actual)`, 검증 코드, 여섯 타깃의 이름 규칙. 계획은 이 문서를 가리키므로 정의의 원본은 하나다.
- S-01: 저장소가 kit v0.0.14(`scripts/kit/`, `tests/kit/`, `.kit/kit.lock.json`)를 채택하고 `config/checklist.json`, `config/commits.json`, `config/documents.json`, `config/owner-checks.json`, `config/toolchain.json`(Node.js만), `config/dependency-policy.json`과 그 review 기록을 둔다. hook은 owner 검증(pre-commit), commit 규칙(commit-msg), push gate(pre-push)를 실행한다. `AGENTS.md`는 개발 규칙, `docs/plans/status-v1.md`는 계획, `docs/plans/execution-checklist.md`는 그 항목을 담는다. `make check`는 전체 스위트를 트리당 한 번 실행한다.
