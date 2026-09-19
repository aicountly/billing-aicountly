/**
 * A modal that behaves like one: Escape closes it, focus is trapped inside
 * while it is open, and focus returns to whatever opened it on the way out.
 *
 * Small on purpose. The settings screens use a dialog for two things only —
 * reading the setup checklist, and confirming something that changes the app
 * for everybody in the company.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function SettingsDialog({
  title,
  description,
  onClose,
  children,
  actions,
}: {
  title: string
  description?: ReactNode
  onClose: () => void
  children?: ReactNode
  actions?: ReactNode
}) {
  const panel = useRef<HTMLDivElement | null>(null)
  const opener = useRef<Element | null>(null)

  useEffect(() => {
    opener.current = document.activeElement
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panel.current) return

      const stops = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (stops.length === 0) return

      const edge = event.shiftKey ? stops[0] : stops[stops.length - 1]
      if (document.activeElement === edge) {
        event.preventDefault()
        ;(event.shiftKey ? stops[stops.length - 1] : stops[0]).focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (opener.current instanceof HTMLElement) opener.current.focus()
    }
  }, [onClose])

  return (
    <div
      className="billing-settings__scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="billing-settings__dialog" role="dialog" aria-modal="true" aria-label={title} ref={panel}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <h2>{title}</h2>
          <button type="button" className="billing-iconbutton" onClick={onClose} aria-label="Close">
            <X size={17} aria-hidden />
          </button>
        </div>
        {description && <p>{description}</p>}
        {children}
        {actions && <div className="billing-settings__dialog-actions">{actions}</div>}
      </div>
    </div>
  )
}
