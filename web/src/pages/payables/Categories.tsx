/**
 * What the money is owed for.
 *
 * The donut is one SVG circle per slice, drawn with a dash offset — no chart
 * library, and no canvas that a screen reader cannot see into. The same figures
 * are in the legend beside it and in a hidden table, so the chart is never the
 * only way to read them.
 *
 * WHEN BOOKS DOES NOT CLASSIFY BILLS, THIS SAYS SO. It does not fall back to
 * splitting the total by supplier and labelling that a category: "who" and
 * "what for" are different questions, and a donut answering the wrong one is
 * worse than a sentence admitting the answer is not available.
 */

import { compactMoney, money } from '../../ui'
import { Skeleton } from './parts'
import type { PayableCategories } from '../../services/types'

/** Distinct at a glance and distinguishable in the commonest colour deficiencies. */
const SLICE_COLOURS = ['#2f7ed8', '#2f9e28', '#e0952b', '#7c5cd6', '#d4566f', '#0f9b9b', '#8a8f93']

const SIZE = 116
const STROKE = 19
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function PayablesCategories({
  categories,
  loading,
  activeCategory,
  onPick,
}: {
  categories: PayableCategories | null
  loading: boolean
  activeCategory: string
  onPick: (category: string) => void
}) {
  const rows = categories?.rows ?? []
  const drawable = rows.filter((row) => row.amount > 0)
  const totalDrawn = drawable.reduce((sum, row) => sum + row.amount, 0)

  let offset = 0

  return (
    <article className="mtp-card">
      <div className="mtp-card__head">
        <div>
          <h2>Payable by category</h2>
          <p>As Smart Books classifies each bill</p>
        </div>
      </div>

      <div className="mtp-card__body">
        {loading && categories === null ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }} aria-busy="true">
            <span className="billing-sr-only">Loading the category split</span>
            <span className="mtp-skeleton" style={{ width: SIZE, height: SIZE, borderRadius: '50%', flex: '0 0 auto' }} />
            <span style={{ display: 'grid', gap: 8, flex: 1 }}>
              {[0, 1, 2, 3].map((index) => <Skeleton key={index} width={`${90 - index * 12}%`} />)}
            </span>
          </div>
        ) : !categories?.available || drawable.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--billing-muted)', fontSize: 13 }}>
            {categories?.reason ?? 'No category breakdown is available for these bills.'}
          </p>
        ) : (
          <>
            <div className="mtp-donut">
              <div className="mtp-donut__figure">
                <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={
                  `Payables by category: ${drawable.map((row) => `${row.label} ${money(row.amount)}`).join(', ')}`
                }>
                  <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
                    {drawable.map((row, index) => {
                      const length = totalDrawn > 0 ? (row.amount / totalDrawn) * CIRCUMFERENCE : 0
                      const dash = `${length} ${CIRCUMFERENCE - length}`
                      const thisOffset = -offset
                      offset += length
                      const dimmed = activeCategory !== '' && activeCategory !== row.key

                      return (
                        <circle
                          key={row.key}
                          cx={SIZE / 2}
                          cy={SIZE / 2}
                          r={RADIUS}
                          fill="none"
                          stroke={SLICE_COLOURS[index % SLICE_COLOURS.length]}
                          strokeWidth={STROKE}
                          strokeDasharray={dash}
                          strokeDashoffset={thisOffset}
                          opacity={dimmed ? 0.3 : 1}
                        >
                          <title>{`${row.label}: ${money(row.amount)} (${row.share}%)`}</title>
                        </circle>
                      )
                    })}
                  </g>
                </svg>
                <span className="mtp-donut__centre">
                  <strong>{compactMoney(categories.total)}</strong>
                  <span>Total</span>
                </span>
              </div>

              <div className="mtp-legend">
                {drawable.map((row, index) => {
                  const active = activeCategory === row.key
                  const filterable = !row.key.startsWith('__')

                  return (
                    <button
                      key={row.key}
                      type="button"
                      className="mtp-legend__row"
                      aria-pressed={active}
                      disabled={!filterable}
                      onClick={() => filterable && onPick(active ? '' : row.key)}
                      title={
                        filterable
                          ? `${row.label}: ${money(row.amount)} across ${row.count} bill${row.count === 1 ? '' : 's'}`
                          : `${row.label}: ${money(row.amount)} — several categories grouped, so it cannot be filtered to`
                      }
                    >
                      <span
                        className="mtp-legend__swatch"
                        style={{ background: SLICE_COLOURS[index % SLICE_COLOURS.length] }}
                        aria-hidden="true"
                      />
                      <span className="mtp-legend__name">{row.label}</span>
                      <span className="mtp-legend__share">{row.share}%</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="billing-sr-only">
              <table>
              <caption>Payable by category</caption>
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col">Bills</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Share</th>
                </tr>
              </thead>
              <tbody>
                {drawable.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{row.label}</th>
                    <td>{row.count}</td>
                    <td>{money(row.amount)}</td>
                    <td>{row.share}%</td>
                  </tr>
                ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </article>
  )
}
