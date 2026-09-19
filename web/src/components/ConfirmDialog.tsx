/**
 * A confirmation, as a real dialog.
 *
 * `window.confirm()` blocks the tab, cannot be styled, cannot be read properly
 * by a screen reader in some browsers, and on a phone it lands as a browser
 * chrome alert over the app. This is the same contract as the navigation
 * Drawer — focus moves in, is trapped, Escape closes, focus returns — in a
 * centred box.
 *
 * It is deliberately small: a title, a sentence, and two buttons, with the
 * SAFE one focused first. Nobody should be able to dismiss unsaved work by
 * pressing Enter on a dialog they have not read.
 */

import { useEffect, useRef, type ReactNode } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Stay',
  tone = 'default',
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
  onConfirm: () => void
  onCancel: () => void
}) {
  const panel = useRef<HTMLDivElement | null>(null)
  const safe = useRef<HTMLButtonElement | null>(null)
  const returnTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return undefined

    returnTo.current = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    safe.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCancel()
        return
      }
      if (event.key !== 'Tab' || !panel.current) return

      const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const current = document.activeElement

      if (event.shiftKey && (current === first || !panel.current.contains(current))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && current === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previousOverflow
      returnTo.current?.focus()
    }
  }, [open, onCancel])

  if (!open) return null

  return (
    <>
      <div className="billing-dialog-backdrop" onClick={onCancel} aria-hidden="true" />
      <div
        className="billing-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="billing-dialog-title"
        aria-describedby="billing-dialog-body"
        ref={panel}
      >
        <h2 className="billing-dialog__title" id="billing-dialog-title">{title}</h2>
        <div className="billing-dialog__body" id="billing-dialog-body">{children}</div>
        <div className="billing-dialog__actions">
          <button type="button" className="billing-button" ref={safe} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === 'danger' ? 'billing-button billing-button--danger' : 'billing-button billing-button--primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  )
}
