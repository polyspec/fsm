<!-- doc-id: plan-fsm-v1 -->
<!-- source-sha256: fec091edd9230852809fcb8e0b05485097402031f26b84b7701f8090126dc66e -->
# fsm v1 계획

[English](fsm-v1.md)

## Context
- 상태를 정수 code로 저장한다(key = value). 이벤트 전이는 **멱등하고 결정적으로** 처리한다. 이 규칙을 6개 타깃(go, npm(js+d.ts), php, php-ext, python, rust)에서 똑같이 쓴다.
- 결과물은 언어별 gen 파일이다. 런타임 파싱은 없고, 생성 코드는 런타임 의존성이 없다.
- 정의 저장소는 **JSON, Mermaid `stateDiagram-v2`, DB(orm)** 세 개이며 모두 1급이다. 규칙(검증·lock·생성)은 compiler core 하나다.
- 모델은 세 매체가 **공식 문법만으로** 손실 없이 담을 수 있을 만큼 단순하게 설계한다. 매체가 담지 못하는 부분이 생기면 모델이 과하다는 신호로 본다.
- 도구는 다음을 쓴다: GUI는 hyper(Node 서버), CRUD 화면은 crudui, DB 접근은 orm.
- 저장소는 옛 이름 `status`로 시작했다. S-01이 kit 채택과 함께 이 계획을 커밋했고, S-18이 라이브러리와 패키지·명령·파일 이름을 fsm으로 바꿨다(R12). kit를 채택한다.
- 언어 패키지 6개는 폴더 구조가 동일하다. 언어 특성 차이만 `contracts/layout.json`에 명시해서 허용한다.
- 언어 패키지는 배포 라이브러리가 아니라 소비자 입장의 검증대다.
- 확정 사항
  - 값 모델 = enum만(bit flag 없음)
  - 전이 = 명시적 그래프
  - 런타임 = 생성 코드만
- 원칙: 기준은 **도구로 강제**한다. 레이아웃, 기능↔테스트 대응, 언어 간 동등성 판정은 RED 테스트를 가진 검사 도구가 한다.

## 0. 범위 확정 (감사와 구현의 유일한 판정 기준)

**요구 R1~R12 (이 목록만이 v1 범위다)**

| id | 요구 | 출처 |
|---|---|---|
| R1 | 상태 = 정수 code가 붙은 enum(key = value). code는 불변이고 재사용하지 않는다 | 최초 요청 |
| R2 | 이벤트 전이(이전/다음 포함)가 멱등하고 결정적이다 | 최초 요청 |
| R3 | 6개 타깃(go, npm js+d.ts, php, php-ext, python, rust)의 gen 파일. 런타임 파싱과 런타임 의존성이 없다 | 최초 요청 |
| R4 | 정의 저장소 3종(JSON, Mermaid, DB)과 규칙 1개 | 사용자 지시 |
| R5 | GUI 상태 관리: hyper + crudui + Mermaid 표시 | 사용자 지시 |
| R6 | DB 접근은 orm(정의 DB store와 소비자 영속화 예제) | 사용자 지시 |
| R7 | kit 채택. 언어 패키지 구조 동일, 언어 특성 차이만 허용 | 사용자 지시 |
| R8 | 기준은 도구로 강제한다(레이아웃·기능↔테스트·언어 동등성). 개발 순서는 RED→GREEN | 사용자 지시 |
| R9 | 테스트 실행 규칙: 케이스별 진행·timeout, 10분 상한, 소유 검사, 전체 스위트 1회 | 사용자 지시 |
| R10 | 체크리스트·커밋·문서 규율(A절) | 사용자 지시 |
| R11 | 문서화: 루트 README와 모든 패키지 README(영문·한글)가 사용자에게 라이브러리를 완전히 설명하고, 문서 사이트를 GitHub Pages에 공개한다 | 사용자 지시 |
| R12 | 라이브러리 이름은 fsm: 저장소 polyspec/fsm, 그리고 모든 패키지·명령·파일·생성 모듈이 그 이름을 쓴다 | 사용자 지시 |

**v1 범위 밖 (감사 지적 대상이 아님)**
- B-0의 비채택 목록
- 다중 편집자 동시성(GUI는 단일 편집자)
- 패키지 배포/릴리스(언어 패키지는 검증대)
- DB dialect별 차이(orm 소유)
- 성능 최적화, i18n, 인증/권한

**감사 규칙 (수렴 조건)**
- 감사자는 지적마다 위반한 R-id 또는 계획 내부 모순 위치를 명시한다. 둘 다 없는 지적은 범위 밖으로 기각한다.
- core로 인정하는 것은 세 가지뿐이다.
  1. R 위반
  2. 계획 내부 모순
  3. 실제 코드·도구로 확인된 구현 불가
- 그 외(표현, 대안 설계 선호, 범위 밖 기능)는 minor다. minor는 계획 확정을 막지 않고, 해당 항목을 구현할 때 처리한다.
- 계획 확정 조건: core 지적 0건. 범위 자체를 바꾸려면 사용자 결정이 필요하다.
- 구현 중 감사도 같은 규칙을 따르되, 대상은 해당 체크리스트 항목의 산출물과 그 RED/GREEN 기준으로 한정한다.

---

## A. 개발 규율 (AGENTS.md에 중복 없이 쓴다. 체크리스트·CHANGELOG에는 넣지 않는다)
- 판단 기준
  - 판단의 기준은 언제나 "무엇이 옳은가"다. "기존 원칙이 그러니까"는 근거가 되지 않는다.
  - 기준은 고칠 수 있다. 다만 근거가 있어야 하며, 테스트 중 달성이 어렵다는 이유로 기준을 낮추는 것은 금지한다.
  - 판단이 어렵거나 새로운 논리가 생기면 에이전트로 적대 검증한다. 에이전트에게 해결안까지 받고, 이견이 없을 때까지 반복한다.
  - 결정은 연관 문서에 기록한다.
- kit 규칙
  - 영문이 정본이다. `.ko.md`에는 `source-sha256`을 붙이고, 기술 용어는 영어 그대로 쓴다.
  - 벤더 파일은 수정하지 않는다. 같은 트리에서는 같은 결과가 나와야 한다.
  - 공용 도구 변경은 kit에서 하고, kit 체크리스트(K 항목)로 운영한다.
- 개발 사이클: RED 재현 → 구현 → GREEN 검증. 관측 가능한 기준을 항목에 적는다.
- 루트 도구 테스트(check-layout, check-parity, gen-check)의 fixture는 테스트가 임시 디렉터리에 만들고 커밋하지 않는다. 그래서 kit gate가 읽지 않는다.
- 테스트 위치
  - 기능의 기본 테스트는 소유 패키지에 둔다.
    - compiler → `packages/fsm-compiler/tests`
    - DB store → `packages/fsm-db/tests`
    - GUI → `packages/fsm-gui/tests`
  - 언어 패키지에는 소비자 입장 테스트만 둔다.
  - 루트에는 루트 도구(check-layout, check-parity, gen-check)의 테스트와 벤더 `tests/kit/`만 둔다.
- 테스트 실행
  - 모든 테스트는 kit `run-tests.mjs`로 실행한다. 이 runner가 케이스별 진행·경과시간 출력과 케이스별 timeout을 강제한다. 전체 timeout은 없다.
  - 벡터 케이스 1개 = 언어 테스트 1개다.
  - compiler-test, db-test, gui-test와 모든 언어 테스트는 `run-tests --results`로 `.results/<target>.json`을 쓴다. check-parity는 이 파일들이 있어야 통과하고(모든 테스트가 runner를 거쳤다는 증거) 각각 `elapsedMs ≤ 600000`을 검사한다. 목표는 초 단위다.
  - 병렬 실행은 `packages-test`의 `make -j6`로만 한다.
  - 항목 개발 중에는 owner-checks 매핑(D 절)의 소유 검사만 돌린다.
  - 전체 스위트는 마지막 항목을 커밋한 뒤 `full-run.mjs`로 트리당 1회 돌린다. 체크리스트 항목이 아니다.
- 오류 은폐 금지: fallback, 조용한 변환이나 버림, null 반환 모두 금지. 하위 호환 레이어도 금지.
- 체크리스트
  - `docs/plans/execution-checklist.md(.ko)` 하나만 쓴다. 형식은 kit table이다(`| id | 항목 | RED → GREEN | 상태 |`).
  - 상태는 `[ ] [~] [o] [!] [-]`. [o]가 된 항목은 다시 열지 않고 하위 id를 만든다.
- 커밋
  - 형식: `type(scope): Subject (#S-xx)`, 영문. 제목 50자 이내, 대문자 시작, 마침표 없음, 명령조. 본문은 72자에서 개행하고 What/Why를 쓴다.
  - 항목이 [o]가 되는 순간 루트 CHANGELOG와 체크리스트를 반영해서 커밋한다.
- 강제 수단
  - kit 도구
    - `commits-check` + commit-msg 훅: 제목 형식, 길이, 본문 폭
    - `documents-check`: 체크리스트 형식
    - `push-gate`: [~] 상태로 push 금지
    - `owner-validate`: 경로 소유
  - `name-check`(`scripts/check-name.mjs`, RED 테스트는 `tests/check-name/`): 추적 파일과 경로가 라이브러리를 옛 이름 `status`로 부르지 않는다. 허용되는 경우(상태 값, exit·HTTP·테스트 결과 status, 벤더 kit, CHANGELOG 이력)는 `ALLOWED`의 항목이며 각각 이유를 가진다(R12).
  - K19: 상태를 [o]로 바꾸는 커밋은 CHANGELOG도 바꿔야 한다. 커밋 하나가 상태를 바꾸는 항목은 최대 1개다.
  - **리뷰 규칙(도구 없음)**
    - 브랜치/워크트리 이름 규칙과 병합 즉시 삭제
    - git 파일에 외부 출처 금지(채택/비채택 판정만 일반 구문으로). polyspec 저장소(kit, orm, hyper, crudui, template 등)는 내부 라이브러리이므로 인용할 수 있다.
    - 커밋 제목 명령조, 본문 What/Why
    - RED→구현→GREEN 순서
    - fallback·하위 호환 금지
    - 실험 코드 제거
    - [o] 재개 금지
    - WIP 통제([~] 증식 금지, 완료 우선)
    - 기술 용어 영어 표기
    - 판단 기준: 근거 기반 결정, 기준 하향 금지, 적대 검증, 결정의 연관 문서 기록
    - 같은 트리는 같은 결과(kit 도구는 자기 검사에 대해서만 강제)
    - 체크리스트 항목마다 관측 가능한 RED → GREEN 기준
    - 테스트 위치(compiler·DB store·GUI 테스트는 소유 패키지, 언어 패키지는 소비자 입장 테스트만)
    - 병렬 실행은 `packages-test`의 `make -j6`로만, 항목 중에는 소유 검사만
    - 커밋 메시지 영문
    - conformance 검사 함수는 벡터의 기대값을 단언한다(check-parity는 단언이 아니라 케이스 수를 센다)
    - 의존 고정(manifest와 lock 파일의 릴리스 태그)
- 브랜치/워크트리
  - main에서 직접 작업해도 된다.
  - 브랜치나 워크트리를 쓸 때는 `{type}/{shortname}-{id}` / `fsm-{shortname}-{id}`로 만들고, 병합하는 즉시 삭제한다.
  - 실험 코드는 커밋 전에 제거한다. 바로 제거할 수 없으면 하위 항목에 제거 조건을 적는다.

## B. 상태 머신 정의 (`docs/spec/fsm.md`에 고정)

정의(B-0~B-6)는 [docs/spec/fsm.md](../spec/fsm.ko.md)에 고정했다(S-02). 정의의 원본은 그 문서 하나다.

## C. 구조와 강제 도구

### C-1. 저장소
```
fsm/
  AGENTS.md(.ko) README.md(.ko) CHANGELOG.md(.ko) Makefile kit.json .kit/ .node-version rust-toolchain.toml .githooks/
  .gitignore            # anchored only: /var/, /.results/, /packages/*/node_modules/, /packages/*/vendor/, /packages/*/target/, /packages/fsm-python/**/__pycache__/, php-ext phpize output under /packages/fsm-php-ext/src/ (exact patterns fixed in S-14; config.m4 and generated sources stay unignored), /packages/fsm-gui/build/, /packages/fsm-gui/public/assets/, /packages/fsm-php*/.phpunit.result.cache, /packages/fsm-php*/.phpunit.cache/
  config/{checklist,documents,owner-checks,commits,toolchain,dependency-policy,dependency-review}.json
  scripts/kit/ tests/kit/                    # vendored from kit
  scripts/check-layout.mjs scripts/check-parity.mjs scripts/gen-check.mjs   tests/check-layout/ tests/check-parity/ tests/gen-check/
  contracts/layout.json (tools, kinds, canonical tree, allowed differences)   contracts/features.json
  docs/spec/fsm.md(.ko)  docs/plans/execution-checklist.md(.ko)  docs/plans/fsm-v1.md(.ko)
  schema/fsm.schema.json  schema/fsm.dbs  schema/persist.dbs   # persist.dbs = shared by the six language package examples
  fsm.config.json  machines/order.fsm.json  fsm.lock.json  conformance/vectors/<machine>.json
  packages/fsm-compiler/  {src/core/, src/backends/, src/store-json/, src/store-mermaid/, src/cli/, tests/}  # zero dependencies
  packages/fsm-db/        {src/, tests/}   # DbStore + fsm-db CLI, depends on orm
  packages/fsm-gui/       {app/app.json, templates/, client/main.ts, public/assets/, build/, src/, crud/*.yml, tests/}
  packages/fsm-{go,npm,php,php-ext,python,rust}/
```
- 외부 의존은 릴리스 태그로 고정한다: orm v0.0.7, ordered-json v0.0.7, hyper v0.0.11, template v0.0.5, crudui v0.0.5, mermaid(npm 정확 버전).
  - npm: release asset URL을 `dependencies`에 쓴다. 전이 `@polyspec/*`는 같은 URL로 `overrides`에 쓴다.
  - composer: `package` repository의 dist zip, `config.platform.php` 8.4.x
  - go: `require github.com/polyspec/orm v0.0.7`
  - python: `polyspec-orm @ git+https://github.com/polyspec/orm@v0.0.7#subdirectory=packages/orm-python`
  - cargo: `{ git = "https://github.com/polyspec/orm.git", tag = "v0.0.7" }`
  - `.node-version`에는 정확한 26.y.z 릴리스를 쓴다(hyper 요구. kit toolchain-declared.mjs는 <major>.<minor>.<patch>만 받는다).
- 고정은 manifest와 lock 파일에 하고 `config/dependency-policy.json`에 적는다. kit gate는 npm URL, Composer `package` dist URL, python `git+…@tag`, cargo tag를 검사하지 않는다. 고정 확인은 리뷰 규칙이다(이를 도구로 요구하는 R은 없다).

### C-2. 언어 패키지 정규 구조 (6개 동일)
```
packages/fsm-<kind>/
  README.md README.ko.md
  Makefile          # gen (gen + vectors --kind; flags only here; DEST ?= .)
                    # test (run-tests --cwd packages/fsm-<kind> --results .results/<kind>.json; paths resolve against the checkout root)
  <manifest>        # [allowed difference] depends on orm (SQLite) for tests and examples
  <lock>            # [allowed difference] go.sum, package-lock.json, composer.lock, Cargo.lock (read by the kit dependency gate); python has none
  src/…             # fsm-gen output only
  tests/conformance.<ext>   # hand-written check functions; except in rust, iterates the vectors and registers one test per case
  tests/vectors.<ext>       # fsm-gen output (language-native data); in rust, one #[test] per case
  examples/persist.<ext>    # B-4 orm persistence; tests run it with the persist vectors
  examples/model/           # orm-generated model from the root schema/persist.dbs (committed, covered by gen-check); rust uses build.rs as an allowed difference
```
- `make gen`은 fsm-gen 출력과 orm-gen 출력을 함께 만든다. `contracts/layout.json`에서 kind의 `generated` glob이 이 출력이 쓰는 파일을 이름 짓고, `gen-check`는 정확히 그 파일을 비교한다.

| kind | manifest | src | tests 비고 |
|---|---|---|---|
| go | go.mod | `src/order/order.go`, `src/fsm/fsm.go` (Go는 package = 디렉터리) | `conformance_test.go`, `vectors_test.go` |
| npm | package.json | `order.js/.d.ts`, `fsm.js/.d.ts`, `index.js/.d.ts`(`export * as order`) | `conformance.test.mjs`, `vectors.mjs` |
| php | composer.json | `Order/{State,Event,Step}.php`, `Order/functions.php`, `Fsm/Code.php` (error code enum, its own file for PSR-4), `Fsm/Error.php` | `ConformanceTest.php`, `Vectors.php` |
| php-ext | composer.json(`type: php-ext`, `extension-name`, `build-path: src`) | `config.m4`, `order.c`, `fsm.c`(공용 `<ns>\Fsm\Error`와 오류 코드 상수), `php_<ext>.h`, `<ext>.stub.php`, `<ext>_arginfo.h` | php와 **바이트 동일**한 테스트. `make test`가 phpize로 빌드한 뒤 `--php-extension <.so>`로 실행. gen에 `--php-namespace`·`--php-ext-name` 필수 |
| python | pyproject.toml | `polyspec_fsm/{__init__,order,fsm}.py` | `test_conformance.py`(케이스 이름 그대로의 메서드 생성), `vectors.py` |
| rust | Cargo.toml(`autotests=false`, `autoexamples=false`, `[[test]] conformance`, build-dep `polyspec-orm-build`, dev-dep `tokio`) + `build.rs` | `lib.rs`(`pub mod order; pub mod fsm;`), `order.rs`, `fsm.rs` | `conformance.rs`(`mod vectors;`, `#[path="../examples/persist.rs"] mod persist;`), persist 케이스는 `#[tokio::test]`, 생성 `tests/vectors.rs`는 `#![allow(non_snake_case)]`로 시작 |

- check-layout이 실패시키는 경우
  - `packages/fsm-*` 디렉터리 집합에서 `layout.json`의 `tools`에 적은 도구 패키지 `fsm-compiler`, `fsm-db`, `fsm-gui`를 뺀 집합이 `kinds`와 다름
  - 추적 파일과 무시되지 않은 신규 파일이 정규 트리에서 벗어남(추가/누락/개명)
  - php와 php-ext의 테스트가 바이트 단위로 다름
  - layout.json 형식 오류
- kind는 패키지 항목에서 하나씩 추가한다.

### C-3. 결과 기록 (K18)
- kit `test-progress.mjs`의 `close()`가 쓰는 counts에 `cases: [{id, status, elapsedMs}]`를 더한다.
- `run-tests --results <file>`이면 `{tool, inputs, elapsedMs}`를 붙여 임시파일+rename으로 한 번 쓴다.
- `inputs` = kit `inputsDigest(root, paths)`. `paths`(패키지 디렉터리와 `schema/persist.dbs`) 아래의 추적 파일과 무시되지 않은 신규 파일의 경로·sha256으로 만든다.
- 케이스 이름은 `test_<featureId>__<vectorId>`다.
  - 두 id는 `^[a-z][a-z0-9]*(_[a-z0-9]+)*$`이며 `__`를 포함하지 않는다.
  - vectorId는 `<machine>_`로 시작한다.
  - 언어 테스트 이름에 이 이름을 그대로 쓴다.

### C-4. `check-parity.mjs`
실패 조건(면제 없음):
- `kinds`의 `.results/<kind>.json`이 없거나, `inputs`가 현재 digest와 다름
- 어느 kind에서 벡터 케이스가 실행되지 않음
- 벡터에 없는 케이스가 결과에 있음
- features.json의 기능 중 벡터 케이스가 0개인 기능이 있음
- 상태가 `pass`가 아닌 케이스가 있음(`fail`, `timeout`, `skip` 모두 실패)
- 결과 id 하나에서 서로 다른 케이스 이름이 2개 이상 나오거나, 하나도 나오지 않는데 일치한 id의 부모(일치한 id가 ` › `로 이어 붙이는 id. 예: 케이스를 subtest로 실행하는 Go 테스트 함수)가 아님
- `--kind`가 없을 때: `--tools`가 가리키는 도구 테스트(Makefile의 `TOOL_TESTS`: layout-test, parity-test, gen-check-test, compiler-test, db-test, gui-test를 각 항목이 추가)의 기록 `.results/<target>.json`이 없거나, stale이거나, `pass`가 아닌 케이스를 가짐
- 어느 `.results/*.json`이든 `elapsedMs > 600000`(`--kind`이면 그 kind의 결과만)

케이스 이름 추출: `/\btest_[a-z][a-z0-9]*(?:_[a-z0-9]+)*__[a-z][a-z0-9]*(?:_[a-z0-9]+)*\b/`를 결과 id마다 적용한다. 서로 다른 일치가 정확히 1개인 id가 그 케이스이고, 0개 또는 2개 이상인 id는 위 결과 id 항목으로 판정한다. 도구별 규칙은 없다.

`contracts/features.json` = `{schema: 1, features: [initial, code, key, from_code, is_final, events_from, target, apply, persist]}`. vector 파일은 `conformance/vectors/<machine>.json` = `{machine, cases: [{feature, id, …}]}`이고, 케이스 이름은 `test_<feature>__<id>`다.

벡터(전수, 오라클은 core가 생성):
- `initial`
- 상태마다 `code`/`key`/`from_code` 왕복, `is_final`, `events_from`
- 모든 (state, event)의 `target`
- 정의된 (expected, event)마다
  - actual = expected → `Changed`
  - actual = to → `Unchanged`
  - 그 외 모든 정의 상태 → `E_CONFLICT`
- 미정의 (state, event) → `E_INVALID_TRANSITION`
- `from_code`: 0, 미지 code, 각 예약 code
- `persist`: 첫 시도 / 재시도 / 충돌
- case id: case id는 `<machine>_<suffix>`이고, suffix의 key마다 선언 index를 쓴다. 이름과 무관하게 두 id가 충돌하지 않게 하기 위해서다. state는 `s<i>`, event는 `e<j>`(둘 다 0부터 시작), 예약 code는 `r<code>`다. id는 `<m>_initial`; `<m>_code_s<i>`, `<m>_key_s<i>`, `<m>_from_code_s<i>`, `<m>_is_final_s<i>`, `<m>_events_from_s<i>`; `<m>_from_code_zero`, `<m>_from_code_unknown`, `<m>_from_code_r<code>`; `<m>_target_s<i>_e<j>`; `<m>_apply_s<i>_e<j>_s<k>`(expected, event, actual); `<m>_persist_first`, `<m>_persist_retry`, `<m>_persist_conflict`다. 케이스 데이터 필드는 key(state, event, expected, actual 등)를 그대로 쓰며, 바뀌는 것은 id뿐이다.
- persist 케이스는 machine에 transition이 있을 때만 존재한다. `conflict`는 third state가 있을 때만 존재하므로, state가 2개인 machine은 `first`와 `retry`만 갖고, transition이 없는 machine(예: state가 1개인 machine)은 persist 케이스가 없다.

### C-5. compiler `packages/fsm-compiler`
- 구성
  - `src/core`: 객체 → validate → normalize → backends, 그리고 `run`, `copy`. `node:` import는 0개이고, GUI가 그대로 import한다.
  - `src/backends/<kind>.mjs`
  - `src/store-json`, `src/store-mermaid`
  - `src/cli` (`fsm-gen`)
- 명령
  - `lock [--rename]`
  - `gen --kind <k> --out <dir>` (php는 `--php-namespace` 필수, php-ext는 `--php-namespace`와 `--php-ext-name` 필수, go는 `--go-module <module path>` 필수: 생성된 machine이 공용 패키지 `<module>/src/fsm`를 import하며 backend는 go.mod를 읽을 수 없다)
  - `vectors [--kind <k>] --out <path>`
  - `check`: 전 정의 검증 + lock 일치
  - `copy --to json|mermaid --root <dir>`
- 루트 `gen-check`
  1. `fsm-gen vectors --out var/gen-check/conformance/vectors` 실행
  2. `kinds`의 각 패키지에서 `make gen DEST=$(CURDIR)/var/gen-check/<kind>` 실행
  3. `scripts/gen-check.mjs`가 kit `trackedFiles`(추적 파일과 무시되지 않은 파일만 읽으므로 `__pycache__/`, php-ext `src/`의 phpize 산출물 같은 무시된 출력은 읽지 않는다)로 작업 트리와 비교한다. `conformance/vectors`, 각 패키지 `src/`·`tests/vectors.<ext>`·`examples/model/`(rust 제외)의 파일 집합이 같고 내용이 바이트 동일해야 한다. 각 패키지에서 비교하는 파일은 `contracts/layout.json`의 kind `generated` glob이 맞는 파일이며, 이 glob이 없는 kind는 `layout-config` finding이다.
  - `gen-check-test`(`tests/gen-check/`) RED: 1바이트 변경 fixture, 파일 추가 fixture, 읽지 말아야 할 무시된 파일

### C-6. fsm-db `packages/fsm-db`
- `schema/fsm.dbs` → orm 생성 모델(npm).
  - 정의 테이블
    - `machine(name PK)`(머신 순서는 name 순)
    - `state(machine, key, code i32, position, initial, final)`: PK(machine,key), unique(machine,code), unique(machine,position)
    - `event(machine, key, position)`: PK(machine,key)
    - `edge(machine, event, from, to, position)`: PK(machine,event,from). FK (machine,event)→event, (machine,from)·(machine,to)→state, 선행 index 포함
  - lock 테이블
    - `lock_code(machine, code i32, key)`: PK(machine,code)
    - `lock_reserved(machine, code i32)`: PK(machine,code)
    - machine FK는 두지 않는다. 정의에서 지운 머신의 lock도 남아야 하기 때문이다.
- `DbStore`는 store 계약을 구현한다. `save`는 한 transaction 안에서 전체를 교체한다. 검증은 core `run`이 store를 부르기 전에 끝낸다.
- `fsm-db` CLI는 core `run`과 `copy`를 DbStore와 json/mermaid store로 실행한다.
- 테스트(SQLite)
  - store 계약(왕복·결과 바이트 동일)
  - `E_STORE_NOT_EMPTY`
  - transaction 원자성 RED
  - dialect 차이는 orm 자신의 conformance 책임이다.

### C-7. GUI `packages/fsm-gui` (hyper Node 서버 + crudui + mermaid)
- GUI는 단일 편집자 도구다. save는 전체 교체이고, 마지막 쓰기가 이긴다.
- 빌드: `hyper-build-assets --app . --api /api --output build`(hyper v0.0.11은 `--app`·`--api`·`--output`을 요구한다)가 `templates.index.json`, `manifest.json`, `public/assets` 번들을 만든다(gui-test 전에 실행).
- 실행: `fsm-gui`
  - store는 `fsm.config.json`을 따른다.
  - `App.open({manifest, templates: {index: build/templates.index.json, root: public}, handlers, timezone: 'UTC'})`, 경로는 절대 경로, `FileSessions`가 열기 전에 `var/sessions`를 만든다
  - `app.server(new FileSessions({directory: var/sessions}), {files: public})`
- 화면
  - 머신 목록(crudui list)
  - 머신 상세: 상태, 이벤트·엣지, Mermaid 다이어그램
    - mermaid store 정규 출력을 `<pre class="mermaid">`에 넣는다.
    - `client/main.ts`가 npm `mermaid`를 import하고, 첫 로드와 `htmx:after:settle`마다 `mermaid.run()`을 호출한다.
    - 번들을 `public/assets`에서 서빙하므로 오프라인에서도 동작한다.
  - 상태·이벤트·엣지 폼
  - rename
- 폼(crudui)
  - 서버 loader/action에서 generator-core `compileForm`/`createForm` → generator-html `renderForm(instance, {action, hidden: {_csrf}, errors, formErrors})`를 거쳐 나온 문자열을 템플릿 `{= form | raw}`로 넣는다.
  - 행 추가·삭제는 `client/main.ts`의 `connectForm`이 처리한다.
  - `crud/*.yml`에는 검증 규칙을 쓰지 않는다. form-binding도 쓰지 않는다. 규칙은 core 하나다.
  - 제출 본문은 `src/form-data.mjs`가 `form[…]` 평면 이름을 crudui 행 키 객체로 파싱한다. 잘못되거나 중복된 이름은 `BadRequest`(RED 테스트 있음).
  - core 오류는 `{machine, path}`(정의 JSON 경로)를 갖는다.
    - GUI가 이를 crudui 데이터 경로로 바꿔 `errors`에 넣는다.
    - 노드가 없는 오류(`E_KEY_RESERVED` 등)는 `formErrors`에 넣는다.
    - 응답은 `Result.invalid({form})`(422)이다.
- 규칙
  - 모든 저장은 core `run save`를 거친다.
  - 기존 code의 key 변경은 core가 `E_CODE_KEY_CHANGED`로 거부한다. 이름 변경은 rename 화면(`lock --rename`)에서만 한다.
  - GUI 자체는 규칙을 갖지 않는다.
- 테스트
  - hyper handler 단위 테스트(node:test)
  - 저장 후 `check` 통과
  - 폼 렌더링 정확성은 crudui가, 라우팅 정확성은 hyper가 소유한다.

---

## D. 체크리스트 초안

**kit 체크리스트 (kit repo에서 먼저 진행 → 릴리스 → fsm에서 kit-sync. kit에 넣을 때는 kit의 5열 형식으로 쓴다)**

| id | 항목 | RED → GREEN | 상태 |
|---|---|---|---|
| K17 | `run-tests python`: `python3 -m unittest -v`의 stderr를 읽는다. cargo와 공용 줄 파서 1개를 쓰고, runner가 timeout을 강제한다. tool-inventory(.ko)를 갱신한다 | PATH stub python3으로 pass/fail/timeout/no-test RED | [ ] |
| K18 | `run-tests --results`(counts의 `cases` + `inputs` + `elapsedMs`), `inputsDigest`, tool-inventory 갱신 | node/vitest fixture 테스트 + PATH stub go/cargo/phpunit/python3 RED | [ ] |
| K19 | `check-commits` 규칙: [o] 전환 커밋은 changelog(영·한)도 바꿔야 하고, 커밋당 상태 변경 항목은 최대 1개. 스키마에 `done`·`changelog` 추가. 그 커밋에서 추가된 행은 상태 변경이 아니다 | git fixture RED | [ ] |

**fsm 체크리스트**

| id | 항목 | RED → GREEN | 상태 |
|---|---|---|---|
| S-01 | git init, kit-sync, config(toolchain은 node만, dependency-policy는 빈 목록 + `make dependency-review RECORD=1`로 만든 `config/dependency-review.json`), hooks, AGENTS.md(.ko) A절, D절의 S 행 전체를 담은 체크리스트(S-01은 `[o]`, 나머지는 `[ ]`), CHANGELOG, 이 계획, `CHECK_TARGETS`(지금까지 정의된 타깃만, 각 항목이 자기 타깃을 추가)와 `check` | `kit-check owner-validate documents-check commits-check toolchain-check hooks-check dependency-policy-check` | [ ] |
| S-02 | `docs/spec/fsm.md(.ko)` B절 | `documents-check` | [ ] |
| S-03 | `check-layout` + `layout.json`(kinds = {}, kind마다 required 파일과 allowed glob을 담는 객체) + `layout-test`/`layout-check` | fixture(kinds 불일치/추가/누락/개명/php↔php-ext 불일치/형식 오류) RED | [ ] |
| S-04 | `check-parity` + `parity-test` | fixture(결과 없음/도구 결과 없음/`--kind`는 자기 kind만 읽음/stale inputs/미실행/미등록/0케이스/fail/timeout/skip/이름 일치 0·2개/부모 id/10분 초과) RED | [ ] |
| S-05 | core `E_SCHEMA` + schema 대응 테스트 | RED | [ ] |
| S-05-1 | core 그래프 오류 | 오류 코드별 RED | [ ] |
| S-05-2 | core 이름·code 오류 | 오류 코드별 RED | [ ] |
| S-06 | normalize/IR + lock(rename/reserved) + JsonStore + store 계약 + `run`/`copy` | lock 시나리오 RED | [ ] |
| S-07 | `fsm.config.json`(`{"store":"json"}`) + `machines/order.fsm.json` + `fsm.lock.json` + `contracts/features.json` + vectors 오라클(미등록 featureId 거부) + `gen-check` + `gen-check-test` | 수작업 기대값 fixture 일치, gen-check RED | [ ] |
| S-08 | MermaidStore(정규형 파서·writer) + json↔mermaid 왕복 | `E_MERMAID_UNSUPPORTED`·순서 위반·왕복 불일치 RED | [ ] |
| S-09 / S-09-1 | npm backend + `vectors --kind npm`(골든) / npm 패키지(conformance + persist + 루트 `schema/persist.dbs`(여기서 생성, 이후 공용) + `examples/model/`(orm-gen, gen-check 대상), kinds 추가, toolchain·dependency-policy 추가, `test-npm`) | 생성물 없음 RED → 통과, layout·parity | [ ] |
| S-10 … S-14 (+ `-1`) | 같은 방식으로 go, python, php, rust, php-ext | 동일 | [ ] |
| S-15 | fsm-db: dbs + DbStore + 계약 테스트 + copy + `db-test` | 계약 불일치·`E_STORE_NOT_EMPTY`·원자성 RED | [ ] |
| S-16 | GUI 골격: hyper app + 목록·상세 + Mermaid + `gui-test` | handler RED | [ ] |
| S-17 | GUI 편집: crudui 폼 + 검증 오류 표시 + lock/rename | 저장 후 `check` 통과 | [ ] |

owner-checks 매핑(각 항목이 자기 부분을 추가한다):

| 경로 | 소유 검사 |
|---|---|
| `scripts/kit/**`, `tests/kit/**`, `.kit/**`, `kit.json`, `config/**`, `Makefile`, `.gitignore`, `.node-version`, `rust-toolchain.toml` | `kit-check owner-validate documents-check commits-check toolchain-check dependency-policy-check` |
| `.githooks/**` | `hooks-check` |
| `**/*.md` | `documents-check` |
| `scripts/check-layout.mjs`, `tests/check-layout/**` | `layout-test layout-check` |
| `contracts/layout.json` | `layout-test layout-check gen-check packages-test` |
| `scripts/gen-check.mjs`, `tests/gen-check/**` | `gen-check-test gen-check` |
| `scripts/check-parity.mjs`, `tests/check-parity/**` | `parity-test` |
| `packages/fsm-compiler/**`, `schema/fsm.schema.json`, `machines/**`, `fsm.lock.json`, `conformance/**`, `contracts/features.json`, `fsm.config.json` | `compiler-test gen-check` |
| `schema/persist.dbs` | `gen-check packages-test` |
| `schema/fsm.dbs`, `packages/fsm-db/**` | `db-test` |
| `packages/fsm-gui/**` | `gui-test` |
| `packages/fsm-<kind>/**` | `layout-check gen-check parity-<kind> dependency-policy-check` |

- kind의 소유 검사는 `parity-<kind>`(kind마다 쓰는 리터럴 타깃, 선행 타깃 `test-<kind>`, recipe `node scripts/check-parity.mjs --kind <kind>`)다. `--kind`이면 check-parity는 그 kind의 결과만 읽고 C-4 조건을 그 결과에만 적용한다(모든 벡터 케이스가 1번 실행되어 통과, 미등록 케이스 없음, `inputs` 최신, `elapsedMs`). 다른 kind의 결과와 도구 결과는 읽지 않는다. 선행 타깃과 `--kind`가 없는 `parity-check`는 모든 kind와 도구 결과를 읽고 `check`에서 `packages-test` 뒤에 돈다.
- 독립 항목(S-03, S-04, S-05)은 병렬로 진행할 수 있다.
- 전체 스위트는 S-17 커밋 후 `make check`로 1회 돌린다.

## E. 진행 순서
1. kit K17~K19 → kit 릴리스 → fsm S-01부터 진행한다.
2. 구현 중 감사 루프는 0절 감사 규칙을 따른다. 감사자는 정확한 수정 위치와 대체 문장을 내고, 근거를 확인해 판정하며, 핵심 이견이 0이 될 때까지 반복한다.

## Verification
- 루트 Makefile이 `include scripts/kit/kit.mk` 뒤에 다음 타깃을 정의한다.
  - `CHECK_TARGETS`, `check`
  - `layout-test`, `layout-check`, `parity-test`, `parity-check`
  - `compiler-test`, `db-test`, `gui-test`, `gen-check-test`, `gen-check`
  - `test-<kind>`, `parity-<kind>`(`parity-<kind>: test-<kind>`), `packages-test`(`kinds`의 `test-<kind>`를 `make -j6`으로)
- `check` = `node scripts/kit/full-run.mjs run $(CHECK_TARGETS)`
  - `CHECK_TARGETS` = `kit-check owner-validate documents-check commits-check hooks-check toolchain-check dependency-policy-check layout-test layout-check parity-test compiler-test gen-check-test gen-check db-test gui-test npm-types name-test name-check packages-test parity-check`
- 항목 개발 중에는 owner-checks 매핑만 실행한다.
- GUI 수동 확인: json·mermaid·db store 각각으로 다음을 확인한다.
  1. 상태를 추가·삭제·rename한 뒤 저장한다(lock은 save가 함께 갱신).
  2. `check`가 통과한다(json·mermaid는 `fsm-gen check`, db는 `fsm-db check`).
  3. 브라우저에서 Mermaid가 표시된다.
