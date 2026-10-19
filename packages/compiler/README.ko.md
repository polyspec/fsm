<!-- doc-id: readme-compiler -->
<!-- source-sha256: 67abd61a57c7404d264d17ed21fa7078476d3f590cf69bea7a7d0a219dd16d3b -->
# @polyspec/fsm-compiler

[English](README.md)

fsm의 컴파일러와 명령 줄 `fsm-gen`이다(`docs/spec/fsm.md`, B-2; `docs/plans/fsm-v1/plan.md`, C-5). 정의를 읽고, 검사하고, lock을 유도하고,
conformance vector를 쓰고, 여섯 언어의 소스를 생성한다. 의존성이 없으며, 프로젝트에서 쓰는 방법은 루트 README가 설명한다. 이 README는
컴파일러를 고치거나 읽는 사람을 위한 것이다.

## 구조

패키지는 다섯 부분으로 이루어진다. 규칙을 가진 곳은 core뿐이며, 나머지 네 부분은 변환하거나 쓴다.

| 부분 | 파일 | 역할 |
|---|---|---|
| core | `src/core/validate.mjs`, `normalize.mjs`, `lock.mjs`, `reserved.mjs`, `vectors.mjs`, `run.mjs` | `docs/spec/fsm.md`의 B-5, B-3, B-4 규칙. `validate`는 검사 결과를, `normalize`는 정의를 중간 형식으로, `lock`은 lock과 `nextCode`를, `vectors`는 conformance case의 oracle을, `run`과 `copy`는 명령을 만든다 |
| backends | `src/backends/index.mjs`(종류), `go.mjs`, `npm.mjs`, `php.mjs`, `php-ext.mjs`, `python.mjs`, `rust.mjs` | 언어마다 한 파일: `files(irs, lock, options)`는 생성 파일을, `vectorsFile(...)`은 native vector module을 돌려준다 |
| stores | `src/store-json/store.mjs`, `src/store-mermaid/store.mjs`와 `parse.mjs`, `write.mjs`, `src/store-lock/lock-file.mjs` | 파일 store: 파일과 core의 객체를 서로 바꾸고, 파일마다 원자적으로 쓴다 |
| io | `src/io/files.mjs`, `src/io/git.mjs` | store와 cli가 쓰는 파일의 원자적 쓰기와 git 명령. `node:fs`와 `node:child_process` 위에 있다 |
| cli | `src/cli/fsm-gen.mjs`, `src/cli/write-generated.mjs` | 명령 줄. `fsm.config.json`으로 store를 고르고, 검사 결과를 출력하고, 종료 코드를 정한다. `write-generated.mjs`는 생성 파일을 쓰고 header가 없는 파일을 거부한다 |

core는 `node:`를 import하지 않으므로 GUI(`packages/gui`)가 그대로 import한다. 컴파일러의 테스트는 `packages/compiler/tests/`에
있다(`make compiler-test`): 규칙, store, `tests/golden/`의 golden 파일과 맞춘 backend, 프로세스로 실행한 명령 줄.

명령은 한 경로를 따른다: store가 정의와 lock을 읽고, core가 검사하고 lock을 대조하며, 그 뒤에야 backend나 store가 쓴다. 검사 결과가
있으면 아무것도 쓰기 전에 멈춘다.

## store 계약

store는 두 개의 async 메서드를 가진 객체다:

```text
load()            → Promise<{ definitions, lock, findings }>
save({ definitions, lock }) → Promise<void>
```

- `load`는 정의를 store의 순서로 객체로, lock을 기계별 객체로 돌려준다. 읽을 수 없는 파일은 검사 결과가 되며, 나머지 파일은 계속 읽는다.
- `save`는 정의와 lock을 쓴다. 파일마다 원자적으로 쓴다(임시 파일과 rename). 그래서 파일 하나는 옛것이거나 새것이다. 파일들 사이는
  원자적이지 않아서, 중간에 멈추면 다음 명령이 `E_LOCK_MISMATCH`로 보고한다.
- store는 검사하지 않는다. 검사는 `run`과 `copy`의 core가 하며, store에 쓰기를 요청하기 전에 끝난다.
- database store(`packages/db/src/db-store.mjs`의 `DbStore`)는 같은 계약을 구현하며, 모든 것을 한 transaction에 쓴다. load는 같은
  객체를 돌려주므로, 모든 명령이 json, mermaid, db store에서 같은 결과를 준다.

`run(command, store, options)`는 `check`, `lock`, `save`, `vectors`, `gen`을 실행한다. `copy(from, to)`는 `from`을 읽고, `to`가 비었는지
확인하고(`E_STORE_NOT_EMPTY`), `from`의 정의와 lock을 검사한 뒤, `from`의 정의와 lock을 그대로 담아 `to.save`를 한 번 호출한다. 두 함수
모두 `{ findings }`를 돌려주며, `vectors`와 `gen`은 결과도 돌려준다.

## 명령

| 명령 | 읽는 것 | 쓰는 것 | 참고 |
|---|---|---|---|
| `check` | store | 없음 | 모든 정의를 검사한 뒤 lock을 정의와 대조한다 |
| `lock [--rename machine.old=new]...` | store | 정의와 lock | lock 규칙(`E_CODE_REUSED`, `E_CODE_KEY_CHANGED`, `E_CODE_CHANGED`)으로 lock을 유도한다. 사라진 code는 `reserved`로 간다. `--rename`은 이름이 바뀐 상태의 code를 유지한다 |
| `save` | `options.definitions` | 정의와 lock | GUI의 core 명령: `lock`과 같은 규칙, 저장마다 기계 하나. 명령 줄 형식은 없다 |
| `copy --to json\|mermaid --root <dir>` | 프로젝트 store | `<dir>`의 대상 store | 대상은 비어 있어야 한다. lock은 그대로 복사한다 |
| `vectors [--kind <kind>] --out <file>` | store | `{ machines: [{ machine, cases }] }`, 또는 한 종류의 native module | `check`의 검사 결과가 있으면 멈춘다 |
| `gen --kind <kind> --out <dir>` | store | 한 종류의 생성 파일 | `check`의 검사 결과가 있으면 멈춘다. 출력 디렉터리는 루트 README의 설명대로 쓴다 |

명령 줄은 `packages/compiler/src/cli/fsm-gen.mjs`다. `--project <dir>`의 기본값은 현재 디렉터리이며, store는
`<project>/fsm.config.json`이 고른다: `json` 또는 `mermaid`. 다른 store는 `E_STORE_NOT_CONFIGURED`다.

`order` 예제에서 각 명령을 실제로 실행한 결과다(표준 출력의 `[fsm-gen] <command>: ok`, 종료 코드 0):

```sh
$ fsm-gen check --project ./order-machines
[fsm-gen] check: ok
$ fsm-gen lock --project ./order-machines --rename order.draft=created
[fsm-gen] lock: ok
$ fsm-gen copy --to mermaid --root ./order-mermaid --project ./order-machines
[fsm-gen] copy: ok
$ fsm-gen vectors --project ./order-machines --out ./vectors
[fsm-gen] vectors: ok
$ fsm-gen gen --project ./order-machines --kind rust --out ./app/src
[fsm-gen] gen: ok
```

종료 코드: 성공은 0, 검사 결과(표준 오류에 한 줄씩 `[fsm-gen] <code> <machine> <path>: <message>`)나 예상하지 못한 거부(stack과 함께
출력)는 1, 사용 오류는 2다. 알 수 없는 명령, 그 명령이 받지 않는 옵션, `--root`, `--to`, `--out`이 빠진 경우, 형식이 맞지 않는 값은 모두
사용 오류다.

## backend 옵션

옵션은 `gen`과 `vectors`의 것이다(명령 줄은 그 종류가 받지 않는 옵션을 거부한다).

| 옵션 | 종류 | 규칙 | 이유 |
|---|---|---|---|
| `--kind <kind>` | `gen`, `vectors` | `go`, `npm`, `php`, `php-ext`, `python`, `rust` 중 하나(`backends/index.mjs`) | backend를 고른다 |
| `--go-module <module path>` | `gen --kind go`, `vectors --kind go`(필수) | package의 module 경로 | 생성된 기계는 공유 `Error`와 code를 위해 `<module>/src/fsm`을 import한다. backend는 `go.mod`를 읽을 수 없으므로 module을 준다 |
| `--php-namespace <ns>` | `php`, `php-ext`의 `gen`과 `vectors`(필수) | `Acme\Fsm`처럼 글자와 숫자를 한 개의 역슬래시로 나눈 것 | 기계 module의 namespace는 `<ns>\<Pascal machine key>`이고, 공유 `<ns>\Fsm`이 `Error`와 `Code`를 가진다 |
| `--php-ext-name <name>` | `gen --kind php-ext`(필수) | 소문자, 숫자, 밑줄이며 글자로 시작한다. 예: `acme_fsm` | extension의 이름이다. `config.m4`, header, arginfo 파일에 쓰인다 |

php-ext backend의 출력은 php backend의 vector와 test가 검증하는 것과 같은 규칙을 따른다. 같은 namespace로 `vectors --kind php-ext`는
`vectors --kind php`와 같은 파일을 쓴다.

## vector

vector는 기계의 모든 연산의 기대 결과다. core가 정의와 lock으로부터 계산한다(`src/core/vectors.mjs`). 어떤 언어도 기대값을 계산하지
않으며, 각 언어는 자신의 결과를 이 case와 비교한다.

- feature는 `contracts/features.json`과 `vectors.mjs`의 `FEATURES`에 고정되어 있다: `initial`, `code`, `key`, `from_code`, `is_final`,
  `events_from`, `target`, `apply`, `persist`.
- case는 다음과 같다: `initial`; 상태마다 `code`, `key`, `from_code`, `is_final`, `events_from`; `from_code`의 오류(0, 알 수 없는 code,
  reserved code마다); 모든 (상태, event)의 `target`; 정의된 (expected, event)마다의 `apply`와 정의되지 않은 것마다의 `apply`; 그리고
  전이가 있는 기계의 영속화 case `first`, `retry`, `conflict`.
- case id는 `<machine>_<suffix>`이며, suffix의 모든 key는 선언 위치로 바뀐다. 상태는 `s<i>`, event는 `e<j>`(둘 다 0부터), reserved code는
  `r<code>`다. 그래서 `order_apply_s0_e0_s0`는 첫 상태(`draft`)에서 첫 event(`next`)를 적용하고 저장된 상태도 첫 상태일 때의 `apply`다.
  이름이 무엇이든 id는 겹치지 않는다.
- case 이름은 case의 `name`인 `<feature>__<id>`다(php는 method `testConformance`의 data set `<feature>__<id>`, python은 method `test_<feature>__<id>`).
- `order` 예제는 89개 case다(`contracts/conformance/vectors.json` 안에 있으며, `fsm-gen vectors --out`이 쓴다). feature별 개수는 `initial` 1, `code` 5,
  `key` 5, `from_code` 7, `is_final` 5, `events_from` 5, `target` 15, `apply` 43, `persist` 3이다.

`fsm-gen vectors --out <file>`은 공통 형식, 모든 기계의 파일 하나를 쓴다(이 저장소에서는 `contracts/conformance/vectors.json`). 각 언어 패키지는
자기 형식으로 읽는다: `vectors_test.go`(go, `fsm-gen vectors --kind go --go-module <module path>`), `vectors.mjs`(npm), `ConformanceTest.php`(php와 php-ext, case마다 method 하나),
`vectors.py`(python), `vectors.rs`(rust). 패키지는 case마다 test 하나를 실행하며, kit의 parity 검사(`make parity-check`)는 case를 허용하는 모든 종류에서
모든 case가 한 번씩 실행되어 통과할 것을 요구한다.

## 검사

`make compiler-test`는 이 패키지의 테스트를 kit의 test runner(`@polyspec/kit`의 `run-tests`)로 실행한다. 테스트는 패키지를 임시 npm prefix에 offline으로
설치하고 그곳의 `fsm-gen` 명령을 실행하므로, 테스트되는 명령은 설치된 명령이다. `src/core`의 규칙을 바꾸면 모든 언어 패키지의 vector case가
함께 검사한다.
