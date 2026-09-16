import { Link } from 'react-router-dom'
import { api } from '../services/api'
import type { Dashboard, Insight } from '../services/types'
import { useApi } from '../hooks/useApi'
import { useBilling } from '../context/BillingContext'
import { Card, money, Notice, StatCard } from '../ui'

/**
 * The Billing home screen.
 *
 * It answers the questions a small business owner actually asks, in the order
 * they ask them: how much did I sell, who owes me, whom do I owe, how much cash
 * is there. Every card is gated on a permission, because the whole point of
 * Billing profiles is that the person at the counter sees the first and not the
 * last three.
 */
export default function Home() {
  const { scope, session } = useBilling()

  const dashboard = useApi(
    (signal) => api.one<Dashboard>('v1/dashboard', undefined, signal),
    [scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    Boolean(scope),
  )

  const insights = useApi(
    (signal) => api.get<{ data: Insight[] }>('v1/insights', undefined, signal),
    [scope?.cmp_id, scope?.fy_id],
    Boolean(scope),
  )

  const cards = dashboard.data?.data.cards
  const loading = dashboard.loading

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <h1 style={{ margin: 0, fontSize: '1.3rem' }}>
        {session ? `Hello, ${session.display_name.split(' ')[0]}` : 'Home'}
      </h1>

      {dashboard.error && (
        <Notice tone="danger" title="Could not load the home screen">
          {dashboard.error}
        </Notice>
      )}

      {(insights.data?.data ?? []).map((insight) => (
        <Notice
          key={insight.kind}
          tone={insight.tone}
          action={
            <Link to={insight.action.path} style={{ whiteSpace: 'nowrap' }}>
              {insight.action.label}
            </Link>
          }
        >
          {insight.message}
        </Notice>
      ))}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.75rem' }}>
        {cards?.sales && (
          <StatCard
            label="Sales today"
            value={loading ? '…' : money(readNumber(cards.sales.today, ['total_sales', 'total', 'amount']))}
            hint={cards.sales.available ? 'From Smart Books' : (cards.sales.reason ?? 'Books did not answer')}
          />
        )}
        {cards?.sales && (
          <StatCard
            label="Sales this month"
            value={loading ? '…' : money(readNumber(cards.sales.period, ['total_sales', 'total', 'amount']))}
          />
        )}
        {cards?.receivable && (
          <StatCard
            label="Money to collect"
            value={loading ? '…' : cards.receivable.available ? money(cards.receivable.total) : '—'}
            hint={cards.receivable.available ? `${money(cards.receivable.overdue)} overdue` : cards.receivable.reason}
            tone={(cards.receivable.overdue ?? 0) > 0 ? 'warning' : 'default'}
          />
        )}
        {cards?.payable && (
          <StatCard
            label="Money to pay"
            value={loading ? '…' : cards.payable.available ? money(cards.payable.total) : '—'}
            hint={cards.payable.available ? `${money(cards.payable.overdue)} overdue` : cards.payable.reason}
          />
        )}
        {cards?.cash_bank.available && cards.cash_bank.cash !== null && cards.cash_bank.cash !== undefined && (
          <StatCard label="Cash in hand" value={money(cards.cash_bank.cash)} />
        )}
        {cards?.cash_bank.available && cards.cash_bank.bank !== null && cards.cash_bank.bank !== undefined && (
          <StatCard label="In the bank" value={money(cards.cash_bank.bank)} />
        )}
      </div>

      {cards?.attention && (cards.attention.unfinished_transactions > 0 || cards.attention.recurring_due > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))', gap: '1rem' }}>
          {cards.attention.unfinished_transactions > 0 && (
            <Notice
              tone="danger"
              title={`${cards.attention.unfinished_transactions} entry did not save`}
              action={<Link to="/more/unfinished">Retry</Link>}
            >
              These have not reached Smart Books yet. Nothing has been duplicated.
            </Notice>
          )}
          {cards.attention.recurring_due > 0 && (
            <Notice
              tone="info"
              title={`${cards.attention.recurring_due} recurring bill ready`}
              action={<Link to="/more/recurring">Raise</Link>}
            >
              Their date has come round.
            </Notice>
          )}
        </div>
      )}

      {cards?.low_stock?.available && (cards.low_stock.items ?? []).length > 0 && (
        <Card title="Running low">
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {(cards.low_stock.items ?? []).slice(0, 8).map((item, index) => (
              <li key={index}>
                {String(item.item_name ?? `Item #${item.item_id}`)}
                {item.available_qty !== undefined && (
                  <span style={{ color: 'var(--muted)' }}> — {String(item.available_qty)} left</span>
                )}
              </li>
            ))}
          </ul>
          <p style={{ color: 'var(--muted)', fontSize: '0.78rem', marginTop: '0.6rem', marginBottom: 0 }}>
            From Aicountly Inventory, read just now.
          </p>
        </Card>
      )}

      {dashboard.data && (
        <p style={{ color: 'var(--muted)', fontSize: '0.78rem', margin: 0 }}>{dashboard.data.data.note}</p>
      )}
    </div>
  )
}

/** Books' dashboard shapes vary a little; try the likely keys rather than guessing one. */
function readNumber(source: Record<string, unknown> | null | undefined, keys: string[]): number {
  if (!source) return 0
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number') return value
    if (typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) return Number(value)
  }
  return 0
}
