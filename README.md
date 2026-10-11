<!-- doc-id: readme -->
# polyspec/fsm

[한국어](README.ko.md)

fsm defines a state machine once — integer-coded states, events made of edges, idempotent transitions — and generates
code without runtime dependencies for go, npm (js + d.ts), php, php-ext, python and rust. The definition is held in one of
three stores (JSON, Mermaid `stateDiagram-v2`, a database through orm) under one rule set.

- Plan and scope: [docs/plans/fsm-v1.md](docs/plans/fsm-v1.md)
- Checklist: [docs/plans/execution-checklist.md](docs/plans/execution-checklist.md)
- Development rules: [AGENTS.md](AGENTS.md)
