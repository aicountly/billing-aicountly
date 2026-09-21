/**
 * The five figures above the list.
 *
 * Each arrives from the API with its own availability, and each is rendered on
 * its own terms: a count Inventory could not give says "Unavailable" with the
 * reason in its tooltip, and its four neighbours carry on. The alternative —
 * one failure blanking the row, or worse, five zeroes — is the thing this
 * product goes out of its way not to do.
 */

import { AlertTriangle, Boxes, CircleSlash, Package, Wrench } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ItemFigure, ItemStats } from '../../services/types'
import { count } from './items'

type CardKey = 'total' | 'stock' | 'service' | 'low' | 'inactive'

interface CardDef {
  key: CardKey
  figure: keyof ItemStats
  label: string
  helper: string
  icon: ReactNode
}

const CARDS: CardDef[] = [
  { key: 'total', figure: 'total', label: 'Total items', helper: 'In the Inventory catalogue', icon: <Package size={21} aria-hidden /> },
  { key: 'stock', figure: 'stock', label: 'Stock items', helper: 'Tracked in Inventory', icon: <Boxes size={21} aria-hidden /> },
  { key: 'service', figure: 'services', label: 'Service items', helper: 'Billed without stock', icon: <Wrench size={21} aria-hidden /> },
  { key: 'low', figure: 'low_stock', label: 'Low stock items', helper: 'Below reorder level', icon: <AlertTriangle size={21} aria-hidden /> },
  { key: 'inactive', figure: 'inactive', label: 'Inactive items', helper: 'Not in use', icon: <CircleSlash size={21} aria-hidden /> },
]

export function ItemsKpis({
  stats,
  loading,
  error,
  onOpen,
}: {
  stats: ItemStats | null
  loading: boolean
  error: string | null
  /** Where each card sends you — the tab that lists exactly what it counted. */
  onOpen: (key: CardKey) => void
}) {
  return (
    <section className="billing-items-kpis" aria-label="What is in the catalogue">
      {CARDS.map((card) => {
        const figure: ItemFigure | null = stats ? stats[card.figure] : null
        const busy = loading && figure === null

        return (
          <Kpi
            key={card.key}
            card={card}
            figure={figure}
            loading={busy}
            // A card that could not be read leads nowhere: a tab that claims to
            // list what a failed count counted would be a second wrong answer.
            onOpen={figure?.available ? () => onOpen(card.key) : undefined}
            fallbackReason={error}
          />
        )
      })}
    </section>
  )
}

function Kpi({
  card,
  figure,
  loading,
  onOpen,
  fallbackReason,
}: {
  card: CardDef
  figure: ItemFigure | null
  loading: boolean
  onOpen?: () => void
  fallbackReason: string | null
}) {
  const unavailable = !loading && (figure === null || !figure.available)
  const reason = figure?.reason ?? fallbackReason ?? 'This figure could not be read just now.'

  const inside = (
    <>
      <span className="billing-kpi__icon" aria-hidden="true">{card.icon}</span>
      <span className="billing-kpi__body">
        <span className="billing-kpi__label">{card.label}</span>
        {loading ? (
          <span className="billing-skeleton billing-kpi__skeleton">
            <span className="billing-sr-only">Loading {card.label}</span>
          </span>
        ) : unavailable ? (
          <strong className="billing-kpi__value billing-kpi__value--unavailable">Unavailable</strong>
        ) : (
          <strong className="billing-kpi__value">{count(figure?.value ?? null)}</strong>
        )}
        <span className="billing-kpi__helper">{unavailable ? reason : card.helper}</span>
      </span>
    </>
  )

  // The whole card is the target when there is somewhere to go. A button
  // rather than a clickable div, so it is reachable by keyboard and announces
  // itself as something that does something.
  if (onOpen) {
    return (
      <button
        type="button"
        className={`billing-kpi billing-kpi--${card.key} billing-kpi--open`}
        onClick={onOpen}
        title={`Show ${card.label.toLowerCase()}`}
      >
        {inside}
      </button>
    )
  }

  return (
    <article className={`billing-kpi billing-kpi--${card.key}`} aria-busy={loading || undefined}>
      {inside}
    </article>
  )
}
