<!-- doc-id: fsm-gui-readme -->
<!-- source-sha256: fe616ae067e738d2115fd2acd5168275029cc009b20341ca79b1cf14db8751f2 -->
# fsm GUI

[English](README.md).

## 기능

`fsm-gui`는 fsm 프로젝트의 상태 기계를 편집하는 browser GUI다(`docs/plans/fsm-v1.md`, C-7). 목록 페이지는 모든 기계를
보여준다. 상세 페이지는 상태, edge가 있는 event, 그리고 `docs/spec/fsm.md`의 B-1 정규 형식으로 쓴 Mermaid 다이어그램을
보여준다. 같은 페이지에서 기계를 편집한다. 상태와 event를 추가하고, 바꾸고, 이름을 바꾸고, 삭제하며, 기계를 추가하고 삭제한다.

GUI는 규칙을 소유하지 않는다. 정의는 `fsm.config.json`이 지정한 store(json, mermaid 또는 db)에서 오며, 모든 검사와 모든 쓰기는
`packages/fsm-compiler`의 core `run`을 거친다. `fsm-gen`과 `fsm-db`가 적용하는 규칙과 같다. core가 거부한 저장은 아무것도
쓰지 않으며, 페이지가 검사 결과를 보여준다.

## 설정

GUI는 이 저장소의 clone에서 빌드한다. 한 번 설치하고 빌드한다.

```sh
make gui-build                      # installs the GUI's packages and builds build/ and public/assets/ (git-ignored)
npm install -g ./packages/fsm-gui   # puts the command fsm-gui on the PATH, linked to this clone
```

`make gui-build`는 고정된 패키지(hyper v0.0.11, crudui v0.0.5, template v0.0.5, mermaid 12.1.0)를 받으려고 한 번 네트워크가
필요하다. 서버는 `.node-version`의 Node.js 26.8.1로 실행한다. store가 database인 프로젝트는 `packages/fsm-db`의 orm 패키지도
설치해야 한다: `make db-deps`(`make gui-build`가 먼저 실행한다).

## 실행

프로젝트 디렉터리에서 서버를 시작하거나 `--project`로 프로젝트를 지정한다.

```sh
fsm-gui --project /path/to/project --port 8080
```

서버는 `127.0.0.1`에서 듣고, 주소와 제공하는 프로젝트를 출력한다.

```text
[fsm-gui] http://127.0.0.1:8080 project /path/to/project
```

기계 목록은 `http://127.0.0.1:8080/`, 기계 하나는 `http://127.0.0.1:8080/machines/<machine>`에서 연다. session은
`<project>/var/sessions`에 보관한다. Ctrl+C로 서버를 멈춘다.

| 옵션 | 뜻 |
|---|---|
| `--project <dir>` | 프로젝트 루트. `fsm.config.json`이 store를 고른다. 기본값은 현재 디렉터리다. |
| `--port <n>` | `127.0.0.1`의 port, 0부터 65535까지. 기본값은 8080이다. |

store는 `fsm.config.json`을 따른다.

| 설정 | Store |
|---|---|
| `{"store":"json"}` | `machines/*.fsm.json`과 `fsm.lock.json` |
| `{"store":"mermaid"}` | `machines/*.fsm.mmd`와 `fsm.lock.json` |
| `{"store":"db","dsnEnv":"FSM_DSN"}` | DSN이 `FSM_DSN`의 값인 database. `packages/fsm-db`의 orm 패키지를 설치해야 한다(`make db-deps`) |

GUI가 쓸 수 없는 설정이면 시작이 종료 상태 1로 멈추고 검사 결과를 출력한다. 사용 오류(알 수 없는 옵션, 0부터 65535가 아닌 port)는
종료 상태 2로 끝난다.

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

모든 페이지는 프로젝트의 검사 결과도 보여준다. 읽을 수 없는 파일과 기계마다의 검사 결과가 여기에 든다. 자신의 검사 결과가
있는 기계는 검사 결과만 보여주고 다이어그램은 보여주지 않는다.

## 화면

| 화면 | 경로 | 보여주거나 저장하는 것 |
|---|---|---|
| 기계 목록 | `/` | 프로젝트의 모든 기계와 각 기계로 가는 링크 |
| 상세 | `/machines/<machine>` | 상태(key, code, initial, final), edge가 있는 event, Mermaid 다이어그램. 편집과 이름 바꾸기로 가는 링크, 기계를 삭제하는 버튼 |
| 편집 | `/machines/<machine>/edit` | 상태(key, code, `initial`, `final`)와 edge가 있는 event를 저장한다. 행은 browser가 추가하고 제거한다 |
| 이름 바꾸기 | `/machines/<machine>/rename` | 저장된 상태에 새 key를 주고 code는 유지한다 |
| 새 기계 | `/new` | 상태 하나(초기이면서 최종 상태)와 event가 없는 기계를 만든다 |
| 삭제 | 상세 페이지의 버튼 | 기계를 뺀 store를 저장한다 |

상세 페이지의 Mermaid 다이어그램은 mermaid store의 정규 출력이다. browser가 첫 로드 때 그리고 페이지가 바뀔 때마다 다시 그린다. 브라우저 테스트 `tests/browser/diagram.test.mjs`는 그려진 다이어그램이
모든 상태를 key로 보이고 code를 함께 보이는지 확인한다.

## 규칙

모든 저장은 core `run`을 호출한다. 편집, 새 기계, 삭제는 `save`를, 이름 바꾸기는 이름 변경과 함께 `lock`을 쓴다. 규칙은 core의
것이다(`docs/spec/fsm.md`, B-3과 B-5).

- 거부된 저장은 아무것도 쓰지 않는다. 저장의 모든 검사 결과를 페이지에 보여준다. form의 field를 가리키는 결과는 그 field에,
  기계 전체에 관한 결과처럼 field가 없는 결과는 form 오류로 보여준다.
- 편집 form에서 저장된 상태는 key와 code를 유지하며, 둘 다 읽기 전용이다. core는 바뀐 code(`E_CODE_CHANGED`)와 바뀐 key
  (`E_CODE_KEY_CHANGED`)를 거부한다. 요청을 손으로 고쳤더라도 그렇다. key는 이름 바꾸기 화면에서만 바뀌며, 그때 code는 유지된다.
- 새 상태는 form을 저장할 때 code를 받는다. 편집 페이지는 기계에 대해 core `nextCode`가 제안하는 code를 싣고, browser는 form에
  추가된 각 상태에 다음 code, 그 뒤의 code를 준다(`client/new-codes.ts`). 저장은 모든 code를 검사하고, 빈 code는 서버의
  `nextCode`가 채운다. `nextCode`가 code를 주지 못하면(`E_CODE_RANGE`) 페이지는 null을 싣고, browser는 code를 주지 않으며,
  저장이 검사 결과를 보여준다.
- 기계나 상태를 삭제하면 그 code가 `fsm.lock.json`의 `reserved`로 옮겨가서, 나중의 상태가 그 code를 받지 못한다
  (`docs/spec/fsm.md`, B-3). 삭제한 기계를 다시 추가하면 그 reserved code 뒤에서 시작한다.
- 저장, 이름 바꾸기, 삭제는 커밋된 lock과 비교한다. json과 mermaid는 git HEAD의 `fsm.lock.json`과 비교한다. 커밋된 code를 잃거나,
  커밋된 reserved code를 `reserved`에서 빼거나 상태에 주거나, 커밋된 key들의 code를 맞바꾸는 저장은 `E_LOCK_REGRESSED`로 거부하며
  아무것도 쓰지 않는다. 아직 커밋하지 않은 상태의 이름 바꾸기는 받는다. git 밖의 프로젝트이거나 `fsm.lock.json`이 추적되지 않거나
  무시되면 커밋된 lock이 없어 그 보호가 없다. db store에는 커밋이 없다: 규칙은 core의 저장된 lock 규칙(`E_CODE_REUSED`,
  `E_CODE_KEY_CHANGED`, `E_CODE_CHANGED`)이며, 거기서는 `E_LOCK_REGRESSED`가 생기지 않고, fsm 밖에서 바뀐 행은 감지하지 않는다.
- 저장, 이름 바꾸기, 삭제는 보낸 페이지의 `_csrf` token을 가져야 한다. 없으면 서버는 403으로 응답하고 아무것도 쓰지 않는다.
- 편집 form의 행은 browser에서 추가하고 제거한다. `client/main.ts`가 페이지 로드 뒤와 htmx swap 뒤마다 렌더된 form에 crudui
  `connectForm`을 붙이고, 행을 바꿀 때마다 페이지의 render 옵션으로 host에 form을 다시 렌더링한다(`patchContent` 뒤
  `connection.sync()`). 행에는 browser가 필요하다. JavaScript가 없으면 form은 보이는 행만 저장한다.
- 형식이 잘못된 본문(예: `form[...]` 형식이 아닌 field 이름, 되풀이된 field)은 400으로 응답하고 아무것도 쓰지 않는다.

## 테스트

```sh
make gui-browsers
make gui-test
make gui-browser-test
```

`gui-browsers`는 고정된 Playwright 패키지(이 패키지의 정확한 버전 devDependency)의 Chromium을 Playwright CDN에서 내려받는다. ONLINE이며 고정 버전마다 한 번 실행한다. checkout에 stamp `var/deps/playwright-<version>`을 남기므로 이후 `gui-browser-test`는 네트워크가 필요 없다. 다시 내려받으려면 그 stamp를 지운다. `gui-browser-test`는 asset을 빌드하고, 임시 프로젝트에 GUI를 띄운 뒤 그 Chromium으로
편집 form을 조작한다(`tests/browser/browser.test.mjs`). 상태 행을 추가하고, edge와 함께 상태를 저장하고, 삭제하고, 제안 code,
저장된 machine과 lock, Mermaid 다이어그램을 확인한다. 또한 행의 모든 버튼이 crudui 크기와 아이콘을 보이는지, 편집과 이름 바꾸기
form에서 한 행의 field가 서로 다른 label을 갖는지, `/favicon.ico`가 아이콘을 돌려주는지 확인한다.

`gui-test`는 asset을 빌드한 뒤 `tests/`의 최상위 테스트를 실행한다. hyper 애플리케이션을 HTTP 없이 거치는 페이지, HTTP로 응답하는 서버
프로세스, store 선택, 고정된 Mermaid 패키지로 정규 형식을 파싱하는 테스트다. 파싱 테스트는 Node에서 Mermaid를 읽을 때
`tests/support/`의 최소 DOMPurify stub을 쓴다. Mermaid는 label 텍스트를 browser DOM으로 정화하는데 Node에는 DOM이 없기 때문이다.
편집 테스트(`edit-machine`, `rename-machine`, `machine-lifecycle`, `edit-http`)는 화면마다 json, mermaid, db store에서 실행하며,
json과 mermaid 프로젝트는 저장 뒤 `check`를 통과한다.

## 구성

| 경로 | 역할 |
|---|---|
| `app/app.json` | hyper manifest: page 영역과 `/`, `/machines/{machine}` 경로 |
| `templates/` | layout, title과 기계 목록·상세 페이지 |
| `crud/machines.yml` | 기계 목록의 crudui 선언. 검증 규칙은 없다 |
| `crud/machine.yml` | 편집 화면의 crudui form. 상태와 event를 반복 행으로 둔다. 검증 규칙은 없다 |
| `crud/rename.yml` | 이름 바꾸기 화면의 crudui form. 저장된 상태에 새 key를 준다 |
| `crud/new-machine.yml` | 새 기계 화면의 crudui form |
| `src/forms.mjs` | form: 저장된 기계의 데이터, 각 form의 render, field에 대응시킨 검사 결과, code 제안 |
| `src/form-data.mjs` | 제출된 form의 parser: `form[...]` 이름을 row-key 객체로, 그다음 정의로 바꾼다 |
| `client/main.ts` | browser 진입점: hyper client, 첫 로드와 htmx swap 뒤의 Mermaid, 편집 form의 crudui `connectForm` |
| `src/main.mjs` | 서버 진입점(명령 `fsm-gui`) |
| `src/store.mjs` | `fsm.config.json`에서 store를 고른다 |
| `src/handlers.mjs` | 화면의 loader와 action: 목록, 상세, 편집, 이름 바꾸기, 새 기계, 삭제 |
| `build/` | `make gui-build`의 출력: `templates.index.json`, `manifest.json`(git이 무시) |
| `public/assets/` | client bundle과 chunk, `make gui-build`가 `@polyspec/crudui-generator-core`에서 복사하는 `crudui.css`(git이 무시) |
| `public/favicon.ico` | `/favicon.ico`의 아이콘. `scripts/make-favicon.mjs`가 쓴다(ICO 파일이다. 계획 C-7 참고) |
| `scripts/make-favicon.mjs` | `public/favicon.ico`를 쓴다. 아이콘을 바꿀 때만 손으로 실행한다 |
| `scripts/manual-check.mjs` | GUI 수동 확인(`docs/verification/gui.md`)의 driver: 실행 중인 서버를 Chromium으로 밟고 녹화한다 |
| `tests/browser/` | form의 브라우저 테스트(`make gui-browser-test`) |

의존성 버전은 `package.json`과 `package-lock.json`에 고정하며 `config/dependency-policy.json`에 기록한다: hyper v0.0.11, crudui
v0.0.5, template v0.0.5, mermaid. `@polyspec/*` 패키지 중 이들이 의존하는 것은 `overrides`에 같은 release URL을 준다.
