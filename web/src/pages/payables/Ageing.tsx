/**
 * How old what you owe is.
 *
 * Bars, not a chart library: five numbers and their shares do not need 40KB of
 * JavaScript, and the repository has no charting dependency to reuse. Heights
 * are shares of the largest bucket rather than of the total, because five bars
 * scaled to a total are five bars nobody can compare.
 *
 * The bar is also a filter — clicking "Over 90 days" lists those bills — and a
 * bucket the server could not reconcile is not drawn at all, on the same
 * principle the dashboard ageing bar already follows: a breakdown that is
 * silently short is the one error on this screen a reader cannot catch.
 */

import { compactMoney, money } from '../../ui'
import { Skeleton } from './parts'
import type { AgeingBucketRow } from '../../services/types'

const TONE_CLASS: Record<string, string> = {
  current: 'mtp-ageing__bar--ok',
  '1_30': 'mtp-ageing__bar--early',
  '31_60': 'mtp-ageing__bar--warning',
  '61_90': 'mtp-ageing__bar--late',
  '90_plus': 'mtp-ageing__bar--danger',
  no_due_date: 'mtp-ageing__bar--neutral',
}

export function PayablesAgeing({
  buckets,
  reconciles,
  loading,
  activeBucket,
  onPick,
}: {
  buckets: AgeingBucketRow[]
  reconciles: boolean
  loading: boolean
  activeBucket: string
  onPick: (bucket: string) => void
}) {
  // A bucket nobody has any bills in is dropped, except the five the ageing is
  // conventionally read in — those stay, at zero, so the shape of the chart
  // does not change every time a bill is paid.
  const shown = buckets.filter((bucket) => bucket.key !== 'no_due_date' || bucket.amount > 0)
  const tallest = Math.max(...shown.map((bucket) => bucket.amount), 0)

  return (
    <article className="mtp-card">
      <div className="mtp-card__head">
        <div>
          <h2>Payables ageing</h2>
          <p>Measured from each bill&rsquo;s own due date</p>
        </div>
      </div>

      <div className="mtp-card__body">
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 178 }} aria-busy="true">
            <span className="billing-sr-only">Loading the ageing</span>
            {[40, 58, 74, 52, 86].map((height, index) => (
              <span key={index} style={{ flex: 1, height: `${height}%` }}>
                <Skeleton className="mtp-skeleton--bar" />
              </span>
            ))}
          </div>
        ) : !reconciles ? (
          <p style={{ margin: 0, color: 'var(--billing-muted)', fontSize: 13 }}>
            The buckets do not add up to the outstanding total, so the breakdown would be misleading. The figure above is
            still Smart Books&rsquo; own.
          </p>
        ) : tallest <= 0 ? (
          <p style={{ margin: 0, color: 'var(--billing-muted)', fontSize: 13 }}>
            Nothing is outstanding, so there is nothing to age.
          </p>
        ) : (
          <>
            <div className="mtp-ageing">
              {shown.map((bucket) => {
                const active = activeBucket === bucket.key
                const height = tallest > 0 ? Math.max((bucket.amount / tallest) * 100, bucket.amount > 0 ? 4 : 0) : 0

                return (
                  <button
                    key={bucket.key}
                    type="button"
                    className="mtp-ageing__col"
                    aria-pressed={active}
                    onClick={() => onPick(active ? '' : bucket.key)}
                    title={`${bucket.label}: ${money(bucket.amount)} across ${bucket.count} bill${bucket.count === 1 ? '' : 's'} (${bucket.share}%)`}
                  >
                    <span className="mtp-ageing__amount">{bucket.amount > 0 ? compactMoney(bucket.amount) : '—'}</span>
                    <span
                      className={`mtp-ageing__bar ${TONE_CLASS[bucket.key] ?? 'mtp-ageing__bar--neutral'}`}
                      style={{ height: `${height}%` }}
                      aria-hidden="true"
                    />
                    <span className="mtp-ageing__label">{bucket.label}</span>
                  </button>
                )
              })}
            </div>

            {/* The same figures as text, for a screen reader and for print. */}
            <div className="billing-sr-only">
              <table>
              <caption>Payables ageing</caption>
              <thead>
                <tr>
                  <th scope="col">Bucket</th>
                  <th scope="col">Bills</th>
                  <th scope="col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((bucket) => (
                  <tr key={bucket.key}>
                    <th scope="row">{bucket.label}</th>
                    <td>{bucket.count}</td>
                    <td>{money(bucket.amount)}</td>
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
