<!-- doc-id: execution-checklist -->
<!-- source-sha256: b67383426a805a2cc9f1e83f715fcd8799faaf5249fd935cc97898de2a1eb65d -->
# 실행 체크리스트

## fsm v1

| ID | 작업 | RED → GREEN | 상태 |
|---|---|---|---|
| S-01 | git init, kit v0.0.14, config(toolchain은 Node.js만, dependency policy는 빈 목록과 review 기록), hook, AGENTS.md(.ko), 이 체크리스트, CHANGELOG, 계획, `CHECK_TARGETS`와 `check` | `kit-check owner-validate documents-check commits-check toolchain-check hooks-check dependency-policy-check` 통과 | [o] |
| S-02 | `docs/spec/fsm.md(.ko)`: 계획 B절을 고정한 정의 | `documents-check`가 쌍 없이 실패, 있으면 통과 | [o] |
| S-03 | `scripts/check-layout.mjs` + `contracts/layout.json`(tools, kinds = {}, kind마다 required 파일과 allowed glob을 담는 객체) + `layout-test`/`layout-check` | fixture(kinds 불일치/추가/누락/개명/php↔php-ext 불일치/형식 오류) RED → GREEN | [o] |
| S-04 | `scripts/check-parity.mjs`(`--kind` 포함) + `parity-test` | fixture(결과 없음/도구 결과 없음/`--kind`는 자기 kind만 읽음/stale inputs/미실행/미등록/0케이스/fail/timeout/skip/이름 일치 0·2개/부모 id/10분 초과) RED → GREEN | [o] |
| S-05 | core `E_SCHEMA` + schema 대응 테스트 | RED → GREEN | [o] |
| S-05-1 | core 그래프 오류 | 오류 코드별 RED → GREEN | [o] |
| S-05-2 | core 이름·code 오류 | 오류 코드별 RED → GREEN | [o] |
| S-05-3 | core key 길이: machine·상태·이벤트 key는 64자 이하(E_KEY_FORMAT)이며, DB store의 varchar(64)가 모든 유효 key를 담는다 | 64 통과, 65 RED → GREEN | [o] |
| S-06 | normalize/IR + lock(rename/reserved) + JsonStore + store 계약 + `run`/`copy` | lock 시나리오별 RED → GREEN | [o] |
| S-06-1 | 비동기 store 계약: 모든 store의 load()·save()와 core run/copy가 Promise를 돌려주어 DB store가 비동기 orm client를 쓸 수 있다. validate, normalize, lock, vectors는 동기로 남는다 | 계약 테스트가 모든 store에서 Promise를 await RED → GREEN | [o] |
| S-07 | `fsm.config.json` + `machines/order.fsm.json` + `fsm.lock.json` + `contracts/features.json` + vector 오라클 + `scripts/gen-check.mjs` + `gen-check-test` | 수작업 기대값 fixture와 일치, gen-check RED → GREEN | [o] |
| S-08 | MermaidStore(정규형 parser와 writer) + json↔mermaid 왕복 | `E_MERMAID_UNSUPPORTED`·순서 위반·왕복 불일치 RED → GREEN | [o] |
| S-09 | npm backend + `vectors --kind npm`(golden) | golden RED → GREEN | [o] |
| S-09-1 | npm 패키지: conformance + persist + `examples/model/`, `kinds`에 kind 추가, toolchain과 의존 고정, `test-npm`와 `parity-npm`(공용 `schema/persist.dbs` 생성) | 생성물 없이 `test-npm` RED → GREEN, `layout-check`와 `parity-npm` 통과 | [o] |
| S-09-2 | npm 타입 검사: 패키지 테스트가 생성된 `.d.ts`에 대해 소비자 파일을 TypeScript strict 모드(고정 devDependency)로 컴파일해, 잘못된 선언을 수동 확인이 아니라 도구가 잡는다 | 잘못된 `.d.ts` RED → GREEN | [o] |
| S-10 | go backend + `vectors --kind go`(golden) | golden RED → GREEN | [o] |
| S-10-1 | go 패키지: conformance + persist + `examples/model/`, `kinds`에 kind 추가, toolchain과 의존 고정, `test-go`와 `parity-go` | 생성물 없이 `test-go` RED → GREEN, `layout-check`와 `parity-go` 통과 | [o] |
| S-11 | python backend + `vectors --kind python`(golden) | golden RED → GREEN | [o] |
| S-11-1 | python 패키지: conformance + persist + `examples/model/`, `kinds`에 kind 추가, toolchain과 의존 고정, `test-python`와 `parity-python` | 생성물 없이 `test-python` RED → GREEN, `layout-check`와 `parity-python` 통과 | [o] |
| S-11-2 | python 패키지: kit K22(run-tests python이 color 없이 실행)를 sync하면 packages/fsm-python/Makefile의 `PYTHON_COLORS=0`을 제거한다. 제거 조건: K22가 든 kit release를 `make kit-sync`로 채택 | FORCE_COLOR가 있고 Makefile에 PYTHON_COLORS가 없어도 test-python 통과 | [o] |
| S-11-3 | `make install-python`은 uv를 `--no-bin`으로 실행하므로 uv는 사용자 bin 디렉터리(기본 `~/.local/bin`)에 아무것도 쓰지 않는다. `var/tools/bin/python3`만 uv 관리 인터프리터를 가리킨다 | `UV_PYTHON_BIN_DIR`를 임시 디렉터리로 지정하면 install-python이 그곳에 `python3.14`를 쓴다 RED → GREEN; `--no-bin`이면 그 디렉터리는 비어 있고 `~/.local/bin`은 바뀌지 않는다 | [o] |
| S-12 | php backend + `vectors --kind php`(golden) | golden RED → GREEN | [o] |
| S-12-1 | php 패키지: conformance + persist + `examples/model/`, `kinds`에 kind 추가, toolchain과 의존 고정, `test-php`와 `parity-php` | 생성물 없이 `test-php` RED → GREEN, `layout-check`와 `parity-php` 통과 | [o] |
| S-13 | rust backend + `vectors --kind rust`(golden) | golden RED → GREEN | [o] |
| S-13-1 | rust 패키지: conformance + persist + `examples/model/`, `kinds`에 kind 추가, toolchain과 의존 고정, `test-rust`와 `parity-rust` | 생성물 없이 `test-rust` RED → GREEN, `layout-check`와 `parity-rust` 통과 | [o] |
| S-14 | php-ext backend + `vectors --kind php-ext`(golden) | golden RED → GREEN | [o] |
| S-14-1 | php-ext 패키지: conformance + persist + `examples/model/`, `kinds`에 kind 추가, toolchain과 의존 고정, `test-php-ext`와 `parity-php-ext` | 생성물 없이 `test-php-ext` RED → GREEN, `layout-check`와 `parity-php-ext` 통과 | [o] |
| S-14-2 | php-ext backend: 첫 build에서 드러난 C 출력(객체 인자를 zval로, Error method 표를 생성자 뒤로, format macro, class 타입 property, 영구 Code 값), C-1이 S-14에 배정한 phpize 무시 패턴 | golden 파일을 다시 쓰고 compiler test 통과; 패키지 build는 S-14-1이 확인 | [o] |
| S-14-3 | gen과 vectors --kind는 출력 디렉터리에서 git이 무시하는 파일을 건너뛴다: 무시된 빌드 산출물(php-ext src/의 phpize 파일)은 손으로 쓴 파일이 아니므로 E_NOT_GENERATED로 생성기를 막지도 않고 지워지지도 않는다. 헤더 없는 추적 파일과 무시되지 않은 새 파일은 여전히 막는다 | make clean 없이 php-ext build 뒤 gen RED → GREEN, 손으로 쓴 파일은 여전히 E_NOT_GENERATED | [o] |
| S-15 | fsm-db: `schema/fsm.dbs` + DbStore + 계약 테스트 + copy + `db-test` | 계약 불일치·`E_STORE_NOT_EMPTY`·원자성 RED → GREEN | [o] |
| S-15-1 | fsm-db install: fsm.config.json의 database에 orm으로 schema/fsm.dbs를 설치하는 명령과, DB store를 준비하고 쓰는 방법을 담은 packages/fsm-db/README.md(.ko). 이것이 없으면 사용자는 코드를 쓰지 않고는 table을 만들 수 없다 | 새 database에서 fsm-db check가 table 없음으로 실패, fsm-db install 뒤 check 통과 RED → GREEN | [o] |
| S-16 | GUI 골격: hyper app + 목록·상세 + Mermaid + `gui-test` + 고정 버전 mermaid 패키지로 정규형과 B-5의 모든 예약 상태 key를 파싱하는 테스트 | handler RED → GREEN | [o] |
| S-16-1 | GUI test hang: `make gui-test` 실행 한 번에서 중첩 Mermaid subtest가 빈 event loop로 "the test did not finish"를 보고했고 약 20번 재현되지 않았다. 원인을 찾아 원인에서 고치고, 호출별 deadline이 원인을 가렸을 뿐이면 제거한다 | 재현(또는 원인 증명) RED → GREEN | [o] |
| S-17 | GUI 편집: crudui 폼 + 검증 오류 표시 + rename | 저장 후 `check` 통과 | [o] |
| S-17-1 | GUI 후속: 브라우저에서 추가한 행이 core nextCode의 제안 code를 보이고(페이지가 다음 code를 담는다), 편집 폼에서 상태를 지우면 그 code가 reserved로 옮겨짐을 GUI 테스트가 증명한다 | code 제안 없는 추가 행 RED, reserved 없는 삭제 RED → GREEN | [o] |
| S-18 | status를 fsm으로 전부 바꾼다: 문서의 저장소 이름, 패키지(`packages/fsm-*`), 명령(`fsm-gen`, `fsm-db`, `fsm-gui`), 파일(`fsm.config.json`, `fsm.lock.json`, `machines/*.fsm.json`, `*.fsm.mmd`), 생성 공용 모듈(`fsm.Error`)과 예약 machine key, 계획·spec 문서, 그리고 모든 golden과 vector를 다시 생성 | 상태 의미가 아닌 `status` 이름이 남으면 RED(scan) → GREEN, make check 통과 | [o] |
| S-18-1 | S-18이 이름 붙인 명령이 존재한다: `fsm-gen`(packages/fsm-compiler), `fsm-db`(packages/fsm-db), `fsm-gui`(packages/fsm-gui)가 각 package manifest의 `bin` 항목이고, 각 파일은 node shebang으로 시작하며, clone에서 `npm install -g ./packages/<package>`가 명령을 PATH에 둔다. S-18은 문서에서만 이름을 바꿔 사용자가 문서의 이름으로 실행할 수 없었다 | package 테스트가 임시 npm prefix에 offline으로 설치하고 명령을 실행: bin 없음 RED → 명령이 응답 GREEN | [o] |
| S-19 | 루트와 모든 패키지 README(영·한) 완성: 설치, 세 store의 정의, CLI, 언어별 생성 API와 apply·영속화 예제, GUI, DB store. 문서 검사가 모든 링크를 검증 | 사용법 절이 없는 README RED → GREEN | [ ] |
| S-20 | 문서 사이트: 문서(spec, 언어별 가이드, CLI, GUI, DB)로 빌드하는 docs/.vitepress의 VitePress, kit documents site link를 쓰는 `docs-build` 타깃, owner 규칙 | 깨진 링크에서 docs-build 실패 RED → GREEN | [o] |
| S-20-1 | 사이트 빌드에 경고가 없다: VitePress 빌드가 "Circular chunk: framework -> theme -> framework"를 출력하며 원인을 추적하지 않았다. 원인을 추적해 없애거나, 출력이 올바르다는 근거와 함께 원인을 plan에 기록한다 | 어떤 빌드 경고에서도 docs-build-test 실패 RED → GREEN | [ ] |
| S-21 | 공개: public 저장소 polyspec/fsm 생성, main push, make check를 돌리는 CI workflow, 사이트를 배포하는 Pages workflow. 사용자가 2026-10-11에 모든 단계를 허락했다. push 뒤 로컬 저장소 디렉터리 이름을 `fsm`으로 바꾼다 | GitHub에서 사이트와 CI가 응답 | [ ] |
| S-22 | 계획(Verification)의 GUI 수동 확인을 json, mermaid, db store 각각으로 한다: 상태 추가·삭제·rename 후 저장, `fsm-gen check` 또는 `fsm-db check` 통과, 브라우저의 Mermaid 표시, 추가한 행의 제안 code. 트리와 store별 단계·결과를 `docs/verification/gui.md(.ko)`에 기록한다 | 실패한 단계는 새 하위 항목 RED → 모든 store의 모든 단계가 통과하고 기록됨 GREEN | [ ] |
| S-22-1 | GUI 폼의 추가·삭제 버튼이 페이지의 행을 바꾼다: client가 form instance를 구독해 다시 렌더링한다(`patchContent(host, renderForm(form))` 뒤 `connection.sync()`). 이것이 crudui `connectForm`의 계약이다. S-22 확인에서 클릭이 instance만 바꾸고 페이지는 바꾸지 않음을 발견했고, handler 테스트로는 보이지 않는다. `packages/fsm-gui/tests`의 브라우저 테스트(고정한 Playwright, 임시 프로젝트로 띄운 GUI)가 이를 소유한다 | add 클릭 뒤 행 수가 그대로 RED → 제안 code를 가진 행이 나타나고, remove가 없애고, save가 저장 GREEN | [o] |
| S-22-2 | GUI 폼을 쓸 수 있다: crudui stylesheet `@polyspec/crudui-generator-core/crudui.css`가 asset bundle에 들어가 행 버튼이 동작을 보여 주고, 모든 field가 구별되는 label을 가지며(저장된 key와 새 key가 둘 다 "Key"가 아님), `/favicon.ico`가 404 대신 icon을 준다 | 브라우저 테스트가 label 없는 행 버튼, 한 행의 같은 label 두 개, 404를 찾음 RED → GREEN | [ ] |
| S-23 | rust backend가 모든 유효한 machine을 compile한다: event가 없는 machine(GUI new 화면이 만드는 것)은 variant 없는 enum에 `#[repr(i32)]`를 받아 rustc가 거부한다(E0084)(감사 1) | compiler 테스트와 event 없는 package machine을 cargo로 빌드 RED → GREEN | [ ] |
| S-24 | php-ext backend가 모든 C 이름을 `--php-ext-name`에서 만든다: 옵션과 무관하게 machine `.c`가 `php_polyspec_fsm_test.h`와 `polyspec_fsm_test_arginfo.h`를 include하고 `Polyspec_FsmTest_Fsm_Error`를 쓴다(감사 2) | 두 번째 extension 이름의 backend 테스트와 그 phpize 빌드 RED → GREEN | [ ] |
| S-25 | conformance machine이 정의를 덮는다: `machines/`에 event 없는 machine, underscore key machine, reserved code machine, code 2147483647 machine을 더해 여러 machine이 함께 돈다. go harness가 order 외 machine을 거부하지 않는다(key 표를 vectors_test.go에 생성). 모든 kind가 모든 vector를 통과한다(감사 3) | S-23·S-24 전에는 rust와 php-ext 결함으로 packages-test 실패 RED → 모든 kind 통과 GREEN | [ ] |
| S-26 | 모든 vector가 결과 전체를 단언한다: 오류 vector가 `code`, `expected`, `actual`, `event`(B-4, B-6)를 갖고 모든 언어가 이를 단언한다. `from_code`에 음수, 2^31, 64비트 최댓값을 준다. 언어 타입이 허용하면 `code`, `key`, `is_final`, `apply`에 잘못된 state 값을 준다(감사 4, 15) | expected와 actual을 바꾸거나 잘못된 값에 다른 분기를 돌려주는 backend가 실패 RED → GREEN | [ ] |
| S-27 | `name-check`가 줄이 아니라 출현마다 판정한다: 허용 구절을 줄에서 지우고 남은 부분을 다시 검사하며, model과 CHANGELOG 항목은 자기 구절만 허용한다. rename 잔재를 고친다(`Makefile`의 "old name `fsm`", 테스트 helper의 "returns its fsm", python과 rust의 status column용 `fsm_of`)(감사 6, 12) | 감사 probe 줄이 검사를 통과 RED → finding GREEN | [ ] |
| S-28 | spec B-2의 store 계약 테스트가 존재한다: 모든 유효 fixture가 json → db → mermaid → json으로 바이트 동일하게 왕복하고, `run` gen과 vectors가 세 store에서 바이트 동일한 출력을 낸다(감사 7) | field를 버리는 store가 지금은 통과 RED → GREEN | [o] |
| S-29 | 새 clone에서 `make check`가 통과한다: root install 타깃 하나가 모든 package 의존성(npm, composer, python, cargo, 각 package의 orm-gen)을 설치하고, 필요한 타깃의 선행 조건이다. CI는 정확히 `make check`를 돈다(감사 8) | 새 clone의 make check가 orm-gen, tsc, phpunit, .venv에서 실패 RED → 통과 GREEN | [ ] |
| S-30 | lock을 잃어도 code의 의미가 바뀌지 않는다: `lock`과 `check`가 lock을 커밋된 lock(json·mermaid는 git HEAD, db는 저장된 행)과 비교한다. 커밋된 codes나 reserved의 어떤 code도 빠지거나 key를 바꿀 수 없다. 규칙과 오류 코드를 spec B-3, B-5에 더한다(감사 9) | 두 code를 바꾸고 fsm.lock.json을 비운 뒤 lock: 지금은 ok RED → 거부 GREEN | [ ] |
| S-31 | 모든 언어의 영속화가 spec B-4를 지킨다: rust 예제가 deadlock 때 orm이 다시 실행하는 transaction을 쓰거나(`transaction_once` 아님), 차이와 이유를 spec B-4와 layout.json에 적는다. spec B-4에 transaction + forUpdate를 쓰는 이유(orm v0.0.7에는 영향 행 수를 주는 조건부 update가 없음)와 다시 볼 조건을 기록한다(감사 10, 11) | rust 예제의 deadlock 재시도 테스트와 기록의 documents-check RED → GREEN | [ ] |
| S-32 | compiler의 import를 명시하고 테스트한다: compiler는 clone의 벤더 kit helper(`scripts/kit/files.mjs`, `git.mjs`, `process.mjs`)를 import하는데 plan은 의존성 0이라 한다. plan이 compiler가 import할 수 있는 것(node 내장, 자기 파일, clone의 kit, npm package 없음)을 정확히 적고 테스트가 import를 검사한다(감사 5) | 명시 집합 밖의 import가 지금은 통과 RED → GREEN | [ ] |
| S-33 | 조용한 변환과 null 반환이 없다: php `fromCode`가 npm·python처럼 int가 아닌 값을 거부한다. `packages/fsm-gui/src/forms.mjs`와 `src/core/validate.mjs`가 null을 반환하지 않는다. spec B-6이 생성되는 오류 상수를 정확히 적는다(감사 13, 14, 22) | strict_types 없이 `fromCode("2")`, `fromCode(2.0)`, `fromCode(true)`가 성공 RED → 모든 언어에서 같게 E_UNKNOWN_CODE 또는 type error GREEN | [ ] |
| S-34 | python 의존성을 잠근다: fsm-python의 모든 전이 package가 dependency-policy가 덮는 커밋된 lock에 정확한 버전과 hash를 갖는다(감사 16) | 고정되지 않은 의존성이 통과 RED → GREEN | [ ] |
| S-35 | plan과 contract가 저장소와 맞는다: plan의 D 표가 낡은 상태를 보이지 않고(체크리스트를 가리킴), C-1 트리에 `src/store-lock`이 있고, `contracts/layout.json`이 npm의 `tests/types*`를 선언하고 이유를 적으며, S-11-3에 반복 가능한 테스트가 생기고, `kit-test`가 CHECK_TARGETS에 들어간다(감사 17, 18, 19, 21) | npm 선언 없는 layout-check, bin link를 쓰는 uv에 대한 S-11-3 테스트 RED → GREEN | [ ] |
| S-36 | fsm-db CLI를 문서의 모든 명령에 대해 process로 테스트한다: `lock --rename`과 `copy --to mermaid` / `copy --from mermaid`(감사 20) | 문서의 출력이 단언되지 않음 RED → GREEN | [o] |
| S-37 | 영속화와 DB store를 문서가 이름 붙인 모든 dialect에서 증명한다: 같은 (expected, event)의 동시 transaction 두 개가 Changed 하나와 Unchanged 하나를, 충돌하는 쌍이 E_CONFLICT를 내는지 단언하는 테스트. db-test와 영속화 테스트가 SQLite, PostgreSQL, MySQL에서 돈다(로컬 임시 서버와 CI service). 문서가 테스트한 dialect를 적는다(감사 23, 24) | 동시 테스트가 실패하거나 없음 RED → 세 dialect에서 GREEN | [ ] |
