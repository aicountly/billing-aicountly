/**
 * Dashboard 4 — "Stay ahead of supplier dues".
 *
 * One phrase does a lot of work on this screen: RECORD PAYMENT. It writes a
 * payment voucher in Smart Books against a cash or bank ledger. It does not
 * instruct a bank, and nothing in this product does. Every label here is worded
 * so that nobody reads it as "pay", because somebody eventually will act on the
 * assumption that the supplier has been paid.
 *
 * The review queue lists only bills with something demonstrably odd about them.
 * A clean bill is not "awaiting review" — it is recorded, and putting it in a
 * queue would invent work for somebody to clear.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CalendarClock, ClipboardCheck, Clock, FileUp, Wallet } from 'lucide-react'
import { date, money } from '../ui'
import { BillingDashboardLayout, DataStatus, PeriodPicker } from './DashboardLayout'
import {
  Badge,
  DashboardPanel,
  EmptyState,
  ErrorState,
  SkeletonRows,
  Unavailable,
} from './kit'
import { useDashboard } from './useDashboard'
import { countFormat } from './Overview'
import type { PayablesDashboard, ReviewBill } from './types'

const ICONS: Record<string, React.ReactNode> = {
  to_pay: <Wallet size={17} />,
  due_soon: <CalendarClock size={17} />,
  overdue: <Clock size={17} />,
  to_review: <ClipboardCheck size={17} />,
}

export default function Payables() {
  const navigate = useNavigate()
  const { data, loading, error, retryable, period, setPeriod, reload } =
    useDashboard<PayablesDashboard>('v1/dashboards/payables')

  const [compare, setCompare] = useState<ReviewBill | null>(null)
  const panels = data?.panels

  return (
    <BillingDashboardLayout
      activeDashboard="payables"
      title="Stay ahead of supplier dues"
      description="Track purchases, review bills and never miss a payment."
      period={data?.period}
      filters={<PeriodPicker value={period} onChange={setPeriod} disabled={loading} />}
      status={<DataStatus generatedAt={data?.generated_at} loading={loading} onRefresh={reload} />}
      metrics={data?.metrics ?? []}
      metricsLoading={loading}
      metricFormat={countFormat}
      metricIcons={ICONS}
      actions={
        <>
          {panels?.can_add_purchase && (
            <button type="button" className="billing-button billing-button--primary" onClick={() => navigate('/purchases/new')}>
              Add Purchase
            </button>
          )}
          {panels?.can_debit_note && (
            <button type="button" className="billing-button" onClick={() => navigate('/more/debit-note')}>
              Purchase Return
            </button>
          )}
        </>
      }
    >
      {error && <ErrorState message={error} onRetry={retryable ? reload : undefined} />}

      <div className="billing-grid billing-grid--wide">
        <DashboardPanel
          title="Upcoming payments"
          description="What falls due over the next seven days"
          footnote={panels?.upcoming.available === true ? panels.upcoming.basis : undefined}
        >
          {loading && !data ? (
            <SkeletonRows rows={4} />
          ) : panels === undefined ? (
            <SkeletonRows rows={4} />
          ) : !panels.upcoming.available ? (
            <Unavailable>{panels.upcoming.reason}</Unavailable>
          ) : panels.upcoming.days.length === 0 ? (
            <EmptyState>Nothing falls due in the next seven days.</EmptyState>
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              {panels.upcoming.days.map((day) => (
                <div key={day.date}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: 12,
                      marginBottom: 6,
                    }}
                  >
                    <strong style={{ fontSize: 13 }}>{date(day.date)}</strong>
                    <span className="num" style={{ fontWeight: 700 }}>{money(day.amount)}</span>
                  </div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {day.bills.map((bill, index) => (
                      <div
                        key={`${bill.account_id}-${bill.bill_no ?? index}`}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 12,
                          padding: '10px 12px',
                          border: '1px solid var(--billing-border)',
                          borderRadius: 10,
                        }}
                      >
                        <span style={{ minWidth: 0 }}>
                          {bill.account_name}
                          {bill.bill_no && (
                            <span style={{ color: 'var(--billing-muted)', fontSize: 12 }}> · {bill.bill_no}</span>
                          )}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span className="num">{money(bill.balance)}</span>
                          {panels.can_record_payment && (
                            <button
                              type="button"
                              className="billing-button billing-button--soft billing-button--small"
                              onClick={() => navigate(`/money-out/new?party_account_id=${bill.account_id}`)}
                            >
                              Record payment
                            </button>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DashboardPanel>

        <div style={{ display: 'grid', gap: 22 }}>
          <DashboardPanel title="Add a supplier bill" description="Upload → Extract → Review → Save">
            {panels?.upload.available ? (
              <EmptyState>Document extraction is configured. Drop a bill to begin.</EmptyState>
            ) : (
              <Unavailable
                title="Reading a bill automatically is not set up"
                action={
                  panels?.upload.can_add ? (
                    <button
                      type="button"
                      className="billing-button billing-button--primary"
                      onClick={() => navigate(panels.upload.manual_path)}
                    >
                      <FileUp size={15} aria-hidden /> Enter the bill instead
                    </button>
                  ) : undefined
                }
              >
                {panels?.upload.reason ??
                  'No document-extraction service is configured for this deployment.'}
              </Unavailable>
            )}
          </DashboardPanel>

          <DashboardPanel
            title="Cash impact"
            description="Planned payments, next seven days"
            footnote={panels?.cash_impact.basis}
          >
            {loading && !data ? (
              <SkeletonRows rows={2} />
            ) : !panels?.cash_impact.available ? (
              <Unavailable>{panels?.cash_impact.reason ?? 'Smart Books did not answer.'}</Unavailable>
            ) : (
              <div>
                <div className="num" style={{ fontSize: 30, fontWeight: 700, textAlign: 'left' }}>
                  {money(panels.cash_impact.amount ?? 0)}
                </div>
                <p style={{ color: 'var(--billing-muted)', fontSize: 13, marginBottom: 0 }}>
                  What you plan to pay — helps you keep enough in hand. Nothing here has been paid.
                </p>
              </div>
            )}
          </DashboardPanel>
        </div>
      </div>

      <DashboardPanel
        title="Purchase bills to review"
        description="Bills where Billing found something worth a second look"
        className="billing-panel--flush"
        footnote={panels?.review.basis}
      >
        {loading && !data ? (
          <div style={{ padding: '0 22px' }}><SkeletonRows rows={4} /></div>
        ) : !panels?.review.available ? (
          <div style={{ padding: '0 22px' }}>
            <Unavailable>{panels?.review.reason ?? 'Smart Books did not answer.'}</Unavailable>
          </div>
        ) : panels.review.rows.length === 0 ? (
          <EmptyState>
            Nothing odd in the last {panels.review.examined ?? 0} bills — no duplicates, no missing dates or numbers.
          </EmptyState>
        ) : (
          <div className="billing-table-scroll">
            <table className="billing-table">
              <thead>
                <tr>
                  <th scope="col">Supplier</th>
                  <th scope="col">Bill number</th>
                  <th scope="col">Bill date</th>
                  <th scope="col" className="billing-amount">Amount</th>
                  <th scope="col">Why it is here</th>
                  <th scope="col"><span className="billing-sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {panels.review.rows.map((row) => (
                  <tr key={row.row_key}>
                    <td>{row.supplier ?? '—'}</td>
                    <td>{row.bill_no ?? <span style={{ color: 'var(--billing-muted)' }}>not recorded</span>}</td>
                    <td>{row.bill_date ? date(row.bill_date) : <span style={{ color: 'var(--billing-muted)' }}>not recorded</span>}</td>
                    <td className="billing-amount">{row.amount === null ? '—' : money(row.amount)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {row.flags.map((flag) => (
                          <Badge key={flag.code} tone={flag.tone === 'danger' ? 'danger' : 'warning'}>
                            <AlertTriangle size={12} aria-hidden /> {flag.label}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        {row.peer_bills.length > 0 && (
                          <button
                            type="button"
                            className="billing-button billing-button--soft billing-button--small"
                            onClick={() => setCompare(row)}
                          >
                            Compare
                          </button>
                        )}
                        {row.voucher_id !== null && (
                          <button
                            type="button"
                            className="billing-button billing-button--small"
                            onClick={() => navigate(`/purchases/${row.voucher_id}`)}
                          >
                            Open
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

      {data?.note && <p style={{ color: 'var(--billing-muted)', fontSize: 12, margin: 0 }}>{data.note}</p>}

      {compare && <CompareBills bill={compare} onClose={() => setCompare(null)} />}
    </BillingDashboardLayout>
  )
}

/**
 * Two bills, side by side, and no verdict.
 *
 * A supplier who delivers the same order every week produces the same pattern
 * as a bill entered twice. Billing cannot tell those apart and does not try:
 * it shows both and lets the person who knows the supplier decide.
 */
function CompareBills({ bill, onClose }: { bill: ReviewBill; onClose: () => void }) {
  const rows = [
    { label: 'This bill', document: bill.document_no, billNo: bill.bill_no, billDate: bill.bill_date, amount: bill.amount },
    ...bill.peer_bills.map((peer) => ({
      label: 'Looks like the same',
      document: peer.document_no,
      billNo: peer.bill_no,
      billDate: peer.bill_date,
      amount: peer.amount,
    })),
  ]

  return (
    <>
      <div className="billing-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Compare bills"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
        style={{
          position: 'fixed',
          zIndex: 80,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(94vw, 44rem)',
          maxHeight: '86vh',
          overflowY: 'auto',
          padding: 22,
          background: 'var(--billing-surface)',
          border: '1px solid var(--billing-border)',
          borderRadius: 'var(--billing-radius)',
          boxShadow: 'var(--billing-shadow-lg)',
        }}
      >
        <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>Bills from {bill.supplier ?? 'this supplier'}</h2>
        <p style={{ marginTop: 0, color: 'var(--billing-muted)', fontSize: 13 }}>
          These look alike. That is a reason to check, not proof of anything — a supplier who delivers the same order
          each week produces the same pattern.
        </p>

        <div className="billing-table-scroll">
          <table className="billing-table">
            <thead>
              <tr>
                <th scope="col"> </th>
                <th scope="col">Our reference</th>
                <th scope="col">Their bill no.</th>
                <th scope="col">Their bill date</th>
                <th scope="col" className="billing-amount">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.document ?? index}-${index}`}>
                  <td style={{ color: 'var(--billing-muted)', fontSize: 12 }}>{row.label}</td>
                  <td>{row.document ?? '—'}</td>
                  <td>{row.billNo ?? '—'}</td>
                  <td>{row.billDate ? date(row.billDate) : '—'}</td>
                  <td className="billing-amount">{row.amount === null ? '—' : money(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="billing-button billing-button--primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </>
  )
}
