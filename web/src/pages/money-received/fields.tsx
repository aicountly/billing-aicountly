/**
 * The form controls this screen is built from.
 *
 * They are the tokens and the field styling the rest of Billing already uses,
 * with the two things a money screen needs on top: a label that says what is
 * required without relying on colour, and an error that is announced rather
 * than only painted red.
 */

import { useId, useState, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { groupAmount, parseAmount } from './form'

export function Field({
  label,
  required = false,
  error,
  hint,
  htmlFor,
  children,
}: {
  label: string
  required?: boolean
  error?: string
  hint?: ReactNode
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="billing-receipt-field" data-invalid={error ? 'true' : undefined}>
      {htmlFor ? (
        <label htmlFor={htmlFor}>
          {label}
          {required && (
            <span className="billing-receipt-field__required" aria-hidden="true">
              *
            </span>
          )}
          {required && <span className="billing-sr-only"> (required)</span>}
        </label>
      ) : (
        <span className="billing-receipt-field__label">
          {label}
          {required && (
            <span className="billing-receipt-field__required" aria-hidden="true">
              *
            </span>
          )}
        </span>
      )}

      {children}

      {error ? (
        <span className="billing-receipt-field__error" role="alert">
          <AlertCircle size={13} aria-hidden /> {error}
        </span>
      ) : (
        hint && <span className="billing-receipt-field__hint">{hint}</span>
      )}
    </div>
  )
}

/**
 * The amount.
 *
 * The raw text is what the user typed and what the form keeps; the grouped
 * figure is only ever a display, shown when the box is not being edited. The
 * number sent to the API is parsed from the raw text, so nothing that happens
 * here can round or reformat the amount somebody typed.
 */
export function AmountInput({
  id,
  value,
  onChange,
  invalid,
  inputRef,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  inputRef?: React.RefObject<HTMLInputElement | null>
}) {
  const [focused, setFocused] = useState(false)
  const parsed = parseAmount(value)
  const shown = !focused && parsed !== null && value.trim() !== '' ? groupAmount(parsed) : value

  return (
    <div className="billing-receipt-input billing-receipt-input--amount">
      <span className="billing-receipt-input__icon" aria-hidden="true">
        ₹
      </span>
      <input
        id={id}
        ref={inputRef}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        value={shown}
        aria-invalid={invalid || undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          const next = event.target.value
          // Anything that is not a figure is refused at the keystroke rather
          // than accepted and complained about on save.
          if (next === '' || parseAmount(next) !== null) onChange(next.replace(/[\s,₹]/g, ''))
        }}
      />
    </div>
  )
}

/** An input with a mark in front of it — search, calendar, document. */
export function IconInput({
  icon,
  children,
}: {
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <div className="billing-receipt-input">
      <span className="billing-receipt-input__icon" aria-hidden="true">
        {icon}
      </span>
      {children}
    </div>
  )
}

/** Remarks, with the character budget shown rather than silently enforced. */
export function RemarksInput({
  value,
  onChange,
  limit,
}: {
  value: string
  onChange: (value: string) => void
  limit: number
}) {
  const id = useId()
  const described = `${id}-limit`

  return (
    <div className="billing-receipt-field">
      <label htmlFor={id}>Remarks</label>
      <div className="billing-receipt-textarea">
        <textarea
          id={id}
          value={value}
          maxLength={limit}
          aria-describedby={described}
          placeholder="Add a note (optional)…"
          onChange={(event) => onChange(event.target.value)}
        />
        {/* The count is a budget, not news: it is described once when the box
            is reached rather than announced on every keystroke. */}
        <span className="billing-receipt-counter" aria-hidden="true">
          {value.length}/{limit}
        </span>
      </div>
      <span className="billing-sr-only" id={described}>
        Up to {limit} characters.
      </span>
    </div>
  )
}
