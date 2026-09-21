/**
 * "Are you sure?", as a dialog rather than the browser's own box.
 *
 * `window.confirm` freezes the page, cannot be styled, cannot be read by a
 * screen reader as part of this screen, and on a phone looks like the site is
 * broken. This is the same question with the two answers written out, focus
 * held inside it while it is open, and focus returned to where it came from
 * when it closes.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = 'Stay',
  onConfirm,
  onCancel,
}: {
  title: string
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null
    cancel.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCancel()
        return
      }
      if (event.key !== 'Tab' || !panel.current) return

      // The trap. Without it, Tab walks out of the dialog and into the form
      // behind it, which is the form this dialog exists to ask about.
      const focusable = panel.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea')
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      returnTo.current?.focus?.()
    }
  }, [onCancel])

  return (
    <div
      className="billing-withdrawal-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        className="billing-withdrawal-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="withdrawal-confirm-title"
        aria-describedby="withdrawal-confirm-body"
        ref={panel}
      >
        <h2 id="withdrawal-confirm-title">
          <span className="billing-withdrawal-dialog__mark" aria-hidden><AlertTriangle size={16} /></span>
          {title}
        </h2>
        <div id="withdrawal-confirm-body">{children}</div>

        <div className="billing-withdrawal-dialog__actions">
          <button type="button" className="billing-button" ref={cancel} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="billing-button billing-button--primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
