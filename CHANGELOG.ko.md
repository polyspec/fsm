<!-- doc-id: changelog -->
<!-- source-sha256: 31b1e2bf51b1e7a9b950d3a17609b53f1e33227d4cdbc5d11d198208a438e1a9 -->
# 변경 기록

[English](CHANGELOG.md)

<a id="unreleased"></a>
## Unreleased

- S-05-3: core `validate`는 machine·상태·이벤트 key의 길이를 64자로 제한한다. 64자를 넘는 key는 해당 경로에서 `E_KEY_FORMAT`으로 실패하며, 메시지는 길이와 상한을 밝힌다. DB store는 key를 `varchar(64)`에 담으므로, 이 상한으로 세 store가 같은 key를 받아들인다(`docs/spec/status.md`, B-5).
- S-06: core `normalize`는 유효한 정의의 IR을 돌려주고(`src/core/normalize.mjs`), `lockMismatch`, `nextLock`, `nextCode`, `canonicalLock`은 B-3의 code lock을 구현하며(`src/core/lock.mjs`), `nextLock`은 lock이 가진 code를 정의가 바꾸는 key를 `E_CODE_CHANGED`로 거부한다. `run`(`check`, `lock`, `save`)과 `copy`는 B-2의 명령을 store 위에서 실행한다(`src/core/run.mjs`). JSON store(`src/store-json/store.mjs`)는 `machines/*.status.json`과 `status.lock.json`을 정규 형식으로 읽고 쓰며 store 계약(`tests/store-contract.mjs`)을 통과한다. `status-gen`(`src/cli/status-gen.mjs`)은 `check`, `lock`, `copy`를 제공하고, mermaid store는 S-08 전까지 `E_STORE_NOT_CONFIGURED`로 남는다.
- S-05-2: core `validate`는 B-5의 이름·code 오류 `E_KEY_FORMAT`, `E_DUPLICATE_KEY`, `E_KEY_RESERVED`(고정 목록은 `packages/status-compiler/src/core/reserved.mjs`), `E_DUPLICATE_CODE`, `E_CODE_RANGE`를 보고한다. machine key는 `_`를 뺀 뒤 비교하며, 구조 오류가 있는 machine은 다른 machine과 비교하지 않는다.
- S-05-1: core `validate`는 B-5의 그래프 오류 `E_UNKNOWN_STATE_REF`, `E_SELF_LOOP`, `E_NONDETERMINISTIC`, `E_DUPLICATE_EDGE`, `E_INITIAL_COUNT`, `E_FINAL_OUTGOING`, `E_UNREACHABLE`, `E_DEAD_END`을 보고하며, 각 코드마다 자기 실패 케이스가 있다. 도달 가능성은 단일 initial 상태에서 시작하며, 구조 오류가 있는 machine은 `E_SCHEMA` finding만 보고한다.
- S-05: core `validate`(`packages/status-compiler/src/core/validate.mjs`)는 정의의 구조 오류를 모두 JSON 경로와 함께 `E_SCHEMA`로 보고하고, 그 machine의 뒤 규칙은 건너뛴다. `schema/status.schema.json`은 kit `schema-validate.mjs`의 키워드만 쓰는 에디터 schema이며, 대응 테스트가 모든 fixture에서 core와 일치함을 확인한다. `make compiler-test`는 `run-tests.mjs`로 테스트를 실행하고 `.results/compiler-test.json`을 기록한다.
- JSON store는 엣지를 쌍 대신 객체 `{from, to}`로 쓴다. 그래서 에디터 schema가 정확히 검사하고 GUI 폼은 행으로 편집한다(`docs/spec/status.md`, B-1).
- S-04: `scripts/check-parity.mjs`(`make parity-check`, `--kind`를 쓰는 `make parity-<kind>`)는 다음을 만족하지 않으면 실패한다: 모든 kind가 자기 패키지를 덮는 최신 기록에서 `conformance/vectors`의 모든 케이스를 한 번씩 실행해 통과하고, `contracts/features.json`의 모든 기능이 vector 케이스를 가지며, 모든 test id가 케이스 하나를 가리키거나 그 부모이고, `TOOL_TESTS`의 모든 도구 테스트가 통과한 최신 기록을 남기고, 10분을 넘긴 기록이 없다. 면제는 없다.
- S-03: `scripts/check-layout.mjs`(`make layout-check`)가 언어 패키지를 `contracts/layout.json`과 대조한다: 패키지 디렉터리는 정확히 tools와 kinds이고, kind의 모든 파일은 정규 layout에 맞으며, 정규·필수 파일이 모두 있고, php와 php-ext의 테스트는 바이트가 같다. `make layout-test`는 그 테스트를 `run-tests.mjs`로 실행하고 `.results/layout-test.json`을 기록한다.
- S-02: `docs/spec/status.md`가 정의를 고정한다: 세 부분의 모델(machine, code를 가진 상태, edge로 된 event), 규칙 하나 아래의 세 store, code lock, 멱등 전이 `apply(expected, event, actual)`, 검증 코드, 여섯 타깃의 이름 규칙. 계획은 이 문서를 가리키므로 정의의 원본은 하나다.
- S-01: 저장소가 kit v0.0.14(`scripts/kit/`, `tests/kit/`, `.kit/kit.lock.json`)를 채택하고 `config/checklist.json`, `config/commits.json`, `config/documents.json`, `config/owner-checks.json`, `config/toolchain.json`(Node.js만), `config/dependency-policy.json`과 그 review 기록을 둔다. hook은 owner 검증(pre-commit), commit 규칙(commit-msg), push gate(pre-push)를 실행한다. `AGENTS.md`는 개발 규칙, `docs/plans/status-v1.md`는 계획, `docs/plans/execution-checklist.md`는 그 항목을 담는다. `make check`는 전체 스위트를 트리당 한 번 실행한다.
