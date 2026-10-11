<!-- doc-id: spec-fsm -->
<!-- source-sha256: 3730bdb32009657af9fafab47d4d9aa673c4e9bbf5494862e77636b66564304b -->
# fsm 정의

[English](fsm.md)

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
| 상태·code | `{"key":"draft","code":1}` | `state "draft" as draft`(label)와 `draft : 1`(state description) | `state(machine, key, code, initial, final, position)` |
| initial | `"initial": true` | `[*] --> draft` | `initial` |
| final | `"final": true` | `done --> [*]` | `final` |
| 엣지 | `{"key":"next","edges":[{"from":"draft","to":"paid"},…]}` | `draft --> paid : next` | `edge(machine, event, from, to, position)` + `event(machine, key, position)` |

예시(`order`는 주문 생명주기를 뜻하는 예시 머신 key일 뿐이다):
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
- Mermaid 정규형
  - 줄 순서를 고정한다: 상태 순서대로 각 상태의 label 줄 `state "<key>" as <key>`와 description 줄 `<key> : <code>`를 이 순서로 쓰고, 이어서 initial → 이벤트 순서대로 엣지(이벤트 안에서는 엣지 순서) → final(상태 순서). 상태당 label 줄 1개와 description 줄 1개. code는 앞자리 0 없는 10진수다. label은 key 자체다. 텍스트가 key와 다른 label 줄은 거부한다.
  - 결정(S-38): 그려진 다이어그램은 각 상태의 key와 code를 보여야 한다. 고정한 mermaid 12.1.0에서 description이 하나인 상태는 그 description만 그려진다. `draft : 1`은 `1`만 그리고 key가 없다. 별칭 줄 `state "draft" as draft`는 `draft`를 상자의 제목으로 그리므로, 이 형식은 key를 제목으로, code를 description으로 그린다(label `draft`와 `1`, 파싱된 descriptions [draft, 1]). 측정: Chromium에서 mermaid 12.1.0으로, label은 svg에서, descriptions는 `getStates()`에서 읽었다.
  - 기각한 대안. 각각을 이 절의 규칙(공식 문법만, 손실 없음, 정규 텍스트 하나, 파싱과 거부가 단순, 그려진 다이어그램이 key와 code를 보임)에 대조했다:
    - `draft : draft` 다음 `draft : 1`(description 두 줄): 같은 그림이지만 제목을 정하는 문서화된 문법이 아니다. 제목은 위치로 정해지는 첫 description이라는 암묵 규칙이 되어 reader가 그 규칙을 따로 되풀이해야 한다.
    - `state "draft 1" as draft`: `draft 1`을 그리지만 code가 label의 자유 텍스트가 되어 reader가 문자열을 나눠야 하고, 위 표의 description이 아니게 된다.
    - `draft : draft 1`: `draft 1`을 그리지만 description 하나에 값 둘이 들어가 reader가 나눠야 하고, key가 제목이 아니다.
    - `draft : draft<br/>1`: 두 줄로 그리지만 description 하나에 값 둘이 들어가므로, `draft : draft 1`과 같은 이유로 기각한다.
    - `draft : 1`(이전 형식): `1`만 그린다. 요구를 충족하지 않는다.
  - 채택한 형식은 key와 code를 공식 문법의 서로 다른 줄에 둔다. 그래서 reader가 각각을 이미 있는 규칙으로 검사한다. label이 key와 다르면 `E_MERMAID_UNSUPPORTED`로 거부한다. 두 번째 이름이 다른 store에는 없는 채로 조용히 버려지기 때문이다.
  - 읽을 때 정규형 밖의 문법은 `E_MERMAID_UNSUPPORTED{line}`로 거부한다. 복합 상태, note, fork/join, choice, 스타일, 주석, 순서 위반, key와 다른 label이 해당된다. 조용히 무시하지 않는다.
- 순서 규칙
  - 상태 순서와 이벤트 순서는 선언 순서다. 순서는 `events_from`과 생성 순서에 쓰인다.
  - code와 선언 순서는 서로 독립이다.
- 엣지는 쌍이 아니라 객체 `{from, to}`다. 객체는 필드에 이름이 있어 에디터 schema가 kit `schema-validate.mjs`의 키워드(최대 원소 수가 없다)만으로 정확히 검사하고, GUI 폼은 from과 to 필드를 가진 행으로 편집한다.
- IR = `δ: (state, event) → to`.
- code 범위는 `1..2147483647`(모든 타깃에서 같은 32비트 범위)이다. 0은 미설정이다.
- `schema/fsm.schema.json`은 에디터용이며 kit `schema-validate.mjs`가 지원하는 키워드만 쓴다. 판정 권위는 core validate다.

## B-2. 저장소 3종, 규칙 1개
- core는 정의를 **객체**로만 다룬다(validate → normalize → emit). store는 객체 ↔ 매체 변환만 한다.

| store | 정의 | lock | 패키지 |
|---|---|---|---|
| `json` | `machines/*.fsm.json` | `fsm.lock.json` | fsm-compiler |
| `mermaid` | `machines/*.fsm.mmd` | `fsm.lock.json` | fsm-compiler |
| `db` | orm 정의 테이블 | orm lock 테이블 | fsm-db |

- store 계약은 `{load() → Promise<{definitions, lock, baseline, findings}>, save({definitions, lock}) → Promise}`, `baseline`은 커밋된 lock이다(B-3)이다. DB store의 orm client가 비동기이므로 store 계약, `run`, `copy`는 비동기이고, 순수 함수(validate, normalize, lock, vectors)는 동기로 남아 GUI가 직접 호출한다.
  - store는 변환과 원자적 쓰기만 하고 검증하지 않는다.
  - 쓰기: json·mermaid는 파일별 임시파일+rename(파일 단위 원자성만), db는 한 transaction 안에서 전체 교체. 파일 store가 중간에 중단되면 다음 `gen`/`vectors`/`check`가 `E_LOCK_MISMATCH`로 드러내고 복구는 git으로 한다.
- 명령(`lock`, `save`, `gen`, `vectors`, `check`)은 core `run(command, store, options)` 하나로 실행한다(비동기, Promise를 돌려준다).
  - `save`(GUI 저장, 저장 1회에 머신 1개)와 `lock`은 새 정의가 `E_LOCK_MISMATCH`를 뺀 B-5의 모든 규칙을 통과하고, 저장된 lock과 새 정의 사이에서 lock 규칙을 통과한 뒤에만 `store.save`를 한 번 부른다. 쓰는 lock은 새 정의에서 만들므로 정의와 항상 일치한다.
- 원본 store는 프로젝트 루트의 `fsm.config.json` 하나가 정한다.
  - 형식: `{"store":"json"|"mermaid"}` 또는 `{"store":"db","dsnEnv":"FSM_DSN"}`
  - fsm-gen, fsm-db, fsm-gui는 이 파일을 읽는다. 설정된 store를 그 도구가 다루지 못하면(예: fsm-gen + `db`) `E_STORE_NOT_CONFIGURED`.
  - `machines/`에 설정과 다른 형식의 파일이 있으면 `E_STORE_MIXED`.
- `copy(from, to)`는 `run` 밖의 비동기 core 이관 함수다(`await to.save(await from.load())`). fsm-db CLI는 `copy --to json|mermaid --root <dir>`(database가 원본)와 `copy --from json|mermaid --root <dir>`(database가 대상)이며, 대상 루트에 `machines/`나 `fsm.lock.json`(db면 정의·lock 행), 또는 커밋된 `fsm.lock.json`(git HEAD)이 있으면 `E_STORE_NOT_EMPTY`.
  - fsm-gen은 json↔mermaid 이관을 제공한다(계획 C-5의 import 집합 유지).
  - fsm-db는 db↔json/mermaid 이관과 schema 설치를 제공한다. 명령은 `install`, `check`, `lock`, `copy`이며, usage·종료 코드·예시는 `packages/fsm-db/README.ko.md`에 있다.
    - `install [--project <dir>]`은 orm `utils().schema().install`로 `schema/fsm.dbs`의 여섯 table을 설치한다. table이 없는 database에서는 table을 만들고 `[fsm-db] install: ok`를 출력한다. 여섯 table이 모두 있는 database에서는 아무것도 바꾸지 않고 같은 줄을 출력한다. 이는 orm v0.0.7의 관찰된 동작이며 `packages/fsm-db/tests/cli.test.mjs`가 검증한다. table이 일부만 있는 database에서는 orm이 install을 `CONFIG`로 거부하고, 명령은 오류를 stack과 함께 출력한 뒤 종료 코드 1로 끝난다. 대체 동작(fallback)은 없다.
    - table이 없는 database에서 `check`, `lock`, `copy`는 orm의 `no such table` 오류를 stack과 함께 출력하고 종료 코드 1로 끝난다. `install`만 table을 만든다.
    - `lock [--project <dir>] [--rename machine.old=new]...`은 database에 core `run lock`을 실행한다. 이름을 바꾼 state는 code를 유지한다.
    - DSN은 `fsm.config.json`의 `dsnEnv`가 가리키는 환경 변수의 값이다. fsm-db는 다른 곳에서 DSN을 읽지 않는다.
    - `--project`의 기본값은 현재 디렉터리다. usage 오류는 종료 코드 2로 끝난다.
  - 이관 뒤 `fsm.config.json`을 바꾸는 것은 사람이 결정한다.
- 규칙이 하나라는 것은 store 계약 테스트로 강제한다. 테스트는 `packages/fsm-db/tests/store-contract-all.test.mjs`에 있으며, 컴파일러에 의존하는 쪽인 fsm-db 패키지가 소유하고 `make db-test`에서 실행한다.
  - `packages/fsm-compiler/tests/fixtures/valid`의 모든 valid fixture(각각, 그리고 전부 함께)를 json → db → mermaid → json으로 왕복시켰을 때 파일을 바이트로 비교해 바이트 동일해야 한다.
  - 세 store에서 `run`한 결과가 바이트 동일해야 한다. 모든 kind의 `gen`(필수 옵션 포함: go는 `goModule`, php와 php-ext는 `phpNamespace`, php-ext는 `phpExtName`)과 `vectors`, 그리고 모든 kind의 vectors 파일을 포함한다.
  - 필드를 떨어뜨리는 store(예: `final`)는 이 케이스들에 실패한다. core가 왕복을 거부하거나 바이트가 달라진다.

- dialect(S-37): db store는 SQLite에서 모든 테스트를 받는다(`make db-test`). 그 store 테스트는 PostgreSQL 17과 MySQL 8.4에서도 돈다(`make db-test-postgres`, `make db-test-mysql`, 계획 C-6). DSN 형식은 `packages/fsm-db/README.ko.md`의 orm 형식이다.

## B-3. code 불변 (lock)
- code는 정체성이고 key는 이름이다. 배포된 code는 의미를 바꾸거나 재사용할 수 없다.
- lock = `{machine: {codes: {code: key}, reserved: [code…]}}`. lock은 `lock`(손으로 편집한 정의용), `save`(GUI), `copy`(원본을 B-5 전 규칙으로 검증한 뒤 원본 lock을 그대로 쓴다)만 갱신한다. `lock`과 `save`는 같은 lock 규칙(`E_CODE_REUSED`, `E_CODE_KEY_CHANGED`, `E_CODE_CHANGED`, `E_LOCK_REGRESSED`, 사라진 code → reserved)을 적용하고, 셋 모두 정의와 lock을 같은 `store.save`로 쓴다.
- `lock`이 거부하는 경우
  - `E_CODE_REUSED`: reserved code 재사용
  - `E_CODE_KEY_CHANGED`: 기존 code의 key 변경. 이름 변경은 `lock --rename m.old=new`로만 하며, 정의와 lock을 함께 바꾼다.
  - `E_CODE_CHANGED`: lock이 code에 대응시킨 key를 정의가 다른 code로 주는 경우. 삭제 후 다시 추가한 key도 lock이 아직 대응시키고 있으면 포함한다. 메시지는 lock이 가진 code를 밝히며, released code는 절대 바뀌지 않는다. lock에 reserved 이력으로만 남은 key는 비교할 code가 없다(reserved에는 code만 있다).
  - `E_LOCK_REGRESSED`: 쓸 lock이 커밋된 code를 잃거나 바꾼다(아래 기준선).
- 기준선(커밋된 lock): 모든 store의 `load()`는 커밋된 lock을 `baseline`으로 돌려주고, 모든 명령은 자기 lock을 이 기준선과 비교한다.
  - json, mermaid: git HEAD의 `fsm.lock.json`. 프로젝트 디렉터리에서 `git show HEAD:./fsm.lock.json`으로 읽는다.
  - db: `load`가 읽는 lock 테이블의 행, 명령이 쓰기 전의 행이다.
  - 커밋된 것이 없으면 기준선은 빈 lock이다: 프로젝트 디렉터리가 아직 없거나, git 작업 트리 밖이거나, 저장소에 commit이 없거나, `fsm.lock.json`이 HEAD에 추적되지 않을 때(추적되지 않았거나 무시된 파일). 이때 lock 규칙은 저장된 lock만 판정한다. git 밖에서는 이것이 유일한 보호다. git이 없는 프로젝트는 이 절의 릴리스 보호를 받지 못한다(S-30의 결정이며 소유자가 확인한다).
  - 커밋된 `fsm.lock.json`을 읽을 수 없으면 그 자체가 finding(`E_SCHEMA`)이며 모든 명령을 멈춘다. 빈 기준선으로 대신하지 않는다. git의 다른 실패는 빈 기준선이 아니라 오류로 명령을 멈춘다.
- `E_LOCK_REGRESSED`: 명령이 유지할 lock(`lock`과 `save`는 쓸 lock, `check`, `gen`, `vectors`, `copy`는 저장된 lock)을 기준선과 비교한다. 머신의 커밋된 code는 세 규칙으로 판정하며, 위반마다 finding 하나를 낸다(규칙 1은 경로 `$.reserved`, 규칙 2와 3은 `$.codes`).
  1. 커밋된 reserved code는 reserved로 남는다: 상태에 주지 않으며 `reserved`에서 빼지 않는다.
  2. 커밋된 code는 key와 함께 code로 남거나, 상태가 정의에서 사라져 `reserved`로 옮겨진다. 절대 지우지 않는다.
  3. 커밋된 key가 아직 `codes`의 key이면 커밋된 code를 유지해야 한다. 그래서 다른 code로 옮겨진 key(swap)는 거부한다. `codes`에서 key가 사라졌지만 code가 남은 경우는 이름 변경이며 거부하지 않는다.
- 따라서 이름 변경은 커밋 전에도 모든 명령이 받아들인다: code는 유지하고 옛 key만 빠지며, 커밋이 그 변경을 기록한다. 커밋된 code의 상실이나 swap은 `lock --rename`을 포함한 모든 명령이 되돌릴 때까지 거부한다. 머신 전체가 사라지면 그 code는 reserved(규칙 2)와 lock 항목에 남는다(아래 참고).
- 복구: `lock`은 저장된 lock이 정의와 맞지 않을 때 쓰는 lock이 커밋된 code를 모두 유지할 때만 복구한다(규칙 1~3). 그래서 삭제되거나 비워진 lock은 정의가 커밋된 code를 유지하면 정의에서 복구되고, 유지하지 않으면 `E_LOCK_REGRESSED`로 거부된다.
- 정의에서 사라진 상태의 code는 reserved로 옮긴다. 머신 전체가 사라지면 그 code를 모두 그 머신의 reserved로 옮기고 lock 항목은 남긴다(DB lock 테이블에 machine FK가 없다, 계획 C-6).
- `gen`/`vectors`/`check`는 다음을 만족하지 않으면 `E_LOCK_MISMATCH`: 정의된 머신마다 lock `codes`가 그 상태들의 `{code: key}`와 같고 `reserved`가 그 code와 겹치지 않는다. 정의에 없는 lock 머신은 `codes`가 비어 있다. 저장된 lock이 커밋된 code를 잃거나 바꾸면(규칙 1~3) `E_LOCK_REGRESSED`.
- db store: 기준선이 저장된 행이므로, 위의 저장된 lock 규칙(`E_CODE_REUSED`, `E_CODE_KEY_CHANGED`, `E_CODE_CHANGED`)이 명령이 쓸 수 있는 모든 변경을 이미 거부하고, 명령을 통해서는 `E_LOCK_REGRESSED`가 나오지 않는다. fsm 밖(SQL)에서 바뀌거나 지워진 행은 명령이 비교할 기록이 없어 감지하지 못한다. 데이터베이스의 커밋 기록은 이 버전에 없으며, 계획에서 결정해야 한다.
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

- Rust(S-31): transaction은 orm `db.transaction`이다. 이는 orm v0.0.7의 재시도 transaction이며(deadlock이면 콜백을 다시 실행하고, 기본은 세 번이다), 한 번만 실행하는 `transaction_once`가 아니다. rust 콜백은 `Fn`이다. `decide`는 machine 오류를 값으로 돌려준다(`Failure::Machine`). `transaction`의 콜백은 orm 오류로만 실패하고, machine 오류는 어떤 쓰기보다 먼저 나므로 transaction은 아무것도 커밋하지 않는다. 재실행은 `persist_runs_again_on_a_deadlock`(`packages/fsm-rust/tests/persist_retry.rs` (`make rust-persist-test`))이 증명한다. 첫 시도의 DEADLOCK이 콜백을 두 번째로 실행한다. deadlock이 아닌 데이터베이스 오류는 한 번 시도한 뒤 돌려준다(`persist_does_not_run_again_on_another_error`). orm v0.0.7에 재시도가 있으므로 layout.json에 차이를 적지 않는다.
- transaction + `forUpdate()`를 쓰고 조건부 문 하나(`UPDATE … SET <status column> = to WHERE id = x AND <status column> = expected`, 영향 행 수가 1일 때 승인)를 쓰지 않는 이유: orm v0.0.7의 공개 model API에는 그런 update가 없다. model `update`는 바뀐 열을 기본 키로 한 행에 쓴다(`packages/orm-rust/orm/src/model.rs`, `update`, 약 1067행). 그 유일한 조건은 갱신 시각 열의 optimistic 검사인 `update(true)`이고(`docs/dsl.md`), 쓰기는 영향 행 수를 호출자에게 돌려주지 않는다. 수는 그 검사를 위해서만 읽힌다(`model.rs` 약 858–862행). 내부 catalog는 행 수를 센다(`packages/orm-rust/orm-build/src/catalog/mutation.rs`, 약 201–204행). 그러나 공개 호출 중 수를 돌려주는 것은 없다. 그래서 잠금을 쓴다.
- orm이 술어가 status column을 이름 짓고 영향 행 수를 호출자에게 돌려주는 update를 공개하면 이 규칙을 다시 본다. 그때 조건부 문 하나가 잠금을 대신하며, 이 절은 같은 항목에서 바뀐다.

- dialect(S-37): 모든 kind는 패턴을 SQLite에서 테스트한다. npm은 동시성과 persist case를 PostgreSQL과 MySQL에서도 실행한다(`make npm-persist-test-postgres`, `make npm-persist-test-mysql`, 계획 C-4). `forUpdate()`가 없으면 같은 (expected, event)의 두 전이가 두 서버 모두에서 Changed를 보고하므로, 이 테스트가 잠금을 증명한다.

## B-5. 검증 규칙 (오류 코드 1개 = RED 케이스 1개, warning 없음)
- finding: core `validate(definitions)`는 모든 finding을 `{code, machine, path, message}`로 돌려준다. `path`는 머신 객체 안의 JSON 경로(`$.states[1].code`), `machine`은 그 key이며, 정의에 문자열 key가 없으면 null이다. finding은 머신 안에서는 문서 순서, 머신 사이에서는 입력 순서를 따른다. `E_SCHEMA` finding이 있는 머신은 다른 finding을 받지 않는다. GUI는 `path`를 폼 필드에 연결하고, 필드가 없는 finding은 폼 오류로 보인다.
- 구조
  - `E_SCHEMA`: 필수 필드 누락, 미지 필드, 타입 위반, 빈 `edges`(이벤트는 엣지 1개 이상), 파일 이름 ≠ `<machine>.fsm.json|mmd` (JSON 경로 포함)
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
  - `E_KEY_RESERVED`: `docs/spec/fsm.md`의 고정 목록 하나이며 kind·store와 무관하게 모든 정의에 적용한다. (1) 머신 key(`_`를 지우고 비교): `fsm`(공용 모듈), `index`(npm `index.js`), `lib`·`main`(rust `src/lib.rs`·`src/main.rs`, go `package main`), `internal`(go internal package는 `tests/`에서 import할 수 없음), `init`(go는 `init`라는 이름으로 package를 import하지 못함), `testdata`·`vendor`(go `./...`가 건너뜀), go 사전 선언 식별자(`error`, `string`, `int`, `len`, `nil` 등. 그 이름의 package를 import하면 이를 가린다), go·rust(고정 edition)·python·js의 keyword(이 네 언어에서는 머신 key가 그대로 모듈 이름이다), 그리고 go test 파일이 import하거나 선언하는 이름인 `examples`(`tests/vectors_test.go`가 persist 예제를 import하는 이름), `vectors`와 `machines`(그 package 변수), `expectation`과 `lookup`(`tests/conformance_test.go`가 선언)이다. S-39 측정(go 1.27.2)에서 이 다섯 key는 각각 `go test ./...`에 "redeclared in this block" 또는 "already declared through import" 오류를 내며, `tests`(같은 이름의 go test package)는 통과하므로 예약하지 않는다. go test 파일은 생성 파일(`fsm-gen vectors`)이므로 목록도 그 파일을 따른다. 파일의 import나 package 수준 이름이 바뀌면 이 목록도 바꾼다. (2) pascal 형태가 enum 멤버로 거부되는 상태·이벤트 key: `self`(rust `Self`), `class`(php `Class`). (3) Mermaid 예약어(store와 무관하게 항상 적용): 상태 key `note, class, classdef, style, click, href, default, state, statediagram, scale, acctitle, accdescr, root_start, root_end`; 머신 key `null, true, false`(고정한 mermaid 버전 12.1.0 기준). S-16 테스트(`packages/fsm-gui/tests/mermaid-parse.test.mjs`)는 상태 key를 여섯 위치(label 줄 앞의 설명 줄, 초기 줄, edge의 출발, edge의 도착, 최종 줄, 첫 상태의 label 줄)에서 검사한다. 단어는 그 위치에서 mermaid가 다이어그램을 파싱하지 못하거나, 쓴 모델과 다른 모델로 파싱할 때 쓸 수 없다. 다른 모델은 `[*]` id와 충돌하는 id(`root_start`, `root_end`)이거나, mermaid가 버리는 줄이나 code다(설명 줄의 `state`, 설명 줄과 초기 줄의 `acctitle`·`accdescr`). S-38에서 label 줄을 넣고 다시 잰 결과(mermaid 12.1.0, B-1의 정규형)도 목록을 바꾸지 않는다. 위 14개 단어는 여섯 위치 모두에서 쓸 수 없고, 테스트가 고른 일반 단어는 그 위치에서 그대로 파싱된다. label 줄만으로도 14개 단어 각각이 id와 description으로 남는다(다른 줄이 그 단어를 쓰지 않는 `state "note" as note`는 id `note`와 description `note`를 준다). 그러므로 label 줄은 예약어를 더하지 않는다. 머신 단어는 mermaid의 stateDiagram이 frontmatter title을 읽지 않으므로 frontmatter의 YAML 규칙으로 검사한다. 이름은 변형하지 않고 거부한다.
- code·lock
  - `E_DUPLICATE_CODE`, `E_CODE_RANGE`, `E_UNKNOWN_STATE_REF`, `E_LOCK_MISMATCH`, `E_CODE_REUSED`, `E_CODE_KEY_CHANGED`, `E_CODE_CHANGED`, `E_LOCK_REGRESSED`
- store
  - `E_MERMAID_UNSUPPORTED`, `E_STORE_MIXED`, `E_STORE_NOT_EMPTY`, `E_STORE_NOT_CONFIGURED`
- 생성
  - `E_NOT_GENERATED`: `gen`이나 `vectors --kind`가 출력 디렉터리에서 생성 헤더가 없는 파일을 찾음. 아무것도 쓰거나 지우지 않는다. 생성기는 자기가 쓴 파일만 바꾸므로, 손으로 쓴 파일을 덮어쓰거나 지우지 않는다. 출력 디렉터리의 git-ignored 파일은 건너뛴다. 손으로 쓴 파일이 아니라 빌드 출력이기 때문이다(git work tree 밖에서는 무시되는 파일이 없다).

## B-6. 이름 규칙 (언어 공통 규칙 1개 + 언어별 표기 변환표)
이 문서의 `order`는 예시 머신 key(주문 생명주기)다. 생성 이름은 모두 아래 규칙에서 기계적으로 나오고, 접미사나 절충 이름(`OrderMachine`, `OrderFsm`)은 없다.

**공통 규칙: 머신 1개 = 모듈 1개**
- 모듈 이름 = 머신 key.
- 모듈 안 이름은 모든 언어에서 같다.
  - 타입: `State`(상태 enum), `Event`(이벤트 enum), `Step`(apply 결과)
  - 멤버: 상태·이벤트 key
  - 함수: `initial`, `code`, `key`, `from_code`, `is_final`, `events_from`, `target`, `apply`(= features.json id)
- 공용 모듈 `fsm`에는 타입 `Error`(필드 `code`, `expected`, `actual`, `event`)와 오류 코드 상수가 있다. 그래서 머신 key `fsm`는 예약이다(`E_KEY_RESERVED`).
- 언어별 차이는 아래 표의 **표기 변환**뿐이다. 변환 함수 4개만 쓴다: `snake`(그대로), `pascal`, `camel`, `upper`. key 형식(`E_KEY_FORMAT`)상 네 함수는 모두 1:1이다.

| 개념 | go | rust | npm | python | php / php-ext |
|---|---|---|---|---|---|
| 모듈 | package `order`(`src/order/`) | `mod order` | `order.js` | module `order` | namespace `<ns>\Order` (pascal) |
| 타입 | `State` `Event` `Step` | 동일 | 동일 | 동일 | 동일 |
| 상태 멤버 | `StateDraft` (pascal, scoped enum이 없어 타입명 접두) | `State::Draft` | `State.Draft` | `State.DRAFT` (upper) | `State::Draft` |
| 이벤트 멤버 | `EventNext` | `Event::Next` | `Event.Next` | `Event.NEXT` | `Event::Next` |
| 함수 | `Apply`, `FromCode` (pascal, export 강제) | `apply`, `from_code` (snake) | `apply`, `fromCode` (camel) | `apply`, `from_code` (snake) | `apply`, `fromCode` (camel, namespace 함수) |
| 함수 호출 | `order.Apply(…)` | `order::apply(…)` | `order.apply(…)` | `order.apply(…)` | `Order\apply(…)` |
| 오류 | `fsm.Error` | `fsm::Error` | `fsm.Error` | `fsm.Error` | `<ns>\Fsm\Error` |

- 표기 변환은 polyspec orm의 생성 API 표기(PHP/TS camel, Go pascal, Rust/Python snake)와 같고, 각 언어의 공식 표기 관례를 따른다. 위 표 외의 예외는 없다.
- 상태 타입의 값은 code 정수다.
  - go: `type State int32`
  - rust: `#[repr(i32)]`
  - npm: `Object.freeze({Draft: 1})` + `.d.ts` 유니온
  - python: `IntEnum`
  - php: `enum State: int`
  - 이벤트가 없는 머신의 `Event`는 표현을 갖지 않는다. rust는 빈 enum `pub enum Event {}`에서 `#[repr(i32)]`를 생략한다. rustc가 variant가 없는 enum의 표현을 거부하기 때문이다(E0084). 이벤트가 있는 머신은 `#[repr(i32)]`를 유지한다.
- `Step`의 필드는 `to: State`, `changed: bool`이다(variant 이름 없음). `Event` 값은 선언 순서 1부터의 번호다(이벤트는 저장되지 않음). 오류 코드 상수는 생성된 함수가 던지는 네 코드뿐이다: `E_CONFLICT`, `E_INVALID_TRANSITION`, `E_UNKNOWN_CODE`, `E_RESERVED_CODE`. 각각 `E_`를 뗀 이름을 언어의 상수 표기로 쓴다(go `CodeConflict`, rust `Code::Conflict`, npm/php `Code.Conflict`/`Code::Conflict`, python `Code.CONFLICT`). B-4에서 B-6까지의 나머지 코드(B-5의 finding, lock과 store의 코드)는 컴파일러와 store의 finding이며, 생성된 코드에는 상수가 없다.
- 함수 시그니처는 모든 언어에서 같은 순서다: `apply(expected: State, event: Event, actual: State) → Step`, `target(expected: State, event: Event) → State`.
- php는 enum을 PSR-4(`Order/State.php`…)로, 함수는 적재기 `functions.php`를 composer `autoload.files`로 싣고, 적재기가 모든 machine의 `Order/functions.php`를 require한다(PSR-4는 함수를 싣지 못하므로 composer는 적재기만 이름으로 든다). php-ext는 같은 namespace의 enum과 함수를 C로 등록하며, 모든 C 이름은 php namespace와 extension 이름에서 유도된다: include `php_<ext>.h`와 `<ext>_arginfo.h`, Error 클래스 심볼 `<namespace의 \를 _로 바꾼 것>_Fsm_Error`(`Acme\Tool`은 `Acme_Tool_Fsm_Error`).
- 머신이 서로 다른 모듈에 들어가므로 머신 간 식별자 충돌은 생기지 않는다. 단 php namespace와 PSR-4 디렉터리는 대소문자를 구분하지 않으므로, `_`를 지웠을 때 같아지는 두 머신 key는 `E_DUPLICATE_KEY`로 거부한다. 남는 충돌은 생성 파일·package 이름, 언어 keyword, php의 대소문자 무시 이름이며, `E_KEY_RESERVED`와 `E_DUPLICATE_KEY`의 고정 목록으로 거부한다.
- 오류는 `fsm.Error`로만 알리고 null을 반환하지 않는다.
- 원시 값을 받는 함수는 `from_code` 하나다.
  - 인자는 언어의 64비트 부호 정수다(go `int64`, rust `i64`. npm `number`는 double이므로 정수가 아니거나 안전 정수 범위 밖이면 `E_UNKNOWN_CODE`. php는 `mixed`, python은 `int`로 선언한다. 아래 참고). 호출자는 DB 값을 좁히지 않고 그대로 넘긴다.
  - php와 python은 호출자와 무관하게 정수가 아닌 값을 거부한다. 문자열, bool, float, null은 `E_UNKNOWN_CODE`이며 변환된 code가 되지 않는다. php는 `is_int`로 검사한다. 생성 파일의 `declare(strict_types=1)`은 그 선언을 하지 않은 호출자의 호출에 닿지 않고, 변환하면 `"2"`나 `2.0`은 2의 상태가, `true`는 1의 상태가 되기 때문이다. php 메시지는 값 대신 타입을 말한다(`a value of type string`). 배열은 출력할 수 없기 때문이다. python 메시지는 값을 말한다. vector는 정수가 아닌 입력(`input_type`: string, bool, float)을 그것을 담을 수 있는 kind(php, php-ext, python, 정수가 아닌 분수는 npm도)에만 준다. php-ext 확장은 정수를 읽기 전에 zval의 타입을 검사한다.
  - 0, 범위 밖, 미지 code는 `E_UNKNOWN_CODE`, 예약 code는 `E_RESERVED_CODE`.
- 소비자 DB의 상태 컬럼은 dbspec `i32`로 둔다.
- go/npm/python은 상태 타입에 임의 정수가 들어갈 수 있으므로, switch의 나머지 분기가 `E_UNKNOWN_CODE`를 던진다. rust와 php는 그런 값이 없으므로(상태가 enum이다), 잘못된 상태 값은 go, npm, python에만 준다(계획 C-4).
- `fsm.Error`의 필드(`code`, `expected`, `actual`, `event`)는 B-4와 이 목록이 말하는 대로 설정되며, 다른 필드는 없다:
  - `E_CONFLICT`는 `expected`와 `actual`(state code)과 `event`(event 값, 1부터의 위치)를 설정한다.
  - `E_INVALID_TRANSITION`은 `expected`와 `event`를 설정하고, `actual`은 없다.
  - `E_UNKNOWN_CODE`와 `E_RESERVED_CODE`는 필드를 설정하지 않는다. 값은 메시지에 있다.
  - 없는 필드는 vector에서 null, npm에서 `undefined`, python에서 `None`, php에서 null, rust에서 `None`, go에서는 0 값이다(state code와 event 위치는 0이 아니다).
- 파일 헤더: `Code generated by fsm-gen from <machine>; DO NOT EDIT.`
