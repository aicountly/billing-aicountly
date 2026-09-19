<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

use Aicountly\Api\Clients\BooksClient;
use Aicountly\Api\Context;

/**
 * Books' voucher register, read live and turned into the shapes screens want.
 *
 * Every list of documents in this product — today's bills, this month's
 * collections, the supplier bills awaiting a look — is this register. Billing
 * has no invoice table to read instead, which is the entire point: what the
 * dashboard shows and what the accounts say cannot drift apart when they are
 * the same rows.
 *
 * THE TRUNCATION RULE
 *
 * A register call returns a page. Summing a page and calling it a month's sales
 * is the single easiest way to put a confidently wrong number in front of an
 * owner, and it fails silently: the figure looks plausible, it is just short by
 * whatever did not fit. So a total is produced only when this class can show
 * the page held everything, and `total()` returns null otherwise. The screen
 * then says the figure is unavailable, which is annoying and true, rather than
 * low and believable.
 */
final class RegisterReader
{
    /** One page, big enough for a small business's month, small enough to be a sane request. */
    private const PAGE = 500;

    public function __construct(
        private readonly Context $ctx,
        private readonly BooksClient $books,
    ) {
    }

    /**
     * @param array<string, mixed> $filters
     * @return array{available:bool, reason:?string, rows:list<array<string,mixed>>, complete:bool, reported_total:?int}
     */
    public function read(int $voucherTypeId, string $from, string $to, array $filters = []): array
    {
        $response = $this->books->registers($this->ctx, [
            'vch_type_id' => $voucherTypeId,
            'from'        => $from,
            'to'          => $to,
            'limit'       => self::PAGE,
            'offset'      => 0,
        ] + $filters);

        if (!$response['ok']) {
            return [
                'available'      => false,
                'reason'         => 'Smart Books did not answer for this period.',
                'rows'           => [],
                'complete'       => false,
                'reported_total' => null,
            ];
        }

        $rows = BooksReadings::rows($response['body']);
        $reported = BooksReadings::total($response['body']);

        // Complete when the far end agrees we have everything, or when a short
        // page proves it. A full page with no stated total might be all of it or
        // might be the first of nine, and "might be" is not good enough to add up.
        $complete = $reported !== null
            ? count($rows) >= $reported
            : count($rows) < self::PAGE;

        return [
            'available'      => true,
            'reason'         => null,
            'rows'           => $rows,
            'complete'       => $complete,
            'reported_total' => $reported,
        ];
    }

    /**
     * The sum of a register, or null when the page did not hold all of it.
     *
     * @param array{available:bool, rows:list<array<string,mixed>>, complete:bool} $reading
     */
    public static function total(array $reading): ?float
    {
        if (!$reading['available'] || !$reading['complete']) {
            return null;
        }

        $sum = 0.0;
        foreach ($reading['rows'] as $row) {
            $amount = BooksReadings::voucherAmount($row);
            if ($amount === null) {
                // One unreadable row makes the total wrong by that row. Better
                // to have no total than a quietly short one.
                return null;
            }
            $sum += $amount;
        }

        return round($sum, 2);
    }

    /**
     * A day-by-day series over the window, with every day present.
     *
     * Days with nothing on them are zeros rather than gaps: a line that skips
     * Sunday draws a straight segment across it and makes a closed shop look
     * like a slow-but-open one.
     *
     * @param array{available:bool, rows:list<array<string,mixed>>, complete:bool} $reading
     * @return array<string, float>|null  date => amount, or null if it cannot be totalled
     */
    public static function daily(array $reading, Period $period): ?array
    {
        if (!$reading['available'] || !$reading['complete']) {
            return null;
        }

        $series = array_fill_keys($period->eachDay(), 0.0);
        foreach ($reading['rows'] as $row) {
            $date = BooksReadings::voucherDate($row);
            $amount = BooksReadings::voucherAmount($row);
            if ($date === null || $amount === null || !array_key_exists($date, $series)) {
                continue;
            }
            $series[$date] += $amount;
        }

        return array_map(static fn (float $value) => round($value, 2), $series);
    }

    /**
     * The register as rows a table can render.
     *
     * @param array{rows:list<array<string,mixed>>} $reading
     * @return list<array<string, mixed>>
     */
    public static function documents(array $reading, int $limit = 10): array
    {
        $rows = [];
        foreach ($reading['rows'] as $row) {
            $documentNo = BooksReadings::voucherNumber($row);
            $reference = BooksReadings::instrumentNo($row);

            $rows[] = [
                'voucher_id'   => BooksReadings::voucherId($row),
                'voucher_uuid' => BooksReadings::voucherUuid($row),
                'document_no'  => $documentNo,
                'date'         => BooksReadings::voucherDate($row),
                'party'        => BooksReadings::counterparty($row),
                'party_id'     => BooksReadings::counterpartyId($row),
                'amount'       => BooksReadings::voucherAmount($row),
                'status'       => BooksReadings::settlementStatus($row),

                // How the money moved, what it was referenced by, and where it
                // landed. Additive and nullable: a register that does not carry
                // them leaves them null and the screen shows a dash, which is
                // the same rule the rest of this class follows. The reference is
                // dropped when it is only the document number under another
                // name — repeating the receipt number in a "Reference" column
                // reads as a UTR that was never recorded.
                'payment_mode' => BooksReadings::paymentMode($row),
                'reference_no' => $reference === $documentNo ? null : $reference,
                'received_in'  => BooksReadings::settlementAccount($row),
            ];
        }

        usort($rows, static fn (array $a, array $b) => ($b['date'] ?? '') <=> ($a['date'] ?? ''));

        return array_slice($rows, 0, $limit);
    }
}
