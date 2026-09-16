<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

use Aicountly\Api\Audit;
use Aicountly\Api\Auth;
use Aicountly\Api\Context;
use Aicountly\Api\Db;
use Aicountly\Api\Http;
use Aicountly\Api\Permissions;

/**
 * What a customer said they would pay, and when.
 *
 * This is the one thing on the receivables screen that Books cannot answer,
 * because it is not an accounting fact. "They rang and said the 15th" has no
 * voucher, no ledger entry and no balance — and it is exactly what decides who
 * gets chased on Monday.
 *
 * IT IS NEVER A BALANCE. The promised amount is a note of a conversation, in
 * the same category as the reminder log's amount_at_send. Whether the money
 * actually arrived is decided on every read by asking Books what is still
 * outstanding for that customer — never by marking the promise "paid" here.
 * That is why a broken promise can be shown at all: the promise is ours, the
 * outstanding is Books', and the disagreement between them is the signal.
 */
final class PromiseService
{
    public const TABLE = 'billing_payment_promises';

    public function __construct(
        private readonly Context $ctx,
        private readonly Auth $auth,
    ) {
    }

    /**
     * Open promises, judged against what Books currently says is outstanding.
     *
     * @param array<int, array<string, mixed>> $outstandingByAccount keyed by account id
     * @return list<array<string, mixed>>
     */
    public function open(string $today, array $outstandingByAccount): array
    {
        $rows = Db::all(
            "SELECT promise_id, customer_account_id, books_voucher_uuid, books_bill_no,
                    promised_date, promised_amount, status, note, created_by, created_at
             FROM " . self::TABLE . "
             WHERE cmp_id = :cmp AND fy_id = :fy AND status IN ('TENTATIVE', 'CONFIRMED')
             ORDER BY promised_date ASC
             LIMIT 50",
            ['cmp' => $this->ctx->cmpId, 'fy' => $this->ctx->fyId],
        );

        $out = [];
        foreach ($rows as $row) {
            $accountId = (int) $row['customer_account_id'];
            $party = $outstandingByAccount[$accountId] ?? null;
            $stillOwed = $party['total'] ?? null;
            $promisedDate = (string) $row['promised_date'];

            // Three states, and only one of them is ours to assert. "Due" and
            // "overdue" are dates. "Settled" is Books saying nothing is left.
            $standing = match (true) {
                $stillOwed !== null && $stillOwed <= 0.005 => 'SETTLED',
                $promisedDate < $today                     => 'PAST_DUE',
                default                                    => 'AWAITED',
            };

            $out[] = [
                'promise_id'      => (int) $row['promise_id'],
                'account_id'      => $accountId,
                'account_name'    => $party['account_name'] ?? null,
                'bill_no'         => $row['books_bill_no'],
                'promised_date'   => $promisedDate,
                'promised_amount' => round((float) $row['promised_amount'], 2),
                'status'          => (string) $row['status'],
                'standing'        => $standing,
                // Deliberately separate fields. The promise is what they said;
                // the outstanding is what Books says. Merging them into one
                // number is how a promise starts being treated as a receipt.
                'still_outstanding' => $stillOwed !== null ? round((float) $stillOwed, 2) : null,
                'outstanding_known' => $party !== null,
                'note'            => $row['note'],
                'created_at'      => $row['created_at'],
            ];
        }

        return $out;
    }

    /** @param array<string, mixed> $input */
    public function record(array $input): array
    {
        Permissions::assert($this->ctx, $this->auth, 'promise.manage');

        $accountId = isset($input['account_id']) && is_numeric($input['account_id']) ? (int) $input['account_id'] : 0;
        if ($accountId <= 0) {
            Http::validationFailed('Which customer made this promise?', ['field' => 'account_id']);
        }

        $amount = isset($input['amount']) && is_numeric($input['amount']) ? round((float) $input['amount'], 4) : 0.0;
        if ($amount <= 0) {
            Http::validationFailed('How much did they say they would pay?', ['field' => 'amount']);
        }

        $date = self::date($input['promised_date'] ?? null);
        if ($date === null) {
            Http::validationFailed('When did they say they would pay?', ['field' => 'promised_date']);
        }

        $status = strtoupper((string) ($input['status'] ?? 'TENTATIVE'));
        if (!in_array($status, ['TENTATIVE', 'CONFIRMED'], true)) {
            Http::validationFailed('A promise is either tentative or confirmed.', ['field' => 'status']);
        }

        $id = Db::insert(self::TABLE, [
            'cmp_id'              => $this->ctx->cmpId,
            'fy_id'               => $this->ctx->fyId,
            'bo_id'               => $this->ctx->boId,
            'customer_account_id' => $accountId,
            'books_voucher_uuid'  => self::text($input['voucher_uuid'] ?? null),
            'books_bill_no'       => self::text($input['bill_no'] ?? null),
            'promised_date'       => $date,
            'promised_amount'     => $amount,
            'status'              => $status,
            'note'                => self::text($input['note'] ?? null),
            'created_by'          => $this->auth->uuid,
        ], 'promise_id');

        Audit::record($this->ctx, $this->auth, 'promise.recorded', 'payment_promise', (int) $id, null, [
            'account_id' => $accountId,
            'promised_date' => $date,
            'status' => $status,
        ]);

        return ['promise_id' => (int) $id, 'status' => $status, 'promised_date' => $date];
    }

    public function setStatus(int $promiseId, string $status): array
    {
        Permissions::assert($this->ctx, $this->auth, 'promise.manage');

        $status = strtoupper($status);
        if (!in_array($status, ['TENTATIVE', 'CONFIRMED', 'CANCELLED'], true)) {
            Http::validationFailed('A promise can be tentative, confirmed or cancelled.', ['field' => 'status']);
        }

        $before = Db::first(
            'SELECT promise_id, status FROM ' . self::TABLE . ' WHERE promise_id = :id AND cmp_id = :cmp',
            ['id' => $promiseId, 'cmp' => $this->ctx->cmpId],
        );
        if ($before === null) {
            Http::notFound('That promise is not on record.');
        }

        Db::update(self::TABLE, ['status' => $status, 'updated_at' => gmdate('Y-m-d H:i:s')], [
            'promise_id' => $promiseId,
            'cmp_id'     => $this->ctx->cmpId,
        ]);

        Audit::record($this->ctx, $this->auth, 'promise.status_changed', 'payment_promise', $promiseId, $before, ['status' => $status]);

        return ['promise_id' => $promiseId, 'status' => $status];
    }

    private static function date(mixed $value): ?string
    {
        if (!is_string($value) || trim($value) === '') {
            return null;
        }
        try {
            return (new \DateTimeImmutable($value))->format('Y-m-d');
        } catch (\Throwable) {
            return null;
        }
    }

    private static function text(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $trimmed = trim($value);

        return $trimmed === '' ? null : mb_substr($trimmed, 0, 500);
    }
}
