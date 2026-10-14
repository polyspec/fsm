<!-- doc-id: readme-php-ext -->
# polyspec/fsm-php-ext

[한국어](README.ko.md)

The PHP extension kind of fsm (`docs/plans/fsm-v1.md`, C-2). The package is private and is a test bed: it is not published. It
builds the generated state machines of a fsm definition as one PHP extension, `polyspec_fsm_test`, and checks that extension
against the same conformance vectors as the php package. Its public API is the API of the php kind: the namespace
`Polyspec\FsmTest`, a sub-namespace per machine (such as `Polyspec\FsmTest\Order`) with the enums `State` and `Event`, the
class `Step`, and the functions `initial`, `code`, `key`, `fromCode`, `isFinal`, `eventsFrom`, `target` and `apply`. The shared
`Polyspec\FsmTest\Fsm` holds the enum `Code` and the exception `Error`. The functions are written in C and registered in the
namespace, so a consumer calls them as the php kind does.

## Generate into your project

Generate into the source directory of your extension. The namespace and the extension name are required:

```sh
fsm-gen gen --project /path/to/order-machines --kind php-ext --php-namespace 'Acme\Fsm' --php-ext-name acme_fsm --out ./ext/src
```

```text
[fsm-gen] gen: ok
```

The extension is then built in that directory with the PHP build tools, as the test bed does with `make build`:

```sh
cd ext/src && phpize && ./configure && make
```

The module is `modules/acme_fsm.so`. Load it with `php -d extension=/absolute/path/to/modules/acme_fsm.so`. The vectors come from
`fsm-gen vectors --kind php-ext --php-namespace 'Acme\Fsm' --out <file>`, which writes the same bytes as the php kind's vectors.

## Generated files

| File | Content |
|---|---|
| `config.m4` | the build declaration that `phpize` reads (the extension name, its sources) |
| `order.c` | one machine: the enums `State` and `Event`, the class `Step`, and the namespace functions, with `zend_register_internal_enum` and `ZEND_NS_NAMED_FE` |
| `fsm.c` | the shared namespace `Fsm` with the enum `Code` and the exception `Error`, and the module entry that initializes every machine in definition order |
| `php_acme_fsm.h` | the header of the extension |
| `acme_fsm_arginfo.h` | the argument information of the functions |
| `acme_fsm.stub.php` | the declarations for editors and static analysis |

The generated `src/` files carry the generated header. The phpize output of `make build` (configure scripts, objects, the
`modules/` directory) is written into `src/` and is ignored by Git; `fsm-gen gen` skips the ignored files, so `gen` may run
after a build. `make clean` in the test bed removes the phpize output.

## API

The API is the one of the php kind (see [the php README](../php/README.md), API). The extension gives the same names and
types, and the same exceptions:

```php
<?php
use Polyspec\FsmTest\Order\State;
use Polyspec\FsmTest\Order\Event;
use Polyspec\FsmTest\Order;

$step = Order\apply(State::Draft, Event::Next, State::Draft);   // Step with ->to and ->changed
```

The pure call and the persistence pattern are the same code as the php package's: the test bed copies `tests/ConformanceCase.php`
and `examples/persist.php` from the php package, and `tests/ConformanceTest.php` is byte-identical to the php package's file.

## Errors

The functions throw `Polyspec\FsmTest\Fsm\Error`, an `\Exception` with `getCode()` (the string `E_CONFLICT`, `E_INVALID_TRANSITION`,
`E_UNKNOWN_CODE` or `E_RESERVED_CODE`) and the properties `expected`, `actual` and `event` (`?int`, `null` when unset). The error
codes are the values of the enum `Code`. The C side throws the same class as the php side (the constructor of the class is
registered in `fsm.c`), so a `catch` written for the php kind works unchanged.

Which properties a code sets is the rule of spec B-6 (`docs/spec/fsm.md`), the same as the php kind's. The vectors of
`tests/ConformanceTest.php` assert it on the built module:

| Code | `expected` | `actual` | `event` |
|---|---|---|---|
| `E_CONFLICT` | set | set | set |
| `E_INVALID_TRANSITION` | set | `null` | set |
| `E_UNKNOWN_CODE`, `E_RESERVED_CODE` | `null` | `null` | `null` |

## Persistence

`examples/persist.php` is a copy of the php package's file, made by `make gen`. It is the persistence pattern of
`docs/spec/fsm.md`, B-4 on SQLite, PostgreSQL and MySQL with polyspec orm (see [the php README](../php/README.md), Persistence): a transaction reads
the row under its lock, applies the event to the state that the caller observed, and writes only a changed state. The persist
cases run it with the built module.

## Tests

From the checkout:

```sh
make -C packages/php-ext install   # composer install: the same packages as the php package (composer.lock)
make -C packages/php-ext test      # builds the extension (phpize, ./configure, make), then PHPUnit with --php-extension
make test-php-ext                      # the same from the root
make php-ext-persist-test-postgres # the persist cases on PostgreSQL (FSM_TEST_PG_DSN; a missing DSN exits 2)
make php-ext-persist-test-mysql   # the persist cases on MySQL (FSM_TEST_MYSQL_DSN)
```

The run passes 89 of 89 cases: `tests/ConformanceTest.php` (byte-identical to the php package's file) runs one PHPUnit test per vector case,
named `test_<feature>__<id>`, against the built module, with the checks of `tests/ConformanceCase.php`. `make gen` runs after a build without `make clean`. The root
`make gen-check` checks that the generated files and the copies are current, and `make parity-php-ext` checks that every vector
case ran once and passed.
