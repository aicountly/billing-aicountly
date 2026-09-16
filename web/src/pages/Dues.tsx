import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../services/api'
import type { Dues as DuesShape } from '../services/types'
import { useApi } from '../hooks/useApi'
import { useBilling } from '../context/BillingContext'
import { Card, DataTable, date, money, Notice, StatCard } from '../ui'

/**
 * Money to collect / money to pay.
 *
 * Every figure here is Smart Books' answer, worked out on this page load. The
 * ageing is arithmetic over live rows, not a stored bucket — which is why the
 * numbers on this screen can never disagree with the accounts.
 */
export function DuesScreen({ side }: { side: 'receivable' | 'payable' }) {
  const navigate = useNavigate()
  const { scope } = useBilling()
  const [view, setView] = useState<'parties' | 'bills'>('parties')

  const { data, loading, error, reload } = useApi(
    (signal) => api.one<DuesShape>(side === 'receivable' ? 'v1/receivables' : 'v1/payables', undefined, signal),
    [scope?.cmp_id, scope?.fy_id, side],
    Boolean(scope),
  )

  if (error) {
    return (
      <Notice tone="danger" title="Could not work that out">
        {error} <button onClick={reload}>Retry</button>
      </Notice>
    )
  }

  const dues = data?.data

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <h1 style={{ margin: 0, fontSize: '1.3rem' }}>{dues?.title ?? (side === 'receivable' ? 'Money to collect' : 'Money to pay')}</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.75rem' }}>
        <StatCard label="Total" value={loading ? '…' : money(dues?.total)} />
        <StatCard label="Overdue" value={loading ? '…' : money(dues?.overdue)} tone={(dues?.overdue ?? 0) > 0 ? 'danger' : 'default'} />
        <StatCard label="Due today" value={loading ? '…' : money(dues?.due_today)} />
        <StatCard label="Due this week" value={loading ? '…' : money(dues?.due_this_week)} />
      </div>

      <Card title="How old it is">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))', gap: '0.5rem' }}>
          {([
            ['current', 'Not yet due'],
            ['1_30', '1–30 days'],
            ['31_60', '31–60 days'],
            ['61_90', '61–90 days'],
            ['90_plus', 'Over 90 days'],
          ] as const).map(([key, label]) => {
            const amount = dues?.ageing[key] ?? 0
            const alarming = key === '61_90' || key === '90_plus'
            return (
              <div key={key} style={{ padding: '0.6rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{label}</div>
                <div className="num" style={{ fontWeight: 600, textAlign: 'left', color: alarming && amount > 0 ? 'var(--danger)' : undefined }}>
                  {money(amount)}
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      <Card
        title={view === 'parties' ? 'By party' : 'Bill by bill'}
        action={
          <button
            type="button"
            onClick={() => setView(view === 'parties' ? 'bills' : 'parties')}
            style={{ background: 'none', border: 'none', color: 'var(--link)', cursor: 'pointer' }}
          >
            {view === 'parties' ? 'Show every bill' : 'Group by party'}
          </button>
        }
      >
        {view === 'parties' ? (
          <DataTable
            loading={loading}
            rows={dues?.parties ?? []}
            rowKey={(row) => row.account_id}
            onRowClick={(row) => navigate(`/parties/${row.account_id}`)}
            empty={side === 'receivable' ? 'Nobody owes you anything.' : 'You owe nothing.'}
            columns={[
              {
                key: 'name',
                header: 'Party',
                render: (row) => (
                  <Link to={`/parties/${row.account_id}`} onClick={(e) => e.stopPropagation()}>{row.account_name}</Link>
                ),
              },
              { key: 'bills', header: 'Bills', numeric: true, render: (row) => row.bill_count },
              { key: 'total', header: 'Total', numeric: true, render: (row) => money(row.total) },
              {
                key: 'overdue',
                header: 'Overdue',
                numeric: true,
                render: (row) => (
                  <span style={{ color: row.overdue > 0 ? 'var(--danger)' : undefined }}>{money(row.overdue)}</span>
                ),
              },
              {
                key: 'age',
                header: 'Oldest',
                numeric: true,
                render: (row) => (row.oldest_overdue_days > 0 ? `${row.oldest_overdue_days} days` : '—'),
              },
            ]}
          />
        ) : (
          <DataTable
            loading={loading}
            rows={dues?.bills ?? []}
            rowKey={(row) => `${row.account_id}-${row.bill_no ?? row.voucher_id}`}
            empty="Nothing outstanding."
            columns={[
              { key: 'party', header: 'Party', render: (row) => row.account_name },
              { key: 'bill', header: 'Bill', render: (row) => row.bill_no ?? '—' },
              { key: 'date', header: 'Dated', render: (row) => date(row.bill_date) },
              { key: 'due', header: 'Due', render: (row) => date(row.due_date) },
              {
                key: 'age',
                header: 'Overdue by',
                numeric: true,
                render: (row) => (
                  <span style={{ color: row.days_overdue > 0 ? 'var(--danger)' : undefined }}>
                    {row.days_overdue > 0 ? `${row.days_overdue} days` : '—'}
                  </span>
                ),
              },
              { key: 'balance', header: 'Balance', numeric: true, render: (row) => money(row.balance) },
            ]}
          />
        )}
      </Card>

      {dues && <p style={{ color: 'var(--muted)', fontSize: '0.78rem', margin: 0 }}>{dues.note}</p>}
    </div>
  )
}

interface StatementResponse {
  account_id: number
  source: string
  statement: Record<string, unknown> | Array<Record<string, unknown>>
  note: string
}

export function PartyStatement() {
  const { accountId } = useParams<{ accountId: string }>()
  const { scope } = useBilling()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const { data, loading, error } = useApi(
    (signal) => api.one<StatementResponse>(`v1/parties/${accountId}/statement`, { from: from || undefined, to: to || undefined }, signal),
    [accountId, scope?.cmp_id, from, to],
    Boolean(scope && accountId),
  )

  const statement = data?.data.statement
  const rows: Array<Record<string, unknown>> = Array.isArray(statement)
    ? statement
    : Array.isArray((statement as Record<string, unknown>)?.rows)
      ? ((statement as Record<string, unknown>).rows as Array<Record<string, unknown>>)
      : []

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div>
        <Link to="/receivables" style={{ fontSize: '0.85rem' }}>← Back</Link>
        <h1 style={{ margin: '0.25rem 0 0', fontSize: '1.3rem' }}>Party statement</h1>
      </div>

      {error && <Notice tone="danger" title="Could not load the statement">{error}</Notice>}

      <Card
        action={
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ padding: '0.3rem' }} />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ padding: '0.3rem' }} />
          </div>
        }
      >
        <DataTable
          loading={loading}
          rows={rows}
          rowKey={(row) => String(row.voucher_id ?? row.id ?? JSON.stringify(row).slice(0, 24))}
          empty="Nothing in this period."
          columns={[
            { key: 'date', header: 'Date', render: (row) => date(String(row.date ?? row.voucher_date ?? '')) },
            { key: 'kind', header: 'What', render: (row) => String(row.voucher_type ?? row.type ?? '—') },
            { key: 'ref', header: 'Reference', render: (row) => String(row.voucher_no ?? row.reference_no ?? '—') },
            { key: 'debit', header: 'Debit', numeric: true, render: (row) => (row.debit ? money(Number(row.debit)) : '—') },
            { key: 'credit', header: 'Credit', numeric: true, render: (row) => (row.credit ? money(Number(row.credit)) : '—') },
            { key: 'balance', header: 'Balance', numeric: true, render: (row) => (row.balance !== undefined ? money(Number(row.balance)) : '—') },
          ]}
        />
        {data && <p style={{ color: 'var(--muted)', fontSize: '0.78rem', marginTop: '0.75rem', marginBottom: 0 }}>{data.data.note}</p>}
      </Card>
    </div>
  )
}
