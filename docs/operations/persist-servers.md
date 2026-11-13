<!-- doc-id: operations-persist-servers -->
# The servers of the persistence tests

[한국어](persist-servers.ko.md)

The persistence tests of PostgreSQL and MySQL run on servers that one make target pulls, starts and removes through `bay`.
This document is the procedure; the decision and its reasons are in [the plan](../plans/fsm-v1/plan.md), C-6, and the open
work is in [the checklist](../plans/fsm-v1/checklist.md), S-475 and its sub-items.

## What a machine needs

- `bay` on PATH, with its machine setup applied. bay runs a Compose project on Apple `container` on Darwin and on Docker on
  Linux. No target of this repository installs bay and no tracked file pins its release (S-475-4); a run shows the version
  of the bay that it used. `bay install` applies the machine setup and asks a person for the administrator password; a run
  never runs it, and `bay up` fails and names the missing part when the setup is not complete.
- The two images that `config/containers.json` pins by their digests, PostgreSQL 17.11 and MySQL 8.4.11, in the local store
  of bay.

No script of this repository calls `container` or `docker` itself.

## Commands

```sh
make persist-images
make persist-servers TARGETS="db-test-postgres db-test-mysql"
```

- `make persist-images` pulls the two images with `bay pull`. It is the only target that downloads them: a run pulls
  nothing.
- `make persist-servers TARGETS="..."` runs the targets through `make ci-targets` with both servers. `make check` and
  `make ci-suite` run their targets through it.

## What a run does

1. It fails at once when PATH holds no `bay`, and names the program and what installs it.
2. It shows `persist-servers: bay version: <JSON>`, what `bay version --json` prints.
3. It makes the directory `fsm-persist-<pid>-<random>` in the temporary directory of the system and writes `compose.yaml`
   into it, with the services `postgres` and `mysql`. The file publishes no port of the host and mounts nothing. Each
   command of bay names the file and the project, the name of the directory: `bay -f <directory> -p <project> <command>`.
4. It reads `bay images --json`. An image that the store lacks fails the run and names `make persist-images`; the run then
   removes its directory.
5. It runs `bay up -no-pull --json` and shows each line of its progress as `persist-servers: bay up: <line>`. Each service
   declares a `healthcheck` that asks its server over TCP in the container, `pg_isready` and
   `mysqladmin ping --protocol=tcp`; bay returns after each service is healthy. The run waits for that return alone, with no
   sleep, no polling and no time limit of its own. The bound is in the file: a start period of 300 s for the initialization
   of an image, then 3 failures, one ask each second.
6. It reads the `host` and the `port` of each service from the JSON that `bay up` printed. The DSNs name them.
7. It runs the targets with `FSM_TEST_PG_DSN`, `FSM_TEST_PG_ADMIN_DSN`, `FSM_TEST_MYSQL_DSN` and `FSM_TEST_MYSQL_ADMIN_DSN`.
8. It runs `bay down`, removes the directory and shows `persist-servers: removed the project <project>`. It does so when the
   targets end or fail, when `bay up` fails or its JSON names no service, and after SIGINT and SIGTERM. A signal that comes
   while the servers start is forwarded to `bay up`, which removes what it created.

The exit code of the run is that of the targets, 130 after SIGINT, 143 after SIGTERM and 1 for a failure of the run itself.

## Failures

| Line of the run | Cause | What to do |
|---|---|---|
| `persist-servers: bay is not found on PATH` | PATH holds no bay | Install bay and run `bay install` |
| `persist-servers: the image <reference> of <service> is not installed` | The store of bay lacks the image | Run `make persist-images` |
| `persist-servers: bay up ended with <code>` | bay refused the file, a part of the machine setup is missing, or a service did not start or did not get healthy; the lines `persist-servers: bay up: <line>` above say which, with the output of a service whose health failed | Read those lines; for a missing part of the setup run `bay install`. The run already removed the project |
| `persist-servers: bay up --json names no host and port of the service <service>` | The JSON of `bay up` holds no such service, host or port; the JSON follows the line | Compare the JSON with the fields that step 6 reads |
| `persist-servers: bay down ended with <code>` | bay did not remove the project; its containers may still run | Run the command that the line shows, `bay -f <directory> -p <project> down`, then remove that directory |

## What is not verified and what waits

- No run with real servers has passed yet (S-475). It must show the names of the fields of the JSON of `bay up`, how long
  the initialization of each image takes against the start period, and that both servers answer the first query after
  `bay up` returns.
- The job `check` of CI installs no bay, so its steps `make persist-images` and `make ci-suite` fail on the runner with the
  first line of the table (S-475-5), which waits for a pinned release of bay (S-475-4).
