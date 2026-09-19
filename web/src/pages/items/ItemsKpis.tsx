/**
 * The five figures above the table.
 *
 * Each one is Inventory's own count for the filter behind the tab it heads, so
 * pressing a card and pressing its tab show the same list — the card IS the
 * tab, which is why they are buttons rather than decoration.
 *
 * There is no "↑ 12% vs last month" on any of them. Inventory counts what is
 * in the catalogue now and keeps no history of what it held in August, so a
 * trend here would be a number this product invented. A count it will not give
 * reads "Unavailable" with the reason on hover, never a nought.
 */

import { Ban, AlertTriangle, Boxes, Package, Wrench } from 'lucide-react'
import type { ItemStats } from '../../services/types'
import type { ItemTab } from './useItemsQuery'

interface Card {
  tab: ItemTab
  label: string
  helper: string
  tone: 'green' | 'teal' | 'purple' | 'amber' | 'grey'
  icon: typeof Package
  value: number | null
}

export function ItemsKpis({
  stats,
  loading,
  reason,
  active,
  onPick,
}: {
  stats: ItemStats | null
  loading: boolean
  reason: string | null
  active: ItemTab
  onPick: (tab: ItemTab) => void
}) {
  const cards: Card[] = [
    { tab: 'all', label: 'Total items', helper: 'In the catalogue', tone: 'green', icon: Boxes, value: stats?.total ?? null },
    { tab: 'stock', label: 'Stock items', helper: 'Physical items (Inventory)', tone: 'teal', icon: Package, value: stats?.stock ?? null },
    { tab: 'service', label: 'Service items', helper: 'Not stocked', tone: 'purple', icon: Wrench, value: stats?.services ?? null },
    { tab: 'low', label: 'Low stock', helper: 'At or below reorder level', tone: 'amber', icon: AlertTriangle, value: stats?.low_stock ?? null },
    { tab: 'inactive', label: 'Inactive', helper: 'Not in use', tone: 'grey', icon: Ban, value: stats?.inactive ?? null },
  ]

  return (
    <section className="items-kpis" aria-label="Catalogue summary">
      {cards.map((card) => {
        const Icon = card.icon
        const unavailable = !loading && card.value === null

        return (
          <button
            type="button"
            key={card.tab}
            className="items-kpi"
            aria-pressed={active === card.tab}
            onClick={() => onPick(card.tab)}
          >
            <span className={`items-kpi__icon items-kpi__icon--${card.tone}`} aria-hidden>
              <Icon size={20} />
            </span>
            <span className="items-kpi__body">
              <span className="items-kpi__label">{card.label}</span>
              {loading ? (
                <span className="billing-skeleton items-kpi__skeleton" />
              ) : unavailable ? (
                <span
                  className="items-kpi__unavailable"
                  title={reason ?? 'Aicountly Inventory did not return this count.'}
                >
                  Unavailable
                </span>
              ) : (
                <span className="items-kpi__value num">
                  {new Intl.NumberFormat('en-IN').format(card.value as number)}
                </span>
              )}
              <span className="items-kpi__helper">{unavailable ? 'Ask Inventory' : card.helper}</span>
            </span>
          </button>
        )
      })}
    </section>
  )
}
