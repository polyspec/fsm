<!-- doc-id: status-gui-readme -->
# status GUI

[한국어](README.ko.md).

The GUI of status (`docs/plans/status-v1.md`, C-7): a hyper server that shows the state machines of a project. The list page
shows every machine, and the detail page shows its states, its events with their edges, and its Mermaid diagram in the
canonical form of `docs/spec/status.md`, B-1. The GUI owns no rule: the definitions come from the store that
`status.config.json` names (json, mermaid or db), and every check goes through the core `run`. Editing is not in this
version (S-17).

## Run

Install and build the browser assets once. The build writes `build/` and `public/assets/`, which are ignored by git:

```sh
make gui-build
```

Start the server from the project directory, or name it with `--project`:

```sh
cd packages/status-gui
node src/main.mjs --project /path/to/project --port 8080
```

The server listens on `127.0.0.1` and prints its address. Open `http://127.0.0.1:8080/` for the machine list and
`http://127.0.0.1:8080/machines/<machine>` for a machine. Sessions are kept in `<project>/var/sessions`.

| Option | Meaning |
|---|---|
| `--project <dir>` | The project root, whose `status.config.json` selects the store. The default is the current directory. |
| `--port <n>` | The port on `127.0.0.1`, from 0 to 65535. The default is 8080. |

The store follows `status.config.json`:

| Configuration | Store |
|---|---|
| `{"store":"json"}` | `machines/*.status.json` and `status.lock.json` |
| `{"store":"mermaid"}` | `machines/*.status.mmd` and `status.lock.json` |
| `{"store":"db","dsnEnv":"STATUS_DSN"}` | the database whose DSN is the value of `STATUS_DSN`; the orm packages of `packages/status-db` must be installed (`make db-deps`) |

A configuration that the GUI cannot use exits with status 1 and prints the finding, such as `E_STORE_NOT_CONFIGURED`.
Every page shows the findings of the project as errors, including the load findings of a file that cannot be read. A
machine with a finding of its own shows its findings and no diagram.

## Tests

```sh
make gui-test
```

`gui-test` builds the assets, then runs the tests of `tests/`: the pages through the hyper application without HTTP, the
server process over HTTP, the store selection, and the parse of the canonical form with the pinned Mermaid package. The
parse test loads Mermaid in Node with a minimal DOMPurify stub (`tests/support/`), because Mermaid sanitizes label text
with a browser DOM that Node does not have.

## Layout

| Path | Role |
|---|---|
| `app/app.json` | The hyper manifest: the page region and the routes `/` and `/machines/{machine}` |
| `templates/` | The layout, the title and the pages of the machine list and detail |
| `crud/machines.yml` | The crudui declaration of the machine list, without validation rules |
| `client/main.ts` | The browser entry: the hyper client, and Mermaid on the first load and after every htmx swap |
| `src/main.mjs` | The server entry |
| `src/store.mjs` | The store selection from `status.config.json` |
| `src/handlers.mjs` | The loaders of the list and the detail |
| `build/` | The output of `make gui-build`: `templates.index.json`, `manifest.json` (ignored) |
| `public/assets/` | The client bundle and its chunks (ignored) |

The versions of the dependencies are pinned in `package.json` and `package-lock.json` and recorded in
`config/dependency-policy.json`: hyper v0.0.11, crudui v0.0.5, the template v0.0.5 and mermaid, with the same release
URLs in `overrides` for the `@polyspec/*` packages that they depend on.
