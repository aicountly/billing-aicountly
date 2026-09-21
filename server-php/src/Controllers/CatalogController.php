<?php

declare(strict_types=1);

namespace Aicountly\Api\Controllers;

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
     * The item list behind the Items screen and the billing pickers.
     *
     * Filtering, sorting and paging all happen in Inventory, because Inventory
     * is the only thing that can do them across the whole catalogue instead of
     * across the twenty-five rows that happen to be in hand. What happens here
     * is the shaping: one row shape for the browser, and a check that the
     * narrowing that was asked for was actually applied. See ItemCatalog.
     */
    public static function items(): void
    {
        [$auth, $ctx] = self::enter();

        $filters = ItemCatalog::filtersFromRequest();
        // The billing pickers call this with `q` and a limit and nothing else,
        // and 50 is the page they have always been given.
        if (Http::param('limit') === null) {
            $filters['limit'] = 50;
        }

        self::relay((new ItemCatalog($ctx, $auth))->page($filters), $ctx, $auth);
    }

    /**
     * The five figures at the top of the Items screen.
     *
     * Each one carries its own availability. A count Inventory could not give
     * is returned as null with the reason, and the card says "Unavailable" —
     * it is not rendered as 0, because a zero and an outage look identical on
     * screen and one of them means there is nothing to worry about.
     */
    public static function itemStats(): void
    {
        [$auth, $ctx] = self::enter();
        self::assertMaySeeCatalogue($ctx, $auth);

        Http::data((new ItemCatalog($ctx, $auth))->stats());
    }

    /**
     * Item groups, for the filter. Inventory's own, never a list kept here.
     *
     * Shaped to `{group_id, group_name}` on the way through for the same reason
     * the items are: which spelling arrives differs by deployment, and the
     * browser should be reading a list, not a naming convention.
     */
    public static function itemGroups(): void
    {
        [$auth, $ctx] = self::enter();
        self::assertMaySeeCatalogue($ctx, $auth);

        $result = (new InventoryClient())->withSession($auth->sesKey())->itemGroups($ctx);
        if (!$result['ok']) {
            self::relay($result, $ctx, $auth);
        }

        $groups = [];
        foreach ((array) ($result['body']['data'] ?? []) as $row) {
            if (!is_array($row)) {
                continue;
            }
            $id = ItemCatalog::pickInt($row, ['item_group_id', 'group_id', 'category_id', 'id']);
            $name = ItemCatalog::pickString($row, ['item_group_name', 'group_name', 'category_name', 'name', 'label']);
            if ($id === null || $name === null) {
                continue;
            }
            $groups[] = ['group_id' => $id, 'group_name' => $name];
        }

        // Alphabetical, because a filter list is read by eye and Inventory's
        // own order is its insertion order.
        usort($groups, static fn (array $a, array $b) => strcasecmp($a['group_name'], $b['group_name']));

        Http::list($groups, count($groups), count($groups), 0, ['source' => 'inventory']);
    }

    /**
     * The catalogue as a file — the FULL filtered set, not the page on screen.
     *
     * A separate permission from looking at it, exactly as the reports are: a
     * person may be trusted to look an item up at the counter and not to walk
     * out with the price list.
     */
    public static function exportItems(): void
    {
        [$auth, $ctx] = self::enter();
        self::assertMaySeeCatalogue($ctx, $auth);
        Permissions::assert($ctx, $auth, 'export.data');

        $filters = ItemCatalog::filtersFromRequest();
        $csv = (new ItemCatalog($ctx, $auth))->exportCsv($filters);

        \Aicountly\Api\Audit::record($ctx, $auth, 'items.exported', 'catalog', 0, null, [
            'filters' => array_filter($filters, static fn ($value) => $value !== null && $value !== ''),
        ]);

        if (PHP_SAPI === 'cli') {
            Http::json(200, ['data' => ['csv' => $csv]]);
        }

        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="items-' . date('Y-m-d') . '.csv"');
        header('Cache-Control: no-store');
        // A BOM, so Excel opens the rupee sign and Indian names as UTF-8
        // rather than as mojibake.
        echo "\xEF\xBB\xBF" . $csv;
        exit;
    }

    /**
     * May this profile look at the item catalogue at all?
     *
     * Whoever may see what is being sold or bought may look items up — the
     * purchase operator holds no `sale.view` and still needs the list. This is
     * the same pair the menu is built from, checked again here because a menu
     * that does not draw an entry has not stopped anyone typing the URL.
     */
    private static function assertMaySeeCatalogue(Context $ctx, Auth $auth): void
    {
        if (Permissions::allows($ctx, $auth, 'sale.view') || Permissions::allows($ctx, $auth, 'purchase.view')) {
            return;
        }

        Http::forbidden('Your Billing profile does not include the item catalogue.');
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

    /**
     * One item, by its id, in the same shape the list uses.
     *
     * The billing screens are opened with an item already chosen — from the
     * Items screen, from the biller desk — and the id in that URL is a request,
     * not a fact: the name, the rate and the stock have to come from the
     * product that owns them on this request, whoever typed the id.
     */
    public static function item(string $id): void
    {
        [$auth, $ctx] = self::enter();

        $itemId = (int) $id;
        if ($itemId <= 0) {
            Http::validationFailed('That is not an item id.', ['field' => 'id']);
        }

        $result = (new InventoryClient())->withSession($auth->sesKey())->item($ctx, $itemId);
        if ($result['ok'] && is_array($result['body']['data'] ?? null)) {
            $result['body']['data'] = ItemCatalog::normalise($result['body']['data']);
        }

        self::relay($result, $ctx, $auth);
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
