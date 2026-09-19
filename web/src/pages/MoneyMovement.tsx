import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../services/api'
import type { CashBankAccount, CatalogParty, TransactionRequest } from '../services/types'
import { useApi } from '../hooks/useApi'
import { useBilling } from '../context/BillingContext'
import { PartyPicker } from '../components/LivePicker'
import { Button, Card, DataTable, date, Field, Input, money, Notice, Select } from '../ui'

interface OpenBill {
  bill_no: string | null
  bill_date: string | null
  due_date: string | null
  balance: number
  voucher_id: number | null
  voucher_uuid: string | null
}

/**
 * Money received and money paid.
 *
 * The user sees "Money received"; internally it is a receipt voucher, and the
 * word "voucher" never appears on screen. The open bills come from Books when a
 * party is chosen — allocating against a bill somebody settled this morning is
 * exactly what a stored receivable would let you do.
 */
export function MoneyScreen({ direction }: { direction: 'in' | 'out' }) {
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const { scope } = useBilling()
  const isIn = direction === 'in'

  /**
   * Money to Collect links here with the party and the amount already known.
   *
   * Only the FORM is filled in. The open bills are still read from Books when
   * the party lands, and the allocation is still worked out from those — a
   * bill somebody settled this morning must not be allocated against because a
   * link made twenty minutes ago said it was open.
   */
  const [party, setParty] = useState<{ id: number; name: string } | null>(() => {
    const id = Number(search.get('account_id'))
    const name = search.get('account_name')
    return Number.isFinite(id) && id > 0 && name ? { id, name } : null
  })
  const [amount, setAmount] = useState(() => {
    const raw = Number(search.get('amount'))
    return Number.isFinite(raw) && raw > 0 ? raw.toFixed(2) : ''
  })
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [account, setAccount] = useState('')
  const [mode, setMode] = useState('cash')
  const [reference, setReference] = useState('')
  const [allocations, setAllocations] = useState<Record<string, string>>({})
  const [autoAllocate, setAutoAllocate] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryId, setRetryId] = useState<number | null>(null)

  const cashBank = useApi(
    (signal) => api.list<CashBankAccount>('v1/catalog/cash-bank', undefined, signal),
    [scope?.cmp_id],
    Boolean(scope),
  )

  const openBills = useApi(
    (signal) =>
      api.one<{ account_id: number; bills: OpenBill[]; source: string }>(
        'v1/open-bills',
        { account_id: party?.id, side: isIn ? 'receivable' : 'payable' },
        signal,
      ),
    [party?.id, scope?.cmp_id, direction],
    Boolean(scope && party),
  )

  useEffect(() => {
    if (account === '' && (cashBank.data?.data.length ?? 0) > 0) {
      setAccount(String(cashBank.data!.data[0].acc_id))
    }
  }, [account, cashBank.data])

  const bills = openBills.data?.data.bills ?? []

  /** Oldest bill first, until the money runs out — what most people do by hand. */
  function allocateAutomatically(total: number): Record<string, string> {
    let left = total
    const next: Record<string, string> = {}
    for (const bill of [...bills].sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))) {
      if (left <= 0) break
      const key = String(bill.voucher_id ?? bill.bill_no)
      const applied = Math.min(left, bill.balance)
      next[key] = applied.toFixed(2)
      left -= applied
    }
    return next
  }

  const effectiveAllocations = autoAllocate ? allocateAutomatically(Number(amount || 0)) : allocations
  const allocatedTotal = Object.values(effectiveAllocations).reduce((sum, value) => sum + Number(value || 0), 0)
  const onAccount = Number(amount || 0) - allocatedTotal

  async function save() {
    if (!party) {
      setError(isIn ? 'Who did the money come from?' : 'Who was the money paid to?')
      return
    }
    if (Number(amount || 0) <= 0) {
      setError('Enter the amount.')
      return
    }

    setSaving(true)
    setError(null)
    setRetryId(null)

    try {
      const response = await api.post<TransactionRequest>(`v1/transactions/${isIn ? 'receipt' : 'payment'}`, {
        party_account_id: party.id,
        amount: Number(amount),
        date: entryDate,
        cash_bank_account_id: Number(account),
        payment_mode: mode,
        instrument_no: reference || undefined,
        allocations: Object.entries(effectiveAllocations)
          .filter(([, value]) => Number(value || 0) > 0)
          .map(([key, value]) => {
            const bill = bills.find((b) => String(b.voucher_id ?? b.bill_no) === key)
            return { voucher_id: bill?.voucher_id, bill_no: bill?.bill_no, amount: Number(value) }
          }),
      })
      navigate(`/${isIn ? 'money-in' : 'money-out'}/${response.data.request_id}`)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
        const id = err.details.request_id
        if (err.retryable && typeof id === 'number') setRetryId(id)
      } else {
        setError(String(err))
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1rem', maxWidth: '52rem' }}>
      <h1 style={{ margin: 0, fontSize: '1.3rem' }}>{isIn ? 'Money received' : 'Money paid'}</h1>

      {error && (
        <Notice
          tone="danger"
          title="Could not save"
          action={
            retryId !== null ? (
              <Button
                disabled={saving}
                onClick={async () => {
                  setSaving(true)
                  try {
                    const response = await api.post<TransactionRequest>(`v1/transactions/${retryId}/retry`, {})
                    navigate(`/${isIn ? 'money-in' : 'money-out'}/${response.data.request_id}`)
                  } catch (err) {
                    setError(err instanceof ApiError ? err.message : String(err))
                  } finally {
                    setSaving(false)
                  }
                }}
              >
                Retry
              </Button>
            ) : undefined
          }
        >
          {error}
        </Notice>
      )}

      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: '0.85rem' }}>
          <PartyPicker
            side={isIn ? 'customer' : 'supplier'}
            selectedLabel={party?.name}
            autoFocus
            onPick={(picked: CatalogParty) => setParty({ id: picked.acc_id, name: picked.acc_name })}
          />
          <Field label="Amount">
            <Input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} style={{ textAlign: 'right', fontSize: '1.15rem' }} />
          </Field>
          <Field label="Date"><Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></Field>
          <Field label={isIn ? 'Received in' : 'Paid from'}>
            <Select value={account} onChange={(e) => setAccount(e.target.value)}>
              {(cashBank.data?.data ?? []).map((row) => (
                <option key={row.acc_id} value={row.acc_id}>{row.acc_name}</option>
              ))}
            </Select>
          </Field>
          <Field label="How">
            <Select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="cheque">Cheque</option>
              <option value="card">Card</option>
            </Select>
          </Field>
          <Field label="Reference" hint="UPI reference, cheque number…">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>
      </Card>

      {party && (
        <Card
          title={isIn ? 'Which bills is this against?' : 'Which bills is this against?'}
          action={
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={autoAllocate} onChange={(e) => setAutoAllocate(e.target.checked)} />
              Oldest first
            </label>
          }
        >
          <DataTable
            loading={openBills.loading}
            rows={bills}
            rowKey={(bill) => String(bill.voucher_id ?? bill.bill_no)}
            empty="Nothing outstanding — this will sit on account."
            columns={[
              { key: 'bill', header: 'Bill', render: (bill) => bill.bill_no ?? '—' },
              { key: 'date', header: 'Dated', render: (bill) => date(bill.bill_date) },
              { key: 'due', header: 'Due', render: (bill) => date(bill.due_date) },
              { key: 'balance', header: 'Outstanding', numeric: true, render: (bill) => money(bill.balance) },
              {
                key: 'apply',
                header: 'Applying',
                numeric: true,
                render: (bill) => {
                  const key = String(bill.voucher_id ?? bill.bill_no)
                  return (
                    <Input
                      value={effectiveAllocations[key] ?? ''}
                      inputMode="decimal"
                      disabled={autoAllocate}
                      onChange={(e) => setAllocations({ ...allocations, [key]: e.target.value })}
                      style={{ width: '7rem', textAlign: 'right' }}
                    />
                  )
                },
              },
            ]}
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1.5rem', marginTop: '0.85rem' }}>
            <span style={{ color: 'var(--muted)' }}>Applied</span>
            <span className="num">{money(allocatedTotal)}</span>
            <span style={{ color: 'var(--muted)' }}>On account</span>
            <span className="num" style={{ color: onAccount < 0 ? 'var(--danger)' : undefined }}>{money(onAccount)}</span>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: '0.78rem', marginTop: '0.4rem', marginBottom: 0, textAlign: 'right' }}>
            Open bills come from Smart Books each time you pick a party.
          </p>
        </Card>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <Button onClick={() => navigate(-1)}>Cancel</Button>
        <Button tone="primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </div>
  )
}

/**
 * Bank deposit, withdrawal and transfer.
 *
 * All three are a contra voucher in Books. The user never sees that word; they
 * see "money moved from here to there", which is what happened.
 */
export function BankCash({ kind }: { kind: 'bank_deposit' | 'bank_withdrawal' | 'bank_transfer' }) {
  const navigate = useNavigate()
  const { scope } = useBilling()
  const [amount, setAmount] = useState('')
  const [fromAccount, setFromAccount] = useState('')
  const [toAccount, setToAccount] = useState('')
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [reference, setReference] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const accounts = useApi(
    (signal) => api.list<CashBankAccount>('v1/catalog/cash-bank', undefined, signal),
    [scope?.cmp_id],
    Boolean(scope),
  )

  const title = { bank_deposit: 'Bank deposit', bank_withdrawal: 'Bank withdrawal', bank_transfer: 'Bank transfer' }[kind]
  const fromLabel = { bank_deposit: 'Cash taken from', bank_withdrawal: 'Bank taken from', bank_transfer: 'From account' }[kind]
  const toLabel = { bank_deposit: 'Paid into bank', bank_withdrawal: 'Into cash account', bank_transfer: 'To account' }[kind]

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await api.post<TransactionRequest>(`v1/transactions/${kind}`, {
        amount: Number(amount || 0),
        from_account_id: Number(fromAccount),
        to_account_id: Number(toAccount),
        date: entryDate,
        instrument_no: reference || undefined,
      })
      navigate('/bank-cash')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1rem', maxWidth: '38rem' }}>
      <h1 style={{ margin: 0, fontSize: '1.3rem' }}>{title}</h1>

      {error && <Notice tone="danger" title="Could not save">{error}</Notice>}

      <Card>
        <div style={{ display: 'grid', gap: '0.85rem' }}>
          <Field label="Amount">
            <Input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} style={{ textAlign: 'right', fontSize: '1.15rem' }} autoFocus />
          </Field>
          <Field label={fromLabel}>
            <Select value={fromAccount} onChange={(e) => setFromAccount(e.target.value)}>
              <option value="">Choose…</option>
              {(accounts.data?.data ?? []).map((row) => (
                <option key={row.acc_id} value={row.acc_id}>{row.acc_name}</option>
              ))}
            </Select>
          </Field>
          <Field label={toLabel}>
            <Select value={toAccount} onChange={(e) => setToAccount(e.target.value)}>
              <option value="">Choose…</option>
              {(accounts.data?.data ?? []).map((row) => (
                <option key={row.acc_id} value={row.acc_id}>{row.acc_name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Date"><Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></Field>
          <Field label="Reference" hint="Slip number, cheque number…">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        </div>
      </Card>

      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <Button onClick={() => navigate(-1)}>Cancel</Button>
        <Button tone="primary" disabled={saving || !fromAccount || !toAccount} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
