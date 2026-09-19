/**
 * One report, read and drawn.
 *
 * This is the execution layer the discovery screen hands off to, and it is the
 * old Reports screen's working half kept whole: the same endpoint, the same
 * period control, the same export, the same columns, the same refusal to show
 * a total for a read that was cut short.
 *
 * Every one of these is Smart Books' own register or report, read on the
 * request that draws it. There is no reporting table in this product, which is
 * why a register printed from here and the same register printed from Books
 * cannot disagree.
 *
 * Export is a separate permission from viewing, and the file is built on the
 * server from the FULL filtered set — not the rows on screen. A person who
 * filters to a month and exports expects the month; handing them page one
 * silently is the kind of error that surfaces after the figures are in a
 * return. When the whole set cannot be read, the export is refused and says so.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Download, Link2, Printer, Radio } from 'lucide-react'
import { api, ApiError } from '../../services/api'
import { useApi } from '../../hooks/useApi'
import { useBilling } from '../../context/BillingContext'
import { DataTable, date as formatDate, money, Notice } from '../../ui'
import { PERIOD_OPTIONS, type PeriodKey } from '../../dashboards/DashboardLayout'
import { FavouriteButton } from './ReportActions'
import { useReportPreferences } from './preferences'
import { decorate, findCategory, SOURCE_LABELS, type ReportSummary } from './registry'
import '../../styles/reports.css'

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

function isPeriodKey(value: string): value is PeriodKey {
  return PERIOD_OPTIONS.some((option) => option.key === value)
}

/** Keyed on the scope, so a company switch cannot leave the old one's figures up. */
export default function ReportView() {
  const { scope } = useBilling()
  const { reportKey = '' } = useParams<{ reportKey: string }>()
  const key = scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}:${reportKey}` : reportKey

  return <ReportScreen key={key} reportKey={reportKey} />
}

function ReportScreen({ reportKey }: { reportKey: string }) {
  const navigate = useNavigate()
  const { scope, can } = useBilling()
  const prefs = useReportPreferences(scope?.cmp_id)

  const [period, setPeriod] = useState<PeriodKey>(() =>
    isPeriodKey(prefs.defaultPeriod) ? prefs.defaultPeriod : 'month',
  )
  const [downloading, setDownloading] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'warning' | 'danger'; title: string; text: string } | null>(
    null,
  )

  // The catalogue, for what this report is called and where its figures come
  // from. Metadata only — the report itself is the call below.
  const catalogue = useApi(
    (signal) => api.one<{ reports: ReportSummary[] }>('v1/reports', undefined, signal),
    [scope?.cmp_id, scope?.fy_id],
    Boolean(scope),
  )

  const report = useApi(
    (signal) => api.one<ReportResult>(`v1/reports/${reportKey}`, { period }, signal),
    [reportKey, period, scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    Boolean(scope && reportKey),
  )

  const result = report.data?.data
  const meta = useMemo(() => {
    const found = catalogue.data?.data.reports.find((entry) => entry.key === reportKey)
    return found ? decorate(found) : null
  }, [catalogue.data, reportKey])

  // Recorded once the report has actually been drawn. A report that refused to
  // open is not something the user viewed, and listing it as recent would send
  // them straight back into the same refusal.
  const opened = Boolean(result)
  useEffect(() => {
    if (opened) prefs.noteOpened(reportKey)
    // Only when this report first succeeds — not on every period change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, reportKey])

  async function download() {
    if (downloading) return
    setDownloading(true)
    setMessage(null)
    try {
      const { blob, filename } = await api.download(`v1/reports/${reportKey}/export`, { period })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      setMessage({
        tone: 'danger',
        title: 'The file was not built',
        text: error instanceof ApiError ? error.message : 'The export could not be produced.',
      })
    } finally {
      setDownloading(false)
    }
  }

  async function copyLink() {
    const url = `${window.location.origin}/reports/${reportKey}`
    try {
      await navigator.clipboard.writeText(url)
      setMessage({ tone: 'success', title: 'Link copied', text: url })
    } catch {
      setMessage({ tone: 'warning', title: 'Could not copy the link', text: url })
    }
  }

  const failure = report.cause instanceof ApiError ? report.cause : null
  const forbidden = failure?.status === 403
  const missing = failure?.status === 404
  const category = meta ? findCategory(meta.categories[0] ?? '') : null
  const title = result?.label ?? meta?.label ?? 'Report'

  return (
    <div className="reports-page">
      <button type="button" className="reports-breadcrumb" onClick={() => navigate('/reports')}>
        <ChevronLeft size={16} aria-hidden /> All reports
      </button>

      <div className="reports-view">
        <header className="reports-view__head">
          <div className="reports-view__title">
            {meta && (
              <span className="reports-page__title-icon" aria-hidden>
                <meta.icon size={21} />
              </span>
            )}
            <div>
              <h1>{title}</h1>
              {meta?.description && <p>{meta.description}</p>}
              <div className="reports-meta">
                {category && (
                  <span className={`reports-tag reports-tag--${category.tone}`}>{category.title}</span>
                )}
                {meta && (
                  <span className="reports-source">
                    <Radio size={11} aria-hidden /> Live from {SOURCE_LABELS[meta.source]} — read as this page
                    drew it, never a stored copy
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="reports-view__actions">
            <div className="billing-segmented" role="group" aria-label="Period">
              {PERIOD_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className="billing-segmented__option"
                  aria-pressed={period === option.key}
                  onClick={() => setPeriod(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {meta && (
              <FavouriteButton
                on={prefs.isFavourite(reportKey)}
                label={meta.label}
                onToggle={() => prefs.toggleFavourite(reportKey)}
              />
            )}

            <button type="button" className="billing-button billing-button--small" onClick={() => void copyLink()}>
              <Link2 size={14} aria-hidden /> Copy link
            </button>

            <button
              type="button"
              className="billing-button billing-button--small"
              onClick={() => window.print()}
              disabled={!result}
            >
              <Printer size={14} aria-hidden /> Print
            </button>

            {can('export.data') && (
              <button
                type="button"
                className="billing-button billing-button--small"
                onClick={() => void download()}
                disabled={downloading || report.loading || !result}
              >
                <Download size={14} aria-hidden /> {downloading ? 'Building…' : 'Export CSV'}
              </button>
            )}
          </div>
        </header>

        {message && (
          <Notice tone={message.tone} title={message.title} onDismiss={() => setMessage(null)}>
            {message.text}
          </Notice>
        )}

        <section className="reports-panel">
          {forbidden ? (
            <Notice tone="warning" title="You don't have access to this report">
              Your Billing profile does not include it. Ask someone who manages access to add it.
            </Notice>
          ) : missing ? (
            <Notice tone="warning" title="There is no such report">
              The link may be out of date. Go back to Reports and pick one from the list.
            </Notice>
          ) : report.error ? (
            <div className="billing-error-state" role="alert">
              <strong>This report couldn't be run</strong>
              <span>
                {failure?.retryable
                  ? 'The product that owns these figures could not be reached just now.'
                  : 'We couldn’t produce this report right now.'}
              </span>
              <button type="button" className="billing-button billing-button--small" onClick={report.reload}>
                Try again
              </button>
            </div>
          ) : (
            <>
              {result && !result.complete && (
                <div style={{ marginBottom: 12 }}>
                  <Notice tone="warning" title="More rows exist than could be read">
                    No total is shown and an export would be short. Narrow the dates.
                  </Notice>
                </div>
              )}

              {report.loading && !result ? (
                <div className="billing-skeleton-rows" aria-busy="true">
                  <span className="billing-sr-only">Reading this report from its source</span>
                  {[0, 1, 2, 3, 4, 5].map((slot) => (
                    <span key={slot} className="billing-skeleton reports-skeleton-row" />
                  ))}
                </div>
              ) : (
                <DataTable
                  loading={report.loading}
                  rows={result?.rows ?? []}
                  rowKey={(row) =>
                    String(
                      row.voucher_id ??
                        row.document_no ??
                        row.bill_no ??
                        row.account_id ??
                        JSON.stringify(row).slice(0, 32),
                    )
                  }
                  empty="Nothing in this period."
                  columns={(result?.columns ?? []).map((column) => ({
                    key: column.key,
                    header: column.label,
                    numeric: column.numeric,
                    render: (row: Record<string, unknown>) => renderCell(column, row[column.key]),
                  }))}
                />
              )}

              {result?.total != null && (
                <div className="reports-view__foot">
                  <span style={{ color: 'var(--billing-muted)', fontSize: 12 }}>Total</span>
                  <span className="reports-view__total">{money(result.total)}</span>
                </div>
              )}

              {result && (
                <p className="reports-view__note">
                  {result.period.from === result.period.to
                    ? `As at ${formatDate(result.period.from)}. `
                    : `${formatDate(result.period.from)} to ${formatDate(result.period.to)}. `}
                  {result.note}
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function renderCell(column: ReportColumn, value: unknown): ReactNode {
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
