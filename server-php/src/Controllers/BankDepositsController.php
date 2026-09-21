<?php

declare(strict_types=1);

namespace Aicountly\Api\Controllers;

use Aicountly\Api\Clients\DocumentStorageClient;
use Aicountly\Api\Domain\BankDepositHistory;
use Aicountly\Api\Domain\DocumentCapture;
use Aicountly\Api\Http;
use Aicountly\Api\Permissions;

/**
 * What the bank-deposit screen needs beyond recording one.
 *
 * Recording a deposit is still `POST v1/transactions/bank_deposit` — one
 * service makes every transaction in this product and that has not changed.
 * These endpoints are the things AROUND the form: what was banked lately, how
 * much has gone into the chosen bank this month, and — when a document service
 * is configured — keeping the slip.
 *
 * All four are gated on `contra.create`, the same permission the screen and the
 * save are gated on. The BALANCE beside them is not here: that is Books', read
 * through `v1/cash-bank`, where `cash.view` and `bank.view` decide what may be
 * seen.
 */
final class BankDepositsController extends Controller
{
    public static function recent(): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'contra.create');

        Http::data((new BankDepositHistory($ctx, $auth))->recent(Http::intParam('limit', 4) ?? 4));
    }

    /** What has gone into one bank account lately. Context, not a balance. */
    public static function summary(): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'contra.create');

        $bankAccountId = Http::intParam('bank_account_id');
        if ($bankAccountId === null) {
            Http::validationFailed('Choose the bank account first.', ['field' => 'bank_account_id']);
        }

        Http::data((new BankDepositHistory($ctx, $auth))->summary(
            $bankAccountId,
            Http::intParam('days', BankDepositHistory::SUMMARY_DAYS) ?? BankDepositHistory::SUMMARY_DAYS,
        ));
    }

    /**
     * Whether the deposit slip itself can be kept in this deployment.
     *
     * The same switch the expense screen reads for a bill, because "can this
     * product hold a document" is one answer in this product rather than one
     * per screen. Configuration, not data, so it takes no Books call and cannot
     * fail because another product is slow.
     */
    public static function capabilities(): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'contra.create');

        Http::data(['slip_storage' => DocumentCapture::storage('slip')]);
    }

    /**
     * Keep the slip, and hand back what the voucher will point at.
     *
     * The reference this returns travels to Books on the contra as
     * `attachment_ref`. Nothing is recorded by this call: a slip uploaded and
     * then abandoned leaves no deposit behind, which is the right way round,
     * because the person is still filling the form when it happens.
     *
     * Billing writes no bytes. The file goes straight out to the configured
     * document service and the temporary upload dies with the request.
     */
    public static function storeSlip(): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'contra.create');

        $capability = DocumentCapture::storage('slip');
        if (!$capability['available']) {
            Http::error(503, 'storage_unavailable', (string) $capability['reason']);
        }

        $upload = DocumentCapture::takeUpload('Choose a deposit slip to attach.', 'slip');

        $result = DocumentStorageClient::put(
            $upload['path'],
            $upload['name'],
            $upload['type'],
            $ctx->cmpId,
            $ctx->fyId,
        );

        if (!$result['ok']) {
            Http::error(
                $result['status'] === 0 || $result['status'] >= 500 ? 503 : 422,
                $result['status'] === 0 ? 'storage_unreachable' : 'storage_failed',
                $result['status'] === 0
                    ? 'Could not reach the service that keeps documents. The deposit can still be recorded without '
                        . 'the slip.'
                    : 'That file was not accepted by the document service. The deposit can still be recorded '
                        . 'without it.',
            );
        }

        $stored = DocumentStorageClient::stored($result['body'] ?? []);
        if ($stored === null) {
            // A 200 with no reference in it. Saying "saved" here would put a
            // deposit on record pointing at a slip nobody can find again.
            Http::error(
                502,
                'storage_incomplete',
                'The document service did not say where it kept that slip, so it has not been attached.',
            );
        }

        $stored['filename'] ??= $upload['name'];
        $stored['content_type'] ??= $upload['type'];

        Http::data($stored);
    }
}
