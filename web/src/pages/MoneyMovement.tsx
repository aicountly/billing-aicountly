import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../services/api'
import type { CashBankAccount, TransactionRequest } from '../services/types'
import { useApi } from '../hooks/useApi'
import { useBilling } from '../context/BillingContext'
import { Button, Card, Field, Input, Notice, Select } from '../ui'

/**
 * Money received and money paid now live in `pages/money/`, which is the whole
 * screen rather than one component: the form, the period's totals, the party's
 * history and the recent list.
 *
 * They are NOT re-exported from here. This module is imported eagerly for
 * `BankCash`, and a re-export would drag that whole screen back into the main
 * bundle and undo the split the router asks for.
 */

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
