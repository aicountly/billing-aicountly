/**
 * The last few entries, and where each cell comes from.
 *
 * Date, party and amount are Books' register. Paid from, mode, reference,
 * remarks and who keyed it are Billing's own record of the entry, and are empty
 * on a row that was recorded in Books rather than here — which the row says,
 * rather than leaving somebody to wonder whether the screen is broken.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Clock3, Copy, ExternalLink, FileText, MoreHorizontal, User } from 'lucide-react'
import type { MoneyActivityRow } from '../../services/types'
import { date as formatDate, money } from '../../ui'
import { EmptyState, ErrorState, SkeletonRows } from '../../dashboards/kit'
import { initialsOf, modeLabel, type Direction } from './money'

export interface RowAction {
  key: string
  label: string
  icon: 'view' | 'party' | 'copy'
  run: (row: MoneyActivityRow) => void
}

export function RecentMoneyTable({
  direction,
  rows,
  loading,
  error,
  note,
  onRetry,
  onViewAll,
  onCreate,
  actionsFor,
  currentUser,
}: {
  direction: Direction
  rows: MoneyActivityRow[]
  loading: boolean
  error: string | null
  note: string | null
  onRetry: () => void
  onViewAll: (() => void) | null
  onCreate: () => void
  actionsFor: (row: MoneyActivityRow) => RowAction[]
  currentUser: { uuid: string; name: string | null } | null
}) {
  const isOut = direction === 'out'

  return (
    <section className="billing-panel billing-panel--flush">
      <div className="billing-panel__heading">
        <div className="billing-money__card-heading">
          <span className="billing-money__card-mark" aria-hidden="true">
            <Clock3 size={19} />
          </span>
          <div>
            <h2>{isOut ? 'Recent money paid' : 'Recent money received'}</h2>
            <p>{isOut ? 'Your recently recorded payments' : 'Your recently recorded receipts'}</p>
          </div>
        </div>

        {onViewAll && (
          <button type="button" className="billing-button billing-button--quiet billing-button--small" onClick={onViewAll}>
            View all <ExternalLink size={14} aria-hidden />
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ paddingInline: 22 }}>
          <SkeletonRows rows={5} />
        </div>
      ) : error ? (
        <div style={{ paddingInline: 22 }}>
          <ErrorState message={error} onRetry={onRetry} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          action={
            <button type="button" className="billing-button billing-button--soft billing-button--small" onClick={onCreate}>
              {isOut ? 'Record a payment' : 'Record a receipt'}
            </button>
          }
        >
          No {isOut ? 'payments' : 'receipts'} recorded in this period. Entries you create will appear here.
        </EmptyState>
      ) : (
        <>
          <div className="billing-table-scroll">
            <table className="billing-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">{isOut ? 'Party / Supplier' : 'Party / Customer'}</th>
                  <th scope="col" className="billing-amount">
                    Amount
                  </th>
                  <th scope="col">{isOut ? 'Paid from' : 'Received in'}</th>
                  <th scope="col">Mode</th>
                  <th scope="col">Reference no.</th>
                  <th scope="col">Remarks</th>
                  <th scope="col">Recorded by</th>
                  <th scope="col">
                    <span className="billing-sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.voucher_id ?? row.request_id ?? index}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(row.date)}</td>

                    <td>
                      <span style={{ fontWeight: 650 }}>{row.party ?? 'Not named'}</span>
                      {row.document_no && (
                        <span style={{ display: 'block', color: 'var(--billing-muted)', fontSize: 12 }}>
                          {row.document_no}
                        </span>
                      )}
                    </td>

                    <td className="billing-amount" style={{ fontWeight: 700 }}>
                      {row.amount === null ? <span className="billing-money__muted">—</span> : money(row.amount)}
                    </td>

                    <td>
                      <Detail value={row.account_name} recordedHere={row.recorded_here} />
                    </td>

                    <td>
                      <Detail value={modeLabel(row.payment_mode)} recordedHere={row.recorded_here} />
                    </td>

                    <td className="billing-money__reference">
                      <Detail value={row.reference_no} recordedHere={row.recorded_here} />
                    </td>

                    <td>
                      {row.narration ? (
                        /* Plain text in a title attribute — narration comes from
                           a person and is never rendered as markup. */
                        <span className="billing-money__narration" title={row.narration}>
                          {row.narration}
                        </span>
                      ) : (
                        <Detail value={null} recordedHere={row.recorded_here} />
                      )}
                    </td>

                    <td>
                      <RecordedBy createdBy={row.created_by} currentUser={currentUser} />
                    </td>

                    <td>
                      <RowMenu row={row} actions={actionsFor(row)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {note && <p className="billing-panel__footnote" style={{ marginInline: 22 }}>{note}</p>}
        </>
      )}
    </section>
  )
}

/**
 * A cell Billing fills in, or an explanation of why it is empty.
 *
 * An entry made in Books has no mode or reference HERE — Books' register does
 * not carry them. Saying so beats a bare dash that reads as missing data.
 */
function Detail({ value, recordedHere }: { value: string | null; recordedHere: boolean }) {
  if (value) return <>{value}</>

  return (
    <span
      className="billing-money__muted"
      title={recordedHere ? 'Not entered.' : 'This entry was recorded in Smart Books, so Billing has no detail for it.'}
    >
      —
    </span>
  )
}

function RecordedBy({
  createdBy,
  currentUser,
}: {
  createdBy: string | null
  currentUser: { uuid: string; name: string | null } | null
}) {
  if (!createdBy) {
    return (
      <span className="billing-money__muted" title="Recorded in Smart Books.">
        —
      </span>
    )
  }

  // Only this session's own name is known here. Another user's uuid is not a
  // name and is not shown as one — a neutral mark is honest, initials made out
  // of a uuid are not.
  if (currentUser && createdBy === currentUser.uuid) {
    const name = currentUser.name
    return (
      <span className="billing-money__who" title={name ? `${name} (you)` : 'You'} aria-label={name ? `${name}, you` : 'You'}>
        {name ? initialsOf(name) : 'You'}
      </span>
    )
  }

  return (
    <span className="billing-money__who" title="Recorded by another user" aria-label="Recorded by another user">
      <User size={13} aria-hidden />
    </span>
  )
}

/**
 * The row's actions.
 *
 * Only actions that exist: opening the entry Billing recorded, opening the
 * party's statement, and copying the entry back into the form. There is no
 * edit and no delete because Billing has no endpoint for either — a menu item
 * that cannot do its job is worse than a shorter menu.
 *
 * Positioned in the VIEWPORT rather than against the row, because the table
 * scrolls horizontally and an absolutely positioned menu is clipped by it.
 */
function RowMenu({ row, actions }: { row: MoneyActivityRow; actions: RowAction[] }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !trigger.current) return
    const rect = trigger.current.getBoundingClientRect()
    const width = 200
    setPosition({
      top: rect.bottom + 6,
      // Kept on screen at a narrow width, where the trigger is near the edge.
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
    })
  }, [open])

  useEffect(() => {
    if (!open) return undefined

    function onPointerDown(event: MouseEvent) {
      if (
        !menu.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      ) {
        setOpen(false)
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    // A menu anchored to the viewport has to close when the page moves under
    // it, or it sits pointing at a row that is no longer there.
    function onMove() {
      setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open])

  if (actions.length === 0) return null

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="billing-iconbutton"
        aria-label={`Actions for the entry dated ${row.date ?? 'unknown'}${row.party ? `, ${row.party}` : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={17} aria-hidden />
      </button>

      {open && position && (
        <div
          ref={menu}
          className="billing-menu billing-menu--anchored"
          role="menu"
          style={{ top: position.top, left: position.left, width: 200 }}
        >
          {actions.map((action) => {
            const Icon = action.icon === 'view' ? FileText : action.icon === 'party' ? ExternalLink : Copy
            return (
              <button
                key={action.key}
                type="button"
                role="menuitem"
                className="billing-menu__item"
                onClick={() => {
                  setOpen(false)
                  action.run(row)
                }}
              >
                <Icon size={15} aria-hidden /> {action.label}
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}
