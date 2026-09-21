<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

use Aicountly\Api\Env;

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
     * `available` is false in this build whichever way the environment is set,
     * and that is the honest answer rather than an oversight: Billing has no
     * client that puts a file into a document service, so configuring one would
     * not make a drop zone work. The reason distinguishes the two cases, so
     * whoever picks this up knows which half is missing — and when the client
     * lands, this method is the one line that changes.
     *
     * @return array{available:bool, reason:string, accepts:list<string>, max_bytes:int}
     */
    public static function storage(): array
    {
        $configured = Env::get('DOCUMENT_STORAGE_BASE') !== '';

        return [
            'available'  => false,
            'reason'     => $configured
                ? 'A document service is configured, but Billing does not send bill files to it yet — record where the '
                    . 'bill is kept.'
                : 'No document service here, so the file itself cannot be kept — record where the bill is.',
            'accepts'    => self::ACCEPTS,
            'max_bytes'  => self::MAX_BYTES,
        ];
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
        $configured = Env::get('DOCUMENT_EXTRACTION_BASE') !== '';

        return [
            'available' => $configured,
            'reason'    => $configured
                ? null
                : 'Needs a document-extraction service, and none is configured for this deployment. Typing the '
                    . 'details records exactly the same expense.',
        ];
    }
}
