/**
 * What falls due next.
 *
 * Soonest first, six of them, and each row opens the bill. "View all" does not
 * go anywhere else — it narrows the table below to the same thirty days, which
 * is what somebody asking to see all of them actually wants.
 */

import { dayMonth, money } from '../../ui'
import { SkeletonRows, statusDot } from './parts'
import type { PayableBill, PayablesUpcoming } from '../../services/types'

export function UpcomingPayments({
  upcoming,
  loading,
  onOpenBill,
  onViewAll,
}: {
  upcoming: PayablesUpcoming | null
  loading: boolean
  onOpenBill: (bill: PayableBill) => void
  onViewAll: () => void
}) {
  return (
    <article className="mtp-card">
      <div className="mtp-card__head">
        <div>
          <h2>Upcoming payments</h2>
          <p>{upcoming ? `Next ${upcoming.days} days · ${money(upcoming.amount)}` : 'Next 30 days'}</p>
        </div>
        {upcoming && upcoming.count > 0 && (
          <button type="button" className="mtp-link" onClick={onViewAll}>
            View all →
          </button>
        )}
      </div>

      <div className="mtp-card__body">
        {loading && upcoming === null ? (
          <SkeletonRows rows={5} />
        ) : !upcoming || upcoming.count === 0 ? (
          <p style={{ margin: 0, color: 'var(--billing-muted)', fontSize: 13 }}>
            Nothing falls due in the next {upcoming?.days ?? 30} days.
          </p>
        ) : (
          <div className="mtp-upcoming">
            {upcoming.rows.map((bill) => (
              <button
                key={bill.row_key}
                type="button"
                className="mtp-upcoming__row"
                onClick={() => onOpenBill(bill)}
                title={`${bill.account_name}${bill.bill_no ? ` · ${bill.bill_no}` : ''} · due ${bill.due_date ?? 'unknown'}`}
              >
                <span className="mtp-upcoming__date">{dayMonth(bill.due_date)}</span>
                <span className={`mtp-dot ${statusDot(bill.status)}`} aria-hidden="true" />
                <span className="mtp-upcoming__party">{bill.account_name}</span>
                <span className="mtp-upcoming__amount">{money(bill.balance)}</span>
              </button>
            ))}
            {upcoming.count > upcoming.rows.length && (
              <p style={{ margin: '10px 0 0', color: 'var(--billing-muted)', fontSize: 12 }}>
                and {upcoming.count - upcoming.rows.length} more in the window.
              </p>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
