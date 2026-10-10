<!-- doc-id: execution-checklist -->
<!-- source-sha256: 3219aa64f1c8c54388a1179ab9a6a34971c8bb4a8b3b84fe12c144d7ed16a69e -->
# 실행 체크리스트

## status v1

| ID | 작업 | RED → GREEN | 상태 |
|---|---|---|---|
| S-01 | git init, kit v0.0.14, config(toolchain은 Node.js만, dependency policy는 빈 목록과 review 기록), hook, AGENTS.md(.ko), 이 체크리스트, CHANGELOG, 계획, `CHECK_TARGETS`와 `check` | `kit-check owner-validate documents-check commits-check toolchain-check hooks-check dependency-policy-check` 통과 | [o] |
| S-02 | `docs/spec/status.md(.ko)`: 계획 B절을 고정한 정의 | `documents-check`가 쌍 없이 실패, 있으면 통과 | [o] |
| S-03 | `scripts/check-layout.mjs` + `contracts/layout.json`(tools, kinds = {}, kind마다 required 파일과 allowed glob을 담는 객체) + `layout-test`/`layout-check` | fixture(kinds 불일치/추가/누락/개명/php↔php-ext 불일치/형식 오류) RED → GREEN | [o] |
| S-04 | `scripts/check-parity.mjs`(`--kind` 포함) + `parity-test` | fixture(결과 없음/도구 결과 없음/`--kind`는 자기 kind만 읽음/stale inputs/미실행/미등록/0케이스/fail/timeout/skip/이름 일치 0·2개/부모 id/10분 초과) RED → GREEN | [o] |
| S-05 | core `E_SCHEMA` + schema 대응 테스트 | RED → GREEN | [o] |
| S-05-1 | core 그래프 오류 | 오류 코드별 RED → GREEN | [o] |
| S-05-2 | core 이름·code 오류 | 오류 코드별 RED → GREEN | [o] |
| S-05-3 | core key 길이: machine·상태·이벤트 key는 64자 이하(E_KEY_FORMAT)이며, DB store의 varchar(64)가 모든 유효 key를 담는다 | 64 통과, 65 RED → GREEN | [o] |
| S-06 | normalize/IR + lock(rename/reserved) + JsonStore + store 계약 + `run`/`copy` | lock 시나리오별 RED → GREEN | [o] |
| S-06-1 | 비동기 store 계약: 모든 store의 load()·save()와 core run/copy가 Promise를 돌려주어 DB store가 비동기 orm client를 쓸 수 있다. validate, normalize, lock, vectors는 동기로 남는다 | 계약 테스트가 모든 store에서 Promise를 await RED → GREEN | [o] |
| S-07 | `status.config.json` + `machines/order.status.json` + `status.lock.json` + `contracts/features.json` + vector 오라클 + `scripts/gen-check.mjs` + `gen-check-test` | 수작업 기대값 fixture와 일치, gen-check RED → GREEN | [o] |
| S-08 | MermaidStore(정규형 parser와 writer) + json↔mermaid 왕복 | `E_MERMAID_UNSUPPORTED`·순서 위반·왕복 불일치 RED → GREEN | [o] |
| S-09 | npm backend + `vectors --kind npm`(golden) | golden RED → GREEN | [o] |
| S-09-1 | npm 패키지: conformance + persist + `examples/model/`, `kinds`에 kind 추가, toolchain과 의존 고정, `test-npm`와 `parity-npm`(공용 `schema/persist.dbs` 생성) | 생성물 없이 `test-npm` RED → GREEN, `layout-check`와 `parity-npm` 통과 | [o] |
| S-09-2 | npm 타입 검사: 패키지 테스트가 생성된 `.d.ts`에 대해 소비자 파일을 TypeScript strict 모드(고정 devDependency)로 컴파일해, 잘못된 선언을 수동 확인이 아니라 도구가 잡는다 | 잘못된 `.d.ts` RED → GREEN | [o] |
| S-10 | go backend + `vectors --kind go`(golden) | golden RED → GREEN | [o] |
| S-10-1 | go 패키지: conformance + persist + `examples/model/`, `kinds`에 kind 추가, toolchain과 의존 고정, `test-go`와 `parity-go` | 생성물 없이 `test-go` RED → GREEN, `layout-check`와 `parity-go` 통과 | [o] |
| S-11 | python backend + `vectors --kind python`(golden) | golden RED → GREEN | [o] |
| S-11-1 | python 패키지: conformance + persist + `examples/model/`, `kinds`에 kind 추가, toolchain과 의존 고정, `test-python`와 `parity-python` | 생성물 없이 `test-python` RED → GREEN, `layout-check`와 `parity-python` 통과 | [o] |
| S-11-2 | python 패키지: kit K22(run-tests python이 color 없이 실행)를 sync하면 packages/status-python/Makefile의 `PYTHON_COLORS=0`을 제거한다. 제거 조건: K22가 든 kit release를 `make kit-sync`로 채택 | FORCE_COLOR가 있고 Makefile에 PYTHON_COLORS가 없어도 test-python 통과 | [ ] |
| S-12 | php backend + `vectors --kind php`(golden) | golden RED → GREEN | [o] |
| S-12-1 | php 패키지: conformance + persist + `examples/model/`, `kinds`에 kind 추가, toolchain과 의존 고정, `test-php`와 `parity-php` | 생성물 없이 `test-php` RED → GREEN, `layout-check`와 `parity-php` 통과 | [o] |
| S-13 | rust backend + `vectors --kind rust`(golden) | golden RED → GREEN | [o] |
| S-13-1 | rust 패키지: conformance + persist + `examples/model/`, `kinds`에 kind 추가, toolchain과 의존 고정, `test-rust`와 `parity-rust` | 생성물 없이 `test-rust` RED → GREEN, `layout-check`와 `parity-rust` 통과 | [o] |
| S-14 | php-ext backend + `vectors --kind php-ext`(golden) | golden RED → GREEN | [ ] |
| S-14-1 | php-ext 패키지: conformance + persist + `examples/model/`, `kinds`에 kind 추가, toolchain과 의존 고정, `test-php-ext`와 `parity-php-ext` | 생성물 없이 `test-php-ext` RED → GREEN, `layout-check`와 `parity-php-ext` 통과 | [ ] |
| S-15 | status-db: `schema/status.dbs` + DbStore + 계약 테스트 + copy + `db-test` | 계약 불일치·`E_STORE_NOT_EMPTY`·원자성 RED → GREEN | [o] |
| S-16 | GUI 골격: hyper app + 목록·상세 + Mermaid + `gui-test` + 고정 버전 mermaid 패키지로 정규형과 B-5의 모든 예약 상태 key를 파싱하는 테스트 | handler RED → GREEN | [o] |
| S-16-1 | GUI test hang: `make gui-test` 실행 한 번에서 중첩 Mermaid subtest가 빈 event loop로 "the test did not finish"를 보고했고 약 20번 재현되지 않았다. 원인을 찾아 원인에서 고치고, 호출별 deadline이 원인을 가렸을 뿐이면 제거한다 | 재현(또는 원인 증명) RED → GREEN | [ ] |
| S-17 | GUI 편집: crudui 폼 + 검증 오류 표시 + rename | 저장 후 `check` 통과 | [o] |
| S-17-1 | GUI 후속: 브라우저에서 추가한 행이 core nextCode의 제안 code를 보이고(페이지가 다음 code를 담는다), 편집 폼에서 상태를 지우면 그 code가 reserved로 옮겨짐을 GUI 테스트가 증명한다 | code 제안 없는 추가 행 RED, reserved 없는 삭제 RED → GREEN | [o] |
