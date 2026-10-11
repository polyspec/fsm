<!-- doc-id: readme-php-ext -->
<!-- source-sha256: 099e70b4798321c66fdea0ef27c82cb7c45ae2d22fe77ba37557e0e83aca433b -->
# polyspec/fsm-php-ext

[English](README.md)

fsm의 PHP extension kind다(`docs/plans/fsm-v1.md`, C-2). 이 패키지는 비공개이며 테스트 벤치다. 배포하지 않는다.
fsm 정의의 생성된 상태 기계를 하나의 PHP extension `polyspec_fsm_test`로 빌드하고, 그 extension을 php 패키지와 같은
conformance vector로 검사한다. 공개 API는 php kind의 것과 같다. namespace는 `Polyspec\FsmTest`이고, machine마다 하위
namespace `<ns>\<Pascal machine key>`(예: `Polyspec\FsmTest\Order`)가 있으며, enum `State`와 `Event`, class `Step`, 함수
`initial`, `code`, `key`, `fromCode`, `isFinal`, `eventsFrom`, `target`, `apply`를 담는다. 공용 `Polyspec\FsmTest\Fsm`는
enum `Code`와 exception `Error`를 담는다.

- `src/`: `fsm-gen gen --kind php-ext`가 생성한다(직접 편집하지 않는다). `order.c`는 machine 하나이고, `fsm.c`는 공용 class와
  module entry이며, `php_polyspec_fsm_test.h`는 header, `polyspec_fsm_test_arginfo.h`는 arginfo, `polyspec_fsm_test.stub.php`는
  편집기용 선언, `config.m4`는 phpize가 읽는 build 선언이다. `make build`는 `src/`에 phpize 출력을 더하며, Git은 이를 무시한다.
- `tests/Vectors.php`: 모든 machine의 vector case이며 `fsm-gen vectors --kind php-ext`가 생성한다. php 패키지의
  `tests/Vectors.php`와 byte 단위로 같다.
- `tests/ConformanceTest.php`: php 패키지 파일의 복사본이며 `make gen`이 만든다. vector case마다 PHPUnit test 하나를
  `test_<feature>__<id>` 이름으로 실행한다. 공개 API만 쓰므로 두 패키지가 같은 파일을 실행한다.
- `examples/persist.php`: php 패키지 파일의 복사본이며 `make gen`이 만든다. SQLite에서 polyspec orm으로 `docs/spec/fsm.md`(B-4)의
  persistence 패턴을 실행하며, persist case가 이를 실행한다.
- `examples/model/`: 루트 `schema/persist.dbs`에서 orm-gen이 생성한 orm model이다.

이 디렉터리에서 `make install`은 고정된 의존(`composer.lock`, php 패키지와 같은 패키지)을 설치하고, `make gen`은 위 파일을
다시 생성하며, `make build`는 `src/`에서 `phpize`, `./configure`, `make`로 extension을 빌드한다. `make test`는 빌드한 뒤
`scripts/kit/run-tests.mjs`로 테스트를 실행하며, 빌드한 module을 `--php-extension`으로 올린다. `make gen`은 build 뒤에
`make clean` 없이 실행한다. phpize 출력은 git이 무시하므로 gen은 그것을 건너뛴다(막지도 지우지도 않는다). `make clean`은 build의 phpize 출력을 지운다. 루트 `make gen-check`는 생성 파일과
복사본이 최신인지 확인하고, `make parity-php-ext`는 모든 vector case가 한 번씩 통과했는지 확인한다.
