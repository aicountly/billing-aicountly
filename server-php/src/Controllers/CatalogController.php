<?php

declare(strict_types=1);

namespace Aicountly\Api\Controllers;

use Aicountly\Api\Audit;
use Aicountly\Api\Auth;
use Aicountly\Api\Clients\BooksClient;
use Aicountly\Api\Clients\InventoryClient;
use Aicountly\Api\Context;
use Aicountly\Api\Db;
use Aicountly\Api\Domain\ItemCatalog;
use Aicountly\Api\Http;
use Aicountly\Api\Permissions;

/**
 * Read-through to the products that own this data.
 *
 * Every handler is a pass-through; nothing it returns is written here. They
 * exist so the browser makes one same-origin call, and so this product's own
 * profile rules apply on top — a biller without `cost.view` gets the item
 * without its purchase rate, from the same endpoint the owner uses.
 */
final class CatalogController extends Controller
{
    /**
     * The item catalogue, filtered and paged by Inventory.
     *
     * Every filter here is forwarded to the product that owns the answer. None
     * of them is applied to a local table, because there is no local table: the
     * Items screen pages against Inventory the same way the search box does.
     *
     * The response is Inventory's rows, each carrying one added `catalog` key
     * holding the facts the workspace draws. The original keys are untouched,
     * so the global search and the line pickers read exactly what they read
     * before.
     */
    public static function items(): void
    {
        [$auth, $ctx] = self::enter();

        $filters = self::itemFilters();
        $page = (new ItemCatalog(self::inventory($auth), $ctx))->page($filters + [
            'limit'      => Http::intParam('limit', 50),
            'offset'     => Http::intParam('offset', 0),
            // Off by default: only the Items workspace draws a Stock column.
            'with_stock' => Http::param('with_stock') === '1',
        ]);

        if (!$page['ok']) {
            self::upstreamFailed($page['status'], $page['error']);
        }

        Http::list(
            self::stripCost($ctx, $auth, $page['rows']),
            // Inventory did not say how many there are. -1 rather than a made-up
            // number: the footer then says "showing 1 to 25" and offers Next,
            // instead of claiming a total nobody counted.
            $page['total'] ?? -1,
            $page['limit'],
            $page['offset'],
            ['stock_source' => $page['stock_source'], 'source' => 'inventory', 'total_known' => $page['total'] !== null],
        );
    }

    /**
     * The five figures above the table.
     *
     * Counted by Inventory, per the filter behind each tab, so a card and its
     * tab cannot disagree. A figure Inventory will not count comes back null
     * and the card says so rather than showing a nought.
     */
    public static function itemStats(): void
    {
        [$auth, $ctx] = self::enter();

        $stats = (new ItemCatalog(self::inventory($auth), $ctx))->stats();

        Http::data([
            'total'     => $stats['total'],
            'stock'     => $stats['stock'],
            'services'  => $stats['service'],
            'low_stock' => $stats['low_stock'],
            'inactive'  => $stats['inactive'],
            'source'    => 'inventory',
            'reason'    => $stats['reason'],
        ]);
    }

    /** One item, for the detail panel. Read on the request that opens it. */
    public static function item(string $id): void
    {
        [$auth, $ctx] = self::enter();

        $itemId = (int) $id;
        if ($itemId <= 0) {
            Http::notFound('That item is not in Aicountly Inventory.');
        }

        $result = (new ItemCatalog(self::inventory($auth), $ctx))->one($itemId);
        if (!$result['ok']) {
            self::upstreamFailed($result['status'], $result['error']);
        }

        Http::data(self::stripCost($ctx, $auth, [$result['row']])[0]);
    }

    /** Item groups, as Inventory holds them. Billing stores no group of its own. */
    public static function itemGroups(): void
    {
        [$auth, $ctx] = self::enter();
        self::relay(self::inventory($auth)->itemGroups($ctx), $ctx, $auth);
    }

    /**
     * The current list as a file.
     *
     * Exports what the filters on screen select, not page one of it — a person
     * who narrowed to one group and pressed Export expects that group. Cost is
     * a column only for a profile that may see cost anywhere else.
     */
    public static function exportItems(): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'export.data');

        $catalog = new ItemCatalog(self::inventory($auth), $ctx);

        // A tick-box selection exports exactly what was ticked. Anything else
        // exports what the filters select — page one of it would be a file that
        // quietly disagrees with the screen that asked for it.
        $chosen = self::chosenIds();
        $filters = $chosen === [] ? self::itemFilters() + ['with_stock' => true] : ['ids' => $chosen];
        $result = $chosen === [] ? $catalog->all($filters) : $catalog->byIds($chosen);
        if (!$result['ok']) {
            self::upstreamFailed(503, $result['error']);
        }

        $withCost = Permissions::allows($ctx, $auth, 'cost.view');
        $csv = ItemCatalog::toCsv($result['rows'], $withCost);

        Audit::record($ctx, $auth, 'items.exported', 'item', 0, null, [
            'rows'      => count($result['rows']),
            'filters'   => array_filter($filters, static fn ($value) => $value !== null && $value !== ''),
            'truncated' => $result['truncated'],
        ]);

        if (PHP_SAPI === 'cli') {
            Http::json(200, ['data' => ['csv' => $csv, 'truncated' => $result['truncated']]]);
        }

        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="items-' . gmdate('Y-m-d') . '.csv"');
        header('Cache-Control: no-store');
        // A BOM, so Excel opens ₹ and Indian names as UTF-8 rather than mojibake.
        echo "\xEF\xBB\xBF" . $csv;
        exit;
    }

    /**
     * What the screen asked for, kept to the values the workspace offers.
     *
     * @return array<string, mixed>
     */
    private static function itemFilters(): array
    {
        return [
            'q'            => Http::param('q'),
            'type'         => Http::param('type'),
            'group_id'     => Http::intParam('group_id'),
            'status'       => Http::param('status'),
            'stock_status' => Http::param('stock_status'),
            'warehouse_id' => Http::intParam('warehouse_id'),
            'sort'         => Http::param('sort'),
            'order'        => Http::param('order'),
        ];
    }

    /** @return list<int> */
    private static function chosenIds(): array
    {
        $raw = (string) (Http::param('ids') ?? '');
        if ($raw === '') {
            return [];
        }

        $ids = [];
        foreach (explode(',', $raw) as $part) {
            $id = (int) trim($part);
            if ($id > 0) {
                $ids[] = $id;
            }
        }

        return array_values(array_unique($ids));
    }

    private static function inventory(Auth $auth): InventoryClient
    {
        // The SIGNED-IN USER'S key, not this product's service key: Inventory
        // applies that person's own permissions to every read, and Billing is
        // never the thing deciding what somebody may see of another product.
        return (new InventoryClient())->withSession($auth->sesKey());
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private static function stripCost(Context $ctx, Auth $auth, array $rows): array
    {
        if (Permissions::allows($ctx, $auth, 'cost.view')) {
            return $rows;
        }

        return array_values(array_map(static fn (array $row) => self::stripCostFields($row), $rows));
    }

    private static function upstreamFailed(int $status, ?string $error): never
    {
        Http::error(
            $status,
            $status === 503 ? 'upstream_unavailable' : 'upstream_error',
            $status === 503
                ? 'Could not reach Aicountly Inventory. Please try again in a moment.'
                : ($error ?? 'Aicountly Inventory refused that request.'),
        );
    }

    public static function searchItems(): void
    {
        [$auth, $ctx] = self::enter();
        $term = (string) (Http::param('q') ?? '');
        if (mb_strlen($term) < 2) {
            Http::list([], 0, 20, 0);
        }

        self::relay(
            (new InventoryClient())->withSession($auth->sesKey())->searchItems($ctx, $term, Http::intParam('limit', 20) ?? 20),
            $ctx,
            $auth,
        );
    }

    /** Scan-to-bill: the barcode goes straight to Inventory. */
    public static function itemByBarcode(string $code): void
    {
        [$auth, $ctx] = self::enter();
        self::relay((new InventoryClient())->withSession($auth->sesKey())->itemByBarcode($ctx, $code), $ctx, $auth);
    }

    /**
     * The items this user bills most, resolved through Inventory.
     *
     * We keep the ids and a counter; the name, rate and stock come from
     * Inventory on this request. That is the whole pattern in one endpoint.
     */
    public static function favourites(): void
    {
        [$auth, $ctx] = self::enter();

        $rows = Db::all(
            'SELECT item_id, use_count FROM billing_favourite_items
             WHERE cmp_id = :cmp AND (user_uuid = :uuid OR user_uuid IS NULL)
             ORDER BY use_count DESC, last_used_at DESC NULLS LAST
             LIMIT 30',
            ['cmp' => $ctx->cmpId, 'uuid' => $auth->uuid],
        );

        if ($rows === []) {
            Http::data([]);
        }

        $itemIds = array_map(static fn (array $row) => (int) $row['item_id'], $rows);
        $counts = [];
        foreach ($rows as $row) {
            $counts[(int) $row['item_id']] = (int) $row['use_count'];
        }

        $response = (new InventoryClient())->withSession($auth->sesKey())->bulkLookupItems($ctx, $itemIds);
        if (!$response['ok']) {
            // The favourites are a convenience. If Inventory is slow, the search
            // box still works, so an empty list beats an error dialog here.
            Http::data([]);
        }

        $items = [];
        foreach ((array) ($response['body']['data'] ?? []) as $item) {
            $item['use_count'] = $counts[(int) ($item['item_id'] ?? 0)] ?? 0;
            $items[] = $item;
        }
        usort($items, static fn (array $a, array $b) => ($b['use_count'] ?? 0) <=> ($a['use_count'] ?? 0));

        Http::data($items);
    }

    public static function stock(): void
    {
        [$auth, $ctx] = self::enter();

        $itemId = Http::intParam('item_id');
        if ($itemId === null) {
            Http::validationFailed('item_id is required.', ['field' => 'item_id']);
        }

        self::relay(
            (new InventoryClient())->withSession($auth->sesKey())->availability($ctx, $itemId, Http::intParam('warehouse_id')),
            $ctx,
            $auth,
        );
    }

    public static function lowStock(): void
    {
        [$auth, $ctx] = self::enter();
        self::relay(
            (new InventoryClient())->withSession($auth->sesKey())->replenishment($ctx, ['limit' => Http::intParam('limit', 20)]),
            $ctx,
            $auth,
        );
    }

    public static function warehouses(): void
    {
        [$auth, $ctx] = self::enter();
        self::relay((new InventoryClient())->withSession($auth->sesKey())->warehouses($ctx), $ctx, $auth);
    }

    /** Parties — Books' account ledgers. `side` narrows to customers or suppliers. */
    public static function parties(): void
    {
        [$auth, $ctx] = self::enter();

        $side = Http::param('side') ?? 'customer';
        self::relay((new BooksClient())->withSession($auth->sesKey())->accounts($ctx, [
            'q'          => Http::param('q'),
            'limit'      => Http::intParam('limit', 50),
            'offset'     => Http::intParam('offset', 0),
            'party_type' => $side === 'supplier' ? 'creditor' : 'debtor',
            'nature'     => $side === 'supplier' ? 'sundry_creditors' : 'sundry_debtors',
        ]), $ctx, $auth);
    }

    /** Cash and bank accounts, for "where did the money go". */
    public static function cashBankAccounts(): void
    {
        [$auth, $ctx] = self::enter();
        self::relay((new BooksClient())->withSession($auth->sesKey())->accounts($ctx, [
            'nature' => 'cash_bank',
            'limit'  => 100,
        ]), $ctx, $auth);
    }

    public static function expenseAccounts(): void
    {
        [$auth, $ctx] = self::enter();
        self::relay((new BooksClient())->withSession($auth->sesKey())->accounts($ctx, [
            'nature' => 'indirect_expenses',
            'q'      => Http::param('q'),
            'limit'  => 100,
        ]), $ctx, $auth);
    }

    public static function taxCategories(): void
    {
        [$auth, $ctx] = self::enter();
        self::relay((new BooksClient())->withSession($auth->sesKey())->taxCategories($ctx), $ctx, $auth);
    }

    /**
     * @param array{ok:bool, status:int, body:?array, error:?string} $result
     */
    private static function relay(array $result, $ctx, $auth): never
    {
        if (!$result['ok']) {
            $status = $result['status'] === 0 ? 503 : $result['status'];
            Http::error(
                $status,
                $status === 503 ? 'upstream_unavailable' : 'upstream_error',
                // Plain language, because the person reading it is at a counter
                // with a customer waiting.
                $status === 503
                    ? 'Could not reach the app that holds this information. Please try again in a moment.'
                    : (string) ($result['error'] ?? 'That request was refused.'),
            );
        }

        $body = $result['body'] ?? ['data' => []];
        if (!Permissions::allows($ctx, $auth, 'cost.view')) {
            $body = self::stripCostFields($body);
        }

        Http::json(200, $body);
    }

    /**
     * Strip cost and margin from anything relayed to a user without cost.view.
     *
     * The single most requested thing in this product: the counter staff bill,
     * and they do not see what the goods cost.
     *
     * @param array<string, mixed> $payload
     */
    private static function stripCostFields(array $payload): array
    {
        $sensitive = [
            'unit_cost', 'cost', 'cost_rate', 'valuation_rate', 'valuation_amount',
            'purchase_rate', 'last_purchase_rate', 'margin_pc', 'gross_profit',
        ];

        $walk = static function (array $node) use (&$walk, $sensitive): array {
            foreach ($node as $key => $value) {
                if (is_string($key) && in_array($key, $sensitive, true)) {
                    unset($node[$key]);
                    continue;
                }
                if (is_array($value)) {
                    $node[$key] = $walk($value);
                }
            }

            return $node;
        };

        return $walk($payload);
    }
}
