<?php
// The conformance tests of the php package (docs/plans/fsm-v1.md, C-4). Every vector case of Vectors.php (generated from the
// core oracle) is one PHPUnit test named test_<feature>__<id>: it calls the generated functions and cases of the machine module
// and asserts the expected value or the error code. The persist cases run the B-4 example (examples/persist.php) on the dialect
// of FSM_TEST_DIALECT (sqlite by default; docs/plans/fsm-v1.md, C-6) and assert the stored state after the run. The names follow
// docs/spec/fsm.md, B-6: a key is a case by its pascal notation.
//
// The file uses the public API of the generated code only: the namespace of each machine and its functions and cases, the Error
// class of the shared namespace, and the functions of the persist example. It names no path, so the package and the php
// extension run the same file.
//
// The file declares no strict_types, on purpose: its calls are in coercive mode, the mode of a caller that does not declare it. The
// cases with an input of another type (input_type, docs/spec/fsm.md, B-6) are refused in this mode, where a coercion would give a
// state, so the mode is the one that the fix is for.

namespace Polyspec\FsmTest\Tests;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Polyspec\FsmTest\Examples;
use Polyspec\FsmTest\Fsm\Error;

final class ConformanceTest extends TestCase
{
    /** The namespace of the generated code: one module per machine, <ns>\<Pascal machine key> (docs/spec/fsm.md, B-6). */
    private const ROOT = 'Polyspec\\FsmTest';

    /** @return iterable<string, array{string, array<string, mixed>}> the cases by test name test_<feature>__<id> */
    public static function cases(): iterable
    {
        foreach (Vectors::cases() as $name => $data) {
            yield $name => [$data['machine'], $data['case']];
        }
    }

    #[DataProvider('cases')]
    public function testConformance(string $machine, array $case): void
    {
        $module = self::ROOT . '\\' . self::pascal($machine);
        if ($case['feature'] === 'persist') {
            $this->persist($module, $case);
        } else {
            $this->check($module, $case);
        }
    }

    /** The case name of a key: its pascal notation (docs/spec/fsm.md, B-6). */
    private static function pascal(string $key): string
    {
        return implode('', array_map(static fn(string $word): string => ucfirst($word), explode('_', $key)));
    }

    /** The state or event case of $key in the module $module. */
    private static function caseOf(string $module, string $type, string $key): \UnitEnum
    {
        return constant($module . '\\' . $type . '::' . self::pascal($key));
    }

    /** Calls the function $function of the module $module. */
    private static function call(string $module, string $function, mixed ...$arguments): mixed
    {
        $callable = $module . '\\' . $function;
        return $callable(...$arguments);
    }

    /** Asserts that $call throws the fsm Error with the code and the fields of $expect (null where the field does not apply). */
    private static function assertError(array $expect, \Closure $call): void
    {
        try {
            $call();
        } catch (Error $error) {
            self::assertSame($expect['error'], $error->getCode());
            self::assertSame($expect['expected'], $error->expected);
            self::assertSame($expect['actual'], $error->actual);
            self::assertSame($expect['event'], $error->event);
            return;
        }
        self::fail("expected {$expect['error']}, but nothing was thrown");
    }

    /** Runs a case of a feature other than persist against the functions of $module. */
    private function check(string $module, array $c): void
    {
        switch ($c['feature']) {
            case 'initial':
                self::assertSame(self::caseOf($module, 'State', $c['expect']['state']), self::call($module, 'initial'));
                return;
            case 'code':
                self::assertSame($c['expect'], self::call($module, 'code', self::caseOf($module, 'State', $c['state'])));
                return;
            case 'key':
                self::assertSame($c['expect'], self::call($module, 'key', self::call($module, 'fromCode', $c['code'])));
                return;
            case 'from_code':
                if (array_key_exists('error', $c['expect'])) {
                    self::assertError($c['expect'], fn() => self::call($module, 'fromCode', $c['input']));
                } else {
                    self::assertSame(self::caseOf($module, 'State', $c['expect']['state']), self::call($module, 'fromCode', $c['input']));
                }
                return;
            case 'is_final':
                self::assertSame($c['expect'], self::call($module, 'isFinal', self::caseOf($module, 'State', $c['state'])));
                return;
            case 'events_from':
                self::assertSame(
                    array_map(static fn(string $key): string => self::pascal($key), $c['expect']),
                    array_map(static fn(\UnitEnum $event): string => $event->name, self::call($module, 'eventsFrom', self::caseOf($module, 'State', $c['state']))),
                );
                return;
            case 'target':
                $expected = self::caseOf($module, 'State', $c['state']);
                $event = self::caseOf($module, 'Event', $c['event']);
                if (array_key_exists('error', $c['expect'])) {
                    self::assertError($c['expect'], fn() => self::call($module, 'target', $expected, $event));
                } else {
                    self::assertSame(self::caseOf($module, 'State', $c['expect']['state']), self::call($module, 'target', $expected, $event));
                }
                return;
            case 'apply':
                $expected = self::caseOf($module, 'State', $c['expected']);
                $event = self::caseOf($module, 'Event', $c['event']);
                $actual = self::caseOf($module, 'State', $c['actual']);
                if (array_key_exists('error', $c['expect'])) {
                    self::assertError($c['expect'], fn() => self::call($module, 'apply', $expected, $event, $actual));
                } else {
                    $step = self::call($module, 'apply', $expected, $event, $actual);
                    self::assertSame(self::caseOf($module, 'State', $c['expect']['to']), $step->to);
                    self::assertSame($c['expect']['changed'], $step->changed);
                }
                return;
            default:
                self::fail("no check for the feature {$c['feature']}; the vectors and this file must agree");
        }
    }

    /**
     * Opens the database of one persist case on the dialect that FSM_TEST_DIALECT names (docs/plans/fsm-v1.md, C-6): sqlite, the
     * default, is a new file of $directory; postgres and mysql take their DSN from FSM_TEST_PG_DSN and FSM_TEST_MYSQL_DSN. A missing
     * DSN fails the case, so no dialect is skipped. The rows of the persist table are cleared, so a case reads only the row it seeds.
     */
    private function openPersistDatabase(string $directory): \Polyspec\Orm\Db
    {
        $dialect = getenv('FSM_TEST_DIALECT');
        if ($dialect === false || $dialect === '') {
            $dialect = 'sqlite';
        }
        if ($dialect === 'sqlite') {
            $dsn = 'sqlite://' . $directory . '/persist.db';
        } elseif ($dialect === 'postgres' || $dialect === 'mysql') {
            $variable = $dialect === 'postgres' ? 'FSM_TEST_PG_DSN' : 'FSM_TEST_MYSQL_DSN';
            $dsn = getenv($variable);
            if ($dsn === false || $dsn === '') {
                self::fail("{$variable} is not set: the {$dialect} persist cases need a database DSN and never skip");
            }
        } else {
            self::fail("FSM_TEST_DIALECT must be sqlite, postgres or mysql, it is {$dialect}");
        }
        $db = Examples\open($dsn);
        self::assertSame($dialect, $db->driver(), 'the database dialect');
        if ($dialect !== 'sqlite') {
            (new \Polyspec\FsmTest\Model\Item())->connect($db)->gets()->delete();
        }
        return $db;
    }

    /** Runs a persist case and asserts the stored state after the run. */
    private function persist(string $module, array $c): void
    {
        $directory = sys_get_temp_dir() . '/fsm-php-persist-' . bin2hex(random_bytes(8));
        mkdir($directory, 0700);
        $db = $this->openPersistDatabase($directory);
        try {
            Examples\seed($db, 1, self::call($module, 'code', self::caseOf($module, 'State', $c['stored'])));
            $expected = self::caseOf($module, 'State', $c['expected']);
            $event = self::caseOf($module, 'Event', $c['event']);
            if (array_key_exists('error', $c['expect'])) {
                self::assertError($c['expect'], fn() => Examples\transition($db, $module, 1, $expected, $event));
            } else {
                $step = Examples\transition($db, $module, 1, $expected, $event);
                self::assertSame(self::caseOf($module, 'State', $c['expect']['stored_after']), $step->to);
                self::assertSame($c['expect']['changed'], $step->changed);
            }
            self::assertSame(
                self::call($module, 'code', self::caseOf($module, 'State', $c['expect']['stored_after'])),
                Examples\statusOf($db, 1),
                'the stored state after the run',
            );
        } finally {
            $db->close();
            foreach (glob($directory . '/*') ?: [] as $file) {
                unlink($file);
            }
            rmdir($directory);
        }
    }
}
