<!-- doc-id: operations-persist-servers -->
<!-- source-sha256: f55941cdc48ee7e5d5e03f644cfa1d994e41415729be2fb6ff561ad09b39ff90 -->
# 영속성 테스트의 서버

[English](persist-servers.md)

PostgreSQL과 MySQL의 영속성 테스트는 make target 하나가 `bay`로 pull하고 시작하고 제거하는 서버에서 실행한다. 이 문서는
절차다. 결정과 그 이유는 [계획](../plans/fsm-v1/plan.ko.md)의 C-6에, 열린 작업은
[체크리스트](../plans/fsm-v1/checklist.ko.md)의 S-475와 그 하위 항목에 있다.

## 머신에 필요한 것

- PATH의 `bay`, 그리고 적용된 머신 설정. bay는 Darwin에서는 Apple `container`, Linux에서는 Docker 위에서 Compose project를
  실행한다. 이 저장소의 어떤 target도 bay를 설치하지 않고, 어떤 추적 파일도 그 릴리스를 고정하지 않는다(S-475-4). 실행은
  자기가 쓴 bay의 version을 보여 준다. `bay install`은 머신 설정을 적용하며 사람에게 관리자 암호를 묻는다. 실행은 이 명령을
  실행하지 않고, 설정이 완전하지 않으면 `bay up`이 실패하며 빠진 부분을 적는다.
- `config/containers.json`이 digest로 고정한 두 이미지, PostgreSQL 17.11과 MySQL 8.4.11이 bay의 local store에 있어야 한다.

이 저장소의 어떤 script도 `container`나 `docker`를 직접 부르지 않는다.

## 명령

```sh
make persist-images
make persist-servers TARGETS="db-test-postgres db-test-mysql"
```

- `make persist-images`는 `bay pull`로 두 이미지를 pull한다. 이미지를 내려받는 target은 이것뿐이다. 실행은 아무것도
  pull하지 않는다.
- `make persist-servers TARGETS="..."`는 두 서버와 함께 `make ci-targets`로 target을 실행한다. `make check`와
  `make ci-suite`는 이 target을 통해 자기 target을 실행한다.

## 실행이 하는 일

1. PATH에 `bay`가 없으면 즉시 실패하고, 프로그램의 이름과 설치 방법을 적는다.
2. `bay version --json`이 출력하는 것을 `persist-servers: bay version: <JSON>`으로 보여 준다.
3. 시스템의 임시 디렉터리에 디렉터리 `fsm-persist-<pid>-<random>`을 만들고 그 안에 service `postgres`와 `mysql`을 가진
   `compose.yaml`을 쓴다. 파일은 host의 포트를 게시하지 않고 아무것도 mount하지 않는다. bay의 각 명령은 파일과 project,
   곧 디렉터리의 이름을 적는다: `bay -f <directory> -p <project> <command>`.
4. `bay images --json`을 읽는다. store에 없는 이미지는 실행을 실패시키고 `make persist-images`를 적는다. 그때 실행은 자기
   디렉터리를 지운다.
5. `bay up -no-pull --json`을 실행하고 진행의 각 줄을 `persist-servers: bay up: <line>`으로 보여 준다. 각 service는
   container 안에서 자기 서버에 TCP로 묻는 `healthcheck`를 선언한다. `pg_isready`와 `mysqladmin ping --protocol=tcp`다.
   bay는 각 service가 healthy가 된 뒤에 반환한다. 실행은 그 반환만 기다리며, 자기 sleep도 polling도 시간 제한도 없다.
   한도는 파일에 있다: 이미지의 초기화를 위한 start period 300초, 그 뒤 실패 3번, 1초마다 질의 한 번.
6. `bay up`이 출력한 JSON에서 각 service의 `host`와 `port`를 읽는다. DSN은 그것을 적는다.
7. `FSM_TEST_PG_DSN`, `FSM_TEST_PG_ADMIN_DSN`, `FSM_TEST_MYSQL_DSN`, `FSM_TEST_MYSQL_ADMIN_DSN`과 함께 target을 실행한다.
8. `bay down`을 실행하고, 디렉터리를 지우고, `persist-servers: removed the project <project>`를 보여 준다. target이 끝나거나
   실패할 때, `bay up`이 실패하거나 그 JSON에 service가 없을 때, SIGINT와 SIGTERM 뒤에 그렇게 한다. 서버를 시작하는 중에
   받은 signal은 `bay up`에 전달하고, `bay up`은 자기가 만든 것을 제거한다.

실행의 종료 코드는 target의 종료 코드이고, SIGINT 뒤에는 130, SIGTERM 뒤에는 143, 실행 자체의 실패에는 1이다.

## 실패

| 실행의 줄 | 원인 | 할 일 |
|---|---|---|
| `persist-servers: bay is not found on PATH` | PATH에 bay가 없다 | bay를 설치하고 `bay install`을 실행한다 |
| `persist-servers: the image <reference> of <service> is not installed` | bay의 store에 이미지가 없다 | `make persist-images`를 실행한다 |
| `persist-servers: bay up ended with <code>` | bay가 파일을 거부했거나, 머신 설정의 한 부분이 빠졌거나, service가 시작하지 못했거나 healthy가 되지 않았다. 위의 `persist-servers: bay up: <line>` 줄이 어느 것인지 적고, health가 실패한 service의 출력을 담는다 | 그 줄을 읽는다. 설정의 빠진 부분이면 `bay install`을 실행한다. 실행은 이미 project를 제거했다 |
| `persist-servers: bay up --json names no host and port of the service <service>` | `bay up`의 JSON에 그 service나 host나 port가 없다. JSON이 그 줄 뒤에 온다 | JSON을 6단계가 읽는 field와 비교한다 |
| `persist-servers: bay down ended with <code>` | bay가 project를 제거하지 못했다. container가 아직 실행 중일 수 있다 | 그 줄이 보여 주는 명령 `bay -f <directory> -p <project> down`을 실행하고, 그 디렉터리를 지운다 |

## 검증되지 않은 것과 기다리는 것

- 실제 서버로 한 실행이 통과한 적이 아직 없다(S-475). 그 실행이 `bay up`의 JSON의 field 이름, start period에 대해 각
  이미지의 초기화가 걸리는 시간, 그리고 `bay up`이 반환한 뒤 첫 query에 두 서버가 답하는지를 보여야 한다.
- CI의 job `check`는 bay를 설치하지 않으므로, step `make persist-images`와 `make ci-suite`는 runner에서 표의 첫 줄로
  실패한다(S-475-5). 이것은 bay의 고정된 릴리스(S-475-4)를 기다린다.
