<!-- doc-id: readme -->
<!-- source-sha256: d56449562b739c3277d27fa34aab496996e6c8dff118c672161d50e012d0e890 -->
# polyspec/fsm

[English](README.md)

fsm는 state machine을 한 번 정의하고(정수 code를 가진 상태, edge로 이루어진 event, 멱등한 전이) go, npm(js + d.ts), php,
php-ext, python, rust용 코드를 런타임 의존성 없이 생성한다. 정의는 세 store(JSON, Mermaid `stateDiagram-v2`, orm을 통한 database)
중 하나에 두며 규칙은 하나다.

- 계획과 범위: [docs/plans/fsm-v1.md](docs/plans/fsm-v1.ko.md)
- 체크리스트: [docs/plans/execution-checklist.md](docs/plans/execution-checklist.ko.md)
- 개발 규칙: [AGENTS.md](AGENTS.ko.md)
