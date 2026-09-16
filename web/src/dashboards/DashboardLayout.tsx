/**
 * The frame every dashboard page sits in.
 *
 * The application shell around it — logo, company/branch/year, search, the
 * sidebar — is drawn once in AppShell and is the same on every screen in the
 * product. This is only the part that changes: the tab bar, the heading, the
 * period control, the freshness line, the four cards and the panels.
 *
 * The tab bar comes FROM THE SERVER, in the session payload, built from the
 * same list the endpoints check. A tab the API would refuse cannot appear here,
 * because nothing in the browser decides what goes in it.
 */

import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { useBilling } from '../context/BillingContext'
import type { Metric, PeriodDescription } from './types'
import { MetricRow } from './kit'

export const PERIOD_OPTIONS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
] as const

export type PeriodKey = (typeof PERIOD_OPTIONS)[number]['key']

export function PeriodPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: PeriodKey
  onChange: (key: PeriodKey) => void
  disabled?: boolean
}) {
  return (
    <div className="billing-segmented" role="group" aria-label="Period">
      {PERIOD_OPTIONS.map((option) => (
        <button
          key={option.key}
          type="button"
          className="billing-segmented__option"
          aria-pressed={value === option.key}
          disabled={disabled}
          onClick={() => onChange(option.key)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * When this data was read, and a way to read it again.
 *
 * It says "Last read" and a clock time, never "Live". Nothing on these screens
 * updates itself — there is no socket and no poll — and a badge claiming
 * otherwise would have people trusting a figure from twenty minutes ago.
 */
export function DataStatus({
  generatedAt,
  loading,
  onRefresh,
}: {
  generatedAt?: string | null
  loading: boolean
  onRefresh: () => void
}) {
  const read = generatedAt ? new Date(generatedAt) : null
  const readable = read && !Number.isNaN(read.getTime())
    ? new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' }).format(read)
    : null

  return (
    <div className="billing-data-status" role="status">
      <span>
        {loading ? 'Reading…' : readable ? `Last read at ${readable}` : 'Not read yet'}
      </span>
      <button
        type="button"
        className="billing-button billing-button--quiet billing-button--small"
        onClick={onRefresh}
        disabled={loading}
      >
        <RefreshCw size={14} className={loading ? 'spin' : undefined} aria-hidden /> Refresh
      </button>
    </div>
  )
}

export function BillingDashboardLayout({
  activeDashboard,
  title,
  description,
  period,
  filters,
  actions,
  status,
  metrics,
  metricsLoading,
  metricFormat,
  metricIcons,
  onMetricOpen,
  children,
}: {
  activeDashboard: string
  title: string
  description: ReactNode
  period?: PeriodDescription | null
  filters?: ReactNode
  actions?: ReactNode
  status?: ReactNode
  metrics: Metric[]
  metricsLoading: boolean
  metricFormat?: (metric: Metric) => 'money' | 'count'
  metricIcons?: Record<string, ReactNode>
  /** Opens the records behind a card. A figure you cannot open is a figure you cannot check. */
  onMetricOpen?: (metric: Metric) => void
  children: ReactNode
}) {
  const { session } = useBilling()
  const tabs = session?.dashboards ?? []

  return (
    <>
      {/* One tab is not a choice; a biller with only their own desk should not
          be shown a bar that implies four more exist. */}
      {tabs.length > 1 && (
        <nav className="billing-dashboard-nav" aria-label="Dashboards">
          {tabs.map((tab) => (
            <NavLink
              key={tab.key}
              to={tab.path}
              className="billing-dashboard-nav__link"
              aria-current={tab.key === activeDashboard ? 'page' : undefined}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      )}

      <div className="billing-page-heading">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {actions && <div className="billing-actions">{actions}</div>}
      </div>

      <div className="billing-toolbar">
        <div className="billing-filters">
          {filters}
          {period && (
            <span className="billing-basis" title={`Dates resolved in ${period.timezone}`}>
              {period.from === period.to ? period.from : `${period.from} → ${period.to}`}
            </span>
          )}
        </div>
        {status}
      </div>

      <MetricRow
        metrics={metrics}
        loading={metricsLoading}
        format={metricFormat}
        icons={metricIcons}
        onOpen={onMetricOpen}
      />

      <div className="billing-dashboard-content">{children}</div>
    </>
  )
}
