/**
 * The small pieces the Items table and grid are both built from.
 *
 * One rule runs through all of them: a fact Inventory did not send is drawn as
 * "Unavailable", never as a nought and never as a blank that reads like one.
 * A shop looking at 0 on a shelf it has just restocked is a support call; a
 * shop looking at "Unavailable" knows to ask Inventory.
 *
 * The second rule is that colour never carries meaning on its own. Every
 * status pill and every stock dot is next to the word it means, so the screen
 * works for a person who cannot tell the green from the amber.
 */

import { useState } from 'react'
import { AlertTriangle, Package, RefreshCw, Search, Wrench } from 'lucide-react'
import type { CatalogItemView, ItemStock } from '../../services/types'

// ---------------------------------------------------------------------- badges

export function TypeBadge({ type }: { type: CatalogItemView['type'] }) {
  if (!type) {
    return (
      <span className="items-badge items-badge--unknown" title="Aicountly Inventory did not say whether this is a stock or a service item">
        Not set
      </span>
    )
  }

  return (
    <span className={`items-badge items-badge--${type}`}>{type === 'stock' ? 'Stock' : 'Service'}</span>
  )
}

/**
 * Active, Low stock, Out of stock, Inactive — one pill, and it is the item's
 * state as Inventory holds it, not a total computed from Billing's documents.
 */
export function StatusPill({ view }: { view: CatalogItemView }) {
  if (view.status === 'inactive') {
    return (
      <span className="items-status items-status--inactive">
        <span className="items-status__dot" aria-hidden /> Inactive
      </span>
    )
  }

  if (view.stock.applicable && view.stock.state === 'out') {
    return (
      <span className="items-status items-status--out">
        <span className="items-status__dot" aria-hidden /> Out of stock
      </span>
    )
  }

  if (view.stock.applicable && view.stock.state === 'low') {
    return (
      <span className="items-status items-status--low">
        <span className="items-status__dot" aria-hidden /> Low stock
      </span>
    )
  }

  if (view.status === 'active') {
    return (
      <span className="items-status items-status--active">
        <span className="items-status__dot" aria-hidden /> Active
      </span>
    )
  }

  return (
    <span className="items-status items-status--unknown" title="Aicountly Inventory did not send a status for this item">
      <span className="items-status__dot" aria-hidden /> Not set
    </span>
  )
}

// ----------------------------------------------------------------------- stock

export function StockCell({ stock }: { stock: ItemStock }) {
  if (!stock.applicable) {
    return (
      <span className="items-stock items-stock--none" title="A service is not stocked">
        —
      </span>
    )
  }

  if (stock.available === null) {
    return (
      <span className="items-stock items-stock--unknown" title="Aicountly Inventory did not return a quantity for this item">
        Unavailable
      </span>
    )
  }

  const state = stock.state ?? 'normal'

  return (
    <span className={`items-stock items-stock--${state}`}>
      <span className="items-stock__dot" aria-hidden />
      <span className="num">{formatQty(stock.available)}</span>
      {state !== 'normal' && (
        <span className="billing-sr-only">{state === 'out' ? 'out of stock' : 'below the reorder level'}</span>
      )}
    </span>
  )
}

/** Indian digit grouping, and no trailing zeros on a whole number of things. */
export function formatQty(value: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 4 }).format(value)
}

// ------------------------------------------------------------------- thumbnail

/**
 * The item's picture, or a mark standing in for one.
 *
 * A broken-image glyph in a table reads as a fault in this screen rather than
 * as an item nobody has photographed, so a failed load falls back to the same
 * mark an item with no picture gets.
 */
export function ItemThumb({ view, size = 'sm' }: { view: CatalogItemView; size?: 'sm' | 'lg' }) {
  const [broken, setBroken] = useState(false)
  const className = `items-thumb items-thumb--${size}`

  if (view.image_url && !broken) {
    return (
      <span className={className}>
        <img src={view.image_url} alt="" loading="lazy" onError={() => setBroken(true)} />
      </span>
    )
  }

  return (
    <span className={className} aria-hidden>
      {view.type === 'service' ? <Wrench size={size === 'lg' ? 26 : 16} /> : <Package size={size === 'lg' ? 26 : 16} />}
    </span>
  )
}

// ---------------------------------------------------------------------- states

export function ItemsSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="items-skeleton" aria-busy="true">
      <span className="billing-sr-only">Reading the catalogue from Aicountly Inventory</span>
      {Array.from({ length: rows }, (_, index) => (
        <div className="items-skeleton__row" key={index}>
          <span className="billing-skeleton items-skeleton__thumb" />
          <span className="billing-skeleton items-skeleton__line" />
          <span className="billing-skeleton items-skeleton__pill" />
          <span className="billing-skeleton items-skeleton__pill" />
          <span className="billing-skeleton items-skeleton__pill" />
        </div>
      ))}
    </div>
  )
}

/**
 * Two empty states, because they are two different situations and one message
 * cannot serve both. "Nothing here" wants a way to add something; "nothing
 * matched" wants the filters undone.
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
      <div className="items-empty">
        <span className="items-empty__mark" aria-hidden>
          <Search size={22} />
        </span>
        <h2>No items match your filters.</h2>
        <p>Try a different search, or clear what is applied and start again.</p>
        <button type="button" className="billing-button" onClick={onClear}>
          Clear filters
        </button>
      </div>
    )
  }

  return (
    <div className="items-empty">
      <span className="items-empty__mark" aria-hidden>
        <Package size={22} />
      </span>
      <h2>No items available yet.</h2>
      <p>Items are managed through Aicountly Inventory. Anything added there appears here straight away.</p>
      {addHref && (
        <a className="billing-button billing-button--primary" href={addHref}>
          Add item in Inventory
        </a>
      )}
    </div>
  )
}

/**
 * Inventory did not answer.
 *
 * Contained in the panel rather than replacing the page, so the tabs, the
 * filters and the rest of the shell stay where they were — and the message is
 * the one the server wrote in plain language, never a stack trace or an
 * endpoint.
 */
export function ItemsError({
  message,
  onRetry,
  inventoryHref,
}: {
  message: string
  onRetry: () => void
  inventoryHref: string | null
}) {
  return (
    <div className="items-error" role="alert">
      <span className="items-error__mark" aria-hidden>
        <AlertTriangle size={22} />
      </span>
      <h2>Unable to load items from Aicountly Inventory.</h2>
      <p>{message}</p>
      <div className="items-error__actions">
        <button type="button" className="billing-button billing-button--primary" onClick={onRetry}>
          <RefreshCw size={15} aria-hidden /> Retry
        </button>
        {inventoryHref && (
          <a className="billing-button" href={inventoryHref} target="_blank" rel="noreferrer">
            Open Inventory
          </a>
        )}
      </div>
    </div>
  )
}
