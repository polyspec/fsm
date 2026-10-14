<!-- doc-id: readme -->
<!-- source-sha256: b699dc9ddf66a59f012c863afea28f499ac6bca3a1ebc6c2d3f6f2d34a961f6b -->
# polyspec/fsm

[English](README.md)

fsm은 state machine을 한 번 정의하고 go, npm(js + d.ts), php, php-ext, python, rust용 코드를 생성한다. 생성된 코드는 런타임 의존성이
없고 실행 중에 파싱하지 않는다. 상태는 정수 code이고, event는 edge를 따라 기계를 옮기며, 전이는 멱등이다. 재시도가 기계를 두 번
전진시키지 않는다. 정의는 세 store(JSON, Mermaid `stateDiagram-v2`, orm을 통한 database) 중 하나에 두며, 셋 모두 하나의 규칙을 따른다.

- 계획과 범위: [docs/plans/fsm-v1.md](docs/plans/fsm-v1.ko.md)
- 정의: [docs/spec/fsm.ko.md](docs/spec/fsm.ko.md)
- 체크리스트: [docs/plans/execution-checklist.ko.md](docs/plans/execution-checklist.ko.md)
- 개발 규칙: [AGENTS.ko.md](AGENTS.ko.md)
- 문서 사이트: 이 문서들로 `make docs-build`가 만드는 사이트(VitePress, `docs/.vitepress`, 계획 C-8). S-21이 배포하면 https://polyspec.github.io/fsm/ 에서 제공된다

## fsm이 무엇이고 무엇이 아닌가

fsm은 생성기다. 기계를 JSON, Mermaid 또는 database table로 한 번 기술하면, fsm이 그 기술을 검사하고 여러분의 언어용 소스 파일을
쓴다. 여러분의 프로그램은 생성된 함수를 호출하며, 실행 중에 fsm이 프로세스에 들어 있지 않다.

fsm은 다음과 같다:

- 각 상태가 명시적인 정수 code를 가진 평평한 enum(code가 정체성이고, key가 이름이다);
- event의 집합이며, event는 이름 붙은 edge `{from, to}`의 목록이다;
- 부분 전이 함수: (상태, event) 쌍에 edge가 없으면 조용히 무시되는 것이 아니라 오류다;
- 결정적이다: 생성 전에 모든 검증 규칙이 성립한다;
- 런타임 의존성이 없는 순수 함수이며, 언어마다 `switch`/`match` 코드로 생성된다;
- 세 정의 store(JSON 파일, Mermaid 파일, orm database table)에 하나의 규칙 집합을 적용한다.

fsm은 다음이 아니다(`docs/spec/fsm.ko.md`, B-0의 판정):

- guard, 조건, entry와 exit 동작, callback, 전이 안의 부수 효과;
- 계층 또는 병렬 상태, history, 시간 또는 자동 event, event queue, extended state;
- wildcard `from`, self transition, typestate;
- 정의의 런타임 로더: 정의는 컴파일러가 읽으며, 여러분의 프로그램은 읽지 않는다;
- database에 문자열로 저장하는 이름, label이나 번역;
- sequence 문법: next와 previous는 보통의 event다;
- 저장 폭 설정: code는 항상 32비트 범위다.

이 저장소의 언어 패키지(`packages/go` 등)는 test bed다. 생성 코드를 담고 conformance vector로 검사한다. 공개된 라이브러리가 아니다.
여러분은 각 언어 README가 설명하듯 생성 코드를 자신의 프로젝트에 생성해서 fsm을 쓴다.

## 모델

정의는 세 부분으로 이루어진다: 기계 이름, 상태, event.

- **상태**는 key(예: `draft` 같은 이름), code(1부터 2147483647까지의 정수이며 기계 안에서 유일함), 선택 사항인 `initial` 표시(기계마다
  정확히 하나의 상태), 선택 사항인 `final` 표시를 가진다.
- **event**는 key와 edge의 목록을 가진다. edge `{from, to}`는 event가 기계를 한 상태에서 다른 상태로 옮긴다는 뜻이다. 여러 edge를
  가진 event도 여전히 event 하나다. 아래의 `next`가 그렇다.
- 선언 순서가 의미를 가진다: 생성된 코드의 순서이며 함수가 돌려주는 목록의 순서다.

아래 예제 `order`는 주문의 수명 주기다. `order`는 이 예제 기계의 key일 뿐이다. key 형식(소문자, 숫자, 한 개씩 나뉜 밑줄, 최대 64자)을
따르는 어떤 key든 된다.

JSON(`machines/order.fsm.json`과 같은 내용이며, 더 적은 줄에 썼다):

```json
{
  "$schema": "../schema/fsm.schema.json",
  "machine": "order",
  "states": [
    { "key": "draft", "code": 1, "initial": true }, { "key": "paid", "code": 2 },
    { "key": "shipped", "code": 3 }, { "key": "done", "code": 4, "final": true },
    { "key": "canceled", "code": 5, "final": true }
  ],
  "events": [
    { "key": "next",   "edges": [{ "from": "draft", "to": "paid" }, { "from": "paid", "to": "shipped" }, { "from": "shipped", "to": "done" }] },
    { "key": "prev",   "edges": [{ "from": "paid", "to": "draft" }, { "from": "shipped", "to": "paid" }] },
    { "key": "cancel", "edges": [{ "from": "draft", "to": "canceled" }, { "from": "paid", "to": "canceled" }] }
  ]
}
```

Mermaid(`fsm-gen copy --to mermaid`가 쓰는 `machines/order.fsm.mmd` 파일. Mermaid store는 이 정규 형식만 읽는다):

```
---
title: order
---
stateDiagram-v2
    state "draft" as draft
    draft : 1
    state "paid" as paid
    paid : 2
    state "shipped" as shipped
    shipped : 3
    state "done" as done
    done : 4
    state "canceled" as canceled
    canceled : 5
    [*] --> draft
    draft --> paid : next
    paid --> shipped : next
    shipped --> done : next
    paid --> draft : prev
    shipped --> paid : prev
    draft --> canceled : cancel
    paid --> canceled : cancel
    done --> [*]
    canceled --> [*]
```

Mermaid 형식은 정규형이다. 줄은 정해진 순서(상태마다 label 줄과 설명 줄, 초기 줄, event별 edge, 최종 줄)로 오고, code는 10진수로 쓰며, 상태의 label은 key 자체다(다른 label은 거부한다), reader는 그 밖의
줄을 `E_MERMAID_UNSUPPORTED`로 거부하고 줄을 이름으로 가리킨다. 복합 상태, note, fork와 join, choice, 스타일, 주석은 이 형식에
없다.

Database(`fsm-db copy --from json`으로 새 database에 옮긴 뒤의 `packages/db/schema/fsm.dbs`의 여섯 table; `order`의 행):

| table | 예제의 행 |
|---|---|
| `machine` | `order` |
| `state` (machine, key, code, position, initial, final) | `draft` 1 position 0, initial; `paid` 2; `shipped` 3; `done` 4, final; `canceled` 5, final |
| `event` (machine, key, position) | `next` 0; `prev` 1; `cancel` 2 |
| `edge` (machine, event, from, to, position) | 일곱 행, 예: position 0의 `next` `draft`에서 `paid` |
| `lock_code` (machine, code, key) | `1` `draft`부터 `5` `canceled`까지 |
| `lock_reserved` (machine, code) | 행 없음 |

세 store는 같은 정의를 담으며, 모든 명령은 셋 각각에서 같은 결과를 준다. table 구성은
[packages/db/README.ko.md](packages/db/README.ko.md)에 있다.

## code와 lock

code는 상태의 정체성이고, key는 그 이름이다. code가 의미를 유지하도록 세 규칙이 있으며, 도구가 강제한다:

- code의 의미는 바뀌지 않는다. 상태의 code를 바꾸면 `E_CODE_CHANGED`다.
- key는 code를 유지한 채 이름만 바뀐다: `fsm-gen lock --rename order.draft=created`가 정의와 lock을 함께 바꾼다. `--rename` 없이
  기존 code의 key를 바꾸면 `E_CODE_KEY_CHANGED`다.
- code는 재사용하지 않는다. 상태가 정의에서 사라지면 그 code는 lock의 `reserved`로 옮겨가고, 새 상태가 그 code를 가질 수 없다
  (`E_CODE_REUSED`). 기계 전체를 지우면 그 code가 모두 reserved로 가며, 그 lock 항목은 남는다.

code는 1부터 2147483647까지의 정수이며, 0은 "설정되지 않음"을 뜻한다. core는 새 code를 알려진 code(정의, lock, reserved 목록의 것)
중 가장 큰 값에 1을 더해 고르며, 범위를 넘으면 `E_CODE_RANGE`로 실패한다. 기계의 새 record는 초기 상태에서만 시작하며, 삭제된 상태의 데이터를 옮기는 일은 소비자의 몫이다.

lock은 파일 `fsm.lock.json`이다(database에서는 `lock_code`와 `lock_reserved` table). 기계마다 `codes`(code에서 key로)와
`reserved`(어떤 상태도 가질 수 없는 code)를 담는다:

```json
{
  "order": {
    "codes": { "1": "draft", "2": "paid", "3": "shipped", "4": "done", "5": "canceled" },
    "reserved": []
  }
}
```

lock은 정의와 함께 commit한다. 한 번이라도 공개된 code의 기록이기 때문이다. `fsm-gen lock`과 `fsm-db lock`이 쓰고, GUI 저장도 쓰며,
`copy`는 원본 lock을 그대로 쓴다. `check`, `vectors`, `gen`은 읽기만 한다. lock과 정의가 어긋나면 이 세 명령은 `E_LOCK_MISMATCH`로
실패한다.

커밋된 lock이 기준선이다(`docs/spec/fsm.md`, B-3). json과 mermaid store는 git HEAD에서 읽고(`git show
HEAD:./fsm.lock.json`), db store는 커밋이 없으므로 저장된 행과 비교한다. 커밋된 code를 잃거나, 커밋된 reserved code를
`reserved`에서 빼거나 상태에 주거나, 커밋된 key들의 code를 맞바꾸는 lock은 `E_LOCK_REGRESSED`로 거부하며 아무것도 쓰지
않는다. `lock`, `save`, `check`, `gen`, `vectors`, `copy`가 모두 이 규칙을 적용한다. 아직 커밋하지 않은 상태의 이름 바꾸기는
받는다: code를 유지하고 옛 key를 버린다. 위에서 커밋한 `order`에서 `fsm.lock.json`을 지우고 `paid`와 `shipped`의 code를
맞바꾸면 (`fsm-gen lock`의 실제 출력):

```
[fsm-gen] E_LOCK_REGRESSED order $.codes: code 2 was paid in the committed lock of order and is shipped now, while paid keeps another code
[fsm-gen] E_LOCK_REGRESSED order $.codes: code 3 was shipped in the committed lock of order and is paid now, while shipped keeps another code
```

git 밖의 프로젝트이거나 `fsm.lock.json`이 추적되지 않거나 무시되면 커밋된 기준선이 비어 그 보호가 없다. 그때 lock 규칙은 저장된
lock만 판정한다. 이 버전의 database에는 커밋된 기록이 없어 `E_LOCK_REGRESSED`가 생기지 않으며, fsm 밖(SQL)에서 바뀌거나 지워진
행은 감지하지 않는다.

## 전이

전이는 두 상태로 계산한다. 호출자가 event를 요청하기 전에 읽은 **expected** 상태와, store가 지금 가진 **actual** 상태다. 멱등성의
단위는 (expected, event) 쌍이다.

- `target(expected, event) → to`는 `expected`에서 event가 이르는 상태를 준다. event에 그 상태에서 나가는 edge가 없으면
  `E_INVALID_TRANSITION`으로 실패한다.
- `apply(expected, event, actual) → Step`은 한 번의 시도를 결정한다. `Step`은 두 필드를 가진다: 목표 상태인 `to`와, 저장된 상태를 써야
  하는지 뜻하는 `changed`.

| 조건 | 결과 |
|---|---|
| event에 `expected`에서 나가는 edge가 없음 | `E_INVALID_TRANSITION` |
| `actual == expected` | `Changed(to)`: `to`를 쓴다. `changed`는 참 |
| `actual == to` | `Unchanged(to)`: 기계는 이미 목표 상태에 있다. 아무것도 쓰지 않는다 |
| 그 밖의 경우 | `E_CONFLICT`. 오류에 `expected`, `actual`, event가 담긴다 |

`expected`가 재시도를 안전하게 만드는 이유: `draft`에서 `next`를 본다. 첫 시도는 `actual == draft`를 보고 `Changed(paid)`를 돌려주며,
호출자는 `paid`를 쓴다. 응답이 유실되고 호출자가 같은 `expected`(`draft`)로 재시도하면, 저장된 상태는 이제 `paid`이며 이는 `to`이므로
재시도는 `Unchanged(paid)`를 돌려주고 아무것도 쓰지 않는다. `expected`가 없다면 재시도는 "이미 옮겨졌다"와 "두 번 옮겨졌다"를 구별할 수
없고, 두 번째 `next`가 주문을 `shipped`로 옮겼을 것이다. 오래된 요청도 같은 방식으로 잡힌다: `draft`를 기대한 요청이 왔을 때 저장된
상태가 `shipped`이면 결과는 `E_CONFLICT`다. 요청을 멱등 key로 중복 제거하는 일은 호출자의 몫이다.

영속화 패턴은 한 transaction 안에서 row 잠금 아래 저장된 상태를 읽고, event를 그 상태에 적용하며, 결과가 `Changed`일 때만 쓴다.
`apply`의 오류는 transaction을 되돌린다. 각 언어 패키지는 자신의 `examples/` 디렉터리에서 이 패턴을 인용한다:
`packages/go/examples/persist.go`, `packages/js/examples/persist.mjs`,
`packages/php/examples/persist.php`(같은 파일이 `packages/php-ext/examples/`에도 있다),
`packages/python/examples/persist.py`, `packages/rust/examples/persist.rs`.

## 검증 오류

core는 아무것도 쓰거나 생성하기 전에 모든 정의를 검사한다. 각 검사 결과는 code, 기계, 기계 안의 JSON 경로(예: `$.states[1].code`),
메시지를 가진다. 결과는 표준 오류에 `[fsm-gen] <code> <machine> <path>: <message>`로 출력되며, 명령은 1로 끝난다. 기준은
`docs/spec/fsm.ko.md`의 B-5이며, 아래 각 code에 한 줄씩 설명을 붙였다.

| Code | 뜻 |
|---|---|
| `E_SCHEMA` | field가 없거나, 알 수 없거나, 타입이 틀렸거나, event에 edge가 없거나, 파일 이름이 `<machine>.fsm.json`(또는 `.fsm.mmd`)이 아니다 |
| `E_SELF_LOOP` | edge가 상태에서 그 상태 자신으로 간다 |
| `E_NONDETERMINISTIC` | 한 상태와 한 event가 둘 이상의 목표로 간다 |
| `E_DUPLICATE_EDGE` | 같은 edge가 한 event 안에 두 번 있다 |
| `E_INITIAL_COUNT` | 기계의 초기 상태가 정확히 하나가 아니다 |
| `E_FINAL_OUTGOING` | 최종 상태에서 나가는 edge가 있다 |
| `E_UNREACHABLE` | 초기 상태에서 도달할 수 없는 상태가 있다 |
| `E_DEAD_END` | 최종이 아닌 상태에 나가는 edge가 없다 |
| `E_KEY_FORMAT` | 기계, 상태 또는 event의 key가 소문자와 숫자를 한 개씩 나뉜 밑줄로 잇는 형식이 아니거나 64자보다 길다 |
| `E_DUPLICATE_KEY` | key가 범위 안에서 반복되거나, 밑줄을 뺐을 때 두 기계 key가 같다 |
| `E_KEY_RESERVED` | key가 생성 파일, module, 언어 키워드 또는 Mermaid 단어로 쓸 수 없는 고정 목록에 있다 |
| `E_DUPLICATE_CODE` | 한 기계의 두 상태가 같은 code를 가진다 |
| `E_CODE_RANGE` | code가 1부터 2147483647 범위를 벗어난다 |
| `E_UNKNOWN_STATE_REF` | edge가 기계에 없는 상태를 가리킨다 |
| `E_LOCK_MISMATCH` | lock이 상태들의 code와 정확히 같지 않거나, 정의되지 않은 기계가 lock에 code를 가진다 |
| `E_LOCK_REGRESSED` | lock이 커밋된 code를 잃거나, 그중 reserved를 풀거나 상태에 주거나, 커밋된 key들의 code를 맞바꾼다(json과 mermaid: git HEAD와 비교) |
| `E_CODE_REUSED` | 상태가 lock에서 reserved인 code를 가진다 |
| `E_CODE_KEY_CHANGED` | 상태가 code는 유지하지만 `--rename` 없이 key가 바뀌었다 |
| `E_CODE_CHANGED` | lock이 code에 대응시킨 key에 다른 code가 주어졌다 |
| `E_MERMAID_UNSUPPORTED` | Mermaid 파일에 정규 형식 밖의 줄이 있다. 메시지가 줄을 가리킨다 |
| `E_STORE_MIXED` | `machines/`에 `fsm.config.json`이 고른 것이 아닌 store의 파일이 있다 |
| `E_STORE_NOT_EMPTY` | `copy`가 정의나 lock이 이미 있는 대상에 쓰려고 한다 |
| `E_STORE_NOT_CONFIGURED` | `fsm.config.json`이 없거나 JSON이 아니거나, 명령이 처리하지 않는 store를 지정한다 |
| `E_NOT_GENERATED` | `gen`이나 `vectors`의 출력 디렉터리에 생성 header가 없는 파일이 있다. 아무것도 쓰거나 지우지 않는다 |

함수의 code는 별도의 계열이다: `target`과 `apply`의 `E_INVALID_TRANSITION`과 `E_CONFLICT`, `from_code`의 `E_UNKNOWN_CODE`(0 포함,
상태가 아닌 값)와 `E_RESERVED_CODE`(reserved code). 이들은 생성된 언어의 `Error`로 여러분의 프로그램에 도달하며, 각 언어 README가 이를
설명한다.

## 프로젝트 파일

fsm 프로젝트는 디렉터리다. 도구는 그 루트에서 다음 파일을 읽는다:

```text
fsm.config.json          {"store":"json"}, {"store":"mermaid"} or {"store":"db","dsnEnv":"FSM_DSN"}
machines/                one file per machine: <machine>.fsm.json or <machine>.fsm.mmd (one format per project)
fsm.lock.json            the lock of the file stores (the db store keeps its lock in tables)
schema/fsm.schema.json   the JSON schema of a machine file, for editors; each machine file names it in `$schema`
```

이 저장소의 프로젝트는 `contracts/`다. 그 machine이 여섯 언어 패키지를 생성하며, 언어 패키지의 examples/가 쓰는 영속화 패턴의 예제
table인 `schema/persist.dbs`와 fsm-gen vectors가 쓰는 vector case의 기대 결과인 `conformance/vectors.json`도 담는다. fsm-db install이
설치하는 db store의 여섯 database table(dbspec `fsm`)은 `packages/db/schema/fsm.dbs`다.

`fsm.config.json`이 store를 고르며, fsm-gen, fsm-db, fsm-gui가 모두 이를 읽는다. fsm-gen은 json과 mermaid store를 처리하며, `db`는
`E_STORE_NOT_CONFIGURED`로 거부한다. fsm-db는 `db`만 처리한다. 이주 뒤에 프로젝트의 store를 바꾸는 것은 여러분의 결정이다. 도구가
`fsm.config.json`을 대신 바꾸지 않는다.

## 요구사항과 설정

도구는 Node.js에서 실행된다. 고정된 release는 `.node-version`(26.11.1)에 있으며, npm은 함께 온다. 생성된 코드는 자기 언어의
toolchain만 필요로 한다:

| 대상 | 필요한 것 |
|---|---|
| fsm-gen, fsm-db, fsm-gui와 생성된 npm 코드 | Node.js 26.11.1(`.node-version`)과 npm |
| 생성된 go 코드 | Go 1.27.2(module에 `go 1.27.2`) |
| 생성된 php 코드 | PHP 8.4 이상(orm client가 8.4를 요구한다). checkout은 PHP 8.5와 Composer 2.10.3으로 테스트한다(`config/toolchain.json`) |
| 생성된 php-ext 코드 | php의 요구 사항, 그리고 `phpize`, `autoconf`, C 컴파일러 |
| 생성된 python 코드 | Python 3.14(`config/toolchain.json`의 `pythonBuild`). `make install`이 `config/toolchain.json`의 uv로 `var/tools`에 설치한다(`make install-tools`) |
| 생성된 rust 코드 | Rust 1.99.0(`rust-toolchain.toml`). 생성된 library는 표준 라이브러리만 쓴다 |

명령은 이 저장소의 clone에서 온다. clone에서 각 명령을 PATH에 설치한다. npm은 clone의 package를 link하므로 명령은 그 clone의 코드를
실행한다:

```sh
git clone https://github.com/polyspec/fsm.git
cd fsm
make install-tools TOOLS=npm                       # once, online: the npm of packageManager (package.json)
make install-packages                              # once, online: the root packages, @polyspec/kit among them
make install                                       # once, online: the toolchains and every package dependency
npm install -g ./packages/compiler             # fsm-gen: no dependencies
make db-deps && npm install -g ./packages/db   # fsm-db: needs the orm packages
make gui-build && npm install -g ./packages/gui # fsm-gui: builds the browser assets first
```

처음 두 명령은 polyspec의 공용 도구인 package `@polyspec/kit`을 설치한다. Makefile은 그 make 타깃을 include한다(`scripts/kit/kit-bootstrap.mk`). 그 전에는 이 두 타깃만 실행된다. `make install`은 `var/tools`의 toolchain(`pythonBuild`의 Python 3.14 포함)과 모든 패키지 의존성을 한 번 내려받는다. 나중의 실행은 이미 설치된 것을 찾고 아무것도
내려받지 않는다. json과 mermaid store에는 첫 `npm install -g` 명령만 있으면 된다. `make db-deps`는 `packages/db`의 orm 패키지를
release tarball에서 설치하고, `make gui-build`는 GUI를 설치하고 browser asset을 빌드한다.

## fsm-gen 명령

`fsm-gen`은 컴파일러의 명령 줄이다. 명령은 다섯 개다. 각 명령은 `--project <dir>`을 받는다. 이는 `fsm.config.json`이 store를 고르는
프로젝트 루트이며, 기본값은 현재 디렉터리다. 종료 코드는 모든 명령에서 같다:

| 종료 코드 | 뜻 |
|---|---|
| 0 | 명령이 성공했다. 표준 출력에 `[fsm-gen] <command>: ok`가 나온다 |
| 1 | 검사 결과(표준 오류에 결과마다 한 줄), 또는 예상하지 못한 거부(stack과 함께 출력) |
| 2 | 사용 오류: 알 수 없는 명령, 그 명령이 받지 않는 옵션, 빠졌거나 잘못된 값. 사용법은 표준 오류에 나온다 |

### check

모든 정의를 검사하고 lock을 정의와 대조한다. 아무것도 쓰지 않는다.

```sh
$ fsm-gen check --project ./order-machines
[fsm-gen] check: ok
```

### lock

정의로부터 lock을 유도하고 둘 다 쓴다. `--rename machine.old=new`는 상태 key의 이름을 바꾸고 code를 유지한다. 옵션은 여러 번 줄 수
있다. 검사 결과가 있으면 아무것도 쓰지 않는다.

```sh
$ fsm-gen lock --project ./order-machines --rename order.draft=created
[fsm-gen] lock: ok
```

### copy

프로젝트 store의 정의와 lock을 파일 store로 복사한다. `--to json` 또는 `--to mermaid`가 형식을, `--root <dir>`이 대상 디렉터리를
정한다(필수). 정의나 lock이 이미 있는 대상은 `E_STORE_NOT_EMPTY`로 실패하며 아무것도 쓰지 않는다.

```sh
$ fsm-gen copy --to mermaid --root ./order-mermaid --project ./order-machines
[fsm-gen] copy: ok
```

### vectors

conformance vector, 즉 모든 기계의 모든 연산의 기대 결과를 쓴다(`docs/plans/fsm-v1.md`, C-4). `--kind` 없이 `--out <file>`은 모든 기계의
suite 하나 `{ machines: [{ machine, cases }] }`를 받는다. `--kind <kind>`일 때 `--out`은 그 종류의 native test module 파일 이름이다. php와 php-ext 종류는
`--php-namespace`도 필요하다.

```sh
$ fsm-gen vectors --project ./order-machines --out ./vectors
[fsm-gen] vectors: ok
$ fsm-gen vectors --kind npm --project ./order-machines --out ./tests/vectors.mjs
[fsm-gen] vectors: ok
```

### gen

한 언어의 소스를 `--out <dir>`에 생성한다. `--kind`는 `go`, `npm`, `php`, `php-ext`, `python`, `rust` 중 하나다. 각 생성 파일은
`Code generated by fsm-gen from <machine>; DO NOT EDIT.` header로 시작한다. `gen`은 자신이 전에 쓴 파일을 교체하고 그중 오래된 것을
지우지만, header가 없는 파일은 건드리지 않는다(`E_NOT_GENERATED`). 그래서 손으로 쓴 파일은 덮어쓰거나 지워지지 않는다. 출력 디렉터리의
git 무시 파일은 빌드 결과물이므로 건너뛴다.

| 옵션 | 필요한 경우 | 뜻 |
|---|---|---|
| `--go-module <module path>` | `go` | package의 module 경로. 생성된 기계는 `<module>/src/fsm`을 import하므로, `--out`은 그 module의 `src` 디렉터리다 |
| `--php-namespace <ns>` | `php`, `php-ext`(이 종류의 `vectors`도) | `Acme\Fsm`처럼 글자와 숫자를 한 개의 역슬래시로 나눈 namespace |
| `--php-ext-name <name>` | `php-ext` | extension 이름: 소문자, 숫자, 밑줄이며 글자로 시작한다. 예: `acme_fsm` |

```sh
$ fsm-gen gen --project ./order-machines --kind go --go-module example.com/app --out ./app/src
[fsm-gen] gen: ok
$ fsm-gen gen --project ./order-machines --kind npm --out ./app/src
[fsm-gen] gen: ok
$ fsm-gen gen --project ./order-machines --kind php --php-namespace 'Acme\Fsm' --out ./app/src
[fsm-gen] gen: ok
$ fsm-gen gen --project ./order-machines --kind php-ext --php-namespace 'Acme\Fsm' --php-ext-name acme_fsm --out ./ext/src
[fsm-gen] gen: ok
$ fsm-gen gen --project ./order-machines --kind python --out ./app/order_fsm
[fsm-gen] gen: ok
$ fsm-gen gen --project ./order-machines --kind rust --out ./app/src
[fsm-gen] gen: ok
```

필수 옵션이 없으면 사용 오류(종료 코드 2)다:

```sh
$ fsm-gen gen --project ./order-machines --kind go --out ./app/src
[fsm-gen] usage: gen --kind go needs --go-module <module path>, the module of the package
usage: fsm-gen check [--project <dir>]
       fsm-gen lock [--project <dir>] [--rename machine.old=new]...
       fsm-gen copy --to json|mermaid --root <dir> [--project <dir>]
       fsm-gen vectors [--kind <kind>] --out <file> [--project <dir>] [--php-namespace <ns>]
       fsm-gen gen --kind <kind> --out <dir> [--project <dir>] [--go-module <module path>] [--php-namespace <ns>] [--php-ext-name <name>]   (kind: go, npm, php, php-ext, python, rust)
```

검사 결과는 결과마다 한 줄씩 출력되며, 아무것도 쓰지 않는다(종료 코드 1). 잘못된 정의의 예:

```sh
$ fsm-gen check --project ./broken
[fsm-gen] E_DUPLICATE_CODE order $.states[1].code: code 2 is used by another state of the machine
[fsm-gen] E_UNREACHABLE order $.states[5]: state Bad is not reachable from the initial state
[fsm-gen] E_DEAD_END order $.states[5]: state Bad is not final and has no outgoing edge
[fsm-gen] E_KEY_FORMAT order $.states[5].key: state key Bad is not lower case letters and digits joined by single underscores
```

나머지 두 도구는 자기 명령이 있다: database store의 `fsm-db`와 편집기 `fsm-gui`. 사용법은 각 README에 있다.

## 도구

- [`fsm-gen`](packages/compiler/README.ko.md): 컴파일러와 그 명령 줄. 검사하고, lock을 유도하고, json과 mermaid store 사이를 바꾸고,
  vector를 쓰고, 여섯 언어를 생성한다.
- [`fsm-db`](packages/db/README.ko.md): database store. 여섯 table을 설치하고, database 프로젝트를 검사하고 lock을 걸며, database와
  파일 store 사이를 복사한다.
- [`fsm-gui`](packages/gui/README.ko.md): 프로젝트 기계를 위한 browser 편집기이며, 기계마다 Mermaid 다이어그램을 보여준다. 모든 저장은
  `fsm-gen`과 같은 core 규칙을 거친다.
- 언어 패키지(대상마다 하나): [go](packages/go/README.ko.md), [npm](packages/js/README.ko.md),
  [php](packages/php/README.ko.md), [php-ext](packages/php-ext/README.ko.md),
  [python](packages/python/README.ko.md), [rust](packages/rust/README.ko.md). 각각 생성 코드의 사용, conformance 테스트,
  영속화 패턴을 보여준다.

## 생성 이름

기계 하나는 모듈 하나다. 모듈 안의 이름은 모든 언어에서 같으며, 표기법만 바뀐다. 표는 위 예제의 기계 `order`를 쓴다(정의의 B-6).

| 개념 | go | rust | npm | python | php / php-ext |
|---|---|---|---|---|---|
| 모듈 | package `order`(`src/order/`) | `mod order` | `order.js` | 모듈 `order` | namespace `<ns>\Order` |
| 타입 | `State`, `Event`, `Step` | 같음 | 같음 | 같음 | 같음 |
| 상태 member | `StateDraft` | `State::Draft` | `State.Draft` | `State.DRAFT` | `State::Draft` |
| event member | `EventNext` | `Event::Next` | `Event.Next` | `Event.NEXT` | `Event::Next` |
| 함수 | `Initial`, `Code`, `Key`, `FromCode`, `IsFinal`, `EventsFrom`, `Target`, `Apply` | `initial`, `code`, `key`, `from_code`, `is_final`, `events_from`, `target`, `apply` | `initial`, `code`, `key`, `fromCode`, `isFinal`, `eventsFrom`, `target`, `apply` | `initial`, `code`, `key`, `from_code`, `is_final`, `events_from`, `target`, `apply` | `initial`, `code`, `key`, `fromCode`, `isFinal`, `eventsFrom`, `target`, `apply` |
| 호출 | `order.Apply(…)` | `order::apply(…)` | `order.apply(…)` | `order.apply(…)` | `Order\apply(…)` |
| 오류 | `fsm.Error` | `fsm::Error` | `fsm.Error` | `fsm.Error` | `<ns>\Fsm\Error` |

- 공유 모듈 `fsm`은 `Error` 타입과 오류 code를 가진다. 기계 key `fsm`은 예약되어 있다.
- `State` 값은 code다: go는 `type State int32`, rust는 `#[repr(i32)]`, npm은 고정된 객체와 union 타입, python은 `IntEnum`, php는
  `enum State: int`다. `Event` 값은 선언 위치이며 1부터 시작한다.
- `Step`은 `to`와 `changed` 필드를 가진다. 오류 code는 각 언어 표기에서 `E_` 접두사를 잃는다: npm은 `Code.Conflict`, php와 rust는
  `Code::Conflict`, python은 `Code.CONFLICT`, go는 `CodeConflict`.
- 모든 언어에서 인자가 같다: `apply(expected, event, actual)`과 `target(expected, event)`.

## 검사

`make check`는 커밋된 트리에 대해 저장소의 전체 검사를 한 번 실행한다(kit의 `full-run.mjs run`, Makefile의 `CHECK_TARGETS`
대상). 위의 모든 toolchain이 있어야 한다. 새 clone에서는 먼저 `make install-tools TOOLS=npm`, `make install-packages`, `make install`을 한 번 실행한다: toolchain은 `make install`에서만 오고, `make check`의 타깃은 필요한 패키지 의존성을 스스로 설치한다. 문서가 기대는 검사는 하나씩 실행할 수 있다:

| 명령 | 검사 |
|---|---|
| `make readme-check` | 모든 README 쌍이 필수 절과, 같은 제목을 가진 한국어 짝을 가지는지(`scripts/check-readmes.mts`) |
| `make readme-test` | 그 검사의 테스트 |
| `make workflows-test` | CI와 Pages 워크플로: 모든 action이 검증된 commit에 고정되고, check job이 `make install`과 `make check`를 C-6의 서비스와 함께 실행하며, 각 버전이 그것을 선언하는 파일에서 오는지(`tests/workflows`) |
| `make docs-build` | 문서 사이트가 빌드된다. dead link는 빌드를 실패시킨다 |
| `make docs-build-test` | 사이트의 dead link 실패와 실제 빌드 |
| `make documents-check` | 모든 문서에 현재의 `source-sha256` stamp를 가진 한국어 짝이 있고 링크가 유효한지 |
| `make name-check` | 추적 파일이 라이브러리를 옛 이름으로 부르지 않는지 |
| `make gui-test`, `make compiler-test`, `make db-test` | 각 도구의 테스트 |
| `make db-test-postgres`, `make db-test-mysql`, `make npm-persist-test-postgres`, `make npm-persist-test-mysql`, `make <kind>-persist-test-postgres`, `make <kind>-persist-test-mysql` (kind: go, rust, php, php-ext, python) | PostgreSQL과 MySQL에서의 DB store, CLI, command 테스트, npm의 영속화 동시성 증명, 각 kind의 persist case. `FSM_TEST_PG_DSN`과 `FSM_TEST_MYSQL_DSN`을 읽고(CLI 테스트의 빈 database에는 `FSM_TEST_PG_ADMIN_DSN`과 `FSM_TEST_MYSQL_ADMIN_DSN`도 읽으며), 없으면 exit 2로 멈추고 dialect를 건너뛰지 않는다(계획 C-6). SQLite에서도 돈다(`make db-test`, `make npm-persist-test`, `make test-<kind>`) |
| `make test-go`, `make test-npm`, `make test-php`, `make test-php-ext`, `make test-python`, `make test-rust` | 각 언어 패키지의 테스트 |

CI(`.github/workflows/ci.yml`)는 main에 push될 때마다 kit을 설치하고(`make install-tools TOOLS=npm`, `make install-packages`) `make install`과 `make check`를 실행하며, PostgreSQL과 MySQL 서비스를 띄운다. 문서 사이트는 `.github/workflows/pages.yml`이 https://polyspec.github.io/fsm/ 에 게시한다.

각 언어 패키지의 conformance 테스트는 같은 vector case를 실행한다. case마다 test 하나이며 이름은 case 이름 `<feature>__<id>`다(php와 python은 method `test_<feature>__<id>`). kit의 parity 검사(K33, `config/parity.json`)가 이 이름을 읽는다.
`make gen-check`는 패키지의 생성 파일이 `fsm-gen`이 지금 쓰는 파일과 같은지 검사한다.
