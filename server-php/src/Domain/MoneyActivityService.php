<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

use Aicountly\Api\Auth;
use Aicountly\Api\Clients\BooksClient;
use Aicountly\Api\Context;
use Aicountly\Api\Db;
use Aicountly\Api\Permissions;

/**
 * What has actually been paid out (or taken in), for the screen that records it.
 *
 * The money screens used to be a form and nothing else: you typed a payment,
 * it went to Books, and the screen forgot it. This is the context that was
 * missing — the period's total, and the last few entries — and the whole point
 * of it is WHERE EACH FIGURE COMES FROM.
 *
 *   The list and the totals are BOOKS' REGISTER, read on this request. There is
 *   no billing_payments table and this class does not create one. A recent-list
 *   of our own would be a second answer to "what did we pay?", and the two
 *   would part company the first time somebody recorded a payment in Books.
 *
 *   The mode, the reference, the narration, which account it came out of and
 *   who keyed it are BILLING'S OWN, from the request row we already wrote when
 *   the user pressed Save. Books' register does not carry them. They are joined
 *   on to the register row by the voucher id Books gave us, so a payment made
 *   in Books shows with those cells empty rather than not showing at all.
 *
 * THE TRUNCATION RULE APPLIES HERE TOO. RegisterReader refuses to total a page
 * it cannot prove is the whole set, and a summary built on a short page would
 * be low and believable — the worst kind of wrong. When the reading is
 * incomplete every figure in the summary is null and the screen says so.
 */
final class MoneyActivityService
{
    /**
     * direction => [voucher type, permission, request kinds, plain name]
     *
     * Two kinds map to money out: a payment to a supplier and an expense. Both
     * are a payment voucher in Books, so both appear in this register, and the
     * enrichment has to look for either or an expense row loses its reference.
     *
     * @var array<string, array{0:int, 1:string, 2:list<string>, 3:string}>
     */
    private const DIRECTIONS = [
        'out' => [BooksClient::VCH_PAYMENT, 'payment.create', ['payment', 'expense'], 'money paid'],
        'in'  => [BooksClient::VCH_RECEIPT, 'receipt.create', ['receipt'], 'money received'],
    ];

    /** How far back "when did we last pay them?" looks. */
    private const PARTY_LOOKBACK_DAYS = 180;

    public function __construct(
        private readonly Context $ctx,
        private readonly Auth $auth,
    ) {
    }

    public static function isDirection(string $direction): bool
    {
        return isset(self::DIRECTIONS[$direction]);
    }

    /**
     * The period's entries and what they add up to.
     *
     * Deliberately NOT a 503 when Books cannot be reached. The form on this
     * screen still works without the register — a user who came here to record
     * a payment should be able to, and be told the context is missing, rather
     * than meet an error page instead of the form.
     *
     * @return array<string, mixed>
     */
    public function recent(string $direction, Period $period, int $limit): array
    {
        [$vchTypeId, $permission, , $label] = self::DIRECTIONS[$direction];
        Permissions::assert($this->ctx, $this->auth, $permission);

        $books = (new BooksClient())->withSession($this->auth->sesKey());
        $reader = new RegisterReader($this->ctx, $books);
        $reading = $reader->read($vchTypeId, $period->from, $period->to);

        if (!$reading['available']) {
            return [
                'direction' => $direction,
                'period'    => self::periodShape($period),
                'available' => false,
                'reason'    => 'Smart Books did not answer for this period. Your entry will still save.',
                'summary'   => self::emptySummary('Smart Books did not answer for this period.'),
                'rows'      => [],
                'complete'  => false,
                'source'    => 'books',
                'note'      => 'Read from Smart Books as this screen opens. Billing keeps no copy.',
            ];
        }

        $documents = RegisterReader::documents($reading, 500);
        $rows = $this->enrich(array_slice($documents, 0, max(1, $limit)), $direction);

        return [
            'direction' => $direction,
            'period'    => self::periodShape($period),
            'available' => true,
            'reason'    => null,
            'summary'   => $this->summarise($reading, $documents, $reader, $vchTypeId, $period, $direction),
            'rows'      => $rows,
            'complete'  => $reading['complete'],
            'source'    => 'books',
            'note'      => $reading['complete']
                ? 'Read from Smart Books as this screen opened. Billing keeps no copy.'
                : 'More ' . $label . ' entries exist in this period than could be read at once, so the totals are not shown.',
        ];
    }

    /**
     * When this party was last paid, and how much.
     *
     * Used for one sentence on the screen, so it is held to the same standard
     * as a figure: read from Books, over a stated window, and withheld entirely
     * when the page read could not be proved complete. A "last paid 28 days
     * ago" that is really "the oldest of the 500 rows we happened to get" is
     * worse than no sentence at all.
     *
     * @return array<string, mixed>
     */
    public function partyContext(string $direction, int $partyAccountId): array
    {
        [$vchTypeId, $permission] = self::DIRECTIONS[$direction];
        Permissions::assert($this->ctx, $this->auth, $permission);

        $to = gmdate('Y-m-d');
        $from = gmdate('Y-m-d', strtotime('-' . self::PARTY_LOOKBACK_DAYS . ' days'));

        $books = (new BooksClient())->withSession($this->auth->sesKey());
        $reading = (new RegisterReader($this->ctx, $books))->read($vchTypeId, $from, $to);

        $shape = [
            'party_account_id'  => $partyAccountId,
            'direction'         => $direction,
            'looked_back_days'  => self::PARTY_LOOKBACK_DAYS,
            'from'              => $from,
            'to'                => $to,
            'available'         => $reading['available'],
            'complete'          => $reading['complete'],
            'last'              => null,
            'entries_in_window' => null,
            'source'            => 'books',
        ];

        if (!$reading['available'] || !$reading['complete']) {
            return $shape;
        }

        // Filtered here rather than in the register call: not every deployment's
        // register takes a party filter, and one that quietly ignores it would
        // hand us somebody else's payment as this supplier's last one.
        $mine = [];
        foreach (RegisterReader::documents($reading, 500) as $document) {
            if ($document['party_id'] !== null && (int) $document['party_id'] === $partyAccountId) {
                $mine[] = $document;
            }
        }

        $shape['entries_in_window'] = count($mine);
        if ($mine === []) {
            return $shape;
        }

        // documents() already sorted newest first.
        $latest = $mine[0];
        $shape['last'] = [
            'date'        => $latest['date'],
            'amount'      => $latest['amount'],
            'document_no' => $latest['document_no'],
            'voucher_id'  => $latest['voucher_id'],
            'days_ago'    => self::daysAgo($latest['date']),
        ];

        return $shape;
    }

    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------

    /**
     * @param array{available:bool, rows:list<array<string,mixed>>, complete:bool} $reading
     * @param list<array<string, mixed>>                                           $documents
     * @return array<string, mixed>
     */
    private function summarise(
        array $reading,
        array $documents,
        RegisterReader $reader,
        int $vchTypeId,
        Period $period,
        string $direction,
    ): array {
        $total = RegisterReader::total($reading);

        if ($total === null) {
            return self::emptySummary(
                'More entries exist in this period than could be read at once, so these cannot be totalled.',
            );
        }

        $count = count($documents);
        $largest = null;
        foreach ($documents as $document) {
            if ($document['amount'] === null) {
                continue;
            }
            if ($largest === null || $document['amount'] > $largest['amount']) {
                $largest = $document;
            }
        }

        // The previous window of the same length, and only if it too can be
        // totalled honestly. A comparison against a truncated period is a
        // comparison against a number nobody vouched for.
        $previousReading = $reader->read($vchTypeId, $period->previousFrom, $period->previousTo);
        $previousTotal = $previousReading['available'] ? RegisterReader::total($previousReading) : null;

        return [
            'available' => true,
            'reason'    => null,
            'total'     => $total,
            'count'     => $count,
            'average'   => $count > 0 ? round($total / $count, 2) : null,
            'largest'   => $largest === null ? null : [
                'amount'     => $largest['amount'],
                'party'      => $largest['party'],
                'party_id'   => $largest['party_id'],
                'date'       => $largest['date'],
                'voucher_id' => $largest['voucher_id'],
            ],
            // Money going OUT rising is not good news; money coming in is. Stated
            // here rather than decided by a colour in the browser.
            'comparison' => Metric::compare($total, $previousTotal, $period->previousLabel, $direction === 'in'),
        ];
    }

    /** @return array<string, mixed> */
    private static function emptySummary(string $reason): array
    {
        return [
            'available'  => false,
            'reason'     => $reason,
            'total'      => null,
            'count'      => null,
            'average'    => null,
            'largest'    => null,
            'comparison' => null,
        ];
    }

    // -----------------------------------------------------------------------
    // Enrichment — Billing's own half of the row
    // -----------------------------------------------------------------------

    /**
     * Put back what the user typed, on the rows we were the ones to create.
     *
     * @param list<array<string, mixed>> $documents
     * @return list<array<string, mixed>>
     */
    private function enrich(array $documents, string $direction): array
    {
        $voucherIds = [];
        foreach ($documents as $document) {
            if ($document['voucher_id'] !== null) {
                $voucherIds[] = (int) $document['voucher_id'];
            }
        }

        $requests = $this->requestsByVoucher($voucherIds, $direction);
        $accountNames = $requests === [] ? [] : $this->cashBankNames();

        $rows = [];
        foreach ($documents as $document) {
            $voucherId = $document['voucher_id'] === null ? null : (int) $document['voucher_id'];
            $request = $voucherId === null ? null : ($requests[$voucherId] ?? null);
            $payload = $request === null ? [] : Db::jsonColumn($request['payload'] ?? null);

            $paidFromId = isset($payload['cash_bank_account_id']) ? (int) $payload['cash_bank_account_id'] : null;

            $rows[] = $document + [
                'request_id'      => $request === null ? null : (int) $request['request_id'],
                'kind'            => $request === null ? null : (string) $request['kind'],
                'account_id'      => $paidFromId,
                'account_name'    => $paidFromId === null ? null : ($accountNames[$paidFromId] ?? null),
                'payment_mode'    => self::stringOrNull($payload['payment_mode'] ?? null),
                'reference_no'    => self::stringOrNull($payload['instrument_no'] ?? $payload['reference_no'] ?? null),
                'narration'       => self::stringOrNull($payload['narration'] ?? null),
                'created_by'      => $request === null ? null : self::stringOrNull($request['created_by'] ?? null),
                // True when this entry was keyed in Billing. False means it was
                // recorded in Books, which is why the detail cells are empty.
                'recorded_here'   => $request !== null,
            ];
        }

        return $rows;
    }

    /**
     * @param list<int> $voucherIds
     * @return array<int, array<string, mixed>>
     */
    private function requestsByVoucher(array $voucherIds, string $direction): array
    {
        if ($voucherIds === []) {
            return [];
        }

        [$scope, $params] = $this->ctx->scopeClause();
        $kinds = self::DIRECTIONS[$direction][2];

        // Both lists are built here from values this class controls — ids cast
        // to int and kinds from the constant above — never from the request.
        $ids = implode(',', array_map('intval', array_unique($voucherIds)));
        $kindList = implode(',', array_map(
            static fn (string $kind) => "'" . preg_replace('/[^a-z_]/', '', $kind) . "'",
            $kinds,
        ));

        $rows = Db::all(
            "SELECT request_id, kind, payload, created_by, books_voucher_id
             FROM billing_transaction_requests
             WHERE {$scope} AND status = 'POSTED' AND kind IN ({$kindList})
               AND books_voucher_id IN ({$ids})",
            $params,
        );

        $byVoucher = [];
        foreach ($rows as $row) {
            $byVoucher[(int) $row['books_voucher_id']] = $row;
        }

        return $byVoucher;
    }

    /**
     * Cash and bank account names, so a row can say "HDFC Current" rather than
     * the id we stored. Read from Books like every other master.
     *
     * @return array<int, string>
     */
    private function cashBankNames(): array
    {
        $response = (new BooksClient())->withSession($this->auth->sesKey())
            ->accounts($this->ctx, ['nature' => 'cash_bank', 'limit' => 100]);

        if (!$response['ok']) {
            return [];
        }

        $names = [];
        foreach (BooksReadings::rows($response['body']) as $row) {
            $id = BooksReadings::id($row, ['acc_id', 'account_id', 'id']);
            $name = BooksReadings::text($row, ['acc_name', 'account_name', 'name']);
            if ($id !== null && $name !== null) {
                $names[$id] = $name;
            }
        }

        return $names;
    }

    // -----------------------------------------------------------------------
    // Small helpers
    // -----------------------------------------------------------------------

    /** @return array<string, string> */
    private static function periodShape(Period $period): array
    {
        return [
            'key'           => $period->key,
            'label'         => $period->label,
            'from'          => $period->from,
            'to'            => $period->to,
            'previous_from' => $period->previousFrom,
            'previous_to'   => $period->previousTo,
            'previous_label' => $period->previousLabel,
        ];
    }

    private static function stringOrNull(mixed $value): ?string
    {
        if (is_string($value) && trim($value) !== '') {
            return trim($value);
        }
        if (is_int($value) || is_float($value)) {
            return (string) $value;
        }

        return null;
    }

    private static function daysAgo(?string $date): ?int
    {
        if ($date === null) {
            return null;
        }
        try {
            $then = new \DateTimeImmutable($date);
        } catch (\Throwable) {
            return null;
        }

        $today = new \DateTimeImmutable(gmdate('Y-m-d'));

        return (int) $today->diff($then)->days;
    }
}
