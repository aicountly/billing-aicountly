<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

use Aicountly\Api\Clients\InventoryClient;
use Aicountly\Api\Context;

/**
 * The Items workspace, composed out of Aicountly Inventory on every request.
 *
 * NOTHING HERE IS STORED. There is no billing_items table, no nightly refresh
 * and no "cache" row: an item's name, group, unit, rate, status and stock are
 * Inventory's answers to this request and are forgotten when it ends. That is
 * the same rule the rest of this product follows, and it is the reason the
 * screen searches and pages against Inventory instead of a local copy.
 *
 * What this class does add is a SHAPE. Inventory's list is the authority, but
 * different releases of it have spelt the same fact more than one way
 * (`item_name` / `name`, `mrp` / `sale_rate`, `is_active` / `status`), and a
 * table that reads one spelling and blanks the other looks broken rather than
 * upstream-shaped. So each row is returned exactly as Inventory sent it, plus
 * one extra `catalog` key holding the facts this screen draws, resolved from
 * whichever spelling arrived. Existing callers of `v1/catalog/items` — the
 * global search, the line pickers — read the original keys and are untouched.
 *
 * Three states, never four: ready, loading, and unavailable-with-a-reason. A
 * quantity Inventory did not send comes back `null` and is drawn as Unavailable.
 * It is never drawn as nought, because a nought and an outage look identical on
 * screen and one of them means the shelf is empty.
 */
final class ItemCatalog
{
    /** Columns the workspace may sort by. Anything else is ignored rather than guessed at. */
    public const SORTABLE = ['name', 'sku', 'hsn_sac', 'rate', 'stock', 'status'];

    /** Rows one export may read, across however many pages Inventory serves them in. */
    private const EXPORT_CAP = 5000;

    private const PAGE_SIZE = 200;

    public function __construct(
        private readonly InventoryClient $inventory,
        private readonly Context $ctx,
    ) {
    }

    // -----------------------------------------------------------------------
    // The list
    // -----------------------------------------------------------------------

    /**
     * One page of the catalogue.
     *
     * @param array<string, mixed> $filters q, type, group_id, status, stock_status,
     *                                      warehouse_id, sort, order, limit, offset,
     *                                      with_stock
     * @return array{ok:bool, status:int, error:?string, rows:list<array<string, mixed>>,
     *               total:?int, limit:int, offset:int, stock_source:string}
     */
    public function page(array $filters): array
    {
        $limit  = max(1, min(self::PAGE_SIZE, (int) ($filters['limit'] ?? 25)));
        $offset = max(0, (int) ($filters['offset'] ?? 0));

        // "Running low" is a question Inventory answers with a different report,
        // and its own reorder levels are the only correct answer to it. Deciding
        // it here out of a quantity and a guessed threshold would be Billing
        // inventing a stock rule.
        $lowOnly = ($filters['stock_status'] ?? '') === 'low';

        $response = $lowOnly
            ? $this->inventory->replenishment($this->ctx, ['limit' => $limit, 'offset' => $offset] + $this->warehouse($filters))
            : $this->inventory->items($this->ctx, $this->query($filters, $limit, $offset));

        if (!$response['ok']) {
            return [
                'ok'           => false,
                'status'       => $response['status'] === 0 ? 503 : $response['status'],
                'error'        => $response['error'] === null ? null : (string) $response['error'],
                'rows'         => [],
                'total'        => null,
                'limit'        => $limit,
                'offset'       => $offset,
                'stock_source' => 'unavailable',
            ];
        }

        $body = is_array($response['body']) ? $response['body'] : [];
        $rows = [];
        foreach ((array) ($body['data'] ?? []) as $row) {
            if (is_array($row)) {
                $rows[] = self::describe($row);
            }
        }

        // The list response usually carries the quantity already. When it does
        // not, ONE batched call fills the whole page — never one per row, which
        // is the loop the cross-service rules exist to forbid.
        //
        // Only for a caller that draws a Stock column, though. The pickers and
        // the barcode probe read this same endpoint and show a name and a rate,
        // and charging them a second round trip to Inventory for a number they
        // never paint is how a fast screen becomes a slow one.
        $stockSource = 'list';
        if (!$lowOnly && ($filters['with_stock'] ?? false) && self::wantsStock($rows)) {
            $stockSource = $this->fillStock($rows, $filters) ? 'stock-balances' : 'unavailable';
        }

        return [
            'ok'           => true,
            'status'       => 200,
            'error'        => null,
            'rows'         => $rows,
            'total'        => self::readTotal($body),
            'limit'        => $limit,
            'offset'       => $offset,
            'stock_source' => $stockSource,
        ];
    }

    /**
     * The five figures above the table.
     *
     * Each is Inventory's own count for the filter behind the matching tab, so
     * a card and the tab it heads cannot disagree. A count Inventory cannot
     * answer comes back null and the card says Unavailable.
     *
     * @return array{total:?int, stock:?int, service:?int, low_stock:?int, inactive:?int, reason:?string}
     */
    public function stats(): array
    {
        $total = $this->count([]);

        // Inventory unreachable: say so once rather than spending four more
        // timeouts discovering the same thing.
        if ($total === null) {
            return ['total' => null, 'stock' => null, 'service' => null, 'low_stock' => null, 'inactive' => null,
                    'reason' => 'Aicountly Inventory did not answer.'];
        }

        $stock    = $this->count(['type' => 'stock']);
        $service  = $this->count(['type' => 'service']);
        $inactive = $this->count(['status' => 'inactive']);

        // A filter the upstream release does not honour comes back as the whole
        // catalogue twice over. Reporting that as a breakdown would be inventing
        // one, so both halves are withdrawn instead.
        $reason = null;
        if ($total > 0 && $stock === $total && $service === $total) {
            $stock = null;
            $service = null;
            $reason = 'Aicountly Inventory did not split this catalogue by type.';
        }

        $low = $this->inventory->replenishment($this->ctx, ['limit' => 1]);

        return [
            'total'     => $total,
            'stock'     => $stock,
            'service'   => $service,
            'low_stock' => $low['ok'] ? self::readTotal(is_array($low['body']) ? $low['body'] : []) : null,
            'inactive'  => $inactive,
            'reason'    => $reason,
        ];
    }

    /**
     * Every row behind the current filters, for an export.
     *
     * Paged rather than asked for in one go, and capped: an unbounded export is
     * a denial-of-service one query string long, and the cap is reported so the
     * file never quietly ends early.
     *
     * @param array<string, mixed> $filters
     * @return array{ok:bool, rows:list<array<string, mixed>>, truncated:bool, error:?string}
     */
    public function all(array $filters): array
    {
        $rows = [];
        $offset = 0;

        while (count($rows) < self::EXPORT_CAP) {
            $page = $this->page(['limit' => self::PAGE_SIZE, 'offset' => $offset] + $filters);
            if (!$page['ok']) {
                return ['ok' => false, 'rows' => $rows, 'truncated' => false, 'error' => $page['error']];
            }

            $rows = array_merge($rows, $page['rows']);
            if (count($page['rows']) < self::PAGE_SIZE) {
                return ['ok' => true, 'rows' => $rows, 'truncated' => false, 'error' => null];
            }
            $offset += self::PAGE_SIZE;
        }

        return ['ok' => true, 'rows' => array_slice($rows, 0, self::EXPORT_CAP), 'truncated' => true, 'error' => null];
    }

    /**
     * A named set of items, for an export of what somebody ticked.
     *
     * One call for the whole selection — Inventory's own bulk lookup, which is
     * the hoisted version of the per-row loop the cross-service rules forbid.
     *
     * @param list<int> $itemIds
     * @return array{ok:bool, rows:list<array<string, mixed>>, truncated:bool, error:?string}
     */
    public function byIds(array $itemIds): array
    {
        $ids = array_values(array_unique(array_filter($itemIds, static fn (int $id) => $id > 0)));
        if ($ids === []) {
            return ['ok' => true, 'rows' => [], 'truncated' => false, 'error' => null];
        }

        $truncated = count($ids) > self::EXPORT_CAP;
        $response = $this->inventory->bulkLookupItems($this->ctx, array_slice($ids, 0, self::EXPORT_CAP));
        if (!$response['ok']) {
            return ['ok' => false, 'rows' => [], 'truncated' => false, 'error' => $response['error'] === null ? null : (string) $response['error']];
        }

        $rows = [];
        foreach ((array) (is_array($response['body']) ? ($response['body']['data'] ?? []) : []) as $row) {
            if (is_array($row)) {
                $rows[] = self::describe($row);
            }
        }
        if (self::wantsStock($rows)) {
            $this->fillStock($rows, []);
        }

        return ['ok' => true, 'rows' => $rows, 'truncated' => $truncated, 'error' => null];
    }

    /**
     * One item's full record, for the detail panel.
     *
     * @return array{ok:bool, status:int, error:?string, row:?array<string, mixed>}
     */
    public function one(int $itemId): array
    {
        $response = $this->inventory->item($this->ctx, $itemId);
        if (!$response['ok']) {
            return [
                'ok'     => false,
                'status' => $response['status'] === 0 ? 503 : $response['status'],
                'error'  => $response['error'] === null ? null : (string) $response['error'],
                'row'    => null,
            ];
        }

        $body = is_array($response['body']) ? $response['body'] : [];
        $data = $body['data'] ?? null;
        if (!is_array($data)) {
            return ['ok' => false, 'status' => 404, 'error' => 'That item is not in Aicountly Inventory.', 'row' => null];
        }

        $row = self::describe($data);
        $rows = [$row];
        if (self::wantsStock($rows)) {
            $this->fillStock($rows, []);
        }

        return ['ok' => true, 'status' => 200, 'error' => null, 'row' => $rows[0]];
    }

    // -----------------------------------------------------------------------
    // CSV
    // -----------------------------------------------------------------------

    /**
     * @param list<array<string, mixed>> $rows
     */
    public static function toCsv(array $rows, bool $withCost): string
    {
        $header = ['Item', 'Description', 'SKU', 'HSN/SAC', 'Type', 'Group', 'Unit', 'Rate', 'Stock', 'Status'];
        if ($withCost) {
            $header[] = 'Cost';
        }

        $handle = fopen('php://temp', 'r+');
        if ($handle === false) {
            return '';
        }
        // The escape character is passed explicitly: PHP 8.4 deprecates leaving
        // it out, and '' is both the value PHP is moving to and the one RFC 4180
        // describes — a backslash in an item name should be a backslash.
        fputcsv($handle, $header, ',', '"', '');

        foreach ($rows as $row) {
            $view = is_array($row['catalog'] ?? null) ? $row['catalog'] : [];
            $stock = is_array($view['stock'] ?? null) ? $view['stock'] : [];
            $group = is_array($view['group'] ?? null) ? $view['group'] : [];

            $line = [
                (string) ($view['name'] ?? ''),
                (string) ($view['description'] ?? ''),
                (string) ($view['sku'] ?? ''),
                (string) ($view['hsn_sac'] ?? ''),
                (string) ($view['type'] ?? ''),
                (string) ($group['name'] ?? ''),
                (string) ($view['unit'] ?? ''),
                $view['rate'] === null ? '' : (string) $view['rate'],
                // An unknown quantity is written as "unavailable", never as 0 —
                // the spreadsheet has to be as honest as the screen.
                ($view['type'] ?? '') === 'service'
                    ? ''
                    : (($stock['available'] ?? null) === null ? 'unavailable' : (string) $stock['available']),
                (string) ($view['status'] ?? ''),
            ];
            if ($withCost) {
                $line[] = ($view['cost'] ?? null) === null ? '' : (string) $view['cost'];
            }
            fputcsv($handle, $line, ',', '"', '');
        }

        rewind($handle);
        $csv = (string) stream_get_contents($handle);
        fclose($handle);

        return $csv;
    }

    // -----------------------------------------------------------------------
    // Shaping
    // -----------------------------------------------------------------------

    /**
     * Inventory's row, plus the `catalog` view the workspace draws.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    public static function describe(array $row): array
    {
        $type = self::readType($row);
        $available = self::readNumber($row, ['available_qty', 'available_quantity', 'stock_qty', 'stock_quantity', 'closing_qty', 'qty_on_hand', 'quantity_on_hand', 'balance_qty']);
        $threshold = self::readNumber($row, ['low_stock_threshold', 'reorder_level', 'reorder_point', 'min_qty', 'minimum_qty', 'safety_stock']);

        $row['catalog'] = [
            'id'          => self::readInt($row, ['item_id', 'id']),
            'name'        => self::readString($row, ['item_name', 'name', 'title']),
            'description' => self::readString($row, ['description', 'item_description', 'short_description', 'variant', 'specification']),
            'sku'         => self::readString($row, ['item_sku', 'sku', 'item_code', 'code']),
            'hsn_sac'     => self::readString($row, ['hsn_sac', 'hsn', 'sac', 'hsn_code']),
            'barcode'     => self::readString($row, ['barcode', 'ean', 'upc']),
            'type'        => $type,
            'group'       => self::readGroup($row),
            'unit'        => self::readUnit($row),
            'rate'        => self::readNumber($row, ['mrp', 'sale_rate', 'selling_price', 'sales_rate', 'rate', 'price']),
            // Absent for anyone without cost.view: CatalogController strips the
            // source fields before this ever reaches a browser.
            'cost'        => self::readNumber($row, ['unit_cost', 'cost', 'cost_rate', 'valuation_rate', 'purchase_rate', 'last_purchase_rate']),
            'status'      => self::readStatus($row),
            'image_url'   => self::readString($row, ['image_url', 'image', 'thumbnail_url', 'photo_url']),
            'stock'       => [
                // A service has no quantity, and showing it one would be a lie
                // with a number on it.
                'applicable' => $type !== 'service',
                'available'  => $type === 'service' ? null : $available,
                'threshold'  => $threshold,
                'state'      => $type === 'service' ? null : self::stockState($available, $threshold),
            ],
            'source'      => 'inventory',
        ];

        return $row;
    }

    private static function stockState(?float $available, ?float $threshold): ?string
    {
        if ($available === null) {
            return null;
        }
        if ($available <= 0.0) {
            return 'out';
        }
        if ($threshold !== null && $threshold > 0.0 && $available <= $threshold) {
            return 'low';
        }

        return 'normal';
    }

    // -----------------------------------------------------------------------
    // Inventory's query
    // -----------------------------------------------------------------------

    /**
     * @param array<string, mixed> $filters
     * @return array<string, mixed>
     */
    private function query(array $filters, int $limit, int $offset): array
    {
        $sort = in_array((string) ($filters['sort'] ?? ''), self::SORTABLE, true) ? (string) $filters['sort'] : null;
        $order = strtolower((string) ($filters['order'] ?? 'asc')) === 'desc' ? 'desc' : 'asc';

        return array_filter([
            'q'            => self::text($filters['q'] ?? null),
            'type'         => in_array($filters['type'] ?? '', ['stock', 'service'], true) ? $filters['type'] : null,
            'group_id'     => self::positive($filters['group_id'] ?? null),
            'status'       => in_array($filters['status'] ?? '', ['active', 'inactive'], true) ? $filters['status'] : null,
            'stock_status' => in_array($filters['stock_status'] ?? '', ['out'], true) ? $filters['stock_status'] : null,
            'sort'         => $sort,
            'order'        => $sort === null ? null : $order,
            'limit'        => $limit,
            'offset'       => $offset,
        ] + $this->warehouse($filters), static fn ($value) => $value !== null);
    }

    /** @return array<string, mixed> */
    private function warehouse(array $filters): array
    {
        $warehouse = self::positive($filters['warehouse_id'] ?? null);

        return $warehouse === null ? [] : ['warehouse_id' => $warehouse];
    }

    /** @param array<string, mixed> $filters */
    private function count(array $filters): ?int
    {
        $response = $this->inventory->items($this->ctx, $this->query($filters, 1, 0));
        if (!$response['ok']) {
            return null;
        }

        return self::readTotal(is_array($response['body']) ? $response['body'] : []);
    }

    /**
     * Fill in quantities the list response did not carry — one call for the page.
     *
     * @param list<array<string, mixed>> $rows
     * @param array<string, mixed>       $filters
     */
    private function fillStock(array &$rows, array $filters): bool
    {
        $ids = [];
        foreach ($rows as $row) {
            $view = $row['catalog'];
            if ($view['stock']['applicable'] === true && $view['stock']['available'] === null && $view['id'] !== null) {
                $ids[] = $view['id'];
            }
        }
        if ($ids === []) {
            return true;
        }

        $response = $this->inventory->stockBalances($this->ctx, [
            'item_ids' => implode(',', array_unique($ids)),
            'limit'    => self::PAGE_SIZE,
        ] + $this->warehouse($filters));

        if (!$response['ok']) {
            return false;
        }

        // A balance may arrive per warehouse. Consolidated scope wants the sum;
        // a chosen branch was already passed upstream as the filter.
        $byItem = [];
        foreach ((array) (is_array($response['body']) ? ($response['body']['data'] ?? []) : []) as $balance) {
            if (!is_array($balance)) {
                continue;
            }
            $itemId = self::readInt($balance, ['item_id', 'id']);
            $qty = self::readNumber($balance, ['available_qty', 'available_quantity', 'closing_qty', 'balance_qty', 'quantity', 'qty']);
            if ($itemId === null || $qty === null) {
                continue;
            }
            $byItem[$itemId] = ($byItem[$itemId] ?? 0.0) + $qty;
        }

        foreach ($rows as $index => $row) {
            $view = $row['catalog'];
            $id = $view['id'];
            if ($id === null || !array_key_exists($id, $byItem)) {
                continue;
            }
            $rows[$index]['catalog']['stock']['available'] = $byItem[$id];
            $rows[$index]['catalog']['stock']['state'] = self::stockState($byItem[$id], $view['stock']['threshold']);
        }

        return true;
    }

    /** @param list<array<string, mixed>> $rows */
    private static function wantsStock(array $rows): bool
    {
        foreach ($rows as $row) {
            if ($row['catalog']['stock']['applicable'] === true && $row['catalog']['stock']['available'] === null) {
                return true;
            }
        }

        return false;
    }

    // -----------------------------------------------------------------------
    // Reading whatever spelling arrived
    // -----------------------------------------------------------------------

    /** @param array<string, mixed> $body */
    private static function readTotal(array $body): ?int
    {
        $meta = $body['meta'] ?? null;
        if (is_array($meta) && isset($meta['total']) && is_numeric($meta['total'])) {
            return (int) $meta['total'];
        }

        return null;
    }

    /** @param array<string, mixed> $row */
    private static function readString(array $row, array $keys): ?string
    {
        foreach ($keys as $key) {
            $value = $row[$key] ?? null;
            if (is_string($value) && trim($value) !== '') {
                return trim($value);
            }
            if (is_int($value) || is_float($value)) {
                return (string) $value;
            }
        }

        return null;
    }

    /** @param array<string, mixed> $row */
    private static function readInt(array $row, array $keys): ?int
    {
        foreach ($keys as $key) {
            $value = $row[$key] ?? null;
            if (is_numeric($value)) {
                return (int) $value;
            }
        }

        return null;
    }

    /** @param array<string, mixed> $row */
    private static function readNumber(array $row, array $keys): ?float
    {
        foreach ($keys as $key) {
            $value = $row[$key] ?? null;
            if (is_numeric($value)) {
                return (float) $value;
            }
        }

        return null;
    }

    /** @param array<string, mixed> $row */
    private static function readType(array $row): ?string
    {
        $named = self::readString($row, ['item_type', 'type', 'nature']);
        if ($named !== null) {
            $lower = strtolower($named);
            if (str_contains($lower, 'service')) {
                return 'service';
            }
            if (str_contains($lower, 'stock') || str_contains($lower, 'goods') || str_contains($lower, 'product')) {
                return 'stock';
            }
        }

        foreach (['is_service', 'service_item'] as $key) {
            if (array_key_exists($key, $row)) {
                return self::truthy($row[$key]) ? 'service' : 'stock';
            }
        }
        foreach (['maintains_stock', 'is_stock_item', 'track_inventory', 'is_stocked'] as $key) {
            if (array_key_exists($key, $row)) {
                return self::truthy($row[$key]) ? 'stock' : 'service';
            }
        }

        return null;
    }

    /** @param array<string, mixed> $row */
    private static function readStatus(array $row): ?string
    {
        $named = self::readString($row, ['status', 'item_status']);
        if ($named !== null) {
            $lower = strtolower($named);
            if (str_contains($lower, 'inactive') || str_contains($lower, 'disabled') || str_contains($lower, 'archived')) {
                return 'inactive';
            }
            if (str_contains($lower, 'active')) {
                return 'active';
            }
        }

        foreach (['is_active', 'active', 'enabled'] as $key) {
            if (array_key_exists($key, $row)) {
                return self::truthy($row[$key]) ? 'active' : 'inactive';
            }
        }

        return null;
    }

    /**
     * @param array<string, mixed> $row
     * @return array{id:?int, name:?string}
     */
    private static function readGroup(array $row): array
    {
        foreach (['item_group', 'group', 'category'] as $key) {
            $value = $row[$key] ?? null;
            if (is_array($value)) {
                return [
                    'id'   => self::readInt($value, ['item_group_id', 'group_id', 'id']),
                    'name' => self::readString($value, ['item_group_name', 'group_name', 'name', 'label']),
                ];
            }
        }

        return [
            'id'   => self::readInt($row, ['item_group_id', 'group_id', 'category_id']),
            'name' => self::readString($row, ['item_group_name', 'group_name', 'item_group', 'group', 'category_name', 'category']),
        ];
    }

    /** @param array<string, mixed> $row */
    private static function readUnit(array $row): ?string
    {
        foreach (['unit', 'uom'] as $key) {
            $value = $row[$key] ?? null;
            if (is_array($value)) {
                return self::readString($value, ['unit_name', 'uom_name', 'name', 'symbol', 'code']);
            }
        }

        return self::readString($row, ['unit_name', 'uom_name', 'uom', 'unit_symbol', 'unit_code']);
    }

    private static function truthy(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if (is_numeric($value)) {
            return (float) $value !== 0.0;
        }
        if (is_string($value)) {
            return in_array(strtolower(trim($value)), ['1', 't', 'true', 'y', 'yes', 'active'], true);
        }

        return false;
    }

    private static function text(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }

    private static function positive(mixed $value): ?int
    {
        if (!is_numeric($value)) {
            return null;
        }
        $number = (int) $value;

        return $number > 0 ? $number : null;
    }
}
