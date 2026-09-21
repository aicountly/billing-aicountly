/**
 * What Inventory currently holds of the items on this purchase.
 *
 * Read from Inventory's availability endpoint when an item is chosen, once per
 * item and warehouse, and thrown away when the screen closes. Billing keeps no
 * stock figure of its own — there is no balance table here and there never will
 * be, because a second copy of a quantity is a second answer to "how many have
 * I got".
 *
 * A hint, and only a hint: it never blocks a save. Goods arriving is exactly
 * the moment the number is about to change anyway.
 */

import { useEffect, useRef, useState } from 'react'
import { api } from '../../services/api'
import { useBilling } from '../../context/BillingContext'

export interface StockHint {
  /** Quantity on hand, or null when Inventory did not state one. */
  qty: number | null
  unit: string | null
}

type Row = Record<string, unknown>

function isRow(value: unknown): value is Row {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function firstNumber(row: Row, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key]
    if (value === null || value === undefined || value === '') continue
    const parsed = typeof value === 'number' ? value : Number(String(value).trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/** Inventory's availability payload, whichever shape this deployment sends. */
function parseHint(body: unknown): StockHint | null {
  const root = isRow(body) ? body : null
  if (!root) return null

  const data = isRow(root.data) ? root.data : Array.isArray(root.data) && isRow(root.data[0]) ? root.data[0] : root
  if (!isRow(data)) return null

  const qty = firstNumber(data, [
    'available',
    'available_qty',
    'availability',
    'qty_available',
    'closing_qty',
    'balance_qty',
    'on_hand',
    'qty',
    'balance',
  ])
  if (qty === null) return null

  const unit = typeof data.unit_symbol === 'string' ? data.unit_symbol
    : typeof data.unit_name === 'string' ? data.unit_name
    : typeof data.uom === 'string' ? data.uom
    : null

  return { qty, unit }
}

export function useStockHints(itemIds: number[], warehouseId: number | null, enabled: boolean) {
  const { scope } = useBilling()
  const [hints, setHints] = useState<Record<string, StockHint>>({})
  const asked = useRef(new Set<string>())

  const cmpId = scope?.cmp_id
  // A stable key: the effect must not re-run because a new array was built with
  // the same ids in it.
  const key = itemIds.join(',')

  useEffect(() => {
    // The warehouse is part of the answer, so changing it invalidates every
    // hint already on screen rather than leaving last warehouse's figures up.
    asked.current = new Set()
    setHints({})
  }, [warehouseId, cmpId])

  useEffect(() => {
    if (!enabled || !scope) return undefined

    const wanted = itemIds.filter((id) => !asked.current.has(`${id}:${warehouseId ?? 0}`))
    if (wanted.length === 0) return undefined

    const controller = new AbortController()
    let cancelled = false

    for (const itemId of wanted) {
      const cacheKey = `${itemId}:${warehouseId ?? 0}`
      asked.current.add(cacheKey)

      api
        .get<unknown>(
          'v1/catalog/stock',
          { item_id: itemId, warehouse_id: warehouseId ?? undefined },
          controller.signal,
        )
        .then((body) => {
          if (cancelled || controller.signal.aborted) return
          const hint = parseHint(body)
          if (hint) setHints((current) => ({ ...current, [cacheKey]: hint }))
        })
        .catch(() => {
          // Inventory not answering costs the hint under one line. Nothing else
          // on this screen depends on it.
          asked.current.delete(cacheKey)
        })
    }

    return () => {
      cancelled = true
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, warehouseId, enabled, cmpId])

  return (itemId: number | null): StockHint | null =>
    itemId === null ? null : (hints[`${itemId}:${warehouseId ?? 0}`] ?? null)
}
