/**
 * The small pieces the Money to Pay screen is built from.
 *
 * Two rules carry through all of them, and they are the same two the dashboards
 * already keep:
 *
 *  1. Colour is never the only signal. Every badge carries a word, and the day
 *     count says "overdue" or "days left" rather than leaving a bare number to
 *     be read as either.
 *  2. A loading state keeps the shape it will have when the figures arrive, so
 *     nothing jumps under a finger already moving towards a button.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { AlertCircle, Inbox } from 'lucide-react'
import type { PayableStatus } from '../../services/types'

// ---------------------------------------------------------------------------
// Status and days
// ---------------------------------------------------------------------------

const STATUS_WORDS: Record<PayableStatus, { label: string; tone: string }> = {
  overdue: { label: 'Overdue', tone: 'red' },
  due_today: { label: 'Due today', tone: 'amber' },
  due_soon: { label: 'Due soon', tone: 'amber' },
  upcoming: { label: 'Upcoming', tone: 'blue' },
  no_due_date: { label: 'No due date', tone: 'grey' },
}

export function StatusBadge({ status }: { status: PayableStatus }) {
  const word = STATUS_WORDS[status] ?? STATUS_WORDS.no_due_date

  return <span className={`mtp-badge mtp-badge--${word.tone}`}>{word.label}</span>
}

/**
 * Part paid is its own badge, beside the due state rather than instead of it.
 *
 * A bill can be both three weeks late and half settled, and collapsing those
 * into one word loses whichever one the person needed.
 */
export function PartPaidBadge() {
  return <span className="mtp-badge mtp-badge--purple">Part paid</span>
}

export function statusDot(status: PayableStatus): string {
  if (status === 'overdue') return 'mtp-dot--red'
  if (status === 'due_today' || status === 'due_soon') return 'mtp-dot--amber'
  if (status === 'upcoming') return 'mtp-dot--blue'
  return 'mtp-dot--grey'
}

/**
 * The Days column, in words that cannot be read backwards.
 *
 * The old mock showed a bare number in this column, which means "6" sits in the
 * same place whether the bill is six days late or six days away — a difference
 * of twelve days and of whether somebody should be ringing the supplier.
 */
export function DaysCell({ status, daysOverdue, daysToDue }: { status: PayableStatus; daysOverdue: number; daysToDue: number | null }) {
  if (status === 'no_due_date') {
    return <span className="mtp-days mtp-days--later" title="This bill was recorded without a due date">—</span>
  }
  if (status === 'overdue') {
    return (
      <span className="mtp-days mtp-days--overdue" title={`${daysOverdue} day${daysOverdue === 1 ? '' : 's'} past its due date`}>
        {daysOverdue} overdue
      </span>
    )
  }
  if (status === 'due_today') {
    return <span className="mtp-days mtp-days--today" title="Falls due today">Today</span>
  }

  const days = daysToDue ?? 0

  return (
    <span
      className={`mtp-days ${status === 'due_soon' ? 'mtp-days--soon' : 'mtp-days--later'}`}
      title={`${days} day${days === 1 ? '' : 's'} remaining`}
    >
      {days} day{days === 1 ? '' : 's'}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Supplier avatar
// ---------------------------------------------------------------------------

/** Six that all carry white text at 4.5:1 or better. */
const AVATAR_COLOURS = ['#4f6ad6', '#2f8f5b', '#9a5bb8', '#b26a1f', '#2b8a9e', '#b4485f']

/**
 * The same supplier gets the same colour every time.
 *
 * From the account id, not from a counter — a colour that depends on where the
 * row happened to land changes when the list is sorted, and then the avatar is
 * decoration rather than something you can recognise.
 */
export function avatarColour(accountId: number, name: string): string {
  const seed = accountId > 0 ? accountId : Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0)

  return AVATAR_COLOURS[Math.abs(seed) % AVATAR_COLOURS.length]
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()

  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function Skeleton({ className = 'mtp-skeleton--line', width }: { className?: string; width?: string }) {
  return <span className={`mtp-skeleton ${className}`} style={width ? { width } : undefined} aria-hidden="true" />
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div style={{ display: 'grid', gap: 12 }} aria-busy="true">
      <span className="billing-sr-only">Loading</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} width={`${100 - index * 7}%`} />
      ))}
    </div>
  )
}

export function EmptyState({
  title,
  children,
  actions,
  icon,
}: {
  title: string
  children?: ReactNode
  actions?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="mtp-state" role="status">
      <span className="mtp-state__mark" aria-hidden="true">{icon ?? <Inbox size={20} />}</span>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {actions && <div className="mtp-state__actions">{actions}</div>}
    </div>
  )
}

/**
 * Something did not load, and what to do about it.
 *
 * The message is the one the API gave, which is written for a person. The
 * technical detail went to the console through the API layer; a stack trace on
 * screen helps nobody standing at a counter.
 */
export function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div className="mtp-state" role="alert">
      <span className="mtp-state__mark" style={{ background: 'var(--billing-danger-bg)', color: 'var(--billing-danger)' }} aria-hidden="true">
        <AlertCircle size={20} />
      </span>
      <strong>{title}</strong>
      <p>{message}</p>
      {onRetry && (
        <div className="mtp-state__actions">
          <button type="button" className="billing-button billing-button--primary billing-button--small" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

/**
 * A modal that closes on Escape and on the backdrop, and puts focus inside
 * itself when it opens — the same contract the shell's Popover keeps, because a
 * keyboard user dropped at the top of the document has lost their place.
 */
export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
}: {
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  const box = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    box.current?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)

    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <>
      <div className="mtp-dialog-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="mtp-dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={box}>
        <div className="mtp-dialog__head">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button type="button" className="mtp-iconbutton" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        {children}
        {footer && <div className="mtp-dialog__foot">{footer}</div>}
      </div>
    </>
  )
}

/** Close when the pointer goes down anywhere outside. */
export function useDismiss<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    if (!open) return undefined

    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  return ref
}
