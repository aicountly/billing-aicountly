<?php

declare(strict_types=1);

namespace Aicountly\Api\Clients;

use Aicountly\Api\Env;

/**
 * The one call that asks a document service to read a bill.
 *
 * Not an ApiClient: that base class derives its host from ours and speaks JSON,
 * and this is a multipart POST to a service that is not an AICOUNTLY product
 * and may not exist at all. Everything else about it follows the same rules —
 * a connect bound as well as a total one, and a failure that returns rather
 * than throws, so a screen can say what happened.
 *
 * NOTHING IS STORED. The file is streamed straight through from the upload
 * PHP already has on disk, the answer is handed to the caller, and the
 * temporary file dies with the request. Billing keeps neither the bill nor
 * what was read out of it: the user confirms the fields and the expense that
 * results is the only record.
 *
 * The contract is the one written down in docs/BILLING_API_DEPENDENCIES.md.
 */
final class DocumentExtractionClient
{
    private const CONNECT_TIMEOUT = 3;

    /** Reading a scanned page is slow; a person is watching a spinner, not a counter queue. */
    private const TOTAL_TIMEOUT = 30;

    public static function configured(): bool
    {
        return self::base() !== '';
    }

    private static function base(): string
    {
        return rtrim(Env::get('DOCUMENT_EXTRACTION_BASE'), '/');
    }

    /**
     * @return array{ok:bool, status:int, body:?array<string,mixed>, error:?string}
     */
    public static function read(string $path, string $filename, string $mimeType, string $hint = 'expense_bill'): array
    {
        $base = self::base();
        if ($base === '') {
            return ['ok' => false, 'status' => 0, 'body' => null, 'error' => 'document_extraction_not_configured'];
        }

        $handle = curl_init($base . '/v1/extract');
        if ($handle === false) {
            return ['ok' => false, 'status' => 0, 'body' => null, 'error' => 'curl_unavailable'];
        }

        $headers = ['Accept: application/json', 'X-Source-App: ' . Env::get('APP_PRODUCT_KEY', 'billing')];
        $key = Env::get('DOCUMENT_EXTRACTION_KEY');
        if ($key !== '') {
            $headers[] = 'Authorization: Bearer ' . $key;
        }

        curl_setopt_array($handle, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => [
                'file' => new \CURLFile($path, $mimeType, $filename),
                'hint' => $hint,
            ],
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => self::CONNECT_TIMEOUT,
            CURLOPT_TIMEOUT        => self::TOTAL_TIMEOUT,
        ]);

        $raw = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        $transportError = curl_error($handle);
        curl_close($handle);

        if ($raw === false) {
            return ['ok' => false, 'status' => 0, 'body' => null, 'error' => $transportError ?: 'transport_failed'];
        }

        $decoded = json_decode((string) $raw, true);
        $body = is_array($decoded) ? $decoded : null;

        if ($status < 200 || $status >= 300) {
            return [
                'ok'     => false,
                'status' => $status,
                'body'   => $body,
                'error'  => is_string($body['error']['message'] ?? null) ? $body['error']['message'] : 'extraction_refused',
            ];
        }

        return ['ok' => true, 'status' => $status, 'body' => $body, 'error' => null];
    }
}
