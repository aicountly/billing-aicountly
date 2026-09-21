/**
 * The form primitives this screen is built from.
 *
 * They exist beside the app's shared `ui/Field` rather than replacing it: the
 * shared one is a comfortable stacked field for a page with a dozen controls,
 * and this screen has thirty-odd in a dense grid where 11px labels and 40px
 * controls are what make a bill fit on one screen. Same tokens, same focus
 * ring, different density.
 */

import { AlertCircle } from 'lucide-react'
import type { ReactNode } from 'react'

export function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  className,
  children,
}: {
  label: string
  htmlFor?: string
  required?: boolean
  hint?: ReactNode
  error?: string
  className?: string
  children: ReactNode
}) {
  const caption = (
    <>
      {label}
      {required && (
        <>
          {' '}
          <em aria-hidden>*</em>
          <span className="billing-sr-only">(required)</span>
        </>
      )}
    </>
  )

  return (
    <div className={`purchase-field${className ? ` ${className}` : ''}`}>
      {/* A derived value is not a control, so it gets a caption rather than a
          label — a <label for> pointing at nothing is a label that names
          nothing, and clicking it does nothing either. */}
      {htmlFor ? (
        <label className="purchase-field__label" htmlFor={htmlFor}>
          {caption}
        </label>
      ) : (
        <span className="purchase-field__label">{caption}</span>
      )}

      {children}

      {/* The message is never the only signal — the border turns red as well,
          and the control carries aria-invalid — because colour alone excludes
          anybody who cannot see it. */}
      {error ? (
        <p className="purchase-field__error" role="alert">
          <AlertCircle size={13} aria-hidden />
          {error}
        </p>
      ) : (
        hint && <p className="purchase-field__hint">{hint}</p>
      )}
    </div>
  )
}

/** A value the screen worked out. Not an input, because it is not editable. */
export function DerivedValue({ value, empty }: { value: string | null; empty: string }) {
  return (
    <div className={`purchase-derived${value ? '' : ' purchase-derived--empty'}`}>{value ?? empty}</div>
  )
}
