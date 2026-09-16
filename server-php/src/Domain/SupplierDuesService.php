<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

use Aicountly\Api\Auth;
use Aicountly\Api\Clients\BooksClient;
use Aicountly\Api\Context;
use Aicountly\Api\Env;
use Aicountly\Api\Permissions;

/**
 * Dashboard 4 — "Stay ahead of supplier dues".
 *
 * The mirror of collections, with one difference that matters: RECORDING A
 * PAYMENT HERE MOVES NO MONEY. It writes a payment voucher in Books against a
 * cash or bank ledger, which is an accounting event. Nothing in this product
 * instructs a bank, and every label on this screen is worded so that nobody
 * reads "Record payment" as "pay".
 *
 * The review queue is exception-driven on purpose. Billing keeps no review
 * state for a bill that Books owns, so a bill appears here only when something
 * about it is demonstrably odd — no bill number, no bill date, or another bill
 * that looks like the same one. A clean bill is not "awaiting review"; it is
 * simply recorded, and putting it in a queue would invent work.
 */
final class SupplierDuesService
{
    /** How far back a duplicate is worth looking for. Longer than any sane payment run. */
    private const REVIEW_WINDOW_DAYS = 45;

    public function __construct(
        private readonly Context $ctx,
        private readonly Auth $auth,
    ) {
    }

    /** @return array<string, mixed> */
    public function build(Period $period): array
    {
        $today = $period->today();
        $dueWindowEnd = $period->windowEnd(7);
        $dues = new DuesService($this->ctx, $this->auth);
        $payables = $dues->tryPayables(['as_on' => $today]);

        $metrics = [];
        if ($payables === null) {
            foreach ([
                ['to_pay', 'To pay', Metric::BASIS_AS_OF, 'What is still owed to suppliers as at ' . $today . '.'],
                ['due_soon', 'Due in seven days', Metric::BASIS_WINDOW, 'Supplier bills falling due between ' . $today . ' and ' . $dueWindowEnd . '.'],
                ['overdue', 'Overdue', Metric::BASIS_AS_OF, 'The part already past its due date as at ' . $today . '.'],
            ] as [$id, $label, $basis, $definition]) {
                $metrics[] = Metric::unavailable($id, $label, $basis, $definition, 'Smart Books did not answer.');
            }
        } else {
            $metrics[] = Metric::ready(
                'to_pay',
                'To pay',
                $payables['total'],
                Metric::BASIS_AS_OF,
                'What is still owed to suppliers as at ' . $today . ', bill by bill, after every payment allocated to date.',
                null,
                'neutral',
                ['detail' => count($payables['bills']) . ' bill(s) across ' . count($payables['parties']) . ' supplier(s)'],
            );
            $metrics[] = Metric::ready(
                'due_soon',
                'Due in seven days',
                $payables['due_this_week'],
                Metric::BASIS_WINDOW,
                'Supplier bills falling due from ' . $today . ' up to and including ' . $dueWindowEnd . ', in ' . $period->timezone . '.',
                null,
                'neutral',
            );
            $metrics[] = Metric::ready(
                'overdue',
                'Overdue',
                $payables['overdue'],
                Metric::BASIS_AS_OF,
                'The part of what you owe that is already past its due date, as at ' . $today . '.',
                null,
                $payables['overdue'] > 0 ? 'danger' : 'neutral',
            );
        }

        $review = $this->reviewQueue($period, $today);
        $metrics[] = Metric::ready(
            'to_review',
            'Bills needing a look',
            $review['available'] ? count($review['rows']) : null,
            Metric::BASIS_COUNT,
            'Purchase bills recorded in the last ' . self::REVIEW_WINDOW_DAYS . ' days where Billing found something odd — '
                . 'no bill number, no bill date, or another bill that looks like the same one. A bill with none of those is not listed.',
            null,
            ($review['available'] && $review['rows'] !== []) ? 'warning' : 'neutral',
        );

        return [
            'period'  => $period->describe(),
            'metrics' => $metrics,
            'panels'  => [
                'upcoming'    => $payables !== null ? $this->upcoming($payables, $today, $dueWindowEnd) : ['available' => false, 'reason' => 'Smart Books did not answer.', 'days' => []],
                'review'      => $review,
                'cash_impact' => $payables !== null
                    ? [
                        'available' => true,
                        'amount'    => $payables['due_this_week'],
                        'basis'     => 'Supplier bills falling due between ' . $today . ' and ' . $dueWindowEnd . '. '
                            . 'What you plan to pay, not what has been paid.',
                    ]
                    : ['available' => false, 'reason' => 'Smart Books did not answer.'],
                'upload'      => $this->uploadCapability(),
                'can_record_payment' => Permissions::allows($this->ctx, $this->auth, 'payment.create'),
                'can_add_purchase'   => Permissions::allows($this->ctx, $this->auth, 'purchase.create'),
                'can_debit_note'     => Permissions::allows($this->ctx, $this->auth, 'debit_note.create'),
            ],
            'note' => $payables['note'] ?? null,
            'generated_at' => gmdate('c'),
        ];
    }

    /**
     * What falls due in the next week, by day.
     *
     * @param array<string, mixed> $payables
     * @return array<string, mixed>
     */
    private function upcoming(array $payables, string $today, string $windowEnd): array
    {
        $byDate = [];
        foreach ($payables['bills'] as $bill) {
            $due = $bill['due_date'];
            if ($due === null || $due < $today || $due > $windowEnd) {
                continue;
            }
            $byDate[$due] ??= ['date' => $due, 'amount' => 0.0, 'bills' => []];
            $byDate[$due]['amount'] += (float) $bill['balance'];
            $byDate[$due]['bills'][] = [
                'account_id'   => $bill['account_id'],
                'account_name' => $bill['account_name'],
                'bill_no'      => $bill['bill_no'],
                'balance'      => $bill['balance'],
            ];
        }

        ksort($byDate);

        return [
            'available' => true,
            'days'      => array_map(static function (array $day) {
                $day['amount'] = round($day['amount'], 2);

                return $day;
            }, array_values($byDate)),
            'basis'     => 'Bills due from ' . $today . ' to ' . $windowEnd . ', at the balance still unpaid.',
        ];
    }

    /**
     * Purchase bills with something demonstrably wrong with them.
     *
     * Duplicate detection is deterministic and conservative. Two bills are
     * flagged as possibly the same when they are from the same supplier and
     * either carry the same bill number, or carry the same amount within a few
     * days of each other. Both are REVIEW SIGNALS and neither is proof: a
     * supplier who delivers the same order weekly produces the second pattern
     * honestly, which is exactly why nothing is blocked or merged automatically.
     *
     * @return array<string, mixed>
     */
    private function reviewQueue(Period $period, string $today): array
    {
        if (!Permissions::allows($this->ctx, $this->auth, 'purchase.view')) {
            return ['available' => false, 'reason' => 'Your Billing profile does not show purchases.', 'rows' => []];
        }

        $from = (new \DateTimeImmutable($today))->modify('-' . self::REVIEW_WINDOW_DAYS . ' days')->format('Y-m-d');
        $books = (new BooksClient())->withSession($this->auth->sesKey());
        $reading = (new RegisterReader($this->ctx, $books))->read(BooksClient::VCH_PURCHASE, $from, $today);

        if (!$reading['available']) {
            return ['available' => false, 'reason' => (string) ($reading['reason'] ?? 'Smart Books did not answer.'), 'rows' => []];
        }

        $bills = [];
        foreach ($reading['rows'] as $row) {
            $bills[] = [
                'voucher_id'   => BooksReadings::voucherId($row),
                'voucher_uuid' => BooksReadings::voucherUuid($row),
                'supplier'     => BooksReadings::counterparty($row),
                'supplier_id'  => BooksReadings::counterpartyId($row),
                // The supplier's own number and date, and ONLY those. Falling
                // back to the voucher date here would mean every bill had one,
                // and "we recorded it on the 12th" is not "they dated it the
                // 9th" — which is the field a GST return actually wants.
                'bill_no'      => BooksReadings::text($row, ['supplier_invoice_no', 'supplier_bill_no']),
                'bill_date'    => BooksReadings::date($row, ['supplier_invoice_date', 'supplier_bill_date']),
                'recorded_on'  => BooksReadings::voucherDate($row),
                'amount'       => BooksReadings::voucherAmount($row),
                'document_no'  => BooksReadings::voucherNumber($row),
                'flags'        => [],
            ];
        }

        // Same supplier, same bill number.
        $byNumber = [];
        // Same supplier, same amount, close together in time.
        $byAmount = [];
        foreach ($bills as $index => $bill) {
            $supplier = self::normaliseSupplier($bill['supplier'], $bill['supplier_id']);
            if ($bill['bill_no'] !== null) {
                $byNumber[$supplier . '|' . self::normaliseNumber($bill['bill_no'])][] = $index;
            }
            if ($bill['amount'] !== null) {
                $byAmount[$supplier . '|' . number_format($bill['amount'], 2, '.', '')][] = $index;
            }
        }

        foreach ($byNumber as $indexes) {
            if (count($indexes) < 2) {
                continue;
            }
            foreach ($indexes as $index) {
                $bills[$index]['flags'][] = [
                    'code'   => 'duplicate_number',
                    'tone'   => 'warning',
                    'label'  => 'Possible duplicate',
                    'detail' => 'Another bill from this supplier carries the same bill number.',
                    'peers'  => array_values(array_diff($indexes, [$index])),
                ];
            }
        }

        foreach ($byAmount as $indexes) {
            if (count($indexes) < 2) {
                continue;
            }
            foreach ($indexes as $index) {
                $near = [];
                foreach ($indexes as $other) {
                    if ($other === $index) {
                        continue;
                    }
                    if (self::daysApart($bills[$index]['bill_date'] ?? $bills[$index]['recorded_on'], $bills[$other]['bill_date'] ?? $bills[$other]['recorded_on']) <= 7) {
                        $near[] = $other;
                    }
                }
                if ($near === [] || self::hasFlag($bills[$index], 'duplicate_number')) {
                    continue;
                }
                $bills[$index]['flags'][] = [
                    'code'   => 'duplicate_amount',
                    'tone'   => 'warning',
                    'label'  => 'Possible duplicate',
                    'detail' => 'Another bill from this supplier is for the same amount within a week. This may be genuine — compare them before deciding.',
                    'peers'  => $near,
                ];
            }
        }

        foreach ($bills as $index => $bill) {
            if ($bill['bill_date'] === null) {
                $bills[$index]['flags'][] = [
                    'code' => 'missing_bill_date', 'tone' => 'warning',
                    'label' => 'Missing bill date', 'detail' => 'The supplier\'s own invoice date is not recorded.', 'peers' => [],
                ];
            }
            if ($bill['bill_no'] === null) {
                $bills[$index]['flags'][] = [
                    'code' => 'missing_bill_no', 'tone' => 'warning',
                    'label' => 'Missing bill number', 'detail' => 'The supplier\'s own invoice number is not recorded.', 'peers' => [],
                ];
            }
        }

        $flagged = [];
        foreach ($bills as $index => $bill) {
            if ($bill['flags'] === []) {
                continue;
            }
            $bill['peer_bills'] = [];
            foreach ($bill['flags'] as $flag) {
                foreach ($flag['peers'] as $peer) {
                    $bill['peer_bills'][] = [
                        'voucher_id'  => $bills[$peer]['voucher_id'],
                        'document_no' => $bills[$peer]['document_no'],
                        'bill_no'     => $bills[$peer]['bill_no'],
                        'bill_date'   => $bills[$peer]['bill_date'],
                        'amount'      => $bills[$peer]['amount'],
                    ];
                }
            }
            $bill['row_key'] = 'bill-' . $index;
            $flagged[] = $bill;
        }

        usort($flagged, static fn (array $a, array $b) => ($b['recorded_on'] ?? '') <=> ($a['recorded_on'] ?? ''));

        return [
            'available' => true,
            'reason'    => null,
            'rows'      => array_slice($flagged, 0, 20),
            'examined'  => count($bills),
            'complete'  => $reading['complete'],
            'basis'     => 'Purchase bills recorded between ' . $from . ' and ' . $today . ', read from Smart Books just now.'
                . ($reading['complete'] ? '' : ' More bills exist in this window than could be read at once, so a duplicate may be missed.'),
        ];
    }

    /**
     * Whether a supplier bill can be uploaded and read automatically.
     *
     * There is no document-extraction service in this deployment, and inventing
     * one here would mean either a second OCR stack or a model guessing at
     * totals. So the answer is no, said plainly, with the manual path — which
     * works — offered instead of a button that appears to do something.
     *
     * @return array<string, mixed>
     */
    private function uploadCapability(): array
    {
        $configured = Env::get('DOCUMENT_EXTRACTION_BASE') !== '';

        return [
            'available'    => $configured,
            'can_add'      => Permissions::allows($this->ctx, $this->auth, 'purchase.create'),
            'manual_path'  => '/purchases/new',
            'reason'       => $configured
                ? null
                : 'Reading a bill from a PDF or photo needs a document-extraction service, and none is configured for this '
                    . 'deployment. Entering the bill by hand records exactly the same thing.',
        ];
    }

    /** @param array<string, mixed> $bill */
    private static function hasFlag(array $bill, string $code): bool
    {
        foreach ($bill['flags'] as $flag) {
            if ($flag['code'] === $code) {
                return true;
            }
        }

        return false;
    }

    private static function daysApart(?string $a, ?string $b): int
    {
        if ($a === null || $b === null) {
            return PHP_INT_MAX;
        }
        try {
            return (int) (new \DateTimeImmutable($a))->diff(new \DateTimeImmutable($b))->format('%a');
        } catch (\Throwable) {
            return PHP_INT_MAX;
        }
    }

    /** An account id when there is one; otherwise the name, flattened. */
    private static function normaliseSupplier(?string $name, ?int $id): string
    {
        if ($id !== null) {
            return 'acc:' . $id;
        }

        return 'name:' . preg_replace('/[^a-z0-9]/', '', strtolower((string) $name));
    }

    /** MD-7812, md 7812 and MD/7812 are the same bill number written three ways. */
    private static function normaliseNumber(string $number): string
    {
        return (string) preg_replace('/[^a-z0-9]/', '', strtolower($number));
    }
}
