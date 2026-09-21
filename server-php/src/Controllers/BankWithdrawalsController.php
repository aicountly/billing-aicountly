<?php

declare(strict_types=1);

namespace Aicountly\Api\Controllers;

use Aicountly\Api\Domain\BankWithdrawalHistory;
use Aicountly\Api\Http;
use Aicountly\Api\Permissions;

/**
 * What the bank-withdrawal screen needs beyond recording one.
 *
 * Recording a withdrawal is still `POST v1/transactions/bank_withdrawal` — one
 * service makes every transaction in this product and that has not changed.
 * These two endpoints are the things AROUND the form: what was withdrawn
 * lately, and how much has come out of the chosen bank in the last month.
 *
 * Both are gated on `contra.create`, the same permission the screen and the
 * save are gated on: somebody who cannot move money between cash and bank has
 * no reason to be handed the list of times it was moved. The BALANCE beside
 * them is not here — that is Books', read through `v1/cash-bank`, where
 * `cash.view` and `bank.view` decide what may be seen.
 */
final class BankWithdrawalsController extends Controller
{
    public static function recent(): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'contra.create');

        Http::data((new BankWithdrawalHistory($ctx, $auth))->recent(Http::intParam('limit', 4) ?? 4));
    }

    /** What has come out of one bank account lately. Context, not a balance. */
    public static function summary(): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'contra.create');

        $bankAccountId = Http::intParam('bank_account_id');
        if ($bankAccountId === null) {
            Http::validationFailed('Choose the bank account first.', ['field' => 'bank_account_id']);
        }

        Http::data((new BankWithdrawalHistory($ctx, $auth))->summary(
            $bankAccountId,
            Http::intParam('days', BankWithdrawalHistory::SUMMARY_DAYS) ?? BankWithdrawalHistory::SUMMARY_DAYS,
        ));
    }
}
