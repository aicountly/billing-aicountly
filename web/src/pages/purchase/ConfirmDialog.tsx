/**
 * A confirmation the user can read.
 *
 * `window.confirm` blocks the whole tab, cannot be styled, and on a phone looks
 * like the browser is warning about the site rather than the app asking a
 * question. This is the same question, in the product's own voice, focus-
 * trapped and dismissible with Escape.
 */

import { useEffect, useRef, type ReactNode } from 'react'

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Keep editing',
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const panel = useRef<HTMLDivElement | null>(null)
  const returnTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return undefined

    returnTo.current = document.activeElement as HTMLElement | null
    // The safe choice takes focus, so Enter on a dialog nobody read keeps the
    // work rather than throwing it away.
    panel.current?.querySelector<HTMLButtonElement>('[data-autofocus]')?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCancel()
        return
      }
      if (event.key !== 'Tab' || !panel.current) return

      const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not([disabled])'))
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      returnTo.current?.focus()
    }
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="purchase-dialog-backdrop" onClick={onCancel}>
      <div
        className="purchase-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        ref={panel}
        onClick={(event) => event.stopPropagation()}
      >
        <h2>{title}</h2>
        <p>{children}</p>
        <div className="purchase-dialog__actions">
          <button type="button" className="purchase-btn" data-autofocus onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="purchase-btn purchase-btn--primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
