<?php

declare(strict_types=1);

namespace Aicountly\Api\Controllers;

use Aicountly\Api\Clients\BooksClient;
use Aicountly\Api\Domain\DuesService;
use Aicountly\Api\Http;
use Aicountly\Api\Permissions;

final class DuesController extends Controller
{
    public static function receivables(): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new DuesService($ctx, $auth))->receivables([
            'as_on'      => Http::param('as_on'),
            'account_id' => Http::intParam('account_id'),
        ]));
    }

    public static function payables(): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new DuesService($ctx, $auth))->payables([
            'as_on'      => Http::param('as_on'),
            'account_id' => Http::intParam('account_id'),
        ]));
    }

    public static function statement(string $accountId): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new DuesService($ctx, $auth))->statement((int) $accountId, [
            'from' => Http::param('from'),
            'to'   => Http::param('to'),
        ]));
    }

    public static function cashAndBank(): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new DuesService($ctx, $auth))->cashAndBank());
    }

    /**
     * Bills a receipt or payment could be allocated against.
     *
     * Books decides what is still open. Showing the user a bill that has been
     * settled since they opened the screen is how a payment gets allocated twice.
     */
    public static function openBills(): void
    {
        [$auth, $ctx] = self::enter();

        $accountId = Http::intParam('account_id');
        if ($accountId === null) {
            Http::validationFailed('Choose the party first.', ['field' => 'account_id']);
        }

        $isReceivable = (Http::param('side') ?? 'receivable') === 'receivable';
        Permissions::assert($ctx, $auth, $isReceivable ? 'receipt.create' : 'payment.create');

        $response = (new BooksClient())->withSession($auth->sesKey())->billByBill($ctx, [
            'party_type' => $isReceivable ? 'debtor' : 'creditor',
            'account_id' => $accountId,
        ]);

        if (!$response['ok']) {
            Http::error(503, 'books_unavailable', 'Could not reach Smart Books for the open bills. Please retry.');
        }

        $bills = [];
        foreach ((array) ($response['body']['data'] ?? []) as $row) {
            $balance = (float) ($row['balance'] ?? $row['outstanding'] ?? 0);
            if ($balance <= 0) {
                continue;
            }
            $bills[] = [
                'bill_no'      => $row['bill_no'] ?? $row['reference_no'] ?? null,
                'bill_date'    => $row['bill_date'] ?? $row['voucher_date'] ?? null,
                'due_date'     => $row['due_date'] ?? null,
                'balance'      => round($balance, 2),
                'voucher_id'   => $row['voucher_id'] ?? $row['vch_txn_id'] ?? null,
                'voucher_uuid' => $row['voucher_uuid'] ?? $row['vch_uuid'] ?? null,
            ];
        }

        Http::data(['account_id' => $accountId, 'bills' => $bills, 'source' => 'books']);
    }
}
