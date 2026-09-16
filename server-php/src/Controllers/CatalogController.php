<?php

declare(strict_types=1);

namespace Aicountly\Api\Controllers;

use Aicountly\Api\Clients\BooksClient;
use Aicountly\Api\Clients\InventoryClient;
use Aicountly\Api\Db;
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
    public static function items(): void
    {
        [$auth, $ctx] = self::enter();
        self::relay((new InventoryClient())->withSession($auth->sesKey())->items($ctx, [
            'q'      => Http::param('q'),
            'limit'  => Http::intParam('limit', 50),
            'offset' => Http::intParam('offset', 0),
        ]), $ctx, $auth);
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
