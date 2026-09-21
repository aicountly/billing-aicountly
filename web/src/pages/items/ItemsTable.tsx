/**
 * The list itself — as a table, as cards, and in the four states it can be in.
 *
 * One data source, two renderings. The table and the grid are given the same
 * rows and the same handlers, so there is no second place for a rule about
 * what a low-stock item looks like to be written down differently.
 *
 * The row actions are deliberately short. Billing does not own the item master,
 * so there is no Deactivate here and no Delete: those change Inventory's
 * record, and a button that pretends otherwise is worse than no button. What is
 * offered is what this product can actually do — put the item on a bill, copy
 * its details, look at it, and open it where it is owned.
 */

import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Copy,
  ExternalLink,
  MoreHorizontal,
  Package,
  PackageSearch,
  Receipt,
  SearchX,
  ServerCrash,
  Wrench,
} from 'lucide-react'
import type { CatalogItemRow } from '../../services/types'
import { Badge } from '../../dashboards/kit'
import { itemSubtitle, pageWindow, rangeLabel, rate, statusReading, stockReading, typeLabel } from './items'
import type { ItemSort, ItemsQuery, SortOrder } from './itemsQuery'
import { PAGE_SIZES } from './itemsQuery'

export interface ItemsActions {
  /** Open the detail panel. */
  onOpen: (row: CatalogItemRow) => void
  /** Start a bill with this item on it. Absent when the profile cannot bill. */
  onBill?: (row: CatalogItemRow) => void
  onCopy: (row: CatalogItemRow) => void
  /** Inventory's own screen for this item. Absent when Inventory is not in the app catalog. */
  inventoryUrlFor: (row: CatalogItemRow) => string | null
}

const COLUMNS: Array<{ key: string; label: string; sort?: ItemSort; numeric?: boolean }> = [
  { key: 'item', label: 'Item', sort: 'name' },
  { key: 'sku', label: 'SKU', sort: 'sku' },
  { key: 'hsn', label: 'HSN/SAC', sort: 'hsn_sac' },
  { key: 'type', label: 'Type' },
  { key: 'group', label: 'Group' },
  { key: 'rate', label: 'Rate', sort: 'rate', numeric: true },
  { key: 'stock', label: 'Stock', sort: 'stock' },
  { key: 'status', label: 'Status', sort: 'status' },
  { key: 'actions', label: 'Actions' },
]

export function ItemsTable({
  rows,
  query,
  onSort,
  actions,
  selectedId,
  sortHonoured,
}: {
  rows: CatalogItemRow[]
  query: ItemsQuery
  onSort: (sort: ItemSort, order: SortOrder) => void
  actions: ItemsActions
  selectedId: number | null
  /** False when the API said the page did not come back in the order asked for. */
  sortHonoured: boolean
}) {
  return (
    <div className="billing-table-scroll">
      <table className="billing-table billing-items-table">
        <caption className="billing-sr-only">
          Items in the catalogue, read from Aicountly Inventory.
        </caption>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                className={column.numeric ? 'billing-amount' : undefined}
                style={column.key === 'actions' ? { textAlign: 'right' } : undefined}
                aria-sort={
                  column.sort && query.sort === column.sort && sortHonoured
                    ? query.order === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
              >
                {column.key === 'actions' ? (
                  column.label
                ) : column.sort ? (
                  <SortButton column={column.sort} label={column.label} query={query} onSort={onSort} honoured={sortHonoured} />
                ) : (
                  column.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <ItemRow key={row.item_id} row={row} actions={actions} selected={row.item_id === selectedId} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SortButton({
  column,
  label,
  query,
  onSort,
  honoured,
}: {
  column: ItemSort
  label: string
  query: ItemsQuery
  onSort: (sort: ItemSort, order: SortOrder) => void
  honoured: boolean
}) {
  const active = query.sort === column && honoured
  const next: SortOrder = active && query.order === 'asc' ? 'desc' : 'asc'
  const Mark = active ? (query.order === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown

  // "A to Z" on a column of rupee amounts tells somebody nothing about which
  // way it is going to sort.
  const direction = {
    name: ['A to Z', 'Z to A'],
    sku: ['A to Z', 'Z to A'],
    hsn_sac: ['lowest first', 'highest first'],
    rate: ['cheapest first', 'dearest first'],
    stock: ['least in stock first', 'most in stock first'],
    status: ['inactive first', 'active first'],
  }[column][next === 'asc' ? 0 : 1]

  return (
    <button
      type="button"
      className="billing-items-sort"
      data-active={active || undefined}
      onClick={() => onSort(column, next)}
      title={`Sort by ${label.toLowerCase()} — ${direction}`}
    >
      {label}
      <Mark size={12} className="billing-items-sort__mark" aria-hidden />
    </button>
  )
}

function ItemRow({ row, actions, selected }: { row: CatalogItemRow; actions: ItemsActions; selected: boolean }) {
  const status = statusReading(row)
  const stock = stockReading(row)
  const type = typeLabel(row)

  return (
    <tr
      data-clickable="true"
      // Not aria-selected: that belongs to a grid or a listbox, and a table row
      // wearing it tells a screen reader it is in a selection it is not in.
      data-selected={selected || undefined}
      onClick={() => actions.onOpen(row)}
    >
      <td>
        <ItemIdentity row={row} onOpen={() => actions.onOpen(row)} />
      </td>
      <td>{row.item_sku ?? '—'}</td>
      <td>{row.hsn_sac ?? '—'}</td>
      <td>
        {type ? (
          <span className={`billing-item-type billing-item-type--${row.type}`}>{type}</span>
        ) : (
          <span style={{ color: 'var(--billing-muted)' }} title="Aicountly Inventory did not say whether this is a stock item or a service.">
            —
          </span>
        )}
      </td>
      <td>{row.group?.name ?? '—'}</td>
      <td className="billing-amount">{rate(row)}</td>
      <td>
        <span className={`billing-item-stock billing-item-stock--${stock.state}`} title={stock.description}>
          <span className="billing-item-stock__dot" aria-hidden="true" />
          {stock.text}
          <span className="billing-sr-only"> — {stock.description}</span>
        </span>
      </td>
      <td>
        <Badge tone={status.tone}>{status.label}</Badge>
      </td>
      <td>
        <RowActions row={row} actions={actions} />
      </td>
    </tr>
  )
}

/**
 * The thumbnail, the name and the line under it.
 *
 * An image only when Inventory sent one AND the browser could load it: a
 * broken-image glyph in every row of a table is how a catalogue looks damaged
 * when all that happened is that one URL moved.
 */
function ItemIdentity({ row, onOpen }: { row: CatalogItemRow; onOpen?: () => void }) {
  const [imageFailed, setImageFailed] = useState(false)
  const subtitle = itemSubtitle(row)
  const service = row.type === 'service'
  const showImage = Boolean(row.image_url) && !imageFailed

  return (
    <div className="billing-item-cell">
      <span className={`billing-item-cell__thumb${service ? ' billing-item-cell__thumb--service' : ''}`} aria-hidden="true">
        {showImage ? (
          <img src={row.image_url as string} alt="" loading="lazy" onError={() => setImageFailed(true)} />
        ) : service ? (
          <Wrench size={16} />
        ) : (
          <Package size={16} />
        )}
      </span>
      <span className="billing-item-cell__text">
        {/* The whole row opens the panel, but a row is not reachable from a
            keyboard. The name is, so it carries the same action — omitted in
            the grid, where the card itself is already the button. */}
        {onOpen ? (
          <button type="button" className="billing-item-cell__name" title={row.item_name} onClick={onOpen}>
            {row.item_name}
          </button>
        ) : (
          <span className="billing-item-cell__name" title={row.item_name}>
            {row.item_name}
          </span>
        )}
        {subtitle && (
          <span className="billing-item-cell__detail" title={subtitle}>
            {subtitle}
          </span>
        )}
      </span>
    </div>
  )
}

function RowActions({ row, actions }: { row: CatalogItemRow; actions: ItemsActions }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  const inventoryHref = actions.inventoryUrlFor(row)

  useEffect(() => {
    if (!open) return undefined
    function onPointerDown(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    // The row opens the detail panel; nothing inside this cell should also do
    // that on its way past.
    <div className="billing-items-rowactions" onClick={(event) => event.stopPropagation()}>
      {actions.onBill && (
        <button
          type="button"
          className="billing-iconbutton"
          aria-label={`Put ${row.item_name} on a new bill`}
          title="Put on a new bill"
          onClick={() => actions.onBill?.(row)}
        >
          <Receipt size={16} aria-hidden />
        </button>
      )}
      <button
        type="button"
        className="billing-iconbutton"
        aria-label={`Copy the details of ${row.item_name}`}
        title="Copy name, SKU, HSN and rate"
        onClick={() => actions.onCopy(row)}
      >
        <Copy size={16} aria-hidden />
      </button>

      <div style={{ position: 'relative' }} ref={box}>
        <button
          type="button"
          className="billing-iconbutton"
          aria-label={`More for ${row.item_name}`}
          aria-expanded={open}
          aria-haspopup="menu"
          title="More"
          onClick={() => setOpen((value) => !value)}
        >
          <MoreHorizontal size={16} aria-hidden />
        </button>
        {open && (
          <div className="billing-menu" role="menu" style={{ minWidth: '13rem' }}>
            <button
              type="button"
              className="billing-menu__item"
              onClick={() => {
                setOpen(false)
                actions.onOpen(row)
              }}
            >
              <PackageSearch size={15} aria-hidden /> Item details
            </button>
            {inventoryHref && (
              <a
                className="billing-menu__item"
                href={inventoryHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
              >
                <ExternalLink size={15} aria-hidden /> Open in Inventory
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

export function ItemsGrid({ rows, actions, selectedId }: { rows: CatalogItemRow[]; actions: ItemsActions; selectedId: number | null }) {
  return (
    <div className="billing-items-grid">
      {rows.map((row) => {
        const status = statusReading(row)
        const stock = stockReading(row)
        const type = typeLabel(row)

        return (
          <button
            key={row.item_id}
            type="button"
            className="billing-item-card"
            data-selected={row.item_id === selectedId || undefined}
            onClick={() => actions.onOpen(row)}
          >
            <span className="billing-item-card__top">
              <ItemIdentity row={row} />
              {type && <span className={`billing-item-type billing-item-type--${row.type}`}>{type}</span>}
            </span>
            <span className="billing-item-card__meta">
              <span style={{ color: 'var(--billing-muted)', fontSize: 12 }}>
                {row.item_sku ?? 'No SKU'} · {row.group?.name ?? 'No group'}
              </span>
              <span className="billing-item-card__rate">{rate(row)}</span>
            </span>
            <span className="billing-item-card__meta">
              <Badge tone={status.tone}>{status.label}</Badge>
              <span className={`billing-item-stock billing-item-stock--${stock.state}`} title={stock.description}>
                <span className="billing-item-stock__dot" aria-hidden="true" />
                {stock.text}
                <span className="billing-sr-only"> — {stock.description}</span>
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function ItemsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-busy="true">
      <span className="billing-sr-only">Loading items from Aicountly Inventory</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="billing-items-skeleton__row">
          <span className="billing-skeleton billing-items-skeleton__thumb" />
          <span className="billing-skeleton billing-skeleton--line" style={{ maxWidth: '22%' }} />
          <span className="billing-skeleton billing-skeleton--line" style={{ maxWidth: '12%' }} />
          <span className="billing-skeleton billing-skeleton--line" style={{ maxWidth: '10%' }} />
          <span className="billing-skeleton billing-skeleton--line" style={{ maxWidth: '14%' }} />
          <span className="billing-skeleton billing-skeleton--line" style={{ maxWidth: '10%' }} />
        </div>
      ))}
    </div>
  )
}

/**
 * Two empty states, because they are two different situations.
 *
 * "Nothing matched what you typed" is something the user can fix in a second by
 * clearing a filter. "There are no items at all" is something only Inventory
 * can fix, and saying "try a different search" to somebody whose catalogue is
 * empty sends them looking for a list that was never there.
 */
export function ItemsEmpty({
  filtered,
  onClear,
  addHref,
}: {
  filtered: boolean
  onClear: () => void
  addHref: string | null
}) {
  if (filtered) {
    return (
      <div className="billing-items-empty">
        <span className="billing-items-empty__mark" aria-hidden="true">
          <SearchX size={24} />
        </span>
        <span className="billing-items-empty__title">No items match your filters</span>
        <p>Nothing in the catalogue answers to this search and these filters together. Widening one usually finds it.</p>
        <div className="billing-items-empty__actions">
          <button type="button" className="billing-button billing-button--primary" onClick={onClear}>
            Clear filters
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="billing-items-empty">
      <span className="billing-items-empty__mark" aria-hidden="true">
        <Package size={24} />
      </span>
      <span className="billing-items-empty__title">No items available yet</span>
      <p>
        Items are managed in Aicountly Inventory, and this company&rsquo;s catalogue is still empty. Anything added there
        shows up here straight away — there is nothing to import into Billing.
      </p>
      {addHref && (
        <div className="billing-items-empty__actions">
          <a className="billing-button billing-button--primary" href={addHref} target="_blank" rel="noopener noreferrer">
            Add an item in Inventory <ExternalLink size={14} aria-hidden />
          </a>
        </div>
      )}
    </div>
  )
}

export function ItemsFailed({
  message,
  onRetry,
  inventoryHref,
}: {
  message: string
  onRetry: () => void
  inventoryHref: string | null
}) {
  return (
    <div className="billing-items-failed" role="alert">
      <span className="billing-items-empty__mark" aria-hidden="true" style={{ background: '#fff', color: 'var(--billing-danger)' }}>
        <ServerCrash size={24} />
      </span>
      <span className="billing-items-failed__title">Unable to load items from Aicountly Inventory</span>
      <p>{message}</p>
      <div className="billing-items-failed__actions">
        <button type="button" className="billing-button billing-button--primary" onClick={onRetry}>
          Try again
        </button>
        {inventoryHref && (
          <a className="billing-button" href={inventoryHref} target="_blank" rel="noopener noreferrer">
            Open Inventory <ExternalLink size={14} aria-hidden />
          </a>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export function ItemsPager({
  query,
  shown,
  total,
  onPage,
  onPerPage,
}: {
  query: ItemsQuery
  shown: number
  total: number | null
  onPage: (page: number) => void
  onPerPage: (perPage: number) => void
}) {
  // A last page can only be worked out when Inventory said how many there are.
  // Without a total the pager still steps forward — it just does not pretend to
  // know where the end is.
  const lastPage = total === null ? null : Math.max(1, Math.ceil(total / query.perPage))
  const canGoBack = query.page > 1
  const canGoForward = lastPage === null ? shown === query.perPage : query.page < lastPage

  return (
    <footer className="billing-items-pager">
      <span>{rangeLabel(query.page, query.perPage, shown, total)}</span>

      <div className="billing-items-pager__right">
        <label className="billing-items-pager__size">
          <span>Per page</span>
          <select value={query.perPage} onChange={(event) => onPerPage(Number(event.target.value))}>
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <nav className="billing-items-pager__pages" aria-label="Pages">
          <button type="button" onClick={() => onPage(query.page - 1)} disabled={!canGoBack} aria-label="Previous page">
            ‹
          </button>

          {lastPage !== null ? (
            pageWindow(query.page, lastPage).map((entry, index) =>
              entry === 'gap' ? (
                <span key={`gap-${index}`} className="billing-items-pager__gap" aria-hidden="true">
                  …
                </span>
              ) : (
                <button
                  key={entry}
                  type="button"
                  aria-current={entry === query.page ? 'page' : undefined}
                  aria-label={`Page ${entry}`}
                  onClick={() => onPage(entry)}
                >
                  {entry}
                </button>
              ),
            )
          ) : (
            <button type="button" aria-current="page" aria-label={`Page ${query.page}`}>
              {query.page}
            </button>
          )}

          <button type="button" onClick={() => onPage(query.page + 1)} disabled={!canGoForward} aria-label="Next page">
            ›
          </button>
        </nav>
      </div>
    </footer>
  )
}
