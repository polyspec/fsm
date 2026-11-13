<!-- doc-id: operations-persist-servers -->
# The servers of the persistence tests

[한국어](persist-servers.ko.md)

The persistence tests of PostgreSQL and MySQL run in a Compose project that `bay` runs: the two servers and a service
`runner`, in which the targets run. This document is the procedure; the decision and its reasons are in
[the plan](../plans/fsm-v1/plan.md), C-6, and the open work is in [the checklist](../plans/fsm-v1/checklist.md), S-475 and
its sub-items.

## What a machine needs

- The machine that writes a run: the checkout with its tools, `git`, and `bay` on PATH. It is a machine of development or a
  runner of CI.
- The machine that executes a run: `sh`, `bay` with its machine setup applied, and the container engine of bay. Nothing else
  of its host is used. It may be the same machine or another one.
- The three images that `config/containers.json` pins by their digests, in the store of bay: PostgreSQL 17.11, MySQL 8.4.11
  and Debian `trixie-20261104`, the image of the runner.
- The network, in each run: the runner installs its system packages, Node.js, rustup and the packages of the locks again,
  because its container is new (S-475-8).

bay is a tool of the machine, as make is. A run uses the `bay` of PATH as it is and compares no release; it requires the
schema 1 of the contract of `bay version --json`. A person installs bay on a machine of development, because its setup,
`bay install`, asks for the administrator password; no target does it there.

`BAY` holds the words that start bay, and it is `bay` when it is not set. Set it where bay must be started in another way:
on a machine where the state of bay belongs to root and the user has `sudo` without a password, `BAY="sudo -n bay"`.

## Commands

```sh
make persist-images
make persist-servers TARGETS="db-test-postgres db-test-mysql"
make persist-servers-write TARGETS="db-test-postgres db-test-mysql"
```

- `make persist-images` pulls the three images with `bay pull`. It is the only target that downloads an image.
- `make persist-servers TARGETS="..."` writes the directory of a run, executes it and removes it. `make check` and
  `make ci-suite` run their targets through it, so those targets run in the runner, on Linux.
- `make persist-servers-write TARGETS="..."` writes the directory and prints its path, for a run on another machine: move
  the directory there, run `sh <directory>/run.sh`, and remove the directory afterwards. `sh <directory>/run.sh pull` pulls
  the images there.

The targets run on the committed tree of the branch of the checkout: commit before a run.

## The directory of a run

`var/persist-servers/fsm-persist-<pid>-<random>` holds `compose.yaml`, `run.sh`, `runner.sh` and `tree.bundle`, the Git
bundle of the branch. The runner mounts this directory read-only and nothing of the checkout.

## What `run.sh` does

Each step is one command of `bay -f <directory> -p <project>`, and `run.sh` starts no other program.

1. `bay version --json`: the first line of the record names the bay that ran.
2. `bay images`: an image that the store lacks fails the run and names `make persist-images`.
3. `bay up -no-pull`: it returns after both servers are healthy. Each server declares a `healthcheck` that asks it over TCP
   in its container, `pg_isready` and `mysqladmin ping --protocol=tcp`. The run waits for that return alone. The bound is in
   the Compose file: a start period of 300 s for the initialization of an image, then 3 failures, one ask each second.
   Measured on a Linux arm64 machine: MySQL healthy after 70 s, PostgreSQL after 11 s.
4. `bay exec runner sh /persist-run/runner.sh make ci-targets TARGETS="..."`, with the four `FSM_TEST_*` DSNs, which name
   the host and the port of each server as `bay plan --json` gave them when the directory was written. `runner.sh` installs
   the system packages, Node.js and rustup, clones `tree.bundle`, runs `make bootstrap` and `make install` and then the
   targets.
5. `bay down`, by a trap: also when a step failed and after SIGINT, SIGTERM and SIGHUP, which first end the command of bay
   that runs.

The exit code is that of the targets, 1 for a step that failed before them, and 130, 143 and 129 after the three signals.

## Failures

| Line | Cause | What to do |
|---|---|---|
| `scripts/bay.mts: bay is not found on PATH` | PATH holds no bay, or not the program that `BAY` names | Install bay and run `bay install`, or correct `BAY` |
| `scripts/bay.mts: the contract of bay is the schema <n>` | The bay of the machine has another contract than the one that the files of a run read | Use a bay of the schema 1, or change the files of a run and the stand-in of the tests for the new contract |
| `persist-servers: bay plan --json names no host and port of the service <service>` | The JSON of `bay plan` holds no such service, host or port; the JSON follows the line | Compare the JSON with the fields `services[].name`, `host` and `port` |
| `persist-servers: an image of the project <project> is not installed` | The store of bay lacks an image | Run `make persist-images`, or `sh <directory>/run.sh pull` on the machine of the run |
| `persist-servers: bay up failed before the servers of the project <project> were healthy` | bay refused the file, a part of the machine setup is missing, or a server did not start or did not get healthy; the lines of bay above say which | Read those lines; for a missing part of the setup run `bay install`. The run already removed the project |
| `persist-servers: bay down failed` | bay did not remove the project; its containers may still run. The directory stays and holds the file `down-failed` | Run the command that the line shows, `bay -f <directory> -p <project> down`, then remove the directory |

## bay on a runner of CI

`config/toolchain.json` names the release of bay that CI installs, with the sha256 of the archive of each platform. No run
reads it. `make bay-install` downloads that archive, fails unless its sha256 is the pinned one, installs `bay` and `bayd`
into `/usr/local/bin` with `sudo -n`, applies the machine setup with `bay install` and requires `bay check -scope run`. The
job `check` runs it before `make persist-images` and sets `BAY` to `sudo -n bay` for its steps of bay.

To raise the release: replace the version and the four digests of `config/toolchain.json` with those of the new release,
which its file `SHA256SUMS` names, and run `make bay-test`. A release that changes a command or an output that plan C-6
names changes the files of a run and the stand-in `bay` of the tests in the same change.

## What is not verified

- A run of the files that the script writes, with a real bay (S-475-7). Measured with files of the same form written by
  hand: `db-test-postgres` and `db-test-mysql` pass in a runner on a Linux arm64 machine.
- The other targets of `make check` in the runner: the system packages of the pin may not hold what they need.
- The steps of the job `check` on `ubuntu-26.04-arm` (S-475-5).
