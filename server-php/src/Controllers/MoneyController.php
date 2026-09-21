<?php

declare(strict_types=1);

namespace Aicountly\Api\Controllers;

use Aicountly\Api\Db;
use Aicountly\Api\Domain\MoneyActivityService;
use Aicountly\Api\Domain\Period;
use Aicountly\Api\Http;

/**
 * The context the money screens show around the form.
 *
 * Both endpoints read Smart Books live. Neither creates anything, and neither
 * reads a Billing copy of a payment — see MoneyActivityService for why there
 * is no such copy to read.
 */
final class MoneyController extends Controller
{
    /** The period's entries and what they add up to. */
    public static function recent(): void
    {
        [$auth, $ctx] = self::enter();

        $direction = self::direction();
        $limit = Http::intParam('limit', 8) ?? 8;

        Http::data((new MoneyActivityService($ctx, $auth))->recent(
            $direction,
            self::period($ctx->cmpId),
            max(1, min($limit, 50)),
        ));
    }

    /** When this party was last paid, or last paid us. */
    public static function partyContext(): void
    {
        [$auth, $ctx] = self::enter();

        $partyId = Http::intParam('party_account_id');
        if ($partyId === null || $partyId <= 0) {
            Http::validationFailed('Choose the party first.', ['field' => 'party_account_id']);
        }

        Http::data((new MoneyActivityService($ctx, $auth))->partyContext(self::direction(), $partyId));
    }

    private static function direction(): string
    {
        $direction = Http::param('direction', 'out') ?? 'out';
        if (!MoneyActivityService::isDirection($direction)) {
            Http::validationFailed('Ask for money in or money out.', ['field' => 'direction']);
        }

        return $direction;
    }

    /**
     * The window, resolved in the COMPANY's timezone.
     *
     * Same resolution the reports use, for the same reason: a "today" that
     * disagrees with the till is worse than no figure.
     */
    private static function period(int $cmpId): Period
    {
        $row = Db::first('SELECT timezone FROM billing_settings WHERE cmp_id = :cmp', ['cmp' => $cmpId]);
        $timezone = is_string($row['timezone'] ?? null) && $row['timezone'] !== '' ? $row['timezone'] : 'Asia/Kolkata';

        return Period::resolve([
            'key'  => Http::param('period'),
            'from' => Http::param('from'),
            'to'   => Http::param('to'),
        ], $timezone);
    }
}
