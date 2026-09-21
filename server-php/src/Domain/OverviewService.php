<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

use Aicountly\Api\Auth;
use Aicountly\Api\Clients\BooksClient;
use Aicountly\Api\Context;
use Aicountly\Api\Db;
use Aicountly\Api\Permissions;

/**
 * Dashboard 1 — "Your business, at a glance".
 *
 * Four figures and a short list of things to do about them. The four are
 * deliberately not four of a kind: two are movements over the chosen period and
 * two are balances as at today, and each card carries which it is, because
 * "Sales this month" and "To collect" sitting side by side in the same typeface
 * invite exactly the wrong arithmetic.
 *
 * A card the user may not see is ABSENT, not greyed out. Showing a biller a
 * locked "Cash and bank" card tells them the balance exists and that somebody
 * decided they should not have it; leaving it out tells them nothing, which is
 * the correct amount.
 */
final class OverviewService
{
    public function __construct(
        private readonly Context $ctx,
        private readonly Auth $auth,
    ) {
    }

    /** @return array<string, mixed> */
    public function build(Period $period): array
    {
        $books = (new BooksClient())->withSession($this->auth->sesKey());
        $register = new RegisterReader($this->ctx, $books);
        $today = $period->today();

        $metrics = [];
        $panels = [];
        $may = fn (string $permission): bool => Permissions::allows($this->ctx, $this->auth, $permission);

        // --- Sales, a movement over the chosen period ------------------------
        $salesReading = null;
        if ($may('sale.view')) {
            $salesReading = $register->read(BooksClient::VCH_SALES, $period->from, $period->to);
            $salesTotal = RegisterReader::total($salesReading);

            $previous = $register->read(BooksClient::VCH_SALES, $period->previousFrom, $period->previousTo);
            $comparison = Metric::compare(
                $salesTotal,
                RegisterReader::total($previous),
                $period->previousLabel,
                riseIsGood: true,
            );

            $metrics[] = $salesTotal !== null
                ? Metric::ready(
                    'sales',
                    'Sales ' . self::periodWords($period),
                    $salesTotal,
                    Metric::BASIS_PERIOD,
                    'Invoices dated ' . $period->from . ' to ' . $period->to . ', at their full value including tax. '
                        . 'Credit notes are not netted off — they are counted separately.',
                    $comparison,
                    'neutral',
                    ['summary' => self::dayRange($period) . ' · including tax, before credit notes'],
                )
                : Metric::unavailable(
                    'sales',
                    'Sales ' . self::periodWords($period),
                    Metric::BASIS_PERIOD,
                    'Invoices dated ' . $period->from . ' to ' . $period->to . ', at their full value including tax.',
                    $salesReading['available']
                        ? 'There are more invoices in this period than can be totalled in one read. Narrow the dates.'
                        : ($salesReading['reason'] ?? 'Smart Books did not answer.'),
                );
        }

        // --- What is owed, in both directions, as at today -------------------
        $dues = new DuesService($this->ctx, $this->auth);

        if ($may('receivable.view')) {
            $receivables = $dues->tryReceivables(['as_on' => $today]);
            $metrics[] = $receivables !== null
                ? Metric::ready(
                    'to_collect',
                    'To collect',
                    $receivables['total'],
                    Metric::BASIS_AS_OF,
                    'What customers still owe as at ' . $today . ', bill by bill, after every receipt allocated to date. '
                        . 'This is a balance, not a figure for the period.',
                    null,
                    ($receivables['overdue'] ?? 0) > 0 ? 'warning' : 'neutral',
                    [
                        'detail'  => $receivables['overdue'] > 0
                            ? self::money($receivables['overdue']) . ' of it is overdue'
                            : 'Nothing overdue',
                        'summary' => 'As at ' . self::day($today) . ' · ' . ($receivables['overdue'] > 0
                            ? self::money($receivables['overdue']) . ' overdue'
                            : 'nothing overdue'),
                    ],
                )
                : Metric::unavailable('to_collect', 'To collect', Metric::BASIS_AS_OF, 'What customers still owe as at ' . $today . '.', 'Smart Books did not answer.');
        }

        if ($may('payable.view')) {
            $payables = $dues->tryPayables(['as_on' => $today]);
            $metrics[] = $payables !== null
                ? Metric::ready(
                    'to_pay',
                    'To pay',
                    $payables['total'],
                    Metric::BASIS_AS_OF,
                    'What is still owed to suppliers as at ' . $today . ', bill by bill, after every payment allocated to date.',
                    null,
                    ($payables['overdue'] ?? 0) > 0 ? 'warning' : 'neutral',
                    [
                        'detail'  => $payables['overdue'] > 0
                            ? self::money($payables['overdue']) . ' of it is overdue'
                            : 'Nothing overdue',
                        // The week ahead rather than what is already late: this is
                        // the card somebody checks before deciding what to pay next.
                        'summary' => 'As at ' . self::day($today) . ' · ' . (($payables['due_this_week'] ?? 0) > 0
                            ? self::money($payables['due_this_week']) . ' due within 7 days'
                            : 'nothing due within 7 days'),
                    ],
                )
                : Metric::unavailable('to_pay', 'To pay', Metric::BASIS_AS_OF, 'What is still owed to suppliers as at ' . $today . '.', 'Smart Books did not answer.');
        }

        // --- Cash and bank ---------------------------------------------------
        if ($may('cash.view') || $may('bank.view')) {
            $cashBank = $dues->cashAndBank();
            if ($cashBank['available']) {
                $sum = ($cashBank['cash'] ?? 0) + ($cashBank['bank'] ?? 0);
                $metrics[] = Metric::ready(
                    'cash_bank',
                    self::cashBankLabel($may('cash.view'), $may('bank.view')),
                    $sum,
                    Metric::BASIS_AS_OF,
                    'The closing balance of the cash and bank ledgers in Smart Books as at ' . $today . '. '
                        . 'It is the accounts\' own figure, not invoices less expenses.',
                    null,
                    'neutral',
                    [
                        'detail'  => count($cashBank['accounts'] ?? []) . ' account(s)',
                        'summary' => 'As at ' . self::day($today) . ' · '
                            . count($cashBank['accounts'] ?? []) . ' '
                            . (count($cashBank['accounts'] ?? []) === 1 ? 'account' : 'accounts'),
                    ],
                );
            } else {
                $metrics[] = Metric::unavailable(
                    'cash_bank',
                    self::cashBankLabel($may('cash.view'), $may('bank.view')),
                    Metric::BASIS_AS_OF,
                    'The closing balance of the cash and bank ledgers as at ' . $today . '.',
                    (string) ($cashBank['reason'] ?? 'Smart Books did not answer.'),
                );
            }
        }

        // --- Sales and collections over the period ---------------------------
        $panels['trend'] = $this->trend($register, $period, $salesReading, $may('sale.view'), $may('receipt.create') || $may('receivable.view'));

        // --- Things worth doing something about ------------------------------
        $panels['actions'] = $this->actions($period);

        // --- The briefing strip, counted from what is already on this page ---
        // Built from the two arrays above rather than from fresh reads, so the
        // sentence at the top and the list underneath it cannot disagree.
        $panels['briefing'] = BriefingService::build($period, $panels['actions'], $metrics);

        // --- Recent invoices --------------------------------------------------
        $panels['recent_documents'] = $may('sale.view')
            ? [
                'available' => $salesReading !== null && $salesReading['available'],
                'reason'    => $salesReading === null || $salesReading['available'] ? null : $salesReading['reason'],
                'rows'      => $salesReading !== null && $salesReading['available'] ? RegisterReader::documents($salesReading, 6) : [],
            ]
            : null;

        return [
            'period'      => $period->describe(),
            'metrics'     => array_values($metrics),
            'panels'      => $panels,
            'generated_at' => gmdate('c'),
            'source'      => 'Read from Smart Books as this page loaded. Billing stores none of these figures.',
        ];
    }

    /**
     * Sales against collections, day by day.
     *
     * The two lines answer different questions and are kept distinct in the
     * wording as well as the colour: sales is what was invoiced, collections is
     * what came in. Collections is not revenue and a month where the second
     * line is above the first is a month of getting paid for old work, not a
     * record month.
     *
     * @param array<string,mixed>|null $salesReading
     * @return array<string, mixed>
     */
    private function trend(RegisterReader $register, Period $period, ?array $salesReading, bool $maySales, bool $mayCollections): array
    {
        $series = [];
        $unavailable = [];

        if ($maySales) {
            $reading = $salesReading ?? $register->read(BooksClient::VCH_SALES, $period->from, $period->to);
            $daily = RegisterReader::daily($reading, $period);
            if ($daily !== null) {
                $series['sales'] = ['label' => 'Sales', 'points' => $daily];
            } else {
                $unavailable[] = 'sales';
            }
        }

        if ($mayCollections) {
            $reading = $register->read(BooksClient::VCH_RECEIPT, $period->from, $period->to);
            $daily = RegisterReader::daily($reading, $period);
            if ($daily !== null) {
                $series['collections'] = ['label' => 'Collections', 'points' => $daily];
            } else {
                $unavailable[] = 'collections';
            }
        }

        return [
            'available'   => $series !== [],
            'series'      => $series,
            'unavailable' => $unavailable,
            'reason'      => $series === []
                ? 'Smart Books did not return a register that can be totalled for these dates.'
                : null,
            'basis'       => 'Invoices and receipts by their document date, in ' . $period->timezone . '.',
        ];
    }

    /**
     * The short list. Every entry names its records and goes somewhere.
     *
     * Deterministic throughout — counted from live rows and from this product's
     * own request log. Nothing here is generated text, and nothing here carries
     * a confidence score, because a number nobody can reproduce is worse than
     * no number.
     *
     * @return list<array<string, mixed>>
     */
    private function actions(Period $period): array
    {
        $actions = [];
        $today = $period->today();
        $dues = new DuesService($this->ctx, $this->auth);

        if (Permissions::allows($this->ctx, $this->auth, 'receivable.view')) {
            $receivables = $dues->tryReceivables(['as_on' => $today]);
            if ($receivables !== null) {
                $overdueParties = array_values(array_filter(
                    $receivables['parties'],
                    static fn (array $party) => $party['overdue'] > 0,
                ));
                if ($overdueParties !== []) {
                    $oldest = 0;
                    foreach ($overdueParties as $party) {
                        $oldest = max($oldest, $party['oldest_overdue_days']);
                    }
                    $actions[] = [
                        'id'      => 'overdue_receivables',
                        'tone'    => 'danger',
                        'title'   => sprintf(
                            '%d customer%s overdue, %s in total',
                            count($overdueParties),
                            count($overdueParties) === 1 ? '' : 's',
                            self::money($receivables['overdue']),
                        ),
                        'reason'  => sprintf('The oldest is %d days past its due date.', $oldest),
                        'source'  => ['kind' => 'receivable_bills', 'as_on' => $today, 'count' => count($overdueParties)],
                        'action'  => ['label' => 'Review', 'path' => '/dashboard/receivables'],
                    ];
                }
            }
        }

        if (Permissions::allows($this->ctx, $this->auth, 'payable.view')) {
            $payables = $dues->tryPayables(['as_on' => $today]);
            if ($payables !== null && $payables['due_this_week'] > 0) {
                $suppliers = array_values(array_filter(
                    $payables['parties'],
                    static fn (array $party) => $party['total'] > 0,
                ));
                $actions[] = [
                    'id'     => 'supplier_bills_due',
                    'tone'   => 'warning',
                    'title'  => sprintf('%s due to suppliers within seven days', self::money($payables['due_this_week'])),
                    'reason' => sprintf('Across %d supplier account%s.', count($suppliers), count($suppliers) === 1 ? '' : 's'),
                    'source' => ['kind' => 'payable_bills', 'as_on' => $today, 'count' => count($suppliers)],
                    'action' => ['label' => 'Review', 'path' => '/dashboard/payables'],
                ];
            }
        }

        // Ours: what the user started here and what never reached Books.
        $unfinished = (int) Db::scalar(
            "SELECT COUNT(*) FROM billing_transaction_requests
             WHERE cmp_id = :cmp AND status IN ('PENDING', 'POSTING', 'FAILED')",
            ['cmp' => $this->ctx->cmpId],
        );
        if ($unfinished > 0) {
            $actions[] = [
                'id'     => 'unfinished_entries',
                'tone'   => 'danger',
                'title'  => sprintf('%d entr%s not saved to Smart Books', $unfinished, $unfinished === 1 ? 'y' : 'ies'),
                'reason' => 'These were started here and have not been accepted by the accounts. Nothing has been duplicated.',
                'source' => ['kind' => 'billing_transaction_requests', 'count' => $unfinished],
                'action' => ['label' => 'Retry', 'path' => '/more/unfinished'],
            ];
        }

        $recurringDue = (int) Db::scalar(
            "SELECT COUNT(*) FROM billing_recurring_rules
             WHERE cmp_id = :cmp AND status = 'ACTIVE' AND next_run_date <= :today",
            ['cmp' => $this->ctx->cmpId, 'today' => $today],
        );
        if ($recurringDue > 0 && Permissions::allows($this->ctx, $this->auth, 'recurring.manage')) {
            $actions[] = [
                'id'     => 'recurring_due',
                'tone'   => 'info',
                'title'  => sprintf('%d recurring bill%s ready to raise', $recurringDue, $recurringDue === 1 ? '' : 's'),
                'reason' => 'Their date has come round. Nothing is raised until you do it.',
                'source' => ['kind' => 'billing_recurring_rules', 'count' => $recurringDue],
                'action' => ['label' => 'Raise', 'path' => '/more/recurring'],
            ];
        }

        $failedDocuments = (int) Db::scalar(
            "SELECT COUNT(*) FROM billing_integration_commands
             WHERE cmp_id = :cmp AND status IN ('FAILED', 'BLOCKED')
               AND command_type LIKE 'billing.e%'",
            ['cmp' => $this->ctx->cmpId],
        );
        if ($failedDocuments > 0 && Permissions::allows($this->ctx, $this->auth, 'compliance.view')) {
            $actions[] = [
                'id'     => 'statutory_failed',
                'tone'   => 'warning',
                'title'  => sprintf('%d statutory document%s did not complete', $failedDocuments, $failedDocuments === 1 ? '' : 's'),
                'reason' => 'An e-Invoice or e-Way Bill was requested and has not come back generated.',
                'source' => ['kind' => 'billing_integration_commands', 'count' => $failedDocuments],
                'action' => ['label' => 'Review', 'path' => '/dashboard/cash-compliance'],
            ];
        }

        return $actions;
    }

    private static function cashBankLabel(bool $cash, bool $bank): string
    {
        return match (true) {
            $cash && $bank => 'Cash & bank',
            $cash          => 'Cash in hand',
            default        => 'In the bank',
        };
    }

    private static function periodWords(Period $period): string
    {
        return match ($period->key) {
            'today' => 'today',
            'week'  => 'this week',
            'year'  => 'this year',
            'month' => 'this month',
            default => 'in this period',
        };
    }

    private static function money(float $value): string
    {
        return '₹' . number_format($value, 2);
    }

    /**
     * One ISO date as a person writes it. Falls back to the ISO string rather
     * than to today, because a date that could not be parsed is not today.
     */
    private static function day(string $iso): string
    {
        $parsed = \DateTimeImmutable::createFromFormat('!Y-m-d', $iso);

        return $parsed === false ? $iso : $parsed->format('j M');
    }

    /** Both ends of the window, in the same short form. */
    private static function dayRange(Period $period): string
    {
        return $period->from === $period->to
            ? self::day($period->from)
            : self::day($period->from) . '–' . self::day($period->to);
    }
}
