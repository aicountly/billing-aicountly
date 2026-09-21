/**
 * Receipts already recorded.
 *
 * Smart Books' receipt register, read on this page load — not a list Billing
 * keeps. That is why it can be trusted to answer "did somebody already enter
 * this cheque?": it is the same rows the accounts show.
 *
 * The mode, the reference and the account are Billing's own half of the row,
 * joined on by the endpoint from the request written when Save was pressed. A
 * receipt recorded in Books rather than here has them empty, and the row says
 * so rather than inventing them.
 */

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Clock3, MoreVertical } from 'lucide-react'
import { date as formatDate, money } from '../../ui'
import { Badge, EmptyState, ErrorState, SettlementBadge, SkeletonRows, Unavailable } from '../../dashboards/kit'
import { useBilling } from '../../context/BillingContext'
import type { MoneyActivityRow } from '../../services/types'
import { modeWords } from './form'

const SHOWN = 8

export function RecentReceipts({
  rows,
  loading,
  error,
  unavailable,
  onRetry,
  onUseCustomer,
}: {
  rows: MoneyActivityRow[]
  loading: boolean
  error: string | null
  /** Books answered, but not with a register — the form still works. */
  unavailable?: string | null
  onRetry: () => void
  onUseCustomer: (row: MoneyActivityRow) => void
}) {
  const navigate = useNavigate()
  const { can } = useBilling()
  const visible = rows.slice(0, SHOWN)

  return (
    <section className="billing-panel billing-panel--flush billing-receipt-recent" aria-labelledby="recent-receipts-title">
      <div className="billing-panel__heading">
        <div className="billing-receipt-cardhead__title">
          <span className="billing-receipt-mark billing-receipt-mark--sm" aria-hidden="true">
            <Clock3 size={16} />
          </span>
          <div>
            <h2 id="recent-receipts-title" style={{ fontSize: 16 }}>
              Recent money received
            </h2>
            <p>Read from Smart Books&rsquo; receipt register, last 90 days.</p>
          </div>
        </div>

        {can('reports.view') && (
          <button
            type="button"
            className="billing-button billing-button--small"
            onClick={() => navigate('/reports?report=receipts')}
          >
            View all <ChevronDown size={14} aria-hidden style={{ transform: 'rotate(-90deg)' }} />
          </button>
        )}
      </div>

      <div style={{ paddingInline: 22 }}>
        {loading ? (
          <SkeletonRows rows={5} />
        ) : error ? (
          <ErrorState message={`Could not read the receipt register. ${error}`} onRetry={onRetry} />
        ) : unavailable ? (
          <Unavailable title="Receipts could not be listed">{unavailable}</Unavailable>
        ) : visible.length === 0 ? (
          <EmptyState>Your recorded customer receipts will appear here.</EmptyState>
        ) : null}
      </div>

      {!loading && !error && !unavailable && visible.length > 0 && (
        <>
          <div className="billing-table-scroll billing-receipt-recent__table">
            <table className="billing-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Receipt no.</th>
                  <th scope="col">Customer</th>
                  <th scope="col" className="billing-amount">
                    Amount
                  </th>
                  <th scope="col" className="billing-receipt-recent__optional">
                    Received in
                  </th>
                  <th scope="col">Mode</th>
                  <th scope="col" className="billing-receipt-recent__optional">
                    Reference
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="billing-sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row, index) => (
                  <tr key={rowKey(row, index)}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(row.date)}</td>
                    <td>{row.document_no ?? '—'}</td>
                    <td>
                      <span className="billing-receipt-recent__truncate" title={row.party ?? undefined}>
                        {row.party ?? '—'}
                      </span>
                    </td>
                    <td className="billing-amount">
                      <strong>{row.amount === null ? '—' : money(row.amount)}</strong>
                    </td>
                    <td className="billing-receipt-recent__optional">
                      <span className="billing-receipt-recent__truncate" title={row.account_name ?? undefined}>
                        {row.account_name ?? '—'}
                      </span>
                    </td>
                    <td>{modeWords(row.payment_mode)}</td>
                    <td className="billing-receipt-recent__optional">
                      <span className="billing-receipt-recent__truncate" title={row.reference_no ?? undefined}>
                        {row.reference_no ?? '—'}
                      </span>
                    </td>
                    <td>
                      <ReceiptStatus status={row.status} recordedHere={row.recorded_here} />
                    </td>
                    <td>
                      <RowActions
                        row={row}
                        mayViewLedger={can('statement.view')}
                        onUseCustomer={() => onUseCustomer(row)}
                        onViewLedger={() => navigate(`/parties/${row.party_id}`)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* A nine-column table is unreadable on a phone, so the same rows are
              drawn as cards — the customer and the amount first, because those
              are what somebody scrolling this list is looking for. */}
          <div className="billing-receipt-recent__mobile">
            {visible.map((row, index) => (
              <article className="billing-receipt-rowcard" key={rowKey(row, index)}>
                <div className="billing-receipt-rowcard__top">
                  <strong>{row.party ?? 'Unnamed customer'}</strong>
                  <span className="billing-receipt-rowcard__amount">{row.amount === null ? '—' : money(row.amount)}</span>
                </div>
                <div className="billing-receipt-rowcard__meta">
                  <span>{formatDate(row.date)}</span>
                  <span aria-hidden>·</span>
                  <span>{modeWords(row.payment_mode)}</span>
                  {row.account_name && (
                    <>
                      <span aria-hidden>·</span>
                      <span>{row.account_name}</span>
                    </>
                  )}
                </div>
                <div className="billing-receipt-rowcard__foot">
                  <span style={{ color: 'var(--billing-muted)', fontSize: 12.5 }}>{row.document_no ?? '—'}</span>
                  <ReceiptStatus status={row.status} />
                </div>
                {row.reference_no && (
                  <div style={{ color: 'var(--billing-muted)', fontSize: 12.5 }}>Reference: {row.reference_no}</div>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function rowKey(row: MoneyActivityRow, index: number): string {
  return String(row.voucher_id ?? row.voucher_uuid ?? `${row.document_no ?? 'row'}-${index}`)
}

/**
 * A receipt's state, when Books states one.
 *
 * A row in the receipt register is money that was received — that is what the
 * register is — so a row without a settlement state says Received rather than
 * nothing. It does not invent a state Books did not give: anything more
 * specific comes from Books' own status.
 */
function ReceiptStatus({ status, recordedHere }: { status: string | null; recordedHere?: boolean }) {
  const where = recordedHere === false ? 'This receipt was recorded in Smart Books, not here.' : 'This receipt is in Smart Books’ register.'

  if (status === null) {
    return (
      <span title={where}>
        <Badge tone="success">Received</Badge>
      </span>
    )
  }
  return <SettlementBadge status={status} />
}

/**
 * What can be done to a row here.
 *
 * Deliberately short. Editing, voiding or printing a posted receipt is Smart
 * Books' business and this product has no endpoint for any of them, so no menu
 * item pretends otherwise — an entry that opens a dialog and then fails is
 * worse than an entry that was never drawn.
 */
function RowActions({
  row,
  mayViewLedger,
  onUseCustomer,
  onViewLedger,
}: {
  row: MoneyActivityRow
  mayViewLedger: boolean
  onUseCustomer: () => void
  onViewLedger: () => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

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

  const canOpenLedger = mayViewLedger && row.party_id !== null

  return (
    <div className="billing-receipt-rowmenu" ref={box}>
      <button
        type="button"
        ref={trigger}
        className="billing-iconbutton"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${row.document_no ?? 'this receipt'}`}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreVertical size={16} aria-hidden />
      </button>

      {open && (
        <div className="billing-receipt-menu billing-receipt-menu--below" role="menu">
          <button
            type="button"
            role="menuitem"
            disabled={row.party_id === null}
            onClick={() => {
              setOpen(false)
              onUseCustomer()
            }}
          >
            Record another from this customer
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!canOpenLedger}
            onClick={() => {
              setOpen(false)
              onViewLedger()
            }}
          >
            Open party ledger
            {!canOpenLedger && <small>Not in your Billing profile</small>}
          </button>
        </div>
      )}
    </div>
  )
}
