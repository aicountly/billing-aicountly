/**
 * Dashboard 1 — "Your business, at a glance".
 *
 * Four figures, a trend, a short list of things to do, and the last few bills.
 * Nothing on this page is decoration: every card drills into the records behind
 * it, and every suggestion goes to the screen where it can be acted on.
 */

import { useNavigate } from 'react-router-dom'
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Building,
  CreditCard,
  FileText,
  Receipt,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { useBilling } from '../context/BillingContext'
import { date, money } from '../ui'
import { BillingDashboardLayout, DataStatus, PeriodPicker } from './DashboardLayout'
import { SERIES_COLOURS, TrendChart } from './Chart'
import {
  DashboardPanel,
  EmptyState,
  ErrorState,
  QuickAction,
  SettlementBadge,
  SkeletonRows,
  SuggestedAction,
  Unavailable,
} from './kit'
import { useDashboard } from './useDashboard'
import type { Metric, OverviewDashboard } from './types'

const ICONS: Record<string, React.ReactNode> = {
  sales: <TrendingUp size={17} />,
  to_collect: <Wallet size={17} />,
  to_pay: <FileText size={17} />,
  cash_bank: <Building size={17} />,
}

/** Where each card drills to. A figure you cannot open is a figure you cannot check. */
const DRILL: Record<string, string> = {
  sales: '/sales',
  to_collect: '/dashboard/receivables',
  to_pay: '/dashboard/payables',
  cash_bank: '/bank-cash',
}

export default function Overview() {
  const navigate = useNavigate()
  const { can, session } = useBilling()
  const { data, loading, error, retryable, period, setPeriod, reload } =
    useDashboard<OverviewDashboard>('v1/dashboards/overview')

  const firstName = session?.display_name.split(' ')[0]

  const quickActions = [
    { label: 'New Sale', hint: 'Create an invoice', icon: <Receipt size={18} />, path: '/sales/new', permission: 'sale.create' },
    { label: 'Add Purchase', hint: 'Record a supplier bill', icon: <FileText size={18} />, path: '/purchases/new', permission: 'purchase.create' },
    { label: 'Record Receipt', hint: 'Mark customer payment', icon: <ArrowDownCircle size={18} />, path: '/money-in/new', permission: 'receipt.create' },
    { label: 'Record Payment', hint: 'Pay a supplier', icon: <ArrowUpCircle size={18} />, path: '/money-out/new', permission: 'payment.create' },
    { label: 'Bank Deposit', hint: 'Cash into the bank', icon: <CreditCard size={18} />, path: '/bank-cash/deposit', permission: 'contra.create' },
  ].filter((action) => can(action.permission))

  const trend = data?.panels.trend
  const series = trend
    ? Object.entries(trend.series).map(([key, value]) => ({
        key,
        label: value.label,
        colour: key === 'sales' ? SERIES_COLOURS.sales : SERIES_COLOURS.collections,
        points: Object.entries(value.points).map(([label, amount]) => ({ label, value: amount })),
      }))
    : []

  return (
    <BillingDashboardLayout
      activeDashboard="overview"
      title="Your business, at a glance"
      description={
        data
          ? `${data.period.label} · every figure read from Smart Books as this page loaded`
          : 'Sales, what you are owed, what you owe, and what is in hand.'
      }
      period={data?.period}
      filters={<PeriodPicker value={period} onChange={setPeriod} disabled={loading} />}
      status={<DataStatus generatedAt={data?.generated_at} loading={loading} onRefresh={reload} />}
      metrics={data?.metrics ?? []}
      metricsLoading={loading}
      metricIcons={ICONS}
      onMetricOpen={(metric) => {
        const path = DRILL[metric.id]
        if (path) navigate(path)
      }}
      actions={
        firstName ? <span style={{ color: 'var(--billing-muted)' }}>Hello, {firstName}</span> : undefined
      }
    >
      {error && <ErrorState message={error} onRetry={retryable ? reload : undefined} />}

      <div className="billing-grid billing-grid--wide">
        <DashboardPanel
          title="Sales & collections"
          description="Movements during the selected period"
          footnote="Sales is what was invoiced; collections is what came in. A month where collections is the higher line is a month of getting paid for old work, not a record month."
        >
          {loading && !data ? (
            <SkeletonRows rows={6} />
          ) : (
            <TrendChart series={series} basis={trend?.basis ?? ''} reason={trend?.reason} />
          )}
        </DashboardPanel>

        <DashboardPanel
          title="Your next best actions"
          description="Each one names the records behind it"
          className="billing-panel--insights"
          footnote="Counted from your live records, not predicted. Nothing here happens unless you do it."
        >
          {loading && !data ? (
            <SkeletonRows rows={3} />
          ) : (data?.panels.actions ?? []).length === 0 ? (
            <EmptyState>Nothing needs your attention right now.</EmptyState>
          ) : (
            (data?.panels.actions ?? []).map((suggestion) => (
              <SuggestedAction
                key={suggestion.id}
                suggestion={suggestion}
                onReview={() => navigate(suggestion.action.path)}
              />
            ))
          )}
        </DashboardPanel>
      </div>

      <div className="billing-grid billing-grid--wide">
        <DashboardPanel
          title="Recent invoices"
          action={
            can('sale.view') ? (
              <button type="button" className="billing-button billing-button--small" onClick={() => navigate('/sales')}>
                View all
              </button>
            ) : undefined
          }
        >
          <RecentInvoices panel={data?.panels.recent_documents ?? null} loading={loading && !data} />
        </DashboardPanel>

        <DashboardPanel title="Quick actions" description="Get things done, fast.">
          {quickActions.length === 0 ? (
            <EmptyState>Your Billing profile does not include any of these.</EmptyState>
          ) : (
            <div className="billing-quick-actions">
              {quickActions.map((action) => (
                <QuickAction
                  key={action.path}
                  label={action.label}
                  hint={action.hint}
                  icon={action.icon}
                  onClick={() => navigate(action.path)}
                />
              ))}
            </div>
          )}
        </DashboardPanel>
      </div>

      {data && <p style={{ color: 'var(--billing-muted)', fontSize: 12, margin: 0 }}>{data.source}</p>}
    </BillingDashboardLayout>
  )
}

function RecentInvoices({
  panel,
  loading,
}: {
  panel: OverviewDashboard['panels']['recent_documents']
  loading: boolean
}) {
  const navigate = useNavigate()

  if (loading) return <SkeletonRows rows={5} />
  if (panel === null) {
    return <Unavailable title="Not shown">Your Billing profile does not include bills.</Unavailable>
  }
  if (!panel.available) {
    return <Unavailable>{panel.reason ?? 'Smart Books did not answer.'}</Unavailable>
  }
  if (panel.rows.length === 0) {
    return (
      <EmptyState
        action={
          <button type="button" className="billing-button billing-button--soft" onClick={() => navigate('/sales/new')}>
            Make the first one
          </button>
        }
      >
        No invoices in this period yet.
      </EmptyState>
    )
  }

  return (
    <div className="billing-table-scroll">
      <table className="billing-table">
        <thead>
          <tr>
            <th scope="col">Invoice No.</th>
            <th scope="col">Date</th>
            <th scope="col">Party</th>
            <th scope="col" className="billing-amount">Amount</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {panel.rows.map((row) => (
            <tr key={row.voucher_uuid ?? row.voucher_id ?? row.document_no}>
              <td>{row.document_no ?? '—'}</td>
              <td>{date(row.date)}</td>
              <td>{row.party ?? '—'}</td>
              <td className="billing-amount">{row.amount === null ? '—' : money(row.amount)}</td>
              <td><SettlementBadge status={row.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Counts are rendered as counts, not as rupees. */
export function countFormat(metric: Metric): 'money' | 'count' {
  return metric.basis === 'count' ? 'count' : 'money'
}
