<!-- doc-id: operations-persist-servers -->
<!-- source-sha256: 0d4971d574074bfc341f22aa09a4a7a9e3a9b261c34e2ec7e3b3a8bf839fc9cf -->
# 영속성 테스트의 서버

[English](persist-servers.md)

PostgreSQL과 MySQL의 영속성 테스트는 `bay`가 실행하는 Compose project의 서버에서 돈다. 실행에는 두 형태가 있다. 기본값인
host 형태에서는 target이 그것을 시작한 머신의 process다. host에 `sh`와 `bay`만 있는 머신을 위한 runner 형태에서는 실행이
bay의 job 두 개다. `build`는 서버 없이 저장소의 도구를 설치하고, `check`는 서버와 함께 target을 실행한다. 이 문서는
절차다. 결정과 그 이유는 [계획](../plans/fsm-v1/plan.ko.md)의 C-6에, 열린 작업은 [체크리스트](../plans/fsm-v1/checklist.ko.md)의
S-475와 그 하위 항목에 있다.

## 머신에 필요한 것

- 실행을 쓰는 머신: 도구가 설치된 checkout과 PATH의 `bay`, 그리고 runner 형태에는 `git`. 개발 머신이거나 CI의 runner다.
- host 형태의 실행을 실행하는 머신: 같은 머신이고, bay의 머신 설정이 적용되어 있어야 한다.
- runner 형태의 실행을 실행하는 머신: `sh`, 머신 설정이 적용되고 bay의 job(`x-bay.job`, bay 0.0.7)을 가진 `bay`, bay의
  container engine. 그 host의 다른 것은 쓰지 않는다. 같은 머신일 수도 다른 머신일 수도 있다.
- `config/containers.json`이 digest로 고정한 이미지가 bay의 store에 있어야 한다. PostgreSQL 17.11과 MySQL 8.4.11, 그리고
  runner 형태에는 job의 이미지인 Debian `trixie-20261104`다.
- runner 형태에는 실행마다 network: 각 job은 system package를 자기의 새 container에 설치하고, job `build`는 Node.js,
  rustup, lock의 package를 다시 설치한다. 앞의 셋에는 고정된 digest가 없다(S-475-8).

bay는 make처럼 머신의 도구다. 실행은 PATH의 `bay`를 그대로 쓰고 릴리스를 비교하지 않는다. `bay version --json`의 계약이
schema 1일 것을 요구하고, runner 형태는 `bay plan --json`이 각 part를 job으로 적을 것을 요구한다. 개발 머신에서는 사람이
bay를 설치한다. 그 설정 `bay install`이 관리자 암호를 묻기 때문이며, 거기서는 어떤 target도 그 일을 하지 않는다.

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
- `make persist-servers-runner TARGETS="..."`는 runner 형태의 디렉터리를 쓰고, 그 job 두 개를 이 머신에서 실행하고, 그것을
  기다리고, 디렉터리를 지운다.
- `make persist-servers-write TARGETS="..."`는 runner 형태의 디렉터리를 쓰고 그 경로를 출력한다. 다른 머신에서 실행할 때
  쓴다(아래).

runner 형태에서 target은 checkout의 branch의 commit된 tree에서 돈다. 그런 실행 전에 commit한다.

## 다른 머신에서의 실행

job은 그것을 가진 머신의 bay agent의 process에서 돌고 그 상태, 종료 코드, 시간, 출력을 남긴다. 그래서 job이 도는 동안
연결이 끊겨도 job은 끝나지 않고 결과도 잃지 않는다. 개발 머신은 각 job을 `ssh`로 그곳의 큐에 넣고 `ssh`로 그곳에서
기다린다. 그래서 기다림은 job의 머신에서 돈다. `<machine>`은 `ssh` host이고, `<remote>`는 그곳의 디렉터리다.

```sh
directory=$(make -s persist-servers-write TARGETS="db-test-postgres db-test-mysql")
project=${directory##*/}
scp -r "$directory" <machine>:<remote>/
ssh <machine> sh <remote>/$project/run.sh pull          # 이미지가 그곳에 없을 때만
ssh <machine> sh <remote>/$project/run.sh add build
ssh <machine> sh <remote>/$project/run.sh wait build
ssh <machine> sh <remote>/$project/run.sh add check     # wait build가 0으로 끝난 뒤에만
ssh <machine> sh <remote>/$project/run.sh wait check
ssh <machine> rm -r <remote>/$project
```

- `sh run.sh add <part>`는 job의 id만 표준 출력에 출력한다. 그래서 `id=$(ssh <machine> sh <remote>/$project/run.sh add build)`가
  그것을 담는다. `run.sh`의 다른 모든 줄은 표준 오류에 있다. 이것은 id를 디렉터리의 `job-<part>`에 쓰고, `wait <part>`가 그것을
  읽는다.
- `sh run.sh add <part>`는 bundle의 commit을 key로 job을 큐에 넣는다. 그래서 id를 읽기 전에 연결이 끊겼으면, 같은 명령이
  같은 job을 돌려주고 두 번째 job을 넣지 않는다.
- `sh run.sh wait <part>`는 job의 출력을 보여 주고, 그것을 기다리고, 그 기록 `bay job show -json`을 디렉터리의
  `job-<part>.json`에 쓴다. job이 끝나고 성공하면 0, 끝나고 성공하지 않으면 1, 끝나지 않았거나 bay가 기록을 보여 주지
  않으면 3, `add`가 그 part를 큐에 넣지 않았으면 2로 끝난다. 이것은 아무것도 취소하지 않는다. 연결이 끊긴 뒤나 코드 3 뒤에도
  job은 계속 돌고, 같은 명령이 다시 기다린다.
- `check`는 `wait build`가 0으로 끝난 뒤에만 큐에 넣는다. `check`는 `build`가 설치한 것 위에서 돈다.
- 마지막 job이 끝난 뒤 그곳의 디렉터리를 지운다. 그 디렉터리가 job의 기록을 가진다.

## 실행의 디렉터리

`var/persist-servers/fsm-persist-<pid>-<random>`에는 `compose.yaml`과 `run.sh`가 있다. runner 형태에서는 `compose.yaml`이
job `check`도 가지며, 디렉터리에 job `build`만 가진 `compose.build.yaml`, 두 job의 명령인 `runner.sh`, branch의 Git
bundle인 `tree.bundle`도 있다. 각 job은 이 디렉터리를 쓰기 가능하게 mount하고 checkout의 어떤 것도 mount하지 않는다. job
`build`는 도구와 clone을 `work/` 아래에 쓰고, job `check`는 그 위에서 돈다. `run.sh`는 그 안에 `report.txt`를 쓴다.

## 실행의 report와 메모리

`report.txt`는 사건마다 한 줄을 가지며, 한 줄은 UTC 시각과 사건이다. 각 단계의 `<step> start`와 `<step> exit <code>`,
그리고 `run exit <code>`다. 단계는 `version`과 `images`이고, 그다음 host 형태에서는 `up`, `command`, `down`, runner
형태에서는 `build`와 그다음 `check`에 대한 `add <part>`, `logs <part>`, `wait <part>`, `show <part>`와 줄
`job <part> <id>`다. `sh run.sh add <part>`는 `add <part>`의 줄을 쓰고, `sh run.sh wait <part>`는 `version`, `logs <part>`,
`wait <part>`, `show <part>`의 줄을 쓴다. host 형태는 각 service의 `memory.peak <service> <bytes>`도 쓴다. 그 container의 cgroup이 기록한 최고
사용량이고, project를 제거하기 전에 `bay exec <service> cat /sys/fs/cgroup/memory.peak`로 읽는다. 그 파일이 없는
container에는 `not read`가 적힌다. runner 형태에서는 `bay job show -json`이 각 job의 기록을 `job-<part>.json`에 쓰고,
`run.sh`가 그것도 보여 준다. 머신이 보고하는 경우 `bay job list`가 각 job의 메모리 최고치를 보여 준다. 실행은 각 줄을 `persist-servers: <line>`으로 보여 준다. 디렉터리를 지우는 target에서는 이
줄만 남는다.

머신은 실행의 service들이 함께 쓰는 것보다 적은 메모리를 가질 수 있다. 3.7 GB의 Linux 머신에서 bay의 container들은 합계
2.6 GB에서 느려지고 3.0 GB에서 그 process가 종료된다. `config/containers.json`의 각 이미지 pin은 `memory`를 가지며,
Compose 파일은 그것을 그 service의 `mem_limit`으로 가진다. PostgreSQL `448m`과 MySQL `640m`은 그 최고치 380 MiB와 552
MiB보다 높고, runner `2560m`은 그 설치의 최고치 2506 MiB보다 높다. job `build`는 서버 없이 돌므로 설치와 서버가 메모리를
동시에 쥐지 않는다. service에 필요한 것보다 낮은 한도는 그 process를 끝낸다. report의 최고치를 보고 값을 올린다.

## `run.sh`가 하는 일

host 형태의 명령을 뺀 각 단계는 `bay -f <file> -p <project>`의 명령 하나다. runner 형태에서 `run.sh`는 report의 시각을
위한 `date` 외에 다른 프로그램을 시작하지 않는다.

1. `bay version --json`: 기록의 첫 줄이 실행한 bay를 적는다.
2. `bay images`: store에 없는 이미지는 실행을 실패시키고 `make persist-images`를 적는다.
3. host 형태: `bay up -no-pull`이 두 서버가 healthy가 된 뒤에 반환한다. 각 서버는 container 안에서 TCP로 묻는
   `healthcheck`를 선언한다. `pg_isready`와 `mysqladmin ping --protocol=tcp`다. 실행은 그 반환만 기다린다. 한도는
   Compose 파일에 있다. 이미지의 초기화를 위한 start period 300초, 그 뒤 실패 3번, 1초마다 질의 한 번이다. Linux arm64
   머신에서 잰 값: MySQL은 70초, PostgreSQL은 11초 뒤에 healthy가 되었다.
4. host 형태: 명령 `make ci-targets TARGETS="..."`. `FSM_TEST_*` DSN 네 개를 환경에 받은 host의 process이고, DSN은
   디렉터리를 쓸 때 `bay plan --json`이 준 각 서버의 host와 port를 적는다.
5. host 형태: `bay down`. trap이 실행한다. 단계가 실패했을 때, 그리고 SIGINT, SIGTERM, SIGHUP 뒤에도 실행하며, signal은
   먼저 실행 중인 단계를 끝낸다.

runner 형태에서 단계 3부터 5는 job 두 개다. `run.sh`는 `build`와 그다음 `check`에 대해 `bay job add -key <commit> <part>`,
`bay job logs -f -timeout 24h <id>`, `bay job wait -timeout 24h <id>`, `bay job show -json <id>`를 실행하고, job을 그
기록으로 판정하며, `build`가 성공한 뒤에만 `check`를 큐에 넣는다. `bay job wait`의 종료 코드가 아니라 기록이 판정한다.
`bay job wait`는 기다림이 job보다 먼저 끝날 때에도 1이기 때문이다. `build`는 `runner.sh build`를 실행한다. system package, Node.js, rustup, `tree.bundle`의
clone, `make bootstrap`, `make install`이고, `work/` 아래에 설치한다. bay는 `bay up`처럼 `check`의 container 전에 서버를
시작하고, `check`는 DSN을 환경에 받아 `runner.sh check make ci-targets TARGETS="..."`를 실행한다. bay는 각 job 뒤에
project를 내리고, part `check`는 그 job이 끝나면 project의 `bay down`을 실행한다. job의 실행을 넘겨받은 agent는 서버를
돌게 두기 때문이다(S-481). signal은 실행 중인 단계를 끝내고 끝나지 않은 job을 취소한다. 끝을 알 수 없는 job도 취소한다. 그 job이
읽는 디렉터리가 실행 뒤에 지워지기 때문이다.

종료 코드는 host 형태에서 target의 종료 코드이고, runner 형태에서 두 job이 성공하면 0, 성공하지 않은 job에 1, 끝을 알 수
없는 job에 3이다. 그 전에 실패한 단계에는 1, 세 signal 뒤에는 130, 143, 129다.

## 실패

| 줄 | 원인 | 할 일 |
|---|---|---|
| `scripts/bay.mts: bay is not found on PATH` | PATH에 bay가 없거나 `BAY`가 적은 프로그램이 없다 | bay를 설치하고 `bay install`을 실행하거나 `BAY`를 고친다 |
| `scripts/bay.mts: the contract of bay is the schema <n>` | 머신의 bay가 실행의 파일이 읽는 계약과 다른 계약을 가진다 | schema 1의 bay를 쓰거나, 새 계약에 맞게 실행의 파일과 테스트의 대역을 바꾼다 |
| `persist-servers: bay plan --json names no host and port of the service <service>` | `bay plan`의 JSON에 그 service나 host나 port가 없다. JSON이 그 줄 뒤에 온다 | JSON을 field `services[].name`, `host`, `port`와 비교한다 |
| `persist-servers: bay plan --json names the service <part> of the project <project> as no job` | 머신의 bay가 `x-bay.job`을 읽지 않는다. JSON이 그 줄 뒤에 온다 | job을 실행하는 bay, 0.0.7 이후의 것을 설치한다 |
| `persist-servers: an image of the project <project> is not installed` | bay의 store에 이미지가 없다 | `make persist-images`를 실행하거나, 실행의 머신에서 `sh <directory>/run.sh pull`을 실행한다 |
| `persist-servers: bay up failed before the servers of the project <project> were healthy` | bay가 파일을 거부했거나, 머신 설정의 한 부분이 빠졌거나, 서버가 시작하지 못했거나 healthy가 되지 않았다. 위의 bay의 줄이 어느 것인지 적는다 | 그 줄을 읽는다. 설정의 빠진 부분이면 `bay install`을 실행한다. 실행은 이미 project를 제거했다 |
| `persist-servers: bay job add failed for the job <part> of the project <project>` | bay가 파일을 거부했거나 bay의 agent가 답하지 않았다. 위의 bay의 줄이 어느 것인지 적는다 | 그 줄을 읽는다. `bay job list`가 머신의 큐를 보여 준다 |
| `persist-servers: the job <part> <id> of the project <project> did not succeed` | job이 `succeeded`가 아닌 상태로 끝났다. 위의 기록이 그 종료 코드를 적는다 | 위의 job의 출력과 `job-<part>.json`을 읽는다 |
| `persist-servers: the job <part> <id> of the project <project> has not ended` | `bay job wait`가 그 한도에서 job보다 먼저 끝났다 | 그 줄이 보여 주는 명령 `sh <directory>/run.sh wait <part>`를 다시 실행한다 |
| `persist-servers: the job <part> <id> of the project <project> has no record` | `bay job show`가 실패했다. 위의 bay의 줄이 이유를 적는다 | 그 줄이 보여 주는 명령을 다시 실행한다. `bay job list`가 머신의 큐를 보여 준다 |
| `persist-servers: the job <part> of the project <project> is not queued here` | `add <part>`가 실행되지 않은 디렉터리에서 `sh run.sh wait <part>`를 실행했다 | 그 디렉터리에서 먼저 `sh <directory>/run.sh add <part>`를 실행한다 |
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

- script가 쓰는 파일로 하는 실제 bay의 실행, 두 형태 모두(S-475-7, S-475-11). 한 단계의 runner 형태의 파일로 잰 것: Linux
  arm64 머신의 runner에서 `db-test-postgres`와 `db-test-mysql`이 통과했다. 재지 않은 것: job 두 개, 그리고 job `check`의
  target과 서버가 함께 3.0 GB보다 낮게 머무는지.
- `ubuntu-26.04-arm`에서 CI의 job `check`의 step들(S-475-5).
