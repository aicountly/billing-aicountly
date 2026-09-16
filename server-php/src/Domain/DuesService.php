<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

use Aicountly\Api\Auth;
use Aicountly\Api\Clients\BooksClient;
use Aicountly\Api\Context;
use Aicountly\Api\Http;
use Aicountly\Api\Permissions;

/**
 * Money to collect and money to pay.
 *
 * EVERY FIGURE ON THESE SCREENS IS READ FROM BOOKS ON THE REQUEST THAT DRAWS
 * THEM. There is no billing_receivables table, no billing_customer_balance and
 * no billing_outstanding, and there never will be.
 *
 * That is not architectural fussiness. A copied receivable is wrong the moment a
 * receipt is entered anywhere else — in Books, in POS, by the accountant on a
 * Sunday — and the person acting on it is the one ringing a customer who paid
 * last week. The ageing below is arithmetic on live rows, not a stored figure.
 */
final class DuesService
{
    public function __construct(
        private readonly Context $ctx,
        private readonly Auth $auth,
    ) {
    }

    /**
     * Receivables, aged, with the totals a small business actually asks for.
     *
     * @param array<string, mixed> $filters
     * @return array<string, mixed>
     */
    public function receivables(array $filters = []): array
    {
        Permissions::assert($this->ctx, $this->auth, 'receivable.view');

        return $this->orFail($this->dues('debtor', $filters, 'Money to collect'), 'money to collect');
    }

    /** @param array<string, mixed> $filters */
    public function payables(array $filters = []): array
    {
        Permissions::assert($this->ctx, $this->auth, 'payable.view');

        return $this->orFail($this->dues('creditor', $filters, 'Money to pay'), 'money to pay');
    }

    /**
     * The same reading, for a screen that must survive it being unavailable.
     *
     * A dashboard draws four cards from four sources. If one of them halts the
     * request the user gets an error page instead of the three figures that were
     * perfectly readable, so the dashboards call these and render an unavailable
     * card for a null. The endpoints above keep halting, because a request that
     * asked only for receivables and cannot have them is a failed request.
     *
     * Not a softer permission check: an unauthorised caller still gets nothing.
     *
     * @param array<string, mixed> $filters
     * @return array<string, mixed>|null
     */
    public function tryReceivables(array $filters = []): ?array
    {
        if (!Permissions::allows($this->ctx, $this->auth, 'receivable.view')) {
            return null;
        }

        return $this->dues('debtor', $filters, 'Money to collect')['data'];
    }

    /**
     * @param array<string, mixed> $filters
     * @return array<string, mixed>|null
     */
    public function tryPayables(array $filters = []): ?array
    {
        if (!Permissions::allows($this->ctx, $this->auth, 'payable.view')) {
            return null;
        }

        return $this->dues('creditor', $filters, 'Money to pay')['data'];
    }

    /**
     * @param array{ok:bool, reason:?string, data:?array<string,mixed>} $reading
     * @return array<string, mixed>
     */
    private function orFail(array $reading, string $what): array
    {
        if (!$reading['ok'] || $reading['data'] === null) {
            Http::error(503, 'books_unavailable', 'Could not reach Smart Books to work out ' . $what . '. Please retry.');
        }

        return $reading['data'];
    }

    /**
     * @param array<string, mixed> $filters
     * @return array{ok:bool, reason:?string, data:?array<string,mixed>}
     */
    private function dues(string $partyType, array $filters, string $title): array
    {
        $asOn = (string) ($filters['as_on'] ?? gmdate('Y-m-d'));

        $response = (new BooksClient())
            ->withSession($this->auth->sesKey())
            ->billByBill($this->ctx, [
                'party_type' => $partyType,
                'as_on'      => $asOn,
                'account_id' => $filters['account_id'] ?? null,
            ]);

        if (!$response['ok']) {
            return ['ok' => false, 'reason' => 'Smart Books did not answer.', 'data' => null];
        }

        $rows = (array) ($response['body']['data'] ?? []);
        $today = new \DateTimeImmutable($asOn);

        // Mutually exclusive and exhaustive: every bill lands in exactly one,
        // so the buckets add up to the total shown above them. A bill Books gave
        // no due date gets its own bucket rather than being quietly filed under
        // "not yet due" — an undated bill might be months late, and hiding it in
        // the green bar is how it stays unchased.
        $buckets = ['current' => 0.0, '1_30' => 0.0, '31_60' => 0.0, '61_90' => 0.0, '90_plus' => 0.0, 'no_due_date' => 0.0];
        $byParty = [];
        $total = 0.0;
        $overdue = 0.0;
        $dueToday = 0.0;
        $dueThisWeek = 0.0;
        $bills = [];

        foreach ($rows as $row) {
            $balance = (float) ($row['balance'] ?? $row['outstanding'] ?? $row['pending_amount'] ?? 0);
            if ($balance <= 0) {
                continue;
            }

            $accountId = (int) ($row['account_id'] ?? $row['acc_id'] ?? 0);
            $accountName = (string) ($row['account_name'] ?? $row['acc_name'] ?? ('Account ' . $accountId));
            $dueRaw = $row['due_date'] ?? $row['bill_due_date'] ?? null;

            $days = null;
            $due = null;
            if (is_string($dueRaw) && $dueRaw !== '') {
                try {
                    $due = new \DateTimeImmutable($dueRaw);
                    $days = (int) $today->diff($due)->format('%r%a');
                } catch (\Throwable) {
                    $due = null;
                }
            }

            $total += $balance;

            // Ageing is measured from the DUE date, not the bill date: a bill on
            // 60-day terms raised 45 days ago is not overdue, and putting it in
            // the 31–60 bucket would have somebody chasing it.
            if ($days === null) {
                $buckets['no_due_date'] += $balance;
            } elseif ($days >= 0) {
                $buckets['current'] += $balance;
                if ($days === 0) {
                    $dueToday += $balance;
                }
                if ($days <= 7) {
                    $dueThisWeek += $balance;
                }
            } else {
                $overdueDays = abs($days);
                $overdue += $balance;
                if ($overdueDays <= 30) {
                    $buckets['1_30'] += $balance;
                } elseif ($overdueDays <= 60) {
                    $buckets['31_60'] += $balance;
                } elseif ($overdueDays <= 90) {
                    $buckets['61_90'] += $balance;
                } else {
                    $buckets['90_plus'] += $balance;
                }
            }

            if (!isset($byParty[$accountId])) {
                $byParty[$accountId] = [
                    'account_id'   => $accountId,
                    'account_name' => $accountName,
                    'total'        => 0.0,
                    'overdue'      => 0.0,
                    'bill_count'   => 0,
                    'oldest_overdue_days' => 0,
                ];
            }
            $byParty[$accountId]['total'] += $balance;
            $byParty[$accountId]['bill_count']++;
            if ($days !== null && $days < 0) {
                $byParty[$accountId]['overdue'] += $balance;
                $byParty[$accountId]['oldest_overdue_days'] = max($byParty[$accountId]['oldest_overdue_days'], abs($days));
            }

            $bills[] = [
                'account_id'   => $accountId,
                'account_name' => $accountName,
                'bill_no'      => $row['bill_no'] ?? $row['reference_no'] ?? $row['voucher_no'] ?? null,
                'bill_date'    => $row['bill_date'] ?? $row['voucher_date'] ?? null,
                'due_date'     => $due?->format('Y-m-d'),
                'balance'      => round($balance, 2),
                'days_overdue' => $days !== null && $days < 0 ? abs($days) : 0,
                'voucher_id'   => $row['voucher_id'] ?? $row['vch_txn_id'] ?? null,
                'voucher_uuid' => $row['voucher_uuid'] ?? $row['vch_uuid'] ?? null,
            ];
        }

        usort($bills, static fn (array $a, array $b) => $b['days_overdue'] <=> $a['days_overdue']);
        $parties = array_values($byParty);
        usort($parties, static fn (array $a, array $b) => $b['total'] <=> $a['total']);

        return ['ok' => true, 'reason' => null, 'data' => [
            'title'    => $title,
            'as_on'    => $asOn,
            'source'   => 'books',
            'total'    => round($total, 2),
            'overdue'  => round($overdue, 2),
            'due_today' => round($dueToday, 2),
            'due_this_week' => round($dueThisWeek, 2),
            'ageing'   => array_map(static fn (float $value) => round($value, 2), $buckets),
            // Asserted here as well as in the tests, because a bucket total that
            // does not add up to the headline is the one error on this screen a
            // user cannot spot and cannot act on.
            'ageing_reconciles' => abs(array_sum($buckets) - $total) < 0.01,
            'parties'  => array_map(static function (array $party) {
                $party['total'] = round($party['total'], 2);
                $party['overdue'] = round($party['overdue'], 2);

                return $party;
            }, $parties),
            'bills'    => $bills,
            'note'     => 'Read from Smart Books just now. Billing keeps no balance of its own, so this never disagrees with the accounts.',
        ]];
    }

    /**
     * A party statement, straight from Books' account ledger.
     *
     * @param array<string, mixed> $filters
     * @return array<string, mixed>
     */
    public function statement(int $accountId, array $filters = []): array
    {
        Permissions::assert($this->ctx, $this->auth, 'statement.view');

        $books = (new BooksClient())->withSession($this->auth->sesKey());
        $response = $books->accountLedger($this->ctx, $accountId, [
            'from' => $filters['from'] ?? null,
            'to'   => $filters['to'] ?? null,
        ]);

        if (!$response['ok']) {
            Http::error(503, 'books_unavailable', 'Could not reach Smart Books for this statement. Please retry.');
        }

        $body = $response['body']['data'] ?? [];

        return [
            'account_id' => $accountId,
            'source'     => 'books',
            'statement'  => $body,
            'note'       => 'This is Smart Books\' own ledger for this party. Billing does not keep a second one.',
        ];
    }

    /**
     * Cash and bank balances, for the dashboard.
     *
     * Permission-gated separately from everything else, because "the staff can
     * bill but must not see the bank" is the single commonest thing a shop owner
     * asks this product for.
     *
     * @return array<string, mixed>
     */
    public function cashAndBank(): array
    {
        $mayCash = Permissions::allows($this->ctx, $this->auth, 'cash.view');
        $mayBank = Permissions::allows($this->ctx, $this->auth, 'bank.view');

        if (!$mayCash && !$mayBank) {
            return ['available' => false, 'reason' => 'Your Billing profile does not show balances.'];
        }

        $response = (new BooksClient())
            ->withSession($this->auth->sesKey())
            ->accountSummary($this->ctx, ['nature' => 'cash_bank']);

        if (!$response['ok']) {
            return ['available' => false, 'reason' => 'Smart Books did not answer.'];
        }

        $cash = 0.0;
        $bank = 0.0;
        $accounts = [];

        foreach ((array) ($response['body']['data'] ?? []) as $row) {
            $balance = (float) ($row['closing_balance'] ?? $row['balance'] ?? 0);
            $isCash = str_contains(strtolower((string) ($row['group_name'] ?? $row['nature'] ?? '')), 'cash');

            if ($isCash) {
                $cash += $balance;
                if (!$mayCash) {
                    continue;
                }
            } else {
                $bank += $balance;
                if (!$mayBank) {
                    continue;
                }
            }

            $accounts[] = [
                'account_id'   => (int) ($row['account_id'] ?? $row['acc_id'] ?? 0),
                'account_name' => (string) ($row['account_name'] ?? $row['acc_name'] ?? ''),
                'balance'      => round($balance, 2),
                'kind'         => $isCash ? 'cash' : 'bank',
            ];
        }

        return [
            'available' => true,
            'cash'      => $mayCash ? round($cash, 2) : null,
            'bank'      => $mayBank ? round($bank, 2) : null,
            'accounts'  => $accounts,
            'source'    => 'books',
        ];
    }
}
