<!-- doc-id: plan-status-v1 -->
<!-- source-sha256: 06469ea6b6681addb6bc8f1c01332bdb6bdf42a16bd5d09c63f38eaebbcb9f49 -->
# status v1 계획

[English](status-v1.md)

## Context
- 상태를 정수 code로 저장한다(key = value). 이벤트 전이는 **멱등하고 결정적으로** 처리한다. 이 규칙을 6개 타깃(go, npm(js+d.ts), php, php-ext, python, rust)에서 똑같이 쓴다.
- 결과물은 언어별 gen 파일이다. 런타임 파싱은 없고, 생성 코드는 런타임 의존성이 없다.
- 정의 저장소는 **JSON, Mermaid `stateDiagram-v2`, DB(orm)** 세 개이며 모두 1급이다. 규칙(검증·lock·생성)은 compiler core 하나다.
- 모델은 세 매체가 **공식 문법만으로** 손실 없이 담을 수 있을 만큼 단순하게 설계한다. 매체가 담지 못하는 부분이 생기면 모델이 과하다는 신호로 본다.
- 도구는 다음을 쓴다: GUI는 hyper(Node 서버), CRUD 화면은 crudui, DB 접근은 orm.
- `status/`에는 이 계획(`docs/plans/status-v1.md(.ko)`)만 있고 git 저장소가 아니다. S-01이 kit 채택과 함께 이 계획을 커밋한다. kit를 채택한다.
- 언어 패키지 6개는 폴더 구조가 동일하다. 언어 특성 차이만 `contracts/layout.json`에 명시해서 허용한다.
- 언어 패키지는 배포 라이브러리가 아니라 소비자 입장의 검증대다.
- 확정 사항
  - 값 모델 = enum만(bit flag 없음)
  - 전이 = 명시적 그래프
  - 런타임 = 생성 코드만
- 원칙: 기준은 **도구로 강제**한다. 레이아웃, 기능↔테스트 대응, 언어 간 동등성 판정은 RED 테스트를 가진 검사 도구가 한다.

## 0. 범위 확정 (감사와 구현의 유일한 판정 기준)

**요구 R1~R10 (이 목록만이 v1 범위다)**

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
    - compiler → `packages/status-compiler/tests`
    - DB store → `packages/status-db/tests`
    - GUI → `packages/status-gui/tests`
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
  - 브랜치나 워크트리를 쓸 때는 `{type}/{shortname}-{id}` / `status-{shortname}-{id}`로 만들고, 병합하는 즉시 삭제한다.
  - 실험 코드는 커밋 전에 제거한다. 바로 제거할 수 없으면 하위 항목에 제거 조건을 적는다.

## B. 상태 머신 정의 (`docs/spec/status.md`에 고정)

### B-0. 채택 판정
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

### B-1. 정의 모델
정의는 세 가지로만 이루어진다.
- 머신 이름
- 상태: key, code, initial, final
- 이벤트: key, 엣지 목록 `[from, to]…`

| 개념 | JSON | Mermaid(공식 문법) | DB(orm) |
|---|---|---|---|
| 머신 | `"machine": "order"` | frontmatter `title: order` | `machine(name)` |
| 상태·code | `{"key":"draft","code":1}` | `draft : 1` (state description) | `state(machine, key, code, initial, final, position)` |
| initial | `"initial": true` | `[*] --> draft` | `initial` |
| final | `"final": true` | `done --> [*]` | `final` |
| 엣지 | `{"key":"next","edges":[["draft","paid"],…]}` | `draft --> paid : next` | `edge(machine, event, from, to, position)` + `event(machine, key, position)` |

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
    { "key": "next",   "edges": [["draft", "paid"], ["paid", "shipped"], ["shipped", "done"]] },
    { "key": "prev",   "edges": [["paid", "draft"], ["shipped", "paid"]] },
    { "key": "cancel", "edges": [["draft", "canceled"], ["paid", "canceled"]] }
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
- IR = `δ: (state, event) → to`.
- code 범위는 `1..2147483647`(모든 타깃에서 같은 32비트 범위)이다. 0은 미설정이다.
- `schema/status.schema.json`은 에디터용이며 kit `schema-validate.mjs`가 지원하는 키워드만 쓴다. 판정 권위는 core validate다.

### B-2. 저장소 3종, 규칙 1개
- core는 정의를 **객체**로만 다룬다(validate → normalize → emit). store는 객체 ↔ 매체 변환만 한다.

| store | 정의 | lock | 패키지 |
|---|---|---|---|
| `json` | `machines/*.status.json` | `status.lock.json` | status-compiler |
| `mermaid` | `machines/*.status.mmd` | `status.lock.json` | status-compiler |
| `db` | orm 정의 테이블 | orm lock 테이블 | status-db |

- store 계약은 `{load() → {definitions, lock}, save({definitions, lock})}`이다.
  - store는 변환과 원자적 쓰기만 하고 검증하지 않는다.
  - 쓰기: json·mermaid는 파일별 임시파일+rename(파일 단위 원자성만), db는 한 transaction 안에서 전체 교체. 파일 store가 중간에 중단되면 다음 `gen`/`vectors`/`check`가 `E_LOCK_MISMATCH`로 드러내고 복구는 git으로 한다.
- 명령(`lock`, `save`, `gen`, `vectors`, `check`)은 core `run(command, store, options)` 하나로 실행한다.
  - `save`(GUI 저장, 저장 1회에 머신 1개)와 `lock`은 새 정의가 `E_LOCK_MISMATCH`를 뺀 B-5의 모든 규칙을 통과하고, 저장된 lock과 새 정의 사이에서 lock 규칙을 통과한 뒤에만 `store.save`를 한 번 부른다. 쓰는 lock은 새 정의에서 만들므로 정의와 항상 일치한다.
- 원본 store는 프로젝트 루트의 `status.config.json` 하나가 정한다.
  - 형식: `{"store":"json"|"mermaid"}` 또는 `{"store":"db","dsnEnv":"STATUS_DSN"}`
  - status-gen, status-db, status-gui는 이 파일을 읽는다. 설정된 store를 그 도구가 다루지 못하면(예: status-gen + `db`) `E_STORE_NOT_CONFIGURED`.
  - `machines/`에 설정과 다른 형식의 파일이 있으면 `E_STORE_MIXED`.
- `copy(from, to)`는 `run` 밖의 core 이관 함수다(`to.save(from.load())`). CLI는 `copy --to json|mermaid --root <dir>` 또는 `copy --to db`(DSN은 `--dsn-env`가 가리키는 환경 변수)이며, 대상 루트에 `machines/`나 `status.lock.json`(db면 정의·lock 행)이 있으면 `E_STORE_NOT_EMPTY`.
  - status-gen은 json↔mermaid 이관을 제공한다(의존성 0 유지).
  - status-db는 db↔json/mermaid 이관을 제공한다.
  - 이관 뒤 `status.config.json`을 바꾸는 것은 사람이 결정한다.
- 규칙이 하나라는 것은 store 계약 테스트로 강제한다.
  - 모든 fixture를 json → db → mermaid → json으로 왕복시켰을 때 바이트 동일해야 한다.
  - 세 store에서 `run`한 결과가 바이트 동일해야 한다.

### B-3. code 불변 (lock)
- code는 정체성이고 key는 이름이다. 배포된 code는 의미를 바꾸거나 재사용할 수 없다.
- lock = `{machine: {codes: {code: key}, reserved: [code…]}}`. lock은 `lock`(손으로 편집한 정의용), `save`(GUI), `copy`(원본을 B-5 전 규칙으로 검증한 뒤 원본 lock을 그대로 쓴다)만 갱신한다. `lock`과 `save`는 같은 lock 규칙(`E_CODE_REUSED`, `E_CODE_KEY_CHANGED`, 사라진 code → reserved)을 적용하고, 셋 모두 정의와 lock을 같은 `store.save`로 쓴다.
- `lock`이 거부하는 경우
  - `E_CODE_REUSED`: reserved code 재사용
  - `E_CODE_KEY_CHANGED`: 기존 code의 key 변경. 이름 변경은 `lock --rename m.old=new`로만 하며, 정의와 lock을 함께 바꾼다.
- 정의에서 사라진 상태의 code는 reserved로 옮긴다. 머신 전체가 사라지면 그 code를 모두 그 머신의 reserved로 옮기고 lock 항목은 남긴다(C-6).
- `gen`/`vectors`/`check`는 다음을 만족하지 않으면 `E_LOCK_MISMATCH`: 정의된 머신마다 lock `codes`가 그 상태들의 `{code: key}`와 같고 `reserved`가 그 code와 겹치지 않는다. 정의에 없는 lock 머신은 `codes`가 비어 있다.
- 새 code의 기본값은 core `nextCode(machine, definitions, lock)` = max(정의 ∪ lock codes ∪ reserved)+1이다. 범위를 넘으면 `E_CODE_RANGE`. GUI는 이 값을 제안만 하고 규칙을 갖지 않는다.
- 새 레코드는 `initial`로만 시작한다. 삭제된 상태의 데이터 이관은 소비자 DB 작업이다.

### B-4. 전이 의미론 (멱등성)
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

### B-5. 검증 규칙 (오류 코드 1개 = RED 케이스 1개, warning 없음)
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
  - `E_KEY_FORMAT`: 머신·상태·이벤트 key가 `^[a-z][a-z0-9]*(_[a-z][a-z0-9]*)*$`가 아님
  - `E_DUPLICATE_KEY`: 머신 key 중복, 한 머신 안의 상태 key 중복·이벤트 key 중복, 또는 `_`를 지웠을 때 같아지는 두 머신 key(`ab`와 `a_b`는 모두 php `<ns>\Ab`가 된다)
  - `E_KEY_RESERVED`: `docs/spec/status.md`의 고정 목록 하나이며 kind·store와 무관하게 모든 정의에 적용한다. (1) 머신 key(`_`를 지우고 비교): `status`(공용 모듈), `index`(npm `index.js`), `lib`·`main`(rust `src/lib.rs`·`src/main.rs`, go `package main`), `internal`(go internal package는 `tests/`에서 import할 수 없음), `init`(go는 `init`라는 이름으로 package를 import하지 못함), `testdata`·`vendor`(go `./...`가 건너뜀), go 사전 선언 식별자(`error`, `string`, `int`, `len`, `nil` 등. 그 이름의 package를 import하면 이를 가린다), 그리고 go·rust(고정 edition)·python·js의 keyword(이 네 언어에서는 머신 key가 그대로 모듈 이름이다). (2) pascal 형태가 enum 멤버로 거부되는 상태·이벤트 key: `self`(rust `Self`), `class`(php `Class`). (3) Mermaid 예약어(store와 무관하게 항상 적용): 상태 key `note, class, classdef, style, click, href, default, state, statediagram, scale, acctitle, accdescr, root_start, root_end`, 머신 key `null, true, false`(고정한 mermaid 버전 기준. 테스트는 목록의 각 단어를 모든 위치의 상태 key와 title로 쓴 정규형을 파싱하고, 각 단어가 파싱 실패나 id 충돌을 내는지 확인한다). 이름을 변형하지 않고 거부한다.
- code·lock
  - `E_DUPLICATE_CODE`, `E_CODE_RANGE`, `E_UNKNOWN_STATE_REF`, `E_LOCK_MISMATCH`, `E_CODE_REUSED`, `E_CODE_KEY_CHANGED`
- store
  - `E_MERMAID_UNSUPPORTED`, `E_STORE_MIXED`, `E_STORE_NOT_EMPTY`, `E_STORE_NOT_CONFIGURED`

### B-6. 이름 규칙 (언어 공통 규칙 1개 + 언어별 표기 변환표)
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

## C. 구조와 강제 도구

### C-1. 저장소
```
status/
  AGENTS.md(.ko) README.md(.ko) CHANGELOG.md(.ko) Makefile kit.json .kit/ .node-version rust-toolchain.toml .githooks/
  .gitignore            # anchored only: /var/, /.results/, /packages/*/node_modules/, /packages/*/vendor/, /packages/*/target/, /packages/status-python/**/__pycache__/, php-ext phpize output under /packages/status-php-ext/src/ (exact patterns fixed in S-14; config.m4 and generated sources stay unignored), /packages/status-gui/build/, /packages/status-gui/public/assets/, /packages/status-php*/.phpunit.result.cache, /packages/status-php*/.phpunit.cache/
  config/{checklist,documents,owner-checks,commits,toolchain,dependency-policy,dependency-review}.json
  scripts/kit/ tests/kit/                    # vendored from kit
  scripts/check-layout.mjs scripts/check-parity.mjs scripts/gen-check.mjs   tests/check-layout/ tests/check-parity/ tests/gen-check/
  contracts/layout.json (tools, kinds, canonical tree, allowed differences)   contracts/features.json
  docs/spec/status.md(.ko)  docs/plans/execution-checklist.md(.ko)  docs/plans/status-v1.md(.ko)
  schema/status.schema.json  schema/status.dbs  schema/persist.dbs   # persist.dbs = shared by the six language package examples
  status.config.json  machines/order.status.json  status.lock.json  conformance/vectors/<machine>.json
  packages/status-compiler/  {src/core/, src/backends/, src/store-json/, src/store-mermaid/, src/cli/, tests/}  # zero dependencies
  packages/status-db/        {src/, tests/}   # DbStore + status-db CLI, depends on orm
  packages/status-gui/       {app/app.json, templates/, client/main.ts, public/assets/, build/, src/, crud/*.yml, tests/}
  packages/status-{go,npm,php,php-ext,python,rust}/
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
packages/status-<kind>/
  README.md README.ko.md
  Makefile          # gen (gen + vectors --kind; flags only here; DEST ?= .)
                    # test (run-tests --cwd packages/status-<kind> --results .results/<kind>.json; paths resolve against the checkout root)
  <manifest>        # [allowed difference] depends on orm (SQLite) for tests and examples
  <lock>            # [allowed difference] go.sum, package-lock.json, composer.lock, Cargo.lock (read by the kit dependency gate); python has none
  src/…             # status-gen output only
  tests/conformance.<ext>   # hand-written check functions; except in rust, iterates the vectors and registers one test per case
  tests/vectors.<ext>       # status-gen output (language-native data); in rust, one #[test] per case
  examples/persist.<ext>    # B-4 orm persistence; tests run it with the persist vectors
  examples/model/           # orm-generated model from the root schema/persist.dbs (committed, covered by gen-check); rust uses build.rs as an allowed difference
```
- `make gen`은 status-gen 출력과 orm-gen 출력을 함께 만든다.

| kind | manifest | src | tests 비고 |
|---|---|---|---|
| go | go.mod | `src/order/order.go`, `src/status/status.go` (Go는 package = 디렉터리) | `conformance_test.go`, `vectors_test.go` |
| npm | package.json | `order.js/.d.ts`, `status.js/.d.ts`, `index.js/.d.ts`(`export * as order`) | `conformance.test.mjs`, `vectors.mjs` |
| php | composer.json | `Order/{State,Event,Step}.php`, `Order/functions.php`, `Status/Error.php` | `ConformanceTest.php`, `Vectors.php` |
| php-ext | composer.json(`type: php-ext`, `extension-name`, `build-path: src`) | `config.m4`, `order.c`, `status.c`(공용 `<ns>\Status\Error`와 오류 코드 상수), `php_<ext>.h`, `<ext>.stub.php`, `<ext>_arginfo.h` | php와 **바이트 동일**한 테스트. `make test`가 phpize로 빌드한 뒤 `--php-extension <.so>`로 실행. gen에 `--php-namespace`·`--php-ext-name` 필수 |
| python | pyproject.toml | `polyspec_status/{__init__,order,status}.py` | `test_conformance.py`(케이스 이름 그대로의 메서드 생성), `vectors.py` |
| rust | Cargo.toml(`autotests=false`, `autoexamples=false`, `[[test]] conformance`, build-dep `polyspec-orm-build`, dev-dep `tokio`) + `build.rs` | `lib.rs`(`pub mod order; pub mod status;`), `order.rs`, `status.rs` | `conformance.rs`(`mod vectors;`, `#[path="../examples/persist.rs"] mod persist;`), persist 케이스는 `#[tokio::test]`, 생성 `tests/vectors.rs`는 `#![allow(non_snake_case)]`로 시작 |

- check-layout이 실패시키는 경우
  - `packages/status-*` 디렉터리 집합에서 `layout.json`의 `tools`에 적은 도구 패키지 `status-compiler`, `status-db`, `status-gui`를 뺀 집합이 `kinds`와 다름
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
- `--kind`가 없을 때: compiler-test, db-test, gui-test의 `.results/<target>.json`이 없음
- 어느 `.results/*.json`이든 `elapsedMs > 600000`(`--kind`이면 그 kind의 결과만)

케이스 이름 추출: `/\btest_[a-z][a-z0-9]*(?:_[a-z0-9]+)*__[a-z][a-z0-9]*(?:_[a-z0-9]+)*\b/`를 결과 id마다 적용한다. 서로 다른 일치가 정확히 1개인 id가 그 케이스이고, 0개 또는 2개 이상인 id는 위 결과 id 항목으로 판정한다. 도구별 규칙은 없다.

`contracts/features.json` = `initial`, `code`, `key`, `from_code`, `is_final`, `events_from`, `target`, `apply`, `persist`.

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

### C-5. compiler `packages/status-compiler`
- 구성
  - `src/core`: 객체 → validate → normalize → backends, 그리고 `run`, `copy`. `node:` import는 0개이고, GUI가 그대로 import한다.
  - `src/backends/<kind>.mjs`
  - `src/store-json`, `src/store-mermaid`
  - `src/cli` (`status-gen`)
- 명령
  - `lock [--rename]`
  - `gen --kind <k> --out <dir>` (php는 `--php-namespace` 필수, php-ext는 `--php-namespace`와 `--php-ext-name` 필수)
  - `vectors [--kind <k>] --out <path>`
  - `check`: 전 정의 검증 + lock 일치
  - `copy --to json|mermaid --root <dir>`
- 루트 `gen-check`
  1. `status-gen vectors --out var/gen-check/conformance/vectors` 실행
  2. `kinds`의 각 패키지에서 `make gen DEST=$(CURDIR)/var/gen-check/<kind>` 실행
  3. `scripts/gen-check.mjs`가 kit `trackedFiles`(추적 파일과 무시되지 않은 파일만 읽으므로 `__pycache__/`, php-ext `src/`의 phpize 산출물 같은 무시된 출력은 읽지 않는다)로 작업 트리와 비교한다. `conformance/vectors`, 각 패키지 `src/`·`tests/vectors.<ext>`·`examples/model/`(rust 제외)의 파일 집합이 같고 내용이 바이트 동일해야 한다.
  - `gen-check-test`(`tests/gen-check/`) RED: 1바이트 변경 fixture, 파일 추가 fixture, 읽지 말아야 할 무시된 파일

### C-6. status-db `packages/status-db`
- `schema/status.dbs` → orm 생성 모델(npm).
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
- `status-db` CLI는 core `run`과 `copy`를 DbStore와 json/mermaid store로 실행한다.
- 테스트(SQLite)
  - store 계약(왕복·결과 바이트 동일)
  - `E_STORE_NOT_EMPTY`
  - transaction 원자성 RED
  - dialect 차이는 orm 자신의 conformance 책임이다.

### C-7. GUI `packages/status-gui` (hyper Node 서버 + crudui + mermaid)
- GUI는 단일 편집자 도구다. save는 전체 교체이고, 마지막 쓰기가 이긴다.
- 빌드: `hyper-build-assets --app . --api /api --output build`(hyper v0.0.11은 `--app`·`--api`·`--output`을 요구한다)가 `templates.index.json`, `manifest.json`, `public/assets` 번들을 만든다(gui-test 전에 실행).
- 실행: `status-gui`
  - store는 `status.config.json`을 따른다.
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

**kit 체크리스트 (kit repo에서 먼저 진행 → 릴리스 → status에서 kit-sync. kit에 넣을 때는 kit의 5열 형식으로 쓴다)**

| id | 항목 | RED → GREEN | 상태 |
|---|---|---|---|
| K17 | `run-tests python`: `python3 -m unittest -v`의 stderr를 읽는다. cargo와 공용 줄 파서 1개를 쓰고, runner가 timeout을 강제한다. tool-inventory(.ko)를 갱신한다 | PATH stub python3으로 pass/fail/timeout/no-test RED | [ ] |
| K18 | `run-tests --results`(counts의 `cases` + `inputs` + `elapsedMs`), `inputsDigest`, tool-inventory 갱신 | node/vitest fixture 테스트 + PATH stub go/cargo/phpunit/python3 RED | [ ] |
| K19 | `check-commits` 규칙: [o] 전환 커밋은 changelog(영·한)도 바꿔야 하고, 커밋당 상태 변경 항목은 최대 1개. 스키마에 `done`·`changelog` 추가. 그 커밋에서 추가된 행은 상태 변경이 아니다 | git fixture RED | [ ] |

**status 체크리스트**

| id | 항목 | RED → GREEN | 상태 |
|---|---|---|---|
| S-01 | git init, kit-sync, config(toolchain은 node만, dependency-policy는 빈 목록 + `make dependency-review RECORD=1`로 만든 `config/dependency-review.json`), hooks, AGENTS.md(.ko) A절, D절의 S 행 전체를 담은 체크리스트(S-01은 `[o]`, 나머지는 `[ ]`), CHANGELOG, 이 계획, `CHECK_TARGETS`(지금까지 정의된 타깃만, 각 항목이 자기 타깃을 추가)와 `check` | `kit-check owner-validate documents-check commits-check toolchain-check hooks-check dependency-policy-check` | [ ] |
| S-02 | `docs/spec/status.md(.ko)` B절 | `documents-check` | [ ] |
| S-03 | `check-layout` + `layout.json`(kinds = []) + `layout-test`/`layout-check` | fixture(kinds 불일치/추가/누락/개명/php↔php-ext 불일치/형식 오류) RED | [ ] |
| S-04 | `check-parity` + `parity-test` | fixture(결과 없음/도구 결과 없음/`--kind`는 자기 kind만 읽음/stale inputs/미실행/미등록/0케이스/fail/timeout/skip/이름 일치 0·2개/부모 id/10분 초과) RED | [ ] |
| S-05 | core `E_SCHEMA` + schema 대응 테스트 | RED | [ ] |
| S-05-1 | core 그래프 오류 | 오류 코드별 RED | [ ] |
| S-05-2 | core 이름·code 오류 | 오류 코드별 RED | [ ] |
| S-06 | normalize/IR + lock(rename/reserved) + JsonStore + store 계약 + `run`/`copy` | lock 시나리오 RED | [ ] |
| S-07 | `status.config.json`(`{"store":"json"}`) + `machines/order.status.json` + `status.lock.json` + `contracts/features.json` + vectors 오라클(미등록 featureId 거부) + `gen-check` + `gen-check-test` | 수작업 기대값 fixture 일치, gen-check RED | [ ] |
| S-08 | MermaidStore(정규형 파서·writer) + json↔mermaid 왕복 | `E_MERMAID_UNSUPPORTED`·순서 위반·왕복 불일치 RED | [ ] |
| S-09 / S-09-1 | npm backend + `vectors --kind npm`(골든) / npm 패키지(conformance + persist + 루트 `schema/persist.dbs`(여기서 생성, 이후 공용) + `examples/model/`(orm-gen, gen-check 대상), kinds 추가, toolchain·dependency-policy 추가, `test-npm`) | 생성물 없음 RED → 통과, layout·parity | [ ] |
| S-10 … S-14 (+ `-1`) | 같은 방식으로 go, python, php, rust, php-ext | 동일 | [ ] |
| S-15 | status-db: dbs + DbStore + 계약 테스트 + copy + `db-test` | 계약 불일치·`E_STORE_NOT_EMPTY`·원자성 RED | [ ] |
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
| `packages/status-compiler/**`, `schema/status.schema.json`, `machines/**`, `status.lock.json`, `conformance/**`, `contracts/features.json`, `status.config.json` | `compiler-test gen-check` |
| `schema/persist.dbs` | `gen-check packages-test` |
| `schema/status.dbs`, `packages/status-db/**` | `db-test` |
| `packages/status-gui/**` | `gui-test` |
| `packages/status-<kind>/**` | `layout-check gen-check parity-<kind> dependency-policy-check` |

- kind의 소유 검사는 `parity-<kind>`(kind마다 쓰는 리터럴 타깃, 선행 타깃 `test-<kind>`, recipe `node scripts/check-parity.mjs --kind <kind>`)다. `--kind`이면 check-parity는 그 kind의 결과만 읽고 C-4 조건을 그 결과에만 적용한다(모든 벡터 케이스가 1번 실행되어 통과, 미등록 케이스 없음, `inputs` 최신, `elapsedMs`). 다른 kind의 결과와 도구 결과는 읽지 않는다. 선행 타깃과 `--kind`가 없는 `parity-check`는 모든 kind와 도구 결과를 읽고 `check`에서 `packages-test` 뒤에 돈다.
- 독립 항목(S-03, S-04, S-05)은 병렬로 진행할 수 있다.
- 전체 스위트는 S-17 커밋 후 `make check`로 1회 돌린다.

## E. 진행 순서
1. kit K17~K19 → kit 릴리스 → status S-01부터 진행한다.
2. 구현 중 감사 루프는 0절 감사 규칙을 따른다. 감사자는 정확한 수정 위치와 대체 문장을 내고, 근거를 확인해 판정하며, 핵심 이견이 0이 될 때까지 반복한다.

## Verification
- 루트 Makefile이 `include scripts/kit/kit.mk` 뒤에 다음 타깃을 정의한다.
  - `CHECK_TARGETS`, `check`
  - `layout-test`, `layout-check`, `parity-test`, `parity-check`
  - `compiler-test`, `db-test`, `gui-test`, `gen-check-test`, `gen-check`
  - `test-<kind>`, `parity-<kind>`(`parity-<kind>: test-<kind>`), `packages-test`(`kinds`의 `test-<kind>`를 `make -j6`으로)
- `check` = `node scripts/kit/full-run.mjs run $(CHECK_TARGETS)`
  - `CHECK_TARGETS` = `kit-check owner-validate documents-check commits-check hooks-check toolchain-check dependency-policy-check layout-test layout-check parity-test compiler-test db-test gui-test gen-check-test gen-check packages-test parity-check`
- 항목 개발 중에는 owner-checks 매핑만 실행한다.
- GUI 수동 확인: json·mermaid·db store 각각으로 다음을 확인한다.
  1. 상태를 추가·삭제·rename한 뒤 저장한다(lock은 save가 함께 갱신).
  2. `check`가 통과한다(json·mermaid는 `status-gen check`, db는 `status-db check`).
  3. 브라우저에서 Mermaid가 표시된다.
