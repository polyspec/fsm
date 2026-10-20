<!-- doc-id: readme-php-ext -->
<!-- source-sha256: 9350d349db09ff87dc8eefa00d3e9197ea588bc327c2c8629f1a9c158ebfb002 -->
# polyspec/fsm-php-ext

[English](README.md)

fsm의 PHP extension 종류(`docs/plans/fsm-v1/plan.md`, C-2)다. 패키지는 비공개이며 test bed이고 공개하지 않는다. fsm 정의의 생성된 상태
기계를 `polyspec_fsm`라는 PHP extension 하나로 빌드하고, 그 extension을 php 패키지와 같은 conformance vector로 검사한다. 공개 API는
php 종류의 API다. namespace `Polyspec\FsmTest`, 기계마다 하위 namespace(예: `Polyspec\FsmTest\Order`)에 enum `State`와 `Event`, class
`Step`, 함수 `initial`, `code`, `key`, `fromCode`, `isFinal`, `eventsFrom`, `target`, `apply`를 둔다. 공유 `Polyspec\FsmTest\Fsm`은 enum
`Code`와 예외 `Error`를 가진다. 함수는 C로 쓰여 namespace에 등록되므로, 소비자는 php 종류와 같이 호출한다.

## 프로젝트에 생성

extension의 소스 디렉터리에 쓴다. namespace와 extension 이름이 필요하다:

```sh
fsm-gen gen --project /path/to/order-machines --kind php-ext --php-namespace 'Acme\Fsm' --php-ext-name acme_fsm --out ./ext/src
```

```text
[fsm-gen] gen: ok
```

extension은 그 디렉터리에서 PHP 빌드 도구로 빌드한다. test bed가 `make build`로 하는 것과 같다:

```sh
cd ext/src && phpize && ./configure && make
```

module은 `modules/acme_fsm.so`다. `php -d extension=/absolute/path/to/modules/acme_fsm.so`로 읽는다. vector는
`fsm-gen vectors --kind php-ext --php-namespace 'Acme\Fsm' --out <file>`로 쓴다. 이는 php 종류의 vector와 같은 바이트를 쓴다.

## 생성 파일

| 파일 | 내용 |
|---|---|
| `config.m4` | `phpize`가 읽는 빌드 선언(extension 이름, 소스) |
| `order.c` | 기계 하나: enum `State`와 `Event`, class `Step`, namespace 함수. `zend_register_internal_enum`과 `ZEND_NS_NAMED_FE`로 등록한다 |
| `fsm.c` | 공유 namespace `Fsm`의 enum `Code`와 예외 `Error`, 그리고 정의 순서로 모든 기계를 초기화하는 module 진입점 |
| `php_acme_fsm.h` | extension의 header |
| `acme_fsm_arginfo.h` | 함수의 인자 정보 |
| `acme_fsm.stub.php` | 편집기와 정적 분석을 위한 선언 |

생성된 `src/` 파일은 생성 header를 가진다. `make build`가 만든 phpize 출력(configure 스크립트, object, `modules/` 디렉터리)은 `src/`에
쓰이고 Git이 무시한다. `fsm-gen gen`은 무시되는 파일을 건너뛰므로 빌드 뒤에도 `gen`을 실행할 수 있다. test bed의 `make clean`이
phpize 출력을 지운다.

## API

API는 php 종류의 것이다([php README](../php/README.ko.md), API 절). extension은 같은 이름, 같은 타입, 같은 예외를 준다:

```php
<?php
use Polyspec\FsmTest\Order\State;
use Polyspec\FsmTest\Order\Event;
use Polyspec\FsmTest\Order;

$step = Order\apply(State::Draft, Event::Next, State::Draft);   // Step with ->to and ->changed
```

순수 호출과 영속화 패턴은 php 패키지의 코드와 같다. test bed에는 자체 test가 없다.
php 패키지의 PHPUnit 파일(`packages/php/tests`)과 `examples/persist.php`가 extension을 시험하며, `composer.json`의
`autoload-dev`가 그것에 닿는다.

## 오류

함수는 `Polyspec\FsmTest\Fsm\Error`를 던진다. `\Exception`이며, `getCode()`(문자열 `E_CONFLICT`, `E_INVALID_TRANSITION`,
`E_UNKNOWN_CODE` 또는 `E_RESERVED_CODE`)와 속성 `expected`, `actual`, `event`(`?int`, 설정되지 않으면 `null`)를 가진다. 오류 code는
enum `Code`의 값이다. C 쪽은 php 쪽과 같은 class를 던진다(class의 생성자는 `fsm.c`에 등록된다). 그러므로 php 종류용으로 쓴 `catch`는
그대로 동작한다.

속성이 어떤 code에서 설정되는지는 명세 B-6(`docs/spec/fsm.md`)의 규칙이며 php 종류와 같다. `packages/php/tests/ConformanceTest.php`의 vector가 빌드된
module에서 이를 단언한다:

| Code | `expected` | `actual` | `event` |
|---|---|---|---|
| `E_CONFLICT` | 설정됨 | 설정됨 | 설정됨 |
| `E_INVALID_TRANSITION` | 설정됨 | `null` | 설정됨 |
| `E_UNKNOWN_CODE`, `E_RESERVED_CODE` | `null` | `null` | `null` |

## 영속화

`examples/persist.php`는 `make gen`이 만든, php 패키지 파일의 복사본이다. `docs/spec/fsm.md`, B-4의 SQLite, PostgreSQL, MySQL과 polyspec orm 영속화 패턴이다
([php README](../php/README.ko.md), 영속화 절). transaction은 row를 잠금 아래 읽고, event를 호출자가 관찰한 상태에 적용하며,
바뀐 상태만 쓴다. 영속화 case는 빌드된 module로 이 파일을 실행한다.

## 테스트

checkout에서 실행한다:

```sh
make fsm-php-ext-install   # composer install: the same packages as the php package (composer.lock)
make fsm-php-ext-test      # builds the extension (phpize, ./configure, make), then PHPUnit with --php-extension
make test-php-ext                      # the same from the root
make php-ext-persist-test-postgres # the persist cases on PostgreSQL (FSM_TEST_PG_DSN; a missing DSN exits 2)
make php-ext-persist-test-mysql   # the persist cases on MySQL (FSM_TEST_MYSQL_DSN)
```

실행 결과는 89개 case 중 89개 통과다. `packages/php/tests/ConformanceTest.php`는 빌드된 module을 대상으로 PHPUnit test
`testConformance` 하나를 vector case마다 이름이 `<feature>__<id>`인 data set으로, `packages/php/tests/ConformanceCase.php`의 검사로 실행한다. `make gen`은 `make clean` 없이 빌드 뒤에 실행한다. 생성 파일은
추적하지 않는다. `make fsm-php-ext-gen`이 생성하며 `make test-php-ext`가 먼저 실행한다. `make parity-php-ext`는 모든 vector case가 한 번씩 실행되어 통과했는지 검사한다.
