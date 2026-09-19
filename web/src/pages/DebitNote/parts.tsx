/**
 * The small pieces the debit note screen is assembled from.
 *
 * Kept apart from the cards so the cards read as layout, and so the field
 * wiring — label, hint, error and the aria-describedby that ties them together —
 * is written once rather than nine times.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, Check, ChevronDown } from 'lucide-react'
import type { StepState } from './model'

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export function DnCard({
  title,
  icon,
  tone = 'green',
  action,
  children,
  flush = false,
}: {
  title?: ReactNode
  icon?: ReactNode
  tone?: 'green' | 'doc' | 'ai'
  action?: ReactNode
  children: ReactNode
  /** Skip the body padding — for a card whose body is a table. */
  flush?: boolean
}) {
  const toneClass = tone === 'doc' ? ' dn-card__icon--doc' : tone === 'ai' ? ' dn-card__icon--ai' : ''

  return (
    <section className="dn-card">
      {(title || action) && (
        <header className="dn-card__head">
          <div className="dn-card__title">
            {icon && <span className={`dn-card__icon${toneClass}`} aria-hidden>{icon}</span>}
            <h2>{title}</h2>
          </div>
          {action && <div className="dn-card__actions">{action}</div>}
        </header>
      )}
      <div className={flush ? '' : 'dn-card__body'}>{children}</div>
    </section>
  )
}

/** A sidebar card: one heading, no chrome, body padding always. */
export function DnAsideCard({
  title,
  children,
  className = '',
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`dn-card ${className}`.trim()}>
      <div className="dn-card__body" style={{ display: 'grid', gap: 12 }}>
        <h3 style={{ margin: 0, fontSize: 14, letterSpacing: '-0.01em' }}>{title}</h3>
        {children}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/**
 * A labelled control.
 *
 * `children` is a render prop rather than a node because the control needs the
 * generated ids: a hint and an error that are not pointed at by
 * aria-describedby are a hint and an error a screen reader never reads.
 */
export function DnField({
  label,
  required = false,
  hint,
  error,
  links,
  children,
}: {
  label: string
  required?: boolean
  hint?: ReactNode
  error?: string
  links?: ReactNode
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined

  return (
    <div className="dn-field">
      <label className="dn-field__label" htmlFor={id}>
        {label}
        {required && <span className="dn-req" aria-hidden>*</span>}
        {required && <span className="billing-sr-only"> (required)</span>}
      </label>

      {children({ id, describedBy, invalid: Boolean(error) })}

      {error && (
        <span className="dn-field__error" id={errorId}>
          <AlertCircle size={13} aria-hidden style={{ flex: '0 0 auto', marginTop: 1 }} />
          {error}
        </span>
      )}
      {hint && !error && <span className="dn-field__hint" id={hintId}>{hint}</span>}
      {links && <div className="dn-field__links">{links}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stepper
// ---------------------------------------------------------------------------

/**
 * Where the form has got to.
 *
 * `aria-current` marks the active step and each step says in words whether it
 * is done, because the only other signal is a colour and a tick.
 */
export function DnStepper({ steps, active }: { steps: StepState[]; active: number }) {
  return (
    <nav className="dn-stepper" aria-label="Progress">
      <ol className="dn-stepper__list">
        {steps.map((step, index) => (
          <li
            key={step.key}
            className={`dn-step${index === active ? ' dn-step--active' : ''}${step.done ? ' dn-step--done' : ''}`}
            aria-current={index === active ? 'step' : undefined}
          >
            <span className="dn-step__num" aria-hidden>
              {step.done ? <Check size={16} /> : index + 1}
            </span>
            <span className="dn-step__text">
              <strong>
                {step.title}
                <span className="billing-sr-only">{step.done ? ' — done' : ' — not done yet'}</span>
              </strong>
              <span>{step.hint}</span>
            </span>
            {index < steps.length - 1 && <span className="dn-step__line" aria-hidden />}
          </li>
        ))}
      </ol>
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

/**
 * A dropdown that closes on Escape, on a click outside and on choosing
 * something, and hands focus back to its trigger.
 *
 * The shell has one of these for the header, but it is private to that file and
 * styled as an icon button. Rather than export and reshape it, this is the same
 * behaviour on a normal button — the behaviour is what matters, and it is
 * fifteen lines.
 */
export function DnMenu({
  label,
  ariaLabel,
  align = 'right',
  disabled = false,
  children,
}: {
  label: ReactNode
  ariaLabel: string
  align?: 'left' | 'right'
  disabled?: boolean
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return undefined

    function onPointerDown(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      // Stop the page's own Escape handling: closing this menu is what the
      // user meant, not whatever Escape does on the screen behind it.
      event.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  return (
    <div style={{ position: 'relative' }} ref={box}>
      <button
        type="button"
        ref={trigger}
        className="billing-button billing-button--small"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div
          className="billing-menu"
          role="menu"
          style={{ left: align === 'left' ? 0 : 'auto', right: align === 'right' ? 0 : 'auto', minWidth: 230 }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
