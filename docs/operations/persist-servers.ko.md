<!-- doc-id: operations-persist-servers -->
<!-- source-sha256: 75ff0fe0e4f7e131fa330618c55c9698b2851a1e515925e1de81ede0b11a77c1 -->
# 영속성 테스트의 서버

[English](persist-servers.md)

PostgreSQL과 MySQL의 영속성 테스트는 `bay`가 실행하는 Compose project의 서버에서 돈다. 실행에는 같은 단계를 가진 두
형태가 있다. 기본값인 host 형태에서는 target이 그것을 시작한 머신의 process다. runner 형태에서는 target이 project의
service `runner` 안에서 돌며, host에 `sh`와 `bay`만 있는 머신을 위한 것이다. 이 문서는 절차다. 결정과 그 이유는 [계획](../plans/fsm-v1/plan.ko.md)의 C-6에, 열린 작업은
[체크리스트](../plans/fsm-v1/checklist.ko.md)의 S-475와 그 하위 항목에 있다.

## 머신에 필요한 것

- 실행을 쓰는 머신: 도구가 설치된 checkout과 PATH의 `bay`, 그리고 runner 형태에는 `git`. 개발 머신이거나 CI의 runner다.
- host 형태의 실행을 실행하는 머신: 같은 머신이고, bay의 머신 설정이 적용되어 있어야 한다.
- runner 형태의 실행을 실행하는 머신: `sh`, 머신 설정이 적용된 `bay`, bay의 container engine. 그 host의 다른 것은 쓰지
  않는다. 같은 머신일 수도 다른 머신일 수도 있다.
- `config/containers.json`이 digest로 고정한 이미지가 bay의 store에 있어야 한다. PostgreSQL 17.11과 MySQL 8.4.11, 그리고
  runner 형태에는 runner의 이미지인 Debian `trixie-20261104`다.
- runner 형태에는 실행마다 network: runner의 container는 새것이므로 runner는 system package, Node.js, rustup, lock의
  package를 다시 설치하고, 앞의 셋에는 고정된 digest가 없다(S-475-8).

bay는 make처럼 머신의 도구다. 실행은 PATH의 `bay`를 그대로 쓰고 릴리스를 비교하지 않는다. `bay version --json`의 계약이
schema 1일 것만 요구한다. 개발 머신에서는 사람이 bay를 설치한다. 그 설정 `bay install`이 관리자 암호를 묻기 때문이며,
거기서는 어떤 target도 그 일을 하지 않는다.

`BAY`는 bay를 시작하는 단어들을 가지며, 설정되지 않았으면 `bay`다. bay를 다른 방식으로 시작해야 하는 곳에서 설정한다.
bay의 상태가 root의 것이고 사용자가 암호 없는 `sudo`를 가진 머신에서는 `BAY="sudo -n bay"`다.

## 명령

```sh
make persist-images
make persist-servers TARGETS="db-test-postgres db-test-mysql"
make persist-servers-runner TARGETS="db-test-postgres db-test-mysql"
make persist-servers-write TARGETS="db-test-postgres db-test-mysql"
```

- `make persist-images`는 `bay pull`로 세 이미지를 pull한다. 이미지를 내려받는 target은 이것뿐이다.
- `make persist-servers TARGETS="..."`는 host 형태의 실행의 디렉터리를 쓰고, 실행하고, 지운다. target은 이 머신의
  process다. `make check`와 `make ci-suite`는 이 target을 통해 자기 target을 실행한다.
- `make persist-servers-runner TARGETS="..."`는 디렉터리를 쓴 머신에서 runner 형태로 같은 일을 한다.
- `make persist-servers-write TARGETS="..."`는 runner 형태의 디렉터리를 쓰고 그 경로를 출력한다. 다른 머신에서 실행할 때
  쓴다. 디렉터리를 그곳으로 옮기고, `sh <directory>/run.sh`를 실행하고, 끝나면 디렉터리를 지운다. 그 머신에서 이미지는
  `sh <directory>/run.sh pull`로 pull한다.

runner 형태에서 target은 checkout의 branch의 commit된 tree에서 돈다. 그런 실행 전에 commit한다.

## 실행의 디렉터리

`var/persist-servers/fsm-persist-<pid>-<random>`에는 `compose.yaml`과 `run.sh`가 있고, runner 형태에는 `runner.sh`와
branch의 Git bundle인 `tree.bundle`도 있다. runner는 이 디렉터리를 읽기 전용으로 mount하고 checkout의 어떤 것도 mount하지 않는다.

## `run.sh`가 하는 일

host 형태의 명령을 뺀 각 단계는 `bay -f <directory> -p <project>`의 명령 하나다. runner 형태에서 `run.sh`는 다른
프로그램을 시작하지 않는다.

1. `bay version --json`: 기록의 첫 줄이 실행한 bay를 적는다.
2. `bay images`: store에 없는 이미지는 실행을 실패시키고 `make persist-images`를 적는다.
3. `bay up -no-pull`: 두 서버가 healthy가 된 뒤에 반환한다. 각 서버는 container 안에서 TCP로 묻는 `healthcheck`를
   선언한다. `pg_isready`와 `mysqladmin ping --protocol=tcp`다. 실행은 그 반환만 기다린다. 한도는 Compose 파일에 있다.
   이미지의 초기화를 위한 start period 300초, 그 뒤 실패 3번, 1초마다 질의 한 번이다. Linux arm64 머신에서 잰 값:
   MySQL은 70초, PostgreSQL은 11초 뒤에 healthy가 되었다.
4. 명령 `make ci-targets TARGETS="..."`: `FSM_TEST_*` DSN 네 개와 함께 실행한다. DSN은 디렉터리를 쓸 때
   `bay plan --json`이 준 각 서버의 host와 port를 적는다. host 형태에서는 DSN을 환경에 받은 host의 process다. runner
   형태에서는 `bay exec runner sh /persist-run/runner.sh <command>`이고, `runner.sh`는 system package, Node.js, rustup을
   설치하고, `tree.bundle`을 clone하고, `make bootstrap`과 `make install`을 실행한 뒤 target을 실행한다.
5. `bay down`: trap이 실행한다. 단계가 실패했을 때, 그리고 SIGINT, SIGTERM, SIGHUP 뒤에도 실행하며, signal은 먼저 실행
   중인 단계를 끝낸다.

종료 코드는 target의 종료 코드이고, 그 전에 실패한 단계에는 1, 세 signal 뒤에는 130, 143, 129다.

## 실패

| 줄 | 원인 | 할 일 |
|---|---|---|
| `scripts/bay.mts: bay is not found on PATH` | PATH에 bay가 없거나 `BAY`가 적은 프로그램이 없다 | bay를 설치하고 `bay install`을 실행하거나 `BAY`를 고친다 |
| `scripts/bay.mts: the contract of bay is the schema <n>` | 머신의 bay가 실행의 파일이 읽는 계약과 다른 계약을 가진다 | schema 1의 bay를 쓰거나, 새 계약에 맞게 실행의 파일과 테스트의 대역을 바꾼다 |
| `persist-servers: bay plan --json names no host and port of the service <service>` | `bay plan`의 JSON에 그 service나 host나 port가 없다. JSON이 그 줄 뒤에 온다 | JSON을 field `services[].name`, `host`, `port`와 비교한다 |
| `persist-servers: an image of the project <project> is not installed` | bay의 store에 이미지가 없다 | `make persist-images`를 실행하거나, 실행의 머신에서 `sh <directory>/run.sh pull`을 실행한다 |
| `persist-servers: bay up failed before the servers of the project <project> were healthy` | bay가 파일을 거부했거나, 머신 설정의 한 부분이 빠졌거나, 서버가 시작하지 못했거나 healthy가 되지 않았다. 위의 bay의 줄이 어느 것인지 적는다 | 그 줄을 읽는다. 설정의 빠진 부분이면 `bay install`을 실행한다. 실행은 이미 project를 제거했다 |
| `persist-servers: bay down failed` | bay가 project를 제거하지 못했다. container가 아직 실행 중일 수 있다. 디렉터리는 남고 파일 `down-failed`를 가진다 | 그 줄이 보여 주는 명령 `bay -f <directory> -p <project> down`을 실행하고, 디렉터리를 지운다 |

## CI의 runner의 bay

`config/toolchain.json`은 CI가 설치하는 bay의 릴리스를 플랫폼별 archive의 sha256과 함께 적는다. 어떤 실행도 그 값을 읽지
않는다. `make bay-install`은 그 archive를 내려받고, sha256이 고정된 것이 아니면 실패하고, `sudo -n`으로 `bay`와 `bayd`를
`/usr/local/bin`에 설치하고, `bay install`로 머신 설정을 적용하고, `bay check -scope run`을 요구한다. job `check`는
`make persist-images` 앞에서 이것을 실행하고, bay의 step들에 `BAY`를 `sudo -n bay`로 설정한다.

릴리스를 올리는 방법: `config/toolchain.json`의 version과 digest 네 개를 새 릴리스의 것으로 바꾸고(릴리스의 파일
`SHA256SUMS`에 있다) `make bay-test`를 돌린다. 계획 C-6이 적은 명령이나 출력을 바꾸는 릴리스는 같은 변경에서 실행의
파일과 테스트의 `bay` 대역을 바꾼다.

## 검증되지 않은 것

- script가 쓰는 파일로 하는 실제 bay의 실행, 두 형태 모두(S-475-7). 손으로 쓴 runner 형태의 파일로 잰 것: Linux arm64
  머신의 runner에서 `db-test-postgres`와 `db-test-mysql`이 통과한다.
- `ubuntu-26.04-arm`에서 job `check`의 step들(S-475-5).
