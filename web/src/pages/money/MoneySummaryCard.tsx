/**
 * What the period came to.
 *
 * Every figure is the server's, and every figure may be absent. A summary that
 * cannot be totalled honestly shows "—" and the reason, never ₹0.00 — the
 * distinction between "nothing was paid" and "we could not read it" is the
 * whole reason this panel is trustworthy enough to put beside a form.
 *
 * The trend chip appears only when the server actually drew a comparison. It
 * needs a previous period that could be totalled too, so on a quiet first month
 * there is simply no chip rather than an invented one.
 */

import { ArrowDownRight, ArrowUpRight, BarChart3 } from 'lucide-react'
import type { MoneySummary } from '../../services/types'
import { money } from '../../ui'
import { MONEY_PERIODS, type Direction, type MoneyPeriodKey } from './money'

export function MoneySummaryCard({
  direction,
  summary,
  loading,
  error,
  period,
  onPeriodChange,
  periodLabel,
}: {
  direction: Direction
  summary: MoneySummary | null
  loading: boolean
  error: string | null
  period: MoneyPeriodKey
  onPeriodChange: (key: MoneyPeriodKey) => void
  periodLabel: string | null
}) {
  const isOut = direction === 'out'
  const noun = isOut ? 'payments' : 'receipts'

  const rows: Array<{ label: string; value: string | null; note?: string | null; trend?: boolean }> = [
    {
      label: isOut ? 'Total paid' : 'Total received',
      value: summary?.total === null || summary?.total === undefined ? null : money(summary.total),
      trend: true,
    },
    {
      label: `Number of ${noun}`,
      value:
        summary?.count === null || summary?.count === undefined ? null : summary.count.toLocaleString('en-IN'),
    },
    {
      label: isOut ? 'Average payment' : 'Average receipt',
      value: summary?.average === null || summary?.average === undefined ? null : money(summary.average),
    },
    {
      label: isOut ? 'Largest payment' : 'Largest receipt',
      value:
        summary?.largest?.amount === null || summary?.largest?.amount === undefined
          ? null
          : money(summary.largest.amount),
      note: summary?.largest?.party ?? null,
    },
  ]

  const comparison = summary?.comparison

  return (
    <section className="billing-panel">
      <div className="billing-panel__heading">
        <div className="billing-money__card-heading">
          <span className="billing-money__card-mark" aria-hidden="true">
            <BarChart3 size={19} />
          </span>
          <div>
            <h2>{isOut ? 'Payment summary' : 'Receipt summary'}</h2>
            {periodLabel && <p>{periodLabel}</p>}
          </div>
        </div>

        <label>
          <span className="billing-sr-only">Summary period</span>
          <select
            className="billing-scope-select"
            value={period}
            onChange={(event) => onPeriodChange(event.target.value as MoneyPeriodKey)}
          >
            {MONEY_PERIODS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* An error keeps the four rows and empties them, rather than replacing
          the panel with a sentence: the card holds its height, and the reason
          goes underneath where the footnote already lives. */}
      <>
        <dl className="billing-money__summary">
          {rows.map((row) => (
              <div className="billing-money__summary-row" key={row.label}>
                <dt>{row.label}</dt>
                <dd>
                  {loading && !error ? (
                    <span className="billing-skeleton billing-money__summary-skeleton">
                      <span className="billing-sr-only">Loading {row.label}</span>
                    </span>
                  ) : error || row.value === null ? (
                    <span className="billing-money__summary-value billing-money__summary-value--empty">—</span>
                  ) : (
                    <span className="billing-money__summary-value">{row.value}</span>
                  )}

                  {!loading && !error && row.note && <span className="billing-money__summary-note">{row.note}</span>}

                  {/* The chip carries the figure; the sentence behind it —
                      "+12.4% vs the previous 19 days" — is the title and the
                      accessible name. In a 280px rail the sentence itself
                      wrapped over three lines and pushed the amount off the
                      row it belongs to. */}
                  {!loading && !error && row.trend && comparison?.available && (
                    <span
                      className={`billing-trend billing-trend--${comparison.tone ?? 'positive'}`}
                      title={comparison.label}
                      aria-label={comparison.label}
                    >
                      {comparison.direction === 'up' ? (
                        <ArrowUpRight size={12} aria-hidden />
                      ) : (
                        <ArrowDownRight size={12} aria-hidden />
                      )}
                      <span aria-hidden="true">
                        {comparison.percent === undefined
                          ? comparison.label
                          : `${comparison.percent > 0 ? '+' : ''}${comparison.percent}%`}
                      </span>
                    </span>
                  )}
                </dd>
              </div>
            ))}
        </dl>

        {error ? (
          <p className="billing-panel__footnote" role="status">
            {error}
          </p>
        ) : (
          !loading &&
          summary &&
          !summary.available &&
          summary.reason && <p className="billing-panel__footnote">{summary.reason}</p>
        )}
      </>
    </section>
  )
}
