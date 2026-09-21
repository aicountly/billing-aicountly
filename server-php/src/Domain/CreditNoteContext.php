<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

use Aicountly\Api\Clients\BooksClient;
use Aicountly\Api\Context;

/**
 * What the credit note screen needs to know about the invoice it is crediting.
 *
 * Three readings, all live from Smart Books on the request that draws them:
 *
 *   outstanding()  how much of each of a customer's invoices is still unpaid,
 *                  so the invoice picker can show it next to the value.
 *   invoice()      one invoice WITH ITS LINES, so the note can start from what
 *                  was actually billed instead of asking somebody to find the
 *                  paper and retype it.
 *   trend()        how many credit notes this month against the month before.
 *
 * Nothing here is written down. Books owns the invoice, its lines, its tax and
 * its balance; this class turns one of its answers into the shape a screen can
 * render and then forgets it. In particular there is NO tax computed here and
 * no eligible-quantity ledger kept anywhere in Billing — the invoice quantity
 * is reported as Books states it, and Books remains the authority on what may
 * actually be credited when the note is posted.
 *
 * Every reading degrades to "not available, and here is why" rather than to a
 * zero: an invoice whose lines cannot be read still lets a person raise the
 * note by picking the items by hand, which is what the screen did before.
 */
final class CreditNoteContext
{
    /**
     * Where a voucher's line items might live, across Books' deployments.
     *
     * Deliberately NOT including `entries` or `ledger_entries`: those are the
     * accounting legs of the voucher, and reading a debit line as a returnable
     * item would put "Output CGST 9%" in a list of goods coming back.
     *
     * @var list<string>
     */
    private const LINE_CONTAINERS = [
        'inventory_lines',
        'service_lines',
        'lines',
        'items',
        'line_items',
        'voucher_lines',
        'invoice_lines',
    ];

    public function __construct(
        private readonly Context $ctx,
        private readonly BooksClient $books,
    ) {
    }

    /**
     * Outstanding per invoice for one customer, keyed both ways.
     *
     * Keyed by voucher id AND by document number because the bill-by-bill
     * report identifies a bill by its number in some deployments and by its
     * voucher id in others, and the register we match it against carries both.
     *
     * @return array{available:bool, by_voucher:array<int,float>, by_number:array<string,float>}
     */
    public function outstanding(int $partyAccountId, string $partyType = 'debtor'): array
    {
        $response = $this->books->billByBill($this->ctx, [
            'party_type' => $partyType,
            'account_id' => $partyAccountId,
        ]);

        if (!$response['ok']) {
            // The invoice list is still perfectly usable without it, so this is
            // a missing column and not a failed request.
            return ['available' => false, 'by_voucher' => [], 'by_number' => []];
        }

        $byVoucher = [];
        $byNumber = [];
        foreach (BooksReadings::rows($response['body']) as $row) {
            $balance = BooksReadings::number($row, ['balance', 'outstanding', 'pending_amount', 'due_amount']);
            if ($balance === null) {
                continue;
            }
            $voucherId = BooksReadings::voucherId($row);
            if ($voucherId !== null) {
                $byVoucher[$voucherId] = round(($byVoucher[$voucherId] ?? 0) + $balance, 2);
            }
            $number = BooksReadings::voucherNumber($row);
            if ($number !== null) {
                $byNumber[$number] = round(($byNumber[$number] ?? 0) + $balance, 2);
            }
        }

        return ['available' => true, 'by_voucher' => $byVoucher, 'by_number' => $byNumber];
    }

    /**
     * One invoice and the lines on it.
     *
     * `lines_available` is the field the screen reads first. False means Books
     * answered but this voucher's lines were not in a shape we could be sure
     * about — the note is then raised by picking items, exactly as before, and
     * the screen says why rather than showing an empty table that looks broken.
     *
     * @return array<string, mixed>
     */
    public function invoice(int $voucherId): array
    {
        $response = $this->books->voucher($this->ctx, $voucherId);
        if (!$response['ok']) {
            return [
                'voucher_id'      => $voucherId,
                'available'       => false,
                'reason'          => $response['status'] === 404
                    ? 'Smart Books does not have that invoice.'
                    : 'Smart Books did not answer for that invoice.',
                'lines_available' => false,
                'lines'           => [],
            ];
        }

        $body = $response['body'] ?? [];
        $voucher = is_array($body['data'] ?? null) ? $body['data'] : $body;
        $lines = self::linesOf($voucher);

        return [
            'voucher_id'      => BooksReadings::voucherId($voucher) ?? $voucherId,
            'voucher_uuid'    => BooksReadings::voucherUuid($voucher),
            'document_no'     => BooksReadings::voucherNumber($voucher),
            'date'            => BooksReadings::voucherDate($voucher),
            'party'           => BooksReadings::counterparty($voucher),
            'party_id'        => BooksReadings::counterpartyId($voucher),
            'amount'          => BooksReadings::voucherAmount($voucher),
            'status'          => BooksReadings::settlementStatus($voucher),
            'available'       => true,
            'reason'          => null,
            'lines_available' => $lines !== [],
            'lines'           => $lines,
            'note'            => $lines === []
                ? 'Smart Books returned this invoice without item lines that could be read. Add the items being returned yourself.'
                : 'Read from Smart Books just now. Smart Books decides what may still be credited when the note is posted.',
        ];
    }

    /**
     * Credit notes raised this month, against the window before it.
     *
     * Counted from Books' own credit note register, and reported only when the
     * page proves it held everything — an incomplete page gives a count that
     * is believable and short, which is worse than no count at all.
     *
     * @return array<string, mixed>
     */
    public function trend(): array
    {
        $period = Period::resolve(['key' => 'month']);

        $current = $this->countBetween($period->from, $period->to);
        $previous = $this->countBetween($period->previousFrom, $period->previousTo);

        if ($current === null) {
            return [
                'available' => false,
                'reason'    => 'Smart Books could not be read for this month’s credit notes.',
            ];
        }

        return [
            'available'      => true,
            'reason'         => null,
            'label'          => $period->label,
            'from'           => $period->from,
            'to'             => $period->to,
            'count'          => $current['count'],
            'value'          => $current['value'],
            'previous_label' => $period->previousLabel,
            'previous_count' => $previous['count'] ?? null,
            'series'         => $current['series'],
            'source'         => 'books',
        ];
    }

    /**
     * How many credit notes fall in a window, and what they came to.
     *
     * @return array{count:int, value:?float, series:list<array{label:string, count:int}>}|null
     */
    private function countBetween(string $from, string $to): ?array
    {
        $reading = (new RegisterReader($this->ctx, $this->books))->read(BooksClient::VCH_CREDIT_NOTE, $from, $to);
        if (!$reading['available'] || !$reading['complete']) {
            return null;
        }

        $rows = $reading['rows'];
        $buckets = [0, 0, 0, 0];
        foreach ($rows as $row) {
            $date = BooksReadings::voucherDate($row);
            if ($date === null) {
                continue;
            }
            // Four buckets across the window, so the sparkline is this window's
            // own shape rather than a fixed calendar week that may be empty.
            $day = (int) substr($date, 8, 2);
            $buckets[min(3, intdiv(max(1, $day) - 1, 8))]++;
        }

        return [
            'count'  => count($rows),
            'value'  => RegisterReader::total($reading),
            'series' => [
                ['label' => '1–8', 'count' => $buckets[0]],
                ['label' => '9–16', 'count' => $buckets[1]],
                ['label' => '17–24', 'count' => $buckets[2]],
                ['label' => '25+', 'count' => $buckets[3]],
            ],
        ];
    }

    /**
     * The item lines on a voucher, from whichever key holds them.
     *
     * A row has to carry a quantity or an amount AND something to call it
     * before it is treated as a line; anything else is a shape we did not
     * recognise, and guessing at it would put nonsense in the table.
     *
     * Public because it is a pure normaliser with no dependencies, and the
     * shapes it has to survive are the part of this class worth a test.
     *
     * @param array<string, mixed> $voucher
     * @return list<array<string, mixed>>
     */
    public static function linesOf(array $voucher): array
    {
        $lines = [];
        $lineNo = 0;

        foreach (self::LINE_CONTAINERS as $container) {
            $rows = $voucher[$container] ?? null;
            if (!is_array($rows) || !array_is_list($rows)) {
                continue;
            }

            foreach ($rows as $row) {
                if (!is_array($row)) {
                    continue;
                }

                $qty = BooksReadings::number($row, ['qty', 'quantity', 'bill_qty', 'item_qty', 'billed_qty']);
                $amount = BooksReadings::number($row, ['amount', 'line_amount', 'taxable_value', 'net_amount', 'value']);
                $name = BooksReadings::text($row, [
                    'item_name', 'itm_name', 'product_name', 'name', 'description', 'particulars',
                ]);
                $itemId = BooksReadings::id($row, ['item_id', 'itm_id', 'product_id']);

                if (($qty === null && $amount === null) || ($name === null && $itemId === null)) {
                    continue;
                }

                $lineNo++;
                $lines[] = [
                    'line_ref'     => BooksReadings::text($row, ['source_line_ref', 'line_no', 'line_number', 'sr_no'])
                        ?? (string) $lineNo,
                    'item_id'      => $itemId,
                    'item_name'    => $name,
                    'sku'          => BooksReadings::text($row, ['item_sku', 'sku', 'item_code', 'code']),
                    'hsn_sac'      => BooksReadings::text($row, ['hsn_sac', 'hsn', 'hsn_code', 'sac']),
                    'unit_id'      => BooksReadings::id($row, ['unit_id', 'uom_id']),
                    'unit_name'    => BooksReadings::text($row, ['unit_name', 'uom', 'uom_name', 'unit']),
                    'warehouse_id' => BooksReadings::id($row, ['mc_id', 'warehouse_id', 'wh_id', 'store_id']),
                    'batch_id'     => BooksReadings::id($row, ['batch_id']),
                    'batch_no'     => BooksReadings::text($row, ['batch_no', 'batch', 'batch_name', 'lot_no']),
                    'qty'          => $qty,
                    'rate'         => BooksReadings::number($row, ['rate', 'unit_rate', 'price', 'unit_price']),
                    'discount_pc'  => BooksReadings::number($row, ['discount_pc', 'discount_percent', 'disc_pc', 'discount_percentage']),
                    'amount'       => $amount,
                    'tax_cat_id'   => BooksReadings::id($row, ['tax_cat_id', 'tax_category_id', 'taxcat_id']),
                    'tax_rate'     => BooksReadings::number($row, ['tax_rate', 'gst_rate', 'tax_percent', 'tax_percentage']),
                    // A line Books reported without an item is a service or a
                    // described charge: creditable, but never stock coming back.
                    'stockable'    => $itemId !== null,
                ];
            }
        }

        return $lines;
    }
}
