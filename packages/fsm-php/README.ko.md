<!-- doc-id: readme-php -->
<!-- source-sha256: 31b754d259e735fb9e41de86b45d370e2bf4a88148cfa1019c7fd38ad12f51e9 -->
# polyspec/fsm-php

[English](README.md)

fsm의 PHP 소비자(`docs/plans/fsm-v1.md`, C-2)다. 이 패키지는 비공개이며 시험 벤치라서 배포하지 않는다.
fsm 정의로부터 생성된 PHP 코드를 어떻게 쓰는지 보이고, 그 코드를 conformance vector와 대조한다.
생성되는 namespace는 `Polyspec\FsmTest`이며(시험 벤치가 고른 `--php-namespace`), machine마다 하위 namespace
`<ns>\<Pascal machine key>`를 가진다. 예를 들면 `Polyspec\FsmTest\Order`다.

- `src/`: `fsm-gen gen --kind php`가 생성한다(직접 고치지 않는다). machine마다 `<Pascal>/State.php`와 `Event.php`(backed enum),
  `Step.php`, `functions.php`(`docs/spec/fsm.md`의 B-6 함수이며 composer `autoload.files`로 적재된다)가 있다.
  `Fsm/Code.php`와 `Fsm/Error.php`는 공용 오류 code enum과 예외다.
- `tests/Vectors.php`: 모든 machine의 vector case로, `fsm-gen vectors --kind php`가 생성한다.
- `tests/ConformanceTest.php`: vector case마다 PHPUnit 테스트 하나이며, data set 이름이 `test_<feature>__<id>`이다. 생성된 함수나
  오류 code의 결과를 검사한다. 공개 API만 쓰므로 php 확장 패키지도 같은 파일을 실행한다.
- `examples/persist.php`: `docs/spec/fsm.md`(B-4)의 영속화 패턴을 polyspec orm으로 SQLite에서 구현한다. persist case가 이를 실행한다.
- `examples/model/`: 루트 `schema/persist.dbs`에서 생성한 orm model이다.

이 디렉터리에서 `make install`은 고정된 의존성(`composer.lock`)을 설치하고, `make gen`은 위 파일을 다시 생성하며,
`make test`는 `scripts/kit/run-tests.mjs`로 테스트를 실행한다. 루트 `make gen-check`는 생성된 파일이 최신인지 확인한다.
`Error::getCode()`는 code 문자열(예: `E_CONFLICT`)을 돌려준다. PHP가 `Exception`의 보호된 `$code`를 쓰기 때문이다. 오류의
나머지 필드는 state code와 event 순번이다.
