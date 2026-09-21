<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

use Aicountly\Api\Auth;
use Aicountly\Api\Clients\BooksClient;
use Aicountly\Api\Context;
use Aicountly\Api\Db;

/**
 * The cash/bank movements this product recorded, most recent first.
 *
 * The same thing ExpenseHistory is, for the other half of the money screens,
 * and it exists for the same reason: the request row already exists — it is
 * what makes a retry safe — and all this adds is reading the last few back.
 *
 * WHAT IT IS, PRECISELY. It is the withdrawal (or deposit, or transfer)
 * REQUESTS Billing made and Books accepted, each carrying the voucher reference
 * Books gave back. It is NOT a second contra register and does not claim to be
 * every withdrawal in the accounts — a contra entered directly in Smart Books
 * is not here, and `basis` says so on screen rather than quietly showing a
 * short list as though it were the whole one.
 *
 * Every NAME is read live from Books on this request, because the ledgers
 * belong to Books and a copy of them here would be the thing this architecture
 * forbids. Books being slow costs the names, not the list: the amounts and
 * dates still render with `names_available` false, so one unreachable lookup
 * never blanks a card on a screen somebody is using to type.
 */
final class BankCashHistory
{
    /** The kinds that move money between this company's own cash and bank ledgers. */
    public const KINDS = ['bank_withdrawal', 'bank_deposit', 'bank_transfer'];

    /** The window the "recently" figures on the screen are counted over. */
    private const SUMMARY_DAYS = 30;

    public function __construct(
        private readonly Context $ctx,
        private readonly Auth $auth,
    ) {
    }

    /**
     * The last few of one kind, and what has been moved lately.
     *
     * `$fromAccountId` narrows the summary to the account the user has picked,
     * which is the figure the screen shows beside its balance. It deliberately
     * does NOT narrow the rows: "what did I record lately" is a more useful
     * list than "what did I record lately out of this one account", and the
     * rows name their own account anyway.
     *
     * @return array{rows:list<array<string,mixed>>, summary:array<string,mixed>,
     *               names_available:bool, basis:string}
     */
    public function recent(string $kind, int $limit = 4, ?int $fromAccountId = null): array
    {
        $limit = max(1, min($limit, 25));
        [$scope, $params] = $this->ctx->scopeClause();

        $requests = Db::all(
            "SELECT request_id, transaction_date, payload, books_voucher_id, books_voucher_no
             FROM billing_transaction_requests
             WHERE {$scope} AND kind = :kind AND status = 'POSTED'
             ORDER BY transaction_date DESC, request_id DESC
             LIMIT " . $limit,
            $params + ['kind' => $kind],
        );

        $summary = $this->summary($kind, $fromAccountId);

        if ($requests === []) {
            return [
                'rows'            => [],
                'summary'         => $summary,
                'names_available' => true,
                'basis'           => self::basis($kind),
            ];
        }

        $names = $this->accountNames();
        $lookup = $names ?? [];

        $rows = [];
        foreach ($requests as $request) {
            $payload = Db::jsonColumn($request['payload'] ?? null);
            $fromId = self::id($payload['from_account_id'] ?? null);
            $toId = self::id($payload['to_account_id'] ?? null);

            $rows[] = [
                'request_id'    => (int) $request['request_id'],
                'date'          => (string) $request['transaction_date'],
                'amount'        => isset($payload['amount']) ? round((float) $payload['amount'], 2) : null,
                'from_id'       => $fromId,
                'from_name'     => $fromId === null ? null : ($lookup[$fromId] ?? null),
                'to_id'         => $toId,
                'to_name'       => $toId === null ? null : ($lookup[$toId] ?? null),
                'reference'     => self::text($payload['instrument_no'] ?? null),
                'note'          => self::text($payload['narration'] ?? null),
                'voucher_id'    => self::id($request['books_voucher_id'] ?? null),
                'voucher_no'    => self::text($request['books_voucher_no'] ?? null),
            ];
        }

        return [
            'rows'            => $rows,
            'summary'         => $summary,
            'names_available' => $names !== null,
            'basis'           => self::basis($kind),
        ];
    }

    /**
     * How much has moved in the last thirty days, and how many times.
     *
     * Counted from the requests this product recorded — the same basis as the
     * rows — over transaction dates rather than when the row was written, so a
     * back-dated entry lands in the period it belongs to. A window that falls
     * outside the open financial year simply counts nothing, because the scope
     * clause holds: this is the figure for the year on screen.
     *
     * @return array{account_id:?int, days:int, total:float, count:int}
     */
    private function summary(string $kind, ?int $fromAccountId): array
    {
        [$scope, $params] = $this->ctx->scopeClause();

        $sql = "SELECT COALESCE(SUM((payload->>'amount')::numeric), 0) AS total, COUNT(*) AS entries
                FROM billing_transaction_requests
                WHERE {$scope} AND kind = :kind AND status = 'POSTED'
                  AND transaction_date BETWEEN :since AND :until";

        $params += [
            'kind'  => $kind,
            'since' => gmdate('Y-m-d', strtotime('-' . (self::SUMMARY_DAYS - 1) . ' days')),
            'until' => gmdate('Y-m-d'),
        ];

        if ($fromAccountId !== null) {
            $sql .= " AND (payload->>'from_account_id')::bigint = :acc";
            $params['acc'] = $fromAccountId;
        }

        $row = Db::first($sql, $params);

        return [
            'account_id' => $fromAccountId,
            'days'       => self::SUMMARY_DAYS,
            'total'      => round((float) ($row['total'] ?? 0), 2),
            'count'      => (int) ($row['entries'] ?? 0),
        ];
    }

    /**
     * Account id => name for the cash and bank ledgers, read live.
     *
     * One read of a list the screen is already showing. Null when Books did not
     * answer, which the caller turns into "no names" rather than "no list".
     *
     * @return array<int, string>|null
     */
    private function accountNames(): ?array
    {
        $response = (new BooksClient())
            ->withSession($this->auth->sesKey())
            ->accounts($this->ctx, ['nature' => 'cash_bank', 'limit' => 200]);

        if (!$response['ok']) {
            return null;
        }

        $names = [];
        foreach (BooksReadings::rows($response['body']) as $row) {
            $accId = BooksReadings::id($row, ['acc_id', 'account_id', 'id']);
            $name = BooksReadings::text($row, ['acc_name', 'account_name', 'name', 'ledger_name']);
            if ($accId !== null && $name !== null) {
                $names[$accId] = $name;
            }
        }

        return $names;
    }

    private static function basis(string $kind): string
    {
        $what = match ($kind) {
            'bank_deposit'  => 'Deposits',
            'bank_transfer' => 'Transfers',
            default         => 'Withdrawals',
        };

        return $what . ' recorded from Billing in this company and year. '
            . 'Entries made directly in Smart Books are in Books\' own register.';
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
