/**
 * The small pieces the bill screen is built out of.
 *
 * A labelled field, a segmented chip group and a dialog — none of them
 * interesting on their own, all of them repeated enough on this screen that a
 * second copy would be the place the two drift apart. The styling is
 * `billing-sale*` classes; nothing here carries inline colour.
 */

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { AlertCircle, X } from 'lucide-react'

export function Field({
  label,
  note,
  hint,
  error,
  htmlFor,
  full = false,
  children,
}: {
  label: ReactNode
  /** A word beside the label — "optional", "auto". Not a hint; it sits inline. */
  note?: string
  hint?: ReactNode
  error?: string
  htmlFor?: string
  full?: boolean
  children: ReactNode
}) {
  return (
    <div className={full ? 'billing-sale__field billing-sale__field--full' : 'billing-sale__field'}>
      <label className="billing-sale__label" htmlFor={htmlFor}>
        {label}
        {note && <span className="billing-sale__label-note">{note}</span>}
      </label>
      {children}
      {error ? (
        <span className="billing-sale__error" role="alert">
          <AlertCircle size={12} aria-hidden /> {error}
        </span>
      ) : (
        hint && <span className="billing-sale__hint">{hint}</span>
      )}
    </div>
  )
}

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  title?: string
}

/**
 * A chip group.
 *
 * `readOnly` is not a disabled control: it is a READOUT — the bill's GST
 * treatment is derived from the customer and the place of supply, and pressing
 * it would be pressing a fact. It is rendered as a list rather than as buttons
 * so nothing invites a click that cannot do anything.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  readOnly = false,
  disabled = false,
}: {
  label: string
  options: ReadonlyArray<SegmentedOption<T>>
  value: T | null
  onChange?: (value: T) => void
  readOnly?: boolean
  disabled?: boolean
}) {
  if (readOnly) {
    return (
      <ul
        className="billing-sale__segmented billing-sale__segmented--readonly"
        aria-label={label}
        style={{ listStyle: 'none', margin: 0, padding: 0 }}
      >
        {options.map((option) => (
          <li
            key={option.value}
            className="billing-sale__segmented-option"
            data-active={option.value === value}
            title={option.title}
          >
            {option.label}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="billing-sale__segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="billing-sale__segmented-option"
          aria-pressed={option.value === value}
          disabled={disabled}
          title={option.title}
          onClick={() => onChange?.(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * A modal that closes on Escape and on a click outside, and puts focus back
 * where it came from.
 *
 * Deliberately not a <dialog>: Safari on the counter iPad this product is used
 * on is not reliably new enough for showModal(), and a dialog that does not
 * open is worse than one built out of a div.
 */
export function Dialog({
  title,
  subtitle,
  onClose,
  children,
  footer,
  narrow = false,
  labelledBy,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  narrow?: boolean
  labelledBy?: string
}) {
  const generatedId = useId()
  const headingId = labelledBy ?? generatedId
  const box = useRef<HTMLDivElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null
    // The panel itself takes focus, so Escape and Tab start inside the dialog
    // rather than back at the top of the document.
    box.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      returnTo.current?.focus?.()
    }
  }, [onClose])

  return (
    <div
      className="billing-sale-dialog__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={box}
        className={narrow ? 'billing-sale-dialog billing-sale-dialog--narrow' : 'billing-sale-dialog'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
      >
        <header className="billing-sale-dialog__head">
          <div>
            <h2 id={headingId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="billing-sale-dialog__close" onClick={onClose} aria-label="Close">
            <X size={17} aria-hidden />
          </button>
        </header>
        <div className="billing-sale-dialog__body">{children}</div>
        {footer && <footer className="billing-sale-dialog__foot">{footer}</footer>}
      </div>
    </div>
  )
}
