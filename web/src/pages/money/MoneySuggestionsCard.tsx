/**
 * Smart Suggestions.
 *
 * Named for what it is. There is no model and no service behind this panel —
 * every line is produced by `buildMoneyHints` from data already on the screen,
 * and when there is no party chosen there is nothing to say, so it says that
 * instead of filling the space.
 */

import { AlertTriangle, History, Info, Sparkles } from 'lucide-react'
import type { MoneyHint } from './suggestions'
import type { Direction } from './money'

export function MoneySuggestionsCard({
  direction,
  hints,
  loading,
  hasParty,
  onAct,
}: {
  direction: Direction
  hints: MoneyHint[]
  loading: boolean
  hasParty: boolean
  onAct: (hint: MoneyHint) => void
}) {
  const them = direction === 'out' ? 'supplier' : 'customer'

  return (
    <section className="billing-panel billing-money__smart">
      <div className="billing-panel__heading">
        <div className="billing-money__smart-title">
          <span className="billing-money__card-mark" aria-hidden="true">
            <Sparkles size={18} />
          </span>
          {/* The badge sits inside the heading so the two wrap together as one
              phrase. Beside it as a sibling, it dropped to its own line in the
              narrow rail and read as a stray label. */}
          <h2>
            Smart suggestions <span className="billing-money__beta">BETA</span>
          </h2>
        </div>
      </div>

      <div className="billing-money__hints" aria-live="polite">
        {!hasParty ? (
          <div className="billing-money__hint billing-money__hint-empty">
            <p>Select a {them} to see payment insights.</p>
          </div>
        ) : loading && hints.length === 0 ? (
          <div className="billing-skeleton-rows" aria-busy="true">
            <span className="billing-sr-only">Reading this {them}'s history</span>
            <span className="billing-skeleton billing-skeleton--line" />
            <span className="billing-skeleton billing-skeleton--line" />
          </div>
        ) : hints.length === 0 ? (
          <div className="billing-money__hint billing-money__hint-empty">
            <p>Nothing to flag on this entry.</p>
          </div>
        ) : (
          hints.map((hint) => <Hint key={hint.id} hint={hint} onAct={onAct} />)
        )}
      </div>
    </section>
  )
}

function Hint({ hint, onAct }: { hint: MoneyHint; onAct: (hint: MoneyHint) => void }) {
  // Colour is never the only cue — each tone has its own mark as well.
  const Mark = hint.tone === 'warning' ? AlertTriangle : hint.tone === 'history' ? History : Info

  return (
    <div className="billing-money__hint">
      <div className="billing-money__hint-body">
        <span className={`billing-money__hint-mark billing-money__hint-mark--${hint.tone}`} aria-hidden="true">
          <Mark size={14} />
        </span>
        <p>{hint.message}</p>
      </div>
      {hint.action && (
        <button
          type="button"
          className="billing-button billing-button--soft billing-button--small"
          onClick={() => onAct(hint)}
        >
          {hint.action.label}
        </button>
      )}
    </div>
  )
}
