<?php

declare(strict_types=1);

namespace Aicountly\Api\Controllers;

use Aicountly\Api\Audit;
use Aicountly\Api\Domain\PartyDirectory;
use Aicountly\Api\Http;
use Aicountly\Api\Permissions;

/**
 * The party directory screen.
 *
 * Reads only. Billing does not own a party and does not create one here: a
 * customer is a ledger account in Smart Books, and a second place to create one
 * is a second place for the same customer to exist under two names. What these
 * endpoints do is compose one screen's worth of Books' own answers — the
 * account, its open bills, its credit limit — on the request that draws it.
 *
 * @see \Aicountly\Api\Domain\PartyDirectory
 */
final class PartiesController extends Controller
{
    /**
     * Who may open the directory at all.
     *
     * The menu entry asks for `sale.view`. The endpoint accepts either side of
     * the business, so a purchase operator — who holds `purchase.view` and no
     * selling permission — can look up a supplier instead of being refused a
     * screen they have every reason to use. Which HALF they see is decided
     * again, per side, inside PartyDirectory.
     */
    private static function directory(): PartyDirectory
    {
        [$auth, $ctx] = self::enter();

        $directory = new PartyDirectory($ctx, $auth);
        if (!$directory->maySeeCustomers() && !$directory->maySeeSuppliers()) {
            Http::forbidden('Your Billing profile does not include the party directory.');
        }

        return $directory;
    }

    public static function index(): void
    {
        $directory = self::directory();
        $query = self::query();

        $page = $directory->page($query);

        Http::list($page['rows'], $page['total'] ?? count($page['rows']), (int) $query['limit'], (int) $query['offset'], [
            // `total` is a claim about the whole list; when it could not be
            // established, the client is told rather than left to trust it.
            'total_known' => $page['total'] !== null,
            'complete'    => $page['complete'],
            'sides'       => $page['sides'],
            'source'      => 'books',
            'note'        => 'Read from Smart Books on this request. Billing keeps no copy of a party.',
        ]);
    }

    public static function overview(): void
    {
        Http::data(self::directory()->overview());
    }

    public static function duplicates(): void
    {
        $result = self::directory()->duplicates();

        Http::data([
            'groups'   => $result['groups'],
            'complete' => $result['complete'],
            'note'     => $result['complete']
                ? 'Matched on GSTIN, phone, email and name. Nothing is merged here — the party master belongs to Smart Books.'
                : 'Too many parties to compare in one pass, so this is only part of the picture.',
        ]);
    }

    /**
     * The list on screen, as a file.
     *
     * A separate permission from reading it: a person may be trusted to look up
     * a customer and not to walk out with the whole customer list. Refuses a
     * partial reading outright, because a short export is one nobody can tell
     * is short.
     */
    public static function export(): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'export.data');

        $directory = new PartyDirectory($ctx, $auth);
        if (!$directory->maySeeCustomers() && !$directory->maySeeSuppliers()) {
            Http::forbidden('Your Billing profile does not include the party directory.');
        }

        $query = self::query();
        $result = $directory->all($query);

        if (!$result['complete']) {
            Http::error(
                409,
                'export_incomplete',
                'There are more parties than this export can read in one pass, so the file would be short. Narrow it with a filter and try again.',
            );
        }

        $csv = PartyDirectory::toCsv($result['rows']);

        Audit::record($ctx, $auth, 'parties.exported', 'party', 0, null, [
            'rows' => count($result['rows']),
            'side' => $query['side'],
        ]);

        if (PHP_SAPI === 'cli') {
            Http::json(200, ['data' => ['csv' => $csv]]);
        }

        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="parties-' . gmdate('Y-m-d') . '.csv"');
        header('Cache-Control: no-store');
        // A BOM, so Excel opens ₹ and Indian names as UTF-8 rather than mojibake.
        echo "\xEF\xBB\xBF" . $csv;
        exit;
    }

    /**
     * The filters, clamped.
     *
     * Everything is an allow-list. An unknown sort or an unknown status falls
     * back to the neutral value rather than being passed onward, so a query
     * string cannot ask for a reading nobody wrote.
     *
     * @return array<string, mixed>
     */
    private static function query(): array
    {
        $limit = Http::intParam('limit', 20) ?? 20;
        $offset = Http::intParam('offset', 0) ?? 0;
        $page = Http::intParam('page', 0) ?? 0;
        if ($page > 1 && $offset === 0) {
            $offset = ($page - 1) * $limit;
        }

        return [
            'side'     => self::oneOf(Http::param('side'), ['all', 'customer', 'supplier'], 'all'),
            'q'        => Http::param('q'),
            'limit'    => max(1, min(Http::MAX_LIMIT, $limit)),
            'offset'   => max(0, $offset),
            'status'   => self::oneOf(Http::param('status'), ['all', 'active', 'inactive'], 'all'),
            'state'    => Http::param('state', 'all'),
            'group'    => Http::param('group', 'all'),
            'city'     => Http::param('city', ''),
            'balance'  => self::oneOf(Http::param('balance'), ['any', 'outstanding', 'settled', 'overdue'], 'any'),
            'credit'   => self::oneOf(Http::param('credit'), ['any', 'within', 'over', 'none'], 'any'),
            'gst'      => self::oneOf(Http::param('gst'), ['any', 'registered', 'unregistered'], 'any'),
            'activity' => self::oneOf(Http::param('activity'), ['any', 'last_7', 'last_30', 'last_90', 'none'], 'any'),
            'sort'     => self::oneOf(
                Http::param('sort'),
                ['name', 'outstanding', 'overdue', 'credit_limit', 'last_transaction', 'updated_at', 'state'],
                'name',
            ),
            'order'    => self::oneOf(strtolower((string) (Http::param('order') ?? 'asc')), ['asc', 'desc'], 'asc'),
        ];
    }

    /** @param list<string> $allowed */
    private static function oneOf(?string $value, array $allowed, string $fallback): string
    {
        return $value !== null && in_array($value, $allowed, true) ? $value : $fallback;
    }
}
