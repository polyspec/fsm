<!-- doc-id: fsm-gui-readme -->
<!-- source-sha256: 625df1de6103f54de12a75e8cd696331cbfcaadcd7f0373ac6ea0deb9c4e8304 -->
# fsm GUI

[English](README.md)

fsm의 GUI(`docs/plans/fsm-v1.md`, C-7)다. hyper 서버로 프로젝트의 상태 기계를 보여준다. 목록 페이지는 모든 기계를 보여주고,
상세 페이지는 상태, edge가 있는 event, `docs/spec/fsm.md`의 B-1 정규 형식으로 쓴 Mermaid 다이어그램을 보여준다. GUI는
규칙을 소유하지 않는다. 정의는 `fsm.config.json`이 지정한 store(json, mermaid 또는 db)에서 오고, 모든 검사는 core `run`을
거친다. 같은 페이지에서 기계를 편집한다(편집 절 참고).

## 실행

빌드된 browser asset을 한 번 준비한다. 빌드 결과인 `build/`와 `public/assets/`는 git이 무시한다.

```sh
make gui-build
```

저장소 루트에서 명령 `fsm-gui`를 PATH에 둔다. npm은 clone의 package를 link하므로 명령은 clone의 코드와 빌드된 asset을
실행한다.

```sh
npm install -g ./packages/fsm-gui
```

프로젝트 디렉터리에서 서버를 시작하거나 `--project`로 지정한다.

```sh
fsm-gui --project /path/to/project --port 8080
```

서버는 `127.0.0.1`에서 listen하고 주소를 출력한다. 기계 목록은 `http://127.0.0.1:8080/`, 기계는
`http://127.0.0.1:8080/machines/<machine>`에서 연다. 세션은 `<project>/var/sessions`에 보관한다.

| 옵션 | 의미 |
|---|---|
| `--project <dir>` | 프로젝트 루트. 그 안의 `fsm.config.json`이 store를 고른다. 기본값은 현재 디렉터리다. |
| `--port <n>` | `127.0.0.1`의 port. 0부터 65535까지. 기본값은 8080이다. |

store는 `fsm.config.json`을 따른다.

| 설정 | Store |
|---|---|
| `{"store":"json"}` | `machines/*.fsm.json`과 `fsm.lock.json` |
| `{"store":"mermaid"}` | `machines/*.fsm.mmd`과 `fsm.lock.json` |
| `{"store":"db","dsnEnv":"FSM_DSN"}` | DSN이 `FSM_DSN` 환경 변수의 값인 데이터베이스. `packages/fsm-db`의 orm 패키지가 설치되어 있어야 한다(`make db-deps`) |

GUI가 사용할 수 없는 설정은 종료 코드 1로 끝나며 `E_STORE_NOT_CONFIGURED` 같은 finding을 출력한다. 모든 페이지는 프로젝트의
finding을 오류로 보여주며, 읽을 수 없는 파일의 load finding도 포함한다. 자신의 finding이 있는 기계는 finding을 보여주고
다이어그램은 보여주지 않는다.

## 편집

기계의 상세 페이지는 편집 화면과 이름 바꾸기 화면으로 가는 링크를 두고, 기계를 삭제하는 버튼을 둔다. 새 기계 화면은 `/new`다.

| 화면 | 경로 | 저장할 때 하는 일 |
|---|---|---|
| 편집 | `/machines/<machine>/edit` | 상태(key, code, `initial`, `final`)와 edge가 있는 event를 저장한다. |
| 이름 바꾸기 | `/machines/<machine>/rename` | 상태에 새 key를 주며 code는 그대로 둔다. |
| 새 기계 | `/new` | 초기이면서 final인 상태 하나와 event가 없는 기계를 만든다. |
| 삭제 | 상세 페이지의 버튼 | 그 기계 없이 store를 저장한다. |

저장마다 core `run`을 부른다. 편집, 새 기계, 삭제는 `save`를, 이름 바꾸기는 이름 변경을 담은 `lock`을 부르므로 규칙은 core의
것이다.

- 거부된 저장은 아무것도 쓰지 않는다. 저장의 모든 finding을 페이지에 보여주며, 폼의 필드를 가리키는 finding은 그 필드에
  보여준다. 필드가 없는 finding(기계 전체에 대한 finding 등)은 폼 오류다.
- 편집 폼에서 저장된 상태의 key와 code는 읽기 전용이다. 요청을 손으로 고쳐도 core가 code 변경(`E_CODE_CHANGED`)과 key 변경
  (`E_CODE_KEY_CHANGED`)을 거부한다. key는 이름 바꾸기 화면에서만 바뀐다.
- 새 상태는 저장할 때 code를 받는다. 편집 페이지는 기계의 core `nextCode`가 제안한 code를 내장 폼 상태(`nextCode`)에 담고,
  브라우저는 폼에서 추가한 상태마다 그 code와 그 뒤의 code를 순서대로 준다(`client/new-codes.ts`). 저장은 모든 code를
  검사하며, 빈 code는 서버가 `nextCode`로 채운다. `nextCode`가 code를 내지 못하면(`E_CODE_RANGE`) 페이지는 null을 담고,
  브라우저는 code를 주지 않으며, 저장이 그 finding을 보여준다.
- 기계나 상태를 삭제하면 그 code는 `fsm.lock.json`의 `reserved`로 옮겨가므로 나중의 상태가 그 code를 받지 않는다
  (`docs/spec/fsm.md`, B-3). 삭제된 기계를 다시 추가하면 그 reserved code 다음부터 시작한다.
- 저장, 이름 바꾸기, 삭제 요청은 그 요청을 보낸 페이지의 `_csrf` 토큰을 가져야 한다. 없으면 서버는 403으로 응답하고 아무것도
  쓰지 않는다.
- 편집 폼의 행 추가와 삭제는 browser에서 한다. `client/main.ts`가 페이지 로드 후와 htmx swap마다 렌더링된 폼을 crudui
  `connectForm`으로 묶고, 행을 바꿀 때마다 페이지의 render 옵션으로 host에 폼을 다시 렌더링한다(`patchContent` 뒤 `connection.sync()`). 행 조작에는 browser가 필요하다. JavaScript가 없으면 폼은 보이는 행을 그대로 저장한다.

형식이 틀린 요청, 예를 들어 `form[...]`이 아닌 필드 이름이나 반복된 필드는 400으로 응답하며 아무것도 쓰지 않는다.

## 테스트

```sh
make gui-browsers
make gui-test
make gui-browser-test
```

`gui-browsers`는 고정된 Playwright 패키지(이 패키지의 정확한 버전 devDependency)의 Chromium을 Playwright CDN에서 내려받는다.
ONLINE이며 머신마다 한 번 실행한다. `gui-browser-test`는 asset을 빌드하고, 임시 프로젝트에 GUI를 띄운 뒤 그 Chromium으로
편집 폼을 조작한다(`tests/browser/browser.test.mjs`). 상태 행을 추가하고, 엣지와 함께 상태를 저장하고, 삭제하고, 제안 code,
저장된 머신과 lock, Mermaid 다이어그램을 확인한다. 또한 행의 모든 버튼이 crudui 크기와 아이콘을 보이는지, 편집과 이름 바꾸기 폼에서
한 행의 필드가 서로 다른 label을 갖는지, `/favicon.ico`가 아이콘을 돌려주는지 확인한다.

`gui-test`는 asset을 빌드한 뒤 `tests/`의 최상위 테스트를 실행한다. hyper 애플리케이션을 HTTP 없이 거치는 페이지, HTTP로 응답하는 서버
프로세스, store 선택, 고정된 Mermaid 패키지로 정규 형식을 파싱하는 테스트다. 파싱 테스트는 Node에서 Mermaid를 읽을 때
`tests/support/`의 최소 DOMPurify stub을 쓴다. Mermaid는 label 텍스트를 browser DOM으로 정화하는데 Node에는 DOM이 없기 때문이다.
편집 테스트(`edit-machine`, `rename-machine`, `machine-lifecycle`, `edit-http`)는 화면마다 json, mermaid, db store에서 실행하며,
json과 mermaid 프로젝트는 저장 뒤 `check`를 통과한다.

## 구성

| 경로 | 역할 |
|---|---|
| `app/app.json` | hyper manifest: page region과 경로 `/`, `/machines/{machine}`, 편집·이름 바꾸기·새 기계·삭제 |
| `templates/` | layout, title과 기계 목록·상세 페이지 |
| `crud/machines.yml` | 기계 목록의 crudui 선언. 검증 규칙은 없다 |
| `crud/machine.yml` | 편집 화면의 crudui 폼: 상태와 event를 반복 행으로 둔다. 검증 규칙은 없다 |
| `crud/rename.yml` | 이름 바꾸기 화면의 crudui 폼: 저장된 상태와 새 key |
| `crud/new-machine.yml` | 새 기계 화면의 crudui 폼 |
| `src/forms.mjs` | 폼: 저장된 기계의 데이터, 각 폼의 렌더, finding의 필드 대응, code 제안 |
| `src/form-data.mjs` | 제출된 폼의 파서: `form[...]` 이름을 행 key 객체로, 그다음 정의로 바꾼다 |
| `client/main.ts` | browser 진입점: hyper client, 첫 로드와 htmx swap마다 실행되는 Mermaid, 편집 폼의 crudui `connectForm` |
| `src/main.mjs` | 서버 진입점 |
| `src/store.mjs` | `fsm.config.json`에서 store를 고른다 |
| `src/handlers.mjs` | 화면의 loader와 action: 목록, 상세, 편집, 이름 바꾸기, 새 기계, 삭제 |
| `build/` | `make gui-build`의 결과: `templates.index.json`, `manifest.json`(무시됨) |
| `public/assets/` | client bundle과 chunk, `make gui-build`가 `@polyspec/crudui-generator-core`에서 복사하는 `crudui.css`(무시됨) |
| `public/favicon.ico` | `/favicon.ico`의 아이콘. `scripts/make-favicon.mjs`가 쓴다(ICO 파일이다. 계획 C-7 참고) |
| `scripts/make-favicon.mjs` | `public/favicon.ico`를 쓴다. 아이콘을 바꿀 때만 손으로 실행한다 |

의존성 버전은 `package.json`과 `package-lock.json`에 고정하고 `config/dependency-policy.json`에 기록한다. hyper v0.0.11,
crudui v0.0.5, template v0.0.5, mermaid를 고정하며, 그 `@polyspec/*` 패키지의 전이 의존성은 같은 release URL을 `overrides`에 둔다.
