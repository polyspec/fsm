<!-- doc-id: operations-persist-servers -->
# The servers of the persistence tests

[한국어](persist-servers.ko.md)

The persistence tests of PostgreSQL and MySQL run on servers that one make target starts and removes through `bay`. This
document is the procedure; the decision and its reasons are in [the plan](../plans/fsm-v1/plan.md), C-6, and the open work
is in [the checklist](../plans/fsm-v1/checklist.md), S-475 and its sub-items.

## What a machine needs

- `bay` on PATH, with its machine setup applied: `bay check` passes. bay runs a Compose project on Apple `container` on
  Darwin and on Docker on Linux. No target of this repository installs bay and no tracked file pins its release (S-475-4).
  `bay install` applies the machine setup and asks a person for the administrator password; a run never runs it.
- The container program of the platform on PATH: Apple `container` on Darwin, `docker` on Linux. A run asks it whether the
  images are installed, and `make persist-images` pulls with it, because bay has no command for either (S-475-2).
- The two images that `config/containers.json` pins by their digests, PostgreSQL 17.11 and MySQL 8.4.11.

## Commands

```sh
make persist-images
make persist-servers TARGETS="db-test-postgres db-test-mysql"
```

- `make persist-images` pulls the two images. It is the only target that downloads them: a run pulls nothing.
- `make persist-servers TARGETS="..."` runs the targets through `make ci-targets` with both servers. `make check` and
  `make ci-suite` run their targets through it.

## What a run does

1. It fails at once when PATH holds no `bay` or no container program, and names the program and what installs it.
2. It runs `bay check`. A failing check fails the run with the lines of the check; then run `bay install` and start the run
   again.
3. It asks the container program whether each image is installed. A missing image fails the run and names
   `make persist-images`.
4. It makes the directory `fsm-persist-<pid>-<random>` in the temporary directory of the system and writes `compose.yaml`
   into it. The project has the name of the directory and the services `postgres` and `mysql`. The file publishes no port
   of the host and mounts nothing. Each service declares a `healthcheck` that asks its server over TCP in the container,
   `pg_isready` and `mysqladmin ping --protocol=tcp`, each second and at most 300 times.
5. It runs `bay up` in that directory and shows each line as `persist-servers: bay up: <line>`. bay checks the declared
   health and returns after each service is healthy; the run waits for that return alone, with no sleep, no polling and no
   time limit of its own.
6. It runs `bay status --json` and reads the field `address` of each service of its project. The DSNs name that address and
   the port of the server, `5432` and `3306`.
7. It runs the targets with `FSM_TEST_PG_DSN`, `FSM_TEST_PG_ADMIN_DSN`, `FSM_TEST_MYSQL_DSN` and `FSM_TEST_MYSQL_ADMIN_DSN`.
8. It runs `bay down` in the directory, removes the directory and shows `persist-servers: removed the project <project>`.
   It does so when the targets end or fail, when `bay up` fails or an address is missing, and after SIGINT and SIGTERM.

The exit code of the run is that of the targets, 130 after SIGINT, 143 after SIGTERM and 1 for a failure of the run itself.

## Failures

| Line of the run | Cause | What to do |
|---|---|---|
| `persist-servers: bay is not found on PATH` | PATH holds no bay | Install bay and run `bay install` |
| `persist-servers: bay check ended with <code>` | A part of the machine setup of bay is missing; the lines above name it | Run `bay install` |
| `persist-servers: the image <reference> of <kind> is not installed` | The image is not in the container program | Run `make persist-images` |
| `persist-servers: bay up ended with <code>` | A service did not start or did not get healthy within its 300 asks; the lines `persist-servers: <service>: <line>` above are the last 40 lines of each service | Read those lines; the run already removed the project |
| `persist-servers: bay status --json names no address of the service <service>` | The JSON of bay holds no address of a service of the project; the JSON follows the line | Compare the JSON with the fields that step 6 reads |
| `persist-servers: bay down ended with <code>` | bay did not remove the project; its containers may still run | Run `bay down` in the directory that the line names, then remove that directory |

## What is not verified and what waits

- No run with real servers has shown yet that bay counts the asks during the initialization of an image against the 300,
  and that both servers answer the first query after `bay up` returns (S-475).
- `bay check` also reports the agent skill and the MCP registration of bay, which no server needs; whether a machine
  without them fails the check is not verified (S-475-6).
- The job `check` of CI installs no bay, so its suite step fails on the runner with the first line of the table (S-475-5).
- The project name on the command line of bay (S-475-1), a pull through bay (S-475-2), a JSON output of `bay up`
  (S-475-3) and a pinned release of bay (S-475-4) wait for releases of bay.
