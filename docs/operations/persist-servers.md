<!-- doc-id: operations-persist-servers -->
# The servers of the persistence tests

[한국어](persist-servers.ko.md)

The persistence tests of PostgreSQL and MySQL run on servers of a Compose project that `bay` runs. A run has two forms. In
the host form, the default, the targets are processes of the machine that starts them. In the runner form, for a machine
whose host holds `sh` and `bay` alone, the run is two jobs of bay: `build` installs the tools of the repository with no
server, and `check` runs the targets with the servers. This document is the procedure; the decision and its reasons are
in [the plan](../plans/fsm-v1/plan.md), C-6, and the open work is in [the checklist](../plans/fsm-v1/checklist.md), S-475
and its sub-items.

## What a machine needs

- The machine that writes a run: the checkout with its tools and `bay` on PATH, and `git` for the runner form. It is a
  machine of development or a runner of CI.
- The machine that executes a run of the host form: the same machine, with the machine setup of bay applied.
- The machine that executes a run of the runner form: `sh`, `bay` with its machine setup applied and the jobs of bay
  (`x-bay.job`, bay 0.0.7), and the container engine of bay. Nothing else of its host is used. It may be the same machine
  or another one.
- The images that `config/containers.json` pins by their digests, in the store of bay: PostgreSQL 17.11 and MySQL 8.4.11,
  and for the runner form Debian `trixie-20261104`, the image of the jobs.
- For the runner form the network, in each run: each job installs the system packages into its new container, and the
  job `build` installs Node.js, rustup and the packages of the locks again; the first three have no pinned digest
  (S-475-8).

bay is a tool of the machine, as make is. A run uses the `bay` of PATH as it is and compares no release; it requires the
schema 1 of the contract of `bay version --json`, and the runner form requires that `bay plan --json` names each part as
a job. A person installs bay on a machine of development, because its setup, `bay install`, asks for the administrator
password; no target does it there.

`BAY` holds the words that start bay, and it is `bay` when it is not set. Set it where bay must be started in another way:
on a machine where the state of bay belongs to root and the user has `sudo` without a password, `BAY="sudo -n bay"`.

## Commands

```sh
make persist-images
make persist-servers TARGETS="db-test-postgres db-test-mysql"
make persist-servers-runner TARGETS="db-test-postgres db-test-mysql"
make persist-servers-write TARGETS="db-test-postgres db-test-mysql"
```

- `make persist-images` pulls the three images with `bay pull`. It is the only target that downloads an image.
- `make persist-servers TARGETS="..."` writes the directory of a run of the host form, executes it and removes it: the
  targets are processes of this machine. `make check` and `make ci-suite` run their targets through it.
- `make persist-servers-runner TARGETS="..."` writes a directory of the runner form, runs its two jobs on this machine,
  waits for them and removes the directory.
- `make persist-servers-write TARGETS="..."` writes a directory of the runner form and prints its path, for a run on
  another machine (below).

In the runner form the targets run on the committed tree of the branch of the checkout: commit before such a run.

## A run on another machine

A job runs in a process of the agent of bay on the machine that holds it and keeps its state, its exit code, its time and
its output, so a connection that ends while the job runs ends no job and loses no result. The machine of development
queues each job there over `ssh` and waits for it there over `ssh`, so the wait runs on the machine of the job.
`<machine>` is the `ssh` host and `<remote>` a directory there.

```sh
directory=$(make -s persist-servers-write TARGETS="db-test-postgres db-test-mysql")
project=${directory##*/}
scp -r "$directory" <machine>:<remote>/
ssh <machine> sh <remote>/$project/run.sh pull          # only when the images are not there
ssh <machine> sh <remote>/$project/run.sh add build
ssh <machine> sh <remote>/$project/run.sh wait build
ssh <machine> sh <remote>/$project/run.sh add check     # only after wait build ended with 0
ssh <machine> sh <remote>/$project/run.sh wait check
ssh <machine> rm -r <remote>/$project
```

- `sh run.sh add <part>` prints the id of the job alone on standard output, so `id=$(ssh <machine> sh <remote>/$project/run.sh add build)`
  holds it; every other line of `run.sh` is on standard error. It writes the id to `job-<part>` of the directory, which
  `wait <part>` reads.
- `sh run.sh add <part>` queues the job with the commit of the bundle as its key, so after a connection that ended before
  the id was read, the same command returns the same job and queues no second one.
- `sh run.sh wait <part>` shows the output of the job, waits for it and writes its record, `bay job show -json`, to
  `job-<part>.json` of the directory. It ends with 0 when the job ended and succeeded, 1 when it ended and did not, 3 when
  it has not ended or bay shows no record, and 2 when `add` did not queue the part. It cancels nothing: after a
  connection that dropped or the code 3, the job runs on and the same command waits again.
- Queue `check` only after `wait build` ended with 0: `check` runs on what `build` installed.
- Remove the directory there after the last job ended: it holds the records of the jobs.
- Remove the directory there after the last job ended. `runner.sh` gave the files of `work/` to the owner of the
  directory, so no rights of the container are needed.

## The directory of a run

`var/persist-servers/fsm-persist-<pid>-<random>` holds `compose.yaml` and `run.sh`. In the runner form `compose.yaml`
also holds the job `check`, and the directory also holds `compose.build.yaml`, the job `build` alone, `runner.sh`, the
command of the two jobs, and `tree.bundle`, the Git bundle of the branch. Each job mounts this directory writable and
nothing of the checkout; the job `build` writes the tools and the clone below `work/`, on which the job `check` runs.
`run.sh` writes `report.txt` into the directory.

## The report and the memory of a run

`report.txt` holds one line for each event, the time in UTC and the event: `<step> start` and `<step> exit <code>` for
each step, and `run exit <code>`. The steps are `version` and `images`, then `up`, `command` and `down` in the host form,
and in the runner form `add <part>`, `logs <part>`, `wait <part>` and `show <part>` for `build` and then `check`, with the
line `job <part> <id>`; `sh run.sh add <part>` writes the lines of `add <part>`, and `sh run.sh wait <part>` those of
`version`, `logs <part>`, `wait <part>` and `show <part>`. The host form also writes `memory.peak <service> <bytes>` for each service, the highest use that
the cgroup of its container recorded, read with `bay exec <service> cat /sys/fs/cgroup/memory.peak` before the project is
removed; `not read` stands for a container that has no such file. In the runner form `bay job show -json` writes the
record of each job to `job-<part>.json`, which `run.sh` also shows; `bay job list` shows the memory peak of each job where
the machine reports one. The run shows each line as `persist-servers: <line>`;
the targets that remove the directory leave these lines alone.

A machine may hold less memory than the services of a run take together: on a Linux machine of 3.7 GB the containers of bay
slow down at 2.6 GB together and their processes are ended at 3.0 GB. The pin of each image in `config/containers.json`
holds `memory`, which the Compose file holds as `mem_limit` of that service: PostgreSQL `448m` and MySQL `640m`, above
their peaks of 380 MiB and 552 MiB, and the runner `2560m`, above the peak of 2506 MiB of its installation. The job
`build` runs with no server, so the installation and the servers do not hold their memory at once. A limit below what a
service needs ends its processes: raise a value from the peak of a report.

## What `run.sh` does

Each step but the command of the host form is one command of `bay -f <file> -p <project>`; in the runner form `run.sh`
starts no other program but `date`, for the time of its report.

1. `bay version --json`: the first line of the record names the bay that ran.
2. `bay images`: an image that the store lacks fails the run and names `make persist-images`.
3. The host form: `bay up -no-pull` returns after both servers are healthy. Each server declares a `healthcheck` that
   asks it over TCP in its container, `pg_isready` and `mysqladmin ping --protocol=tcp`. The run waits for that return
   alone. The bound is in the Compose file: a start period of 300 s for the initialization of an image, then 3 failures,
   one ask each second. Measured on a Linux arm64 machine: MySQL healthy after 70 s, PostgreSQL after 11 s.
4. The host form: the command, `make ci-targets TARGETS="..."`, a process of the host with the four `FSM_TEST_*` DSNs in
   its environment, which name the host and the port of each server as `bay plan --json` gave them when the directory was
   written.
5. The host form: `bay down`, by a trap: also when a step failed and after SIGINT, SIGTERM and SIGHUP, which first end the
   step that runs.

In the runner form steps 3 to 5 are the two jobs. For `build` and then `check`, `run.sh` runs `bay job add -key <commit>
<part>`, `bay job logs -f -timeout 24h <id>`, `bay job wait -timeout 24h <id>` and `bay job show -json <id>`, judges the
job by its record, and queues `check` only after `build` succeeded. The record decides and not the exit code of
`bay job wait`, which is 1 also when the wait ends before the job. `build` runs `runner.sh build`: the system packages, Node.js, rustup, the clone of
`tree.bundle`, `make bootstrap` and `make install`, below `work/`. bay starts the servers before the container of `check`,
as `bay up` does, and `check` runs `runner.sh check make ci-targets TARGETS="..."` with the DSNs in its environment. bay
takes the project down after each job. A signal ends the step that runs and cancels the job that has not ended, and so
does a job whose end is not known, because the directory that it reads is removed after the run.

The exit code of the host form is that of the targets; of the runner form 0 when both jobs succeeded, 1 for a job that
did not and 3 for a job whose end is not known; and 1 for a step that failed before, and 130, 143 and 129 after the three
signals.

## Failures

| Line | Cause | What to do |
|---|---|---|
| `scripts/bay.mts: bay is not found on PATH` | PATH holds no bay, or not the program that `BAY` names | Install bay and run `bay install`, or correct `BAY` |
| `scripts/bay.mts: the contract of bay is the schema <n>` | The bay of the machine has another contract than the one that the files of a run read | Use a bay of the schema 1, or change the files of a run and the stand-in of the tests for the new contract |
| `persist-servers: bay plan --json names no host and port of the service <service>` | The JSON of `bay plan` holds no such service, host or port; the JSON follows the line | Compare the JSON with the fields `services[].name`, `host` and `port` |
| `persist-servers: bay plan --json names the service <part> of the project <project> as no job` | The bay of the machine does not read `x-bay.job`; the JSON follows the line | Install a bay that runs jobs, 0.0.7 or later |
| `persist-servers: an image of the project <project> is not installed` | The store of bay lacks an image | Run `make persist-images`, or `sh <directory>/run.sh pull` on the machine of the run |
| `persist-servers: bay up failed before the servers of the project <project> were healthy` | bay refused the file, a part of the machine setup is missing, or a server did not start or did not get healthy; the lines of bay above say which | Read those lines; for a missing part of the setup run `bay install`. The run already removed the project |
| `persist-servers: bay job add failed for the job <part> of the project <project>` | bay refused the file or the agent of bay did not answer; the lines of bay above say which | Read those lines; `bay job list` shows the queue of the machine |
| `persist-servers: the job <part> <id> of the project <project> did not succeed` | The job ended with another state than `succeeded`; its record above names its exit code | Read the output of the job above and `job-<part>.json` |
| `persist-servers: the job <part> <id> of the project <project> has not ended` | `bay job wait` ended before the job, at its bound | Run the command that the line shows, `sh <directory>/run.sh wait <part>`, again |
| `persist-servers: the job <part> <id> of the project <project> has no record` | `bay job show` failed; the lines of bay above say why | Run the command that the line shows again; `bay job list` shows the queue of the machine |
| `persist-servers: the job <part> of the project <project> is not queued here` | `sh run.sh wait <part>` ran in a directory where `add <part>` did not run | Run `sh <directory>/run.sh add <part>` in that directory first |
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

- A run of the files that the script writes, with a real bay, in either form (S-475-7, S-475-11). Measured with files of
  the runner form of one phase: `db-test-postgres` and `db-test-mysql` passed in a runner on a Linux arm64 machine. Not
  measured: the two jobs, and whether the targets of the job `check` and the servers stay below 3.0 GB together.
- The steps of the job `check` of CI on `ubuntu-26.04-arm` (S-475-5).
