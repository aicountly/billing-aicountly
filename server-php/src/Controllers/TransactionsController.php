<?php

declare(strict_types=1);

namespace Aicountly\Api\Controllers;

use Aicountly\Api\Domain\StatutoryService;
use Aicountly\Api\Domain\TransactionService;
use Aicountly\Api\Http;

/**
 * One route per thing a user can record, all going through one service.
 *
 * The URLs use the accounting names (`sale`, `receipt`, `contra`) because that
 * is what the API is; the SCREENS use the shopkeeper's names ("Money received",
 * "Bank deposit"), which is what the product is for.
 */
final class TransactionsController extends Controller
{
    public static function create(string $kind): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new TransactionService($ctx, $auth))->create($kind, Http::body()), 201);
    }

    public static function show(string $id): void
    {
        [$auth, $ctx] = self::enter();

        $request = (new TransactionService($ctx, $auth))->find((int) $id);
        if ($request === []) {
            Http::notFound('That transaction does not exist.');
        }

        Http::data($request);
    }

    /** Retry a save that did not reach Books, on its original idempotency key. */
    public static function retry(string $id): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new TransactionService($ctx, $auth))->post((int) $id));
    }

    /**
     * Transactions that have not reached Books.
     *
     * Deliberately only the unfinished ones — the list of what was actually
     * billed is Books' register, read live.
     */
    public static function unfinished(): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new TransactionService($ctx, $auth))->unfinished(Http::intParam('limit', 50) ?? 50));
    }

    public static function statutoryStatus(string $id): void
    {
        [$auth, $ctx] = self::enter();

        $request = (new TransactionService($ctx, $auth))->find((int) $id);
        if ($request === [] || $request['books_voucher_id'] === null) {
            Http::notFound('That bill has not been posted yet.');
        }

        Http::data((new StatutoryService($ctx, $auth))->status((int) $request['books_voucher_id']));
    }

    /** `what` is einvoice | eway | both. */
    public static function generateStatutory(string $id, string $what): void
    {
        [$auth, $ctx] = self::enter();

        if (!in_array($what, ['einvoice', 'eway', 'both'], true)) {
            Http::validationFailed('Ask for einvoice, eway or both.');
        }

        Http::data((new StatutoryService($ctx, $auth))->generate((int) $id, $what, Http::body()));
    }
}
