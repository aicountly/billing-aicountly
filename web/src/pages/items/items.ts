/**
 * How one item reads on screen.
 *
 * The whole file exists to keep one rule in one place: a figure Inventory did
 * not give is never drawn as a number. A service has no stock and says "—"; a
 * quantity nobody could read says "Unavailable"; neither says 0, because 0 is a
 * fact about the shelf and both of these are facts about the answer.
 */

import type { CatalogItemRow, ItemStockState } from '../../services/types'
import { money, qty } from '../../ui'

/** A count, grouped the way the numbers on this screen are read. */
export function count(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-IN') : '—'
}

/**
 * The selling rate, in the document's own currency.
 *
 * `money()` already groups the Indian way and takes the currency from what was
 * sent rather than assuming INR — a company trading in another one gets its own
 * symbol instead of a rupee sign in front of the wrong number.
 */
export function rate(row: CatalogItemRow): string {
  if (row.rate === null) return '—'
  return money(row.rate, row.currency ?? 'INR')
}

export interface StockReading {
  /** What the cell shows. */
  text: string
  state: ItemStockState
  /** Read out instead of the dot, so the meaning does not depend on seeing a colour. */
  description: string
}

export function stockReading(row: CatalogItemRow): StockReading {
  const { state, available, threshold } = row.stock

  if (state === 'none') {
    return { text: '—', state, description: 'A service is not stocked.' }
  }
  if (state === 'unknown' || available === null) {
    return {
      text: 'Unavailable',
      state: 'unknown',
      description: 'Aicountly Inventory did not answer with a quantity for this item. This is not zero.',
    }
  }

  const amount = qty(available)
  if (state === 'out') {
    return { text: amount, state, description: 'Out of stock.' }
  }
  if (state === 'low') {
    return {
      text: amount,
      state,
      description: threshold === null ? 'Running low.' : `Running low — Inventory's level for this item is ${qty(threshold)}.`,
    }
  }

  return { text: amount, state, description: 'In stock.' }
}

export type ItemStatusKey = 'active' | 'inactive' | 'low' | 'out' | 'unknown'

export interface StatusReading {
  key: ItemStatusKey
  label: string
  tone: 'success' | 'warning' | 'danger' | 'neutral'
}

/**
 * The one word in the Status column.
 *
 * Inactive beats everything: an item nobody is selling any more is not
 * interesting for being low. After that the stock state is the useful thing to
 * say about an active item, which is why "Low stock" appears here rather than
 * only in the column next door.
 */
export function statusReading(row: CatalogItemRow): StatusReading {
  if (row.is_active === false) return { key: 'inactive', label: 'Inactive', tone: 'neutral' }
  if (row.stock.state === 'out') return { key: 'out', label: 'Out of stock', tone: 'danger' }
  if (row.stock.state === 'low') return { key: 'low', label: 'Low stock', tone: 'warning' }
  if (row.is_active === true) return { key: 'active', label: 'Active', tone: 'success' }

  // Inventory said nothing either way. "Not stated" is the honest word, and it
  // is not the same as inactive — an item wrongly shown as withdrawn is an item
  // somebody stops billing.
  return { key: 'unknown', label: 'Not stated', tone: 'neutral' }
}

export function typeLabel(row: CatalogItemRow): string | null {
  if (row.type === 'stock') return 'Stock'
  if (row.type === 'service') return 'Service'
  return null
}

/** The line under the item's name: its own description, else its unit or group. */
export function itemSubtitle(row: CatalogItemRow): string | null {
  if (row.description) return row.description
  if (row.unit_name) return `Sold in ${row.unit_name}`
  return row.group?.name ?? null
}

/**
 * The page numbers to draw, with gaps.
 *
 * Always the first and last, always the current and its neighbours, and an
 * ellipsis where the run is broken. Drawing all fifty is a pager nobody can
 * hit the right number in.
 */
export function pageWindow(current: number, last: number): Array<number | 'gap'> {
  if (last <= 7) return Array.from({ length: Math.max(last, 1) }, (_, index) => index + 1)

  const pages = new Set<number>([1, last, current, current - 1, current + 1])
  if (current <= 3) [2, 3, 4].forEach((page) => pages.add(page))
  if (current >= last - 2) [last - 3, last - 2, last - 1].forEach((page) => pages.add(page))

  const ordered = [...pages].filter((page) => page >= 1 && page <= last).sort((a, b) => a - b)

  const out: Array<number | 'gap'> = []
  let previous = 0
  for (const page of ordered) {
    if (previous !== 0 && page - previous > 1) out.push('gap')
    out.push(page)
    previous = page
  }

  return out
}

/**
 * "Showing 26 to 50 of 1,248 items" — or as much of it as is known.
 *
 * `total` is null when Inventory did not say how many there are, and inventing
 * one from the page in hand is how a footer ends up claiming 25 of 25 while the
 * Next button still works.
 */
export function rangeLabel(page: number, perPage: number, shown: number, total: number | null): string {
  if (shown === 0) return total === 0 ? 'No items' : 'Nothing on this page'

  const from = (page - 1) * perPage + 1
  const to = from + shown - 1

  if (total === null) return `Showing ${count(from)} to ${count(to)}`
  return `Showing ${count(from)} to ${count(to)} of ${count(total)} ${total === 1 ? 'item' : 'items'}`
}
