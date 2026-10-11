<!-- doc-id: fsm-gui-readme -->
# fsm GUI

[한국어](README.ko.md).

The GUI of fsm (`docs/plans/fsm-v1.md`, C-7): a hyper server that shows the state machines of a project. The list page
shows every machine, and the detail page shows its states, its events with their edges, and its Mermaid diagram in the
canonical form of `docs/spec/fsm.md`, B-1. The GUI owns no rule: the definitions come from the store that
`fsm.config.json` names (json, mermaid or db), and every check goes through the core `run`. The same pages edit the
machines (see Edit).

## Run

Install and build the browser assets once. The build writes `build/` and `public/assets/`, which are ignored by git:

```sh
make gui-build
```

Put the command `fsm-gui` on the PATH from the repository root. npm links the package of the clone, so the command runs
the code and the built assets of the clone:

```sh
npm install -g ./packages/fsm-gui
```

Start the server from the project directory, or name it with `--project`:

```sh
fsm-gui --project /path/to/project --port 8080
```

The server listens on `127.0.0.1` and prints its address. Open `http://127.0.0.1:8080/` for the machine list and
`http://127.0.0.1:8080/machines/<machine>` for a machine. Sessions are kept in `<project>/var/sessions`.

| Option | Meaning |
|---|---|
| `--project <dir>` | The project root, whose `fsm.config.json` selects the store. The default is the current directory. |
| `--port <n>` | The port on `127.0.0.1`, from 0 to 65535. The default is 8080. |

The store follows `fsm.config.json`:

| Configuration | Store |
|---|---|
| `{"store":"json"}` | `machines/*.fsm.json` and `fsm.lock.json` |
| `{"store":"mermaid"}` | `machines/*.fsm.mmd` and `fsm.lock.json` |
| `{"store":"db","dsnEnv":"FSM_DSN"}` | the database whose DSN is the value of `FSM_DSN`; the orm packages of `packages/fsm-db` must be installed (`make db-deps`) |

A configuration that the GUI cannot use exits with status 1 and prints the finding, such as `E_STORE_NOT_CONFIGURED`.
Every page shows the findings of the project as errors, including the load findings of a file that cannot be read. A
machine with a finding of its own shows its findings and no diagram.

## Edit

The detail page of a machine links to its edit and rename screens and has a button that deletes it. The new machine screen
is at `/new`.

| Screen | Path | What a save does |
|---|---|---|
| Edit | `/machines/<machine>/edit` | Saves the states (key, code, `initial`, `final`) and the events with their edges. |
| Rename | `/machines/<machine>/rename` | Gives a state a new key and keeps its code. |
| New | `/new` | Creates the machine with one state, which is both the initial and the final state, and no event. |
| Delete | the button of the detail page | Saves the store without the machine. |

Every save calls core `run` with `save` (edit, new and delete) or `lock` with renames (rename), so the rules are the core's:

- A refused save writes nothing. Every finding of the save is shown on the page, and a finding that names a field of the
  form is shown on that field. A finding without a field, such as a finding of the whole machine, is a form error.
- A stored state keeps its key and its code in the edit form, and both are read-only. The core refuses an edited code
  (`E_CODE_CHANGED`) and a changed key (`E_CODE_KEY_CHANGED`) even when a request is edited by hand. A key changes only on the
  rename screen.
- A new state gets a code when the form is saved. The edit page carries the code that core `nextCode` suggests for its
  machine in its embedded form state, and the browser gives each state added in the form the next code, then the codes
  after it (`client/new-codes.ts`). The save checks every code, and a blank code is still filled by `nextCode` on the
  server. When `nextCode` gives no code (`E_CODE_RANGE`), the page carries null, the browser gives none, and the save shows
  the finding.
- Deleting a machine, or a state, moves its codes to `reserved` in `fsm.lock.json`, so a later state never takes them
  (`docs/spec/fsm.md`, B-3). A deleted machine that is added again starts after its reserved codes.
- Each save, rename or delete must carry the `_csrf` token of the page that it was sent from; without it the server answers
  403 and writes nothing.
- The rows of the edit form are added and removed in the browser: `client/main.ts` binds the rendered form with crudui
  `connectForm` after the page loads and after every htmx swap, and re-renders the form into its host after every row change
  (`patchContent` with the page's render options, then `connection.sync()`). The rows need the browser; without JavaScript the form
  saves the rows that it shows.

A malformed body, such as a field name that is not `form[...]` or a repeated field, answers 400 and writes nothing.

## Tests

```sh
make gui-browsers
make gui-test
make gui-browser-test
```

`gui-browsers` downloads the Chromium of the pinned Playwright package (an exact devDependency of this package) from the
Playwright CDN; it is ONLINE and runs once per machine. `gui-browser-test` builds the assets, starts the GUI on a temporary
project and drives the edit form in that Chromium (`tests/browser/browser.test.mjs`): add a state row, save a state with an
edge, remove it, and check the suggested codes, the stored machine and lock, and the Mermaid diagram.

`gui-test` builds the assets, then runs the top-level tests of `tests/`: the pages through the hyper application without HTTP, the
server process over HTTP, the store selection, and the parse of the canonical form with the pinned Mermaid package. The
parse test loads Mermaid in Node with a minimal DOMPurify stub (`tests/support/`), because Mermaid sanitizes label text
with a browser DOM that Node does not have. The edit tests (`edit-machine`, `rename-machine`, `machine-lifecycle` and
`edit-http`) run each screen on the json, mermaid and db stores; `check` passes on the json and mermaid projects after a save.

## Layout

| Path | Role |
|---|---|
| `app/app.json` | The hyper manifest: the page region and the routes `/` and `/machines/{machine}` |
| `templates/` | The layout, the title and the pages of the machine list and detail |
| `crud/machines.yml` | The crudui declaration of the machine list, without validation rules |
| `crud/machine.yml` | The crudui form of the edit screen: states and events as repeated rows, without validation rules |
| `crud/rename.yml` | The crudui form of the rename screen: the stored states with a new key |
| `crud/new-machine.yml` | The crudui form of the new machine screen |
| `src/forms.mjs` | The forms: the data of a stored machine, the render of each form, the findings mapped to fields, and the code suggestion |
| `src/form-data.mjs` | The parser of a submitted form: `form[...]` names into row-key objects, then into a definition |
| `client/main.ts` | The browser entry: the hyper client, Mermaid on the first load and after every htmx swap, and the crudui `connectForm` of the edit form |
| `src/main.mjs` | The server entry |
| `src/store.mjs` | The store selection from `fsm.config.json` |
| `src/handlers.mjs` | The loaders and actions of the screens: the list, the detail, the edit, rename, new and delete screens |
| `build/` | The output of `make gui-build`: `templates.index.json`, `manifest.json` (ignored) |
| `public/assets/` | The client bundle and its chunks (ignored) |

The versions of the dependencies are pinned in `package.json` and `package-lock.json` and recorded in
`config/dependency-policy.json`: hyper v0.0.11, crudui v0.0.5, the template v0.0.5 and mermaid, with the same release
URLs in `overrides` for the `@polyspec/*` packages that they depend on.
