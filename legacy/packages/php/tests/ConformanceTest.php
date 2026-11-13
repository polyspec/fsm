<?php

// The conformance test of the php package (docs/plans/fsm-v1/plan.md, C-4): one data set per vector case of
// contracts/conformance/vectors.json (written from the core oracle), read when the test runs, named by the case name
// <feature>__<id>. The checks are those of ConformanceCase.

namespace Polyspec\FsmTest\Tests;

use PHPUnit\Framework\Attributes\DataProvider;

final class ConformanceTest extends ConformanceCase
{
    /**
     * The vector file of the oracle: contracts/conformance/vectors.json, found in the nearest parent folder that
     * holds it.
     */
    private static function vectorsFile(): string
    {
        for ($directory = __DIR__; dirname($directory) !== $directory; $directory = dirname($directory)) {
            $candidate = $directory . '/contracts/conformance/vectors.json';
            if (is_file($candidate)) {
                return $candidate;
            }
        }
        throw new \RuntimeException('no parent folder of the test holds contracts/conformance/vectors.json');
    }

    /**
     * The input of a from_code case as the php kind decodes it (docs/spec/fsm.md, B-6): the oracle gives it as a
     * decimal string, which is the int it names (a float beyond the 64-bit range, as the numeric string of PHP is), a
     * float, a string or a bool by the input_type of the case.
     *
     * @param array<string, mixed> $case
     * @return array<string, mixed>
     */
    private static function decoded(array $case): array
    {
        if (!array_key_exists('input', $case)) {
            return $case;
        }
        $text = $case['input'];
        $case['input'] = match ($case['input_type'] ?? null) {
            null => $text + 0,
            'float' => (float) $text,
            'string' => $text,
            'bool' => $text === 'true',
            default => throw new \RuntimeException(
                'the input type ' . var_export($case['input_type'], true) . ' of ' . $case['id'] . ' is not known',
            ),
        };
        unset($case['input_type']);
        return $case;
    }

    /**
     * The machine and the case of every vector case, keyed by the case name.
     *
     * @return iterable<string, array{string, array<string, mixed>}>
     */
    public static function cases(): iterable
    {
        $vectors = json_decode((string) file_get_contents(self::vectorsFile()), true, 512, JSON_THROW_ON_ERROR);
        foreach ($vectors['machines'] as $entry) {
            foreach ($entry['cases'] as $case) {
                yield $case['name'] => [$entry['machine'], self::decoded($case)];
            }
        }
    }

    /**
     * Runs one vector case of a machine through the checks of ConformanceCase.
     *
     * @param array<string, mixed> $case
     */
    #[DataProvider('cases')]
    // FSM-B4-5: every apply case of the vector file gives the result of the B-4 table (docs/spec/fsm.md).
    public function testConformance(string $machine, array $case): void
    {
        $this->conformance($machine, $case);
    }
}
