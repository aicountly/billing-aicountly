<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

use Aicountly\Api\Auth;
use Aicountly\Api\Clients\BooksClient;
use Aicountly\Api\Context;
use Aicountly\Api\Db;

/**
 * The expenses this product recorded, most recent first.
 *
 * WHAT THIS IS, PRECISELY, because the distinction matters: it is the expense
 * REQUESTS Billing made and Books accepted, each carrying the voucher reference
 * Books gave back. It is not a second expense ledger and does not claim to be
 * every expense in the accounts — an expense entered directly in Smart Books is
 * not here, and the screen says so rather than quietly showing a short list.
 *
 * That is why it is allowed to exist at all: the request row already exists (it
 * is what makes a retry safe), and the only thing this adds is reading the last
 * few of them back. Every NAME on the screen — the expense head, the account it
 * was paid from — is read live from Books on this request, because those belong
 * to Books and a copy of them here would be the thing this architecture forbids.
 *
 * Books being slow costs the chips, not the list: the amounts and dates still
 * render, with `names_available` false, so one unreachable lookup never blanks
 * a card on a screen somebody is using to type.
 */
final class ExpenseHistory
{
    public function __construct(
        private readonly Context $ctx,
        private readonly Auth $auth,
    ) {
    }

    /**
     * @return array{rows:list<array<string,mixed>>, names_available:bool, basis:string}
     */
    public function recent(int $limit = 5): array
    {
        $limit = max(1, min($limit, 25));
        [$scope, $params] = $this->ctx->scopeClause();

        $requests = Db::all(
            "SELECT request_id, transaction_date, payload, party_account_id,
                    books_voucher_id, books_voucher_no, created_at
             FROM billing_transaction_requests
             WHERE {$scope} AND kind = 'expense' AND status = 'POSTED'
             ORDER BY transaction_date DESC, request_id DESC
             LIMIT " . $limit,
            $params,
        );

        if ($requests === []) {
            return ['rows' => [], 'names_available' => true, 'basis' => self::BASIS];
        }

        $names = $this->accountNames();
        $lookup = $names ?? [];

        $rows = [];
        foreach ($requests as $request) {
            $payload = Db::jsonColumn($request['payload'] ?? null);
            $categoryId = self::id($payload['expense_account_id'] ?? null);
            $paidFromId = self::id($payload['cash_bank_account_id'] ?? null);

            $rows[] = [
                'request_id'    => (int) $request['request_id'],
                'date'          => (string) $request['transaction_date'],
                'amount'        => isset($payload['amount']) ? round((float) $payload['amount'], 2) : null,
                'note'          => self::text($payload['narration'] ?? null),
                'reference_no'  => self::text($payload['reference_no'] ?? null),
                'category_id'   => $categoryId,
                'category_name' => $categoryId === null ? null : ($lookup[$categoryId] ?? null),
                'paid_from_id'  => $paidFromId,
                'paid_from_name' => $paidFromId === null ? null : ($lookup[$paidFromId] ?? null),
                'party_account_id' => self::id($request['party_account_id'] ?? null),
                'voucher_id'    => self::id($request['books_voucher_id'] ?? null),
                'voucher_no'    => self::text($request['books_voucher_no'] ?? null),
            ];
        }

        return [
            'rows'            => $rows,
            'names_available' => $names !== null,
            'basis'           => self::BASIS,
        ];
    }

    private const BASIS = 'Expenses recorded from Billing in this company and year. '
        . 'Expenses entered directly in Smart Books are in Books\' own register.';

    /**
     * Account id => name, for the heads and the cash/bank accounts, read live.
     *
     * Two reads of a list the expense screen is already showing. Null when Books
     * did not answer, which the caller turns into "no chips" rather than "no
     * list".
     *
     * @return array<int, string>|null
     */
    private function accountNames(): ?array
    {
        $books = (new BooksClient())->withSession($this->auth->sesKey());

        $names = [];
        $reached = false;

        foreach (['indirect_expenses', 'cash_bank'] as $nature) {
            $response = $books->accounts($this->ctx, ['nature' => $nature, 'limit' => 200]);
            if (!$response['ok']) {
                continue;
            }
            $reached = true;
            foreach (BooksReadings::rows($response['body']) as $row) {
                $accId = BooksReadings::id($row, ['acc_id', 'account_id', 'id']);
                $name = BooksReadings::text($row, ['acc_name', 'account_name', 'name', 'ledger_name']);
                if ($accId !== null && $name !== null) {
                    $names[$accId] = $name;
                }
            }
        }

        return $reached ? $names : null;
    }

    private static function id(mixed $value): ?int
    {
        return ($value === null || $value === '' || (int) $value === 0) ? null : (int) $value;
    }

    private static function text(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }
}
