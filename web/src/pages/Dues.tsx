import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../services/api'
import { useApi } from '../hooks/useApi'
import { useBilling } from '../context/BillingContext'
import { Card, DataTable, date, money, Notice } from '../ui'

/**
 * A party statement.
 *
 * Money to collect and money to pay used to live here too. They moved to
 * `../receivables`, where the ageing, the status rules and the charts are, and
 * App.tsx loads that screen on demand the way it loads the dashboards — this
 * file is imported eagerly, so a re-export here would have pulled the charts
 * into the main bundle for every user who never opens it.
 */

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
