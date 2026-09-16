<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

/**
 * One number on a dashboard, and everything needed to read it honestly.
 *
 * Four cards at the top of a screen are the part of this product people will
 * act on without reading anything else, so each one carries three things a bare
 * figure does not:
 *
 *   basis       whether it is a movement over a period, a balance as at a date,
 *               a window of future dates, or something a person said would
 *               happen. "Sales this month" and "To collect" are not the same
 *               kind of number and must not be read as though they were.
 *   definition  what is counted, in a sentence, including whether tax is in it.
 *   status      ready, loading or unavailable. There is no fourth state, and in
 *               particular there is no "nought because the service did not
 *               answer" — `unavailable` exists precisely so that a failure can
 *               never render as a healthy zero.
 */
final class Metric
{
    public const BASIS_PERIOD = 'period';   // movement between two dates
    public const BASIS_AS_OF  = 'as_of';    // a balance at one date
    public const BASIS_WINDOW = 'window';   // falls due in a future window
    public const BASIS_COUNT  = 'count';    // a number of things, not money
    public const BASIS_STATED = 'stated';   // what somebody said, not a fact

    /**
     * @param array<string, mixed> $extra
     * @return array<string, mixed>
     */
    public static function ready(
        string $id,
        string $label,
        float|int|null $value,
        string $basis,
        string $definition,
        ?array $comparison = null,
        string $tone = 'neutral',
        array $extra = [],
    ): array {
        // A null value is an absent value, whatever the caller meant by it.
        if ($value === null) {
            return self::unavailable($id, $label, $basis, $definition, 'No figure was returned for this.');
        }

        return [
            'id'         => $id,
            'label'      => $label,
            'value'      => is_int($value) ? $value : round((float) $value, 2),
            'status'     => 'ready',
            'basis'      => $basis,
            'definition' => $definition,
            'comparison' => $comparison,
            'tone'       => $tone,
        ] + $extra;
    }

    /**
     * @return array<string, mixed>
     */
    public static function unavailable(string $id, string $label, string $basis, string $definition, string $reason): array
    {
        return [
            'id'         => $id,
            'label'      => $label,
            'value'      => null,
            'status'     => 'unavailable',
            'basis'      => $basis,
            'definition' => $definition,
            'comparison' => null,
            'tone'       => 'neutral',
            'reason'     => $reason,
        ];
    }

    /**
     * A like-for-like comparison, or an honest refusal to draw one.
     *
     * Two traps this closes. A previous period of zero has no percentage —
     * dividing by it produces either an exception or a meaningless "∞%", and
     * both have shipped in other dashboards. And a rise is not automatically
     * good: `$riseIsGood` is required rather than defaulted, because the field
     * this is wrong about most often is overdue debt, where +14% is bad news
     * painted green.
     *
     * @return array<string, mixed>|null
     */
    public static function compare(?float $current, ?float $previous, string $previousLabel, bool $riseIsGood): ?array
    {
        if ($current === null || $previous === null) {
            return null;
        }
        if (abs($previous) < 0.005) {
            return [
                'available' => false,
                'label'     => 'No comparison available',
                'detail'    => 'Nothing was recorded in ' . $previousLabel . '.',
            ];
        }

        $change = ($current - $previous) / abs($previous) * 100;
        $rising = $change >= 0;

        return [
            'available'  => true,
            'percent'    => round($change, 1),
            'direction'  => $rising ? 'up' : 'down',
            'label'      => sprintf('%s%.1f%% vs %s', $rising ? '+' : '−', abs($change), $previousLabel),
            // Whether the direction is welcome, stated once here rather than
            // decided by a colour in six different components.
            'tone'       => ($rising === $riseIsGood) ? 'positive' : 'warning',
            'previous'   => round($previous, 2),
        ];
    }
}
