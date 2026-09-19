/**
 * A small dropdown that closes on Escape, on a click outside, and on choosing
 * something — and returns focus to its trigger, so keyboard users are not
 * dropped at the top of the document.
 *
 * Lifted out of AppShell, where the header's four menus were already using it,
 * so the Items screen's filter and row menus behave the same way rather than
 * being a fifth thing that mostly does.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export function Popover({
  label,
  ariaLabel,
  children,
  asChild = false,
  align = 'end',
  triggerClassName = 'billing-iconbutton',
  panelClassName,
  title,
  disabled = false,
}: {
  label: ReactNode
  ariaLabel: string
  children: (close: () => void) => ReactNode
  /** The trigger is the label itself (a button or pill), with a chevron after it. */
  asChild?: boolean
  /** Which edge the panel hangs from. `start` keeps a left-hand menu on screen. */
  align?: 'start' | 'end'
  triggerClassName?: string
  /** Extra classes for the panel itself — a filter form needs more room than a menu. */
  panelClassName?: string
  title?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return undefined

    function onPointerDown(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div style={{ position: 'relative' }} ref={box}>
      <button
        type="button"
        ref={trigger}
        className={triggerClassName}
        style={asChild ? { width: 'auto', height: 'auto', padding: 0, border: 0 } : undefined}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? panelId : undefined}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
        {asChild && <ChevronDown size={14} aria-hidden style={{ marginLeft: 2, color: 'var(--billing-muted)' }} />}
      </button>
      {open && (
        <div
          id={panelId}
          className={`billing-menu${align === 'start' ? ' billing-menu--start' : ''}${panelClassName ? ` ${panelClassName}` : ''}`}
          role="menu"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
