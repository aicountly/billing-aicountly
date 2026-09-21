/**
 * Items — the catalogue this business bills from.
 *
 * READ-THROUGH, START TO FINISH. There is no items table in Billing and there
 * is not going to be one: Aicountly Inventory owns the item master, the groups,
 * the units and every quantity, and this screen asks it on the request that
 * draws the page. That is why the filters, the sorting and the paging all go
 * upstream rather than being done here — Billing has one page of rows in hand
 * and could only ever filter that, which is how a "Low Stock" tab ends up
 * listing whatever happened to be on page one.
 *
 * It follows that creating, editing and importing items are not features this
 * screen is missing. They belong to Inventory, and what belongs here are the
 * doors to them: Add item, Import and Item groups open Inventory, carrying the
 * company, branch and year so nobody adds an item to the wrong company.
 *
 * What the screen does own is the three-state rule the rest of this product
 * follows. Ready, loading, or unavailable-with-a-reason. A count Inventory
 * could not give says "Unavailable", a quantity nobody could read says the
 * same, and neither of them is ever drawn as 0 — a zero and an outage look
 * identical on screen and one of them means there is nothing to worry about.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, Download, ExternalLink, Layers, Package, Upload } from 'lucide-react'
import { api, ApiError } from '../../services/api'
import { useApi } from '../../hooks/useApi'
import { useBilling } from '../../context/BillingContext'
import { INVENTORY_PATHS, inventoryUrl } from '../../services/inventoryLinks'
import type { CatalogItemRow, ItemGroup, ItemStats, ItemsUpstreamNote } from '../../services/types'
import { Notice, ToastStack, useToasts } from '../../ui'
import { ItemDetailDrawer } from './ItemDetailDrawer'
import { ItemsKpis } from './ItemsKpis'
import { ItemsEmpty, ItemsFailed, ItemsGrid, ItemsPager, ItemsSkeleton, ItemsTable, type ItemsActions } from './ItemsTable'
import { ItemsTabs, ItemsToolbar, type ItemsView } from './ItemsToolbar'
import { hasAnyFilter, toApiParams, useItemsQuery, type ItemSort, type SortOrder } from './itemsQuery'
import { rate } from './items'
import '../../styles/billing-items.css'

const VIEW_KEY = 'billing:items:view'

function readView(): ItemsView {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'
  } catch {
    // A private window, or storage the browser refuses. The list is the
    // default and the screen works exactly the same; the choice just does not
    // survive the visit.
    return 'list'
  }
}

export default function ItemsPage() {
  const { scope } = useBilling()
  const { patch } = useItemsQuery()

  const scopeKey = scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : 'none'
  const lastScope = useRef(scopeKey)

  useEffect(() => {
    if (lastScope.current === scopeKey) return
    lastScope.current = scopeKey
    // A group id belongs to the company it was read from, and page four of the
    // old company's catalogue is not page four of this one's.
    patch({ groupId: null, page: 1 })
  }, [scopeKey, patch])

  // Remounted on a context switch, which is what clears every row, figure and
  // open panel belonging to the company that was open a moment ago.
  return <ItemsScreen key={scopeKey} />
}

function ItemsScreen() {
  const { scope, can } = useBilling()
  const navigate = useNavigate()
  const { query, patch, reset } = useItemsQuery()
  const { toasts, push, dismiss } = useToasts()

  const [view, setView] = useState<ItemsView>(readView)
  const [selected, setSelected] = useState<CatalogItemRow | null>(null)
  const [exporting, setExporting] = useState(false)

  // Enforced on the server as well, on every one of these endpoints. Hiding a
  // screen tells somebody what they may do; it does not stop them.
  const maySeeCatalogue = can('sale.view') || can('purchase.view')
  const mayExport = can('export.data')
  const mayBill = can('sale.create')
  const maySeeCost = can('cost.view')

  const enabled = Boolean(scope) && maySeeCatalogue
  const signature = JSON.stringify(toApiParams(query))

  const items = useApi(
    (signal) => api.list<CatalogItemRow>('v1/catalog/items', toApiParams(query), signal),
    [signature],
    enabled,
  )

  const stats = useApi(
    (signal) => api.one<ItemStats>('v1/catalog/items/stats', undefined, signal),
    [],
    enabled,
  )

  const groups = useApi(
    (signal) => api.list<ItemGroup>('v1/catalog/item-groups', undefined, signal),
    [],
    enabled,
  )

  const rows = items.data?.data ?? []
  const meta = items.data?.meta
  const total = typeof meta?.total === 'number' ? meta.total : null
  const upstream = (meta?.upstream ?? null) as ItemsUpstreamNote | null
  const filtered = hasAnyFilter(query)

  // Only on the FIRST load. A skeleton that replaces the table on every
  // keystroke makes the page flash at somebody who is simply typing.
  const firstLoad = items.loading && items.data === null
  const refreshing = items.loading && items.data !== null

  const itemHref = useCallback(
    (row: CatalogItemRow) => inventoryUrl(INVENTORY_PATHS.editItem(row.item_id), scope, '/items'),
    [scope],
  )

  const addHref = inventoryUrl(INVENTORY_PATHS.newItem, scope, '/items')
  const importHref = inventoryUrl(INVENTORY_PATHS.importItems, scope, '/items')
  const groupsHref = inventoryUrl(INVENTORY_PATHS.itemGroups, scope, '/items')
  const inventoryHref = inventoryUrl(INVENTORY_PATHS.items, scope, '/items')

  const bill = useCallback(
    (row: CatalogItemRow) => {
      // The id is a request, not a fact: the editor reads the name, rate and
      // unit back from Inventory before it puts a line on the bill.
      navigate(`/sales/new?item_id=${row.item_id}`)
    },
    [navigate],
  )

  const copyDetails = useCallback(
    async (row: CatalogItemRow) => {
      const line = [
        row.item_name,
        row.item_sku ? `SKU ${row.item_sku}` : null,
        row.hsn_sac ? `HSN/SAC ${row.hsn_sac}` : null,
        row.rate === null ? null : rate(row),
      ]
        .filter(Boolean)
        .join(' · ')

      try {
        await navigator.clipboard.writeText(line)
        push({ tone: 'success', title: 'Copied', detail: line })
      } catch {
        // Clipboard access is refused outside a secure context and in some
        // locked-down browsers. Showing the text is the next best thing.
        push({ tone: 'info', title: 'Could not reach the clipboard', detail: line })
      }
    },
    [push],
  )

  const actions: ItemsActions = useMemo(
    () => ({
      onOpen: setSelected,
      onBill: mayBill ? bill : undefined,
      onCopy: (row) => void copyDetails(row),
      inventoryUrlFor: itemHref,
    }),
    [mayBill, bill, copyDetails, itemHref],
  )

  /**
   * Try again means all of it.
   *
   * Inventory having a bad minute takes the list, the five figures and the
   * group list down together, and retrying only the list would leave the
   * figures reading "Unavailable" beside a table that had just loaded.
   */
  function retryEverything() {
    items.reload()
    stats.reload()
    groups.reload()
  }

  function chooseView(next: ItemsView) {
    setView(next)
    try {
      window.localStorage.setItem(VIEW_KEY, next)
    } catch {
      /* storage refused; the choice still applies for this visit */
    }
  }

  function sortBy(sort: ItemSort, order: SortOrder) {
    patch({ sort, order })
  }

  /**
   * The file is built on the server from the FULL filtered set, not from the
   * rows on screen. Somebody who has narrowed to one group and pressed Export
   * expects that group; handing them the twenty-five visible rows is the kind
   * of error that surfaces after the figures are in a return.
   */
  async function exportCsv() {
    if (exporting) return
    setExporting(true)
    try {
      const { limit: _limit, offset: _offset, ...filters } = toApiParams(query)
      const { blob, filename } = await api.download('v1/catalog/items/export', filters)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      push({ tone: 'success', title: 'The file is ready', detail: filename })
    } catch (error) {
      push({
        tone: 'danger',
        title: 'The file was not built',
        detail: error instanceof ApiError ? error.message : 'Please try again in a moment.',
      })
    } finally {
      setExporting(false)
    }
  }

  if (!maySeeCatalogue) {
    return (
      <Notice tone="info" title="Items are not part of your Billing profile">
        Your profile does not include seeing what is sold or bought, which is what the item catalogue is for. Whoever
        looks after Billing profiles can change that.
      </Notice>
    )
  }

  const live = !items.error && !stats.error

  return (
    <div className="billing-items">
      <nav className="billing-items__crumbs" aria-label="Where you are">
        <Link to="/">Home</Link>
        <span className="billing-items__crumb-sep" aria-hidden="true">›</span>
        <span aria-current="page">Items</span>
      </nav>

      <header className="billing-items__head">
        <div className="billing-items__identity">
          <span className="billing-items__mark" aria-hidden="true">
            <Package size={24} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="billing-items__title-row">
              <h1>Items</h1>
              <span
                className={`billing-items__live${live ? '' : ' billing-items__live--stale'}`}
                title={
                  live
                    ? 'Item, rate and stock information is read from Aicountly Inventory as this page draws. Billing keeps no copy.'
                    : 'Aicountly Inventory did not answer the last request, so what is on screen may be incomplete.'
                }
              >
                <span className="billing-items__live-dot" aria-hidden="true" />
                {live ? 'Live with Inventory' : 'Inventory not answering'}
              </span>
            </div>
            <p className="billing-items__lede">
              Manage your product &amp; service catalogue. Stock, rates and availability are in sync with Aicountly
              Inventory, which stays the source of truth.{' '}
              {maySeeCost ? 'Cost is shown because your profile allows it.' : 'Cost is not part of your Billing profile.'}
            </p>
          </div>
        </div>

        <div className="billing-items__actions">
          {importHref && (
            <a className="billing-button" href={importHref} target="_blank" rel="noopener noreferrer" title="Importing items is done in Aicountly Inventory, which owns the catalogue.">
              <Upload size={15} aria-hidden /> Import <ExternalLink size={13} aria-hidden />
            </a>
          )}
          {mayExport && (
            <button type="button" className="billing-button" onClick={exportCsv} disabled={exporting || items.data === null}>
              <Download size={15} aria-hidden /> {exporting ? 'Building…' : 'Export'}
            </button>
          )}
          {addHref && (
            <a
              className="billing-button billing-button--primary"
              href={addHref}
              target="_blank"
              rel="noopener noreferrer"
              title="Items are created in Aicountly Inventory. Your Inventory permissions decide what you can do there."
            >
              Add item <ExternalLink size={13} aria-hidden />
            </a>
          )}
        </div>
      </header>

      <ItemsKpis
        stats={stats.data?.data ?? null}
        loading={stats.loading}
        error={stats.error}
        onOpen={(key) => {
          const patches = {
            total: { type: null, status: null, stockStatus: null },
            stock: { type: 'stock' as const, status: null, stockStatus: null },
            service: { type: 'service' as const, status: null, stockStatus: null },
            low: { type: null, status: null, stockStatus: 'low' as const },
            inactive: { type: null, status: 'inactive' as const, stockStatus: null },
          }
          patch(patches[key])
        }}
      />

      <section className="billing-items-workspace">
        <ItemsTabs
          query={query}
          onPatch={patch}
          groupsAction={
            groupsHref && (
              <a
                className="billing-button billing-button--small"
                href={groupsHref}
                target="_blank"
                rel="noopener noreferrer"
                title="Item groups are Inventory's. This opens them there."
              >
                <Layers size={15} aria-hidden /> Item groups <ExternalLink size={13} aria-hidden />
              </a>
            )
          }
        />

        <ItemsToolbar
          query={query}
          onPatch={patch}
          groups={groups.data?.data ?? []}
          groupsLoading={groups.loading}
          view={view}
          onView={chooseView}
        />

        {filtered && (
          <div className="billing-items-chips">
            <span>Filtered.</span>
            <button type="button" className="billing-button billing-button--small billing-button--quiet" onClick={reset}>
              Clear all filters
            </button>
          </div>
        )}

        {upstream && upstream.filters_ignored.length > 0 && (
          <p className="billing-items-note" role="status">
            <AlertTriangle size={15} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Aicountly Inventory returned items outside this filter, so it has not narrowed the list the way it was
              asked to ({upstream.filters_ignored.join(', ')}). What is below is Inventory&rsquo;s own answer, unchanged.
            </span>
          </p>
        )}

        {upstream && upstream.sort_applied === false && (
          <p className="billing-items-note" role="status">
            <AlertTriangle size={15} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />
            <span>This page came back in Inventory&rsquo;s own order rather than the one you chose.</span>
          </p>
        )}

        {items.error ? (
          <ItemsFailed message={friendlyError(items.error)} onRetry={retryEverything} inventoryHref={inventoryHref} />
        ) : firstLoad ? (
          <ItemsSkeleton />
        ) : rows.length === 0 ? (
          <ItemsEmpty filtered={filtered} onClear={reset} addHref={addHref} />
        ) : (
          <div aria-busy={refreshing || undefined} style={{ opacity: refreshing ? 0.6 : 1, transition: 'opacity 140ms ease' }}>
            {view === 'grid' ? (
              <ItemsGrid rows={rows} actions={actions} selectedId={selected?.item_id ?? null} />
            ) : (
              <ItemsTable
                rows={rows}
                query={query}
                onSort={sortBy}
                actions={actions}
                selectedId={selected?.item_id ?? null}
                sortHonoured={upstream?.sort_applied !== false}
              />
            )}
          </div>
        )}

        {!items.error && rows.length > 0 && (
          <ItemsPager
            query={query}
            shown={rows.length}
            total={total}
            onPage={(page) => patch({ page })}
            onPerPage={(perPage) => patch({ perPage, page: 1 })}
          />
        )}
      </section>

      <ItemDetailDrawer
        row={selected}
        onClose={() => setSelected(null)}
        onBill={mayBill ? bill : undefined}
        inventoryHref={selected ? itemHref(selected) : null}
        maySeeCost={maySeeCost}
      />

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

/**
 * The API's message, or a plain one.
 *
 * Never a status code, a URL or anything PHP said to itself. The person reading
 * this is at a counter with a customer waiting.
 */
function friendlyError(message: string): string {
  const trimmed = message.trim()
  if (trimmed === '' || /^(\w+Error|HTTP|Request failed)/i.test(trimmed)) {
    return 'The catalogue could not be read just now. Nothing is wrong with your filters — please try again in a moment.'
  }
  return trimmed
}
