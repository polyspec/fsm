<!-- doc-id: readme-go -->
<!-- source-sha256: 1a46e94d91d636ad87e2437f180888b72388574dd549a73b40a9c90b779c5c1a -->
# github.com/polyspec/status-go

[English](README.md)

status의 go 사용자 패키지다(`docs/plans/status-v1.md`, C-2). 이 모듈은 비공개이며 시험대이므로 배포하지 않는다.
status 정의로 생성된 go 코드를 어떻게 쓰는지 보여주고, 그 코드가 conformance vector와 일치하는지 확인한다.

- `src/`: `status-gen gen --kind go`가 생성한다(직접 고치지 않는다). `order/order.go`는 machine이고, `status/status.go`에는
  모든 machine이 돌려주는 `Error` 타입과 `Code*` 상수가 있다.
- `tests/vectors_test.go`: 모든 machine의 vector case로, `status-gen vectors --kind go`가 생성한다.
- `tests/conformance_test.go`: vector case마다 subtest 하나를 `test_<feature>__<id>`라는 이름으로 두며, 생성된 함수의 결과 또는
  오류 코드를 검사한다.
- `examples/persist.go`: SQLite 위에서 polyspec orm으로 구현한 `docs/spec/status.md`(B-4)의 영속화 패턴이다. persist case가
  이를 실행한다.
- `examples/model/`: 루트 `schema/persist.dbs`에서 `go tool orm-gen`이 생성한 orm model이다.

이 디렉터리에서 `make install`은 `go.mod`와 `go.sum`이 가리키는 모듈을 내려받고, `make gen`은 위 파일을 다시 생성하며,
`make test`는 `GOPROXY=off`로 `scripts/kit/run-tests.mjs`를 통해 테스트를 실행한다. 루트의 `make gen-check`는 생성된 파일이
최신인지 확인한다.
