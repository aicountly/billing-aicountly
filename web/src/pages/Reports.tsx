/**
 * Reports.
 *
 * Every one is Smart Books' own register or report, read as the page draws it.
 * There is no reporting table in this product, which is why a register printed
 * from here and the same register printed from Books cannot disagree.
 *
 * Export is a separate permission from viewing, and the file is built on the
 * server from the FULL filtered set — not the rows on screen. A person who
 * filters to a month and exports expects the month; handing them page one
 * silently is the kind of error that surfaces after the figures are in a
 * return. When the whole set cannot be read, the export is refused and says so.
 */

import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download, FileText } from 'lucide-react'
import { api, ApiError } from '../services/api'
import { useApi } from '../hooks/useApi'
import { useBilling } from '../context/BillingContext'
import { Card, DataTable, date as formatDate, money, Notice } from '../ui'
import { PERIOD_OPTIONS, type PeriodKey } from '../dashboards/DashboardLayout'

interface ReportColumn {
  key: string
  label: string
  numeric: boolean
}

interface ReportResult {
  key: string
  label: string
  columns: ReportColumn[]
  rows: Array<Record<string, unknown>>
  total: number | null
  complete: boolean
  period: { from: string; to: string }
  note: string
}

/** The periods this screen accepts in a link. Anything else falls back. */
const PERIOD_KEYS = new Set<string>(PERIOD_OPTIONS.map((option) => option.key))

export default function Reports() {
  const { scope, can } = useBilling()

  /**
   * The chosen report and period live in the URL.
   *
   * So that a dashboard or money-screen card can link straight to the
   * register behind it with the period the person was looking at still
   * applied — a drill-down that lands on "pick one on the left" has not
   * drilled into anything — and so that the result is a link somebody can
   * send to their accountant.
   */
  const [params, setParams] = useSearchParams()
  const selected = params.get('report')
  const requested = params.get('period')
  const period: PeriodKey = (requested !== null && PERIOD_KEYS.has(requested) ? requested : 'month') as PeriodKey

  const [downloading, setDownloading] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const choose = useCallback(
    (next: { report?: string; period?: PeriodKey }) => {
      setParams(
        (current) => {
          const updated = new URLSearchParams(current)
          if (next.report !== undefined) updated.set('report', next.report)
          if (next.period !== undefined) updated.set('period', next.period)
          return updated
        },
        // Replace rather than push: flipping between periods should not make
        // Back walk through every one of them before leaving the screen.
        { replace: true },
      )
      setExportError(null)
    },
    [setParams],
  )

  const list = useApi(
    (signal) => api.one<{ reports: Array<{ key: string; label: string }>; note: string }>('v1/reports', undefined, signal),
    [scope?.cmp_id, scope?.fy_id],
    Boolean(scope),
  )

  const report = useApi(
    (signal) => api.one<ReportResult>(`v1/reports/${selected}`, { period }, signal),
    [selected, period, scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    Boolean(scope && selected),
  )

  async function download() {
    if (!selected || downloading) return
    setDownloading(true)
    setExportError(null)
    try {
      const { blob, filename } = await api.download(`v1/reports/${selected}/export`, { period })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setDownloading(false)
    }
  }

  const reports = list.data?.data.reports ?? []
  const result = report.data?.data

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div className="billing-page-heading">
        <div>
          <h1>Reports</h1>
          <p>Read from Smart Books as you open them. Nothing here is a stored copy.</p>
        </div>
      </div>

      {list.error && <Notice tone="danger" title="Could not list the reports">{list.error}</Notice>}

      <div className="billing-grid billing-grid--narrow">
        <Card title="Choose a report">
          {list.loading ? (
            <p style={{ color: 'var(--muted)', margin: 0 }}>Loading…</p>
          ) : reports.length === 0 ? (
            <p style={{ color: 'var(--muted)', margin: 0 }}>
              Your Billing profile does not include any reports.
            </p>
          ) : (
            <div style={{ display: 'grid', gap: '0.35rem' }}>
              {reports.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  className="billing-nav__link"
                  aria-current={entry.key === selected ? 'page' : undefined}
                  style={{ border: 0, cursor: 'pointer', width: '100%', background: 'transparent' }}
                  onClick={() => choose({ report: entry.key })}
                >
                  <FileText size={15} aria-hidden /> {entry.label}
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card
          title={result?.label ?? 'Pick one on the left'}
          action={
            selected && (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div className="billing-segmented" role="group" aria-label="Period">
                  {PERIOD_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className="billing-segmented__option"
                      aria-pressed={period === option.key}
                      onClick={() => choose({ period: option.key })}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {can('export.data') && (
                  <button
                    type="button"
                    className="billing-button billing-button--small"
                    onClick={download}
                    disabled={downloading || report.loading || !result}
                  >
                    <Download size={14} aria-hidden /> {downloading ? 'Building…' : 'Export CSV'}
                  </button>
                )}
              </div>
            )
          }
        >
          {!selected ? (
            <p style={{ color: 'var(--muted)', margin: 0 }}>Choose a report to see it.</p>
          ) : report.error ? (
            <Notice tone="danger" title="Could not run that report">{report.error}</Notice>
          ) : (
            <>
              {exportError && <Notice tone="warning" title="The file was not built">{exportError}</Notice>}

              {result && !result.complete && (
                <Notice tone="warning" title="More rows exist than could be read">
                  No total is shown and an export would be short. Narrow the dates.
                </Notice>
              )}

              <DataTable
                loading={report.loading}
                rows={result?.rows ?? []}
                rowKey={(row) => String(row.voucher_id ?? row.document_no ?? row.bill_no ?? row.account_id ?? JSON.stringify(row).slice(0, 32))}
                empty="Nothing in this period."
                columns={(result?.columns ?? []).map((column) => ({
                  key: column.key,
                  header: column.label,
                  numeric: column.numeric,
                  render: (row: Record<string, unknown>) => renderCell(column, row[column.key]),
                }))}
              />

              {result?.total != null && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1.5rem', marginTop: '0.9rem', alignItems: 'baseline' }}>
                  <span style={{ color: 'var(--muted)' }}>Total</span>
                  <span className="num" style={{ fontSize: '1.15rem', fontWeight: 650 }}>{money(result.total)}</span>
                </div>
              )}

              {result && (
                <p style={{ color: 'var(--muted)', fontSize: '0.78rem', marginTop: '0.75rem', marginBottom: 0 }}>
                  {result.period.from === result.period.to
                    ? `As at ${result.period.from}. `
                    : `${result.period.from} to ${result.period.to}. `}
                  {result.note}
                </p>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  )
}

function renderCell(column: ReportColumn, value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === '') return '—'
  if (column.key === 'date' || column.key === 'bill_date' || column.key === 'due_date') {
    return formatCellDate(value)
  }
  if (column.numeric && column.key !== 'days_overdue' && column.key !== 'attempts') {
    return money(Number(value))
  }
  if (column.key === 'status' || column.key === 'kind' || column.key === 'state') {
    return String(value).replace(/_/g, ' ').toLowerCase()
  }

  return String(value)
}

function formatCellDate(value: unknown): string {
  return typeof value === 'string' ? formatDate(value) : String(value)
}
