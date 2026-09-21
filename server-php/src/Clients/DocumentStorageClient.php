<?php

declare(strict_types=1);

namespace Aicountly\Api\Clients;

use Aicountly\Api\Env;

/**
 * The one call that hands a bill file to a document service and gets a
 * reference back.
 *
 * Not an ApiClient, for the same reasons DocumentExtractionClient is not: that
 * base class derives its host from ours and speaks JSON, and this is a
 * multipart POST to a service that is not an AICOUNTLY product and may not
 * exist at all. Everything else about it follows the same rules — a connect
 * bound as well as a total one, and a failure that returns rather than throws,
 * so the screen can say what happened.
 *
 * BILLING KEEPS NOTHING. The file is streamed straight through from the upload
 * PHP already has on disk and the temporary file dies with the request. What
 * survives is a reference string, which travels to Books on the voucher as
 * `attachment_ref` — a field the expense request already accepted. No bytes
 * are written inside this product, which is the point: the deploy runs
 * `rsync --delete` over the document root (see docs/DEPLOYMENT.md) and a folder
 * of uploads beside the app would not survive a release.
 *
 * The contract is the one written down in docs/BILLING_API_DEPENDENCIES.md.
 */
final class DocumentStorageClient
{
    private const CONNECT_TIMEOUT = 3;

    /** A ten-megabyte photo over a shop's connection is slower than a JSON call. */
    private const TOTAL_TIMEOUT = 45;

    public static function configured(): bool
    {
        return self::base() !== '';
    }

    private static function base(): string
    {
        return rtrim(Env::get('DOCUMENT_STORAGE_BASE'), '/');
    }

    /**
     * Put a file away and return what the service calls it.
     *
     * The scope goes with it as `<cmp_id>/<fy_id>`, so a document service that
     * keeps tenants apart has what it needs to do so — Billing asking for a
     * reference is not Billing deciding who may read it back.
     *
     * @return array{ok:bool, status:int, body:?array<string,mixed>, error:?string}
     */
    public static function put(
        string $path,
        string $filename,
        string $mimeType,
        int $cmpId,
        int $fyId,
    ): array {
        $base = self::base();
        if ($base === '') {
            return ['ok' => false, 'status' => 0, 'body' => null, 'error' => 'document_storage_not_configured'];
        }

        $handle = curl_init($base . '/v1/documents');
        if ($handle === false) {
            return ['ok' => false, 'status' => 0, 'body' => null, 'error' => 'curl_unavailable'];
        }

        $headers = ['Accept: application/json', 'X-Source-App: ' . Env::get('APP_PRODUCT_KEY', 'billing')];
        $key = Env::get('DOCUMENT_STORAGE_KEY');
        if ($key !== '') {
            $headers[] = 'Authorization: Bearer ' . $key;
        }

        curl_setopt_array($handle, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => [
                'file'  => new \CURLFile($path, $mimeType, $filename),
                'scope' => $cmpId . '/' . $fyId,
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
                'error'  => is_string($body['error']['message'] ?? null) ? $body['error']['message'] : 'storage_refused',
            ];
        }

        return ['ok' => true, 'status' => $status, 'body' => $body, 'error' => null];
    }

    /**
     * What the service said, reduced to the four things a screen may show and
     * the one thing the voucher carries.
     *
     * A response without a reference is a failure however it was dressed: the
     * reference is the whole point of the call, and recording an expense that
     * points at nothing would be worse than refusing the upload.
     *
     * @param array<string, mixed> $body
     * @return array{reference:string, filename:?string, size:?int, content_type:?string, url:?string}|null
     */
    public static function stored(array $body): ?array
    {
        $data = is_array($body['data'] ?? null) ? $body['data'] : $body;

        $reference = $data['reference'] ?? null;
        if (!is_string($reference) || trim($reference) === '') {
            return null;
        }

        $size = $data['size'] ?? null;

        return [
            'reference'    => trim($reference),
            'filename'     => self::text($data['filename'] ?? null),
            'size'         => is_int($size) || (is_string($size) && ctype_digit($size)) ? (int) $size : null,
            'content_type' => self::text($data['content_type'] ?? null),
            'url'          => self::text($data['url'] ?? null),
        ];
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
