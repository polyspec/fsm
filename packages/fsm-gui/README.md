<!-- doc-id: fsm-gui-readme -->
# fsm GUI

[한국어](README.ko.md).

## What it does

`fsm-gui` is a browser editor for the state machines of a fsm project (`docs/plans/fsm-v1.md`, C-7). The list page shows
every machine. The detail page shows its states, its events with their edges, and its Mermaid diagram in the canonical form
of `docs/spec/fsm.md`, B-1. The same pages edit the machines: they add, change, rename and delete states and events, and
they add and delete machines.

The GUI owns no rule. The definitions come from the store that `fsm.config.json` names (json, mermaid or db), and every
check and every write goes through the core `run` of `packages/fsm-compiler`, the same rules that `fsm-gen` and `fsm-db`
apply. A save that the core refuses writes nothing, and the page shows the findings.

## Setup

The GUI is built from this repository. Install and build it from a clone, once:

```sh
make gui-build                      # installs the GUI's packages and builds build/ and public/assets/ (git-ignored)
npm install -g ./packages/fsm-gui   # puts the command fsm-gui on the PATH, linked to this clone
```

`make gui-build` needs the network once, for the pinned packages (hyper v0.0.11, crudui v0.0.5, the template v0.0.5 and
mermaid 12.1.0). Node.js 26.8.1 from `.node-version` runs the server. For a project whose store is the database, the orm
packages of `packages/fsm-db` must be installed too: `make db-deps` (`make gui-build` runs it first).

## Running

Start the server from the project directory, or name the project with `--project`:

```sh
fsm-gui --project /path/to/project --port 8080
```

The server listens on `127.0.0.1` and prints its address and the project it serves:

```text
[fsm-gui] http://127.0.0.1:8080 project /path/to/project
```

Open `http://127.0.0.1:8080/` for the machine list and `http://127.0.0.1:8080/machines/<machine>` for one machine. The sessions
are kept in `<project>/var/sessions`. Stop the server with Ctrl+C.

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

A configuration that the GUI cannot use stops the start with exit status 1 and prints the finding. The usage errors (an
unknown option, a port that is not a number from 0 to 65535) exit with status 2:

```sh
$ fsm-gui --project ./no-config --port 8098
[fsm-gui] E_STORE_NOT_CONFIGURED - $: fsm.config.json is missing in /path/to/no-config
$ echo $?
1
$ fsm-gui --port 70000
[fsm-gui] --port takes a port number from 0 to 65535
usage: fsm-gui [--project <dir>] [--port <n>]
$ echo $?
2
```

Every page also shows the findings of the project: a file that cannot be read, and the findings of each machine. A machine
with a finding of its own shows its findings and no diagram.

## Screens

| Screen | Path | What it shows or saves |
|---|---|---|
| Machine list | `/` | every machine of the project, with a link to each |
| Detail | `/machines/<machine>` | the states (key, code, initial, final), the events with their edges, and the Mermaid diagram; links to Edit and Rename, and a button that deletes the machine |
| Edit | `/machines/<machine>/edit` | saves the states (key, code, `initial`, `final`) and the events with their edges, as rows that the browser adds and removes |
| Rename | `/machines/<machine>/rename` | gives a stored state a new key and keeps its code |
| New | `/new` | creates a machine with one state, which is both the initial and the final state, and no event |
| Delete | the button of the detail page | saves the store without the machine |

The Mermaid diagram of the detail page is the canonical output of the mermaid store; the browser draws it on the first load
and again after every change of the page. The browser test `tests/browser/diagram.test.mjs` checks that the drawn diagram names
every state by its key and shows its code.

## Rules

Every save calls the core `run`: `save` for Edit, New and Delete, and `lock` with the renames for Rename. The rules are the
core's (`docs/spec/fsm.md`, B-3 and B-5):

- A refused save writes nothing. Every finding of the save is shown on the page. A finding that names a field of the form is
  shown on that field; a finding without a field, such as a finding of the whole machine, is a form error.
- A stored state keeps its key and its code in the Edit form, and both are read-only there. The core refuses an edited code
  (`E_CODE_CHANGED`) and a changed key (`E_CODE_KEY_CHANGED`), even when a request is edited by hand. A key changes only on the
  Rename screen, which keeps the code.
- A new state gets its code when the form is saved. The Edit page carries the code that the core `nextCode` suggests for its
  machine, and the browser gives each state added in the form the next code, then the codes after it (`client/new-codes.ts`).
  The save checks every code, and a blank code is still filled by `nextCode` on the server. When `nextCode` gives no code
  (`E_CODE_RANGE`), the page carries null, the browser gives none, and the save shows the finding.
- Deleting a machine, or a state, moves its codes to `reserved` in `fsm.lock.json`, so a later state never takes them
  (`docs/spec/fsm.md`, B-3). A deleted machine that is added again starts after its reserved codes.
- Each save, rename or delete must carry the `_csrf` token of the page that it was sent from. Without it the server answers
  403 and writes nothing.
- The rows of the Edit form are added and removed in the browser: `client/main.ts` binds the rendered form with crudui
  `connectForm` after the page loads and after every htmx swap, and re-renders the form into its host after every row change
  (`patchContent` with the page's render options, then `connection.sync()`). The rows need the browser; without JavaScript
  the form saves the rows that it shows.
- A malformed body, such as a field name that is not `form[...]` or a repeated field, answers 400 and writes nothing.

## Tests

```sh
make gui-browsers
make gui-test
make gui-browser-test
```

`gui-browsers` downloads the Chromium of the pinned Playwright package (an exact devDependency of this package) from the
Playwright CDN; it is ONLINE and runs once per machine. `gui-browser-test` builds the assets, starts the GUI on a temporary
project and drives the edit form in that Chromium (`tests/browser/browser.test.mjs`): add a state row, save a state with an
edge, remove it, and check the suggested codes, the stored machine and lock, and the Mermaid diagram. It also checks that every
row button shows its crudui size and icon, that the fields of one row have distinct labels on the edit and rename forms, and
that `/favicon.ico` answers an icon.

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
| `src/main.mjs` | The server entry (the command `fsm-gui`) |
| `src/store.mjs` | The store selection from `fsm.config.json` |
| `src/handlers.mjs` | The loaders and actions of the screens: the list, the detail, the edit, rename, new and delete screens |
| `build/` | The output of `make gui-build`: `templates.index.json`, `manifest.json` (ignored) |
| `public/assets/` | The client bundle and its chunks, and `crudui.css` copied from `@polyspec/crudui-generator-core` by `make gui-build` (ignored) |
| `public/favicon.ico` | The icon at `/favicon.ico`, written by `scripts/make-favicon.mjs` (an ICO file: see the plan, C-7) |
| `scripts/make-favicon.mjs` | Writes `public/favicon.ico`; run it by hand only when the icon changes |
| `tests/browser/` | The browser test of the forms (`make gui-browser-test`) |

The versions of the dependencies are pinned in `package.json` and `package-lock.json` and recorded in
`config/dependency-policy.json`: hyper v0.0.11, crudui v0.0.5, the template v0.0.5 and mermaid, with the same release
URLs in `overrides` for the `@polyspec/*` packages that they depend on.
