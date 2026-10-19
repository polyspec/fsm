<!-- doc-id: agents -->
<!-- source-sha256: c52fda2d1b6a7c7ff89cdb0d1270bd564c7996e6fd2b6ee5060e62dceab7d37c -->
# 개발

[English](AGENTS.md)

## 목적

fsm는 state machine을 한 번 정의하고 go, npm(js + d.ts), php, php-ext, python, rust용 코드를 생성한다. 계획, 범위(R1–R12),
설계는 `docs/plans/fsm-v1.md`에 있고, 정의는 `docs/spec/fsm.md`에 고정한다.

## 판단

- 모든 결정은 "무엇이 옳은가"로 판단한다. "기존 규칙이 그렇다"는 근거가 아니다.
- 기준은 근거가 있으면 고칠 수 있다. 테스트를 통과하기 어렵다는 이유로 기준을 낮추는 것은 금지한다.
- 판단이 어렵거나 새로운 논리가 생기면 에이전트로 적대 검증한다. 에이전트는 정확한 위치와 대체 문장을 내고, 지적마다 근거를
  확인해 판정하며, 핵심 이견이 남지 않을 때까지 반복한다. 감사는 위반한 요구(R-id)나 찾은 모순을 밝히며, 그 밖의 지적은 minor다.
- 결정은 그 결정이 다루는 문서에 기록한다.

## 규칙

- 영문 문서가 정본이다. 모든 문서는 같은 정보와 `source-sha256` 표시(`make documents-stamp`)를 가진 `.ko.md` 파일을 갖고,
  한글 문서는 기술 용어를 영어로 쓴다.
- 모든 polyspec 저장소의 작업 원칙은 kit의 사본인 [PRINCIPLES.ko.md](PRINCIPLES.ko.md)다. 이 파일은 fsm의 규칙만 적는다.
- 공용 도구는 package `@polyspec/kit`이다. 루트 `package.json`의 devDependency이며 release asset URL과 integrity로 고정한다.
  그 `kit.copies`의 파일(`scripts/kit/kit-bootstrap.mk`, `scripts/kit/bootstrap/`, release 워크플로, `PRINCIPLES.md`,
  `config/layout.kit.yml`, lint 설정)은 `make kit-sync`가 설치된 package에서 쓰고 `make kit-check`가 비교하는 사본이며, kit에서
  바꾸고 여기서 편집하지 않는다. fsm은 kit의 파일을 import하지 않는다. kit 도구는 make 타깃이나 `$(KIT)/<tool>.$(KIT_EXT)`로
  실행하고, package가 export하는 것(`@polyspec/kit/tracked-files`)만 import하며, 일반적인 필요는 자기 `package.json`에 선언한
  생태계 라이브러리(ajv, picomatch, `node:`)로 채운다. kit의 동작은 kit에서 테스트한다.
- polyspec 버전이 0.0.x인 동안 개발 checkout은 kit `docs/plans/local-links.md`가 설명하는 대로 설치된 polyspec package를
  그 source에 link한다. link는 commit하지 않는다.
- 모든 변경은 RED → 구현 → GREEN을 따른다. 체크리스트 항목은 관측 가능한 기준을 적는다.
- 기능의 기본 테스트는 그 기능을 소유한 패키지(compiler, DB store, GUI)에 둔다. 언어 패키지에는 소비자 입장 테스트만 둔다.
  루트에는 루트 도구의 테스트와 그 공용 helper `tests/support/`만 둔다. 루트 도구 테스트의 fixture는 임시 디렉터리에 만들고 커밋하지 않는다.
- 모든 테스트는 kit의 test runner(`$(KIT)/run-tests.$(KIT_EXT)`)로 실행한다. 이 runner는 케이스마다 시작, 진행, 결과, 경과 시간을 출력하고 케이스별
  timeout을 준다. 전체 timeout은 없으며, 테스트 프로세스는 10분을 넘지 않는다. 넘으면 이유와 함께 보고한다.
- 항목 진행 중에는 바뀐 경로의 소유 검사(`config/owner-checks.json`)만 돌린다. 전체 스위트는 마지막 항목을 커밋한 뒤 `make check`로
  트리당 한 번 돌린다.
- 공개 API나 라이브러리 사용법을 바꾸면 같은 항목 안에서 루트와 관련된 모든 패키지의 README(영문·한글)와 문서 사이트를 함께 갱신한다.
- 오류 은폐 금지: fallback, 조용한 변환이나 버림, null 반환, 하위 호환 레이어를 두지 않는다.
- git 파일에 외부 출처를 쓰지 않는다. 일반 구문의 채택/비채택 판정만 쓴다. polyspec 저장소(kit, orm, hyper, crudui, template 등)는
  내부 라이브러리이므로 인용할 수 있다.
- 기존 외부 도구나 라이브러리가 이미 하는 일을 다시 만들지 않는다. 그 생태계의 표준 도구를 있는 그대로 쓰고(예: Python
  interpreter, 환경, lock은 uv, PHP 의존성은 Composer), 그 도구가 만드는 symbolic link 같은 자체 동작을 받아들인다. 우리 규칙은
  우리가 만드는 것을 다스린다.
- 이 저장소가 만드는 것(추적 파일, 설정, 스크립트, 생성 출력)에는 symbolic link와 상대 경로를 두지 않는다. 경로는 선언적으로(추적
  파일에 이름을 적어) 또는 탐색으로(명시된 탐색 규칙에 따라) 정한다.

## 생성 파일

생성 파일은 Git에 추적하지 않습니다. 여기에는 의존성 설치(`node_modules/`, `vendor/`, 가상 환경), 빌드 산출물(`dist/`, `target/`, `*.tsbuildinfo`), 캐시(`.cache/`, `__pycache__/`, `.pytest_cache/`), 테스트 실행 산출물(`test-results/`, `playwright-report/`, PHPUnit 캐시), 도구 다운로드(`var/`)가 포함됩니다. 예외는 저장소가 의도적으로 필요로 하는 파일뿐이며 이것만 추적합니다: lock 파일(`package-lock.json`, `composer.lock`, `Cargo.lock`, uv lock, `mise.lock`), 이 문서가 밝히는 커밋된 생성 문서, 테스트 fixture. 각 `.gitignore`가 이 경로를 덮으며, 새 생성기는 같은 commit에서 ignore 항목을 추가합니다.

## 체크리스트

`docs/plans/execution-checklist.md`가 이 계획의 유일한 체크리스트다. 작업 상태는 `[ ]` 대기, `[~]` 진행 중, `[o]` 완료,
`[!] cause: <cause>; retry: <condition>` 우회, `[-] cause: <cause>` 불가다. `[o]` 작업은 다시 열지 않고, 새 문제는 `S-07-1` 같은
하위 id를 받는다. 독립 작업은 병렬로 진행할 수 있지만 시작보다 완료가 먼저다. `[o]`가 늘지 않는 동안 `[~]`를 늘리지 않는다.

## 커밋

- 커밋 메시지는 영문 `type(scope): Subject (#S-xx)`다. 제목은 50자 이내이며 대문자로 시작하고 마침표가 없고 명령조다. 빈 줄 다음
  본문은 72자에서 줄을 바꾸고 무엇을, 왜 바꿨는지 쓴다. type은 `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`다.
- 커밋하지 않은 범위는 체크리스트 항목 하나까지다. 항목이 `[o]`가 되면 같은 커밋에서 체크리스트와 두 changelog를 갱신한다.
- 기록은 실제 이유를 적는다. 항목과 무관한 변경은 자기 이유와 함께 따로 커밋한다.

도구가 강제하는 것: 메시지 형식(`commits-check`, commit-msg hook), 커밋당 항목 하나와 완료 항목의 changelog(commit-msg hook),
체크리스트 형식(`documents-check`), `[~]` 상태 push 금지(`push-gate`), 경로 소유(`owner-validate`, pre-commit hook), 추적 파일이 라이브러리를
옛 이름 `status`로 부르지 않음(`scripts/check-name.mts`의 이유 붙은 항목 제외, `name-check`), 모든 README 쌍(root, compiler, db, GUI,
언어 패키지)에 필수 절과 같은 제목을 가진 한국어 짝이 있음(`scripts/check-readmes.mts`, `readme-check`). 도구 없는
리뷰 규칙: 명령조와 What/Why, GREEN 전 RED, 테스트 위치, 브랜치 이름과 삭제, 외부 출처 금지, 실험 코드 제거, WIP 통제, 의존 고정,
conformance 검사가 벡터의 기대값을 단언하는지.

## 브랜치와 워크트리

`main`에서 직접 작업해도 된다. 브랜치는 `{type}/{shortname}-{id}`, 워크트리는 `fsm-{shortname}-{id}`이며 둘 다 `main`에 병합한
즉시 삭제한다. 병합된 브랜치나 워크트리는 용량을 차지하고 폴더를 흩뜨리며 병합 여부를 헷갈리게 하기 때문이다. `main`에 들어갈 수
없는 테스트·실험 코드는 테스트가 끝나면 남길 가치가 있을 때 제대로 된 커밋으로 cherry-pick하고, 아니면 폐기하며, 언제나 커밋 전에
제거한다. 바로 제거할 수 없으면 하위 항목에 제거 조건을 적는다. 위임한 agent의 워크트리와 임시 파일도 같다.

항목은 자기 워크트리에서 일하는 agent에게 위임할 수 있다. 위임한 쪽은 병합 전에 결과를 검토한다: RED → GREEN 근거, 그리고 항목이
내린 모든 결정(새 규칙, 도구, 예외, 이름)이 해당 문서에 있는지. 작성자만 아는 지식은 변경을 거부할 사유다.

병렬 브랜치는 공유 기록에서 만난다. 병합은 양쪽을 모두 유지한다: CHANGELOG bullet은 모두 항목 순서대로, 체크리스트 행은 더 나아간
상태로. 그 뒤 `make documents-stamp`로 한국어 문서를 다시 stamp한다.
