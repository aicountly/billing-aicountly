<?php

declare(strict_types=1);

namespace Aicountly\Api\Controllers;

use Aicountly\Api\Domain\BankCashService;
use Aicountly\Api\Http;

/**
 * The context the bank-and-cash screens are drawn from.
 *
 * Both handlers are reads, both are answered from Smart Books on the request
 * that makes them, and neither writes anything. The withdrawal ITSELF is not
 * here — it is a contra voucher and goes through `POST v1/transactions/
 * bank_withdrawal` like every other transaction, so there is exactly one path
 * from this product into Books' ledger.
 */
final class BankCashController extends Controller
{
    /** Cash and bank ledgers, for the pickers, with balances where allowed. */
    public static function accounts(): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new BankCashService($ctx, $auth))->accounts());
    }

    /**
     * Recent bank withdrawals and what they come to.
     *
     * `account_id` narrows it to one bank; without it the first few bank
     * ledgers are read, and the response says which. Never a 403: a profile
     * that may not see bank activity gets `available: false` with the reason,
     * so the withdrawal form beside it stays usable.
     */
    public static function withdrawals(): void
    {
        [$auth, $ctx] = self::enter();

        Http::data((new BankCashService($ctx, $auth))->withdrawals(
            Http::intParam('account_id'),
            Http::intParam('days', 30) ?? 30,
            Http::intParam('limit', 5) ?? 5,
        ));
    }
}
