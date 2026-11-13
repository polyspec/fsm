<!-- doc-id: operations-persist-servers -->
<!-- source-sha256: 587bc42912da767e0f8e3415e88fe1d5550caf1c376d2c9e32e2a881879d614c -->
# 영속성 테스트의 서버

[English](persist-servers.md)

PostgreSQL과 MySQL의 영속성 테스트는 make target 하나가 `bay`로 시작하고 제거하는 서버에서 실행한다. 이 문서는 절차다. 결정과
그 이유는 [계획](../plans/fsm-v1/plan.ko.md)의 C-6에, 열린 작업은 [체크리스트](../plans/fsm-v1/checklist.ko.md)의 S-475와 그
하위 항목에 있다.

## 머신에 필요한 것

- PATH의 `bay`, 그리고 적용된 머신 설정: `bay check`가 통과한다. bay는 Darwin에서는 Apple `container`, Linux에서는 Docker
  위에서 Compose project를 실행한다. 이 저장소의 어떤 target도 bay를 설치하지 않고, 어떤 추적 파일도 그 릴리스를 고정하지
  않는다(S-475-4). `bay install`은 머신 설정을 적용하며 사람에게 관리자 암호를 묻는다. 실행은 이 명령을 실행하지 않는다.
- PATH의 플랫폼 container 프로그램: Darwin은 Apple `container`, Linux는 `docker`. 실행은 이미지가 설치되어 있는지를 이
  프로그램에 묻고, `make persist-images`는 이 프로그램으로 pull한다. bay에는 두 일을 하는 명령이 없기 때문이다(S-475-2).
- `config/containers.json`이 digest로 고정한 두 이미지, PostgreSQL 17.11과 MySQL 8.4.11.

## 명령

```sh
make persist-images
make persist-servers TARGETS="db-test-postgres db-test-mysql"
```

- `make persist-images`는 두 이미지를 pull한다. 이미지를 내려받는 target은 이것뿐이다. 실행은 아무것도 pull하지 않는다.
- `make persist-servers TARGETS="..."`는 두 서버와 함께 `make ci-targets`로 target을 실행한다. `make check`와
  `make ci-suite`는 이 target을 통해 자기 target을 실행한다.

## 실행이 하는 일

1. PATH에 `bay`나 container 프로그램이 없으면 즉시 실패하고, 프로그램의 이름과 설치 방법을 적는다.
2. `bay check`를 실행한다. 검사가 실패하면 실행은 검사의 줄과 함께 실패한다. 그때 `bay install`을 실행하고 실행을 다시
   시작한다.
3. 각 이미지가 설치되어 있는지를 container 프로그램에 묻는다. 이미지가 없으면 실행은 실패하고 `make persist-images`를
   적는다.
4. 시스템의 임시 디렉터리에 디렉터리 `fsm-persist-<pid>-<random>`을 만들고 그 안에 `compose.yaml`을 쓴다. project의 이름은
   디렉터리의 이름이고, service는 `postgres`와 `mysql`이다. 파일은 host의 포트를 게시하지 않고 아무것도 mount하지 않는다.
   각 service는 container 안에서 자기 서버에 TCP로 묻는 `healthcheck`를 선언한다. `pg_isready`와
   `mysqladmin ping --protocol=tcp`이고, 3초마다, 많아야 bay가 받는 가장 큰 수인 100번 묻는다.
5. 그 디렉터리에서 `bay up`을 실행하고 각 줄을 `persist-servers: bay up: <line>`으로 보여 준다. bay는 선언된 health를
   검사하고 각 service가 healthy가 된 뒤에 반환한다. 실행은 그 반환만 기다리며, 자기 sleep도 polling도 시간 제한도 없다.
6. `bay status --json`을 실행하고 자기 project의 각 service의 field `address`를 읽는다. DSN은 그 주소와 서버의 포트 `5432`,
   `3306`을 적는다.
7. `FSM_TEST_PG_DSN`, `FSM_TEST_PG_ADMIN_DSN`, `FSM_TEST_MYSQL_DSN`, `FSM_TEST_MYSQL_ADMIN_DSN`과 함께 target을 실행한다.
8. 그 디렉터리에서 `bay down`을 실행하고, 디렉터리를 지우고, `persist-servers: removed the project <project>`를 보여 준다.
   target이 끝나거나 실패할 때, `bay up`이 실패하거나 주소가 없을 때, SIGINT와 SIGTERM 뒤에 그렇게 한다.
9. `bay up`이나 `bay down`이 실패한 뒤에는 `bay status --json`을 읽어 project가 있는지 안다. bay는 Compose 파일을 받아들일 때
   project를 등록한다. JSON에 project의 group이 없으면 실행의 것은 아무것도 없으므로 실행은 디렉터리를 지우고, 그런
   `bay up` 뒤에는 `bay down`을 실행하지 않는다.

실행의 종료 코드는 target의 종료 코드이고, SIGINT 뒤에는 130, SIGTERM 뒤에는 143, 실행 자체의 실패에는 1이다.

## 실패

| 실행의 줄 | 원인 | 할 일 |
|---|---|---|
| `persist-servers: bay is not found on PATH` | PATH에 bay가 없다 | bay를 설치하고 `bay install`을 실행한다 |
| `persist-servers: bay check ended with <code>` | bay의 머신 설정 중 빠진 부분이 있다. 위의 줄이 그 부분을 적는다 | `bay install`을 실행한다 |
| `persist-servers: the image <reference> of <kind> is not installed` | 이미지가 container 프로그램에 없다 | `make persist-images`를 실행한다 |
| `persist-servers: bay up ended with <code>` | service가 시작하지 못했거나 100번의 질의 안에 healthy가 되지 않았다. 위의 `persist-servers: <service>: <line>` 줄이 각 service의 마지막 40줄이다 | 그 줄을 읽는다. 실행은 이미 project를 제거했다 |
| `persist-servers: bay lists no project <project>: bay up made nothing` | bay가 실행의 Compose 파일을 거부했다. 위의 `persist-servers: bay up: <line>` 줄이 이유를 적는다 | 그 줄이 적은 것을 `scripts/persist-servers.mts`에서 고친다. 실행은 이미 디렉터리를 지웠다 |
| `persist-servers: bay status --json names no address of the service <service>` | bay의 JSON에 project의 service 주소가 없다. JSON이 그 줄 뒤에 온다 | JSON을 6단계가 읽는 field와 비교한다 |
| `persist-servers: bay down ended with <code>; the containers of the project <project> may still run` | bay가 project를 제거하지 못했고 아직 그 project를 나열한다 | 그 줄이 적은 디렉터리에서 `bay down`을 실행하고, 그 디렉터리를 지운다 |
| `persist-servers: bay down ended with <code>; bay lists no project <project>` | `bay down`이 실패했고 bay가 더는 그 project를 나열하지 않으므로 실행의 container는 없다 | 할 일 없음. 실행은 이미 디렉터리를 지웠다 |

## 검증되지 않은 것과 기다리는 것

- bay가 이미지의 초기화 중에 한 질의를 100번에 세는지, 그리고 `bay up`이 반환한 뒤 첫 query에 두 서버가 답하는지를 실제
  서버로 실행해 확인한 적이 아직 없다(S-475).
- `bay check`는 어떤 서버에도 필요 없는 bay의 agent skill과 MCP 등록도 보고한다. 그것이 없는 머신에서 검사가 실패하는지는
  검증하지 않았다(S-475-6).
- CI의 job `check`는 bay를 설치하지 않으므로, suite step은 runner에서 표의 첫 줄로 실패한다(S-475-5).
- bay의 명령줄로 적는 project 이름(S-475-1), bay를 통한 pull(S-475-2), `bay up`의 JSON 출력(S-475-3), bay의 고정된
  릴리스(S-475-4)는 bay의 릴리스를 기다린다.
