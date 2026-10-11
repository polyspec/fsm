<!-- doc-id: plan-fsm-v1 -->
<!-- source-sha256: 9a955858d99dcc9a33f2a848e965ba515bfa4f993934d8056a43b451a4fe2af3 -->
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
  - `name-check`(`scripts/check-name.mjs`, RED 테스트는 `tests/check-name/`): 추적 파일과 경로가 라이브러리를 옛 이름 `status`로 부르지 않는다. 출현마다 판정한다: 허용 항목이 이름 붙인 구절을 줄에서 지우고, 남은 부분에 그 단어가 있으면 finding이다. 허용 항목은 소비자 상태 열의 상태 값(접근자와 열 용어), 프로세스·요청의 exit·HTTP·테스트 결과 용어, 벤더 kit, S-01부터 S-18까지(rename 포함)의 CHANGELOG 항목, 계획과 규칙의 rename 용어이며, 각각 `ALLOWED`의 항목으로 이유를 가지고 정확한 구절만 허용한다(R12).
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
  scripts/check-layout.mjs scripts/check-parity.mjs scripts/check-name.mjs scripts/gen-check.mjs scripts/check-python-lock.mjs   tests/check-layout/ tests/check-name/ tests/check-parity/ tests/docs-build/ tests/gen-check/ tests/install-python/ tests/check-python-lock/
  contracts/layout.json (tools, kinds, canonical tree, allowed differences)   contracts/features.json
  docs/spec/fsm.md(.ko)  docs/plans/execution-checklist.md(.ko)  docs/plans/fsm-v1.md(.ko)
  docs/package.json docs/package-lock.json docs/.vitepress/config.mts   # the documentation site (C-8)
  schema/fsm.schema.json  schema/fsm.dbs  schema/persist.dbs   # persist.dbs = shared by the six language package examples
  fsm.config.json  machines/order.fsm.json  fsm.lock.json  conformance/vectors/<machine>.json
  packages/fsm-compiler/  {src/core/, src/backends/, src/store-json/, src/store-lock/, src/store-mermaid/, src/cli/, tests/}  # imports only the set of C-5 (no npm package)
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
  - `.node-version`에는 정확한 26.y.z 릴리스를 쓴다(hyper 요구. kit toolchain-declared.mjs는 `<major>.<minor>.<patch>`만 받는다).
- 고정은 manifest와 lock 파일에 하고 `config/dependency-policy.json`에 적는다. kit gate는 npm URL, Composer `package` dist URL, python `git+…@tag`, cargo tag를 검사하지 않는다. 고정 확인은 리뷰 규칙이다(이를 도구로 요구하는 R은 없다). 단 python lock은 예외로 `make python-lock-check`가 검사한다(아래 결정).
  - 결정(python lock, S-34): python 의존성 트리는 `packages/fsm-python/uv.lock`(`uv lock`, version 1)으로 잠근다. 레지스트리 package마다 정확한 버전과 각 artifact의 sha256을, git package마다 태그의 commit을 적는다(orm과 ordered-json은 `v0.0.7`). `make -C packages/fsm-python install`은 이 lock으로 `uv sync --locked`를 실행하므로 uv가 각 artifact를 hash와 대조한다(측정: 변조한 wheel hash는 `Hash mismatch for pyyaml==6.0.3`으로 거부된다). 형식을 hash가 든 requirements 파일이 아니라 uv.lock으로 정한 이유: `pip install --require-hashes`는 git requirement를 거부하므로(pip 26.2.1로 측정: `Can't verify hashes for these requirements because we don't have a way to hash version control repositories`) git package를 두 번째 설치 단계로 옮겨야 한다. kit gate는 Python manifest의 build-system과 optional requirement(`pythonManifests`)만 읽고 Python lock은 읽지 않으므로 고정되지 않은 런타임 의존성을 통과시킨다(측정: 추적 파일의 복사본에 `requests>=2`를 더하고 lock이 없으면 `check-dependency-policy.mjs`가 통과한다). `scripts/check-python-lock.mjs`(`make python-lock-check`)가 pin, commit, tag, current, closure 규칙으로 lock을 검사한다. 덮지 않는 것: 전이 package의 최신 릴리스와 advisory 리뷰는 kit 리뷰 기록이 Python lock을 읽지 않으므로 빠진다. 이는 kit 변경이며 S-34-1로 등록한다. build backend `setuptools==84.0.0`은 pyproject.toml에서 버전으로 고정되고 격리된 환경에서 빌드되며, uv는 그 hash를 검사하지 않는다.

### C-2. 언어 패키지 정규 구조 (6개 동일)
```
packages/fsm-<kind>/
  README.md README.ko.md
  Makefile          # gen (gen + vectors --kind; flags only here; DEST ?= .)
                    # test (run-tests --cwd packages/fsm-<kind> --results .results/<kind>.json; paths resolve against the checkout root)
  <manifest>        # [allowed difference] depends on orm (SQLite) for tests and examples
  <lock>            # [allowed difference] go.sum, package-lock.json, composer.lock, Cargo.lock (read by the kit dependency gate); python has `uv.lock` (S-34; `python-lock-check` reads it)
  src/…             # fsm-gen output only
  tests/conformance.<ext>   # hand-written check functions; except in rust, iterates the vectors and registers one test per case
  tests/vectors.<ext>       # fsm-gen output (language-native data); in rust, one #[test] per case
  examples/persist.<ext>    # B-4 orm persistence; tests run it with the persist vectors
  examples/model/           # orm-generated model from the root schema/persist.dbs (committed, covered by gen-check); rust uses build.rs as an allowed difference
```
- `make gen`은 fsm-gen 출력과 orm-gen 출력을 함께 만든다. `contracts/layout.json`에서 kind의 `generated` glob이 이 출력이 쓰는 파일을 이름 짓고, `gen-check`는 정확히 그 파일을 비교한다.

| kind | manifest | src | tests 비고 |
|---|---|---|---|
| go | go.mod | `src/order/order.go`, `src/fsm/fsm.go` (Go는 package = 디렉터리) | `conformance_test.go`(일반형: 각 case를 그 machine의 adapter로 실행), `vectors_test.go`(생성: vector case, 모든 machine의 key 표, machine마다 `conformance_test.go`의 interface를 구현하는 adapter 하나; import가 module을 이름으로 쓰므로 `vectors --kind go`는 `--go-module`을 받는다) |
| npm | package.json | `order.js/.d.ts`, `fsm.js/.d.ts`, `index.js/.d.ts`(`export * as order`) | `conformance.test.mjs`, `vectors.mjs` |
| php | composer.json | `Order/{State,Event,Step}.php`, `Order/functions.php`, `Fsm/Code.php` (error code enum, its own file for PSR-4), `Fsm/Error.php`, 그리고 적재기 `functions.php`(모든 machine의 `Order/functions.php`를 require한다; PSR-4가 함수를 싣지 못하므로 composer `autoload.files`는 이 파일만 이름으로 든다) | `ConformanceTest.php`, `Vectors.php` |
| php-ext | composer.json(`type: php-ext`, `extension-name`, `build-path: src`) | `config.m4`, `order.c`, `fsm.c`(공용 `<ns>\Fsm\Error`와 오류 코드 상수), `php_<ext>.h`, `<ext>.stub.php`, `<ext>_arginfo.h` | php와 **바이트 동일**한 테스트. `make test`가 phpize로 빌드한 뒤 `--php-extension <.so>`로 실행. gen에 `--php-namespace`·`--php-ext-name` 필수 |
| python | pyproject.toml | `polyspec_fsm/{__init__,order,fsm}.py` | `test_conformance.py`(케이스 이름 그대로의 메서드 생성), `vectors.py` |
| rust | Cargo.toml(`autotests=false`, `autoexamples=false`, `[[test]] conformance`, build-dep `polyspec-orm-build`, dev-dep `tokio`) + `build.rs` | `lib.rs`(`pub mod order; pub mod fsm;`), `order.rs`, `fsm.rs` | `conformance.rs`(`mod vectors;`, `#[path="../examples/persist.rs"] mod persist;`), persist 케이스는 `#[tokio::test]`, 생성 `tests/vectors.rs`는 `#![allow(non_snake_case)]`로 시작 |

- check-layout이 실패시키는 경우
  - `packages/fsm-*` 디렉터리 집합에서 `layout.json`의 `tools`에 적은 도구 패키지 `fsm-compiler`, `fsm-db`, `fsm-gui`를 뺀 집합이 `kinds`와 다름
  - 추적 파일과 무시되지 않은 신규 파일이 정규 트리에서 벗어남(추가/누락/개명)
  - php와 php-ext의 테스트가 바이트 단위로 다름
  - layout.json 형식 오류
  - 테스트 파일(허용 glob `tests/` 중 필수 집합 밖)이 layout.json의 `differences`에 이유와 함께 없거나, 선언된 차이가 kind의 허용 glob이 아닐 때
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
- `kinds`가 허용하는 어느 kind에서 벡터 케이스가 실행되지 않음(`kinds`가 없는 케이스는 모든 kind가 허용한다), 또는 kind가 `kinds`가 제외한 케이스를 실행함
- 벡터에 없는 케이스가 결과에 있음
- features.json의 기능 중 벡터 케이스가 0개인 기능이 있음
- 상태가 `pass`가 아닌 케이스가 있음(`fail`, `timeout`, `skip` 모두 실패)
- 결과 id 하나에서 서로 다른 케이스 이름이 2개 이상 나오거나, 하나도 나오지 않는데 일치한 id의 부모(일치한 id가 ` › `로 이어 붙이는 id. 예: 케이스를 subtest로 실행하는 Go 테스트 함수)가 아님
- `--kind`가 없을 때: `--tools`가 가리키는 도구 테스트(Makefile의 `TOOL_TESTS`: layout-test, parity-test, gen-check-test, compiler-test, db-test, gui-test를 각 항목이 추가)의 기록 `.results/<target>.json`이 없거나, stale이거나, `pass`가 아닌 케이스를 가짐
- 어느 `.results/*.json`이든 `elapsedMs > 600000`(`--kind`이면 그 kind의 결과만)

케이스 이름 추출: `/\btest_[a-z][a-z0-9]*(?:_[a-z0-9]+)*__[a-z][a-z0-9]*(?:_[a-z0-9]+)*\b/`를 결과 id마다 적용한다. 서로 다른 일치가 정확히 1개인 id가 그 케이스이고, 0개 또는 2개 이상인 id는 위 결과 id 항목으로 판정한다. 도구별 규칙은 없다.

`contracts/features.json` = `{schema: 1, features: [initial, code, key, from_code, is_final, events_from, target, apply, persist]}`. vector 파일은 `conformance/vectors/<machine>.json` = `{machine, cases: [{feature, id, …}]}`이고, 케이스 이름은 `test_<feature>__<id>`다.

Conformance machine(`machines/`, S-25): 모든 kind가 `machines/`의 모든 machine의 벡터를 돈다. 그래서 여섯 kind가 정의의 모양을 모두 덮는다: `order`(예시), `standby`(event 없음: 상태 하나이며 initial이자 final), `in_review`(machine, 상태, event key의 underscore), `ticket`(reserved code 2와 4: 첫 lock 뒤 제거한 상태이며 lock은 이를 reserved로 유지), `limits`(code 2147483647). 각 kind는 209 케이스를 통과한다(`parity-check`).

벡터(전수, 오라클은 core가 생성):
- `initial`
- 상태마다 `code`/`key`/`from_code` 왕복, `is_final`, `events_from`
- 모든 (state, event)의 `target`
- 정의된 (expected, event)마다
  - actual = expected → `Changed`
  - actual = to → `Unchanged`
  - 그 외 모든 정의 상태 → `E_CONFLICT`
- 미정의 (state, event) → `E_INVALID_TRANSITION`
- `from_code`: 0, 미지 code, 각 예약 code, 음수 code, 2^31, 64비트 최댓값(예약 code를 제외하고 모두 E_UNKNOWN_CODE)
- 잘못된 state 값(S-26): `code`, `is_final`, `key`, `apply`(expected 또는 actual)에 0과 미지 code, 아래 표의 kind에서만
- `persist`: 첫 시도 / 재시도 / 충돌
- 모든 오류 case는 fsm.Error의 네 필드(`code`, `expected`, `actual`, `event`, 명세 B-6)를 명명한다. 해당하지 않는 필드는 null이다: E_CONFLICT는 expected와 actual의 state code와 event 위치, E_INVALID_TRANSITION은 expected의 code와 event 위치, E_UNKNOWN_CODE와 E_RESERVED_CODE는 아무것도 없다
- `from_code`의 입력은 십진 문자열이므로 파일에서 64비트 범위가 정확하다. npm kind는 가장 가까운 number를 받는데, 이는 안전하지 않은 정수이므로 E_UNKNOWN_CODE다
- case id: case id는 `<machine>_<suffix>`이고, suffix의 key마다 선언 index를 쓴다. 이름과 무관하게 두 id가 충돌하지 않게 하기 위해서다. state는 `s<i>`, event는 `e<j>`(둘 다 0부터 시작), 예약 code는 `r<code>`다. id는 `<m>_initial`; `<m>_code_s<i>`, `<m>_key_s<i>`, `<m>_from_code_s<i>`, `<m>_is_final_s<i>`, `<m>_events_from_s<i>`; `<m>_from_code_zero`, `<m>_from_code_unknown`, `<m>_from_code_r<code>`, `<m>_from_code_negative`, `<m>_from_code_int32_overflow`, `<m>_from_code_int64_max`; `<m>_code_v<value>`, `<m>_is_final_v<value>`, `<m>_key_v<value>`, `<m>_apply_expected_v<value>_e0_s0`, `<m>_apply_actual_v<value>_e0_s0`(value는 0과 미지 code); `<m>_target_s<i>_e<j>`; `<m>_apply_s<i>_e<j>_s<k>`(expected, event, actual); `<m>_persist_first`, `<m>_persist_retry`, `<m>_persist_conflict`다. 케이스 데이터 필드는 key(state, event, expected, actual 등)를 그대로 쓰며, 바뀌는 것은 id뿐이다.
- 잘못된 state 값(S-26): state 인자가 state가 아닌 값을 가질 수 있는지는 kind의 state 타입에 달려 있다. 잘못된 값을 가진 case는 `kinds`에 그 값을 허용하는 kind를 적고, check-parity는 그 kind들에만 이를 요구한다. 명세 B-6의 규칙(함수는 E_UNKNOWN_CODE로 실패한다)에 대해 kind별 결정은 다음과 같고 여기에 기록한다.

  | kind | state 타입 | 잘못된 state 값 |
  |---|---|---|
  | go | `State int32` | 허용: switch의 default 분기가 E_UNKNOWN_CODE다 |
  | npm | number이며 state가 곧 그 값 | 허용 |
  | python | int(`IntEnum`의 멤버이며 함수는 어떤 int든 받는다) | 허용 |
  | rust | `#[repr(i32)]`의 `enum State` | 허용하지 않음: 타입에 state가 아닌 값이 없다 |
  | php, php-ext | `enum State: int` | 허용하지 않음: 타입에 state가 아닌 값이 없다 |

- rust, php, php-ext의 native vector 모듈은 자기 kind가 허용하는 case만 담는다(core `forKind`). 그래서 다섯 machine의 270개 case 중 224개를 돌리고, go, npm, python은 270개를 모두 돌린다.
- persist 케이스는 machine에 transition이 있을 때만 존재한다. `conflict`는 third state가 있을 때만 존재하므로, state가 2개인 machine은 `first`와 `retry`만 갖고, transition이 없는 machine(예: state가 1개인 machine)은 persist 케이스가 없다.

- 영속화 패턴의 동시성(S-37, 결정): 동시성 증명은 npm에 한 번만 쓴다(`packages/fsm-npm/tests/persist-dialects.test.mjs`, 기록 `npm-persist-test`, `npm-persist-test-postgres`, `npm-persist-test-mysql`, 모두 `TOOL_TESTS`에 있다). 이유: npm client는 한 database에 실제 연결 두 개를 열므로, 한 row의 transaction 두 개가 PostgreSQL과 MySQL에서 동시에 실행되며, B-4가 기대는 잠금은 database 자체의 잠금이다. 다른 kind가 이 테스트를 반드시 되풀이할 필요는 없다. 그 kind들은 SQLite에서 persist vector를 유지하고, dialect 실행은 S-37-1이다. SQLite에서는 두 전이를 차례로 실행한다. SQLite driver가 동기식이라, 같은 프로세스의 두 번째 `BEGIN IMMEDIATE`가 첫 번째를 커밋할 thread를 막고, 5000밀리초 busy timeout 뒤 `CANCELED: sqlite: database is locked`로 실패하기 때문이다. RED: `examples/persist.mjs`에서 `forUpdate()`를 빼면 PostgreSQL 17.11과 MySQL 8.4.11 모두에서 두 전이가 Changed를 보고하고 두 테스트가 실패한다. 복원한 패턴은 세 dialect에서 통과한다.

### C-5. compiler `packages/fsm-compiler`
- Import(S-32): `packages/fsm-compiler/src`는 다음만 import한다: (1) node 내장 모듈, `node:` specifier로; (2) 자기 파일, `src` 안에 머무르는 상대 경로; (3) 이 clone의 벤더 kit `scripts/kit/`(상대 경로, 복사하지 않는다). npm 패키지, bare 내장 이름, 동적 `import()`·`require()`는 없다. `src/core`는 `node:` 모듈을 전혀 import하지 않는다. `packages/fsm-compiler/tests/imports.test.mjs`가 `src`의 모든 import specifier를 검사하고 그 밖이면 실패한다.
- 구성
  - `src/core`: 객체 → validate → normalize → backends, 그리고 `run`, `copy`. `node:` import는 0개이고, GUI가 그대로 import한다.
  - `src/backends/<kind>.mjs`
  - `src/store-json`, `src/store-mermaid`
  - `src/cli` (`fsm-gen`)
- 명령 `fsm-gen`은 `packages/fsm-compiler/package.json`(의존성 없는 manifest)의 `bin`이다. clone에서 `npm install -g ./packages/fsm-compiler`가 이를 PATH에 link한다. `tests/command.test.mjs`가 package를 임시 npm prefix에 offline으로 설치하고 명령을 실행한다(S-18-1).
- 명령
  - `lock [--rename]`
  - `gen --kind <k> --out <dir>` (php는 `--php-namespace` 필수, php-ext는 `--php-namespace`와 `--php-ext-name` 필수, go는 `--go-module <module path>` 필수: 생성된 machine이 공용 패키지 `<module>/src/fsm`를 import하며 backend는 go.mod를 읽을 수 없다)
  - `vectors [--kind <k>] --out <path>` (go: gen과 같이 `--go-module <module path>`)
  - `check`: 전 정의 검증 + lock 일치 + lock이 커밋된 code를 모두 유지(B-3)
  - `copy --to json|mermaid --root <dir>`
- 루트 `gen-check`
  1. `fsm-gen vectors --out var/gen-check/conformance/vectors` 실행
  2. `kinds`의 각 패키지에서 `make gen DEST=$(CURDIR)/var/gen-check/<kind>` 실행
  3. `scripts/gen-check.mjs`가 kit `trackedFiles`(추적 파일과 무시되지 않은 파일만 읽으므로 `__pycache__/`, php-ext `src/`의 phpize 산출물 같은 무시된 출력은 읽지 않는다)로 작업 트리와 비교한다. `conformance/vectors`, 각 패키지 `src/`·`tests/vectors.<ext>`·`examples/model/`(rust 제외)의 파일 집합이 같고 내용이 바이트 동일해야 한다. 각 패키지에서 비교하는 파일은 `contracts/layout.json`의 kind `generated` glob이 맞는 파일이며, 이 glob이 없는 kind는 `layout-config` finding이다.
  - `gen-check-test`(`tests/gen-check/`) RED: 1바이트 변경 fixture, 파일 추가 fixture, 읽지 말아야 할 무시된 파일

### C-6. fsm-db `packages/fsm-db`
- 명령 `fsm-db`는 `packages/fsm-db/package.json`의 `bin`이다. `make db-deps` 뒤 `npm install -g ./packages/fsm-db`가 이를 PATH에 link한다. `tests/command.test.mjs`가 임시 npm prefix에 offline으로 설치하고, 새 SQLite database에 schema를 설치하고 check한다(S-18-1).
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
- `fsm-db` CLI는 core `run`과 `copy`를 DbStore와 json/mermaid store로 실행한다. `install`은 orm `utils().schema().install`로 `schema/fsm.dbs`를 설치한다(S-15-1). 명령과 동작은 `docs/spec/fsm.ko.md`(B-2)와 `packages/fsm-db/README.ko.md`에 있다.
- 테스트(SQLite)
  - store 계약(왕복·결과 바이트 동일)
  - `E_STORE_NOT_EMPTY`
  - CLI를 프로세스로 실행: 새 database에서 `install`(설치 전 `check`는 table이 없어 실패하고 설치 뒤에는 통과), 두 번째 `install`, orm이 거부하는 부분 설치, `install`의 usage
  - transaction 원자성 RED
  - dialect 차이는 orm 자신의 conformance 책임이다.
- 테스트(S-37): `make db-test`는 패키지의 모든 테스트를 SQLite에서 실행한다. `make db-test-postgres`와 `make db-test-mysql`은 `tests/db-store.test.mjs`와 `tests/store-contract-all.test.mjs`를 PostgreSQL과 MySQL에서 실행한다. 두 파일은 `tests/dialect.mjs`로 database를 연다. `FSM_TEST_DIALECT`가 dialect를 고른다(기본 `sqlite`, `postgres` 또는 `mysql`). `FSM_TEST_PG_DSN`과 `FSM_TEST_MYSQL_DSN`이 database를 가리키며, DSN이 없으면 throw하므로 target이 실패하고 case를 건너뛰지 않는다. 각 파일은 schema를 설치하고(database가 이미 schema를 가지면 install은 아무것도 바꾸지 않는다) case 전에 여섯 table을 비우므로, case는 자신이 쓴 것만 읽는다. 두 파일은 database를 공유하므로 `--test-concurrency=1`로 실행한다. CLI와 command 테스트는 SQLite에만 남는다. orm client 밖의 DDL 없이는 공유 서버에 fsm table이 없는 database를 만들 수 없기 때문이다(S-37-2).
- 로컬 서버(S-37, 이 항목의 실행): PostgreSQL 17.11(`initdb`, `pg_ctl`, 실행마다 data 디렉터리와 socket 디렉터리)과 MySQL 8.4.11(`mysqld --initialize-insecure`, `--daemonize`)을 각각 포트 55432와 33306에 띄웠다. database는 `fsm_test`, 사용자는 `fsm`이다. DSN은 `postgres://fsm@127.0.0.1:55432/fsm_test?sslmode=disable`와 `mysql://fsm:fsm@127.0.0.1:33306/fsm_test`였다. 실행 뒤 서버를 멈추고 data 디렉터리를 지웠다.
- S-21을 위한 CI service(`make install`과 `make check`를 실행하는 job에 복사할 줄; 이미지는 위 버전이다):
```yaml
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: fsm
          POSTGRES_PASSWORD: fsm
          POSTGRES_DB: fsm_test
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U fsm -d fsm_test"
          --health-interval 5s --health-timeout 5s --health-retries 10
      mysql:
        image: mysql:8.4
        env:
          MYSQL_ROOT_PASSWORD: root
          MYSQL_USER: fsm
          MYSQL_PASSWORD: fsm
          MYSQL_DATABASE: fsm_test
        ports: ['3306:3306']
        options: >-
          --health-cmd "mysqladmin ping -h 127.0.0.1 -uroot -proot"
          --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      FSM_TEST_PG_DSN: postgres://fsm:fsm@127.0.0.1:5432/fsm_test?sslmode=disable
      FSM_TEST_MYSQL_DSN: mysql://fsm:fsm@127.0.0.1:3306/fsm_test
```
- npm의 동시성과 persist 테스트(`make npm-persist-test`, `-postgres`, `-mysql`)는 같은 변수를 읽는다. 그 결정은 C-4에 적었다.

### C-7. GUI `packages/fsm-gui` (hyper Node 서버 + crudui + mermaid)
- GUI는 단일 편집자 도구다. save는 전체 교체이고, 마지막 쓰기가 이긴다.
- 빌드: `hyper-build-assets --app . --api /api --output build`(hyper v0.0.11은 `--app`·`--api`·`--output`을 요구한다)가 `templates.index.json`, `manifest.json`, `public/assets` 번들을 만든다(gui-test 전에 실행).
- 실행: `fsm-gui [--project <dir>] [--port <n>]`, `packages/fsm-gui/package.json`의 `bin`. `make gui-build` 뒤 `npm install -g ./packages/fsm-gui`가 이를 PATH에 link한다. `tests/command.test.mjs`가 임시 npm prefix에 offline으로 설치하고 machine 목록을 요청한다(S-18-1).
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
  - `client/main.ts`는 편집 폼을 crudui `connectForm(crudui-form, instance)`에 묶고 instance를 구독한다(S-22-1). instance가 바뀔 때마다 `patchContent(host, renderForm(instance, render))`를 실행한 뒤 `connection.sync()`를 호출한다. form-runtime.md의 계약이다. `host`는 서버 form을 감싸는 `#fsm-form` 요소다. `render`는 페이지의 crudui render 옵션(`editRenderOptions`: action, hidden `_csrf`, 페이지의 오류)이며 페이지 state에 실려 있어서, 다시 렌더링한 마크업이 같은 데이터의 서버 마크업과 같다. S-22-1 이전에는 행의 add·remove 버튼 클릭이 instance만 바꾸고 페이지는 바꾸지 않았다. 아무것도 다시 렌더링하지 않았기 때문이며, 브라우저 테스트가 이를 찾았다.
  - 브라우저에서 추가한 행은 다음 code를 받고(`client/main.ts`가 다시 렌더링할 때마다 code를 DOM에 쓴다), remove는 instance에서 그 행을 뺀다.
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
  - 브라우저 테스트(S-22-1, `make gui-browser-test`): `tests/browser/browser.test.mjs`는 고정된 Playwright 패키지의 headless Chromium으로 편집 폼을 조작한다(`playwright` 1.64.0, `packages/fsm-gui`의 정확한 버전 devDependency. `make gui-browsers`가 브라우저를 내려받으므로 ONLINE이다). 브라우저는 stamp `var/deps/playwright-<version>`이다(`packages/fsm-gui/package-lock.json`의 버전으로 키를 정한다, S-29-1). 처음 실행이 내려받고, stamp가 있는 이후 실행은 아무것도 내려받지 않는다. `gui-browsers`는 명령행용으로 그 stamp의 phony 별칭이며, gui-browser-test가 필요로 하는 것은 file target이다. 이 별칭은 `make gui-browsers`가 계속 동작하도록 택한 것으로, S-29-1 문구에서 벗어난 편차다. 저장소의 `machines/order.fsm.json`과 `fsm.lock.json`, `{"store":"json"}`을 담은 임시 프로젝트에 `node src/main.mjs --project <temp> --port 0`을 실행하고, 순서대로 확인한다. 마지막 상태 행의 add는 제안 code 6인 행을 추가한다. final 상태 `refunded`와 cancel 엣지 shipped→refunded를 저장하면 머신과 lock에 저장되고, show 페이지가 그 상태를 Mermaid svg와 함께 보여 준다. 그 행과 엣지를 remove하고 Save하면 상태가 지워지고 code 6이 예약된다. 다음 추가 행은 7을 제안한다. 수정 전 첫 실행은 첫 단정에서 실패했다(`5 !== 6`: 클릭이 행을 바꾸지 않았다).
  - `gui-test`는 최상위 `tests/*.test.mjs` 파일만 실행한다(`$(wildcard ...)`). `node --test`는 디렉터리를 주면 하위 테스트 파일도 실행하므로, `tests/browser/`의 브라우저 테스트가 `gui-test`에 브라우저를 요구하게 된다.
  - 준비 상태(S-22-3): 브라우저 테스트는 `networkidle`이 아니라 폼 자신의 준비 상태를 기다린다. `client/main.ts`는 `connectForm`과 구독이 자리 잡은 뒤 form host `#fsm-form`에 `data-fsm-connected="true"`를 설정하고, 연결이 끊기면(rebind 전에) 이를 제거한다. 테스트의 `openEdit`과 `connected()`는 `#fsm-form[data-fsm-connected="true"]`를 기다린다. layout의 CSS(`#fsm-form:not([data-fsm-connected]) button[data-crudui-action] { pointer-events: none }`)는 표시가 설정되기 전까지 행 버튼이 클릭을 받지 못하게 한다.
  - 첫 실행 실패(S-22-3), 원인: 묶기 전 클릭이 아니라 새로 받은 Chromium의 첫 탐색이 느린 것이다. 새 다운로드 네 번(`PLAYWRIGHT_BROWSERS_PATH`를 빈 디렉터리로 두고 `playwright install chromium`)에서 첫 케이스는 4.7초, 12.4초(5초 제한에서 실패), 2.7초, 2.5초였고 이후 케이스는 모두 1.3초 이하였다. client가 늦게 묶일 수는 없다: 번들은 head의 `type="module"` script라 `DOMContentLoaded` 전에 실행되고 `load`를 늦추며, `load` 직후 클릭한 차가운 시도 30회(CPU throttle과 지연 포함)가 모두 행을 추가했다. 그래서 브라우저 테스트의 setup이 60초 제한으로 편집 페이지를 한 번 열어 번들 전체를 적재하고, 모든 케이스는 5초 제한을 유지한다. 표식 `data-fsm-connected`는 network idle 대신 케이스가 기다리는 명시적 준비 신호로 남는다.
  - 결정(연결 전 행 버튼): 표시가 설정되기 전까지 행 버튼은 포인터 클릭을 받지 않는다(위 CSS). 느린 네트워크에서는 모듈이 실행되기 전에 폼이 그려지므로 원리상 창이 존재한다. 이 규칙은 연결 전 포커스된 버튼의 키보드 실행을 막지 않는다(알려진 틈이다. 그때 폼은 예전처럼 아무것도 하지 않는다).
  - 결정: 브라우저 테스트는 2026-10-11 의존성 검토가 최신 stable로 적은 Playwright release(1.64.0, `make dependency-review UPDATE=1 RECORD=1`로 기록)를 쓴다.
  - 폼과 아이콘(S-22-2): crudui stylesheet는 번들의 일부다. `make gui-build`가 `@polyspec/crudui-generator-core/styles/crudui.css`를 `public/assets/crudui.css`로 복사하고 `hyper-build-assets --static`에 넘긴다. 이 옵션은 layout이 링크하는 stylesheet를 정적 배포에 넣는다. layout은 `/assets/crudui.css`를 링크한다. `client/main.ts`의 import로 넣을 수는 없었다. esbuild가 두 번째 output을 쓰고, 빌드는 `hyper-chunk-*`가 아닌 output을 거부하기 때문이다(`the client build wrote N entry files`). 아이콘은 `public/favicon.ico`(ICO 파일)다. browser가 `/favicon.ico`를 요청하고, hyper 서버는 `public/`의 파일만 확장자로 서빙하기 때문이다(`.ico`는 `application/octet-stream`). 원시 바이트를 돌려주는 route는 없다. `scripts/make-favicon.mjs`가 이 파일을 쓴다. 행의 저장된 key는 `Key`, 새 상태의 새 key는 `New key`로 label을 붙인다. 이름 바꾸기 폼의 새 key label과 같다. 브라우저 테스트는 `button[data-crudui-action]`마다 crudui 크기(28px), `::before`의 아이콘 mask, 접근 가능한 이름을 확인하고, 행마다 label이 서로 다른지, `/favicon.ico`가 ICO로 응답하는지 확인한다.

### C-8. 문서 사이트 (`docs/.vitepress`, `make docs-build`)
- 빌드: `make docs-build`는 `docs-deps`(`docs/package-lock.json`으로 `npm ci --no-audit --no-fund`)를 실행한 뒤, VitePress로 사이트를 `docs/.vitepress/dist`에 빌드한다. `docs/node_modules`, `docs/.vitepress/dist`, `docs/.vitepress/cache`는 git-ignore한다.
- 설치 script(S-20-2): npm 11이 `docs/package.json`이 결정하지 않은 설치 script 두 개에 `npm warn install-scripts`를 출력했다(`allowScripts` 필드). 그래서 `make docs-deps`마다 경고가 나왔다. 추적 결과: (1) `esbuild@0.25.12`(postinstall `node install.js`)는 명령 shim `bin/esbuild`를 플랫폼 binary로 바꾸고 버전을 확인한다. vite가 쓰는 JS API는 이 교체를 필요로 하지 않는다: esbuild의 `lib/main.js`(`generateBinPath`)가 `@esbuild/<platform>/bin/esbuild`를 직접 찾는다. 이 script는 고정 버전에 허용한다(`"esbuild@0.25.12": true`). 설치 상태는 이전과 같아진다. 설정하지 않은 설치에서도 postinstall은 실행되었으므로(shim이 교체되었다), npm 11.19에서 경고는 건너뛰기를 뜻하지 않았다. 결정은 이에 의존하지 않는다. (2) `fsevents@2.3.3`(macOS 전용, vite의 watcher인 chokidar의 optional 의존성)은 빌드된 `fsevents.node`(163,626 bytes, script를 건너뛰어도 크기가 같다)를 함께 담고, `npm ci --ignore-scripts` 뒤에도 `require('fsevents')`가 적재된다. 사이트는 watcher를 쓰지 않으므로 script를 거부한다(`"fsevents": false`). 테스트 `the docs install prints no npm warning`(tests/docs-build)은 lock으로 새 `npm ci`를 실행하고 경고 줄이 있으면 실패한다. 결정 전에 이 두 줄 때문에 실패했다.
- 버전: `docs/package.json`은 `vitepress` 1.6.4를 정확히 고정한다(template 저장소의 릴리스). 또한 `vite`를 6.4.4로 override한다. vitepress 1.6.4는 `vite ^5.4.14`를 요구하는데, 5.4.x 줄에는 수정 릴리스가 없는 moderate 및 high advisory가 있다(첫 lock의 `npm audit`). 6.4.4에는 advisory가 없고 esbuild 0.25.x를 끌어온다. `make dependency-review RECORD=1`은 advisory가 없는 lock을 기록한다. 사이트는 dev server를 실행하지 않으며, `make docs-build-test`가 이 override로 통과하므로 override를 받아들인다.
- 원본: 문서는 복사나 생성된 Markdown 없이 제자리에서 읽는다. VitePress의 srcDir은 저장소 루트다. 포함 목록은 다음과 같다: `README.md`와 `README.ko.md`; `packages/*/README.md`와 `packages/*/README.ko.md`; `docs/spec/**`; `docs/plans/fsm-v1.md`와 `docs/plans/fsm-v1.ko.md`; `docs/verification/**`; `CHANGELOG.md`와 `CHANGELOG.ko.md`. 그 밖의 모든 Markdown 파일은 빌드 시점에 저장소를 훑어 계산한 srcExclude에 들어가며, `node_modules`, `.git`, `var`, `vendor`, `target`, `tests/kit`, `docs/.vitepress`도 제외한다. 포함 목록 밖의 페이지는 빌드되지 않는다.
- 언어: VitePress locale은 쓰지 않는다. locale에는 디렉터리 접두사가 필요하기 때문이다. 한국어 문서는 각자 하나의 페이지이며, 각 페이지는 자기 쌍을 링크한다.
- 재작성: `README.md`는 같은 디렉터리의 `index.md`로 렌더링된다. 따라서 루트는 `/`, 패키지는 `/packages/<name>/`이다. `README.ko.md`는 자기 경로 `/README.ko`를 유지한다. 쌍은 같은 디렉터리를 쓰므로 상대 링크는 둘 다에서 동작한다.
- 저장소 링크: 사이트 페이지에서 사이트 페이지가 아닌 저장소 파일이나 디렉터리(예: `AGENTS.md`, `schema/fsm.dbs`, `Makefile`)로 가는 링크는 `docs/.vitepress/config.mts`의 markdown-it 규칙 `repositoryLinks`가 `https://github.com/polyspec/fsm/blob/main/<path>`로 재작성한다(디렉터리는 `tree`). 존재하지 않는 파일로 가는 링크는 그대로 두며 빌드가 실패한다. `ignoreDeadLinks`는 설정하지 않는다.
- 탐색: nav와 sidebar에는 각각 English 그룹과 한국어 그룹이 있다(locale 전환 없음). 그룹은 Overview, Specification, Plan, Packages, Verification, Changelog를 담는다. Packages에는 README 쌍이 있는 패키지마다 항목이 하나 있으며, `fsm-compiler`와 `fsm-db`는 README가 쓰이면(S-19) 추가된다. Verification은 그 페이지가 있을 때 나타난다.
- Base: `VITEPRESS_BASE`(기본값 `/`). polyspec/fsm의 GitHub Pages 사이트는 `/fsm/` 아래에서 제공되므로, S-21의 Pages workflow가 `VITEPRESS_BASE=/fsm/`을 설정한다. 사이트 경로에는 base가 붙고, GitHub 링크는 절대 경로다.
- 본문의 마크업: VitePress는 Markdown을 Vue 템플릿으로 컴파일하므로, 본문의 꺾쇠 괄호 자리표시자(예: `<major>`)는 빌드를 실패시킨다. 그런 자리표시자는 코드 스팬에 쓴다. changelog의 `<a id="...">` 앵커는 HTML이며 그대로 렌더링된다.
- 루트 페이지의 Vue: 페이지가 저장소 루트에 있으며, 그곳에는 `vue`를 담은 `node_modules`가 없다. `docs/.vitepress/config.mts`는 `vue`를 exports의 `import` 조건이 가리키는 런타임 진입점 `dist/vue.runtime.esm-bundler.js`로, `vue/server-renderer`를 `docs/node_modules`의 ESM 진입점으로 alias하므로, 번들에는 vue가 한 벌만 들어간다.
- Circular chunk(S-20-1): 빌드는 `Circular chunk: framework -> theme -> framework`를 출력했다. 이를 제거했고 원인과 근거를 여기 기록한다. 재현: `make docs-build`가 그 줄을 출력했다. 원인이 아닌 것: vite 6.4.4 override(같은 vitepress와 설정으로 vite 5.4.21을 쓰면 같은 줄이 나왔다)와 vitepress 자체(기본 설정의 최소 vitepress 1.6.4 프로젝트는 아무것도 출력하지 않았다). 원인: `vue`의 alias 대상 `vue/index.mjs`는 `export * from './index.js'`, 즉 `dist/vue.cjs.js`를 감싸는 CommonJS다. vitepress의 manual chunk가 ESM `@vue/*` 모듈은 `framework`에, 감싸는 모듈은 `theme`에 넣어 순환을 만들었고, 그 alias를 둔 최소 프로젝트가 같은 줄을 출력했다. 수정은 alias를 `dist/vue.runtime.esm-bundler.js`로 향하게 하는 것이며, 이후 `make docs-build`는 경고를 출력하지 않는다. `docs-build-test`는 빌드 출력에 경고 줄, 즉 `(!)`, `warn`, `warning`으로 시작하거나 circular chunk 또는 dependency를 가리키는 줄이 있으면 실패한다(`tests/docs-build`).
- 테스트: `tests/docs-build`(`make docs-build-test`, 기록 `.results/docs-build-test.json`을 남기는 루트 도구 테스트)는 저장소 문서의 임시 복사본에 존재하지 않는 파일로 가는 링크를 가진 문서를 넣고, 빌드가 dead link로 실패해야 한다고 요구한다. 그다음 저장소 자체를 빌드하여 `index.html`, `README.ko.html`, `packages/fsm-go/index.html`, `docs/spec/fsm.html`, `docs/plans/fsm-v1.html` 페이지, `AGENTS.md`의 GitHub 재작성, 그리고 `AGENTS.md` 페이지가 없고, 출력에 경고 줄이 없음(S-20-1)을 요구한다. `docs-build`와 `docs-build-test`는 `CHECK_TARGETS`에 있으며, 소유 규칙은 `config/owner-checks.json`에 있다. `config/documents.json`은 `siteLinks`를 설정하므로 `documents-check`가 사이트의 링크 형식을 받아들인다: `/`로 시작하는 링크, 그리고 확장자 없이 `.md`, `.ko.md` 또는 `index.md` 파일을 가리키는 링크.

---

### C-9. 사용자 문서(R11)
- README 쌍은 `scripts/check-readmes.mjs`의 `README_PAIRS`가 선언한 것이다: root, `fsm-compiler`, `fsm-db`, `fsm-gui`와 여섯 언어 패키지.
- 각 쌍은 영어 파일과 한국어 짝을 가진다. 검사는 종류별 영어 `##` 제목(목록은 스크립트에 고정)과, 단계별 제목 수가 같은 한국어 짝을 요구한다. 펜스 코드 블록 안의 제목은 절이 아니다.
- 절의 종류: root(fsm의 정의와 비정의, 모델, code와 lock, 전이, 검증 오류, 프로젝트 파일, 요구사항과 설정, fsm-gen CLI, 도구, 생성 이름, 검사); compiler(구조, store 계약, 명령, backend 옵션, vectors); db(정의, 설정, 여섯 테이블, DSN, 명령, json·mermaid 프로젝트 이전, 검사); gui(기능, 설정, 실행, 화면, 규칙; 테스트 절은 S-22-2가 쓴다); 언어 패키지(프로젝트에 생성, 생성 파일, API, 오류, 영속화, 테스트).
- 문서의 명령 이름은 `fsm-gen`, `fsm-db`, `fsm-gui`다. S-18-1이 설치하는 명령의 짧은 이름이며, 설치와 호출은 root README에 있고, 어떤 문서도 `node packages/...`를 실행하지 않는다.
- 문서의 모든 명령은 설치된 명령으로 임시 프로젝트 복사본에서 실제로 실행하고, 그 출력을 붙인다. 코드 발췌는 저장소 파일에서 경로와 함께 옮긴다. 저장소 파일이 아닌 snippet은 쓰기 전에 임시 소비자 프로젝트에서 실행하고, 출력을 함께 인용한다(go, npm, php, python, rust의 API).
- 한국어 펜스 코드 블록은 영어 블록과 같다(`documents-check`가 요구한다). 따라서 코드와 명령 출력은 번역하지 않고, 그 둘을 둘러싼 산문만 번역한다.
- 테스트는 `tests/check-readmes/`(`make readme-test`)이고, `make readme-check`는 저장소에 검사를 실행한다.

## D. 체크리스트와 owner 검사

항목의 상태는 [docs/plans/execution-checklist.ko.md](execution-checklist.ko.md)에 있다. 이 계획의 유일한 체크리스트이며(AGENTS.ko.md, 체크리스트), 이 절은 상태를 담지 않는다. kit 항목 K17~K19는 kit 저장소의 항목이라 이 체크리스트에 없으며, E절이 이름을 든다.

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
| `tests/install-python/**` | `install-python-test` |
| `scripts/check-python-lock.mjs`, `tests/check-python-lock/**`, `packages/fsm-python/pyproject.toml`, `packages/fsm-python/uv.lock` | `python-lock-test python-lock-check` |
| `packages/fsm-compiler/**`, `schema/fsm.schema.json`, `machines/**`, `fsm.lock.json`, `conformance/**`, `contracts/features.json`, `fsm.config.json` | `compiler-test gen-check` |
| `schema/persist.dbs` | `gen-check packages-test` |
| `schema/fsm.dbs`, `packages/fsm-db/**` | `db-test` |
| `packages/fsm-gui/**` | `gui-test` |
| `packages/fsm-<kind>/**` | `layout-check gen-check parity-<kind> dependency-policy-check` |

- kind의 소유 검사는 `parity-<kind>`(kind마다 쓰는 리터럴 타깃, 선행 타깃 `test-<kind>`, recipe `node scripts/check-parity.mjs --kind <kind>`)다. `--kind`이면 check-parity는 그 kind의 결과만 읽고 C-4 조건을 그 결과에만 적용한다(모든 벡터 케이스가 1번 실행되어 통과, 미등록 케이스 없음, `inputs` 최신, `elapsedMs`). 다른 kind의 결과와 도구 결과는 읽지 않는다. 선행 타깃과 `--kind`가 없는 `parity-check`는 모든 kind와 도구 결과를 읽고 `check`에서 `packages-test` 뒤에 돈다.
- 독립 항목은 체크리스트가 허용할 때 병렬로 진행할 수 있다(AGENTS.ko.md, 체크리스트).
- 전체 스위트는 체크리스트의 마지막 항목 커밋 후 `make check`로 1회 돌린다.

## E. 진행 순서
1. kit K17~K19 → kit 릴리스 → fsm S-01부터 진행한다.
2. 구현 중 감사 루프는 0절 감사 규칙을 따른다. 감사자는 정확한 수정 위치와 대체 문장을 내고, 근거를 확인해 판정하며, 핵심 이견이 0이 될 때까지 반복한다.

## Verification
- 루트 Makefile이 `include scripts/kit/kit.mk` 뒤에 다음 타깃을 정의한다.
  - `CHECK_TARGETS`, `check`
  - `layout-test`, `layout-check`, `parity-test`, `parity-check`
  - `compiler-test`, `db-test`, `gui-test`, `gen-check-test`, `gen-check`
  - `install-python-test` (`tests/install-python`: the install-python recipe in a temporary checkout with a stub uv, S-11-3)
  - `python-lock-test` (`tests/check-python-lock`: the lock rules on fixtures and on the committed uv.lock, S-34) and `python-lock-check` (the same rules on `packages/fsm-python`)
  - `kit-test` (the vendored tests of `tests/kit`, run by kit.mk with `node --test`)
  - `test-<kind>`, `parity-<kind>`(`parity-<kind>: test-<kind>`), `packages-test`(`kinds`의 `test-<kind>`를 `make -j6`으로)
- `check` = `node scripts/kit/full-run.mjs run $(CHECK_TARGETS)`
  - `CHECK_TARGETS` = `kit-check owner-validate documents-check commits-check hooks-check toolchain-check dependency-policy-check layout-test layout-check parity-test compiler-test gen-check-test gen-check db-test db-test-postgres db-test-mysql npm-persist-test npm-persist-test-postgres npm-persist-test-mysql gui-test npm-types name-test name-check docs-build docs-build-test packages-test gui-browser-test readme-test readme-check kit-test install-python-test make-install-test rust-persist-test python-lock-test python-lock-check parity-check`
- 패키지 의존성(S-29): `make install`(ONLINE, clone마다 한 번)은 `install-tools`의 toolchain을 `var/tools`에 설치하고 모든 패키지 의존성을 설치한다: `packages/fsm-npm`, `packages/fsm-db`, `packages/fsm-gui`, `docs`의 lock으로 `npm ci`; `packages/fsm-php`와 `packages/fsm-php-ext`의 `composer install`(`composer.lock`); `make install-python`의 Python 3.14 link와 `packages/fsm-python`의 venv(`uv sync --locked`, `uv.lock` 기준; python stamp는 `uv.lock`으로 키를 정한다); go module과 cargo crate(`var/deps/go`, `var/deps/rust`). 각각은 자기 lock을 키로 하는 file target이므로, 나중의 실행은 최신 상태를 확인하고 네트워크가 필요 없다. package를 쓰는 타깃은 그 file을 선행 조건으로 둔다: `npm-types`, `gen-check`, `test-<kind>`(따라서 `parity-<kind>`와 `packages-test`), `db-test`, `gui-test`, `gui-browser-test`(browser stamp를 통해), `docs-build`, `docs-build-test`. 새 clone은 `make install`을 한 번 실행한 뒤 `make check`를 실행한다: toolchain은 `make install`에서만 온다. `make make-install-test`(`tests/make-install/`)는 Makefile 사본에서, 의존성이 하나도 없는 경우와 모두 있는 경우에 선행 조건을 검사한다.
- 항목 개발 중에는 owner-checks 매핑만 실행한다.
- GUI 수동 확인: json·mermaid·db store 각각으로 다음을 확인한다.
  1. 상태를 추가·삭제·rename한 뒤 저장한다(lock은 save가 함께 갱신).
  2. `check`가 통과한다(json·mermaid는 `fsm-gen check`, db는 `fsm-db check`).
  3. 브라우저에서 Mermaid가 표시된다.
