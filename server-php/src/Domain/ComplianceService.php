<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

use Aicountly\Api\Auth;
use Aicountly\Api\Clients\BooksClient;
use Aicountly\Api\Context;
use Aicountly\Api\Db;
use Aicountly\Api\Env;
use Aicountly\Api\Http;
use Aicountly\Api\Permissions;

/**
 * Dashboard 5 — "Close your day with confidence".
 *
 * Two things this screen is careful not to claim.
 *
 * IT DOES NOT CLOSE ANYTHING. Ticking every line of the checklist locks no
 * period, posts no entry and freezes no date. Billing has no accounting period
 * to lock — Books does — and a checklist that quietly created one would be a
 * second answer to a question this product does not own. A tick is one person
 * saying "I have looked at this", and that is the whole of it.
 *
 * IT DOES NOT CERTIFY COMPLIANCE. The document panel reports what was asked for
 * and what came back. Whether an e-Invoice was required in the first place is
 * the law's question and Books' answer; "not generated" here means not
 * generated, never "non-compliant", and a document that never needed one reads
 * as Not applicable rather than as a failure.
 */
final class ComplianceService
{
    public const STEPS = [
        'receipts_reviewed'   => 'Receipts reviewed',
        'payments_reviewed'   => 'Payments reviewed',
        'bank_entries_matched' => 'Bank entries matched',
        'documents_reviewed'  => 'Document exceptions reviewed',
    ];

    public function __construct(
        private readonly Context $ctx,
        private readonly Auth $auth,
    ) {
    }

    /** @return array<string, mixed> */
    public function build(Period $period, ?string $businessDate = null): array
    {
        $date = $businessDate ?? $period->today();
        $dues = new DuesService($this->ctx, $this->auth);
        $cashBank = $dues->cashAndBank();

        $metrics = [];
        $mayCash = Permissions::allows($this->ctx, $this->auth, 'cash.view');
        $mayBank = Permissions::allows($this->ctx, $this->auth, 'bank.view');

        if ($mayCash) {
            $metrics[] = $cashBank['available'] && $cashBank['cash'] !== null
                ? Metric::ready('cash', 'Cash', $cashBank['cash'], Metric::BASIS_AS_OF,
                    'The closing balance of the cash ledgers in Smart Books as at ' . $date . '.')
                : Metric::unavailable('cash', 'Cash', Metric::BASIS_AS_OF,
                    'The closing balance of the cash ledgers as at ' . $date . '.',
                    (string) ($cashBank['reason'] ?? 'Smart Books did not answer.'));
        }

        if ($mayBank) {
            $metrics[] = $cashBank['available'] && $cashBank['bank'] !== null
                ? Metric::ready('bank', 'Bank', $cashBank['bank'], Metric::BASIS_AS_OF,
                    'The closing balance of the bank ledgers in Smart Books as at ' . $date . '.')
                : Metric::unavailable('bank', 'Bank', Metric::BASIS_AS_OF,
                    'The closing balance of the bank ledgers as at ' . $date . '.',
                    (string) ($cashBank['reason'] ?? 'Smart Books did not answer.'));
        }

        $matching = $this->bankMatching();
        $metrics[] = $matching['available']
            ? Metric::ready('unmatched', 'Unmatched bank entries', $matching['unmatched_count'], Metric::BASIS_COUNT,
                'Lines on the bank statement that have not been matched to an entry in the accounts.')
            : Metric::unavailable('unmatched', 'Unmatched bank entries', Metric::BASIS_COUNT,
                'Lines on the bank statement that have not been matched to an entry in the accounts.',
                (string) $matching['reason']);

        $documents = $this->documents($date);
        $metrics[] = Metric::ready(
            'document_exceptions',
            'Document exceptions',
            $documents['exception_count'],
            Metric::BASIS_COUNT,
            'e-Invoice and e-Way Bill requests raised from Billing that have not come back generated. '
                . 'It does not count documents that never needed one.',
            null,
            $documents['exception_count'] > 0 ? 'warning' : 'neutral',
        );

        return [
            'period'        => $period->describe(),
            'business_date' => $date,
            'metrics'       => $metrics,
            'panels'        => [
                'movement'  => $this->movement($period, $date),
                'checklist' => $this->checklist($date, $documents, $matching),
                'documents' => $documents,
                'matching'  => $matching,
                'accounts'  => $cashBank['available'] ? ($cashBank['accounts'] ?? []) : [],
                'can_move_money'  => Permissions::allows($this->ctx, $this->auth, 'contra.create'),
                'can_take_money'  => Permissions::allows($this->ctx, $this->auth, 'receipt.create'),
                'can_pay'         => Permissions::allows($this->ctx, $this->auth, 'payment.create'),
            ],
            'generated_at' => gmdate('c'),
        ];
    }

    /**
     * Money in and money out — with transfers kept out of both.
     *
     * A cash deposit into the bank is not income and a withdrawal is not an
     * expense; both are the same money in a different pocket. Counting them
     * would show a business that banked its takings twice on the way in and
     * spent them on the way out. So contra entries are read, reported, and
     * reported SEPARATELY, under their own heading.
     *
     * @return array<string, mixed>
     */
    private function movement(Period $period, string $date): array
    {
        if (!Permissions::allows($this->ctx, $this->auth, 'cash.view')
            && !Permissions::allows($this->ctx, $this->auth, 'bank.view')) {
            return ['available' => false, 'reason' => 'Your Billing profile does not show balances.', 'buckets' => []];
        }

        $books = (new BooksClient())->withSession($this->auth->sesKey());
        $register = new RegisterReader($this->ctx, $books);

        // The day itself when a day is being closed; the period when it is not.
        $from = $date;
        $to = $date;

        $receipts = $register->read(BooksClient::VCH_RECEIPT, $from, $to);
        $payments = $register->read(BooksClient::VCH_PAYMENT, $from, $to);
        $contra   = $register->read(BooksClient::VCH_CONTRA, $from, $to);

        if (!$receipts['available'] && !$payments['available']) {
            return ['available' => false, 'reason' => 'Smart Books did not answer for this date.', 'buckets' => []];
        }

        // Bucket by hour when the rows carry a time, otherwise report the day as
        // one bucket. Spreading a day's total across invented hours would be a
        // chart of nothing.
        $hourly = self::hasClockTimes($receipts['rows']) || self::hasClockTimes($payments['rows']);
        $buckets = [];

        if ($hourly) {
            for ($hour = 0; $hour < 24; $hour++) {
                $buckets[$hour] = ['label' => sprintf('%02d:00', $hour), 'in' => 0.0, 'out' => 0.0];
            }
            self::fill($buckets, $receipts['rows'], 'in');
            self::fill($buckets, $payments['rows'], 'out');
            // Trading hours only: 24 bars for a shop open eight of them is mostly
            // empty space, so the range is trimmed to what actually happened.
            $buckets = self::trim($buckets);
        } else {
            $buckets = [[
                'label' => 'All day',
                'in'    => array_sum(array_map(static fn (array $row) => BooksReadings::voucherAmount($row) ?? 0.0, $receipts['rows'])),
                'out'   => array_sum(array_map(static fn (array $row) => BooksReadings::voucherAmount($row) ?? 0.0, $payments['rows'])),
            ]];
        }

        $transferred = 0.0;
        foreach ($contra['rows'] as $row) {
            $transferred += BooksReadings::voucherAmount($row) ?? 0.0;
        }

        return [
            'available'  => true,
            'date'       => $date,
            'granularity' => $hourly ? 'hour' : 'day',
            'buckets'    => array_values(array_map(static fn (array $bucket) => [
                'label' => $bucket['label'],
                'in'    => round($bucket['in'], 2),
                'out'   => round($bucket['out'], 2),
            ], $buckets)),
            'in_total'   => round(array_sum(array_column($buckets, 'in')), 2),
            'out_total'  => round(array_sum(array_column($buckets, 'out')), 2),
            'transferred' => [
                'available' => $contra['available'],
                'amount'    => round($transferred, 2),
                'count'     => count($contra['rows']),
                'note'      => 'Moved between your own cash and bank accounts. Counted here and in neither '
                    . 'the money-in nor the money-out figure, because it is neither.',
            ],
            'basis'      => 'Receipts as money in and payments as money out, dated ' . $date . '. '
                . 'Transfers between your own accounts are excluded from both.'
                . (($receipts['complete'] && $payments['complete']) ? '' : ' More entries exist than could be read at once.'),
        ];
    }

    /**
     * The four steps, each with what is actually outstanding behind it.
     *
     * A step is COMPLETE when there is nothing left to look at, or when someone
     * has ticked it. Those two are reported separately — `outstanding` is read
     * from live data, `checked_by` is a person's name — so a tick on a step that
     * still has work behind it is visible as exactly that.
     *
     * @param array<string, mixed> $documents
     * @param array<string, mixed> $matching
     * @return array<string, mixed>
     */
    private function checklist(string $date, array $documents, array $matching): array
    {
        $ticks = [];
        foreach (Db::all(
            'SELECT step, checked_by, checked_at FROM billing_day_close_checks
             WHERE cmp_id = :cmp AND bo_id = :bo AND business_date = :date',
            ['cmp' => $this->ctx->cmpId, 'bo' => $this->ctx->boId, 'date' => $date],
        ) as $row) {
            $ticks[(string) $row['step']] = $row;
        }

        $outstanding = [
            // Receipts and payments have nothing automatic to count against
            // them: "have you looked at today's receipts" is a question only a
            // person can answer, so these two are ticks and nothing else.
            'receipts_reviewed'    => null,
            'payments_reviewed'    => null,
            'bank_entries_matched' => $matching['available'] ? $matching['unmatched_count'] : null,
            'documents_reviewed'   => $documents['exception_count'],
        ];

        $steps = [];
        foreach (self::STEPS as $key => $label) {
            $tick = $ticks[$key] ?? null;
            $left = $outstanding[$key];
            $steps[] = [
                'key'        => $key,
                'label'      => $label,
                'checked'    => $tick !== null,
                'checked_by' => $tick['checked_by'] ?? null,
                'checked_at' => $tick['checked_at'] ?? null,
                'outstanding' => $left,
                'detail'     => match (true) {
                    $key === 'bank_entries_matched' && !$matching['available'] => (string) $matching['reason'],
                    $left === null  => $tick !== null ? 'Marked as looked at.' : 'Nothing here can be checked automatically — tick it when you have looked.',
                    $left === 0     => 'Nothing outstanding.',
                    default         => $left . ' still need attention.',
                },
            ];
        }

        return [
            'date'  => $date,
            'steps' => $steps,
            'note'  => 'Ticking these records that you looked. It closes no period and posts no entry — '
                . 'Smart Books owns the accounting period, and Billing does not lock it.',
        ];
    }

    /**
     * What was asked of the IRP, and what came back.
     *
     * Read from this product's own command log rather than from a status call
     * per voucher, and labelled accordingly: these are the requests BILLING
     * raised. Smart Books remains the authority on any individual document, and
     * the row links to it.
     *
     * @return array<string, mixed>
     */
    private function documents(string $date): array
    {
        if (!Permissions::allows($this->ctx, $this->auth, 'compliance.view')) {
            return [
                'available' => false,
                'reason'    => 'Your Billing profile does not include document checks.',
                'rows'      => [],
                'exception_count' => 0,
            ];
        }

        $rows = Db::all(
            "SELECT c.command_id, c.command_type, c.status, c.attempts, c.last_error,
                    c.last_attempt_at, c.entity_id, r.books_voucher_no, r.books_voucher_id, r.transaction_date
             FROM billing_integration_commands c
             LEFT JOIN billing_transaction_requests r ON r.request_id = c.entity_id
             WHERE c.cmp_id = :cmp AND c.command_type LIKE 'billing.e%'
             ORDER BY c.updated_at DESC
             LIMIT 100",
            ['cmp' => $this->ctx->cmpId],
        );

        $states = ['GENERATED' => 0, 'PENDING' => 0, 'FAILED' => 0];
        $out = [];
        foreach ($rows as $row) {
            $what = str_contains((string) $row['command_type'], 'eway') ? 'e-Way Bill' : 'e-Invoice';
            $state = match ((string) $row['status']) {
                'COMPLETED' => 'GENERATED',
                'FAILED', 'BLOCKED' => 'FAILED',
                default => 'PENDING',
            };
            $states[$state]++;

            if ($state !== 'GENERATED') {
                $out[] = [
                    'command_id'  => (int) $row['command_id'],
                    'document'    => $what,
                    'state'       => $state,
                    'attempts'    => (int) $row['attempts'],
                    'voucher_no'  => $row['books_voucher_no'],
                    'voucher_id'  => $row['books_voucher_id'] !== null ? (int) $row['books_voucher_id'] : null,
                    'request_id'  => (int) $row['entity_id'],
                    'date'        => $row['transaction_date'],
                    'detail'      => $row['last_error'] ?? 'Smart Books has not confirmed this yet.',
                    'last_attempt_at' => $row['last_attempt_at'],
                ];
            }
        }

        return [
            'available'       => true,
            'reason'          => null,
            'states'          => $states,
            'rows'            => array_slice($out, 0, 20),
            'exception_count' => count($out),
            'note'            => 'These are the e-Invoice and e-Way Bill requests raised from Billing. A sale that never needed '
                . 'one is not listed and is not an exception. Smart Books holds the IRN and the final status.',
        ];
    }

    /**
     * Bank statement matching.
     *
     * Matching a statement needs a statement, and nothing in this deployment
     * imports one: Billing has no bank feed, and reconciliation belongs to the
     * accounts rather than to a billing front end. Rather than draw an empty
     * panel with a disabled button, this reports the specific missing capability
     * and what it would take — see docs/BILLING_API_DEPENDENCIES.md.
     *
     * @return array<string, mixed>
     */
    private function bankMatching(): array
    {
        if (Env::get('BOOKS_BANK_RECONCILIATION') !== 'enabled') {
            return [
                'available'       => false,
                'unmatched_count' => null,
                'suggestions'     => [],
                'reason'          => 'Matching needs a bank statement, and no bank feed or statement import is configured for '
                    . 'this deployment. Smart Books owns bank reconciliation; Billing would read it, not perform it.',
                'dependency'      => [
                    'owner'    => 'Smart Books',
                    'needs'    => 'A bank-reconciliation read API: unmatched statement lines for an account and date range, '
                        . 'and candidate entries for a line.',
                    'document' => 'docs/BILLING_API_DEPENDENCIES.md',
                ],
            ];
        }

        // The contract is not live anywhere yet, so this branch exists to be
        // wired up rather than to be guessed at. Saying so beats inventing a
        // response shape that the real service will not match.
        return [
            'available'       => false,
            'unmatched_count' => null,
            'suggestions'     => [],
            'reason'          => 'Bank reconciliation is switched on for this deployment but the Smart Books contract is not '
                . 'published yet. Nothing is shown rather than something guessed.',
            'dependency'      => [
                'owner'    => 'Smart Books',
                'needs'    => 'reports/bank-reconciliation — unmatched lines and candidate matches.',
                'document' => 'docs/BILLING_API_DEPENDENCIES.md',
            ],
        ];
    }

    /** Tick or untick one step of a day's checklist. */
    public function setStep(string $date, string $step, bool $checked): array
    {
        Permissions::assert($this->ctx, $this->auth, 'compliance.view');

        if (!isset(self::STEPS[$step])) {
            Http::validationFailed('That is not a step on the day-close checklist.', ['field' => 'step']);
        }

        try {
            $businessDate = (new \DateTimeImmutable($date))->format('Y-m-d');
        } catch (\Throwable) {
            Http::validationFailed('Which day are you closing?', ['field' => 'date']);
        }

        if ($checked) {
            Db::run(
                'INSERT INTO billing_day_close_checks (cmp_id, fy_id, bo_id, business_date, step, checked_by)
                 VALUES (:cmp, :fy, :bo, :date, :step, :by)
                 ON CONFLICT (cmp_id, bo_id, business_date, step)
                 DO UPDATE SET checked_by = EXCLUDED.checked_by, checked_at = NOW()',
                [
                    'cmp' => $this->ctx->cmpId, 'fy' => $this->ctx->fyId, 'bo' => $this->ctx->boId,
                    'date' => $businessDate, 'step' => $step, 'by' => $this->auth->uuid,
                ],
            );
        } else {
            Db::run(
                'DELETE FROM billing_day_close_checks
                 WHERE cmp_id = :cmp AND bo_id = :bo AND business_date = :date AND step = :step',
                ['cmp' => $this->ctx->cmpId, 'bo' => $this->ctx->boId, 'date' => $businessDate, 'step' => $step],
            );
        }

        return ['date' => $businessDate, 'step' => $step, 'checked' => $checked];
    }

    /** @param list<array<string, mixed>> $rows */
    private static function hasClockTimes(array $rows): bool
    {
        foreach ($rows as $row) {
            if (BooksReadings::voucherHour($row) !== null) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<int, array{label:string, in:float, out:float}> $buckets
     * @param list<array<string, mixed>>                           $rows
     */
    private static function fill(array &$buckets, array $rows, string $side): void
    {
        foreach ($rows as $row) {
            $hour = BooksReadings::voucherHour($row);
            $amount = BooksReadings::voucherAmount($row);
            if ($amount === null) {
                continue;
            }
            // A row with no time still happened; parking it at the start of the
            // day is a lie, so it goes in the last bucket of the trading range
            // only if there is one. Simplest honest choice: midday.
            $buckets[$hour ?? 12][$side] += $amount;
        }
    }

    /**
     * @param array<int, array{label:string, in:float, out:float}> $buckets
     * @return array<int, array{label:string, in:float, out:float}>
     */
    private static function trim(array $buckets): array
    {
        $active = array_keys(array_filter($buckets, static fn (array $b) => $b['in'] > 0 || $b['out'] > 0));
        if ($active === []) {
            return array_slice($buckets, 9, 12, true);
        }

        $first = max(0, min($active) - 1);
        $last = min(23, max($active) + 1);

        return array_slice($buckets, $first, $last - $first + 1, true);
    }
}
