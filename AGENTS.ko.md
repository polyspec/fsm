<!-- doc-id: agents -->
<!-- source-sha256: 5e088ab8245cc8df97b73b829869888f833b62e3b183de2f10e6f2a015488bc3 -->
# 개발

[English](AGENTS.md)

모든 polyspec 저장소의 작업 원칙은 fsm이 kit에서 가져온 [PRINCIPLES.ko.md](PRINCIPLES.ko.md)다. 이 파일은 fsm의 규칙만 적는다.

## 목적

fsm는 state machine을 한 번 정의하고 go, npm(js + d.ts), php, php-ext, python, rust용 코드를 생성한다. 계획, 범위(R1–R12),
설계는 `docs/plans/fsm-v1/plan.md`에 있고, 정의는 `docs/spec/fsm.md`에 고정한다.

## 규칙

- Own: 공용 도구는 package `@polyspec/kit`이다. 루트 `package.json`의 devDependency이며 release asset URL과 integrity로 고정한다.
  kit은 utility와 예시를 제공하고 fsm에 아무것도 include하지 않는다(kit `docs/spec/utilities-and-recipes.md`). fsm이 실행하는 모든
  타깃은 fsm 자신의 `Makefile` recipe이며, recipe는 kit utility를 `$(KIT)/<utility>.$(KIT_EXT)`로 명시적인 인자와 함께 실행한다.
  fsm이 kit에서 가져온 파일(`PRINCIPLES.md`, CI pipeline, release 워크플로, bootstrap action, schema와 함께인
  `config/layout.kit.yml`, lint 설정)은 fsm의 파일이다. 도구의 설정은 그 도구의 native 파일에 둔다: `.npmrc`, `mise.toml`의
  `[settings]`와 `[env]`, 각 lint 도구의 설정 파일. fsm은 kit의 파일을 import하지 않는다. package가 export하는 것
  (`@polyspec/kit/tracked-files`)만 import하며, 일반적인 필요는 자기 `package.json`에 선언한 생태계 라이브러리(ajv, picomatch,
  `node:`)로 채운다. kit의 동작은 kit에서 테스트한다.
  Enforced by: none, 리뷰에서 판단한다.
- Refines S7: 기능의 기본 테스트는 그 기능을 소유한 패키지(compiler, DB store, GUI)에 둔다. 언어 패키지에는 소비자 입장 테스트만 둔다.
  루트에는 루트 도구의 테스트와 그 공용 helper `tests/support/`만 둔다. 루트 도구 테스트의 fixture는 임시 디렉터리에 만들고 커밋하지 않는다.
  Enforced by: `make layout-check`
- Refines S3: `Makefile`의 모든 테스트는 kit의 test runner인 `$(RUN_TESTS)`로 실행한다. 이 runner는 케이스마다 시작, 진행, 결과, 경과 시간을 출력하고
  케이스별 timeout을 준다. 전체 timeout은 없으며, 테스트 프로세스는 10분을 넘지 않는다. 넘으면 이유와 함께 보고한다.
  Enforced by: none, runner의 사용은 테스트 스크립트에 대한 판단이다.
- Refines P20: 항목 진행 중에는 바뀐 경로의 소유 검사(`config/owner-checks.json`)만 돌린다. 전체 스위트는 마지막 항목을 커밋한 뒤 `make check`로
  트리당 한 번 돌린다.
  Enforced by: `make owner-validate`
- Own: 공개 API나 라이브러리 사용법을 바꾸면 같은 항목 안에서 루트와 관련된 모든 패키지의 README(영문·한글)와 문서 사이트를 함께 갱신한다.
  Enforced by: none, 리뷰에서 판단한다. `make readme-check`는 README 쌍의 절만 검사한다.
- Own: git 파일에 외부 출처를 쓰지 않는다. 일반 구문의 채택/비채택 판정만 쓴다. polyspec 저장소(kit, orm, hyper, crudui, template 등)는
  내부 라이브러리이므로 인용할 수 있다.
  Enforced by: none, 리뷰에서 판단한다.
- Own: 이 저장소가 만드는 것(추적 파일, 설정, 스크립트, 생성 출력)에는 symbolic link와 상대 경로를 두지 않는다. 경로는 선언적으로(추적
  파일에 이름을 적어) 또는 탐색으로(명시된 탐색 규칙에 따라) 정한다.
  Enforced by: none, 리뷰에서 판단한다.
- Own: 추적 파일은 라이브러리를 옛 이름 `status`로 부르지 않는다. 단 `scripts/check-name.mts`의 이유 붙은 항목은 예외다.
  Enforced by: `make name-check`
- Own: 모든 README 쌍(root, compiler, db, GUI, 언어 패키지)에는 필수 절과 같은 제목을 가진 한국어 짝이 있다(`scripts/check-readmes.mts`).
  Enforced by: `make readme-check`
- Own: 손으로 쓴 package와 fsm-gen 출력(`compiler`, `db`, `go`, `js`, `php`, `php-ext`, `python`, `rust`)은 계획 V-6 (5)가
  지울 때까지 `legacy/packages/` 아래에 있다. 생성 바인딩이 `packages/`를 차지하기 때문이다(계획 f6, FP-6, 단계 3-2). 그
  대상은 `legacy-<task>-<runtime>`이고 `legacy-<task>`로 묶으며, `build`와 `test`는 `legacy-build`와 `legacy-test`를 선행 조건으로
  갖는다(구조 ST-38). 이 package들은 릴리스에서 빠진다(`config/release.json`, `notReleased`). GUI는 계획 단계 9a가 그 import를
  node 바인딩으로 바꿀 때까지 `legacy/packages/compiler`와 `legacy/packages/db`를 import하는 살아 있는 코드다. 그 import의 목록은
  checklist의 S-456 행이다. 구조 계획이 요구하는 커밋된 검사(F5S-4)가 아직 없기 때문이다.
  Enforced by: none, F5S-4의 검사가 생길 때까지 GUI의 legacy import 목록은 리뷰가 지킨다.
- Own: 바인딩의 인터페이스 계약은 `packages/rust/interface.json`이다. 계약은 처음부터 다섯 target php, python, node, go, wasm을
  적고, 그 case는 `contracts/cases.json`이며 `contracts/conformance/vectors.json`의 입력과 기대값에서 옮긴다. 계약이 지어낸 case는
  fsm에 있는 동작을 시험하지 않기 때문이다. 바인딩 package와 그것을 담는 루트 Cargo workspace는
  계획 f6 단계 3a부터 추적한다. 단계 3a는 단계 3-2가 손으로 쓴 언어 package를 `legacy/`로 옮긴 다음 단계다. 그때까지
  `make bindings-check`가 없거나 다른 바인딩 파일을 하나씩 이름한다.
  Enforced by: none, binding은 아직 lock이 고정하는 package가 아니므로 어떤 CI job도 `make bindings-check`를 돌릴 수 없다. 이
  대상은 BINDING에 binding checkout의 cli를 받아야 한다.

## 생성 파일

- Own: 생성 파일은 Git에 추적하지 않는다. 여기에는 의존성 설치(`node_modules/`, `vendor/`, 가상 환경), 빌드 산출물(`dist/`, `target/`, `*.tsbuildinfo`), 캐시(`.cache/`, `__pycache__/`, `.pytest_cache/`), 테스트 실행 산출물(`test-results/`, `playwright-report/`, PHPUnit 캐시), 도구 다운로드(`var/`)가 포함된다. 예외는 저장소가 의도적으로 필요로 하는 파일뿐이며 이것만 추적한다: lock 파일(`package-lock.json`, `composer.lock`, `Cargo.lock`, uv lock, `mise.lock`), 이 문서가 밝히는 커밋된 생성 문서, 테스트 fixture, 그리고 Go module과 Rust crate가 `legacy/`로 옮기기 전에 tag된 tree로 릴리스한 생성 소스 `legacy/packages/go/src`와 `legacy/packages/rust/src`(P34)다. `config/generated.json`이 이유와 함께 이들을 추적하고, `make fsm-gen`이 쓰는 것과 다르면 `make layout-check`가 실패한다(S-371). 각 `.gitignore`가 나머지 경로를 덮으며, 새 생성기는 같은 commit에서 ignore 항목을 추가한다.
  Enforced by: none, 리뷰에서 판단한다. `make layout-check`는 Git이 각 install 폴더를 무시하고 생성 파일을 추적하지 않는지 검사한다.

## 체크리스트

- Refines P24: `docs/plans/fsm-v1/checklist.md`가 이 계획의 유일한 체크리스트다. `[o]` 작업은 다시 열지 않고, 새 문제는 `S-07-1` 같은 하위 id를 받는다.
  Enforced by: `make docs-check`

## 병합 기록

- Own: 병렬 브랜치는 공유 기록에서 만난다. 병합은 양쪽을 모두 유지한다: CHANGELOG bullet은 모두 항목 순서대로, 체크리스트 행은 더 나아간 상태로. 그 뒤 `make documents-stamp`로 한국어 문서를 다시 stamp한다.
  Enforced by: `make docs-check`
