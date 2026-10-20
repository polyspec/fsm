<?php

// The persistence tests of the php package beyond the vector cases (docs/spec/fsm.md, B-4): two transitions of one row
// that run at the same time, each in its own process on its own connection, give the outcome that the pattern promises,
// and a deadlock runs the transaction again while another database error does not. Each method is named by its feature
// unit of config/parity.json. They run on the dialect of FSM_TEST_DIALECT (persistDsn of ConformanceCase). PHP runs one
// thread, so the two transitions run in two processes that pcntl_fork makes; a child opens its own connection, writes
// its outcome to a file and ends with SIGKILL, so it never closes a connection of the parent that it inherited. The
// file names no path, so the package and the php extension run the same file.

namespace Polyspec\FsmTest\Tests\Faulty {
    /**
     * The order machine of the retry tests: apply runs the fault that hook() holds before it applies the event, once
     * per attempt of the transaction. hook($fault) sets the fault; hook() returns it.
     */
    function hook(?\Closure $fault = null): \Closure
    {
        static $current = null;
        if ($fault !== null) {
            $current = $fault;
        }
        return $current;
    }

    /** The apply of the order machine after the fault of hook(). */
    function apply(\UnitEnum $expected, \UnitEnum $event, \UnitEnum $actual): object
    {
        (hook())();
        return \Polyspec\FsmTest\Order\apply($expected, $event, $actual);
    }

    /** The fromCode of the order machine. */
    function fromCode(mixed $value): \UnitEnum
    {
        return \Polyspec\FsmTest\Order\fromCode($value);
    }

    /** The code of the order machine. */
    function code(\UnitEnum $state): int
    {
        return \Polyspec\FsmTest\Order\code($state);
    }
}

namespace Polyspec\FsmTest\Tests {
    use Polyspec\FsmTest\Examples;
    use Polyspec\FsmTest\Fsm\Error;
    use Polyspec\FsmTest\Order\Event;
    use Polyspec\FsmTest\Order\State;
    use Polyspec\Orm\Code;
    use Polyspec\Orm\Db;
    use Polyspec\Orm\Orm;
    use Polyspec\Orm\OrmException;

    final class PersistTest extends ConformanceCase
    {
        private const ORDER = 'Polyspec\\FsmTest\\Order';
        private const FAULTY = 'Polyspec\\FsmTest\\Tests\\Faulty';

        private string $directory;
        private string $dsn;
        private Db $db;

        protected function setUp(): void
        {
            $this->directory = sys_get_temp_dir() . '/fsm-php-persist-' . bin2hex(random_bytes(8));
            mkdir($this->directory, 0700);
            [$this->dsn] = self::persistDsn($this->directory);
            $this->db = self::openPersistDatabase($this->directory);
            Examples\seed($this->db, 1, \Polyspec\FsmTest\Order\code(State::Draft));
        }

        protected function tearDown(): void
        {
            $this->db->close();
            foreach (glob($this->directory . '/*') ?: [] as $file) {
                unlink($file);
            }
            rmdir($this->directory);
        }

        /**
         * Runs one transition from Draft per event at the same time, each in a child process on its own connection, and
         * returns the outcome of each: ['to' => key, 'changed' => bool] or ['error' => code].
         *
         * @param list<Event> $events
         * @return list<array<string, mixed>>
         */
        private function together(array $events): array
        {
            $children = [];
            foreach ($events as $index => $event) {
                $file = $this->directory . '/outcome-' . $index . '.json';
                $pid = pcntl_fork();
                self::assertNotSame(-1, $pid, 'fork a child process');
                if ($pid === 0) {
                    try {
                        $db = Examples\open($this->dsn);
                        $step = Examples\transition($db, self::ORDER, 1, State::Draft, $event);
                        $outcome = ['to' => $step->to->name, 'changed' => $step->changed];
                    } catch (\Throwable $error) {
                        $outcome = ['error' => $error instanceof Error
                            ? $error->getCode()
                            : $error::class . ': ' . $error->getMessage()];
                    }
                    file_put_contents($file, json_encode($outcome, JSON_THROW_ON_ERROR));
                    posix_kill(posix_getpid(), SIGKILL);
                }
                $children[$pid] = $file;
            }
            $outcomes = [];
            foreach ($children as $pid => $file) {
                pcntl_waitpid($pid, $waited);
                $outcomes[] = json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
            }
            return $outcomes;
        }

        // FSM-B4-1: two transitions of one (expected, event) at the same time: one Changed, one Unchanged (the row
        // lock).
        public function testPersistConcurrentSameEvent(): void
        {
            $outcomes = $this->together([Event::Next, Event::Next]);
            foreach ($outcomes as $outcome) {
                self::assertSame('Paid', $outcome['to'] ?? null, 'both transitions succeed: ' . json_encode($outcomes));
            }
            $changed = array_column($outcomes, 'changed');
            sort($changed);
            self::assertSame([false, true], $changed, 'one Changed and one Unchanged');
            self::assertSame(\Polyspec\FsmTest\Order\code(State::Paid), Examples\statusOf($this->db, 1));
        }

        // FSM-B4-2: two transitions from one expected state with different events at the same time: one Changed, one
        // E_CONFLICT.
        public function testPersistConcurrentConflict(): void
        {
            $outcomes = $this->together([Event::Next, Event::Cancel]);
            $changed = array_values(array_filter($outcomes, static fn(array $outcome): bool => isset($outcome['to'])));
            $failed = array_values(
                array_filter($outcomes, static fn(array $outcome): bool => isset($outcome['error'])),
            );
            self::assertCount(1, $changed, 'one transition changes the row: ' . json_encode($outcomes));
            self::assertTrue($changed[0]['changed']);
            self::assertCount(1, $failed, 'the other transition fails');
            self::assertSame('E_CONFLICT', $failed[0]['error']);
            self::assertSame(
                \Polyspec\FsmTest\Order\code(constant(State::class . '::' . $changed[0]['to'])),
                Examples\statusOf($this->db, 1),
            );
        }

        // FSM-B4-3: a deadlock inside the transaction runs the transaction again.
        public function testPersistRetryOnDeadlock(): void
        {
            $attempts = 0;
            Faulty\hook(static function () use (&$attempts): void {
                $attempts++;
                if ($attempts === 1) {
                    throw Orm::transactionConflict('injected deadlock');
                }
            });
            $step = Examples\transition($this->db, self::FAULTY, 1, State::Draft, Event::Next);
            self::assertSame(2, $attempts, 'the transaction runs again after a deadlock');
            self::assertSame(State::Paid, $step->to);
            self::assertTrue($step->changed);
            self::assertSame(\Polyspec\FsmTest\Order\code(State::Paid), Examples\statusOf($this->db, 1));
        }

        // FSM-B4-4: another database error is returned after one attempt, with no second run.
        public function testPersistNoRetryOnOtherError(): void
        {
            $attempts = 0;
            Faulty\hook(static function () use (&$attempts): void {
                $attempts++;
                throw new OrmException(Code::CONNECTION_LOST, 'injected');
            });
            try {
                Examples\transition($this->db, self::FAULTY, 1, State::Draft, Event::Next);
                self::fail('the transition must fail');
            } catch (OrmException $error) {
                self::assertSame(Code::CONNECTION_LOST, $error->code_);
            }
            self::assertSame(1, $attempts, 'a database error other than a deadlock is not run again');
            self::assertSame(\Polyspec\FsmTest\Order\code(State::Draft), Examples\statusOf($this->db, 1));
        }
    }
}
