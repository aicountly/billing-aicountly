<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

use Aicountly\Api\Auth;
use Aicountly\Api\Clients\BooksClient;
use Aicountly\Api\Context;
use Aicountly\Api\Db;
use Aicountly\Api\Permissions;

/**
 * Dashboard 2 — "Ready for your next bill".
 *
 * The counter screen. Its job is the next transaction, not the business: a
 * person standing here has a customer in front of them, so what they get is a
 * customer box, an item box, and the four bills they have not finished.
 *
 * WHAT IT DELIBERATELY DOES NOT SHOW
 *
 * Company turnover, anyone else's bills, purchase cost, margin, supplier dues,
 * the bank. Not hidden behind a toggle — not fetched. Every figure below is
 * either scoped to this user's own uuid or gated on a permission a biller does
 * not hold, and the backend is where that happens, so the answer is the same
 * whether the request comes from the screen or from curl.
 *
 * "Mine" means the requests this user raised THROUGH BILLING. A bill the owner
 * entered directly in Books is not this user's work and does not appear here,
 * which is also why the count comes from our own request log and the money
 * comes from Books.
 */
final class BillerDeskService
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
        $books = (new BooksClient())->withSession($this->auth->sesKey());

        $mine = $this->myPostedSalesToday($today);
        $unfinished = $this->myUnfinished();
        $checks = $this->checks($unfinished);

        $metrics = [
            Metric::ready(
                'my_invoices_today',
                'My bills today',
                count($mine),
                Metric::BASIS_COUNT,
                'Bills you raised through Billing today (' . $today . ') that Smart Books accepted. '
                    . 'It does not count bills anyone else raised, or bills entered directly in Books.',
                null,
                'neutral',
            ),
        ];

        // The value of those bills is Books' figure for them, not ours. We hold
        // the voucher ids; Books holds what they came to once tax was applied.
        if (Permissions::allows($this->ctx, $this->auth, 'sale.view')) {
            $metrics[] = $this->myBilledValue($books, $period, $mine, $today);
        }

        $metrics[] = Metric::ready(
            'my_drafts',
            'Bills to finish',
            count($unfinished),
            Metric::BASIS_COUNT,
            'Bills you started here that Smart Books has not accepted yet. Nothing has been duplicated — '
                . 'each one can be completed from where it stopped.',
            null,
            count($unfinished) > 0 ? 'warning' : 'neutral',
        );

        $metrics[] = Metric::ready(
            'my_document_checks',
            'Checks to clear',
            count($checks),
            Metric::BASIS_COUNT,
            'Things Billing can tell are missing or incomplete on your own unfinished bills, '
                . 'plus e-Invoice or e-Way Bill requests of yours that did not come back generated.',
            null,
            count($checks) > 0 ? 'warning' : 'neutral',
        );

        return [
            'period'  => $period->describe(),
            'metrics' => $metrics,
            'panels'  => [
                'unfinished'     => $unfinished,
                'checks'         => $checks,
                'recent'         => $this->myRecentBills($books, $period, $today),
                'can_create'     => Permissions::allows($this->ctx, $this->auth, 'sale.create'),
                'can_return'     => Permissions::allows($this->ctx, $this->auth, 'credit_note.create'),
                'can_take_money' => Permissions::allows($this->ctx, $this->auth, 'receipt.create'),
            ],
            'generated_at' => gmdate('c'),
        ];
    }

    /**
     * This user's sale requests that reached Books today.
     *
     * @return list<array<string, mixed>>
     */
    private function myPostedSalesToday(string $today): array
    {
        return Db::all(
            "SELECT request_id, books_voucher_id, books_voucher_uuid, books_voucher_no, party_account_id, created_at
             FROM billing_transaction_requests
             WHERE cmp_id = :cmp AND fy_id = :fy AND kind = 'sale' AND status = 'POSTED'
               AND created_by = :uuid AND transaction_date = :today
             ORDER BY created_at DESC",
            ['cmp' => $this->ctx->cmpId, 'fy' => $this->ctx->fyId, 'uuid' => $this->auth->uuid, 'today' => $today],
        );
    }

    /**
     * What this user's bills came to, according to Books.
     *
     * @param list<array<string, mixed>> $mine
     * @return array<string, mixed>
     */
    private function myBilledValue(BooksClient $books, Period $period, array $mine, string $today): array
    {
        $label = 'My billed value today';
        $definition = 'The value Smart Books gave your own bills dated ' . $today . ', including tax.';

        if ($mine === []) {
            return Metric::ready('my_billed_value', $label, 0, Metric::BASIS_PERIOD, $definition, null, 'neutral');
        }

        $reading = (new RegisterReader($this->ctx, $books))->read(BooksClient::VCH_SALES, $today, $today);
        if (!$reading['available'] || !$reading['complete']) {
            return Metric::unavailable(
                'my_billed_value',
                $label,
                Metric::BASIS_PERIOD,
                $definition,
                $reading['available']
                    ? 'There are more bills today than can be read in one go, so a total of yours cannot be taken.'
                    : (string) ($reading['reason'] ?? 'Smart Books did not answer.'),
            );
        }

        $mineIds = [];
        $mineUuids = [];
        foreach ($mine as $row) {
            if ($row['books_voucher_id'] !== null) {
                $mineIds[(int) $row['books_voucher_id']] = true;
            }
            if ($row['books_voucher_uuid'] !== null) {
                $mineUuids[(string) $row['books_voucher_uuid']] = true;
            }
        }

        $total = 0.0;
        $matched = 0;
        foreach ($reading['rows'] as $row) {
            $id = BooksReadings::voucherId($row);
            $uuid = BooksReadings::voucherUuid($row);
            $isMine = ($id !== null && isset($mineIds[$id])) || ($uuid !== null && isset($mineUuids[$uuid]));
            if (!$isMine) {
                continue;
            }
            $amount = BooksReadings::voucherAmount($row);
            if ($amount === null) {
                return Metric::unavailable('my_billed_value', $label, Metric::BASIS_PERIOD, $definition, 'One of your bills came back without a value.');
            }
            $total += $amount;
            $matched++;
        }

        // Books knows about fewer of our bills than we recorded. Rather than
        // report the short total, say so: a biller who sees a figure lower than
        // the bills they remember raising will not trust the screen again.
        if ($matched < count($mine)) {
            return Metric::unavailable(
                'my_billed_value',
                $label,
                Metric::BASIS_PERIOD,
                $definition,
                sprintf('Smart Books returned %d of your %d bills for today, so this cannot be totalled yet.', $matched, count($mine)),
            );
        }

        return Metric::ready('my_billed_value', $label, $total, Metric::BASIS_PERIOD, $definition, null, 'neutral');
    }

    /**
     * Bills this user started that have not been accepted by Books.
     *
     * The value shown against each is WHAT THEY TYPED, before tax, and is
     * labelled as such. It is our own record of their input, not a figure from
     * the accounts — there is no figure from the accounts yet, because that is
     * precisely what has not happened.
     *
     * @return list<array<string, mixed>>
     */
    private function myUnfinished(): array
    {
        $rows = Db::all(
            "SELECT request_id, request_uuid, kind, status, party_account_id, transaction_date,
                    payload, last_error, created_at, updated_at
             FROM billing_transaction_requests
             WHERE cmp_id = :cmp AND fy_id = :fy AND created_by = :uuid
               AND status IN ('PENDING', 'POSTING', 'FAILED')
             ORDER BY updated_at DESC
             LIMIT 12",
            ['cmp' => $this->ctx->cmpId, 'fy' => $this->ctx->fyId, 'uuid' => $this->auth->uuid],
        );

        $out = [];
        foreach ($rows as $row) {
            $payload = Db::jsonColumn($row['payload'] ?? null);
            $out[] = [
                'request_id'    => (int) $row['request_id'],
                'request_uuid'  => (string) $row['request_uuid'],
                'kind'          => (string) $row['kind'],
                'status'        => (string) $row['status'],
                'date'          => (string) $row['transaction_date'],
                'party_account_id' => $row['party_account_id'] !== null ? (int) $row['party_account_id'] : null,
                'entered_value' => self::enteredValue($payload),
                'line_count'    => count($payload['inventory_lines'] ?? []) + count($payload['service_lines'] ?? []),
                'last_error'    => $row['last_error'],
                'updated_at'    => $row['updated_at'],
            ];
        }

        return $out;
    }

    /**
     * What Billing can tell is wrong before Books is troubled with it.
     *
     * Every check below is deterministic and local: it reads the request this
     * user already typed and nothing else. None of it is a tax opinion — Books
     * decides whether a GSTIN is needed and what rate applies, and a second
     * opinion offered here would be a second tax engine by the back door.
     *
     * @param list<array<string, mixed>> $unfinished
     * @return list<array<string, mixed>>
     */
    private function checks(array $unfinished): array
    {
        $checks = [];

        foreach ($unfinished as $request) {
            if ($request['party_account_id'] === null) {
                $checks[] = [
                    'id'      => 'no_party_' . $request['request_id'],
                    'tone'    => 'danger',
                    'title'   => 'A bill has no customer on it',
                    'detail'  => 'Started ' . $request['date'] . '. It cannot be issued until a customer is chosen.',
                    'action'  => ['label' => 'Open', 'path' => '/more/unfinished'],
                ];
            }
            if ($request['line_count'] === 0) {
                $checks[] = [
                    'id'     => 'no_lines_' . $request['request_id'],
                    'tone'   => 'danger',
                    'title'  => 'A bill has nothing on it',
                    'detail' => 'Started ' . $request['date'] . '. Add at least one item or service.',
                    'action' => ['label' => 'Open', 'path' => '/more/unfinished'],
                ];
            }
            if ($request['status'] === 'FAILED' && $request['last_error'] !== null) {
                $checks[] = [
                    'id'     => 'failed_' . $request['request_id'],
                    'tone'   => 'warning',
                    'title'  => 'Smart Books refused a bill',
                    'detail' => (string) $request['last_error'],
                    'action' => ['label' => 'Retry', 'path' => '/more/unfinished'],
                ];
            }
        }

        // Statutory documents this user asked for that have not come back.
        $statutory = Db::all(
            "SELECT c.command_id, c.command_type, c.status, c.last_error, c.entity_id
             FROM billing_integration_commands c
             JOIN billing_transaction_requests r ON r.request_id = c.entity_id
             WHERE c.cmp_id = :cmp AND c.entity_type = 'transaction_request'
               AND c.command_type LIKE 'billing.e%'
               AND c.status IN ('PENDING', 'POSTING', 'FAILED', 'BLOCKED')
               AND r.created_by = :uuid
             ORDER BY c.updated_at DESC
             LIMIT 10",
            ['cmp' => $this->ctx->cmpId, 'uuid' => $this->auth->uuid],
        );

        foreach ($statutory as $command) {
            $what = str_contains((string) $command['command_type'], 'eway') ? 'e-Way Bill' : 'e-Invoice';
            $checks[] = [
                'id'     => 'statutory_' . $command['command_id'],
                'tone'   => $command['status'] === 'FAILED' || $command['status'] === 'BLOCKED' ? 'danger' : 'info',
                'title'  => $what . ' ' . ($command['status'] === 'FAILED' ? 'did not generate' : 'is still in progress'),
                'detail' => (string) ($command['last_error'] ?? 'Smart Books has not confirmed it yet. Check its status before asking again.'),
                'action' => ['label' => 'Open bill', 'path' => '/sales/' . (int) $command['entity_id']],
            ];
        }

        return $checks;
    }

    /**
     * This user's recent bills, with Books' own value and settlement state.
     *
     * @return array<string, mixed>
     */
    private function myRecentBills(BooksClient $books, Period $period, string $today): array
    {
        if (!Permissions::allows($this->ctx, $this->auth, 'sale.view')) {
            return ['available' => false, 'reason' => 'Your Billing profile does not show bills.', 'rows' => []];
        }

        $recent = Db::all(
            "SELECT books_voucher_id, books_voucher_uuid, books_voucher_no, transaction_date
             FROM billing_transaction_requests
             WHERE cmp_id = :cmp AND fy_id = :fy AND kind = 'sale' AND status = 'POSTED' AND created_by = :uuid
             ORDER BY transaction_date DESC, request_id DESC
             LIMIT 10",
            ['cmp' => $this->ctx->cmpId, 'fy' => $this->ctx->fyId, 'uuid' => $this->auth->uuid],
        );

        if ($recent === []) {
            return ['available' => true, 'reason' => null, 'rows' => []];
        }

        $from = (string) ($recent[count($recent) - 1]['transaction_date'] ?? $today);
        $reading = (new RegisterReader($this->ctx, $books))->read(BooksClient::VCH_SALES, $from, $today);
        if (!$reading['available']) {
            return ['available' => false, 'reason' => (string) ($reading['reason'] ?? 'Smart Books did not answer.'), 'rows' => []];
        }

        $wanted = [];
        foreach ($recent as $row) {
            if ($row['books_voucher_id'] !== null) {
                $wanted['id:' . (int) $row['books_voucher_id']] = true;
            }
            if ($row['books_voucher_uuid'] !== null) {
                $wanted['uuid:' . (string) $row['books_voucher_uuid']] = true;
            }
        }

        $rows = [];
        foreach (RegisterReader::documents($reading, 200) as $document) {
            $isMine = isset($wanted['id:' . (string) $document['voucher_id']])
                || isset($wanted['uuid:' . (string) $document['voucher_uuid']]);
            if ($isMine) {
                $rows[] = $document;
            }
        }

        return ['available' => true, 'reason' => null, 'rows' => array_slice($rows, 0, 8)];
    }

    /**
     * The value of the lines as they were typed, before Books applies tax.
     *
     * @param array<string, mixed> $payload
     */
    private static function enteredValue(array $payload): ?float
    {
        $total = 0.0;
        $seen = false;
        foreach (['inventory_lines', 'service_lines'] as $key) {
            foreach ((array) ($payload[$key] ?? []) as $line) {
                if (!is_array($line) || !isset($line['amount']) || !is_numeric($line['amount'])) {
                    continue;
                }
                $total += (float) $line['amount'];
                $seen = true;
            }
        }

        return $seen ? round($total, 2) : null;
    }
}
