/**
 * Dashboard 3 — "Turn invoices into collections".
 *
 * The four cards are four different kinds of number and each says which it is:
 * two balances as at today, one window of future dates, one movement over the
 * period. Collected is receipts — money that came in — and the card says so,
 * because "collections" read as revenue is how a good collection month gets
 * mistaken for a good trading month.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, CircleAlert, Clock, HandCoins, MessageSquare, Wallet } from 'lucide-react'
import { api, ApiError } from '../services/api'
import { date, money } from '../ui'
import { BillingDashboardLayout, DataStatus, PeriodPicker } from './DashboardLayout'
import {
  AgeingBar,
  Badge,
  DashboardPanel,
  EmptyState,
  ErrorState,
  SkeletonRows,
  Unavailable,
  overdueWords,
} from './kit'
import { useDashboard } from './useDashboard'
import type { PromiseRow, QueueRow, ReceivablesDashboard } from './types'

const ICONS: Record<string, React.ReactNode> = {
  outstanding: <Wallet size={17} />,
  overdue: <Clock size={17} />,
  due_soon: <CalendarClock size={17} />,
  collected: <HandCoins size={17} />,
}

export default function Receivables() {
  const navigate = useNavigate()
  const { data, loading, error, retryable, period, setPeriod, reload } =
    useDashboard<ReceivablesDashboard>('v1/dashboards/receivables')

  const [reminderFor, setReminderFor] = useState<QueueRow | null>(null)
  const [promiseFor, setPromiseFor] = useState<QueueRow | null>(null)

  const panels = data?.panels

  return (
    <BillingDashboardLayout
      activeDashboard="receivables"
      title="Turn invoices into collections"
      description="Track what is due, follow up with customers, and keep your cash flow healthy."
      period={data?.period}
      filters={<PeriodPicker value={period} onChange={setPeriod} disabled={loading} />}
      status={<DataStatus generatedAt={data?.generated_at} loading={loading} onRefresh={reload} />}
      metrics={data?.metrics ?? []}
      metricsLoading={loading}
      metricIcons={ICONS}
      actions={
        panels?.can_record_receipt ? (
          <button type="button" className="billing-button billing-button--primary" onClick={() => navigate('/money-in/new')}>
            Record Receipt
          </button>
        ) : undefined
      }
    >
      {error && <ErrorState message={error} onRetry={retryable ? reload : undefined} />}

      <div className="billing-grid billing-grid--wide">
        <DashboardPanel
          title="Receivables ageing"
          description={panels?.ageing.available === true ? panels.ageing.basis : undefined}
          footnote="Aged on the balance still unpaid, from each bill's own due date. A bill on 60-day terms raised 45 days ago is not overdue."
        >
          {loading && !data ? (
            <SkeletonRows rows={4} />
          ) : panels === undefined ? (
            <SkeletonRows rows={4} />
          ) : panels.ageing.available ? (
            <AgeingBar
              buckets={panels.ageing.buckets}
              total={panels.ageing.total}
              reconciles={panels.ageing.reconciles}
            />
          ) : (
            <Unavailable>{panels.ageing.reason}</Unavailable>
          )}
        </DashboardPanel>

        <DashboardPanel
          title="Follow-up priorities"
          description="Where the overdue money actually is"
          className="billing-panel--insights"
          footnote={panels?.priorities?.basis}
        >
          {loading && !data ? (
            <SkeletonRows rows={3} />
          ) : !panels?.priorities ? (
            <EmptyState>Nothing is overdue. There is nobody to chase.</EmptyState>
          ) : (
            <div>
              <p style={{ margin: '0 0 6px', fontSize: 15 }}>
                <strong>
                  {panels.priorities.count} customer{panels.priorities.count === 1 ? '' : 's'}
                </strong>{' '}
                hold <strong className="num">{money(panels.priorities.amount)}</strong> of the{' '}
                <span className="num">{money(panels.priorities.total_overdue)}</span> overdue
                {' '}({panels.priorities.share}%).
              </p>
              <p style={{ color: 'var(--billing-muted)', fontSize: 13, marginTop: 0 }}>
                {panels.priorities.names.join(', ')}.
              </p>
              <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
                {panels.priorities.accounts.map((account) => (
                  <div
                    key={account.account_id}
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}
                  >
                    <button
                      type="button"
                      className="billing-button billing-button--quiet billing-button--small"
                      onClick={() => navigate(`/parties/${account.account_id}`)}
                    >
                      {account.account_name}
                    </button>
                    <span className="num" style={{ fontWeight: 650 }}>{money(account.overdue)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DashboardPanel>
      </div>

      <div className="billing-grid billing-grid--wide">
        <DashboardPanel
          title="Overdue priority queue"
          description="Customers to follow up, largest overdue first"
          className="billing-panel--flush"
          action={
            <button type="button" className="billing-button billing-button--small" onClick={() => navigate('/receivables')}>
              View all
            </button>
          }
        >
          {loading && !data ? (
            <div style={{ padding: '0 22px' }}><SkeletonRows rows={5} /></div>
          ) : (panels?.queue ?? []).length === 0 ? (
            <EmptyState>Nothing overdue. Everything outstanding is still within its terms.</EmptyState>
          ) : (
            <div className="billing-table-scroll">
              <table className="billing-table">
                <thead>
                  <tr>
                    <th scope="col">Customer</th>
                    <th scope="col" className="billing-amount">Overdue</th>
                    <th scope="col">Late by</th>
                    <th scope="col"><span className="billing-sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {(panels?.queue ?? []).map((row) => (
                    <tr key={row.account_id}>
                      {/* Four columns, not six. The bill reference and the
                          account total belong under the name rather than in
                          columns of their own: at a panel's width six columns
                          means every customer's name wraps over two lines. */}
                      <td>
                        <button
                          type="button"
                          className="billing-button billing-button--quiet billing-button--small"
                          style={{ padding: 0, whiteSpace: 'nowrap', minHeight: 'auto', fontWeight: 650 }}
                          onClick={() => navigate(`/parties/${row.account_id}`)}
                        >
                          {row.account_name}
                        </button>
                        <div style={{ color: 'var(--billing-muted)', fontSize: 12 }}>
                          {row.oldest_bill_no ?? `${row.bill_count} bill${row.bill_count === 1 ? '' : 's'}`}
                          {row.oldest_bill_due && ` · due ${date(row.oldest_bill_due)}`}
                          {' · '}
                          {money(row.total)} in total
                        </div>
                      </td>
                      <td className="billing-amount">{money(row.overdue)}</td>
                      <td>
                        <Badge tone={row.days_overdue > 60 ? 'danger' : 'warning'}>
                          <CircleAlert size={12} aria-hidden /> {overdueWords(row.days_overdue)}
                        </Badge>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          {panels?.can_remind && (
                            <button
                              type="button"
                              className="billing-button billing-button--soft billing-button--small"
                              onClick={() => setReminderFor(row)}
                            >
                              <MessageSquare size={13} aria-hidden /> Reminder
                            </button>
                          )}
                          {panels?.can_promise && (
                            <button
                              type="button"
                              className="billing-button billing-button--small"
                              onClick={() => setPromiseFor(row)}
                            >
                              Promise
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DashboardPanel>

        <DashboardPanel
          title="Promises to pay"
          description="Customer commitments — not money received"
          footnote={panels?.promises.note}
        >
          <Promises
            panel={panels?.promises}
            loading={loading && !data}
            onOpen={(accountId) => navigate(`/parties/${accountId}`)}
          />
        </DashboardPanel>
      </div>

      {data?.note && <p style={{ color: 'var(--billing-muted)', fontSize: 12, margin: 0 }}>{data.note}</p>}

      {reminderFor && (
        <ReminderDraft
          row={reminderFor}
          delivery={panels?.reminder_delivery ?? { configured: false, channels: [], reason: null }}
          onClose={() => setReminderFor(null)}
        />
      )}

      {promiseFor && (
        <PromiseForm
          row={promiseFor}
          onClose={() => setPromiseFor(null)}
          onSaved={() => {
            setPromiseFor(null)
            reload()
          }}
        />
      )}
    </BillingDashboardLayout>
  )
}

function Promises({
  panel,
  loading,
  onOpen,
}: {
  panel: ReceivablesDashboard['panels']['promises'] | undefined
  loading: boolean
  onOpen: (accountId: number) => void
}) {
  if (loading) return <SkeletonRows rows={4} />
  if (!panel) return <SkeletonRows rows={4} />
  if (!panel.available) return <Unavailable>{panel.reason ?? 'Not shown for your profile.'}</Unavailable>
  if (panel.rows.length === 0) {
    return <EmptyState>No promises on record. Note one down when a customer gives you a date.</EmptyState>
  }

  return (
    <div className="billing-table-scroll">
      <table className="billing-table">
        <thead>
          <tr>
            {/* Three columns. This panel sits in the narrow half of the grid and
                a fourth pushed the standing off the right-hand edge, which is
                the one thing on the row a person actually scans for. */}
            <th scope="col">Customer</th>
            <th scope="col">Promised</th>
            <th scope="col" className="billing-amount">They said / still owed</th>
          </tr>
        </thead>
        <tbody>
          {panel.rows.map((row) => (
            <tr key={row.promise_id}>
              <td>
                <button
                  type="button"
                  className="billing-button billing-button--quiet billing-button--small"
                  style={{ padding: 0, whiteSpace: 'nowrap', minHeight: 'auto', fontWeight: 650 }}
                  onClick={() => onOpen(row.account_id)}
                >
                  {row.account_name ?? `Account ${row.account_id}`}
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
                  <PromiseStanding row={row} />
                  {row.bill_no && <span style={{ color: 'var(--billing-muted)', fontSize: 12 }}>{row.bill_no}</span>}
                </div>
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {date(row.promised_date)}
                <div style={{ color: 'var(--billing-muted)', fontSize: 12 }}>
                  {row.status === 'CONFIRMED' ? 'Confirmed' : 'Tentative'}
                </div>
              </td>
              {/* Stacked, but never added together and never merged: the first
                  is what the customer said, the second is what Smart Books says
                  is left. A promise that was not kept is only visible while the
                  two stay apart. */}
              <td className="billing-amount">
                {money(row.promised_amount)}
                <div style={{ color: 'var(--billing-muted)', fontSize: 12, fontWeight: 400 }}>
                  {row.outstanding_known ? money(row.still_outstanding ?? 0) : 'not known'}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PromiseStanding({ row }: { row: PromiseRow }) {
  if (row.standing === 'SETTLED') return <Badge tone="success">Paid up</Badge>
  if (row.standing === 'PAST_DUE') return <Badge tone="danger">Date passed</Badge>
  return <Badge tone="neutral">Awaited</Badge>
}

/**
 * A reminder, drafted for review.
 *
 * Composed here, from the figures already on screen, and never sent by itself.
 * When no delivery service is configured the honest option is offered — copy it
 * and send it yourself — instead of a Send button that quietly does nothing,
 * which is the worst possible outcome: the user believes the customer was
 * chased and stops chasing them.
 */
function ReminderDraft({
  row,
  delivery,
  onClose,
}: {
  row: QueueRow
  delivery: { configured: boolean; channels: string[]; reason: string | null }
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  const message = [
    `Dear ${row.account_name},`,
    '',
    `Our records show ${money(row.overdue)} is overdue on your account` +
      (row.oldest_bill_no ? `, the oldest being ${row.oldest_bill_no}` : '') +
      (row.oldest_bill_due ? ` dated ${date(row.oldest_bill_due)}` : '') +
      `, now ${overdueWords(row.days_overdue).toLowerCase()} past its due date.`,
    '',
    'We would be grateful if you could arrange payment, or let us know a date we can expect it.',
    '',
    'Thank you.',
  ].join('\n')

  return (
    <Dialog title={`Reminder for ${row.account_name}`} onClose={onClose}>
      <p style={{ marginTop: 0, color: 'var(--billing-muted)', fontSize: 13 }}>
        Read it before it goes anywhere. The figures come from Smart Books as this page loaded.
      </p>

      <div className="billing-field">
        <label htmlFor="reminder-body">Message</label>
        <textarea id="reminder-body" readOnly rows={9} value={message} style={{ minHeight: '11rem', resize: 'vertical' }} />
      </div>

      {!delivery.configured && (
        <Unavailable title="Cannot be sent from here">
          {delivery.reason ?? 'No message delivery service is configured for this deployment.'}
        </Unavailable>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" className="billing-button" onClick={onClose}>Close</button>
        <button
          type="button"
          className="billing-button billing-button--primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(message)
              setCopied(true)
            } catch {
              // A browser that refuses the clipboard is not an error worth a
              // dialog: the text is selectable in the box above.
              setCopied(false)
            }
          }}
        >
          {copied ? 'Copied' : 'Copy message'}
        </button>
      </div>
    </Dialog>
  )
}

function PromiseForm({
  row,
  onClose,
  onSaved,
}: {
  row: QueueRow
  onClose: () => void
  onSaved: () => void
}) {
  const [amount, setAmount] = useState(String(row.overdue.toFixed(2)))
  const [promisedDate, setPromisedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [status, setStatus] = useState<'TENTATIVE' | 'CONFIRMED'>('TENTATIVE')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await api.post('v1/promises', {
        account_id: row.account_id,
        amount: Number(amount),
        promised_date: promisedDate,
        status,
        bill_no: row.oldest_bill_no ?? undefined,
        note: note || undefined,
      })
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog title={`What did ${row.account_name} say?`} onClose={onClose}>
      <p style={{ marginTop: 0, color: 'var(--billing-muted)', fontSize: 13 }}>
        A note of the conversation. It records nothing in the accounts and settles no bill — what they owe still
        comes from Smart Books.
      </p>

      {error && <ErrorState message={error} />}

      <div style={{ display: 'grid', gap: 14 }}>
        <div className="billing-field">
          <label htmlFor="promise-amount">Amount they said</label>
          <input
            id="promise-amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            style={{ textAlign: 'right' }}
          />
        </div>
        <div className="billing-field">
          <label htmlFor="promise-date">Date they said</label>
          <input id="promise-date" type="date" value={promisedDate} onChange={(event) => setPromisedDate(event.target.value)} />
        </div>
        <div className="billing-field">
          <label htmlFor="promise-status">How firm</label>
          <select id="promise-status" value={status} onChange={(event) => setStatus(event.target.value as 'TENTATIVE' | 'CONFIRMED')}>
            <option value="TENTATIVE">Tentative — they mentioned a date</option>
            <option value="CONFIRMED">Confirmed — they committed to it</option>
          </select>
        </div>
        <div className="billing-field">
          <label htmlFor="promise-note">Note</label>
          <input id="promise-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional" />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
        <button type="button" className="billing-button" onClick={onClose}>Cancel</button>
        <button type="button" className="billing-button billing-button--primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save the promise'}
        </button>
      </div>
    </Dialog>
  )
}

/** A small modal: Escape closes it, focus starts inside, the backdrop is a click target. */
function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="billing-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
        style={{
          position: 'fixed',
          zIndex: 80,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(92vw, 34rem)',
          maxHeight: '86vh',
          overflowY: 'auto',
          padding: 22,
          background: 'var(--billing-surface)',
          border: '1px solid var(--billing-border)',
          borderRadius: 'var(--billing-radius)',
          boxShadow: 'var(--billing-shadow-lg)',
        }}
      >
        <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>{title}</h2>
        {children}
      </div>
    </>
  )
}
