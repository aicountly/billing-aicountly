/**
 * One item, opened from the list.
 *
 * READ ONLY, and that is not a limitation to be fixed later — it is the
 * architecture. Inventory owns the item, so the only honest thing a Billing
 * panel can do with it is show it and offer the door to where it is edited.
 * Everything in here was read from Inventory on the request that drew the list;
 * nothing was stored, so nothing can be stale in a way the screen cannot see.
 *
 * It behaves as a dialog is supposed to: focus moves in, Tab wraps inside it,
 * Escape closes it, and focus goes back to the row that opened it.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { ExternalLink, Package, Receipt, Wrench, X } from 'lucide-react'
import type { CatalogItemRow } from '../../services/types'
import { Badge } from '../../dashboards/kit'
import { qty } from '../../ui'
import { rate, statusReading, stockReading, typeLabel } from './items'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function ItemDetailDrawer({
  row,
  onClose,
  onBill,
  inventoryHref,
  maySeeCost,
}: {
  row: CatalogItemRow | null
  onClose: () => void
  onBill?: (row: CatalogItemRow) => void
  inventoryHref: string | null
  /** Decided by the server, which also strips the fields. This only hides a line. */
  maySeeCost: boolean
}) {
  const panel = useRef<HTMLDivElement | null>(null)
  const returnTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!row) return undefined

    returnTo.current = document.activeElement as HTMLElement | null
    // The list behind it does not scroll under a finger that misses the panel.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panel.current) return

      const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (event.shiftKey && (active === first || !panel.current.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previousOverflow
      returnTo.current?.focus()
    }
  }, [row, onClose])

  if (!row) return null

  const status = statusReading(row)
  const stock = stockReading(row)
  const type = typeLabel(row)
  const service = row.type === 'service'

  return (
    <>
      <div className="billing-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="billing-item-drawer" role="dialog" aria-modal="true" aria-label={row.item_name} ref={panel}>
        <div className="billing-item-drawer__head">
          <div style={{ display: 'flex', gap: 12, minWidth: 0 }}>
            <span className={`billing-item-cell__thumb${service ? ' billing-item-cell__thumb--service' : ''}`} aria-hidden="true">
              {service ? <Wrench size={16} /> : <Package size={16} />}
            </span>
            <div style={{ minWidth: 0 }}>
              <h2>{row.item_name}</h2>
              <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                {type && <span className={`billing-item-type billing-item-type--${row.type}`}>{type}</span>}
                <Badge tone={status.tone}>{status.label}</Badge>
              </div>
            </div>
          </div>
          <button type="button" className="billing-iconbutton" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="billing-item-drawer__body">
          {row.description && <p style={{ margin: 0, color: 'var(--billing-muted)', lineHeight: 1.55 }}>{row.description}</p>}

          <div className="billing-item-drawer__facts">
            <Fact label="SKU">{row.item_sku ?? '—'}</Fact>
            <Fact label="HSN / SAC">{row.hsn_sac ?? '—'}</Fact>
            <Fact label="Group">{row.group?.name ?? '—'}</Fact>
            <Fact label="Unit">{row.unit_name ?? '—'}</Fact>
            <Fact label="Selling rate">{rate(row)}</Fact>
            <Fact label="Barcode">{row.barcode ?? '—'}</Fact>
            <Fact label="Available">
              <span className={`billing-item-stock billing-item-stock--${stock.state}`}>
                <span className="billing-item-stock__dot" aria-hidden="true" />
                {stock.text}
              </span>
              <span style={{ display: 'block', marginTop: 3, color: 'var(--billing-muted)', fontSize: 12 }}>
                {stock.description}
              </span>
            </Fact>
            <Fact label="Reorder level">{row.stock.threshold === null ? '—' : qty(row.stock.threshold)}</Fact>
          </div>

          {!maySeeCost && (
            <p style={{ margin: 0, color: 'var(--billing-muted)', fontSize: 12, lineHeight: 1.5 }}>
              Purchase cost and margin are not part of your Billing profile, so they are not shown — and the API does
              not send them either.
            </p>
          )}

          <p style={{ margin: 0, fontSize: 12, color: 'var(--billing-muted)', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--billing-text)' }}>Live from Aicountly Inventory.</strong> Billing keeps no
            copy of this item, so what is above was read when this list was drawn. To change any of it, open the item in
            Inventory.
          </p>
        </div>

        <div className="billing-item-drawer__foot">
          {onBill && (
            <button type="button" className="billing-button billing-button--primary" onClick={() => onBill(row)}>
              <Receipt size={15} aria-hidden /> Put on a bill
            </button>
          )}
          {inventoryHref && (
            <a className="billing-button" href={inventoryHref} target="_blank" rel="noopener noreferrer">
              Open in Inventory <ExternalLink size={14} aria-hidden />
            </a>
          )}
        </div>
      </div>
    </>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="billing-item-drawer__key">{label}</span>
      <span className="billing-item-drawer__val">{children}</span>
    </div>
  )
}
