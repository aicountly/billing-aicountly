/**
 * Dashboard 5 — "Close your day with confidence".
 *
 * Two claims this screen is careful not to make.
 *
 * IT CLOSES NOTHING. Ticking every line locks no period and posts no entry.
 * Smart Books owns the accounting period; a checklist here that quietly created
 * a lock would be a second answer to a question this product does not own.
 *
 * IT CERTIFIES NOTHING. The document panel reports what was asked of the IRP
 * and what came back. "Not generated" means not generated — never
 * "non-compliant" — and a sale that never needed a document is not listed at
 * all, because listing it would turn a normal day into four exceptions.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  Building2,
  Check,
  CircleAlert,
  FileWarning,
  Landmark,
} from 'lucide-react'
import { api, ApiError } from '../services/api'
import { date, money } from '../ui'
import { BillingDashboardLayout, DataStatus } from './DashboardLayout'
import { FlowChart } from './Chart'
import {
  Badge,
  DashboardPanel,
  EmptyState,
  ErrorState,
  QuickAction,
  SkeletonRows,
  Unavailable,
} from './kit'
import { useDashboard } from './useDashboard'
import { countFormat } from './Overview'
import type { ComplianceDashboard } from './types'

const ICONS: Record<string, React.ReactNode> = {
  cash: <Banknote size={17} />,
  bank: <Landmark size={17} />,
  unmatched: <Building2 size={17} />,
  document_exceptions: <FileWarning size={17} />,
}

export default function CashCompliance() {
  const navigate = useNavigate()
  const [businessDate, setBusinessDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const { data, loading, error, retryable, reload } = useDashboard<ComplianceDashboard>(
    'v1/dashboards/cash-compliance',
    'today',
    { business_date: businessDate },
  )

  const panels = data?.panels

  return (
    <BillingDashboardLayout
      activeDashboard="cash-compliance"
      title="Close your day with confidence"
      description="Reconcile, review and stay on top of your cash and documents."
      period={data?.period}
      filters={
        <div className="billing-field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label htmlFor="business-date" style={{ whiteSpace: 'nowrap' }}>Day</label>
          <input
            id="business-date"
            type="date"
            value={businessDate}
            onChange={(event) => setBusinessDate(event.target.value)}
            style={{ width: 'auto', minHeight: 38 }}
          />
        </div>
      }
      status={<DataStatus generatedAt={data?.generated_at} loading={loading} onRefresh={reload} />}
      metrics={data?.metrics ?? []}
      metricsLoading={loading}
      metricFormat={countFormat}
      metricIcons={ICONS}
    >
      {error && <ErrorState message={error} onRetry={retryable ? reload : undefined} />}

      <div className="billing-grid billing-grid--wide">
        <DashboardPanel
          title="Cash movement"
          description="Money in and money out on the selected day"
          footnote={
            // The chart prints its own basis underneath itself; repeating it
            // here just made the same sentence appear twice. What belongs here
            // is the thing the chart deliberately leaves out.
            panels?.movement.available === true &&
            panels.movement.transferred.available &&
            panels.movement.transferred.count > 0 ? (
              <>
                <strong>{money(panels.movement.transferred.amount)}</strong> was moved between your own accounts today.{' '}
                {panels.movement.transferred.note}
              </>
            ) : undefined
          }
        >
          {loading && !data ? (
            <SkeletonRows rows={5} />
          ) : panels === undefined ? (
            <SkeletonRows rows={5} />
          ) : !panels.movement.available ? (
            <Unavailable>{panels.movement.reason}</Unavailable>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 28, marginBottom: 14, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ color: 'var(--billing-muted)', fontSize: 12 }}>Money in</div>
                  <div className="num" style={{ fontSize: 22, fontWeight: 700, textAlign: 'left' }}>
                    {money(panels.movement.in_total)}
                  </div>
                </div>
                <div>
                  <div style={{ color: 'var(--billing-muted)', fontSize: 12 }}>Money out</div>
                  <div className="num" style={{ fontSize: 22, fontWeight: 700, textAlign: 'left' }}>
                    {money(panels.movement.out_total)}
                  </div>
                </div>
              </div>
              <FlowChart buckets={panels.movement.buckets} basis={panels.movement.basis} />
            </>
          )}
        </DashboardPanel>

        <DashboardPanel
          title="Day-close checklist"
          description="Steps to look at before you finish"
          footnote={panels?.checklist.note}
        >
          {loading && !data ? (
            <SkeletonRows rows={4} />
          ) : (
            <Checklist
              steps={panels?.checklist.steps ?? []}
              businessDate={panels?.checklist.date ?? businessDate}
              onChanged={reload}
            />
          )}
        </DashboardPanel>
      </div>

      <div className="billing-grid billing-grid--wide">
        <DashboardPanel
          title="Document readiness"
          description="e-Invoice and e-Way Bill requests raised from Billing"
          className="billing-panel--flush"
          footnote={panels?.documents.note}
        >
          <Documents panel={panels?.documents} loading={loading && !data} onOpen={(id) => navigate(`/sales/${id}`)} />
        </DashboardPanel>

        <div style={{ display: 'grid', gap: 22 }}>
          <DashboardPanel title="Bank matching" description="Matching statement lines to entries">
            {loading && !data ? (
              <SkeletonRows rows={3} />
            ) : (
              <Unavailable title="Not available in this deployment">
                {panels?.matching.reason ?? 'No bank statement is available to match against.'}
                {panels?.matching.dependency && (
                  <span style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                    Owned by {panels.matching.dependency.owner}. The contract needed is written down in{' '}
                    <code>{panels.matching.dependency.document}</code>.
                  </span>
                )}
              </Unavailable>
            )}
          </DashboardPanel>

          <DashboardPanel title="Quick actions">
            <div className="billing-quick-actions">
              {panels?.can_take_money && (
                <QuickAction
                  label="Record Receipt"
                  icon={<ArrowDownToLine size={18} />}
                  onClick={() => navigate('/money-in/new')}
                />
              )}
              {panels?.can_pay && (
                <QuickAction
                  label="Record Payment"
                  icon={<ArrowUpFromLine size={18} />}
                  onClick={() => navigate('/money-out/new')}
                />
              )}
              {panels?.can_move_money && (
                <>
                  <QuickAction
                    label="Bank Deposit"
                    hint="Cash into the bank"
                    icon={<Landmark size={18} />}
                    onClick={() => navigate('/bank-cash/deposit')}
                  />
                  <QuickAction
                    label="Bank Withdrawal"
                    hint="Bank into cash"
                    icon={<Banknote size={18} />}
                    onClick={() => navigate('/bank-cash/withdrawal')}
                  />
                </>
              )}
            </div>
          </DashboardPanel>

          {(panels?.accounts ?? []).length > 0 && (
            <DashboardPanel title="Where the money is" description="Closing balances from Smart Books">
              <div className="billing-table-scroll">
                <table className="billing-table">
                  <thead>
                    <tr>
                      <th scope="col">Account</th>
                      <th scope="col">Kind</th>
                      <th scope="col" className="billing-amount">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(panels?.accounts ?? []).map((account) => (
                      <tr key={account.account_id}>
                        <td>{account.account_name}</td>
                        <td>
                          <Badge tone="neutral">{account.kind === 'cash' ? 'Cash' : 'Bank'}</Badge>
                        </td>
                        <td className="billing-amount">{money(account.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DashboardPanel>
          )}
        </div>
      </div>
    </BillingDashboardLayout>
  )
}

/**
 * The checklist.
 *
 * `outstanding` comes from live data; `checked` is a person. Both are shown,
 * separately, so a step somebody ticked while three exceptions were still open
 * reads as exactly that rather than as done.
 */
function Checklist({
  steps,
  businessDate,
  onChanged,
}: {
  steps: ComplianceDashboard['panels']['checklist']['steps']
  businessDate: string
  onChanged: () => void
}) {
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggle(step: string, checked: boolean) {
    setSaving(step)
    setError(null)
    try {
      await api.post('v1/dashboards/day-close', { date: businessDate, step, checked })
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setSaving(null)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {error && <ErrorState message={error} />}
      {steps.map((step) => (
        <label
          key={step.key}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            padding: '12px 14px',
            border: '1px solid var(--billing-border)',
            borderRadius: 12,
            cursor: saving ? 'progress' : 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={step.checked}
            disabled={saving !== null}
            onChange={(event) => void toggle(step.key, event.target.checked)}
            style={{ width: 20, height: 20, minHeight: 20, marginTop: 2, accentColor: 'var(--billing-action)' }}
          />
          <span style={{ minWidth: 0 }}>
            <span style={{ fontWeight: 650, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {step.label}
              {step.checked && (
                <Badge tone="success">
                  <Check size={12} aria-hidden /> Looked at
                </Badge>
              )}
              {step.outstanding !== null && step.outstanding > 0 && (
                <Badge tone="warning">
                  <CircleAlert size={12} aria-hidden /> {step.outstanding} left
                </Badge>
              )}
            </span>
            <span style={{ display: 'block', color: 'var(--billing-muted)', fontSize: 12, marginTop: 2 }}>
              {step.detail}
              {step.checked && step.checked_at && ` · ${date(step.checked_at)}`}
            </span>
          </span>
        </label>
      ))}
    </div>
  )
}

function Documents({
  panel,
  loading,
  onOpen,
}: {
  panel: ComplianceDashboard['panels']['documents'] | undefined
  loading: boolean
  onOpen: (voucherId: number) => void
}) {
  if (loading || !panel) return <div style={{ padding: '0 22px' }}><SkeletonRows rows={4} /></div>

  if (!panel.available) {
    return (
      <div style={{ padding: '0 22px' }}>
        <Unavailable>{panel.reason ?? 'Not shown for your profile.'}</Unavailable>
      </div>
    )
  }

  const generated = panel.states?.GENERATED ?? 0

  if (panel.rows.length === 0) {
    return (
      <EmptyState>
        {generated > 0
          ? `All ${generated} document request${generated === 1 ? '' : 's'} came back generated. Nothing outstanding.`
          : 'No e-Invoice or e-Way Bill has been requested from Billing. Nothing here needs one.'}
      </EmptyState>
    )
  }

  return (
    <div className="billing-table-scroll">
      <table className="billing-table">
        <thead>
          <tr>
            <th scope="col">Document</th>
            <th scope="col">Invoice</th>
            <th scope="col">Dated</th>
            <th scope="col">State</th>
            <th scope="col">What happened</th>
            <th scope="col"><span className="billing-sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {panel.rows.map((row) => (
            <tr key={row.command_id}>
              <td>{row.document}</td>
              <td>{row.voucher_no ?? '—'}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{date(row.date)}</td>
              <td>
                <Badge tone={row.state === 'FAILED' ? 'danger' : 'warning'}>
                  {row.state === 'FAILED' ? 'Did not generate' : 'Still pending'}
                </Badge>
              </td>
              <td style={{ maxWidth: '22rem' }}>{row.detail}</td>
              <td>
                {row.voucher_id !== null && (
                  <button
                    type="button"
                    className="billing-button billing-button--small"
                    onClick={() => onOpen(row.voucher_id as number)}
                  >
                    Open
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
