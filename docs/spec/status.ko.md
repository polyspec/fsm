<!-- doc-id: spec-status -->
<!-- source-sha256: 53a389ea1420a65e4d6213fb7d5894a2b58c846dc10b98cdfaa2d68ddc05beb0 -->
# status 정의

[English](status.md)

## B-0. 채택 판정
- 채택
  - 평면 enum + 명시적 정수 code
  - 이벤트 = 이름 붙은 엣지 집합(엣지 여러 개 허용)
  - 생성 `switch`/`match`, 부분 전이 함수
  - 단일 initial, final에서 나가는 전이 없음
  - 결정성은 검증으로 보장
  - 순수 함수
  - 정의 저장 매체 3종(JSON, Mermaid, DB)
- 비채택
  - guard·조건 분기, entry/exit·콜백·액션
  - 계층·병렬 상태, history, 자동·지연 이벤트, 이벤트 큐, 확장 상태
  - 와일드카드 from, 자기 전이, typestate
  - orm dbspec `state_machine`·`checkbox` 설정(상태 컬럼의 두 번째 정의가 됨)
  - 런타임 설정 로딩, 이름 문자열 저장, 라벨/i18n
  - 별도 sequence 문법(next/prev는 일반 이벤트)
  - 저장 폭 설정(code는 32비트 범위로 고정)

## B-1. 정의 모델
정의는 세 가지로만 이루어진다.
- 머신 이름
- 상태: key, code, initial, final
- 이벤트: key, 엣지 목록 `{from, to}`…

| 개념 | JSON | Mermaid(공식 문법) | DB(orm) |
|---|---|---|---|
| 머신 | `"machine": "order"` | frontmatter `title: order` | `machine(name)` |
| 상태·code | `{"key":"draft","code":1}` | `draft : 1` (state description) | `state(machine, key, code, initial, final, position)` |
| initial | `"initial": true` | `[*] --> draft` | `initial` |
| final | `"final": true` | `done --> [*]` | `final` |
| 엣지 | `{"key":"next","edges":[{"from":"draft","to":"paid"},…]}` | `draft --> paid : next` | `edge(machine, event, from, to, position)` + `event(machine, key, position)` |

예시(`order`는 주문 생명주기를 뜻하는 예시 머신 key일 뿐이다):
```json
{
  "$schema": "../schema/status.schema.json",
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
```
---
title: order
---
stateDiagram-v2
    draft : 1
    paid : 2
    shipped : 3
    done : 4
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
- Mermaid 정규형
  - 줄 순서를 고정한다: 상태 선언(상태 순서) → initial → 이벤트 순서대로 엣지(이벤트 안에서는 엣지 순서) → final(상태 순서). code는 앞자리 0 없는 10진수, 상태당 description 1개.
  - 읽을 때 정규형 밖의 문법은 `E_MERMAID_UNSUPPORTED{line}`로 거부한다. 복합 상태, note, fork/join, choice, 스타일, 주석, 순서 위반이 해당된다. 조용히 무시하지 않는다.
- 순서 규칙
  - 상태 순서와 이벤트 순서는 선언 순서다. 순서는 `events_from`과 생성 순서에 쓰인다.
  - code와 선언 순서는 서로 독립이다.
- 엣지는 쌍이 아니라 객체 `{from, to}`다. 객체는 필드에 이름이 있어 에디터 schema가 kit `schema-validate.mjs`의 키워드(최대 원소 수가 없다)만으로 정확히 검사하고, GUI 폼은 from과 to 필드를 가진 행으로 편집한다.
- IR = `δ: (state, event) → to`.
- code 범위는 `1..2147483647`(모든 타깃에서 같은 32비트 범위)이다. 0은 미설정이다.
- `schema/status.schema.json`은 에디터용이며 kit `schema-validate.mjs`가 지원하는 키워드만 쓴다. 판정 권위는 core validate다.

## B-2. 저장소 3종, 규칙 1개
- core는 정의를 **객체**로만 다룬다(validate → normalize → emit). store는 객체 ↔ 매체 변환만 한다.

| store | 정의 | lock | 패키지 |
|---|---|---|---|
| `json` | `machines/*.status.json` | `status.lock.json` | status-compiler |
| `mermaid` | `machines/*.status.mmd` | `status.lock.json` | status-compiler |
| `db` | orm 정의 테이블 | orm lock 테이블 | status-db |

- store 계약은 `{load() → Promise<{definitions, lock}>, save({definitions, lock}) → Promise}`이다. DB store의 orm client가 비동기이므로 store 계약, `run`, `copy`는 비동기이고, 순수 함수(validate, normalize, lock, vectors)는 동기로 남아 GUI가 직접 호출한다.
  - store는 변환과 원자적 쓰기만 하고 검증하지 않는다.
  - 쓰기: json·mermaid는 파일별 임시파일+rename(파일 단위 원자성만), db는 한 transaction 안에서 전체 교체. 파일 store가 중간에 중단되면 다음 `gen`/`vectors`/`check`가 `E_LOCK_MISMATCH`로 드러내고 복구는 git으로 한다.
- 명령(`lock`, `save`, `gen`, `vectors`, `check`)은 core `run(command, store, options)` 하나로 실행한다(비동기, Promise를 돌려준다).
  - `save`(GUI 저장, 저장 1회에 머신 1개)와 `lock`은 새 정의가 `E_LOCK_MISMATCH`를 뺀 B-5의 모든 규칙을 통과하고, 저장된 lock과 새 정의 사이에서 lock 규칙을 통과한 뒤에만 `store.save`를 한 번 부른다. 쓰는 lock은 새 정의에서 만들므로 정의와 항상 일치한다.
- 원본 store는 프로젝트 루트의 `status.config.json` 하나가 정한다.
  - 형식: `{"store":"json"|"mermaid"}` 또는 `{"store":"db","dsnEnv":"STATUS_DSN"}`
  - status-gen, status-db, status-gui는 이 파일을 읽는다. 설정된 store를 그 도구가 다루지 못하면(예: status-gen + `db`) `E_STORE_NOT_CONFIGURED`.
  - `machines/`에 설정과 다른 형식의 파일이 있으면 `E_STORE_MIXED`.
- `copy(from, to)`는 `run` 밖의 비동기 core 이관 함수다(`await to.save(await from.load())`). CLI는 `copy --to json|mermaid --root <dir>` 또는 `copy --to db`(DSN은 `--dsn-env`가 가리키는 환경 변수)이며, 대상 루트에 `machines/`나 `status.lock.json`(db면 정의·lock 행)이 있으면 `E_STORE_NOT_EMPTY`.
  - status-gen은 json↔mermaid 이관을 제공한다(의존성 0 유지).
  - status-db는 db↔json/mermaid 이관을 제공한다.
  - 이관 뒤 `status.config.json`을 바꾸는 것은 사람이 결정한다.
- 규칙이 하나라는 것은 store 계약 테스트로 강제한다.
  - 모든 fixture를 json → db → mermaid → json으로 왕복시켰을 때 바이트 동일해야 한다.
  - 세 store에서 `run`한 결과가 바이트 동일해야 한다.

## B-3. code 불변 (lock)
- code는 정체성이고 key는 이름이다. 배포된 code는 의미를 바꾸거나 재사용할 수 없다.
- lock = `{machine: {codes: {code: key}, reserved: [code…]}}`. lock은 `lock`(손으로 편집한 정의용), `save`(GUI), `copy`(원본을 B-5 전 규칙으로 검증한 뒤 원본 lock을 그대로 쓴다)만 갱신한다. `lock`과 `save`는 같은 lock 규칙(`E_CODE_REUSED`, `E_CODE_KEY_CHANGED`, `E_CODE_CHANGED`, 사라진 code → reserved)을 적용하고, 셋 모두 정의와 lock을 같은 `store.save`로 쓴다.
- `lock`이 거부하는 경우
  - `E_CODE_REUSED`: reserved code 재사용
  - `E_CODE_KEY_CHANGED`: 기존 code의 key 변경. 이름 변경은 `lock --rename m.old=new`로만 하며, 정의와 lock을 함께 바꾼다.
  - `E_CODE_CHANGED`: lock이 code에 대응시킨 key를 정의가 다른 code로 주는 경우. 삭제 후 다시 추가한 key도 lock이 아직 대응시키고 있으면 포함한다. 메시지는 lock이 가진 code를 밝히며, released code는 절대 바뀌지 않는다. lock에 reserved 이력으로만 남은 key는 비교할 code가 없다(reserved에는 code만 있다).
- 정의에서 사라진 상태의 code는 reserved로 옮긴다. 머신 전체가 사라지면 그 code를 모두 그 머신의 reserved로 옮기고 lock 항목은 남긴다(DB lock 테이블에 machine FK가 없다, 계획 C-6).
- `gen`/`vectors`/`check`는 다음을 만족하지 않으면 `E_LOCK_MISMATCH`: 정의된 머신마다 lock `codes`가 그 상태들의 `{code: key}`와 같고 `reserved`가 그 code와 겹치지 않는다. 정의에 없는 lock 머신은 `codes`가 비어 있다.
- 새 code의 기본값은 core `nextCode(machine, definitions, lock)` = max(정의 ∪ lock codes ∪ reserved)+1이다. 범위를 넘으면 `E_CODE_RANGE`. GUI는 이 값을 제안만 하고 규칙을 갖지 않는다.
- 새 레코드는 `initial`로만 시작한다. 삭제된 상태의 데이터 이관은 소비자 DB 작업이다.

## B-4. 전이 의미론 (멱등성)
멱등 단위는 **(expected, event)**다. 호출자는 관측한 상태 `expected`를 기억하고, 재시도할 때 같은 값을 넘긴다. `next`처럼 엣지가 여러 개인 이벤트도 이 규칙으로 두 번 전진하지 않는다.

- `target(expected, event) → to`: 미정의면 `E_INVALID_TRANSITION`.
- `apply(expected, event, actual) → Step`:

| 조건 | 결과 |
|---|---|
| δ(expected, event) 미정의 | `E_INVALID_TRANSITION` |
| `actual == expected` | `Changed(to)` |
| `actual == to` | `Unchanged(to)`: "이미 목표 상태"라는 뜻 |
| 그 외 | `E_CONFLICT{expected, actual, event}` |

- 요청 단위 중복 제거(idempotency key)는 소비자 책임이다.
- 영속화(기능 `persist`): orm transaction 안에서 `forUpdate()`로 잠근다.
  - MySQL/PostgreSQL은 행 잠금, SQLite는 `BEGIN IMMEDIATE` 쓰기 잠금이다.
  - 잠금 아래에서 actual을 읽으므로 호출자 쪽 재시도 루프가 필요 없다.
  - deadlock이 나면 orm이 콜백을 다시 실행한다. apply가 순수 함수라 재실행해도 안전하다.
  ```
  db.transaction(() => {                      // go Transaction(func() error), npm/rust async
    row  = Model().connect(db).<pk>(x).forUpdate().get()   // orm error if missing
    step = apply(expected, event, from_code(row.getStatus()))
    Changed   → row.setStatus(code(step.to)).update()
    Unchanged → return without writing
    error     → throw (orm rolls back)
  })
  ```

## B-5. 검증 규칙 (오류 코드 1개 = RED 케이스 1개, warning 없음)
- finding: core `validate(definitions)`는 모든 finding을 `{code, machine, path, message}`로 돌려준다. `path`는 머신 객체 안의 JSON 경로(`$.states[1].code`), `machine`은 그 key이며, 정의에 문자열 key가 없으면 null이다. finding은 머신 안에서는 문서 순서, 머신 사이에서는 입력 순서를 따른다. `E_SCHEMA` finding이 있는 머신은 다른 finding을 받지 않는다. GUI는 `path`를 폼 필드에 연결하고, 필드가 없는 finding은 폼 오류로 보인다.
- 구조
  - `E_SCHEMA`: 필수 필드 누락, 미지 필드, 타입 위반, 빈 `edges`(이벤트는 엣지 1개 이상), 파일 이름 ≠ `<machine>.status.json|mmd` (JSON 경로 포함)
- 그래프
  - `E_SELF_LOOP`: from == to인 엣지
  - `E_NONDETERMINISTIC`: 같은 (state, event)에 to가 둘 이상
  - `E_DUPLICATE_EDGE`: 같은 이벤트 안에 같은 엣지가 반복됨
  - `E_INITIAL_COUNT`: initial이 정확히 1개가 아님
  - `E_FINAL_OUTGOING`: final에서 나가는 엣지가 있음
  - `E_UNREACHABLE`: initial에서 도달할 수 없는 상태
  - `E_DEAD_END`: 비-final인데 나가는 엣지가 없음
- 이름
  - `E_KEY_FORMAT`: 머신·상태·이벤트 key가 `^[a-z][a-z0-9]*(_[a-z][a-z0-9]*)*$`가 아니거나 64자를 넘음(DB store는 key를 varchar(64)에 담으므로, core가 이 상한을 강제해 세 store가 같은 key를 받아들이게 한다)
  - `E_DUPLICATE_KEY`: 머신 key 중복, 한 머신 안의 상태 key 중복·이벤트 key 중복, 또는 `_`를 지웠을 때 같아지는 두 머신 key(`ab`와 `a_b`는 모두 php `<ns>\Ab`가 된다)
  - `E_KEY_RESERVED`: `docs/spec/status.md`의 고정 목록 하나이며 kind·store와 무관하게 모든 정의에 적용한다. (1) 머신 key(`_`를 지우고 비교): `status`(공용 모듈), `index`(npm `index.js`), `lib`·`main`(rust `src/lib.rs`·`src/main.rs`, go `package main`), `internal`(go internal package는 `tests/`에서 import할 수 없음), `init`(go는 `init`라는 이름으로 package를 import하지 못함), `testdata`·`vendor`(go `./...`가 건너뜀), go 사전 선언 식별자(`error`, `string`, `int`, `len`, `nil` 등. 그 이름의 package를 import하면 이를 가린다), 그리고 go·rust(고정 edition)·python·js의 keyword(이 네 언어에서는 머신 key가 그대로 모듈 이름이다). (2) pascal 형태가 enum 멤버로 거부되는 상태·이벤트 key: `self`(rust `Self`), `class`(php `Class`). (3) Mermaid 예약어(store와 무관하게 항상 적용): 상태 key `note, class, classdef, style, click, href, default, state, statediagram, scale, acctitle, accdescr, root_start, root_end`; 머신 key `null, true, false`(고정한 mermaid 버전 12.1.0 기준). S-16 테스트(`packages/status-gui/tests/mermaid-parse.test.mjs`)는 상태 key를 다섯 위치(설명 줄, 초기 줄, edge의 출발, edge의 도착, 최종 줄)에서 검사한다. 단어는 그 위치에서 mermaid가 다이어그램을 파싱하지 못하거나, 쓴 모델과 다른 모델로 파싱할 때 쓸 수 없다. 다른 모델은 `[*]` id와 충돌하는 id(`root_start`, `root_end`)이거나, mermaid가 버리는 줄이나 code다(설명 줄의 `state`, 설명 줄과 초기 줄의 `acctitle`·`accdescr`). 머신 단어는 mermaid의 stateDiagram이 frontmatter title을 읽지 않으므로 frontmatter의 YAML 규칙으로 검사한다. 이름은 변형하지 않고 거부한다.
- code·lock
  - `E_DUPLICATE_CODE`, `E_CODE_RANGE`, `E_UNKNOWN_STATE_REF`, `E_LOCK_MISMATCH`, `E_CODE_REUSED`, `E_CODE_KEY_CHANGED`, `E_CODE_CHANGED`
- store
  - `E_MERMAID_UNSUPPORTED`, `E_STORE_MIXED`, `E_STORE_NOT_EMPTY`, `E_STORE_NOT_CONFIGURED`
- 생성
  - `E_NOT_GENERATED`: `gen`이나 `vectors --kind`가 출력 디렉터리에서 생성 헤더가 없는 파일을 찾음. 아무것도 쓰거나 지우지 않는다. 생성기는 자기가 쓴 파일만 바꾸므로, 손으로 쓴 파일을 덮어쓰거나 지우지 않는다.

## B-6. 이름 규칙 (언어 공통 규칙 1개 + 언어별 표기 변환표)
이 문서의 `order`는 예시 머신 key(주문 생명주기)다. 생성 이름은 모두 아래 규칙에서 기계적으로 나오고, 접미사나 절충 이름(`OrderMachine`, `OrderStatus`)은 없다.

**공통 규칙: 머신 1개 = 모듈 1개**
- 모듈 이름 = 머신 key.
- 모듈 안 이름은 모든 언어에서 같다.
  - 타입: `State`(상태 enum), `Event`(이벤트 enum), `Step`(apply 결과)
  - 멤버: 상태·이벤트 key
  - 함수: `initial`, `code`, `key`, `from_code`, `is_final`, `events_from`, `target`, `apply`(= features.json id)
- 공용 모듈 `status`에는 타입 `Error`(필드 `code`, `expected`, `actual`, `event`)와 오류 코드 상수가 있다. 그래서 머신 key `status`는 예약이다(`E_KEY_RESERVED`).
- 언어별 차이는 아래 표의 **표기 변환**뿐이다. 변환 함수 4개만 쓴다: `snake`(그대로), `pascal`, `camel`, `upper`. key 형식(`E_KEY_FORMAT`)상 네 함수는 모두 1:1이다.

| 개념 | go | rust | npm | python | php / php-ext |
|---|---|---|---|---|---|
| 모듈 | package `order`(`src/order/`) | `mod order` | `order.js` | module `order` | namespace `<ns>\Order` (pascal) |
| 타입 | `State` `Event` `Step` | 동일 | 동일 | 동일 | 동일 |
| 상태 멤버 | `StateDraft` (pascal, scoped enum이 없어 타입명 접두) | `State::Draft` | `State.Draft` | `State.DRAFT` (upper) | `State::Draft` |
| 이벤트 멤버 | `EventNext` | `Event::Next` | `Event.Next` | `Event.NEXT` | `Event::Next` |
| 함수 | `Apply`, `FromCode` (pascal, export 강제) | `apply`, `from_code` (snake) | `apply`, `fromCode` (camel) | `apply`, `from_code` (snake) | `apply`, `fromCode` (camel, namespace 함수) |
| 함수 호출 | `order.Apply(…)` | `order::apply(…)` | `order.apply(…)` | `order.apply(…)` | `Order\apply(…)` |
| 오류 | `status.Error` | `status::Error` | `status.Error` | `status.Error` | `<ns>\Status\Error` |

- 표기 변환은 polyspec orm의 생성 API 표기(PHP/TS camel, Go pascal, Rust/Python snake)와 같고, 각 언어의 공식 표기 관례를 따른다. 위 표 외의 예외는 없다.
- 상태 타입의 값은 code 정수다.
  - go: `type State int32`
  - rust: `#[repr(i32)]`
  - npm: `Object.freeze({Draft: 1})` + `.d.ts` 유니온
  - python: `IntEnum`
  - php: `enum State: int`
- `Step`의 필드는 `to: State`, `changed: bool`이다(variant 이름 없음). `Event` 값은 선언 순서 1부터의 번호다(이벤트는 저장되지 않음). 오류 코드 상수는 B-4·B-5·B-6 코드에서 `E_`를 뗀 이름을 각 언어 상수 표기로 쓴다(go `CodeConflict`, rust `Code::Conflict`, npm/php `Code.Conflict`/`Code::Conflict`, python `Code.CONFLICT`).
- 함수 시그니처는 모든 언어에서 같은 순서다: `apply(expected: State, event: Event, actual: State) → Step`, `target(expected: State, event: Event) → State`.
- php는 enum을 PSR-4(`Order/State.php`…)로, 함수는 `Order/functions.php`를 composer `autoload.files`로 싣는다. php-ext는 같은 namespace의 enum과 함수를 C로 등록한다.
- 머신이 서로 다른 모듈에 들어가므로 머신 간 식별자 충돌은 생기지 않는다. 단 php namespace와 PSR-4 디렉터리는 대소문자를 구분하지 않으므로, `_`를 지웠을 때 같아지는 두 머신 key는 `E_DUPLICATE_KEY`로 거부한다. 남는 충돌은 생성 파일·package 이름, 언어 keyword, php의 대소문자 무시 이름이며, `E_KEY_RESERVED`와 `E_DUPLICATE_KEY`의 고정 목록으로 거부한다.
- 오류는 `status.Error`로만 알리고 null을 반환하지 않는다.
- 원시 정수를 받는 함수는 `from_code` 하나다.
  - 인자는 언어의 64비트 부호 정수다(go `int64`, rust `i64`, php/python `int`. npm `number`는 double이므로 정수가 아니거나 안전 정수 범위 밖이면 `E_UNKNOWN_CODE`). 호출자는 DB 값을 좁히지 않고 그대로 넘긴다.
  - 0, 범위 밖, 미지 code는 `E_UNKNOWN_CODE`, 예약 code는 `E_RESERVED_CODE`.
- 소비자 DB의 상태 컬럼은 dbspec `i32`로 둔다.
- go/npm/python은 상태 타입에 임의 정수가 들어갈 수 있으므로, switch의 나머지 분기가 `E_UNKNOWN_CODE`를 던진다.
- 파일 헤더: `Code generated by status-gen from <machine>; DO NOT EDIT.`
