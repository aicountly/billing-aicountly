<?php

declare(strict_types=1);

namespace Aicountly\Api\Controllers;

use Aicountly\Api\Clients\DocumentExtractionClient;
use Aicountly\Api\Clients\DocumentStorageClient;
use Aicountly\Api\Domain\DocumentCapture;
use Aicountly\Api\Domain\ExpenseHistory;
use Aicountly\Api\Http;
use Aicountly\Api\Permissions;

/**
 * What the expense screen needs beyond recording one.
 *
 * Recording an expense is still `POST v1/transactions/expense` — one service
 * makes every transaction in this product and that has not changed. These
 * endpoints are the things around the form: what was recorded lately, what this
 * deployment can do with a bill file, and — when a document service is
 * configured — keeping one and reading one.
 */
final class ExpensesController extends Controller
{
    /**
     * The last few expenses recorded from Billing, with their heads named live.
     *
     * Gated on `expense.create`, the same permission as the screen: somebody who
     * cannot record an expense has no reason to be handed the list of them.
     */
    public static function recent(): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'expense.create');

        Http::data((new ExpenseHistory($ctx, $auth))->recent(Http::intParam('limit', 5) ?? 5));
    }

    /**
     * Whether a bill file can be kept, and whether it can be read automatically.
     *
     * Configuration, not data, so it takes no Books call and cannot fail because
     * another product is slow. The screen draws the Bill / Receipt block and the
     * AI Bill Reader card from this, and when the answer is no it shows the
     * reason rather than a button that appears to do something.
     */
    public static function capabilities(): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'expense.create');

        Http::data([
            'bill_storage'    => DocumentCapture::storage(),
            'bill_extraction' => DocumentCapture::extraction(),
        ]);
    }

    /**
     * Keep the bill file, and hand back what the voucher will point at.
     *
     * The reference this returns is what the expense carries to Books as
     * `attachment_ref` — a field the expense request already accepted. Nothing
     * is recorded by this call: a bill uploaded and then abandoned leaves no
     * expense behind, which is the right way round, because the person is still
     * filling the form when it happens.
     *
     * Billing writes no bytes. The file goes straight out to the configured
     * document service and the temporary upload dies with the request.
     */
    public static function storeBill(): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'expense.create');

        $capability = DocumentCapture::storage();
        if (!$capability['available']) {
            Http::error(503, 'storage_unavailable', (string) $capability['reason']);
        }

        $upload = self::takeUpload('Choose a bill to attach.');

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
                    ? 'Could not reach the service that keeps bills. The expense can still be recorded without one.'
                    : 'That file was not accepted by the document service. The expense can still be recorded '
                        . 'without it.',
            );
        }

        $stored = DocumentStorageClient::stored($result['body'] ?? []);
        if ($stored === null) {
            // A 200 with no reference in it. Saying "saved" here would put an
            // expense on record pointing at a bill nobody can find again.
            Http::error(
                502,
                'storage_incomplete',
                'The document service did not say where it kept that bill, so it has not been attached.',
            );
        }

        // What the browser said the file was called, when the service did not
        // say: the name is for the person looking at the form, not for the
        // voucher, and the reference is the part that has to be right.
        $stored['filename'] ??= $upload['name'];
        $stored['content_type'] ??= $upload['type'];

        Http::data($stored);
    }

    /**
     * Read a bill and PROPOSE what is on it. Nothing is recorded here.
     *
     * The response is fields and a confidence for each, handed back for a person
     * to look at. This endpoint writes nothing, posts nothing to Books and keeps
     * neither the file nor the answer — the expense the user then confirms is the
     * only record that survives the request.
     *
     * Multipart rather than JSON, so the scope travels in the query string; the
     * browser's api client already puts it there on every call.
     */
    public static function readBill(): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'expense.create');

        $capability = DocumentCapture::extraction();
        if (!$capability['available']) {
            Http::error(503, 'extraction_unavailable', (string) $capability['reason']);
        }

        $upload = self::takeUpload('Choose a bill to read.');

        $result = DocumentExtractionClient::read($upload['path'], $upload['name'], $upload['type']);
        if (!$result['ok']) {
            $status = $result['status'] === 0 ? 503 : $result['status'];
            Http::error(
                $status >= 500 || $status === 0 ? 503 : 422,
                $status === 0 ? 'extraction_unreachable' : 'extraction_failed',
                $status === 0
                    ? 'Could not reach the service that reads bills. The details can still be typed in.'
                    : 'That bill could not be read. The details can still be typed in.',
            );
        }

        Http::data(self::proposal($result['body'] ?? []));
    }

    /**
     * The uploaded file, checked before it goes anywhere.
     *
     * The type is taken from the CONTENT, not from what the browser said it was:
     * a client-declared Content-Type is a claim by the same party that chose the
     * file.
     *
     * @return array{path:string, name:string, type:string}
     */
    private static function takeUpload(string $missing): array
    {
        $file = $_FILES['file'] ?? null;
        if (!is_array($file) || !isset($file['tmp_name']) || !is_uploaded_file((string) $file['tmp_name'])) {
            Http::validationFailed($missing, ['field' => 'file']);
        }

        $error = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($error === UPLOAD_ERR_INI_SIZE || $error === UPLOAD_ERR_FORM_SIZE) {
            Http::validationFailed('That file is too large.', ['field' => 'file']);
        }
        if ($error !== UPLOAD_ERR_OK) {
            Http::validationFailed('That file did not arrive in one piece. Try again.', ['field' => 'file']);
        }

        $path = (string) $file['tmp_name'];
        $size = (int) ($file['size'] ?? 0);
        if ($size <= 0 || $size > DocumentCapture::MAX_BYTES) {
            Http::validationFailed(
                sprintf('A bill has to be under %d MB.', (int) (DocumentCapture::MAX_BYTES / 1024 / 1024)),
                ['field' => 'file'],
            );
        }

        $type = false;
        if (function_exists('finfo_open')) {
            $finfo = finfo_open(FILEINFO_MIME_TYPE);
            if ($finfo !== false) {
                $type = finfo_file($finfo, $path);
                finfo_close($finfo);
            }
        }
        if (!is_string($type) || !in_array($type, DocumentCapture::ACCEPTS, true)) {
            Http::validationFailed('A bill has to be a PDF, JPG or PNG.', ['field' => 'file']);
        }

        $name = basename((string) ($file['name'] ?? 'bill'));

        return ['path' => $path, 'name' => $name === '' ? 'bill' : $name, 'type' => $type];
    }

    /**
     * The service's answer, reduced to what this screen can actually fill in.
     *
     * Deliberately narrow. Nothing here maps a supplier NAME onto a party id or
     * a description onto an expense head — those are choices with accounting
     * consequences, and a name that reads like a ledger is not one. They come
     * back as text for the person to act on.
     *
     * @param array<string, mixed> $body
     * @return array<string, mixed>
     */
    private static function proposal(array $body): array
    {
        $data = is_array($body['data'] ?? null) ? $body['data'] : $body;
        $fields = is_array($data['fields'] ?? null) ? $data['fields'] : [];
        $confidence = is_array($data['confidence_by_field'] ?? null) ? $data['confidence_by_field'] : [];

        $amount = self::number($fields['total_amount'] ?? null);
        $out = [
            'amount'         => $amount,
            'bill_no'        => self::text($fields['bill_no'] ?? null),
            'bill_date'      => self::date($fields['bill_date'] ?? null),
            'supplier_name'  => self::text($fields['supplier_name'] ?? null),
            'supplier_gstin' => self::text($fields['supplier_gstin'] ?? null),
            'tax_amount'     => self::number($fields['tax_amount'] ?? null),
            'currency'       => self::text($fields['currency'] ?? null),
        ];

        $read = 0;
        foreach ($out as $value) {
            if ($value !== null) {
                $read++;
            }
        }

        return [
            'fields'     => $out,
            'confidence' => array_map(
                static fn (mixed $level): string => $level === 'high' ? 'high' : 'low',
                array_filter($confidence, static fn (mixed $value): bool => is_string($value)),
            ),
            'read'       => $read,
        ];
    }

    private static function number(mixed $value): ?float
    {
        if (is_int($value) || is_float($value)) {
            return round((float) $value, 2);
        }
        if (is_string($value)) {
            $cleaned = preg_replace('/[^0-9.\-]/', '', $value) ?? '';
            if ($cleaned !== '' && is_numeric($cleaned)) {
                return round((float) $cleaned, 2);
            }
        }

        return null;
    }

    private static function text(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $trimmed = trim($value);

        return $trimmed === '' ? null : mb_substr($trimmed, 0, 200);
    }

    private static function date(mixed $value): ?string
    {
        $text = self::text($value);
        if ($text === null) {
            return null;
        }
        $stamp = strtotime($text);

        return $stamp === false ? null : gmdate('Y-m-d', $stamp);
    }
}
