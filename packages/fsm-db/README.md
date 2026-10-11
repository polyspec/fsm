<!-- doc-id: readme-db -->
# @polyspec/fsm-db

[한국어](README.ko.md)

The DB store of fsm and its command line, `fsm-db`. A fsm project can keep its definitions and its lock in six tables of
an orm database instead of files (`docs/spec/fsm.md`, B-2; `docs/plans/fsm-v1.md`, C-6). The package is private and is not
published: it is used from this repository.

## What it is

- The store (`src/db-store.mjs`) converts the rows of the six tables into the definitions and the lock that the core of
  fsm checks and writes. The core validates; the store only converts and writes, in one transaction.
- `fsm-db` runs the core commands against this store: `install`, `check`, `lock` and `copy`.
- A project uses one store, named in its `fsm.config.json`: `json`, `mermaid` (the file stores of `fsm-gen`) or `db`.
  `fsm-gen` does not handle `db`; `fsm-db` handles only `db`.

## Set up

1. Install the packages from the repository root with `make db-deps`. It installs `@polyspec/orm` and
   `@polyspec/ordered-json` v0.0.7 from their release tarballs, pinned in `package-lock.json`.
2. Create `fsm.config.json` in the project root. The only accepted form for the database is:

   ```json
   {"store":"db","dsnEnv":"FSM_DSN"}
   ```

   `dsnEnv` names the environment variable that holds the DSN. The DSN itself is never written in the file.
3. Set that variable to the DSN of the database (see [DSN](#dsn)).
4. Put the command `fsm-db` on the PATH: `npm install -g ./packages/fsm-db` from the repository root. npm links the
   package of the clone, so the command runs the code of the clone.
5. Create the six tables: `fsm-db install`.

`--project <dir>` names the project root, which defaults to the current directory.

## The six tables

The tables are the document set of `schema/fsm.dbs` (dbspec `fsm`). The first four hold the definitions, the last two the
lock.

| table | columns | keys |
|---|---|---|
| `machine` | `name` | PK(`name`) |
| `state` | `machine`, `key`, `code`, `position`, `initial`, `final` | PK(`machine`, `key`); unique(`machine`, `code`); unique(`machine`, `position`); FK `machine` |
| `event` | `machine`, `key`, `position` | PK(`machine`, `key`); FK `machine` |
| `edge` | `machine`, `event`, `from`, `to`, `position` | PK(`machine`, `event`, `from`); FK to `event`; FK `from` and `to` to `state` |
| `lock_code` | `machine`, `code`, `key` | PK(`machine`, `code`) |
| `lock_reserved` | `machine`, `code` | PK(`machine`, `code`) |

The lock tables have no foreign key to `machine`, so the lock of a machine that was removed from the definitions stays.
orm also creates its own table `orm__row_lock` in the database (observed with SQLite); fsm-db does not read or write it.

## DSN

The DSN is the value of the environment variable that `dsnEnv` names. fsm-db reads no DSN from any other place. The
DSN forms that orm v0.0.7 documents (`docs/config.md` of the orm repository) are:

```text
mysql://user:password@host:3306/orm_example
mysql://user@localhost/orm_example?socket=/tmp/mysql.sock
postgres://user:password@host:5432/orm_example?sslmode=disable
postgres:///orm_example?host=/tmp
sqlite:///var/lib/orm_example.sqlite?_pragma=busy_timeout(5000)
```

- The scheme selects MySQL, PostgreSQL or SQLite.
- A SQLite path must be absolute: `sqlite://` followed by the absolute path, so `sqlite:///var/...` for `/var/...`. A
  relative path is rejected by orm with `CONFIG`; for example `FSM_DSN=sqlite://fsm.sqlite` prints
  `[fsm-db] OrmError: CONFIG: sqlite DSN must include an absolute database path`.
- A SQLite connection waits up to 5000 milliseconds for a lock that another connection holds; the parameter
  `_pragma=busy_timeout(ms)` changes that wait.
- The tests of this package run on SQLite only. orm accepts the MySQL and PostgreSQL forms; this package has no test for
  them.

```sh
export FSM_DSN=sqlite:///var/lib/fsm/order.sqlite
```

## Commands

Every command takes `--project <dir>`. An `E_...` finding prints as `[fsm-db] <code> <machine> <path>: <message>` on
stderr (`-` in place of a missing machine).

### install

Installs the six tables, and the table of orm itself, through orm `utils().schema().install`. The behaviour, as observed with orm v0.0.7
and tested in `tests/cli.test.mjs`, depends on the database:

- No table exists: the tables are created and the command prints `[fsm-db] install: ok`, exit 0.
- All six tables exist: nothing is changed, the command prints the same line, exit 0. Running `install` again is safe.
- Only some of the tables exist: orm rejects the install with `CONFIG`. The command prints the error with its stack, and
  exits 1. Nothing is repaired automatically: there is no fallback.

```sh
$ fsm-db install --project ./order-machines
[fsm-db] install: ok
```

### check

Checks the stored definitions and lock with the core rules of `docs/spec/fsm.md` (B-5). On a database without the tables
the command fails with orm's error, printed with its stack, and exits 1.

```sh
$ fsm-db check --project ./order-machines
[fsm-db] check: ok
```

On a database that has no table yet, `check` fails:

```sh
$ fsm-db check --project ./new-machines
[fsm-db] OrmError: DRIVER: sqlite: no such table: machine
    at ...
```

### lock

Runs the core `lock` command on the database (`docs/spec/fsm.md`, B-3). `--rename machine.old=new` renames a state key
before the lock is written; the renamed state keeps its code. Names contain no `.` and no `=`.

```sh
$ fsm-db lock --project ./order-machines --rename order.draft=created
[fsm-db] lock: ok
```

A rename of an unknown state is a finding:

```sh
$ fsm-db lock --project ./order-machines --rename order.nope=x
[fsm-db] E_UNKNOWN_STATE_REF order $.states: state nope is not a state of order
```

### copy

Moves the definitions and the lock between the database and a file store. One of `--to` or `--from` names the file store,
`json` or `mermaid`; `--root` names its directory.

- `copy --to json|mermaid --root <dir>`: the database is the source, `<dir>` receives the files.
- `copy --from json|mermaid --root <dir>`: the database is the target. It must be empty (no rows in the six tables); a
  non-empty target fails with `E_STORE_NOT_EMPTY` and writes nothing.

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

### Exit codes

| code | meaning |
|---|---|
| 0 | the command succeeded; stdout holds `[fsm-db] <command>: ok` |
| 1 | a finding (on stderr), or an unexpected rejection of orm or of the store, printed with its stack |
| 2 | a usage error: an unknown command, an option that the command does not take, or a missing or invalid value; the usage lines are on stderr |

A `copy` without `--root`, or without `--to` or `--from`, is a usage error. `install` takes only `--project`.

## Moving an existing json or mermaid project to the database

fsm-db does not change `fsm.config.json` for you; the change is yours to make after the copy is checked.

1. Check the file project: `fsm-gen check --project ./order-machines` prints `[fsm-gen] check: ok`. Commit the project,
   so the files stay in history.
2. Change `fsm.config.json` to `{"store":"db","dsnEnv":"FSM_DSN"}` and set `FSM_DSN`.
3. Create the tables: `fsm-db install --project ./order-machines`.
4. Copy the files into the database: `fsm-db copy --from json --root ./order-machines --project ./order-machines`
   (use `mermaid` for a `*.fsm.mmd` project). The target must be empty; a second copy fails with `E_STORE_NOT_EMPTY`.
5. Check the database: `fsm-db check --project ./order-machines`.
6. Remove the `machines/` files and `fsm.lock.json` when the database is the source of truth. Until then they are not read.

While the configuration names `db`, `fsm-gen` refuses the project with `E_STORE_NOT_CONFIGURED`. To generate code from
a database, export it into a directory whose `fsm.config.json` names the file store, then run `fsm-gen` there:

```sh
$ fsm-db copy --to json --root ./export --project ./order-machines
[fsm-db] copy: ok
$ echo '{"store":"json"}' > ./export/fsm.config.json
$ fsm-gen check --project ./export
[fsm-gen] check: ok
```
