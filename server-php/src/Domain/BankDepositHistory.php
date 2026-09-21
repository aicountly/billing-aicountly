<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

use Aicountly\Api\Auth;
use Aicountly\Api\Clients\BooksClient;
use Aicountly\Api\Context;
use Aicountly\Api\Db;

/**
 * The bank deposits this product recorded, most recent first.
 *
 * The mirror image of BankWithdrawalHistory, and allowed to exist on exactly
 * the same terms: it is the deposit REQUESTS Billing made and Books accepted,
 * each carrying the voucher reference Books gave back. It is not a second cash
 * book and does not claim to be every deposit in the accounts — a contra
 * entered directly in Smart Books is not here, and the screen says so rather
 * than quietly showing a short list.
 *
 * The request row already exists, because it is what makes a retry safe; the
 * only thing this adds is reading the last few of them back. Every NAME on the
 * screen — the cash account, the bank — is read live from Books on this
 * request, because those belong to Books and a copy of them here would be the
 * thing this architecture forbids.
 *
 * Books being slow costs the names, not the list: the amounts and dates still
 * render, with `names_available` false, so one unreachable lookup never blanks
 * a card on a screen somebody is using to type.
 *
 * WHY THIS IS NOT ONE CLASS WITH A `kind` PARAMETER. The two differ in what
 * each side of the contra MEANS — a withdrawal summarises what left a bank, a
 * deposit what went into one — and in what the payload carries: only a deposit
 * records whether cash or a cheque crossed the counter. Merging them would put
 * a direction flag through every method to save a dozen lines.
 */
final class BankDepositHistory
{
    /** The window the deposit screen summarises beside the balance. */
    public const SUMMARY_DAYS = 30;

    private const BASIS = 'Deposits recorded from Billing in this company and year. '
        . 'Deposits entered directly in Smart Books are in Books\' own contra register.';

    /** The same caveat, said shorter, because it sits under one figure rather than a list. */
    private const SUMMARY_BASIS = 'Counted from the deposits recorded in Billing. '
        . 'The balance above is Smart Books\' own.';

    public function __construct(
        private readonly Context $ctx,
        private readonly Auth $auth,
    ) {
    }

    /**
     * @return array{rows:list<array<string,mixed>>, names_available:bool, basis:string}
     */
    public function recent(int $limit = 4): array
    {
        $limit = max(1, min($limit, 25));
        [$scope, $params] = $this->ctx->scopeClause();

        $requests = Db::all(
            "SELECT request_id, transaction_date, payload, books_voucher_id, books_voucher_no, created_at
             FROM billing_transaction_requests
             WHERE {$scope} AND kind = 'bank_deposit' AND status = 'POSTED'
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
            // A deposit runs the other way from a withdrawal: the money leaves
            // the till and lands in the bank.
            $cashId = self::id($payload['from_account_id'] ?? null);
            $bankId = self::id($payload['to_account_id'] ?? null);

            $rows[] = [
                'request_id'        => (int) $request['request_id'],
                'date'              => (string) $request['transaction_date'],
                'amount'            => isset($payload['amount']) ? round((float) $payload['amount'], 2) : null,
                'cash_account_id'   => $cashId,
                'cash_account_name' => $cashId === null ? null : ($lookup[$cashId] ?? null),
                'bank_account_id'   => $bankId,
                'bank_account_name' => $bankId === null ? null : ($lookup[$bankId] ?? null),
                'payment_mode'      => self::text($payload['payment_mode'] ?? null) ?? 'cash',
                'reference_no'      => self::text($payload['reference_no'] ?? $payload['instrument_no'] ?? null),
                'note'              => self::text($payload['narration'] ?? null),
                'voucher_id'        => self::id($request['books_voucher_id'] ?? null),
                'voucher_no'        => self::text($request['books_voucher_no'] ?? null),
            ];
        }

        return [
            'rows'            => $rows,
            'names_available' => $names !== null,
            'basis'           => self::BASIS,
        ];
    }

    /**
     * What has gone into one bank account lately, and how often.
     *
     * Context beside the balance, not a ledger figure: it counts the deposits
     * THIS product recorded, which is why `basis` travels with it and the card
     * prints that line. The balance itself is Books' and is read from Books.
     *
     * @return array{bank_account_id:int, days:int, from:string, to:string, total:float, count:int, basis:string}
     */
    public function summary(int $bankAccountId, int $days = self::SUMMARY_DAYS): array
    {
        $days = max(1, min($days, 366));
        $today = new \DateTimeImmutable('now', $this->timezone());
        $from = $today->modify('-' . ($days - 1) . ' days')->format('Y-m-d');
        $to = $today->format('Y-m-d');

        [$scope, $params] = $this->ctx->scopeClause();
        $params['bank'] = (string) $bankAccountId;
        $params['from'] = $from;
        $params['to'] = $to;

        // The amount is cast only where it looks like a number. A payload that
        // never got one would otherwise take the whole card down with a cast
        // error, and a missing amount is a row to skip, not an outage.
        $row = Db::first(
            "SELECT COUNT(*) AS txn_count,
                    COALESCE(SUM(CASE WHEN payload->>'amount' ~ '^[0-9]+(\\.[0-9]+)?$'
                                      THEN (payload->>'amount')::numeric ELSE 0 END), 0) AS total
             FROM billing_transaction_requests
             WHERE {$scope} AND kind = 'bank_deposit' AND status = 'POSTED'
               AND payload->>'to_account_id' = :bank
               AND transaction_date BETWEEN :from AND :to",
            $params,
        );

        return [
            'bank_account_id' => $bankAccountId,
            'days'            => $days,
            'from'            => $from,
            'to'              => $to,
            'total'           => round((float) ($row['total'] ?? 0), 2),
            'count'           => (int) ($row['txn_count'] ?? 0),
            'basis'           => self::SUMMARY_BASIS,
        ];
    }

    /**
     * Account id => name for the cash and bank ledgers, read live.
     *
     * One read of the list the screen is already showing. Null when Books did
     * not answer, which the caller turns into "no names" rather than "no list".
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

    /** The company's day, not the server's — the same rule Period keeps. */
    private function timezone(): \DateTimeZone
    {
        try {
            $row = Db::first('SELECT timezone FROM billing_settings WHERE cmp_id = :cmp', ['cmp' => $this->ctx->cmpId]);
            $configured = $row['timezone'] ?? null;

            return new \DateTimeZone(is_string($configured) && $configured !== '' ? $configured : 'Asia/Kolkata');
        } catch (\Throwable) {
            return new \DateTimeZone('Asia/Kolkata');
        }
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
