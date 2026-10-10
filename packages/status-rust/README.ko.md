<!-- doc-id: readme-rust -->
<!-- source-sha256: 9d1ffa0d78d0a110707b2ea53417d23645ee7ac7362fbe13c058101fe9c0995c -->
# status-rust

[English](README.md)

status의 rust 소비자다(`docs/plans/status-v1.md`, C-2). 이 crate는 private이며 시험용 환경이므로 배포하지 않는다.
status 정의에서 생성된 rust 코드를 어떻게 쓰는지 보여 주고, 그 코드가 conformance vector와 일치하는지 검사한다.

- `src/`: `status-gen gen --kind rust`가 생성한다(직접 고치지 않는다). machine마다 `<machine>.rs`가 있고, `status.rs`에는
  `Code`와 `Error` 타입이 있으며, `lib.rs`는 machine마다 그리고 `status`의 module을 선언한다.
- `tests/vectors.rs`: 모든 machine의 vector case로, `status-gen vectors --kind rust`가 생성한다. case마다 `#[test]` 하나가
  `test_<feature>__<id>`라는 이름으로 `tests/conformance.rs`의 check 함수를 호출하며, persist case는 `#[tokio::test]`다.
- `tests/conformance.rs`: check 함수와, `tests/vectors.rs` 및 `examples/persist.rs`를 포함하는 test crate다.
- `examples/persist.rs`: `docs/spec/status.md`(B-4)의 persistence 패턴을 polyspec orm으로 SQLite에서 구현한다. persist case가
  이를 실행하고 실행 후 저장된 code를 검사한다.
- `build.rs`: 루트 `schema/persist.dbs`의 orm model을 `OUT_DIR`에 생성한다. `examples/model/` 디렉터리는 없다. 이 build script가
  rust의 model 생성기이기 때문이며, 이는 `contracts/layout.json`에 선언된 rust의 차이다.
- `Cargo.toml`과 `Cargo.lock`: orm release `v0.0.7`(`polyspec-orm`, `polyspec-orm-build`)과 `tokio`를 git tag로 고정한다.
  toolchain은 루트의 `rust-toolchain.toml`이 선언한다.

checkout 루트에서 `make -C packages/status-rust install`은 crate를 받고, `make -C packages/status-rust gen`은 위 생성 파일을
다시 만들며, `make test-rust`는 `scripts/kit/run-tests.mjs`를 통해 test를 실행한다. 루트의 `make gen-check`는 생성 파일이
최신인지 검사한다.
