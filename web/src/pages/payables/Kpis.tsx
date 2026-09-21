/**
 * The four figures the screen opens with.
 *
 * Each card is a button that narrows the table below it, because "₹4,32,500
 * overdue" is a number somebody immediately wants the list behind. The card
 * that is currently driving the table says so, so the two cannot look unrelated.
 *
 * The trend on the first card is two readings of Books — today's and the same
 * day last month — and nothing else. When the second reading did not come back,
 * the card says what is owed and leaves the trend out; it never shows a
 * percentage worked out from one number.
 */

import { ArrowDownRight, ArrowUpRight, CalendarCheck, CalendarDays, Clock, Wallet } from 'lucide-react'
import { money, moneyWhole } from '../../ui'
import { Skeleton } from './parts'
import type { PayablesComparison, PayablesSummary } from '../../services/types'

interface CardProps {
  label: string
  value: number | null
  meta: React.ReactNode
  icon: React.ReactNode
  tone: 'green' | 'red' | 'amber' | 'blue'
  loading: boolean
  active: boolean
  onPick?: () => void
  title: string
}

function Kpi({ label, value, meta, icon, tone, loading, active, onPick, title }: CardProps) {
  const body = (
    <>
      <span className={`mtp-kpi__mark mtp-tone-${tone}`} aria-hidden="true">{icon}</span>
      <span className="mtp-kpi__body">
        <span className="mtp-kpi__label">{label}</span>
        {loading ? (
          <Skeleton className="mtp-skeleton--value" />
        ) : value === null ? (
          <strong className="mtp-kpi__value mtp-kpi__value--unavailable">Unavailable</strong>
        ) : (
          <strong className="mtp-kpi__value" title={money(value)}>{moneyWhole(value)}</strong>
        )}
        <span className="mtp-kpi__meta">{loading ? <Skeleton className="mtp-skeleton--label" /> : meta}</span>
      </span>
    </>
  )

  return (
    <article className="mtp-kpi" aria-busy={loading}>
      {onPick && !loading ? (
        <button
          type="button"
          className="mtp-kpi__inner"
          onClick={onPick}
          aria-pressed={active}
          title={title}
          style={active ? { boxShadow: 'inset 0 0 0 2px var(--billing-action)', borderRadius: 14 } : undefined}
        >
          {body}
        </button>
      ) : (
        <div className="mtp-kpi__inner" title={title}>{body}</div>
      )}
    </article>
  )
}

function bills(count: number, word = 'bill'): string {
  return `${count.toLocaleString('en-IN')} ${word}${count === 1 ? '' : 's'}`
}

/**
 * The change against last month, when both readings exist.
 *
 * Owing less than a month ago is good news and is drawn as such; owing more is
 * not an error, so it is marked rather than alarmed. A month in which nothing
 * was owed cannot produce a percentage, and none is shown.
 */
function Trend({ summary, comparison }: { summary: PayablesSummary; comparison: PayablesComparison | null }) {
  if (!comparison?.available || comparison.total === null || comparison.total <= 0) {
    return <>{`${bills(summary.bill_count)} across ${bills(summary.supplier_count, 'supplier')}`}</>
  }

  const change = ((summary.total - comparison.total) / comparison.total) * 100
  const rounded = Math.round(Math.abs(change))

  if (rounded === 0) {
    return <>About the same as {comparison.label}</>
  }

  const down = change < 0
  const Arrow = down ? ArrowDownRight : ArrowUpRight

  return (
    <span
      className={down ? 'mtp-kpi__meta--down' : 'mtp-kpi__meta--up'}
      title={`${money(comparison.total)} was owed as at ${comparison.as_on}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
    >
      <Arrow size={13} aria-hidden />
      {rounded}% vs. {comparison.label}
    </span>
  )
}

export function PayablesKpis({
  summary,
  comparison,
  loading,
  activeStatus,
  onPick,
}: {
  summary: PayablesSummary | null
  comparison: PayablesComparison | null
  loading: boolean
  activeStatus: string
  onPick: (status: string) => void
}) {
  const empty: PayablesSummary = {
    total: 0, bill_count: 0, supplier_count: 0,
    overdue: 0, overdue_count: 0,
    due_today: 0, due_today_count: 0,
    due_this_week: 0, due_this_week_count: 0,
    due_soon_days: 7,
  }
  const figures = summary ?? empty
  const busy = loading && summary === null

  return (
    <section className="mtp-kpis" aria-label="What you owe">
      <Kpi
        label="Total payables"
        value={busy ? null : figures.total}
        meta={<Trend summary={figures} comparison={comparison} />}
        icon={<Wallet size={21} />}
        tone="green"
        loading={busy}
        active={false}
        onPick={() => onPick('all')}
        title="Everything still owed to suppliers, bill by bill, after every payment allocated to date."
      />
      <Kpi
        label="Overdue"
        value={busy ? null : figures.overdue}
        meta={`${bills(figures.overdue_count)} overdue`}
        icon={<Clock size={21} />}
        tone="red"
        loading={busy}
        active={activeStatus === 'overdue'}
        onPick={() => onPick('overdue')}
        title="The part already past its due date. Click to list only these."
      />
      <Kpi
        label="Due today"
        value={busy ? null : figures.due_today}
        meta={`${bills(figures.due_today_count)} due today`}
        icon={<CalendarCheck size={21} />}
        tone="amber"
        loading={busy}
        active={activeStatus === 'due_today'}
        onPick={() => onPick('due_today')}
        title="Bills whose due date is today, in the company's timezone."
      />
      <Kpi
        label="Due this week"
        value={busy ? null : figures.due_this_week}
        meta={bills(figures.due_this_week_count)}
        icon={<CalendarDays size={21} />}
        tone="blue"
        loading={busy}
        active={activeStatus === 'due_this_week'}
        onPick={() => onPick('due_this_week')}
        title={`Bills falling due today or in the next ${figures.due_soon_days} days.`}
      />
    </section>
  )
}
