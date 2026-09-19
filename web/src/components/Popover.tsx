/**
 * The small dropdown every part of this app opens.
 *
 * It closes on Escape, on a click outside and on choosing something, and it
 * returns focus to the button that opened it — so a keyboard user is not
 * dropped at the top of the document by a menu they just used.
 *
 * `overlay` exists for one real problem. A menu drawn inside a table that
 * scrolls sideways is clipped by that scroller: the row's actions open and the
 * bottom half of them is simply not there. Overlay mode measures the trigger
 * and draws the menu against the viewport instead, which no ancestor can crop.
 *
 * It follows the trigger while the page scrolls rather than closing. Closing on
 * scroll sounds tidier and is not: opening a menu near the bottom of a list
 * makes the browser scroll the button into view, and a menu that closes on the
 * scroll IT caused is a menu that cannot be opened at all down there.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

/** Enough room for a short menu. Below this, it opens upward instead. */
const MENU_ROOM = 280

export function Popover({
  label,
  ariaLabel,
  children,
  asChild = false,
  overlay = false,
  triggerClassName,
  disabled = false,
}: {
  label: ReactNode
  ariaLabel: string
  children: (close: () => void) => ReactNode
  /** The trigger is its own styled element; the button around it gets out of the way. */
  asChild?: boolean
  /** Draw against the viewport, for a menu inside something that scrolls or clips. */
  overlay?: boolean
  triggerClassName?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<CSSProperties | null>(null)
  const box = useRef<HTMLDivElement | null>(null)
  const menu = useRef<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)

  const close = useCallback(() => setOpen(false), [])

  /** Put the menu under its trigger, or over it when the room is below. */
  const place = useCallback(() => {
    if (!overlay || !trigger.current) {
      setPosition(null)
      return
    }

    const rect = trigger.current.getBoundingClientRect()

    // The trigger has been scrolled out of the window entirely — a menu
    // hanging where it used to be points at nothing.
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      setOpen(false)
      return
    }

    const below = window.innerHeight - rect.bottom

    setPosition({
      position: 'fixed',
      right: Math.max(8, window.innerWidth - rect.right),
      ...(below < MENU_ROOM
        ? { bottom: Math.max(8, window.innerHeight - rect.top + 6), top: 'auto' }
        : { top: rect.bottom + 6 }),
    })
  }, [overlay])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    place()
  }, [open, place])

  useEffect(() => {
    if (!open) return undefined

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (box.current?.contains(target) || menu.current?.contains(target)) return
      setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    function onViewportChange() {
      if (overlay) place()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)

    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [open, overlay, place])

  return (
    <div style={{ position: 'relative' }} ref={box}>
      <button
        type="button"
        ref={trigger}
        className={triggerClassName ?? 'billing-iconbutton'}
        style={asChild ? { width: 'auto', height: 'auto', padding: 0, border: 0 } : undefined}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
        {asChild && <ChevronDown size={14} aria-hidden style={{ marginLeft: 2, color: 'var(--billing-muted)' }} />}
      </button>
      {open && (
        <div className="billing-menu" role="menu" ref={menu} style={position ?? undefined}>
          {children(close)}
        </div>
      )}
    </div>
  )
}
