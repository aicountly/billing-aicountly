/**
 * The suggestion bar.
 *
 * Every chip here does something deterministic with data that is already on the
 * screen or already behind an endpoint this product has. There is no purchase
 * intelligence service in this deployment, so nothing here calls one and
 * nothing pretends one answered: a chip that cannot do its job is disabled and
 * says what is missing.
 */

import { Sparkles } from 'lucide-react'

export interface Suggestion {
  key: string
  label: string
  disabled?: boolean
  /** Why it is disabled, or what it does. Shown on hover and to a screen reader. */
  title: string
  onRun: () => void
}

export function PurchaseSuggestionBar({
  suggestions,
  result,
}: {
  suggestions: Suggestion[]
  result: string | null
}) {
  return (
    <div className="purchase-suggestions">
      <span className="purchase-suggestions__title">
        <Sparkles size={13} aria-hidden />
        AI Suggestions
      </span>

      {suggestions.map((suggestion) => (
        <button
          key={suggestion.key}
          type="button"
          className="purchase-chip"
          disabled={suggestion.disabled}
          title={suggestion.title}
          aria-label={`${suggestion.label}. ${suggestion.title}`}
          onClick={suggestion.onRun}
        >
          {suggestion.label}
        </button>
      ))}

      {result && (
        <span className="purchase-suggestions__note" role="status" style={{ flexBasis: '100%' }}>
          {result}
        </span>
      )}
    </div>
  )
}
