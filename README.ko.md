<!-- doc-id: readme -->
<!-- source-sha256: 86d6114b41e42ee41958d226eddcdeadae544572efdb6ea922a0385a120176ca -->
# polyspec/status

[English](README.md)

status는 state machine을 한 번 정의하고(정수 code를 가진 상태, edge로 이루어진 event, 멱등한 전이) go, npm(js + d.ts), php,
php-ext, python, rust용 코드를 런타임 의존성 없이 생성한다. 정의는 세 store(JSON, Mermaid `stateDiagram-v2`, orm을 통한 database)
중 하나에 두며 규칙은 하나다.

- 계획과 범위: [docs/plans/status-v1.md](docs/plans/status-v1.ko.md)
- 체크리스트: [docs/plans/execution-checklist.md](docs/plans/execution-checklist.ko.md)
- 개발 규칙: [AGENTS.md](AGENTS.ko.md)
