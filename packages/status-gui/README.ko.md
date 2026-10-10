<!-- doc-id: status-gui-readme -->
<!-- source-sha256: 6d24ff248ed91e881d30fa9f53970b7eb3857556c7f6a3e89c9cd28f988a1100 -->
# status GUI

[English](README.md)

status의 GUI(`docs/plans/status-v1.md`, C-7)다. hyper 서버로 프로젝트의 상태 기계를 보여준다. 목록 페이지는 모든 기계를 보여주고,
상세 페이지는 상태, edge가 있는 event, `docs/spec/status.md`의 B-1 정규 형식으로 쓴 Mermaid 다이어그램을 보여준다. GUI는
규칙을 소유하지 않는다. 정의는 `status.config.json`이 지정한 store(json, mermaid 또는 db)에서 오고, 모든 검사는 core `run`을
거친다. 편집은 이 버전에 없다(S-17).

## 실행

빌드된 browser asset을 한 번 준비한다. 빌드 결과인 `build/`와 `public/assets/`는 git이 무시한다.

```sh
make gui-build
```

프로젝트 디렉터리에서 서버를 시작하거나 `--project`로 지정한다.

```sh
cd packages/status-gui
node src/main.mjs --project /path/to/project --port 8080
```

서버는 `127.0.0.1`에서 listen하고 주소를 출력한다. 기계 목록은 `http://127.0.0.1:8080/`, 기계는
`http://127.0.0.1:8080/machines/<machine>`에서 연다. 세션은 `<project>/var/sessions`에 보관한다.

| 옵션 | 의미 |
|---|---|
| `--project <dir>` | 프로젝트 루트. 그 안의 `status.config.json`이 store를 고른다. 기본값은 현재 디렉터리다. |
| `--port <n>` | `127.0.0.1`의 port. 0부터 65535까지. 기본값은 8080이다. |

store는 `status.config.json`을 따른다.

| 설정 | Store |
|---|---|
| `{"store":"json"}` | `machines/*.status.json`과 `status.lock.json` |
| `{"store":"mermaid"}` | `machines/*.status.mmd`과 `status.lock.json` |
| `{"store":"db","dsnEnv":"STATUS_DSN"}` | DSN이 `STATUS_DSN` 환경 변수의 값인 데이터베이스. `packages/status-db`의 orm 패키지가 설치되어 있어야 한다(`make db-deps`) |

GUI가 사용할 수 없는 설정은 종료 코드 1로 끝나며 `E_STORE_NOT_CONFIGURED` 같은 finding을 출력한다. 모든 페이지는 프로젝트의
finding을 오류로 보여주며, 읽을 수 없는 파일의 load finding도 포함한다. 자신의 finding이 있는 기계는 finding을 보여주고
다이어그램은 보여주지 않는다.

## 테스트

```sh
make gui-test
```

`gui-test`는 asset을 빌드한 뒤 `tests/`의 테스트를 실행한다. hyper 애플리케이션을 HTTP 없이 거치는 페이지, HTTP로 응답하는 서버
프로세스, store 선택, 고정된 Mermaid 패키지로 정규 형식을 파싱하는 테스트다. 파싱 테스트는 Node에서 Mermaid를 읽을 때
`tests/support/`의 최소 DOMPurify stub을 쓴다. Mermaid는 label 텍스트를 browser DOM으로 정화하는데 Node에는 DOM이 없기 때문이다.

## 구성

| 경로 | 역할 |
|---|---|
| `app/app.json` | hyper manifest: page region과 경로 `/`, `/machines/{machine}` |
| `templates/` | layout, title과 기계 목록·상세 페이지 |
| `crud/machines.yml` | 기계 목록의 crudui 선언. 검증 규칙은 없다 |
| `client/main.ts` | browser 진입점: hyper client와, 첫 로드와 htmx swap마다 실행되는 Mermaid |
| `src/main.mjs` | 서버 진입점 |
| `src/store.mjs` | `status.config.json`에서 store를 고른다 |
| `src/handlers.mjs` | 목록과 상세의 loader |
| `build/` | `make gui-build`의 결과: `templates.index.json`, `manifest.json`(무시됨) |
| `public/assets/` | client bundle과 chunk(무시됨) |

의존성 버전은 `package.json`과 `package-lock.json`에 고정하고 `config/dependency-policy.json`에 기록한다. hyper v0.0.11,
crudui v0.0.5, template v0.0.5, mermaid를 고정하며, 그 `@polyspec/*` 패키지의 전이 의존성은 같은 release URL을 `overrides`에 둔다.
