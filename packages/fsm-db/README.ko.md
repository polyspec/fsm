<!-- doc-id: readme-db -->
<!-- source-sha256: 53bd3018ae06c98c2687413982c12a0c15b1e794793960ba8a2df285d084efaf -->
# @polyspec/fsm-db

[English](README.md)

fsm의 DB store와 그 명령줄 `fsm-db`다. fsm 프로젝트는 정의와 lock을 파일 대신 orm database의 여섯 table에 둘 수 있다
(`docs/spec/fsm.md`, B-2; `docs/plans/fsm-v1.md`, C-6). 이 패키지는 비공개이며 배포하지 않는다. 이 저장소에서 쓴다.

## 무엇인가

- store(`src/db-store.mjs`)는 여섯 table의 행을 fsm core가 검사하고 쓰는 정의와 lock으로 바꾼다. 검증은 core가 하고,
  store는 변환과 한 transaction 안의 쓰기만 한다.
- `fsm-db`는 이 store로 core 명령을 실행한다: `install`, `check`, `lock`, `copy`.
- 프로젝트는 store를 하나만 쓰며, 그것은 `fsm.config.json`이 정한다: `json`, `mermaid`(`fsm-gen`의 파일 store) 또는 `db`.
  `fsm-gen`은 `db`를 다루지 않고, `fsm-db`는 `db`만 다룬다.

## 준비

1. 저장소 루트에서 `make db-deps`로 패키지를 설치한다. release tarball에서 `@polyspec/orm`과
   `@polyspec/ordered-json` v0.0.7을 설치하며, 버전은 `package-lock.json`에 고정되어 있다.
2. 프로젝트 루트에 `fsm.config.json`을 만든다. database에 쓸 수 있는 형식은 이것뿐이다:

   ```json
   {"store":"db","dsnEnv":"FSM_DSN"}
   ```

   `dsnEnv`는 DSN을 담은 환경 변수의 이름이다. DSN 자체는 파일에 쓰지 않는다.
3. 그 변수에 database의 DSN을 설정한다([DSN](#dsn) 참고).
4. 명령 `fsm-db`를 PATH에 둔다: 저장소 루트에서 `npm install -g ./packages/fsm-db`. npm은 clone의 package를 link하므로
   명령은 clone의 코드를 실행한다.
5. 여섯 table을 만든다: `fsm-db install`.

`--project <dir>`은 프로젝트 루트이며, 기본값은 현재 디렉터리다.

## 여섯 table

table은 `schema/fsm.dbs`(dbspec `fsm`)의 문서 집합이다. 앞의 네 table은 정의를, 뒤의 두 table은 lock을 담는다.

| table | 열 | key |
|---|---|---|
| `machine` | `name` | PK(`name`) |
| `state` | `machine`, `key`, `code`, `position`, `initial`, `final` | PK(`machine`, `key`); unique(`machine`, `code`); unique(`machine`, `position`); FK `machine` |
| `event` | `machine`, `key`, `position` | PK(`machine`, `key`); FK `machine` |
| `edge` | `machine`, `event`, `from`, `to`, `position` | PK(`machine`, `event`, `from`); FK `event`; FK `from`와 `to`에서 `state` |
| `lock_code` | `machine`, `code`, `key` | PK(`machine`, `code`) |
| `lock_reserved` | `machine`, `code` | PK(`machine`, `code`) |

lock table에는 `machine`으로 가는 외래 키가 없다. 그래서 정의에서 지운 머신의 lock도 남는다.
orm은 자신의 table `orm__row_lock`도 database에 만든다(SQLite에서 관찰). fsm-db는 이 table을 읽지도 쓰지도 않는다.

db store에는 커밋된 기록이 없으므로 기준선은 `load`가 명령의 쓰기 전에 읽는 저장된 lock 행이다(`docs/spec/fsm.md`, B-3). 명령이
쓸 수 있는 변경은 저장된 lock 규칙(`E_CODE_REUSED`, `E_CODE_KEY_CHANGED`, `E_CODE_CHANGED`)이 거부하므로, 여기서는 명령으로
`E_LOCK_REGRESSED`가 생기지 않는다. fsm 밖(SQL)에서 바뀌거나 지워진 행은 명령이 비교할 기록이 없어 감지하지 않는다.

## DSN

DSN은 `dsnEnv`가 가리키는 환경 변수의 값이다. fsm-db는 다른 곳에서 DSN을 읽지 않는다. orm v0.0.7이 문서화한 DSN 형식
(orm 저장소의 `docs/config.md`)은 다음과 같다:

```text
mysql://user:password@host:3306/orm_example
mysql://user@localhost/orm_example?socket=/tmp/mysql.sock
postgres://user:password@host:5432/orm_example?sslmode=disable
postgres:///orm_example?host=/tmp
sqlite:///var/lib/orm_example.sqlite?_pragma=busy_timeout(5000)
```

- scheme이 MySQL, PostgreSQL, SQLite 중 하나를 고른다.
- SQLite 경로는 절대 경로여야 한다: `sqlite://`에 절대 경로를 붙인다. 따라서 `/var/...`는 `sqlite:///var/...`다. 상대 경로는
  orm이 `CONFIG`로 거부한다. 예를 들어 `FSM_DSN=sqlite://fsm.sqlite`는
  `[fsm-db] OrmError: CONFIG: sqlite DSN must include an absolute database path`를 출력한다.
- SQLite 연결은 다른 연결이 잡은 lock을 최대 5000밀리초 기다린다. `_pragma=busy_timeout(ms)` 파라미터가 이 기다림을 바꾼다.
- 이 패키지의 테스트는 SQLite에서 실행한다(`make db-test`). store 테스트(`db-store.test.mjs`와 `store-contract-all.test.mjs`)는 PostgreSQL과 MySQL에서도 돈다. `make db-test-postgres`와 `make db-test-mysql`은 `FSM_TEST_PG_DSN`과 `FSM_TEST_MYSQL_DSN`의 DSN을 읽고, 변수가 없으면 실패한다. CLI와 command 테스트는 같은 dialect에서 실행한다. case마다 빈 database를 쓰며, PostgreSQL과 MySQL에서는 admin DSN(`FSM_TEST_PG_ADMIN_DSN`, `FSM_TEST_MYSQL_ADMIN_DSN`)이 만들고 파일이 지운다(계획 C-6).

```sh
export FSM_DSN=sqlite:///var/lib/fsm/order.sqlite
```

변수가 설정되지 않았으면 모든 명령은 database에 닿기 전에 멈춘다:

```sh
$ fsm-db check --project ./order-machines
[fsm-db] E_STORE_NOT_CONFIGURED - $.dsnEnv: the environment variable FSM_DSN is not set
```

## 명령

모든 명령은 `--project <dir>`을 받는다. `E_...` finding은 stderr에 `[fsm-db] <code> <machine> <path>: <message>` 형식으로
출력된다(머신이 없으면 `machine` 자리에 `-`).

### install

orm `utils().schema().install`로 여섯 table과 orm 자신의 table을 설치한다. 동작은 orm v0.0.7에서 관찰했고
`tests/cli.test.mjs`가 검증하며, database 상태에 따라 다음과 같다:

- table이 없다: table을 만들고 `[fsm-db] install: ok`를 출력한다. 종료 코드 0.
- 여섯 table이 모두 있다: 아무것도 바꾸지 않고 같은 줄을 출력한다. 종료 코드 0. `install`을 다시 실행해도 안전하다.
- 일부 table만 있다: orm이 install을 `CONFIG`로 거부한다. 명령은 오류를 stack과 함께 출력하고 종료 코드 1로 끝난다.
  자동으로 고치지 않는다. 대체 동작(fallback)은 없다.

```sh
$ fsm-db install --project ./order-machines
[fsm-db] install: ok
```

### check

저장된 정의와 lock을 `docs/spec/fsm.md`(B-5)의 core 규칙으로 검사한다. table이 없는 database에서는 orm의 오류를 stack과 함께
출력하고 종료 코드 1로 끝난다.

```sh
$ fsm-db check --project ./order-machines
[fsm-db] check: ok
```

database에 table이 아직 없으면 `check`는 실패한다:

```sh
$ fsm-db check --project ./new-machines
[fsm-db] OrmError: DRIVER: sqlite: no such table: machine
    at ...
```

### lock

database에 core `lock` 명령을 실행한다(`docs/spec/fsm.md`, B-3). `--rename machine.old=new`는 lock을 쓰기 전에 state key의
이름을 바꾸며, 이름이 바뀐 state는 code를 유지한다. 이름에는 `.`과 `=`을 쓸 수 없다. lock은 저장된 행으로 판정한다(표 절 참고): database에는 커밋이 없어 여기서 `E_LOCK_REGRESSED`는
생기지 않는다.

```sh
$ fsm-db lock --project ./order-machines --rename order.draft=created
[fsm-db] lock: ok
```

없는 state의 이름을 바꾸려 하면 finding이다:

```sh
$ fsm-db lock --project ./order-machines --rename order.nope=x
[fsm-db] E_UNKNOWN_STATE_REF order $.states: state nope is not a state of order
```

### copy

정의와 lock을 database와 파일 store 사이에서 옮긴다. `--to` 또는 `--from` 중 하나가 파일 store(`json` 또는 `mermaid`)를
정하고, `--root`는 그 디렉터리다.

- `copy --to json|mermaid --root <dir>`: database가 원본이고, `<dir>`이 파일을 받는다.
- `copy --from json|mermaid --root <dir>`: database가 대상이다. 대상은 비어 있어야 한다(여섯 table에 행이 없어야 한다).
  비어 있지 않은 대상은 `E_STORE_NOT_EMPTY`로 실패하며 아무것도 쓰지 않는다.

```sh
$ fsm-db copy --from json --root ./order-machines --project ./order-machines
[fsm-db] copy: ok
$ fsm-db copy --from json --root ./order-machines --project ./order-machines
[fsm-db] E_STORE_NOT_EMPTY - $: the target store is not empty, so copy writes nothing
$ fsm-db copy --to json --root ./exported --project ./order-machines
[fsm-db] copy: ok
$ fsm-db copy --to mermaid --root ./exported-mmd --project ./order-machines
[fsm-db] copy: ok
```

### 종료 코드

| 코드 | 의미 |
|---|---|
| 0 | 명령이 성공했다. stdout에 `[fsm-db] <command>: ok`가 있다 |
| 1 | finding(stderr), 또는 orm이나 store의 예상하지 못한 거부(stack과 함께 출력) |
| 2 | usage 오류: 모르는 명령, 그 명령이 받지 않는 옵션, 값이 없거나 잘못된 값. usage 줄은 stderr에 있다 |

`--root` 없이 `copy`를 실행하거나 `--to`와 `--from` 중 하나도 없으면 usage 오류다. `install`은 `--project`만 받는다.

## 기존 json 또는 mermaid 프로젝트를 database로 옮기기

fsm-db는 `fsm.config.json`을 대신 바꾸지 않는다. 복사를 확인한 뒤의 변경은 사람이 한다.

1. 파일 프로젝트를 확인한다: `fsm-gen check --project ./order-machines`가 `[fsm-gen] check: ok`를 출력해야 한다.
   프로젝트를 커밋해 파일을 이력에 남긴다.
2. `fsm.config.json`을 `{"store":"db","dsnEnv":"FSM_DSN"}`으로 바꾸고 `FSM_DSN`을 설정한다.
3. table을 만든다: `fsm-db install --project ./order-machines`.
4. 파일을 database로 복사한다: `fsm-db copy --from json --root ./order-machines --project ./order-machines`
   (`*.fsm.mmd` 프로젝트면 `mermaid`를 쓴다). 대상은 비어 있어야 하며, 두 번째 복사는 `E_STORE_NOT_EMPTY`로 실패한다.
5. database를 확인한다: `fsm-db check --project ./order-machines`.
6. database를 원본으로 삼을 때 `machines/` 파일과 `fsm.lock.json`을 지운다. 그 전까지는 아무도 읽지 않는다.

설정이 `db`를 가리키는 동안 `fsm-gen`은 프로젝트를 `E_STORE_NOT_CONFIGURED`로 거부한다. database에서 코드를 생성하려면
database를 파일 store 설정을 가진 디렉터리로 내보낸 뒤 그 디렉터리에서 `fsm-gen`을 실행한다:

```sh
$ fsm-db copy --to json --root ./export --project ./order-machines
[fsm-db] copy: ok
$ echo '{"store":"json"}' > ./export/fsm.config.json
$ fsm-gen check --project ./export
[fsm-gen] check: ok
```

## 검사

`make db-test`는 이 패키지의 테스트를 kit의 test runner(`@polyspec/kit`의 `run-tests`)로 실행한다. 먼저 `make db-deps`가 필요하다. 모든 테스트는
SQLite에서 실행한다. store, CLI, command 테스트는 PostgreSQL과 MySQL에서도 실행한다(`make db-test-postgres`, `make db-test-mysql`). 각각 `FSM_TEST_PG_DSN`과 `FSM_TEST_MYSQL_DSN`의 DSN과, CLI 테스트의 빈 database를 만드는 `FSM_TEST_PG_ADMIN_DSN`과 `FSM_TEST_MYSQL_ADMIN_DSN`을 쓴다.

- `tests/db-store.test.mjs`는 store를 검사한다: json → db → json과 db → json → db가 같은 파일과 행을 준다. 64자 key는 바뀌지 않고
  되돌아온다. 실패한 쓰기는 지우고 쓴 행을 모두 되돌린다. 빈 것이 아닌 database에 대한 `copy`는 `E_STORE_NOT_EMPTY`이며 아무것도
  쓰지 않는다. 생성된 model은 orm-gen이 schema와 scan에서 쓰는 것과 같다.
- `tests/cli.test.mjs`는 `fsm-db`를 프로세스로 실행한다: 사용 오류(종료 코드 2), 설정 없음과 설정되지 않은 DSN 변수
  (`E_STORE_NOT_CONFIGURED`), 두 방향의 `copy`, 저장된 lock을 고치는 `lock`, 새 database·설치된 database·일부만 설치된 database에서의
  `install`.
- `tests/command.test.mjs`는 임시 npm prefix에 패키지를 offline으로 설치하고 그곳의 `fsm-db`를 실행한다. 테스트되는 명령은
  설치된 명령이다.

store가 기대는 core 규칙은 compiler(`make compiler-test`)에서 검사하며, store 계약은 거기서 json, mermaid store와 공유된다.
