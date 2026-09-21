<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

/**
 * Reading Books' answers without pretending to know their exact shape.
 *
 * Books is one product across several deployments and its register rows do not
 * all spell the same field the same way — `vch_date` here, `voucher_date`
 * there. Every dashboard in this product reads those rows, so the guessing
 * happens ONCE, here, rather than six times with six slightly different lists.
 *
 * Two rules hold throughout:
 *
 *  1. A field that is absent reads as null, never as zero. `?? 0` on a missing
 *     amount is how an unreachable service ends up on screen as a healthy
 *     ₹0.00, and a shopkeeper cannot tell that apart from a quiet day.
 *  2. Nothing here is written down. These helpers turn a live response into
 *     something a screen can render and then forget.
 */
final class BooksReadings
{
    /**
     * The first of these keys that carries a usable number.
     *
     * @param array<string, mixed> $row
     * @param list<string>         $keys
     */
    public static function number(array $row, array $keys): ?float
    {
        foreach ($keys as $key) {
            if (!array_key_exists($key, $row)) {
                continue;
            }
            $value = $row[$key];
            if (is_int($value) || is_float($value)) {
                return (float) $value;
            }
            if (is_string($value) && $value !== '' && is_numeric($value)) {
                return (float) $value;
            }
        }

        return null;
    }

    /**
     * @param array<string, mixed> $row
     * @param list<string>         $keys
     */
    public static function text(array $row, array $keys): ?string
    {
        foreach ($keys as $key) {
            $value = $row[$key] ?? null;
            if (is_string($value) && trim($value) !== '') {
                return trim($value);
            }
            if (is_int($value)) {
                return (string) $value;
            }
        }

        return null;
    }

    /**
     * @param array<string, mixed> $row
     * @param list<string>         $keys
     */
    public static function id(array $row, array $keys): ?int
    {
        foreach ($keys as $key) {
            $value = $row[$key] ?? null;
            if (is_int($value) && $value > 0) {
                return $value;
            }
            if (is_string($value) && ctype_digit($value) && (int) $value > 0) {
                return (int) $value;
            }
        }

        return null;
    }

    /**
     * A date, as Y-m-d, from whichever key carries one.
     *
     * @param array<string, mixed> $row
     * @param list<string>         $keys
     */
    public static function date(array $row, array $keys): ?string
    {
        $raw = self::text($row, $keys);
        if ($raw === null) {
            return null;
        }
        try {
            return (new \DateTimeImmutable($raw))->format('Y-m-d');
        } catch (\Throwable) {
            return null;
        }
    }

    /** The clock time on a row, when it carries one. Null means "date only". */
    public static function hour(array $row, array $keys): ?int
    {
        $raw = self::text($row, $keys);
        if ($raw === null || !str_contains($raw, ':')) {
            return null;
        }
        try {
            return (int) (new \DateTimeImmutable($raw))->format('G');
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * The rows inside one of the fleet's envelopes.
     *
     * `{data: [...]}`, `{data: {rows: [...]}}` and `{data: {items: [...]}}` all
     * appear across the estate. Anything else reads as no rows at all, which is
     * the safe answer — an empty list renders as an empty state, not as a total.
     *
     * @param array<string, mixed>|null $body
     * @return list<array<string, mixed>>
     */
    public static function rows(?array $body): array
    {
        $data = $body['data'] ?? null;
        if (is_array($data) && array_is_list($data)) {
            return array_values(array_filter($data, 'is_array'));
        }
        foreach (['rows', 'items', 'records', 'list'] as $key) {
            $nested = is_array($data) ? ($data[$key] ?? null) : null;
            if (is_array($nested) && array_is_list($nested)) {
                return array_values(array_filter($nested, 'is_array'));
            }
        }

        return [];
    }

    /**
     * How many rows the far end says exist, when it says.
     *
     * The dashboards use this to tell "there are twelve of these" apart from
     * "there are twelve of these on the page you asked for", which decides
     * whether a total may be drawn at all.
     *
     * @param array<string, mixed>|null $body
     */
    public static function total(?array $body): ?int
    {
        foreach ([$body['meta'] ?? null, $body['data'] ?? null, $body] as $source) {
            if (!is_array($source)) {
                continue;
            }
            $total = self::number($source, ['total', 'total_count', 'count', 'record_count']);
            if ($total !== null) {
                return (int) $total;
            }
        }

        return null;
    }

    // -----------------------------------------------------------------------
    // The specific readings the dashboards need
    // -----------------------------------------------------------------------

    /** @param array<string, mixed> $row */
    public static function voucherDate(array $row): ?string
    {
        return self::date($row, ['voucher_date', 'vch_date', 'date', 'transaction_date', 'bill_date', 'created_at']);
    }

    /** @param array<string, mixed> $row */
    public static function voucherHour(array $row): ?int
    {
        return self::hour($row, ['voucher_datetime', 'created_at', 'posted_at', 'vch_datetime']);
    }

    /**
     * The value of a document.
     *
     * Deliberately NOT falling back to a taxable or net figure: a register that
     * reports the pre-tax value under a key this list does not know reads as
     * "no amount", and the screen says so, rather than quietly understating a
     * day's sales by the GST on it.
     *
     * @param array<string, mixed> $row
     */
    public static function voucherAmount(array $row): ?float
    {
        return self::number($row, ['grand_total', 'total_amount', 'invoice_value', 'voucher_amount', 'amount', 'total']);
    }

    /** @param array<string, mixed> $row */
    public static function voucherNumber(array $row): ?string
    {
        return self::text($row, ['voucher_no', 'vch_no', 'bill_no', 'reference_no', 'document_no']);
    }

    /** @param array<string, mixed> $row */
    public static function voucherId(array $row): ?int
    {
        return self::id($row, ['voucher_id', 'vch_txn_id', 'txn_id', 'id']);
    }

    /** @param array<string, mixed> $row */
    public static function voucherUuid(array $row): ?string
    {
        return self::text($row, ['voucher_uuid', 'vch_uuid', 'uuid']);
    }

    /** The other side of the entry — a customer on a sale, a supplier on a bill. */
    public static function counterparty(array $row): ?string
    {
        return self::text($row, ['account_name', 'party_name', 'acc_name', 'customer_name', 'supplier_name', 'ledger_name']);
    }

    /** @param array<string, mixed> $row */
    public static function counterpartyId(array $row): ?int
    {
        return self::id($row, ['account_id', 'acc_id', 'party_account_id', 'customer_account_id', 'supplier_account_id']);
    }

    /**
     * The settlement state of a document, in Billing's words.
     *
     * A partly paid invoice must never read as Paid — that is the difference
     * between a customer who owes nothing and one who owes half, and collapsing
     * them is how a real balance gets written off by accident. When Books gives
     * a paid figure the comparison decides; when it does not, this returns null
     * and the screen shows no status rather than a guessed one.
     *
     * @param array<string, mixed> $row
     */
    public static function settlementStatus(array $row): ?string
    {
        $explicit = self::text($row, ['payment_status', 'settlement_status']);
        if ($explicit !== null) {
            return strtoupper(str_replace([' ', '-'], '_', $explicit));
        }

        $total = self::voucherAmount($row);
        $outstanding = self::number($row, ['balance', 'outstanding', 'pending_amount', 'due_amount']);
        if ($total === null || $outstanding === null) {
            return null;
        }

        if ($outstanding <= 0.005) {
            return 'PAID';
        }
        if ($outstanding + 0.005 >= $total) {
            return 'UNPAID';
        }

        return 'PARTIALLY_PAID';
    }
}
