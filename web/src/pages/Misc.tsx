import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../services/api'
import type { BillingProfile, CashBank, RecurringRule, StatutoryStatus, TransactionRequest } from '../services/types'
import { useApi } from '../hooks/useApi'
import { useBilling } from '../context/BillingContext'
import { CommandStrip } from '../components/CommandStrip'
import { Button, Card, DataTable, date, Field, Input, money, Notice, StatCard, StatusBadge } from '../ui'

/**
 * The screen a user lands on after saving, and where the statutory buttons live.
 */
export function TransactionDetail() {
  const { id } = useParams<{ id: string }>()
  const { scope, can } = useBilling()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [vehicle, setVehicle] = useState('')
  const [showEway, setShowEway] = useState(false)

  const { data, loading, reload } = useApi(
    (signal) => api.one<TransactionRequest>(`v1/transactions/${id}`, undefined, signal),
    [id, scope?.cmp_id],
    Boolean(scope && id),
  )

  const request = data?.data

  const statutory = useApi(
    (signal) => api.one<StatutoryStatus>(`v1/transactions/${id}/statutory`, undefined, signal),
    [id, scope?.cmp_id, request?.books_voucher_id],
    Boolean(scope && id && request?.books_voucher_id),
  )

  async function generate(what: 'einvoice' | 'eway' | 'both', body: Record<string, unknown> = {}) {
    setBusy(true)
    setError(null)
    try {
      await api.post(`v1/transactions/${id}/statutory/${what}`, body)
      statutory.reload()
      setShowEway(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p style={{ color: 'var(--muted)' }}>Loading…</p>
  if (!request) return <Notice tone="warning">That entry does not exist.</Notice>

  const eInvoice = statutory.data?.data.e_invoice as Record<string, unknown> | null
  const eWay = statutory.data?.data.e_way_bill as Record<string, unknown> | null
  const isSale = request.kind === 'sale'

  return (
    <div style={{ display: 'grid', gap: '1rem', maxWidth: '48rem' }}>
      <div>
        <Link to="/" style={{ fontSize: '0.85rem' }}>← Home</Link>
        <h1 style={{ margin: '0.25rem 0 0', fontSize: '1.3rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {request.books_voucher_no ?? capitalise(request.kind)}
          <StatusBadge status={request.status} />
        </h1>
        <p style={{ margin: '0.3rem 0 0', color: 'var(--muted)' }}>{date(request.transaction_date)}</p>
      </div>

      {error && <Notice tone="danger" title="That did not work">{error}</Notice>}

      {request.status === 'FAILED' && (
        <Notice
          tone="danger"
          title="This has not reached Smart Books"
          action={
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await api.post(`v1/transactions/${id}/retry`, {})
                  reload()
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : String(err))
                } finally {
                  setBusy(false)
                }
              }}
            >
              Retry
            </Button>
          }
        >
          {request.last_error ?? 'It can be retried safely — nothing has been duplicated.'}
        </Notice>
      )}

      <CommandStrip commands={request.commands ?? []} busy={busy} />

      <Card title="Where it lives">
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.4rem 1rem', margin: 0 }}>
          <dt style={{ color: 'var(--muted)' }}>In Smart Books</dt>
          <dd style={{ margin: 0 }}>{request.books_voucher_no ?? 'Not saved yet'}</dd>
          <dt style={{ color: 'var(--muted)' }}>Type</dt>
          <dd style={{ margin: 0 }}>{capitalise(request.kind)}</dd>
        </dl>
        <p style={{ color: 'var(--muted)', fontSize: '0.78rem', marginTop: '0.75rem', marginBottom: 0 }}>
          The invoice, its tax and the party balance all live in Smart Books. Billing keeps this reference so you can
          find it.
        </p>
      </Card>

      {isSale && request.books_voucher_id && (can('einvoice.generate') || can('eway.generate')) && (
        <Card title="e-Invoice and e-Way Bill">
          {!statutory.data?.data.reachable && (
            <Notice tone="warning">Smart Books did not answer, so the current status is unknown.</Notice>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))', gap: '0.75rem' }}>
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.7rem' }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>e-Invoice</div>
              <div style={{ fontWeight: 600 }}>{String(eInvoice?.status ?? 'Not generated')}</div>
              {eInvoice?.irn !== undefined && (
                <div style={{ fontSize: '0.78rem', wordBreak: 'break-all', marginTop: '0.2rem' }}>IRN {String(eInvoice.irn)}</div>
              )}
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '0.7rem' }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>e-Way Bill</div>
              <div style={{ fontWeight: 600 }}>{String(eWay?.status ?? 'Not generated')}</div>
              {eWay?.eway_bill_no !== undefined && (
                <div style={{ fontSize: '0.78rem', marginTop: '0.2rem' }}>No. {String(eWay.eway_bill_no)}</div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.85rem' }}>
            {can('einvoice.generate') && !eInvoice?.irn && (
              <Button tone="primary" disabled={busy} onClick={() => generate('einvoice')}>Generate e-Invoice</Button>
            )}
            {can('eway.generate') && !eWay?.eway_bill_no && (
              <Button disabled={busy} onClick={() => setShowEway(true)}>Generate e-Way Bill</Button>
            )}
            {can('einvoice.generate') && can('eway.generate') && !eInvoice?.irn && !eWay?.eway_bill_no && (
              <Button disabled={busy} onClick={() => setShowEway(true)}>Generate both</Button>
            )}
          </div>

          {showEway && (
            <div style={{ display: 'grid', gap: '0.6rem', marginTop: '0.85rem', borderTop: '1px solid var(--border)', paddingTop: '0.85rem' }}>
              <Field label="Vehicle number" hint="Or a transporter ID — the portal needs one of them for road transport.">
                <Input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="KA01AB1234" />
              </Field>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <Button onClick={() => setShowEway(false)}>Cancel</Button>
                <Button
                  tone="primary"
                  disabled={busy}
                  onClick={() => generate(eInvoice?.irn ? 'eway' : 'both', { vehicle_no: vehicle, transport_mode: 'road' })}
                >
                  {eInvoice?.irn ? 'Generate e-Way Bill' : 'Generate both'}
                </Button>
              </div>
            </div>
          )}

          <p style={{ color: 'var(--muted)', fontSize: '0.78rem', marginTop: '0.85rem', marginBottom: 0 }}>
            Smart Books talks to the government portal, holds the credentials and keeps the IRN. Billing only asks.
          </p>
        </Card>
      )}
    </div>
  )
}

/** Entries that never reached Books, with a Retry each. Replaces a reconciliation job. */
export function Unfinished() {
  const { scope } = useBilling()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data, loading, reload } = useApi(
    (signal) => api.get<{ data: TransactionRequest[] }>('v1/transactions/unfinished', undefined, signal),
    [scope?.cmp_id],
    Boolean(scope),
  )

  async function retry(id: number) {
    setBusy(true)
    setError(null)
    try {
      await api.post(`v1/transactions/${id}/retry`, {})
      reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <h1 style={{ margin: 0, fontSize: '1.3rem' }}>Not saved yet</h1>

      <Notice tone="info">
        These have not reached Smart Books. Retrying uses the same key as the first attempt, so a retry can never make a
        second invoice — which is why nothing is retried behind your back.
      </Notice>

      {error && <Notice tone="danger" title="That did not work">{error}</Notice>}

      <Card>
        <DataTable
          loading={loading}
          rows={data?.data ?? []}
          rowKey={(row) => row.request_id}
          empty="Everything has saved."
          columns={[
            { key: 'kind', header: 'What', render: (row) => capitalise(row.kind) },
            { key: 'date', header: 'Dated', render: (row) => date(row.transaction_date) },
            { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
            { key: 'error', header: 'Why', render: (row) => row.last_error ?? '—' },
            {
              key: 'actions',
              header: '',
              render: (row) => <Button disabled={busy} onClick={() => retry(row.request_id)}>Retry</Button>,
            },
          ]}
        />
      </Card>
    </div>
  )
}

export function BankCashOverview() {
  const { scope } = useBilling()
  const navigate = useNavigate()

  const { data, loading } = useApi(
    (signal) => api.one<CashBank>('v1/cash-bank', undefined, signal),
    [scope?.cmp_id],
    Boolean(scope),
  )

  const cashBank = data?.data

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <h1 style={{ margin: 0, fontSize: '1.3rem' }}>Bank &amp; cash</h1>

      {!loading && cashBank && !cashBank.available && (
        <Notice tone="info">{cashBank.reason ?? 'Balances are not shown with your Billing profile.'}</Notice>
      )}

      {cashBank?.available && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.75rem' }}>
            {cashBank.cash !== null && cashBank.cash !== undefined && <StatCard label="Cash in hand" value={money(cashBank.cash)} />}
            {cashBank.bank !== null && cashBank.bank !== undefined && <StatCard label="In the bank" value={money(cashBank.bank)} />}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Button tone="primary" onClick={() => navigate('/bank-cash/deposit')}>Deposit cash</Button>
            <Button onClick={() => navigate('/bank-cash/withdrawal')}>Withdraw cash</Button>
            <Button onClick={() => navigate('/bank-cash/transfer')}>Transfer between banks</Button>
          </div>

          <Card title="Accounts">
            <DataTable
              rows={cashBank.accounts ?? []}
              rowKey={(row) => row.account_id}
              empty="No cash or bank accounts."
              columns={[
                { key: 'name', header: 'Account', render: (row) => row.account_name },
                { key: 'kind', header: 'Kind', render: (row) => (row.kind === 'cash' ? 'Cash' : 'Bank') },
                { key: 'balance', header: 'Balance', numeric: true, render: (row) => money(row.balance) },
              ]}
            />
            <p style={{ color: 'var(--muted)', fontSize: '0.78rem', marginTop: '0.6rem', marginBottom: 0 }}>
              Balances come from Smart Books as this page loads.
            </p>
          </Card>
        </>
      )}
    </div>
  )
}

export function Recurring() {
  const { scope, can } = useBilling()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data, loading, reload } = useApi(
    (signal) => api.get<{ data: RecurringRule[] }>('v1/recurring', undefined, signal),
    [scope?.cmp_id],
    Boolean(scope),
  )

  async function run(ruleId: number) {
    setBusy(true)
    setError(null)
    try {
      await api.post(`v1/recurring/${ruleId}/run`, {})
      reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <h1 style={{ margin: 0, fontSize: '1.3rem' }}>Recurring bills</h1>

      <Notice tone="info">
        A recurring bill is a rule. When its date comes round it raises a real invoice in Smart Books — Billing never
        makes an invoice of its own and pushes it later.
      </Notice>

      {error && <Notice tone="danger" title="That did not work">{error}</Notice>}

      <Card>
        <DataTable
          loading={loading}
          rows={data?.data ?? []}
          rowKey={(row) => row.rule_id}
          empty="No recurring bills set up."
          columns={[
            { key: 'name', header: 'What', render: (row) => row.rule_name },
            { key: 'customer', header: 'Customer', render: (row) => `Account ${row.customer_account_id}` },
            { key: 'frequency', header: 'How often', render: (row) => row.frequency.replace(/_/g, ' ') },
            {
              key: 'next',
              header: 'Next',
              render: (row) => (
                <span style={{ color: row.next_run_date <= today && row.status === 'ACTIVE' ? 'var(--warning)' : undefined }}>
                  {date(row.next_run_date)}
                </span>
              ),
            },
            { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status === 'ACTIVE' ? 'APPROVED' : row.status === 'PAUSED' ? 'PENDING' : 'CLOSED'} /> },
            {
              key: 'actions',
              header: '',
              render: (row) =>
                row.status === 'ACTIVE' && row.next_run_date <= today && can('sale.create') ? (
                  <Button tone="primary" disabled={busy} onClick={() => run(row.rule_id)}>Raise it</Button>
                ) : null,
            },
          ]}
        />
      </Card>
    </div>
  )
}

export function Profiles() {
  const { scope, can } = useBilling()

  const { data, loading } = useApi(
    (signal) => api.one<{ profiles: BillingProfile[]; catalog: Record<string, Record<string, string>> }>('v1/profiles', undefined, signal),
    [scope?.cmp_id],
    Boolean(scope),
  )

  if (!can('access.manage')) {
    return <Notice tone="info">Managing Billing profiles is not part of your profile.</Notice>
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <h1 style={{ margin: 0, fontSize: '1.3rem' }}>Who can do what</h1>

      <Notice tone="info">
        A Billing profile decides what someone sees and does <em>in this app</em>. Smart Books has its own permissions for
        its own screens — giving somebody a Biller profile here does not give them the run of Books.
      </Notice>

      <Card>
        <DataTable
          loading={loading}
          rows={data?.data.profiles ?? []}
          rowKey={(row) => row.profile_id}
          empty="No profiles yet."
          columns={[
            { key: 'name', header: 'Profile', render: (row) => row.profile_name },
            { key: 'what', header: 'What it is for', render: (row) => row.description ?? '—' },
            {
              key: 'count',
              header: 'Permissions',
              numeric: true,
              render: (row) => (Array.isArray(row.permissions) ? row.permissions.length : 0),
            },
            { key: 'members', header: 'People', numeric: true, render: (row) => row.member_count ?? '0' },
            { key: 'system', header: '', render: (row) => (row.is_system ? <StatusBadge status="APPROVED" /> : null) },
          ]}
        />
      </Card>

      <Card title="What the counter profile deliberately does not include">
        <p style={{ margin: 0 }}>
          A <strong>Biller</strong> can make bills, take money and generate an e-Invoice. They cannot see purchase cost,
          profit, payables or the bank — and those checks run in the backend, so they hold whether the buttons are on
          screen or not.
        </p>
      </Card>
    </div>
  )
}

function capitalise(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1).replace(/_/g, ' ')
}
