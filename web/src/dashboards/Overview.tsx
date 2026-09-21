/**
 * Dashboard 1 — "Your business, at a glance".
 *
 * Four figures, one counted briefing, a trend, a short list of things to do,
 * and the last few bills. Nothing on this page is decoration: every card drills
 * into the records behind it, every suggestion goes to the screen where it can
 * be acted on, and every button here either opens a screen or fetches a file.
 *
 * Two rules decide what is on it:
 *
 *   * A panel the user may not see is NOT RENDERED, and its data is never
 *     asked for. The server leaves the metric out and sets the panel to null;
 *     this file checks the same permissions before drawing a heading, so a
 *     biller is not shown an empty "Cash & bank" telling them a balance exists
 *     and that somebody decided they should not have it.
 *   * Nothing claims to be generated that was counted. The briefing strip is
 *     arithmetic and says so; the written summary is a separate request, made
 *     only when somebody asks for it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Building,
  CreditCard,
  FileText,
  Plus,
  Receipt,
  TrendingUp,
  Upload,
  Wallet,
} from 'lucide-react'
import { useBilling } from '../context/BillingContext'
import { api, ApiError } from '../services/api'
import { date, money } from '../ui'
import { BillingDashboardLayout, DataStatus, PeriodPicker } from './DashboardLayout'
import { SERIES_COLOURS, TrendChart } from './Chart'
import {
  BriefingStrip,
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
import { groupPoints, type Grain } from './trend'
import type { AssistantBriefing, Metric, OverviewDashboard } from './types'

const ICONS: Record<string, React.ReactNode> = {
  sales: <TrendingUp size={17} />,
  to_collect: <Wallet size={17} />,
  to_pay: <FileText size={17} />,
  cash_bank: <Building size={17} />,
}

/** The id the priority panel is scrolled to from the briefing strip. */
const PRIORITIES_ID = 'billing-priorities'

export default function Overview() {
  const navigate = useNavigate()
  const { can } = useBilling()
  const { data, loading, error, retryable, period, setPeriod, reload } =
    useDashboard<OverviewDashboard>('v1/dashboards/overview')

  const [grain, setGrain] = useState<Grain>('day')

  /**
   * Where each card drills to.
   *
   * Built here rather than as a constant because two of them depend on what
   * this user may open: the sales figure leads to the sales register, which is
   * a report, and a profile without reports has nowhere for that card to go.
   * A card with no destination is rendered as a card, not as a dead button.
   */
  const drill: Record<string, string | undefined> = {
    sales: can('reports.view') ? `/reports?report=sales_register&period=${period}` : undefined,
    to_collect: can('receivable.view') ? '/dashboard/receivables' : undefined,
    to_pay: can('payable.view') ? '/dashboard/payables' : undefined,
    cash_bank: can('cash.view') || can('bank.view') ? '/bank-cash' : undefined,
  }

  const quickActions = [
    { label: 'New invoice', hint: 'Create and send', icon: <Receipt size={18} />, path: '/sales/new', permission: 'sale.create' },
    { label: 'Add purchase', hint: 'Record a bill', icon: <FileText size={18} />, path: '/purchases/new', permission: 'purchase.create' },
    { label: 'Record receipt', hint: 'Mark as received', icon: <ArrowDownCircle size={18} />, path: '/money-in/new', permission: 'receipt.create' },
    { label: 'Record payment', hint: 'Make a payment', icon: <ArrowUpCircle size={18} />, path: '/money-out/new', permission: 'payment.create' },
    { label: 'Bank deposit', hint: 'Cash into the bank', icon: <CreditCard size={18} />, path: '/bank-cash/deposit', permission: 'contra.create' },
  ].filter((action) => can(action.permission))

  const trend = data?.panels.trend
  const series = useMemo(() => {
    if (!trend) return []

    return Object.entries(trend.series).map(([key, value]) => ({
      key,
      label: value.label,
      colour: key === 'sales' ? SERIES_COLOURS.sales : SERIES_COLOURS.collections,
      points: groupPoints(
        Object.entries(value.points).map(([label, amount]) => ({ label, value: amount })),
        grain,
      ),
    }))
  }, [trend, grain])

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
        const path = drill[metric.id]
        if (path) navigate(path)
      }}
      metricOpenable={(metric) => drill[metric.id] !== undefined}
      actions={<HeadingActions period={period} />}
    >
      {error && <ErrorState message={error} onRetry={retryable ? reload : undefined} />}

      <BriefingStrip
        briefing={data?.panels.briefing ?? null}
        loading={loading && !data}
        onReview={() => {
          const target = document.getElementById(PRIORITIES_ID)
          target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          // Scrolling alone leaves a keyboard user where they were. The panel
          // takes focus so the next Tab continues from what they asked for.
          target?.focus()
        }}
        assistant={<AssistantLine />}
      />

      <div className="billing-grid billing-grid--wide">
        <DashboardPanel
          title="Sales & collections"
          description="Movements during the selected period"
          action={<GrainPicker value={grain} onChange={setGrain} disabled={loading} />}
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
          id={PRIORITIES_ID}
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
          description="Latest invoices in the selected scope"
          action={
            can('reports.view') ? (
              <button
                type="button"
                className="billing-panel__link"
                onClick={() => navigate(`/reports?report=sales_register&period=${period}`)}
              >
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

      {data && <p className="billing-source-note">{data.source}</p>}
    </BillingDashboardLayout>
  )
}

// ---------------------------------------------------------------------------
// The heading's own actions
// ---------------------------------------------------------------------------

/**
 * Make a bill, and take the register away as a file.
 *
 * Both are permission-gated here and again on the server; the export is refused
 * server-side by `reports.view` + `export.data` whatever this component draws,
 * and the file is built there from the whole filtered period rather than from
 * the six rows on screen.
 */
function HeadingActions({ period }: { period: string }) {
  const navigate = useNavigate()
  const { can } = useBilling()
  const [downloading, setDownloading] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  const mayExport = can('reports.view') && can('export.data')

  const exportRegister = useCallback(async () => {
    if (downloading) return
    setDownloading(true)
    setFailed(null)
    try {
      const { blob, filename } = await api.download('v1/reports/sales_register/export', { period })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setFailed(err instanceof ApiError ? err.message : 'The file could not be built.')
    } finally {
      setDownloading(false)
    }
  }, [downloading, period])

  if (!can('sale.create') && !mayExport) return null

  return (
    <>
      {can('sale.create') && (
        <button
          type="button"
          className="billing-button billing-button--primary"
          onClick={() => navigate('/sales/new')}
        >
          <Plus size={16} aria-hidden /> New invoice
        </button>
      )}

      {mayExport && (
        <button type="button" className="billing-button" onClick={exportRegister} disabled={downloading}>
          <Upload size={16} aria-hidden />
          {downloading ? 'Building…' : 'Export'}
        </button>
      )}

      {failed && (
        <span role="alert" className="billing-heading-error">
          {failed}
        </span>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// The written summary
// ---------------------------------------------------------------------------

/**
 * The generated half of the briefing, asked for only when somebody asks.
 *
 * Deliberately not fetched on render. A model call on every dashboard open is
 * a cost nobody chose and a wait nobody asked for, and the counted briefing
 * above it is already the useful part. In this deployment the answer is that
 * no model is configured — which is shown as its own small line, not as a
 * failure of the page.
 */
function AssistantLine() {
  const { scope } = useBilling()
  const [state, setState] = useState<'idle' | 'asking' | 'answered' | 'failed'>('idle')
  const [answer, setAnswer] = useState<AssistantBriefing | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const inFlight = useRef<AbortController | null>(null)

  /**
   * A new company, branch or year is a new question.
   *
   * The answer to the old one is dropped and the request behind it aborted, so
   * a summary of one company's month cannot land under another company's
   * heading — the same rule the dashboard's own read follows, for the same
   * reason: it would be wrong, it would look right, and nothing on it would
   * say which company it belonged to.
   */
  useEffect(() => {
    setState('idle')
    setAnswer(null)
    setFailure(null)

    return () => {
      inFlight.current?.abort()
      inFlight.current = null
    }
  }, [scope?.cmp_id, scope?.fy_id, scope?.bo_id])

  const ask = useCallback(async () => {
    if (state === 'asking' || !scope) return

    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller

    setState('asking')
    setFailure(null)
    try {
      const response = await api.one<AssistantBriefing>('v1/dashboards/overview/briefing', undefined, controller.signal)
      if (controller.signal.aborted) return
      setAnswer(response.data)
      setState('answered')
    } catch (err) {
      if (controller.signal.aborted) return
      setFailure(err instanceof ApiError ? err.message : 'The summary could not be requested.')
      setState('failed')
    }
  }, [scope, state])

  if (state === 'idle') {
    return (
      <button type="button" className="billing-briefing__ask" onClick={ask}>
        Write this up for me
      </button>
    )
  }

  if (state === 'asking') {
    return (
      <p className="billing-briefing__assistant" role="status">
        Asking…
      </p>
    )
  }

  if (state === 'failed') {
    return (
      <p className="billing-briefing__assistant" role="alert">
        {failure}{' '}
        <button type="button" className="billing-briefing__ask" onClick={ask}>
          Try again
        </button>
      </p>
    )
  }

  if (answer && !answer.available) {
    return (
      <p className="billing-briefing__assistant" role="status">
        <strong>Written summary unavailable.</strong> {answer.reason}
      </p>
    )
  }

  return (
    <div className="billing-briefing__assistant">
      <p>{answer?.narrative}</p>
      {answer?.generated_at && (
        <p className="billing-briefing__basis">
          Written by the briefing service at {date(answer.generated_at)}. Suggestions, not confirmed facts —
          the counted line above is the checked one.
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The trend's grouping
// ---------------------------------------------------------------------------

function GrainPicker({
  value,
  onChange,
  disabled,
}: {
  value: Grain
  onChange: (next: Grain) => void
  disabled: boolean
}) {
  return (
    <div className="billing-field billing-field--inline">
      <label htmlFor="trend-grain">Group by</label>
      <select
        id="trend-grain"
        className="billing-scope-select billing-scope-select--bordered"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value === 'week' ? 'week' : 'day')}
      >
        <option value="day">Daily</option>
        <option value="week">Weekly</option>
      </select>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recent invoices
// ---------------------------------------------------------------------------

function RecentInvoices({
  panel,
  loading,
}: {
  panel: OverviewDashboard['panels']['recent_documents']
  loading: boolean
}) {
  const navigate = useNavigate()
  const { can } = useBilling()

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
          can('sale.create') ? (
            <button type="button" className="billing-button billing-button--soft" onClick={() => navigate('/sales/new')}>
              Make the first one
            </button>
          ) : undefined
        }
      >
        No invoices in this period yet.
      </EmptyState>
    )
  }

  // A statement is a different permission from seeing the bill, so the
  // customer is only a link for someone who may open one.
  const mayOpenParty = can('statement.view')

  return (
    <div className="billing-table-scroll" tabIndex={0} role="region" aria-label="Recent invoices, scrollable">
      <table className="billing-table">
        <thead>
          <tr>
            <th scope="col">Invoice</th>
            <th scope="col">Customer</th>
            <th scope="col">Date</th>
            <th scope="col" className="billing-amount">Amount</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {panel.rows.map((row) => (
            <tr key={row.voucher_uuid ?? row.voucher_id ?? row.document_no}>
              <th scope="row" className="billing-table__id">{row.document_no ?? '—'}</th>
              <td>
                {row.party === null ? (
                  '—'
                ) : mayOpenParty && row.party_id !== null ? (
                  <button
                    type="button"
                    className="billing-record-link"
                    onClick={() => navigate(`/parties/${row.party_id}`)}
                  >
                    {row.party}
                  </button>
                ) : (
                  row.party
                )}
              </td>
              <td>{date(row.date)}</td>
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
