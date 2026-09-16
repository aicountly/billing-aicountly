<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

use Aicountly\Api\Auth;
use Aicountly\Api\Clients\BooksClient;
use Aicountly\Api\Context;
use Aicountly\Api\Permissions;

/**
 * Dashboard 3 — "Turn invoices into collections".
 *
 * Four figures that are four different kinds of thing, which is the whole
 * reason each carries its basis:
 *
 *   Outstanding   a balance, as at today
 *   Overdue       a balance, as at today, of the part past its due date
 *   Due soon      a window of dates in the future
 *   Collected     a movement, over the chosen period
 *
 * Collected is receipts. It is NOT revenue and it is not "sales that got paid":
 * a receipt in September against an August invoice is September's collection and
 * August's sale, and the wording on the card says so.
 */
final class CollectionsService
{
    public function __construct(
        private readonly Context $ctx,
        private readonly Auth $auth,
    ) {
    }

    /** @return array<string, mixed> */
    public function build(Period $period): array
    {
        $today = $period->today();
        $dues = new DuesService($this->ctx, $this->auth);
        $receivables = $dues->tryReceivables(['as_on' => $today]);

        $metrics = [];
        $dueWindowEnd = $period->windowEnd(7);

        if ($receivables === null) {
            foreach ([
                ['outstanding', 'Outstanding', Metric::BASIS_AS_OF, 'What customers still owe as at ' . $today . '.'],
                ['overdue', 'Overdue', Metric::BASIS_AS_OF, 'The part of the outstanding that is past its due date as at ' . $today . '.'],
                ['due_soon', 'Due in seven days', Metric::BASIS_WINDOW, 'Bills falling due between ' . $today . ' and ' . $dueWindowEnd . '.'],
            ] as [$id, $label, $basis, $definition]) {
                $metrics[] = Metric::unavailable($id, $label, $basis, $definition, 'Smart Books did not answer.');
            }
        } else {
            $metrics[] = Metric::ready(
                'outstanding',
                'Outstanding',
                $receivables['total'],
                Metric::BASIS_AS_OF,
                'What customers still owe as at ' . $today . ', bill by bill, after every receipt allocated to date. '
                    . 'A part-paid bill counts for the part still unpaid, not for its whole value.',
                null,
                'neutral',
                ['detail' => count($receivables['bills']) . ' bill(s) across ' . count($receivables['parties']) . ' customer(s)'],
            );
            $metrics[] = Metric::ready(
                'overdue',
                'Overdue',
                $receivables['overdue'],
                Metric::BASIS_AS_OF,
                'The part of the outstanding whose due date has already passed, as at ' . $today . '.',
                null,
                $receivables['overdue'] > 0 ? 'danger' : 'neutral',
            );
            $metrics[] = Metric::ready(
                'due_soon',
                'Due in seven days',
                $receivables['due_this_week'],
                Metric::BASIS_WINDOW,
                'Bills falling due from ' . $today . ' up to and including ' . $dueWindowEnd . ', in ' . $period->timezone . '. '
                    . 'Anything already overdue is not counted here — it is in Overdue.',
                null,
                'neutral',
            );
        }

        // --- Collected in the period -----------------------------------------
        $metrics[] = $this->collected($period);

        $byAccount = [];
        foreach ($receivables['parties'] ?? [] as $party) {
            $byAccount[(int) $party['account_id']] = $party;
        }

        return [
            'period'  => $period->describe(),
            'metrics' => $metrics,
            'panels'  => [
                'ageing'     => $receivables !== null
                    ? [
                        'available'   => true,
                        'buckets'     => $this->ageingBuckets($receivables),
                        'total'       => $receivables['total'],
                        'reconciles'  => $receivables['ageing_reconciles'] ?? true,
                        'basis'       => 'Aged by each bill\'s due date against ' . $today . ', on the balance still unpaid.',
                    ]
                    : ['available' => false, 'reason' => 'Smart Books did not answer.', 'buckets' => [], 'total' => null],
                'queue'      => $receivables !== null ? $this->priorityQueue($receivables) : [],
                'priorities' => $receivables !== null ? $this->followUpPriorities($receivables) : null,
                'promises'   => $this->promises($today, $byAccount),
                'can_record_receipt' => Permissions::allows($this->ctx, $this->auth, 'receipt.create'),
                'can_remind'         => Permissions::allows($this->ctx, $this->auth, 'reminder.send'),
                'can_promise'        => Permissions::allows($this->ctx, $this->auth, 'promise.manage'),
                'reminder_delivery'  => $this->reminderDelivery(),
            ],
            'note' => $receivables['note'] ?? null,
            'generated_at' => gmdate('c'),
        ];
    }

    /** @return array<string, mixed> */
    private function collected(Period $period): array
    {
        $label = 'Collected ' . ($period->key === 'month' ? 'this month' : 'in this period');
        $definition = 'Receipts dated ' . $period->from . ' to ' . $period->to . '. '
            . 'This is money that came in during the period, whenever the bill was raised — it is not revenue.';

        if (!Permissions::allows($this->ctx, $this->auth, 'receipt.create')
            && !Permissions::allows($this->ctx, $this->auth, 'receivable.view')) {
            return Metric::unavailable('collected', $label, Metric::BASIS_PERIOD, $definition, 'Your Billing profile does not show receipts.');
        }

        $books = (new BooksClient())->withSession($this->auth->sesKey());
        $register = new RegisterReader($this->ctx, $books);
        $reading = $register->read(BooksClient::VCH_RECEIPT, $period->from, $period->to);
        $total = RegisterReader::total($reading);

        if ($total === null) {
            return Metric::unavailable(
                'collected',
                $label,
                Metric::BASIS_PERIOD,
                $definition,
                $reading['available']
                    ? 'There are more receipts in this period than can be totalled in one read. Narrow the dates.'
                    : (string) ($reading['reason'] ?? 'Smart Books did not answer.'),
            );
        }

        $previous = $register->read(BooksClient::VCH_RECEIPT, $period->previousFrom, $period->previousTo);

        return Metric::ready(
            'collected',
            $label,
            $total,
            Metric::BASIS_PERIOD,
            $definition,
            Metric::compare($total, RegisterReader::total($previous), $period->previousLabel, riseIsGood: true),
            'positive',
        );
    }

    /**
     * Five buckets plus one for bills with no due date, in reading order.
     *
     * @param array<string, mixed> $receivables
     * @return list<array<string, mixed>>
     */
    private function ageingBuckets(array $receivables): array
    {
        $labels = [
            'current'     => ['Not yet due', 'ok'],
            '1_30'        => ['1–30 days overdue', 'warning'],
            '31_60'       => ['31–60 days overdue', 'warning'],
            '61_90'       => ['61–90 days overdue', 'danger'],
            '90_plus'     => ['Over 90 days overdue', 'danger'],
            'no_due_date' => ['No due date recorded', 'neutral'],
        ];

        $total = (float) $receivables['total'];
        $out = [];
        foreach ($labels as $key => [$label, $tone]) {
            $amount = (float) ($receivables['ageing'][$key] ?? 0);
            // A bucket that is empty AND unexceptional is noise; an empty
            // "no due date" bucket is the normal, healthy case and is dropped.
            if ($key === 'no_due_date' && $amount <= 0) {
                continue;
            }
            $out[] = [
                'key'     => $key,
                'label'   => $label,
                'tone'    => $tone,
                'amount'  => round($amount, 2),
                'share'   => $total > 0 ? round($amount / $total * 100, 1) : 0.0,
            ];
        }

        return $out;
    }

    /**
     * Who to ring, worst first.
     *
     * @param array<string, mixed> $receivables
     * @return list<array<string, mixed>>
     */
    private function priorityQueue(array $receivables): array
    {
        $parties = array_values(array_filter(
            $receivables['parties'],
            static fn (array $party) => $party['overdue'] > 0,
        ));
        usort($parties, static fn (array $a, array $b) => $b['overdue'] <=> $a['overdue']);

        $oldestBill = [];
        foreach ($receivables['bills'] as $bill) {
            $accountId = (int) $bill['account_id'];
            if ($bill['days_overdue'] <= 0) {
                continue;
            }
            if (!isset($oldestBill[$accountId]) || $bill['days_overdue'] > $oldestBill[$accountId]['days_overdue']) {
                $oldestBill[$accountId] = $bill;
            }
        }

        $out = [];
        foreach (array_slice($parties, 0, 10) as $party) {
            $accountId = (int) $party['account_id'];
            $bill = $oldestBill[$accountId] ?? null;
            $out[] = [
                'account_id'   => $accountId,
                'account_name' => $party['account_name'],
                'overdue'      => $party['overdue'],
                'total'        => $party['total'],
                'bill_count'   => $party['bill_count'],
                'days_overdue' => $party['oldest_overdue_days'],
                'oldest_bill_no' => $bill['bill_no'] ?? null,
                'oldest_bill_due' => $bill['due_date'] ?? null,
            ];
        }

        return $out;
    }

    /**
     * Where the overdue money actually is.
     *
     * Plain arithmetic, stated as arithmetic. There is no model behind this and
     * no confidence score attached to it: it is the share of the overdue total
     * held by the three largest debtors, which is a fact about the rows and can
     * be checked by adding them up.
     *
     * @param array<string, mixed> $receivables
     * @return array<string, mixed>|null
     */
    private function followUpPriorities(array $receivables): ?array
    {
        $overdueTotal = (float) $receivables['overdue'];
        if ($overdueTotal <= 0) {
            return null;
        }

        $parties = array_values(array_filter(
            $receivables['parties'],
            static fn (array $party) => $party['overdue'] > 0,
        ));
        usort($parties, static fn (array $a, array $b) => $b['overdue'] <=> $a['overdue']);

        $top = array_slice($parties, 0, 3);
        $concentrated = 0.0;
        $names = [];
        foreach ($top as $party) {
            $concentrated += (float) $party['overdue'];
            $names[] = (string) $party['account_name'];
        }

        return [
            'count'       => count($top),
            'names'       => $names,
            'amount'      => round($concentrated, 2),
            'share'       => round($concentrated / $overdueTotal * 100, 0),
            'total_overdue' => round($overdueTotal, 2),
            'accounts'    => array_map(static fn (array $party) => [
                'account_id'   => (int) $party['account_id'],
                'account_name' => (string) $party['account_name'],
                'overdue'      => (float) $party['overdue'],
            ], $top),
            'basis'       => 'Counted from the bill-by-bill outstanding Smart Books returned for this page. '
                . 'Not a prediction — add the three figures up and they make the amount shown.',
        ];
    }

    /**
     * @param array<int, array<string, mixed>> $byAccount
     * @return array<string, mixed>
     */
    private function promises(string $today, array $byAccount): array
    {
        if (!Permissions::allows($this->ctx, $this->auth, 'receivable.view')) {
            return ['available' => false, 'reason' => 'Your Billing profile does not show what customers owe.', 'rows' => []];
        }

        return [
            'available' => true,
            'rows'      => (new PromiseService($this->ctx, $this->auth))->open($today, $byAccount),
            'note'      => 'What a customer said they would pay. Shown next to what Smart Books says is still outstanding, '
                . 'never instead of it — a promise is not a receipt.',
        ];
    }

    /**
     * Can a reminder actually be sent from here?
     *
     * Answered honestly rather than optimistically. If no delivery channel is
     * configured, the screen offers the drafted message to copy rather than a
     * Send button that quietly does nothing — a reminder the user believes went
     * out and did not is worse than no reminder feature at all.
     *
     * @return array<string, mixed>
     */
    private function reminderDelivery(): array
    {
        $channels = [];
        foreach (['email' => 'MESSAGING_EMAIL_BASE', 'whatsapp' => 'MESSAGING_WHATSAPP_BASE', 'sms' => 'MESSAGING_SMS_BASE'] as $channel => $envKey) {
            if (\Aicountly\Api\Env::get($envKey) !== '') {
                $channels[] = $channel;
            }
        }

        return [
            'configured' => $channels !== [],
            'channels'   => $channels,
            'reason'     => $channels === []
                ? 'No message delivery service is configured for this deployment, so a reminder cannot be sent from here yet. '
                    . 'You can still review the drafted message and copy it.'
                : null,
        ];
    }
}
