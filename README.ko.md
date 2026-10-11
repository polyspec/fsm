<!-- doc-id: readme -->
<!-- source-sha256: ec3409c235a213dd9ab4e2ff53c4cd170478785e47b555a3c02f7d3d84bd784a -->
# polyspec/fsm

[English](README.md)

fsm는 state machine을 한 번 정의하고(정수 code를 가진 상태, edge로 이루어진 event, 멱등한 전이) go, npm(js + d.ts), php,
php-ext, python, rust용 코드를 런타임 의존성 없이 생성한다. 정의는 세 store(JSON, Mermaid `stateDiagram-v2`, orm을 통한 database)
중 하나에 두며 규칙은 하나다.

- 계획과 범위: [docs/plans/fsm-v1.md](docs/plans/fsm-v1.ko.md)
- 체크리스트: [docs/plans/execution-checklist.md](docs/plans/execution-checklist.ko.md)
- 개발 규칙: [AGENTS.md](AGENTS.ko.md)
- 문서 사이트: 이 문서들로 `make docs-build`가 만드는 사이트(VitePress, `docs/.vitepress`, 계획 C-8); S-21이 배포하면 https://polyspec.github.io/fsm/ 에서 제공된다
