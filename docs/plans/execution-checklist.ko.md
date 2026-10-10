<!-- doc-id: execution-checklist -->
<!-- source-sha256: 495fae60c6a8fb9194f1ae0cb8d141214e01fb13e9a7b33de71338817f24dd10 -->
# 실행 체크리스트

## status v1

| ID | 작업 | RED → GREEN | 상태 |
|---|---|---|---|
| S-01 | git init, kit v0.0.14, config(toolchain은 Node.js만, dependency policy는 빈 목록과 review 기록), hook, AGENTS.md(.ko), 이 체크리스트, CHANGELOG, 계획, `CHECK_TARGETS`와 `check` | `kit-check owner-validate documents-check commits-check toolchain-check hooks-check dependency-policy-check` 통과 | [o] |
| S-02 | `docs/spec/status.md(.ko)`: 계획 B절을 고정한 정의 | `documents-check`가 쌍 없이 실패, 있으면 통과 | [o] |
| S-03 | `scripts/check-layout.mjs` + `contracts/layout.json`(tools, kinds = {}, kind마다 required 파일과 allowed glob을 담는 객체) + `layout-test`/`layout-check` | fixture(kinds 불일치/추가/누락/개명/php↔php-ext 불일치/형식 오류) RED → GREEN | [o] |
| S-04 | `scripts/check-parity.mjs`(`--kind` 포함) + `parity-test` | fixture(결과 없음/도구 결과 없음/`--kind`는 자기 kind만 읽음/stale inputs/미실행/미등록/0케이스/fail/timeout/skip/이름 일치 0·2개/부모 id/10분 초과) RED → GREEN | [ ] |
| S-05 | core `E_SCHEMA` + schema 대응 테스트 | RED → GREEN | [ ] |
| S-05-1 | core 그래프 오류 | 오류 코드별 RED → GREEN | [ ] |
| S-05-2 | core 이름·code 오류 | 오류 코드별 RED → GREEN | [ ] |
| S-06 | normalize/IR + lock(rename/reserved) + JsonStore + store 계약 + `run`/`copy` | lock 시나리오별 RED → GREEN | [ ] |
| S-07 | `status.config.json` + `machines/order.status.json` + `status.lock.json` + `contracts/features.json` + vector 오라클 + `scripts/gen-check.mjs` + `gen-check-test` | 수작업 기대값 fixture와 일치, gen-check RED → GREEN | [ ] |
| S-08 | MermaidStore(정규형 parser와 writer) + json↔mermaid 왕복 | `E_MERMAID_UNSUPPORTED`·순서 위반·왕복 불일치 RED → GREEN | [ ] |
| S-09 | npm backend + `vectors --kind npm`(golden) | golden RED → GREEN | [ ] |
| S-09-1 | npm 패키지: conformance + persist + `examples/model/`, `kinds`에 kind 추가, toolchain과 의존 고정, `test-npm`와 `parity-npm`(공용 `schema/persist.dbs` 생성) | 생성물 없이 `test-npm` RED → GREEN, `layout-check`와 `parity-npm` 통과 | [ ] |
| S-10 | go backend + `vectors --kind go`(golden) | golden RED → GREEN | [ ] |
| S-10-1 | go 패키지: conformance + persist + `examples/model/`, `kinds`에 kind 추가, toolchain과 의존 고정, `test-go`와 `parity-go` | 생성물 없이 `test-go` RED → GREEN, `layout-check`와 `parity-go` 통과 | [ ] |
| S-11 | python backend + `vectors --kind python`(golden) | golden RED → GREEN | [ ] |
| S-11-1 | python 패키지: conformance + persist + `examples/model/`, `kinds`에 kind 추가, toolchain과 의존 고정, `test-python`와 `parity-python` | 생성물 없이 `test-python` RED → GREEN, `layout-check`와 `parity-python` 통과 | [ ] |
| S-12 | php backend + `vectors --kind php`(golden) | golden RED → GREEN | [ ] |
| S-12-1 | php 패키지: conformance + persist + `examples/model/`, `kinds`에 kind 추가, toolchain과 의존 고정, `test-php`와 `parity-php` | 생성물 없이 `test-php` RED → GREEN, `layout-check`와 `parity-php` 통과 | [ ] |
| S-13 | rust backend + `vectors --kind rust`(golden) | golden RED → GREEN | [ ] |
| S-13-1 | rust 패키지: conformance + persist + `examples/model/`, `kinds`에 kind 추가, toolchain과 의존 고정, `test-rust`와 `parity-rust` | 생성물 없이 `test-rust` RED → GREEN, `layout-check`와 `parity-rust` 통과 | [ ] |
| S-14 | php-ext backend + `vectors --kind php-ext`(golden) | golden RED → GREEN | [ ] |
| S-14-1 | php-ext 패키지: conformance + persist + `examples/model/`, `kinds`에 kind 추가, toolchain과 의존 고정, `test-php-ext`와 `parity-php-ext` | 생성물 없이 `test-php-ext` RED → GREEN, `layout-check`와 `parity-php-ext` 통과 | [ ] |
| S-15 | status-db: `schema/status.dbs` + DbStore + 계약 테스트 + copy + `db-test` | 계약 불일치·`E_STORE_NOT_EMPTY`·원자성 RED → GREEN | [ ] |
| S-16 | GUI 골격: hyper app + 목록·상세 + Mermaid + `gui-test` | handler RED → GREEN | [ ] |
| S-17 | GUI 편집: crudui 폼 + 검증 오류 표시 + rename | 저장 후 `check` 통과 | [ ] |
