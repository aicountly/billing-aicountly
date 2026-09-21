<?php

declare(strict_types=1);

namespace Aicountly\Api\Controllers;

use Aicountly\Api\Domain\BankCashHistory;
use Aicountly\Api\Http;
use Aicountly\Api\Permissions;

/**
 * What the bank deposit and withdrawal screens need beyond recording one.
 *
 * Recording is still `POST v1/transactions/bank_withdrawal` — one service makes
 * every transaction in this product and that has not changed. This is the thing
 * around the form: what was moved lately, so somebody about to type ₹50,000
 * can see whether they already typed it this morning.
 *
 * The BALANCES are not here. They are `v1/cash-bank`, which existed before this
 * screen and is read live from Books; a second endpoint answering the same
 * question is exactly the duplication this product is built to avoid.
 */
final class BankCashController extends Controller
{
    /**
     * The last few cash/bank movements recorded from Billing, named live.
     *
     * Gated on `contra.create`, the same permission as the screen and as the
     * POST behind it: somebody who cannot move money between cash and bank has
     * no reason to be handed the list of times it was moved.
     */
    public static function recent(): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'contra.create');

        $kind = (string) (Http::param('kind') ?? 'bank_withdrawal');
        if (!in_array($kind, BankCashHistory::KINDS, true)) {
            Http::validationFailed(
                'Ask for ' . implode(', ', BankCashHistory::KINDS) . '.',
                ['field' => 'kind'],
            );
        }

        Http::data((new BankCashHistory($ctx, $auth))->recent(
            $kind,
            Http::intParam('limit', 4) ?? 4,
            Http::intParam('from_account_id'),
        ));
    }
}
