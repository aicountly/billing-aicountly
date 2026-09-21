/**
 * The controls that follow a report around: star it, and the overflow menu.
 *
 * Used by the recent list, the search results and the category drill-down, so
 * a report behaves the same wherever the user finds it.
 *
 * Only actions this product can genuinely perform are offered. Export is here
 * because there is a real endpoint behind it and the period is named on the
 * item, so nobody exports a month they were not shown; print, filters and the
 * period control live on the report itself, where the thing being printed is
 * on screen.
 */

import { useEffect, useRef, useState } from 'react'
import { Download, EllipsisVertical, ExternalLink, Link2, Star } from 'lucide-react'

export function FavouriteButton({
  on,
  label,
  onToggle,
}: {
  on: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={`reports-icon-button${on ? ' reports-icon-button--on' : ''}`}
      aria-pressed={on}
      /* The state is in the label as well as the fill: a star that means
         something only by its colour means nothing to half the people
         reading it. */
      aria-label={on ? `${label}: remove from favourites` : `${label}: add to favourites`}
      title={on ? 'Remove from favourites' : 'Add to favourites'}
      onClick={onToggle}
    >
      <Star size={15} aria-hidden fill={on ? 'currentColor' : 'none'} />
    </button>
  )
}

export interface OverflowAction {
  key: string
  label: string
  icon: 'open' | 'star' | 'link' | 'export'
  onSelect: () => void
}

const ICONS = {
  open: ExternalLink,
  star: Star,
  link: Link2,
  export: Download,
}

export function ReportOverflowMenu({ label, actions }: { label: string; actions: OverflowAction[] }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)

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

  if (actions.length === 0) return null

  return (
    <div style={{ position: 'relative' }} ref={box}>
      <button
        type="button"
        ref={trigger}
        className="reports-icon-button"
        aria-label={`More actions for ${label}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        <EllipsisVertical size={15} aria-hidden />
      </button>

      {open && (
        <div className="billing-menu" role="menu" style={{ right: 0, left: 'auto', minWidth: '13rem' }}>
          {actions.map((action) => {
            const Icon = ICONS[action.icon]
            return (
              <button
                key={action.key}
                type="button"
                role="menuitem"
                className="billing-menu__item"
                onClick={() => {
                  setOpen(false)
                  action.onSelect()
                }}
              >
                <Icon size={15} aria-hidden /> {action.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
