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
 *
 * THE MONEY-TO-PAY WORKSPACE
 *
 * Books' bill-by-bill hands back every open bill in one answer, so the search,
 * the filters, the sort and the page are applied HERE, over that one reading,
 * rather than by asking Books once per view or by shipping the whole set to a
 * browser to slice. The headline figures, the ageing and the category split are
 * always computed over the WHOLE set — they describe the position, not the
 * page — and only the rows are filtered.
 */
final class DuesService
{
    /**
     * A bill falling due inside this many days is "due soon".
     *
     * The same seven days the dashboards call "this week", so the chip on the
     * table and the card above it cannot disagree.
     */
    public const DUE_SOON_DAYS = 7;

    /** How far ahead "Upcoming payments" looks. */
    public const UPCOMING_DAYS = 30;

    /** Rows per page, bounded: an unbounded page is a slow screen one URL long. */
    public const MAX_PAGE_SIZE = 200;

    /** How many named slices the category split draws before the rest become "Others". */
    private const CATEGORY_SLICES = 5;

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

    // -----------------------------------------------------------------------
    // Money to pay — the workspace behind /payables
    // -----------------------------------------------------------------------

    /**
     * Everything the Money to Pay screen draws, from one reading of Books.
     *
     * The analysis (headline figures, ageing, upcoming, categories, the due
     * calendar) is over every open bill. `bills` is the page the caller asked
     * for, after the search and filters; `pagination` and `filtered` describe
     * that page and the set it came from.
     *
     * @param array<string, mixed> $query
     * @return array<string, mixed>
     */
    public function payablesWorkspace(array $query = []): array
    {
        Permissions::assert($this->ctx, $this->auth, 'payable.view');

        $data = $this->orFail(
            $this->dues('creditor', ['as_on' => $query['as_on'] ?? null], 'Money to pay'),
            'money to pay',
        );

        return $this->workspace($data, $query);
    }

    /**
     * What was owed on the same day one period ago.
     *
     * A SECOND reading of Books, at a past `as_on`, and nothing else — so the
     * comparison on the headline card is two figures Books gave, not a trend
     * this product invented. It is its own endpoint so that typing in the search
     * box does not read a month of history again, and a failure here leaves the
     * card without a trend rather than without a total.
     *
     * @return array<string, mixed>
     */
    public function payablesComparison(string $previousAsOn, string $label): array
    {
        Permissions::assert($this->ctx, $this->auth, 'payable.view');

        $reading = $this->dues('creditor', ['as_on' => $previousAsOn], 'Money to pay');
        if (!$reading['ok'] || $reading['data'] === null) {
            return [
                'available' => false,
                'reason'    => 'Smart Books did not answer for ' . $previousAsOn . ', so there is nothing to compare with.',
                'as_on'     => $previousAsOn,
                'label'     => $label,
                'total'     => null,
            ];
        }

        return [
            'available' => true,
            'reason'    => null,
            'as_on'     => $previousAsOn,
            'label'     => $label,
            'total'     => $reading['data']['total'],
            'basis'     => 'What was still owed to suppliers as at ' . $previousAsOn . ', read from Smart Books just now.',
        ];
    }

    /**
     * The filtered set as a report, for CSV.
     *
     * The FULL filtered set, never the page on screen: somebody who filters to
     * one supplier, sees twenty rows and exports expects that supplier's bills,
     * and handing them page one silently is the kind of error only discovered
     * once the figures are in somebody's return.
     *
     * @param array<string, mixed> $query
     * @return array<string, mixed>
     */
    public function payablesExport(array $query = []): array
    {
        // Page size zero, always: the file is the whole filtered set, and a
        // page_size the caller happened to have in the URL must not decide how
        // much of their own data they are given.
        $query['page'] = 1;
        $query['page_size'] = 0;
        $workspace = $this->payablesWorkspace($query);

        $rows = [];
        foreach ($workspace['all_matching_bills'] as $bill) {
            $rows[] = [
                'account_name'  => $bill['account_name'],
                'bill_no'       => $bill['bill_no'],
                'reference'     => $bill['reference'],
                'bill_date'     => $bill['bill_date'],
                'due_date'      => $bill['due_date'],
                'days_overdue'  => $bill['days_overdue'],
                'status'        => self::STATUS_WORDS[$bill['status']] ?? $bill['status'],
                'balance'       => $bill['balance'],
            ];
        }

        return [
            'key'     => 'payables',
            'label'   => 'Money to pay',
            'columns' => [
                ['key' => 'account_name', 'label' => 'Supplier',    'numeric' => false],
                ['key' => 'bill_no',      'label' => 'Bill',        'numeric' => false],
                ['key' => 'reference',    'label' => 'Reference',   'numeric' => false],
                ['key' => 'bill_date',    'label' => 'Dated',       'numeric' => false],
                ['key' => 'due_date',     'label' => 'Due',         'numeric' => false],
                ['key' => 'days_overdue', 'label' => 'Days late',   'numeric' => true],
                ['key' => 'status',       'label' => 'Status',      'numeric' => false],
                ['key' => 'balance',      'label' => 'Outstanding', 'numeric' => true],
            ],
            'rows'     => $rows,
            'total'    => $workspace['filtered']['amount'],
            'complete' => true,
            'period'   => ['from' => $workspace['as_on'], 'to' => $workspace['as_on']],
            'note'     => 'Outstanding supplier bills as at ' . $workspace['as_on'] . ', aged from each bill\'s own due date.',
        ];
    }

    /** The word each status is shown and exported as. */
    private const STATUS_WORDS = [
        'overdue'     => 'Overdue',
        'due_today'   => 'Due today',
        'due_soon'    => 'Due soon',
        'upcoming'    => 'Upcoming',
        'no_due_date' => 'No due date',
    ];

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
        $asOn = (string) ($filters['as_on'] ?? '') !== '' ? (string) $filters['as_on'] : gmdate('Y-m-d');

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
        $bucketCounts = array_fill_keys(array_keys($buckets), 0);
        $byParty = [];
        $total = 0.0;
        $overdue = 0.0;
        $dueToday = 0.0;
        $dueThisWeek = 0.0;
        $overdueCount = 0;
        $dueTodayCount = 0;
        $dueThisWeekCount = 0;
        $bills = [];
        $index = 0;

        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }
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
                $bucket = 'no_due_date';
            } elseif ($days >= 0) {
                $bucket = 'current';
                if ($days === 0) {
                    $dueToday += $balance;
                    $dueTodayCount++;
                }
                if ($days <= self::DUE_SOON_DAYS) {
                    $dueThisWeek += $balance;
                    $dueThisWeekCount++;
                }
            } else {
                $overdueDays = abs($days);
                $overdue += $balance;
                $overdueCount++;
                $bucket = $overdueDays <= 30 ? '1_30' : ($overdueDays <= 60 ? '31_60' : ($overdueDays <= 90 ? '61_90' : '90_plus'));
            }
            $buckets[$bucket] += $balance;
            $bucketCounts[$bucket]++;

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

            // The supplier's own number, and — separately — whatever reference
            // the bill was raised against. Collapsing the two, as the list below
            // used to, means a purchase order number shows up in the column
            // headed "Bill" and nobody can find the bill by its number.
            $billNo = BooksReadings::text($row, ['bill_no', 'supplier_bill_no', 'supplier_invoice_no'])
                ?? BooksReadings::text($row, ['voucher_no', 'vch_no']);
            $reference = BooksReadings::text($row, ['reference_no', 'reference', 'ref_no', 'po_no', 'order_no', 'purchase_order_no', 'supplier_ref']);

            // A deployment that files the supplier's number under reference_no
            // and nothing else must still show a bill number. Better the same
            // string in both columns than a list of bills headed "not recorded".
            if ($billNo === null) {
                $billNo = $reference;
                $reference = null;
            }
            if ($reference !== null && $billNo !== null && self::sameText($reference, $billNo)) {
                $reference = null;
            }

            // The bill's full value, when Books states one. Only then can a part
            // payment be told from a bill nobody has paid anything against —
            // and a value BELOW the balance is not a bill value, it is some
            // other figure under a name this list guessed at, so it is dropped.
            $billAmount = BooksReadings::number($row, ['bill_amount', 'invoice_value', 'grand_total', 'total_amount', 'original_amount', 'voucher_amount']);
            if ($billAmount !== null && $billAmount + 0.005 < $balance) {
                $billAmount = null;
            }

            $bills[] = [
                'row_key'      => $accountId . ':' . ($billNo ?? 'no-bill') . ':' . $index,
                'account_id'   => $accountId,
                'account_name' => $accountName,
                'bill_no'      => $billNo,
                'reference'    => $reference,
                'document_no'  => BooksReadings::text($row, ['voucher_no', 'vch_no', 'document_no']),
                'bill_date'    => BooksReadings::date($row, ['bill_date', 'voucher_date', 'vch_date']),
                'due_date'     => $due?->format('Y-m-d'),
                'balance'      => round($balance, 2),
                'bill_amount'  => $billAmount === null ? null : round($billAmount, 2),
                'paid_amount'  => $billAmount === null ? null : round($billAmount - $balance, 2),
                'partially_paid' => $billAmount !== null && $billAmount - $balance > 0.005,
                'days_overdue' => $days !== null && $days < 0 ? abs($days) : 0,
                'days_to_due'  => $days !== null && $days >= 0 ? $days : null,
                'status'       => self::status($days),
                'age_bucket'   => $bucket,
                'category'     => self::category($row),
                'voucher_id'   => $row['voucher_id'] ?? $row['vch_txn_id'] ?? null,
                'voucher_uuid' => $row['voucher_uuid'] ?? $row['vch_uuid'] ?? null,
            ];
            $index++;
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
            'counts'   => [
                'bills'         => count($bills),
                'suppliers'     => count($parties),
                'overdue'       => $overdueCount,
                'due_today'     => $dueTodayCount,
                'due_this_week' => $dueThisWeekCount,
            ],
            'ageing'   => array_map(static fn (float $value) => round($value, 2), $buckets),
            'ageing_counts' => $bucketCounts,
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

    /** Where a bill sits against today, in one word. */
    private static function status(?int $daysToDue): string
    {
        if ($daysToDue === null) {
            return 'no_due_date';
        }
        if ($daysToDue < 0) {
            return 'overdue';
        }
        if ($daysToDue === 0) {
            return 'due_today';
        }

        return $daysToDue <= self::DUE_SOON_DAYS ? 'due_soon' : 'upcoming';
    }

    /**
     * How this bill is classified, IF Books classifies it.
     *
     * Deployments differ in what they put on a bill-by-bill row — a ledger
     * group here, a cost centre there, nothing at all somewhere else. Whatever
     * is found is passed through as Books worded it; nothing is invented and no
     * category is guessed from a supplier's name, because "Metro Stationery"
     * selling us a laptop would be filed under stationery for ever.
     *
     * @param array<string, mixed> $row
     */
    private static function category(array $row): ?string
    {
        return BooksReadings::text($row, [
            'category', 'category_name', 'bill_category', 'expense_category',
            'group_name', 'account_group', 'acc_group_name', 'ledger_group',
            'cost_centre', 'cost_center', 'voucher_type_name', 'vch_type_name',
        ]);
    }

    /** MD-7812, md 7812 and MD/7812 are the same reference written three ways. */
    private static function sameText(string $a, string $b): bool
    {
        $flatten = static fn (string $value) => preg_replace('/[^a-z0-9]/', '', strtolower($value));

        return $flatten($a) === $flatten($b);
    }

    // -----------------------------------------------------------------------
    // The workspace: analysis over everything, rows for the page asked for
    // -----------------------------------------------------------------------

    /**
     * @param array<string, mixed> $data
     * @param array<string, mixed> $query
     * @return array<string, mixed>
     */
    private function workspace(array $data, array $query): array
    {
        $asOn = (string) $data['as_on'];
        $all = $data['bills'];
        $total = (float) $data['total'];

        $matching = self::applyFilters($all, $query, $asOn);
        $sortBy = (string) ($query['sort_by'] ?? 'due_date');
        $sortDir = ($query['sort_dir'] ?? 'asc') === 'desc' ? 'desc' : 'asc';
        self::sort($matching, $sortBy, $sortDir);

        $pageSize = (int) ($query['page_size'] ?? 25);
        $pageSize = $pageSize <= 0 ? 0 : min($pageSize, self::MAX_PAGE_SIZE);
        $matchCount = count($matching);
        $pages = $pageSize === 0 ? 1 : max(1, (int) ceil($matchCount / $pageSize));
        $page = max(1, (int) ($query['page'] ?? 1));
        $page = min($page, $pages);

        $rows = $pageSize === 0 ? [] : array_slice($matching, ($page - 1) * $pageSize, $pageSize);

        $filteredAmount = 0.0;
        foreach ($matching as $bill) {
            $filteredAmount += (float) $bill['balance'];
        }

        return [
            'title'    => $data['title'],
            'as_on'    => $asOn,
            'source'   => $data['source'],

            // The position. Always the whole set — these cards describe what is
            // owed, not what the table is currently filtered to.
            'summary' => [
                'total'               => $data['total'],
                'bill_count'          => $data['counts']['bills'],
                'supplier_count'      => $data['counts']['suppliers'],
                'overdue'             => $data['overdue'],
                'overdue_count'       => $data['counts']['overdue'],
                'due_today'           => $data['due_today'],
                'due_today_count'     => $data['counts']['due_today'],
                'due_this_week'       => $data['due_this_week'],
                'due_this_week_count' => $data['counts']['due_this_week'],
                'due_soon_days'       => self::DUE_SOON_DAYS,
            ],

            // Kept as they were, so the ageing report and the dashboards that
            // already read this endpoint's answer go on working unchanged.
            'total'         => $data['total'],
            'overdue'       => $data['overdue'],
            'due_today'     => $data['due_today'],
            'due_this_week' => $data['due_this_week'],
            'ageing'        => $data['ageing'],
            'ageing_reconciles' => $data['ageing_reconciles'],
            'parties'       => $data['parties'],

            'ageing_buckets' => self::ageingBuckets($data, $total),
            'upcoming'       => self::upcoming($all, $asOn),
            'categories'     => self::categories($all, $total),
            'calendar'       => self::calendar($all),

            'bills'      => $rows,
            'pagination' => [
                'page'      => $page,
                'page_size' => $pageSize,
                'total'     => $matchCount,
                'pages'     => $pages,
                'from'      => $matchCount === 0 || $pageSize === 0 ? 0 : (($page - 1) * $pageSize) + 1,
                'to'        => $pageSize === 0 ? 0 : min($page * $pageSize, $matchCount),
            ],
            'filtered' => [
                'count'  => $matchCount,
                'amount' => round($filteredAmount, 2),
                'is_filtered' => $matchCount !== count($all),
            ],

            // What this DEPLOYMENT can do, which the browser cannot know. What
            // this USER may do is in the session it already holds, and is not
            // repeated here: two answers to one question is how they drift.
            'import' => self::importCapability(),

            'note' => $data['note'],

            // Not serialised to the caller — the export reads it so the file is
            // the whole filtered set rather than the page on screen.
            'all_matching_bills' => $matching,
        ];
    }

    /**
     * @param list<array<string, mixed>> $bills
     * @param array<string, mixed>       $query
     * @return list<array<string, mixed>>
     */
    private static function applyFilters(array $bills, array $query, string $asOn): array
    {
        $search = strtolower(trim((string) ($query['search'] ?? '')));
        $status = (string) ($query['status'] ?? 'all');
        $bucket = (string) ($query['age_bucket'] ?? '');
        $supplierId = isset($query['supplier_id']) && $query['supplier_id'] !== null ? (int) $query['supplier_id'] : null;
        $category = (string) ($query['category'] ?? '');
        $reference = strtolower(trim((string) ($query['reference'] ?? '')));
        $billFrom = (string) ($query['bill_date_from'] ?? '');
        $billTo = (string) ($query['bill_date_to'] ?? '');
        $dueFrom = (string) ($query['due_date_from'] ?? '');
        $dueTo = (string) ($query['due_date_to'] ?? '');
        $min = isset($query['amount_min']) && $query['amount_min'] !== null && $query['amount_min'] !== '' ? (float) $query['amount_min'] : null;
        $max = isset($query['amount_max']) && $query['amount_max'] !== null && $query['amount_max'] !== '' ? (float) $query['amount_max'] : null;

        $windowEnd = (new \DateTimeImmutable($asOn))->modify('+' . self::UPCOMING_DAYS . ' days')->format('Y-m-d');

        $out = [];
        foreach ($bills as $bill) {
            if (!self::matchesStatus($bill, $status, $asOn, $windowEnd)) {
                continue;
            }
            if ($bucket !== '' && $bill['age_bucket'] !== $bucket) {
                continue;
            }
            if ($supplierId !== null && (int) $bill['account_id'] !== $supplierId) {
                continue;
            }
            if ($category !== '' && (string) ($bill['category'] ?? '') !== $category) {
                continue;
            }
            if ($reference !== '' && !str_contains(strtolower((string) ($bill['reference'] ?? '')), $reference)) {
                continue;
            }
            if ($billFrom !== '' && ($bill['bill_date'] === null || $bill['bill_date'] < $billFrom)) {
                continue;
            }
            if ($billTo !== '' && ($bill['bill_date'] === null || $bill['bill_date'] > $billTo)) {
                continue;
            }
            if ($dueFrom !== '' && ($bill['due_date'] === null || $bill['due_date'] < $dueFrom)) {
                continue;
            }
            if ($dueTo !== '' && ($bill['due_date'] === null || $bill['due_date'] > $dueTo)) {
                continue;
            }
            if ($min !== null && (float) $bill['balance'] < $min) {
                continue;
            }
            if ($max !== null && (float) $bill['balance'] > $max) {
                continue;
            }
            if ($search !== '' && !self::matchesSearch($bill, $search)) {
                continue;
            }
            $out[] = $bill;
        }

        return $out;
    }

    /** @param array<string, mixed> $bill */
    private static function matchesSearch(array $bill, string $needle): bool
    {
        foreach (['account_name', 'bill_no', 'reference', 'document_no', 'category'] as $field) {
            $value = $bill[$field] ?? null;
            if (is_string($value) && str_contains(strtolower($value), $needle)) {
                return true;
            }
        }

        // A number typed into the search box is most often an amount.
        return is_numeric($needle) && str_contains((string) $bill['balance'], $needle);
    }

    /** @param array<string, mixed> $bill */
    private static function matchesStatus(array $bill, string $status, string $asOn, string $windowEnd): bool
    {
        return match ($status) {
            '', 'all'       => true,
            'overdue'       => $bill['status'] === 'overdue',
            'due_today'     => $bill['status'] === 'due_today',
            'due_this_week' => $bill['days_to_due'] !== null && $bill['days_to_due'] <= self::DUE_SOON_DAYS,
            'not_due'       => $bill['days_to_due'] !== null,
            'next_30_days'  => $bill['due_date'] !== null && $bill['due_date'] >= $asOn && $bill['due_date'] <= $windowEnd,
            'no_due_date'   => $bill['status'] === 'no_due_date',
            'partially_paid' => $bill['partially_paid'] === true,
            default         => true,
        };
    }

    /**
     * @param list<array<string, mixed>> $bills
     */
    private static function sort(array &$bills, string $by, string $direction): void
    {
        $sign = $direction === 'desc' ? -1 : 1;

        // Undated bills sort last whichever way the column is pointing: they are
        // the ones needing a decision, not the ones at the far end of a range.
        $dateKey = static fn (?string $value, string $fallback) => $value ?? $fallback;

        usort($bills, static function (array $a, array $b) use ($by, $sign, $dateKey): int {
            $result = match ($by) {
                'bill_no'   => strnatcasecmp((string) ($a['bill_no'] ?? ''), (string) ($b['bill_no'] ?? '')),
                'supplier'  => strnatcasecmp((string) $a['account_name'], (string) $b['account_name']),
                'bill_date' => strcmp($dateKey($a['bill_date'], '9999-12-31'), $dateKey($b['bill_date'], '9999-12-31')),
                'amount'    => $a['balance'] <=> $b['balance'],
                'reference' => strnatcasecmp((string) ($a['reference'] ?? ''), (string) ($b['reference'] ?? '')),
                'status'    => self::statusRank($a) <=> self::statusRank($b),
                // "Days" reads as one line from most overdue to furthest away,
                // which is the order somebody paying bills works in.
                'days'      => self::dayRank($b) <=> self::dayRank($a),
                default     => strcmp($dateKey($a['due_date'], '9999-12-31'), $dateKey($b['due_date'], '9999-12-31')),
            };

            // A stable second key, so two bills due the same day do not swap
            // places between one page and the next.
            return $result !== 0 ? $sign * $result : strcmp((string) $a['row_key'], (string) $b['row_key']);
        });
    }

    /** @param array<string, mixed> $bill */
    private static function statusRank(array $bill): int
    {
        return match ($bill['status']) {
            'overdue' => 0,
            'due_today' => 1,
            'due_soon' => 2,
            'upcoming' => 3,
            default => 4,
        };
    }

    /** Days overdue positive, days remaining negative, undated furthest away. */
    private static function dayRank(array $bill): int
    {
        if ($bill['status'] === 'no_due_date') {
            return PHP_INT_MIN;
        }

        return $bill['days_overdue'] > 0 ? $bill['days_overdue'] : -(int) ($bill['days_to_due'] ?? 0);
    }

    /**
     * @param array<string, mixed> $data
     * @return list<array<string, mixed>>
     */
    private static function ageingBuckets(array $data, float $total): array
    {
        $labels = [
            'current'     => ['Not yet due', 'ok'],
            '1_30'        => ['1–30 days', 'warning'],
            '31_60'       => ['31–60 days', 'warning'],
            '61_90'       => ['61–90 days', 'danger'],
            '90_plus'     => ['Over 90 days', 'danger'],
            'no_due_date' => ['No due date', 'neutral'],
        ];

        $out = [];
        foreach ($labels as $key => [$label, $tone]) {
            $amount = (float) ($data['ageing'][$key] ?? 0);
            $out[] = [
                'key'    => $key,
                'label'  => $label,
                'tone'   => $tone,
                'amount' => round($amount, 2),
                'count'  => (int) ($data['ageing_counts'][$key] ?? 0),
                'share'  => $total > 0 ? round(($amount / $total) * 100, 1) : 0.0,
            ];
        }

        return $out;
    }

    /**
     * What falls due next, soonest first.
     *
     * @param list<array<string, mixed>> $bills
     * @return array<string, mixed>
     */
    private static function upcoming(array $bills, string $asOn): array
    {
        $windowEnd = (new \DateTimeImmutable($asOn))->modify('+' . self::UPCOMING_DAYS . ' days')->format('Y-m-d');

        $window = [];
        $amount = 0.0;
        foreach ($bills as $bill) {
            if ($bill['due_date'] === null || $bill['due_date'] < $asOn || $bill['due_date'] > $windowEnd) {
                continue;
            }
            $window[] = $bill;
            $amount += (float) $bill['balance'];
        }

        usort($window, static function (array $a, array $b): int {
            $byDate = strcmp((string) $a['due_date'], (string) $b['due_date']);

            return $byDate !== 0 ? $byDate : ($b['balance'] <=> $a['balance']);
        });

        return [
            'days'   => self::UPCOMING_DAYS,
            'from'   => $asOn,
            'to'     => $windowEnd,
            'count'  => count($window),
            'amount' => round($amount, 2),
            'rows'   => array_slice($window, 0, 6),
        ];
    }

    /**
     * What the money is owed for, IF Books says.
     *
     * When no row carries a classification this returns unavailable with the
     * reason, and the screen says so. It does not split by supplier and call
     * that a category, and it does not guess from a name.
     *
     * @param list<array<string, mixed>> $bills
     * @return array<string, mixed>
     */
    private static function categories(array $bills, float $total): array
    {
        $byName = [];
        $unclassified = 0.0;
        $unclassifiedCount = 0;

        foreach ($bills as $bill) {
            $name = $bill['category'];
            if (!is_string($name) || $name === '') {
                $unclassified += (float) $bill['balance'];
                $unclassifiedCount++;
                continue;
            }
            $byName[$name] ??= ['key' => $name, 'label' => $name, 'amount' => 0.0, 'count' => 0];
            $byName[$name]['amount'] += (float) $bill['balance'];
            $byName[$name]['count']++;
        }

        if ($byName === []) {
            return [
                'available' => false,
                'reason'    => 'Smart Books does not classify these bills in this deployment, so there is no breakdown to draw.',
                'total'     => round($total, 2),
                'rows'      => [],
            ];
        }

        $rows = array_values($byName);
        usort($rows, static fn (array $a, array $b) => $b['amount'] <=> $a['amount']);

        // Beyond a handful of slices a donut stops being readable, so the tail
        // is summed rather than drawn — and it is still the real tail, not a
        // rounding fudge to make the shares reach 100.
        if (count($rows) > self::CATEGORY_SLICES) {
            $tail = array_splice($rows, self::CATEGORY_SLICES);
            $rows[] = [
                'key'    => '__others',
                'label'  => 'Others',
                'amount' => array_sum(array_column($tail, 'amount')),
                'count'  => array_sum(array_column($tail, 'count')),
            ];
        }

        if ($unclassified > 0) {
            $rows[] = ['key' => '__unclassified', 'label' => 'Unclassified', 'amount' => $unclassified, 'count' => $unclassifiedCount];
        }

        return [
            'available' => true,
            'reason'    => null,
            'total'     => round($total, 2),
            'rows'      => array_map(static function (array $row) use ($total) {
                $row['amount'] = round($row['amount'], 2);
                $row['share'] = $total > 0 ? round(($row['amount'] / $total) * 100, 1) : 0.0;

                return $row;
            }, $rows),
        ];
    }

    /**
     * Due dates and what falls on them, for the calendar.
     *
     * @param list<array<string, mixed>> $bills
     * @return list<array{date:string, amount:float, count:int, overdue:bool}>
     */
    private static function calendar(array $bills): array
    {
        $byDate = [];
        foreach ($bills as $bill) {
            $due = $bill['due_date'];
            if ($due === null) {
                continue;
            }
            $byDate[$due] ??= ['date' => $due, 'amount' => 0.0, 'count' => 0, 'overdue' => false];
            $byDate[$due]['amount'] += (float) $bill['balance'];
            $byDate[$due]['count']++;
            $byDate[$due]['overdue'] = $byDate[$due]['overdue'] || $bill['status'] === 'overdue';
        }

        ksort($byDate);

        return array_values(array_map(static function (array $day) {
            $day['amount'] = round($day['amount'], 2);

            return $day;
        }, $byDate));
    }

    /**
     * Whether a supplier bill can be read from a PDF or a photo.
     *
     * There is no document-extraction service in this deployment, and inventing
     * one here would mean either a second OCR stack or a model guessing at
     * totals. So the answer is no, said plainly, with the manual path — which
     * works — offered instead of a button that appears to do something.
     *
     * @return array<string, mixed>
     */
    private static function importCapability(): array
    {
        $configured = \Aicountly\Api\Env::get('DOCUMENT_EXTRACTION_BASE') !== '';

        return [
            'available'   => $configured,
            'manual_path' => '/purchases/new',
            'reason'      => $configured
                ? null
                : 'Reading a bill from a PDF or photo needs a document-extraction service, and none is configured for this '
                    . 'deployment. Entering the bill by hand records exactly the same thing.',
        ];
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
