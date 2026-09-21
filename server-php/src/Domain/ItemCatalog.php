<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

use Aicountly\Api\Auth;
use Aicountly\Api\Clients\InventoryClient;
use Aicountly\Api\Context;
use Aicountly\Api\Http;

/**
 * The item catalogue, as the Items screen needs it — composed on the request.
 *
 * NOTHING HERE IS STORED. There is no items table in this product and there is
 * not going to be one: Inventory owns the item master, the groups, the units
 * and every quantity, and this class only asks it and shapes the answer. The
 * five figures at the top of the screen are five counts read from Inventory on
 * the request that draws them, not a row somebody keeps up to date.
 *
 * Two jobs, and the second is the one worth reading.
 *
 *  1. NORMALISE. Inventory answers with its own field names, and which of them
 *     are present differs by deployment. The browser should not be guessing
 *     between `mrp`, `sale_rate` and `rate`, so that guess happens once, here,
 *     and every row reaches the screen in one shape. A field that cannot be
 *     found is NULL — never 0, never "stock", never "active". The screen draws
 *     a null as "—" or "Unavailable", which is the difference between an item
 *     with no stock and an item whose stock could not be read.
 *
 *  2. CHECK THAT THE FILTER WAS HONOURED. Billing does not filter or page this
 *     list — Inventory does, because it is the only thing that can do it across
 *     the whole catalogue rather than across one page. But a filter that is
 *     passed upstream and silently ignored is the worst outcome on this screen:
 *     the Low Stock tab would quietly list everything and look like it worked.
 *     So the rows that come back are checked against the narrowing that was
 *     asked for, and a filter that was plainly not applied is reported in the
 *     meta rather than papered over. The screen says so.
 */
final class ItemCatalog
{
    /** Columns the screen may sort by. Anything else is ignored rather than passed on. */
    public const SORTABLE = ['name', 'sku', 'hsn_sac', 'rate', 'stock', 'status'];

    /**
     * Largest export this product will build in one file.
     *
     * Bounded because the set is paged out of Inventory: every page is a round
     * trip, and a request that takes forty of them is a request the web server
     * kills half-written. Beyond this the user is asked to narrow the filters,
     * which is both faster and a more useful file.
     */
    private const EXPORT_MAX = 2000;

    private InventoryClient $inventory;

    public function __construct(
        private readonly Context $ctx,
        private readonly Auth $auth,
        ?InventoryClient $inventory = null,
    ) {
        $this->inventory = $inventory ?? (new InventoryClient())->withSession($auth->sesKey());
    }

    // -----------------------------------------------------------------------
    // The list
    // -----------------------------------------------------------------------

    /**
     * One page of the catalogue, in the shape the screen reads.
     *
     * Returns the InventoryClient result shape unchanged on failure, so the
     * controller relays an upstream problem the same way it does everywhere
     * else in this product.
     *
     * @param array<string, mixed> $filters
     * @return array{ok:bool, status:int, body:?array, error:?string}
     */
    public function page(array $filters): array
    {
        $ask = self::upstreamQuery($filters);
        $result = $this->inventory->items($this->ctx, $ask);

        if (!$result['ok']) {
            return $result;
        }

        $body = is_array($result['body']) ? $result['body'] : ['data' => []];
        $raw = array_values(array_filter((array) ($body['data'] ?? []), 'is_array'));

        $rows = array_map(static fn (array $row): array => self::normalise($row), $raw);
        $rows = $this->withStock($rows);

        $meta = is_array($body['meta'] ?? null) ? $body['meta'] : [];
        $meta['limit'] = (int) $ask['limit'];
        $meta['offset'] = (int) $ask['offset'];
        if (!isset($meta['total']) || !is_numeric($meta['total'])) {
            // Inventory did not say how many there are. A short page is the
            // whole set; a full one is not, and guessing "this many" from a
            // full page is how a pager ends up claiming 25 of 25 items.
            $meta['total'] = count($rows) < (int) $ask['limit'] ? (int) $ask['offset'] + count($rows) : null;
        } else {
            $meta['total'] = (int) $meta['total'];
        }

        $meta['source'] = 'inventory';
        $meta['upstream'] = [
            'filters_ignored' => self::filtersIgnored($filters, $rows),
            'sort_applied'    => self::sortApplied($filters, $rows),
        ];

        $body['data'] = $rows;
        $body['meta'] = $meta;
        $result['body'] = $body;

        return $result;
    }

    // -----------------------------------------------------------------------
    // The five figures
    // -----------------------------------------------------------------------

    /**
     * Total, stock, services, low stock, inactive.
     *
     * Five counts, each read from Inventory with `limit=1` so the answer is a
     * total and not a page of rows nobody is going to draw. Each carries its own
     * availability: one figure Inventory cannot answer must not take the other
     * four down with it, and must not be rendered as 0 — a zero and an outage
     * look identical on screen and one of them means "nothing to worry about".
     *
     * The first failure that is a TRANSPORT failure stops the rest. Inventory
     * not answering at all is one fact, and asking it four more times only
     * costs the user four more connect timeouts before the same screen appears.
     *
     * @return array<string, array{value:?int, available:bool, reason:?string}>
     */
    public function stats(): array
    {
        $figures = [
            'total'     => [],
            'stock'     => ['type' => 'stock'],
            'services'  => ['type' => 'service'],
            'inactive'  => ['status' => 'inactive'],
        ];

        $out = [];
        $unreachable = null;

        foreach ($figures as $key => $filter) {
            if ($unreachable !== null) {
                $out[$key] = self::figure(null, $unreachable);
                continue;
            }

            $result = $this->inventory->items($this->ctx, $filter + ['limit' => 1, 'offset' => 0]);
            if (!$result['ok'] && $result['status'] === 0) {
                $unreachable = 'Aicountly Inventory is not answering.';
                $out[$key] = self::figure(null, $unreachable);
                continue;
            }

            $out[$key] = $result['ok']
                ? self::figure(self::countOf($result['body'], 1), 'Inventory did not give a total for this figure.')
                : self::figure(null, 'Inventory refused this count.');
        }

        // Running low is a report rather than a filter: Inventory decides what
        // "low" means for an item, from its own reorder levels, and Billing
        // must not re-derive it from a threshold it happens to have been shown.
        if ($unreachable !== null) {
            $out['low_stock'] = self::figure(null, $unreachable);
        } else {
            $low = $this->inventory->replenishment($this->ctx, ['limit' => 1]);
            $out['low_stock'] = $low['ok']
                ? self::figure(self::countOf($low['body'], 1), 'Inventory did not give a total for this figure.')
                : self::figure(null, 'The replenishment report could not be read.');
        }

        return $out;
    }

    // -----------------------------------------------------------------------
    // Export
    // -----------------------------------------------------------------------

    /**
     * The FULL filtered set as CSV — not the page on screen.
     *
     * Somebody who has filtered to one group and pressed Export expects that
     * group, and handing them the twenty-five rows that happened to be visible
     * is the kind of error that only surfaces once the figures are in a return.
     * So this pages through Inventory until the set is exhausted, and refuses
     * outright rather than writing a file it knows is short.
     *
     * @param array<string, mixed> $filters
     */
    public function exportCsv(array $filters): string
    {
        $rows = [];
        $offset = 0;
        $pageSize = Http::MAX_LIMIT;

        while (true) {
            $result = $this->page(['limit' => $pageSize, 'offset' => $offset] + $filters);
            if (!$result['ok']) {
                Http::error(
                    $result['status'] === 0 ? 503 : $result['status'],
                    'export_incomplete',
                    'The full list could not be read from Aicountly Inventory, so this file would be short. Please try again in a moment.',
                );
            }

            $page = (array) ($result['body']['data'] ?? []);
            foreach ($page as $row) {
                $rows[] = $row;
            }

            if (count($page) < $pageSize) {
                break;
            }
            $offset += $pageSize;

            if (count($rows) >= self::EXPORT_MAX) {
                Http::error(
                    409,
                    'export_too_large',
                    'That is more than ' . number_format(self::EXPORT_MAX) . ' items. Narrow the filters and try again.',
                );
            }
        }

        $handle = fopen('php://temp', 'r+');
        if ($handle === false) {
            Http::error(500, 'export_failed', 'Could not build the file.');
        }

        fputcsv($handle, ['Item', 'Description', 'SKU', 'HSN/SAC', 'Type', 'Group', 'Unit', 'Rate', 'Stock', 'Status']);

        foreach ($rows as $row) {
            // Every text cell through ReportService::cell(), which is where this
            // product decides what to do about a value that begins with `=`.
            // An item named by somebody else becomes a formula the moment the
            // file is opened, and Inventory is somebody else.
            fputcsv($handle, [
                ReportService::cell($row['item_name'] ?? ''),
                ReportService::cell($row['description'] ?? ''),
                ReportService::cell($row['item_sku'] ?? ''),
                ReportService::cell($row['hsn_sac'] ?? ''),
                $row['type'] === null ? '' : ucfirst((string) $row['type']),
                ReportService::cell($row['group']['name'] ?? ''),
                ReportService::cell($row['unit_name'] ?? ''),
                $row['rate'] === null ? '' : (string) $row['rate'],
                // A service has no stock and an unreadable stock is not zero.
                // Both are left blank rather than written as a number somebody
                // will later total.
                ($row['stock']['available'] ?? null) === null ? '' : (string) $row['stock']['available'],
                self::statusWord($row),
            ]);
        }

        rewind($handle);
        $csv = (string) stream_get_contents($handle);
        fclose($handle);

        return $csv;
    }

    // -----------------------------------------------------------------------
    // Normalising one row
    // -----------------------------------------------------------------------

    /**
     * One item, in one shape.
     *
     * The six keys the rest of this product already reads — item_id, item_name,
     * item_sku, hsn_sac, mrp, unit_id — keep their names and their meaning, so
     * the pickers on the billing screens are untouched. Everything else is
     * added, and a canonical key deliberately overwrites an upstream key of the
     * same name: the browser reads `type`, `group`, `rate`, `stock` and
     * `is_active` without knowing which spelling this deployment's Inventory
     * happens to use.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    public static function normalise(array $row): array
    {
        $id = self::firstInt($row, ['item_id', 'id']);
        $name = self::firstString($row, ['item_name', 'name', 'title']);
        $sku = self::firstString($row, ['item_sku', 'sku', 'item_code', 'code']);
        $hsn = self::firstString($row, ['hsn_sac', 'hsn', 'sac', 'hsn_code', 'sac_code']);
        $rate = self::firstFloat($row, ['mrp', 'sale_rate', 'selling_rate', 'sales_rate', 'rate', 'price']);

        $row['item_id'] = $id ?? 0;
        $row['item_name'] = $name ?? ($id !== null ? 'Item #' . $id : 'Item');
        $row['item_sku'] = $sku;
        $row['hsn_sac'] = $hsn;
        // Only filled in when Inventory did not send one under this name: its
        // own string is kept as it wrote it, so an amount does not change
        // shape on the way through a product that is only relaying it.
        if (!isset($row['mrp']) || !is_numeric($row['mrp'])) {
            $row['mrp'] = $rate === null ? null : (string) $rate;
        }

        $row['description'] = self::firstString($row, ['item_description', 'description', 'short_description', 'item_alias', 'alias', 'variant']);
        $row['barcode'] = self::firstString($row, ['barcode', 'item_barcode', 'ean']);
        $row['type'] = self::resolveType($row);
        $row['group'] = self::resolveGroup($row);
        $row['unit_name'] = self::firstString($row, ['unit_name', 'uom_name', 'uom', 'unit', 'unit_code']);
        $row['unit_id'] = self::firstInt($row, ['unit_id', 'uom_id']);
        $row['rate'] = $rate;
        $row['currency'] = self::firstString($row, ['currency', 'currency_code']);
        $row['is_active'] = self::resolveActive($row);
        $row['image_url'] = self::firstString($row, ['image_url', 'item_image', 'image', 'thumbnail_url', 'photo_url']);
        $row['stock'] = self::resolveStock($row);
        $row['source'] = 'inventory';

        return $row;
    }

    /**
     * Stock for the rows on this page, in ONE call.
     *
     * Only when Inventory's list did not already carry a quantity. Asking per
     * row is the loop the cross-service rules exist to prevent — twenty-five
     * items would be twenty-five round trips before the table drew — so it is
     * one batched read keyed on the ids already in hand, or nothing at all.
     * Nothing at all means the stock column says so; it does not say 0.
     *
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private function withStock(array $rows): array
    {
        $wanted = [];
        foreach ($rows as $row) {
            if ($row['type'] === 'service') {
                continue;
            }
            if (($row['stock']['available'] ?? null) === null && (int) $row['item_id'] > 0) {
                $wanted[] = (int) $row['item_id'];
            }
        }

        if ($wanted === []) {
            return $rows;
        }

        $result = $this->inventory->stockBalances($this->ctx, [
            'item_ids' => implode(',', array_slice(array_values(array_unique($wanted)), 0, Http::MAX_LIMIT)),
            'limit'    => Http::MAX_LIMIT,
        ]);

        if (!$result['ok']) {
            return $rows;
        }

        $byItem = [];
        foreach ((array) ($result['body']['data'] ?? []) as $balance) {
            if (!is_array($balance)) {
                continue;
            }
            $itemId = self::firstInt($balance, ['item_id', 'id']);
            if ($itemId === null) {
                continue;
            }
            $available = self::firstFloat($balance, ['available_qty', 'available', 'closing_qty', 'quantity_available', 'qty_available', 'balance_qty', 'qty']);
            if ($available === null) {
                continue;
            }
            // One item can appear once per warehouse. The screen shows what is
            // available to bill across the branch in view, so they add up.
            $byItem[$itemId] = ($byItem[$itemId] ?? 0.0) + $available;
        }

        foreach ($rows as $index => $row) {
            $itemId = (int) $row['item_id'];
            if (!array_key_exists($itemId, $byItem)) {
                continue;
            }
            $rows[$index]['stock'] = self::stockShape($byItem[$itemId], $row['stock']['threshold'] ?? null);
        }

        return $rows;
    }

    // -----------------------------------------------------------------------
    // Resolving one field
    // -----------------------------------------------------------------------

    /** @param array<string, mixed> $row */
    private static function resolveType(array $row): ?string
    {
        $stated = self::firstString($row, ['item_type', 'type', 'nature', 'kind']);
        if ($stated !== null) {
            $lower = strtolower($stated);
            if (str_contains($lower, 'serv')) {
                return 'service';
            }
            if (str_contains($lower, 'stock') || str_contains($lower, 'good') || str_contains($lower, 'product') || str_contains($lower, 'material')) {
                return 'stock';
            }
        }

        foreach (['is_service', 'service'] as $key) {
            $flag = self::boolish($row[$key] ?? null);
            if ($flag !== null) {
                return $flag ? 'service' : 'stock';
            }
        }

        foreach (['maintains_stock', 'track_inventory', 'is_stock_item', 'stock_tracked'] as $key) {
            $flag = self::boolish($row[$key] ?? null);
            if ($flag !== null) {
                return $flag ? 'stock' : 'service';
            }
        }

        // Nothing said so outright. A row that Inventory reports a QUANTITY or a
        // reorder level for is a stocked item by Inventory's own account, which
        // is a fact from the owner rather than a guess from the name — and it
        // cannot turn a service into a product, because a service has no
        // quantity for Inventory to have sent.
        foreach (['available_qty', 'available', 'stock_qty', 'closing_qty', 'quantity_available', 'qty_available', 'on_hand', 'reorder_level', 'low_stock_threshold'] as $key) {
            if (isset($row[$key]) && is_numeric($row[$key])) {
                return 'stock';
            }
            if (isset($row['stock'][$key]) && is_numeric($row['stock'][$key])) {
                return 'stock';
            }
        }

        // Still nothing. The badge is left empty rather than called a guess: an
        // item wrongly labelled "Service" is an item nobody checks the stock of.
        return null;
    }

    /**
     * @param array<string, mixed> $row
     * @return array{id:?int, name:string}|null
     */
    private static function resolveGroup(array $row): ?array
    {
        foreach (['item_group', 'group', 'category', 'item_category'] as $key) {
            $value = $row[$key] ?? null;
            if (is_array($value)) {
                $name = self::firstString($value, ['group_name', 'item_group_name', 'name', 'label']);
                if ($name !== null) {
                    return ['id' => self::firstInt($value, ['group_id', 'item_group_id', 'id']), 'name' => $name];
                }
            }
            if (is_string($value) && trim($value) !== '') {
                return ['id' => self::firstInt($row, ['item_group_id', 'group_id', 'category_id']), 'name' => trim($value)];
            }
        }

        $name = self::firstString($row, ['item_group_name', 'group_name', 'category_name']);
        if ($name !== null) {
            return ['id' => self::firstInt($row, ['item_group_id', 'group_id', 'category_id']), 'name' => $name];
        }

        return null;
    }

    /** @param array<string, mixed> $row */
    private static function resolveActive(array $row): ?bool
    {
        foreach (['is_active', 'active', 'enabled'] as $key) {
            $flag = self::boolish($row[$key] ?? null);
            if ($flag !== null) {
                return $flag;
            }
        }

        foreach (['is_inactive', 'is_disabled', 'is_deleted', 'is_archived'] as $key) {
            $flag = self::boolish($row[$key] ?? null);
            if ($flag !== null) {
                return !$flag;
            }
        }

        $status = self::firstString($row, ['status', 'item_status', 'record_status']);
        if ($status !== null) {
            $lower = strtolower($status);
            if (in_array($lower, ['active', 'enabled', 'live', 'in_use'], true)) {
                return true;
            }
            if (in_array($lower, ['inactive', 'disabled', 'archived', 'deleted', 'blocked', 'discontinued'], true)) {
                return false;
            }
        }

        return null;
    }

    /**
     * @param array<string, mixed> $row
     * @return array{available:?float, threshold:?float, state:string}
     */
    private static function resolveStock(array $row): array
    {
        $nested = is_array($row['stock'] ?? null) ? $row['stock'] : [];
        $source = $nested === [] ? $row : $nested + $row;

        $threshold = self::firstFloat($source, ['low_stock_threshold', 'reorder_level', 'reorder_qty', 'min_qty', 'minimum_qty', 'safety_stock']);

        if (($row['type'] ?? null) === 'service') {
            return ['available' => null, 'threshold' => null, 'state' => 'none'];
        }

        $available = self::firstFloat($source, ['available_qty', 'available', 'stock_qty', 'closing_qty', 'quantity_available', 'qty_available', 'balance_qty', 'on_hand', 'current_stock']);

        return self::stockShape($available, $threshold);
    }

    /** @return array{available:?float, threshold:?float, state:string} */
    private static function stockShape(?float $available, ?float $threshold): array
    {
        if ($available === null) {
            // Not "0 in stock". The screen prints "Unavailable" for this, which
            // is the only honest thing to say about a quantity nobody read.
            return ['available' => null, 'threshold' => $threshold, 'state' => 'unknown'];
        }

        $state = 'in';
        if ($available <= 0) {
            $state = 'out';
        } elseif ($threshold !== null && $threshold > 0 && $available <= $threshold) {
            $state = 'low';
        }

        return ['available' => $available, 'threshold' => $threshold, 'state' => $state];
    }

    // -----------------------------------------------------------------------
    // Did Inventory actually do what it was asked?
    // -----------------------------------------------------------------------

    /**
     * Filters that were sent and plainly not applied.
     *
     * A row is only evidence when its own value is KNOWN: a deployment whose
     * Inventory does not say whether an item is a service can never trip this,
     * which is the point — the check reports a contradiction, never an absence.
     *
     * @param array<string, mixed>       $filters
     * @param list<array<string, mixed>> $rows
     * @return list<string>
     */
    private static function filtersIgnored(array $filters, array $rows): array
    {
        if ($rows === []) {
            return [];
        }

        $ignored = [];

        $type = $filters['type'] ?? null;
        if (($type === 'stock' || $type === 'service') && self::anyRow($rows, static fn (array $row) => $row['type'] !== null && $row['type'] !== $type)) {
            $ignored[] = 'type';
        }

        $status = $filters['status'] ?? null;
        if ($status === 'active' || $status === 'inactive') {
            $want = $status === 'active';
            if (self::anyRow($rows, static fn (array $row) => $row['is_active'] !== null && $row['is_active'] !== $want)) {
                $ignored[] = 'status';
            }
        }

        $stockStatus = $filters['stock_status'] ?? null;
        if ($stockStatus === 'low' || $stockStatus === 'out') {
            if (self::anyRow($rows, static fn (array $row) => in_array($row['stock']['state'], ['in', 'none'], true))) {
                $ignored[] = 'stock_status';
            }
        }

        $groupId = isset($filters['group_id']) ? (int) $filters['group_id'] : 0;
        if ($groupId > 0 && self::anyRow($rows, static fn (array $row) => ($row['group']['id'] ?? null) !== null && (int) $row['group']['id'] !== $groupId)) {
            $ignored[] = 'group_id';
        }

        return $ignored;
    }

    /**
     * True when this page really is in the order that was asked for.
     *
     * Null when no sort was asked for, so the screen can tell "not requested"
     * apart from "requested and refused" and only withdraw the arrow in the
     * second case.
     *
     * @param array<string, mixed>       $filters
     * @param list<array<string, mixed>> $rows
     */
    private static function sortApplied(array $filters, array $rows): ?bool
    {
        $sort = $filters['sort'] ?? null;
        if (!is_string($sort) || !in_array($sort, self::SORTABLE, true) || count($rows) < 2) {
            return null;
        }

        $descending = strtolower((string) ($filters['order'] ?? 'asc')) === 'desc';
        $previous = null;

        foreach ($rows as $row) {
            $value = self::sortValue($row, $sort);
            if ($value === null) {
                continue;
            }
            if ($previous !== null) {
                $comparison = is_string($value) && is_string($previous)
                    ? strcasecmp($value, $previous)
                    : (float) $value <=> (float) $previous;
                if ($descending ? $comparison > 0 : $comparison < 0) {
                    return false;
                }
            }
            $previous = $value;
        }

        return true;
    }

    /** @param array<string, mixed> $row */
    private static function sortValue(array $row, string $sort): string|float|null
    {
        return match ($sort) {
            'name'     => is_string($row['item_name'] ?? null) ? $row['item_name'] : null,
            'sku'      => is_string($row['item_sku'] ?? null) ? $row['item_sku'] : null,
            'hsn_sac'  => is_string($row['hsn_sac'] ?? null) ? $row['hsn_sac'] : null,
            'rate'     => $row['rate'] === null ? null : (float) $row['rate'],
            'stock'    => ($row['stock']['available'] ?? null) === null ? null : (float) $row['stock']['available'],
            'status'   => $row['is_active'] === null ? null : ($row['is_active'] ? 1.0 : 0.0),
            default    => null,
        };
    }

    /**
     * @param list<array<string, mixed>>       $rows
     * @param callable(array<string, mixed>):bool $test
     */
    private static function anyRow(array $rows, callable $test): bool
    {
        foreach ($rows as $row) {
            if ($test($row)) {
                return true;
            }
        }

        return false;
    }

    // -----------------------------------------------------------------------
    // Plumbing
    // -----------------------------------------------------------------------

    /**
     * What Billing asks Inventory for, from what the screen asked Billing for.
     *
     * Deliberately one spelling per filter rather than a handful of guesses:
     * sending `type`, `item_type` and `is_service` at once to see which one
     * sticks is how an endpoint acquires three contracts nobody can change.
     * These names are recorded in docs/BILLING_API_DEPENDENCIES.md.
     *
     * @param array<string, mixed> $filters
     * @return array<string, mixed>
     */
    public static function upstreamQuery(array $filters): array
    {
        $limit = max(1, min(Http::MAX_LIMIT, (int) ($filters['limit'] ?? 25)));
        $offset = max(0, (int) ($filters['offset'] ?? 0));

        $ask = [
            'q'            => self::text($filters['q'] ?? null),
            'type'         => in_array($filters['type'] ?? null, ['stock', 'service'], true) ? $filters['type'] : null,
            'status'       => in_array($filters['status'] ?? null, ['active', 'inactive'], true) ? $filters['status'] : null,
            'stock_status' => in_array($filters['stock_status'] ?? null, ['low', 'out', 'in'], true) ? $filters['stock_status'] : null,
            'group_id'     => ((int) ($filters['group_id'] ?? 0)) > 0 ? (int) $filters['group_id'] : null,
            'warehouse_id' => ((int) ($filters['warehouse_id'] ?? 0)) > 0 ? (int) $filters['warehouse_id'] : null,
            'limit'        => $limit,
            'offset'       => $offset,
        ];

        $sort = $filters['sort'] ?? null;
        if (is_string($sort) && in_array($sort, self::SORTABLE, true)) {
            $ask['sort'] = $sort;
            $ask['order'] = strtolower((string) ($filters['order'] ?? 'asc')) === 'desc' ? 'desc' : 'asc';
        }

        return array_filter($ask, static fn ($value) => $value !== null);
    }

    /** The filters as the request stated them, for the screen and for the export to share. */
    public static function filtersFromRequest(): array
    {
        return [
            'q'            => Http::param('q'),
            'type'         => Http::param('type'),
            'status'       => Http::param('status'),
            'stock_status' => Http::param('stock_status'),
            'group_id'     => Http::intParam('group_id'),
            'warehouse_id' => Http::intParam('warehouse_id'),
            'sort'         => Http::param('sort'),
            'order'        => Http::param('order'),
            'limit'        => Http::intParam('limit', 25),
            'offset'       => Http::intParam('offset', 0),
        ];
    }

    /** @return array{value:?int, available:bool, reason:?string} */
    private static function figure(?int $value, string $reason): array
    {
        return $value === null
            ? ['value' => null, 'available' => false, 'reason' => $reason]
            : ['value' => $value, 'available' => true, 'reason' => null];
    }

    /**
     * How many there are in total, from a response asked for with `limit`.
     *
     * `meta.total` is the fleet's own envelope and is what this expects. A
     * response without one only answers the question when the page came back
     * short, because a full page proves nothing about what follows it.
     *
     * @param array<string, mixed>|null $body
     */
    private static function countOf(?array $body, int $limit): ?int
    {
        $total = $body['meta']['total'] ?? null;
        if (is_numeric($total)) {
            return (int) $total;
        }

        $rows = (array) ($body['data'] ?? []);

        return count($rows) < $limit ? count($rows) : null;
    }

    /** @param array<string, mixed> $row */
    private static function statusWord(array $row): string
    {
        if ($row['is_active'] === false) {
            return 'Inactive';
        }
        if (($row['stock']['state'] ?? null) === 'out') {
            return 'Out of stock';
        }
        if (($row['stock']['state'] ?? null) === 'low') {
            return 'Low stock';
        }

        return $row['is_active'] === true ? 'Active' : '';
    }

    // -------------------------------------------------------------- scalars

    /**
     * The same two scalar readers, for the group list next door.
     *
     * @param array<string, mixed> $row
     * @param list<string>         $keys
     */
    public static function pickString(array $row, array $keys): ?string
    {
        return self::firstString($row, $keys);
    }

    /** @param array<string, mixed> $row @param list<string> $keys */
    public static function pickInt(array $row, array $keys): ?int
    {
        return self::firstInt($row, $keys);
    }

    /** @param array<string, mixed> $row @param list<string> $keys */
    private static function firstString(array $row, array $keys): ?string
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

    /** @param array<string, mixed> $row @param list<string> $keys */
    private static function firstInt(array $row, array $keys): ?int
    {
        foreach ($keys as $key) {
            $value = $row[$key] ?? null;
            if (is_numeric($value)) {
                return (int) $value;
            }
        }

        return null;
    }

    /** @param array<string, mixed> $row @param list<string> $keys */
    private static function firstFloat(array $row, array $keys): ?float
    {
        foreach ($keys as $key) {
            $value = $row[$key] ?? null;
            if (is_numeric($value)) {
                return (float) $value;
            }
        }

        return null;
    }

    private static function boolish(mixed $value): ?bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if (is_int($value) || (is_string($value) && preg_match('/^-?\d+$/', $value) === 1)) {
            return ((int) $value) !== 0;
        }
        if (is_string($value)) {
            $lower = strtolower(trim($value));
            if (in_array($lower, ['true', 't', 'yes', 'y'], true)) {
                return true;
            }
            if (in_array($lower, ['false', 'f', 'no', 'n'], true)) {
                return false;
            }
        }

        return null;
    }

    private static function text(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }
}
