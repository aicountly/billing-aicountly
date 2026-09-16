/**
 * The navigation drawer for phones.
 *
 * Below 900px the sidebar is not merely hidden — hiding navigation and leaving
 * nothing in its place is how a phone user ends up with a product that has one
 * screen. This is the real thing: same destinations, opened from a button in
 * the header, and behaving the way a dialog is supposed to.
 *
 *   * focus moves in when it opens and is trapped while it is open
 *   * Tab wraps at both ends, so it cannot be tabbed out of behind the backdrop
 *   * Escape closes it
 *   * focus returns to the button that opened it
 *   * the page behind it does not scroll under a finger that misses
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement | null>(null)
  const returnTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return undefined

    returnTo.current = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // The close button rather than the first link: opening a menu should not
    // read out a destination as though it had been chosen.
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panel.current) return

      const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusable.length === 0) return

      const firstEl = focusable[0]
      const lastEl = focusable[focusable.length - 1]
      const current = document.activeElement

      if (event.shiftKey && (current === firstEl || !panel.current.contains(current))) {
        event.preventDefault()
        lastEl.focus()
      } else if (!event.shiftKey && current === lastEl) {
        event.preventDefault()
        firstEl.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previousOverflow
      returnTo.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <div className="billing-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="billing-drawer" role="dialog" aria-modal="true" aria-label={title} ref={panel}>
        <div className="billing-drawer__head">
          <strong>{title}</strong>
          <button type="button" className="billing-iconbutton" onClick={onClose} aria-label="Close menu">
            <X size={18} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </>
  )
}
