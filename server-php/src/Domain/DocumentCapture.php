<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

use Aicountly\Api\Clients\DocumentExtractionClient;
use Aicountly\Api\Clients\DocumentStorageClient;
use Aicountly\Api\Http;

/**
 * Whether this deployment can keep a bill file, and whether it can read one.
 *
 * Two separate capabilities that people conflate, so they are answered
 * separately here rather than in each screen that asks:
 *
 *   STORAGE    somewhere to put the PDF or photo of a bill and get it back
 *   EXTRACTION something that reads that file and proposes the fields
 *
 * Neither is Billing's to build. A document store inside this product would be
 * deleted by the next `rsync --delete` deploy (see docs/DEPLOYMENT.md), and an
 * OCR stack here would be a second one in the fleet. So both are configuration:
 * absent, the screens say so plainly and offer the path that works, which is
 * what `reason` is for.
 *
 * This is the single place that decides; the expense screen and the payables
 * dashboard both read it, so they cannot disagree about what this deployment
 * can do.
 */
final class DocumentCapture
{
    /** What a bill file may be, when there is somewhere to put one. */
    public const ACCEPTS = ['application/pdf', 'image/jpeg', 'image/png'];

    /** The ceiling a phone photo of a bill fits inside comfortably. */
    public const MAX_BYTES = 10 * 1024 * 1024;

    /**
     * Somewhere to keep the file itself.
     *
     * True when a document service is configured, because the client that
     * talks to one now exists (DocumentStorageClient). Configuration alone is
     * the answer: a drop zone is only honest when there is somewhere for the
     * photo to land, and when there is not, the screen records WHERE the
     * document is kept instead and `reason` says why.
     *
     * `$noun` is what the screen asking calls the file — a bill on the expense
     * form, a slip on the deposit one. The reason is read aloud on the screen,
     * and a deposit form that says "record where the bill is" is a deposit
     * form nobody wrote.
     *
     * @return array{available:bool, reason:?string, accepts:list<string>, max_bytes:int}
     */
    public static function storage(string $noun = 'bill'): array
    {
        $configured = DocumentStorageClient::configured();

        return [
            'available'  => $configured,
            'reason'     => $configured
                ? null
                : 'No document service is configured for this deployment, so the file itself cannot be kept here — '
                    . 'record where the ' . $noun . ' is.',
            'accepts'    => self::ACCEPTS,
            'max_bytes'  => self::MAX_BYTES,
        ];
    }

    /**
     * The uploaded file, checked before it goes anywhere.
     *
     * Lives here rather than on one controller because two screens now take a
     * file — the expense's bill and the deposit's slip — and the checks have to
     * be the same on both. A second copy of this is how one of them ends up
     * accepting a 40 MB TIFF.
     *
     * The type is taken from the CONTENT, not from what the browser said it
     * was: a client-declared Content-Type is a claim by the same party that
     * chose the file.
     *
     * @param string $missing what to say when no file arrived
     * @param string $noun    what the file is, in the messages: "bill", "slip"
     * @return array{path:string, name:string, type:string}
     */
    public static function takeUpload(string $missing, string $noun = 'file'): array
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
        if ($size <= 0 || $size > self::MAX_BYTES) {
            Http::validationFailed(
                sprintf('A %s has to be under %d MB.', $noun, (int) (self::MAX_BYTES / 1024 / 1024)),
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
        if (!is_string($type) || !in_array($type, self::ACCEPTS, true)) {
            Http::validationFailed(sprintf('A %s has to be a PDF, JPG or PNG.', $noun), ['field' => 'file']);
        }

        $name = basename((string) ($file['name'] ?? $noun));

        return ['path' => $path, 'name' => $name === '' ? $noun : $name, 'type' => $type];
    }

    /**
     * Something that reads a bill and proposes the fields.
     *
     * Same switch the payables dashboard reads, so "AI can read a bill" is one
     * answer in this product rather than one per screen.
     *
     * @return array{available:bool, reason:?string}
     */
    public static function extraction(): array
    {
        $configured = DocumentExtractionClient::configured();

        return [
            'available' => $configured,
            'reason'    => $configured
                ? null
                : 'Needs a document-extraction service, and none is configured for this deployment. Typing the '
                    . 'details records exactly the same expense.',
        ];
    }
}
