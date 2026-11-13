<?php

// The common suite of the legacy tests, contracts/conformance/vectors.json, with its expectations on the PHP binding of
// fsm (plan f6, step 7a-1; docs/plans/fsm-v1/checklist.md, S-462): the checks of
// legacy/packages/php/tests/ConformanceCase.php on the class Polyspec\Fsm\Machine of the extension. Each machine is
// Machine::parse of its file and the reserved codes of its lock entry. A state and an event are their keys; a raw code
// of a vector goes through key first, as the legacy test sends it through fromCode. An error is compared by the kind of
// the core that the B-6 code of the vector names, and by the fields expected, actual and event (null where the field
// does not apply). The persist vectors are the cases of step 7p, which binds the store.

namespace Polyspec\FsmBindingTest;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Polyspec\Fsm\Machine;

final class ConformanceTest extends TestCase
{
    /** The kind of the core for each B-6 code of the vectors (docs/spec/fsm.md, B-7). */
    private const KINDS = [
        'E_CONFLICT' => 'conflict',
        'E_INVALID_TRANSITION' => 'invalid_transition',
        'E_UNKNOWN_CODE' => 'unknown_code',
        'E_RESERVED_CODE' => 'reserved_code',
    ];

    /**
     * The folder contracts of the repository: the nearest parent folder of the test that holds
     * contracts/conformance/vectors.json.
     */
    private static function contracts(): string
    {
        for ($directory = __DIR__; dirname($directory) !== $directory; $directory = dirname($directory)) {
            if (is_file($directory . '/contracts/conformance/vectors.json')) {
                return $directory . '/contracts';
            }
        }
        throw new \RuntimeException('no parent folder of the test holds contracts/conformance/vectors.json');
    }

    /** @return array<string, mixed> */
    private static function json(string $path): array
    {
        return json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
    }

    /**
     * The input of a from_code vector as the legacy test passes it: the text of a string input, else the JSON value of
     * the text. The vectors give an int, a float or a bool as its JSON text, so its JSON value is the int, the float or
     * the bool that the legacy test decodes (legacy/packages/php/tests/ConformanceTest.php, decoded).
     *
     * @param array<string, mixed> $case
     */
    private static function input(array $case): mixed
    {
        $kind = $case['input_type'] ?? null;
        if (!in_array($kind, [null, 'float', 'string', 'bool'], true)) {
            throw new \RuntimeException(
                'the input type ' . var_export($kind, true) . ' of ' . $case['id'] . ' is not known',
            );
        }
        return $kind === 'string' ? $case['input'] : json_decode($case['input'], false, 512, JSON_THROW_ON_ERROR);
    }

    /**
     * The machine file, the reserved codes and the vector of every vector but the persist vectors, keyed by the vector
     * name.
     *
     * @return iterable<string, array{string, list<int>, array<string, mixed>}>
     */
    public static function vectors(): iterable
    {
        $contracts = self::contracts();
        $lock = self::json($contracts . '/fsm.lock.json');
        foreach (self::json($contracts . '/conformance/vectors.json')['machines'] as $entry) {
            $definition = (string) file_get_contents($contracts . '/machines/' . $entry['machine'] . '.fsm.json');
            foreach ($entry['cases'] as $case) {
                if ($case['feature'] !== 'persist') {
                    yield $case['name'] => [$definition, $lock[$entry['machine']]['reserved'], $case];
                }
            }
        }
    }

    /**
     * The state argument of a vector: the key of its raw code when the vector gives one, its key otherwise.
     *
     * @param array<string, mixed> $case
     */
    private static function state(Machine $machine, array $case, string $key, string $value): string
    {
        return array_key_exists($value, $case) ? $machine->key($case[$value]) : $case[$key];
    }

    /**
     * Asserts that `$call` throws an error with the kind of the B-6 code of `$expect` and the fields of `$expect`.
     *
     * @param array<string, mixed> $expect
     */
    private static function assertError(array $expect, callable $call): void
    {
        try {
            $call();
        } catch (\Throwable $error) {
            self::assertSame(
                [
                    'kind' => self::KINDS[$expect['error']],
                    'expected' => $expect['expected'],
                    'actual' => $expect['actual'],
                    'event' => $expect['event'],
                ],
                [
                    'kind' => method_exists($error, 'kind') ? $error->kind() : $error::class,
                    'expected' => $error->expected ?? null,
                    'actual' => $error->actual ?? null,
                    'event' => $error->event ?? null,
                ],
            );
            return;
        }
        self::fail("expected {$expect['error']}, but nothing was thrown");
    }

    /**
     * Runs one vector on the machine of its file.
     *
     * @param list<int> $reserved
     * @param array<string, mixed> $case
     */
    #[DataProvider('vectors')]
    public function testVector(string $definition, array $reserved, array $case): void
    {
        $machine = Machine::parse($definition, $reserved);
        $expect = $case['expect'];
        $fails = is_array($expect) && array_key_exists('error', $expect);
        $run = static function (callable $call, callable $compare) use ($fails, $expect): void {
            if ($fails) {
                self::assertError($expect, $call);
            } else {
                $compare($call());
            }
        };
        switch ($case['feature']) {
            case 'initial':
                self::assertSame($expect['state'], $machine->initial());
                return;
            case 'code':
                $run(
                    fn() => $machine->code(self::state($machine, $case, 'state', 'value')),
                    fn($value) => self::assertSame($expect, $value),
                );
                return;
            case 'key':
                $run(fn() => $machine->key($case['code']), fn($value) => self::assertSame($expect, $value));
                return;
            case 'from_code':
                $run(
                    fn() => $machine->fromCode(self::input($case)),
                    fn($value) => self::assertSame($expect['state'], $value),
                );
                return;
            case 'is_final':
                $run(
                    fn() => $machine->isFinal(self::state($machine, $case, 'state', 'value')),
                    fn($value) => self::assertSame($expect, $value),
                );
                return;
            case 'events_from':
                self::assertSame($expect, $machine->eventsFrom($case['state']));
                return;
            case 'target':
                $run(
                    fn() => $machine->target($case['state'], $case['event']),
                    fn($value) => self::assertSame($expect['state'], $value),
                );
                return;
            case 'apply':
                $run(
                    fn() => $machine->apply(
                        self::state($machine, $case, 'expected', 'expected_value'),
                        $case['event'],
                        self::state($machine, $case, 'actual', 'actual_value'),
                    ),
                    fn($step) => self::assertSame(
                        ['to' => $expect['to'], 'changed' => $expect['changed']],
                        ['to' => $step->to, 'changed' => $step->changed],
                    ),
                );
                return;
            default:
                self::fail("no check for the feature {$case['feature']}; the vectors and this file must agree");
        }
    }
}
