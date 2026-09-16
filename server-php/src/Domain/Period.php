<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

/**
 * The date window a dashboard is showing, and the one it compares against.
 *
 * Small but load-bearing. "Due this week" is the figure people ring customers
 * about, and it means nothing until somebody has decided where the week starts
 * and in whose day. Both decisions are made here, once:
 *
 *   * the window is inclusive of both ends, always, so a month is the 1st to
 *     the 31st and not the 1st to the 30th-and-a-bit;
 *   * dates are resolved in the COMPANY's timezone, not the server's and not
 *     the browser's. A shop closing at 9pm in Kolkata is still open when a UTC
 *     server has already started tomorrow, and a "today" that disagrees with
 *     the till is worse than no figure.
 *
 * The comparison window is the immediately preceding window of the same length,
 * so a 30-day month is compared with the 30 days before it rather than with a
 * calendar month that might be 28.
 */
final class Period
{
    private function __construct(
        public readonly string $key,
        public readonly string $from,
        public readonly string $to,
        public readonly string $label,
        public readonly string $previousFrom,
        public readonly string $previousTo,
        public readonly string $previousLabel,
        public readonly string $timezone,
    ) {
    }

    /**
     * @param array{key?:?string, from?:?string, to?:?string} $input
     */
    public static function resolve(array $input, string $timezone = 'Asia/Kolkata'): self
    {
        $zone = self::zone($timezone);
        $today = new \DateTimeImmutable('now', $zone);
        $key = $input['key'] ?? 'month';

        // An explicit from/to beats the named window: a user who picked dates
        // means those dates.
        if (!empty($input['from']) && !empty($input['to'])) {
            $from = self::parse($input['from'], $zone) ?? $today;
            $to = self::parse($input['to'], $zone) ?? $today;
            if ($from > $to) {
                [$from, $to] = [$to, $from];
            }

            return self::spanning($from, $to, 'custom', 'Selected dates', $zone);
        }

        return match ($key) {
            'today' => self::spanning($today, $today, 'today', 'Today', $zone),
            'week'  => self::spanning(
                $today->modify('monday this week'),
                $today,
                'week',
                'This week so far',
                $zone,
            ),
            'year' => self::spanning(
                $today->modify('first day of January this year'),
                $today,
                'year',
                'This year so far',
                $zone,
            ),
            default => self::spanning(
                $today->modify('first day of this month'),
                $today,
                'month',
                $today->format('F Y'),
                $zone,
            ),
        };
    }

    /** The company's today, which is the only "today" this product recognises. */
    public function today(): string
    {
        return (new \DateTimeImmutable('now', self::zone($this->timezone)))->format('Y-m-d');
    }

    /** The inclusive end of a window N days ahead of today. */
    public function windowEnd(int $days): string
    {
        return (new \DateTimeImmutable('now', self::zone($this->timezone)))
            ->modify('+' . $days . ' days')
            ->format('Y-m-d');
    }

    /** @return list<string> Every date in the window, so a chart has no holes. */
    public function eachDay(int $limit = 400): array
    {
        $out = [];
        $cursor = new \DateTimeImmutable($this->from, self::zone($this->timezone));
        $end = new \DateTimeImmutable($this->to, self::zone($this->timezone));
        while ($cursor <= $end && count($out) < $limit) {
            $out[] = $cursor->format('Y-m-d');
            $cursor = $cursor->modify('+1 day');
        }

        return $out;
    }

    public function days(): int
    {
        return count($this->eachDay());
    }

    /** @return array<string, string> */
    public function describe(): array
    {
        return [
            'key'            => $this->key,
            'from'           => $this->from,
            'to'             => $this->to,
            'label'          => $this->label,
            'previous_from'  => $this->previousFrom,
            'previous_to'    => $this->previousTo,
            'previous_label' => $this->previousLabel,
            'timezone'       => $this->timezone,
            'today'          => $this->today(),
        ];
    }

    private static function spanning(
        \DateTimeImmutable $from,
        \DateTimeImmutable $to,
        string $key,
        string $label,
        \DateTimeZone $zone,
    ): self {
        $lengthDays = (int) $from->diff($to)->format('%a') + 1;
        $previousTo = $from->modify('-1 day');
        $previousFrom = $previousTo->modify('-' . ($lengthDays - 1) . ' days');

        return new self(
            $key,
            $from->format('Y-m-d'),
            $to->format('Y-m-d'),
            $label,
            $previousFrom->format('Y-m-d'),
            $previousTo->format('Y-m-d'),
            $lengthDays === 1 ? 'the day before' : 'the previous ' . $lengthDays . ' days',
            $zone->getName(),
        );
    }

    private static function parse(string $raw, \DateTimeZone $zone): ?\DateTimeImmutable
    {
        try {
            return new \DateTimeImmutable($raw, $zone);
        } catch (\Throwable) {
            return null;
        }
    }

    private static function zone(string $timezone): \DateTimeZone
    {
        try {
            return new \DateTimeZone($timezone);
        } catch (\Throwable) {
            // A company configured with a timezone this PHP does not know is a
            // configuration problem, not a reason to refuse to draw a screen.
            return new \DateTimeZone('Asia/Kolkata');
        }
    }
}
