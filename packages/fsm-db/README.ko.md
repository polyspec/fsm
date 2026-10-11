<!-- doc-id: readme-db -->
<!-- source-sha256: a00a6c6109ff0232ae9b0e1e155f76fc761544608867c939de83f3adf16c6818 -->
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
- 이 패키지의 테스트는 SQLite만 실행한다. orm은 MySQL과 PostgreSQL 형식도 받아들이지만, 이 패키지에는 그 형식의 테스트가 없다.

```sh
export FSM_DSN=sqlite:///var/lib/fsm/order.sqlite
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
이름을 바꾸며, 이름이 바뀐 state는 code를 유지한다. 이름에는 `.`과 `=`을 쓸 수 없다.

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
