<!-- doc-id: readme-npm -->
<!-- source-sha256: ecfb491982d17a39b3241d8a7418df50cf54c4f456b77819a9691365a601f2d1 -->
# @polyspec/fsm-npm

[English](README.md)

fsm의 npm 소비자다(`docs/plans/fsm-v1.md`, C-2). 이 패키지는 private이며 시험용 환경이므로 배포하지 않는다.
fsm 정의에서 생성된 npm 코드를 어떻게 쓰는지 보여 주고, 그 코드가 conformance vector와 일치하는지 검사한다.

- `src/`: `fsm-gen gen --kind npm`이 생성한다(직접 고치지 않는다). machine마다 `<machine>.js`와 `<machine>.d.ts`가 있고,
  `fsm.js`에는 `Error` class와 `Code` 상수가 있으며, `index.js`는 machine마다 그리고 `fsm`의 namespace를 내보낸다.
- `tests/vectors.mjs`: 모든 machine의 vector case로, `fsm-gen vectors --kind npm`이 생성한다.
- `tests/conformance.test.mjs`: vector case마다 test 하나를 두며, 이름은 `test_<feature>__<id>`이고, 생성된 함수의 결과나
  오류 code를 검사한다.
- `examples/persist.mjs`: `docs/spec/fsm.md`(B-4)의 persistence 패턴을 polyspec orm으로 SQLite에서 구현한다. persist
  case가 이를 실행한다.
- `examples/model/`: 루트 `schema/persist.dbs`에서 orm이 생성한 model이다.

이 디렉터리에서 `make install`은 고정된 의존성을 설치하고, `make gen`은 위 생성 파일을 다시 만들며, `make test`는
`scripts/kit/run-tests.mjs`를 통해 test를 실행한다. 루트의 `make gen-check`는 생성 파일이 최신인지 검사한다.
