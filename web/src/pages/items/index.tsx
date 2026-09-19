/**
 * Items — the product and service catalogue.
 *
 * THERE IS NO ITEM TABLE IN THIS PRODUCT, and this screen is what that looks
 * like when it is done properly rather than apologetically. Aicountly Inventory
 * owns the item, its group, its unit, its rate, its status and its stock; this
 * page searches, filters, sorts and pages against Inventory on every request,
 * shows what came back, and forgets it. Nothing is synchronised, nothing is
 * mirrored, and there is no "last refreshed" because there is nothing to
 * refresh — which is also why the list cannot be stale.
 *
 * What Billing adds on top is its own profile rules. A biller without
 * `cost.view` is handed the item without its cost by the API, not by a hidden
 * column, and without `export.data` the file is refused by the server rather
 * than by a missing button.
 *
 * Everything that would CHANGE an item — create, import, edit, deactivate —
 * opens Inventory. A second place to create the same item is a second name for
 * the same product, and that is a data problem no screen design fixes.
 *
 * The whole view lives in the query string (see useItemsQuery), so a reload
 * returns to it, Back undoes one filter, and "the low-stock items in
 * Stationery" is a link somebody can send.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Layers, Package, Plus, Upload } from 'lucide-react'
import { ApiError, api } from '../../services/api'
import { useApi } from '../../hooks/useApi'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { useBilling } from '../../context/BillingContext'
import { INVENTORY_PATHS, currentReturnUrl, inventoryUrl } from '../../services/inventoryLinks'
import type { CatalogItem, CatalogItemView, ItemGroup, ItemStats } from '../../services/types'
import { Notice } from '../../ui'
import { ItemDetailDrawer } from './ItemDetailDrawer'
import { ItemsGrid } from './ItemsGrid'
import { ItemsKpis } from './ItemsKpis'
import { ItemsPagination } from './ItemsPagination'
import { ItemsTable, type ItemRowLinks } from './ItemsTable'
import { ItemsToolbar, useItemsView, type WarehouseOption } from './ItemsToolbar'
import { ItemsEmpty, ItemsError, ItemsSkeleton } from './parts'
import { activeTab, hasAnyFilter, useItemsQuery, type ItemTab } from './useItemsQuery'
import '../../styles/billing-items.css'

const TABS: Array<{ key: ItemTab; label: string }> = [
  { key: 'all', label: 'All items' },
  { key: 'stock', label: 'Stock items' },
  { key: 'service', label: 'Service items' },
  { key: 'low', label: 'Low stock' },
  { key: 'inactive', label: 'Inactive' },
]

/**
 * Billing holds no per-company currency of its own — Books does, on the
 * document. Until a company currency reaches the session, the catalogue is
 * formatted in the one this product is built for, in one place rather than in
 * nine call sites.
 */
const CATALOG_CURRENCY = 'INR'

export function Items() {
  const { scope, can, session } = useBilling()
  const { query, patch, setTab, toggleSort, clearFilters } = useItemsQuery()
  const [view, setView] = useItemsView()

  const [term, setTerm] = useState(query.q)
  const settledTerm = useDebouncedValue(term, 350)

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [open, setOpen] = useState<CatalogItem | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const scopeKey = `${scope?.cmp_id ?? 0}:${scope?.fy_id ?? 0}:${scope?.bo_id ?? 0}`
  const mayExport = can('export.data')
  const mayseeCost = can('cost.view')

  // ------------------------------------------------------------- the reading

  const params = useMemo(
    () => ({
      q: query.q || undefined,
      type: query.type || undefined,
      status: query.status || undefined,
      stock_status: query.stockStatus || undefined,
      group_id: query.groupId ?? undefined,
      warehouse_id: query.warehouseId ?? undefined,
      sort: query.sort || undefined,
      order: query.sort ? query.order : undefined,
      limit: query.perPage,
      offset: (query.page - 1) * query.perPage,
      // This screen draws a Stock column, so it is worth the one extra call to
      // Inventory when the list response did not carry quantities. The pickers
      // that read the same endpoint do not ask, and do not pay for it.
      with_stock: 1,
    }),
    [query],
  )

  const items = useApi(
    (signal) => api.list<CatalogItem>('v1/catalog/items', params, signal),
    [scopeKey, JSON.stringify(params)],
    Boolean(scope),
  )

  const stats = useApi(
    (signal) => api.get<{ data: ItemStats }>('v1/catalog/items/stats', undefined, signal),
    [scopeKey],
    Boolean(scope),
  )

  const groups = useApi(
    (signal) => api.get<{ data: ItemGroup[] }>('v1/catalog/item-groups', undefined, signal),
    [scopeKey],
    Boolean(scope),
  )

  const warehouses = useApi(
    (signal) => api.get<{ data: Array<Record<string, unknown>> }>('v1/catalog/warehouses', undefined, signal),
    [scopeKey],
    Boolean(scope),
  )

  // A company switch must not leave page 7 of the last company's catalogue in
  // the address bar, nor rows ticked that belong to a business the user has
  // navigated away from.
  useEffect(() => {
    setSelected(new Set())
    setOpen(null)
    setExportError(null)
    if (query.page > 1) patch({ page: 1 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey])

  // The typed word, once it settles, becomes the filter in the URL.
  useEffect(() => {
    const settled = settledTerm.trim()
    if (settled !== query.q) patch({ q: settled })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledTerm])

  // Back/forward changes the URL underneath us; the box has to follow it.
  useEffect(() => {
    setTerm((current) => (current.trim() === query.q ? current : query.q))
  }, [query.q])

  useEffect(() => setSelected(new Set()), [params])

  // ------------------------------------------------------------------- links

  const returnUrl = currentReturnUrl()
  const link = useCallback(
    (path: string, withReturn = false) => inventoryUrl(path, scope, withReturn ? returnUrl : undefined),
    [scope, returnUrl],
  )

  const rowLinks = useCallback(
    (item: CatalogItemView): ItemRowLinks =>
      item.id === null
        ? { edit: null, view: null, stock: null }
        : {
            edit: link(INVENTORY_PATHS.editItem(item.id)),
            view: link(INVENTORY_PATHS.item(item.id)),
            stock: link(INVENTORY_PATHS.stock(item.id)),
          },
    [link],
  )

  // ------------------------------------------------------------------ export

  async function exportItems(ids?: number[]) {
    if (exporting) return
    setExporting(true)
    setExportError(null)
    try {
      const { blob, filename } = await api.download('v1/catalog/items/export', {
        ...params,
        limit: undefined,
        offset: undefined,
        ids: ids && ids.length > 0 ? ids.join(',') : undefined,
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }

  // ------------------------------------------------------------------ render

  const rows = items.data?.data ?? []
  const meta = items.data?.meta
  const total = meta?.total_known === false ? null : (meta?.total ?? null)
  const stockSource = meta?.stock_source
  const tab = activeTab(query)
  const filtered = hasAnyFilter(query)
  const itemView = (row: CatalogItem): CatalogItemView => row.catalog ?? fallbackView(row)

  const groupRows = groups.data?.data ?? []
  const warehouseRows: WarehouseOption[] = (warehouses.data?.data ?? [])
    .map((row) => ({
      id: Number(row.warehouse_id ?? row.wh_id ?? row.id ?? 0),
      name: String(row.warehouse_name ?? row.wh_name ?? row.name ?? 'Warehouse'),
    }))
    .filter((warehouse) => warehouse.id > 0)

  const addHref = link(INVENTORY_PATHS.newItem, true)
  const importHref = link(INVENTORY_PATHS.importItems, true)
  const groupsHref = link(INVENTORY_PATHS.itemGroups, true)
  const catalogHref = link(INVENTORY_PATHS.items)

  return (
    <div className="items-page">
      <nav className="items-breadcrumb" aria-label="Breadcrumb">
        <Link to={session?.landing ?? '/'}>Home</Link>
        <span aria-hidden>›</span>
        <strong aria-current="page">Items</strong>
      </nav>

      <header className="items-header">
        <div className="items-header__title">
          <span className="items-header__mark" aria-hidden>
            <Package size={24} />
          </span>
          <div>
            <div className="items-header__row">
              <h1>Items</h1>
              <span
                className="items-live"
                title="Item, rate and stock information is fetched from Aicountly Inventory on every request. Billing keeps no copy."
              >
                <span className="items-live__dot" aria-hidden />
                Live with Inventory
              </span>
            </div>
            <p>
              Manage your product &amp; service catalogue. Stock, rates and availability are in sync with Aicountly
              Inventory
              {mayseeCost ? ', and cost is shown because your profile allows it.' : '.'}
            </p>
          </div>
        </div>

        <div className="items-header__actions">
          {importHref && (
            <a className="billing-button" href={importHref} title="Import items in Aicountly Inventory">
              <Upload size={15} aria-hidden /> Import
            </a>
          )}
          {mayExport && (
            <button
              type="button"
              className="billing-button"
              onClick={() => void exportItems()}
              disabled={exporting || items.loading}
              title="Export everything these filters select"
            >
              <Download size={15} aria-hidden /> {exporting ? 'Building…' : 'Export'}
            </button>
          )}
          {addHref && (
            <a
              className="billing-button billing-button--primary"
              href={addHref}
              title="Items are created in Aicountly Inventory"
            >
              <Plus size={15} aria-hidden /> Add item
            </a>
          )}
        </div>
      </header>

      {exportError && (
        <Notice tone="warning" title="The file was not built" onDismiss={() => setExportError(null)}>
          {exportError}
        </Notice>
      )}

      <ItemsKpis
        stats={stats.data?.data ?? null}
        loading={stats.loading}
        reason={stats.data?.data?.reason ?? stats.error}
        active={tab}
        onPick={setTab}
      />

      <section className="items-workspace">
        <div className="items-tabsbar">
          <nav className="items-tabs" aria-label="Which items">
            {TABS.map((entry) => (
              <button
                type="button"
                key={entry.key}
                className="items-tab"
                aria-current={tab === entry.key ? 'page' : undefined}
                onClick={() => setTab(entry.key)}
              >
                {entry.label}
              </button>
            ))}
          </nav>

          {groupsHref && (
            <a className="billing-button billing-button--small" href={groupsHref} title="Item groups live in Aicountly Inventory">
              <Layers size={14} aria-hidden /> Item groups
            </a>
          )}
        </div>

        <ItemsToolbar
          query={query}
          term={term}
          onTerm={setTerm}
          onPatch={patch}
          onClear={() => {
            setTerm('')
            clearFilters()
          }}
          groups={groupRows}
          groupsLoading={groups.loading}
          warehouses={warehouseRows}
          view={view}
          onView={setView}
          anyFilter={filtered}
        />

        {selected.size > 0 && (
          <div className="items-bulkbar">
            <span>
              <strong>{selected.size}</strong> selected
            </span>
            <button
              type="button"
              className="billing-button billing-button--small"
              disabled={exporting}
              onClick={() => void exportItems([...selected])}
            >
              <Download size={14} aria-hidden /> {exporting ? 'Building…' : 'Export selected'}
            </button>
            <button
              type="button"
              className="billing-button billing-button--quiet billing-button--small"
              onClick={() => setSelected(new Set())}
            >
              Clear selection
            </button>
          </div>
        )}

        {stockSource === 'unavailable' && !items.loading && rows.length > 0 && (
          <p className="items-strip">
            Aicountly Inventory did not return quantities for this page, so stock reads Unavailable rather than nought.
          </p>
        )}

        {items.loading && <ItemsSkeleton rows={Math.min(query.perPage, 8)} />}

        {!items.loading && items.error && (
          <ItemsError message={items.error} onRetry={items.reload} inventoryHref={catalogHref} />
        )}

        {!items.loading && !items.error && rows.length === 0 && (
          <ItemsEmpty
            filtered={filtered}
            onClear={() => {
              setTerm('')
              clearFilters()
            }}
            addHref={addHref}
          />
        )}

        {!items.loading && !items.error && rows.length > 0 && (
          <>
            {view === 'list' ? (
              <ItemsTable
                rows={rows}
                view={itemView}
                sort={query.sort}
                order={query.order}
                onSort={toggleSort}
                selected={selected}
                canSelect={mayExport}
                onSelect={(id, on) =>
                  setSelected((current) => {
                    const next = new Set(current)
                    if (on) next.add(id)
                    else next.delete(id)
                    return next
                  })
                }
                onSelectAll={(on) =>
                  setSelected(
                    on
                      ? new Set(rows.map((row) => itemView(row).id).filter((id): id is number => id !== null))
                      : new Set(),
                  )
                }
                onOpen={setOpen}
                links={rowLinks}
                currency={CATALOG_CURRENCY}
              />
            ) : (
              <ItemsGrid rows={rows} view={itemView} onOpen={setOpen} links={rowLinks} currency={CATALOG_CURRENCY} />
            )}

            <ItemsPagination
              page={query.page}
              perPage={query.perPage}
              shown={rows.length}
              total={total}
              onPage={(page) => patch({ page })}
              onPerPage={(perPage) => patch({ perPage })}
            />
          </>
        )}
      </section>

      {open && (
        <ItemDetailDrawer
          row={open}
          onClose={() => setOpen(null)}
          links={rowLinks}
          currency={CATALOG_CURRENCY}
          canSeeCost={mayseeCost}
          scopeKey={scopeKey}
        />
      )}
    </div>
  )
}

/**
 * An item from an endpoint that predates the workspace shape.
 *
 * The API adds `catalog` to everything the Items screen asks for, so this is a
 * belt-and-braces path rather than a normal one — but a row without it should
 * draw as an item with unknown extras, not throw the table away.
 */
function fallbackView(row: CatalogItem): CatalogItemView {
  return {
    id: row.item_id ?? null,
    name: row.item_name ?? null,
    description: null,
    sku: row.item_sku ?? null,
    hsn_sac: row.hsn_sac ?? null,
    barcode: null,
    type: null,
    group: { id: null, name: null },
    unit: null,
    rate: row.mrp === null || row.mrp === undefined ? null : Number(row.mrp),
    status: null,
    image_url: null,
    stock: { applicable: true, available: null, threshold: null, state: null },
    source: 'inventory',
  }
}

export default Items
