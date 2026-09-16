import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { api, ApiError } from '../services/api'
import type { CashBankAccount, CatalogItem, CatalogParty, TransactionRequest } from '../services/types'
import { useApi } from '../hooks/useApi'
import { useBilling } from '../context/BillingContext'
import { ItemPicker, PartyPicker } from '../components/LivePicker'
import { Button, Card, Field, Input, money, Notice, Select } from '../ui'

interface DraftLine {
  key: string
  item_id: number | null
  label: string
  unit_id: number | null
  description: string
  qty: string
  rate: string
  /** Set when the user edits a rate the item came with — the backend checks the permission. */
  rate_was_changed: boolean
  discount_pc: string
}

function emptyLine(): DraftLine {
  return {
    key: Math.random().toString(36).slice(2),
    item_id: null,
    label: '',
    unit_id: null,
    description: '',
    qty: '1',
    rate: '0',
    rate_was_changed: false,
    discount_pc: '0',
  }
}

/**
 * Fast billing.
 *
 * The screen a shopkeeper spends their day on, so it is built for speed: search
 * or scan an item, quantity defaults to 1, Enter moves on, and the running total
 * is always visible. A discount field only appears for somebody allowed to give
 * one — and the backend checks that again, because the field appearing is a
 * courtesy and not a control.
 *
 * NO TAX IS CALCULATED HERE. The total shown is before tax and says so; Smart
 * Books works out the GST and prints the invoice. A second tax engine in a
 * product aimed at people who do not want to learn accounting is the worst
 * possible place for one.
 */
export default function SaleEditor({ kind = 'sale' }: { kind?: 'sale' | 'purchase' }) {
  const navigate = useNavigate()
  const { can, scope } = useBilling()
  const isPurchase = kind === 'purchase'

  const [party, setParty] = useState<{ id: number; name: string } | null>(null)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()])
  const [settleNow, setSettleNow] = useState(false)
  const [settleAccount, setSettleAccount] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryId, setRetryId] = useState<number | null>(null)

  const mayDiscount = can('discount.override')

  const favourites = useApi(
    (signal) => api.get<{ data: CatalogItem[] }>('v1/catalog/items/favourites', undefined, signal),
    [scope?.cmp_id],
    Boolean(scope),
  )

  const cashBank = useApi(
    (signal) => api.list<CashBankAccount>('v1/catalog/cash-bank', undefined, signal),
    [scope?.cmp_id],
    Boolean(scope),
  )

  useEffect(() => {
    if (settleNow && settleAccount === '' && (cashBank.data?.data.length ?? 0) > 0) {
      setSettleAccount(String(cashBank.data!.data[0].acc_id))
    }
  }, [settleNow, settleAccount, cashBank.data])

  function patchLine(key: string, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  function addItem(item: CatalogItem, key?: string) {
    const target = key ?? lines.find((line) => line.item_id === null)?.key
    const patch: Partial<DraftLine> = {
      item_id: item.item_id,
      label: item.item_name,
      unit_id: item.unit_id,
      description: item.item_name,
      rate: item.mrp ?? '0',
      rate_was_changed: false,
    }

    if (target) {
      patchLine(target, patch)
    } else {
      setLines((current) => [...current, { ...emptyLine(), ...patch } as DraftLine])
    }
    // Always leave one blank line ready, so the next item needs no extra tap.
    setLines((current) => (current.some((line) => line.item_id === null) ? current : [...current, emptyLine()]))
  }

  const subtotal = lines.reduce((sum, line) => {
    const gross = Number(line.qty || 0) * Number(line.rate || 0)
    return sum + gross - (gross * Number(line.discount_pc || 0)) / 100
  }, 0)

  async function save(andNew: boolean) {
    if (!party) {
      setError(isPurchase ? 'Choose the supplier first.' : 'Choose the customer first.')
      return
    }
    const usable = lines.filter((line) => line.item_id !== null || line.description.trim() !== '')
    if (usable.length === 0) {
      setError('Add at least one item.')
      return
    }

    setSaving(true)
    setError(null)
    setRetryId(null)

    try {
      const response = await api.post<TransactionRequest>(`v1/transactions/${kind}`, {
        party_account_id: party.id,
        date,
        narration: notes || undefined,
        supplier_invoice_no: isPurchase ? supplierInvoiceNo || undefined : undefined,
        settled_to_account_id: settleNow && settleAccount ? Number(settleAccount) : undefined,
        lines: usable.map((line) => ({
          item_id: line.item_id,
          unit_id: line.unit_id,
          description: line.description || undefined,
          qty: Number(line.qty || 0),
          rate: Number(line.rate || 0),
          discount_pc: Number(line.discount_pc || 0),
          rate_was_changed: line.rate_was_changed,
        })),
      })

      if (andNew) {
        setParty(null)
        setLines([emptyLine()])
        setNotes('')
        setSupplierInvoiceNo('')
        setError(null)
        favourites.reload()
      } else {
        navigate(`/${isPurchase ? 'purchases' : 'sales'}/${response.data.request_id}`)
      }
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

  async function retry() {
    if (retryId === null) return
    setSaving(true)
    setError(null)
    try {
      const response = await api.post<TransactionRequest>(`v1/transactions/${retryId}/retry`, {})
      navigate(`/${isPurchase ? 'purchases' : 'sales'}/${response.data.request_id}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1rem', maxWidth: '58rem' }}>
      <h1 style={{ margin: 0, fontSize: '1.3rem' }}>{isPurchase ? 'Record a purchase' : 'New bill'}</h1>

      {error && (
        <Notice
          tone="danger"
          title="Could not save"
          action={retryId !== null ? <Button onClick={retry} disabled={saving}>Retry</Button> : undefined}
        >
          {error}
        </Notice>
      )}

      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))', gap: '0.85rem' }}>
          <PartyPicker
            side={isPurchase ? 'supplier' : 'customer'}
            selectedLabel={party?.name}
            autoFocus
            onPick={(picked: CatalogParty) => setParty({ id: picked.acc_id, name: picked.acc_name })}
          />
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          {isPurchase && (
            <Field label="Supplier invoice number">
              <Input value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} />
            </Field>
          )}
        </div>
      </Card>

      {!isPurchase && (favourites.data?.data.length ?? 0) > 0 && (
        <Card title="Your usual items">
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {(favourites.data?.data ?? []).slice(0, 12).map((item) => (
              <button
                key={item.item_id}
                type="button"
                onClick={() => addItem(item)}
                style={{
                  padding: '0.4rem 0.7rem',
                  borderRadius: '999px',
                  border: '1px solid var(--border-strong)',
                  background: 'var(--surface)',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                {item.item_name}
              </button>
            ))}
          </div>
          <p style={{ color: 'var(--muted)', fontSize: '0.78rem', marginTop: '0.6rem', marginBottom: 0 }}>
            Billing remembers which item ids you bill most. The names and rates come from Inventory each time.
          </p>
        </Card>
      )}

      <Card title="Items" action={<Button onClick={() => setLines((c) => [...c, emptyLine()])}>Add line</Button>}>
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          {lines.map((line) => (
            <div
              key={line.key}
              style={{
                display: 'grid',
                gridTemplateColumns: mayDiscount ? '3fr 1fr 1.2fr 1fr auto auto' : '3fr 1fr 1.2fr auto auto',
                gap: '0.5rem',
                alignItems: 'end',
              }}
            >
              <ItemPicker selectedLabel={line.label || null} onPick={(item) => addItem(item, line.key)} />
              <Field label="Qty">
                <Input
                  value={line.qty}
                  inputMode="decimal"
                  onChange={(e) => patchLine(line.key, { qty: e.target.value })}
                  style={{ textAlign: 'right' }}
                />
              </Field>
              <Field label="Rate">
                <Input
                  value={line.rate}
                  inputMode="decimal"
                  onChange={(e) => patchLine(line.key, { rate: e.target.value, rate_was_changed: true })}
                  style={{ textAlign: 'right' }}
                />
              </Field>
              {mayDiscount && (
                <Field label="Disc %">
                  <Input
                    value={line.discount_pc}
                    inputMode="decimal"
                    onChange={(e) => patchLine(line.key, { discount_pc: e.target.value })}
                    style={{ textAlign: 'right' }}
                  />
                </Field>
              )}
              <div style={{ textAlign: 'right', paddingBottom: '0.55rem', minWidth: '5rem' }} className="num">
                {money(
                  Number(line.qty || 0) * Number(line.rate || 0) -
                    (Number(line.qty || 0) * Number(line.rate || 0) * Number(line.discount_pc || 0)) / 100,
                )}
              </div>
              <Button
                tone="ghost"
                onClick={() => setLines((c) => (c.length > 1 ? c.filter((l) => l.key !== line.key) : [emptyLine()]))}
                title="Remove this line"
                style={{ marginBottom: '0.3rem' }}
              >
                <Trash2 size={14} aria-hidden />
              </Button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1.5rem', marginTop: '1rem', alignItems: 'baseline' }}>
          <span style={{ color: 'var(--muted)' }}>Total before tax</span>
          <span className="num" style={{ fontSize: '1.3rem', fontWeight: 600 }}>{money(subtotal)}</span>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: '0.78rem', marginTop: '0.3rem', marginBottom: 0, textAlign: 'right' }}>
          Smart Books works out the GST and prints the invoice.
        </p>
      </Card>

      <Card>
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input type="checkbox" checked={settleNow} onChange={(e) => setSettleNow(e.target.checked)} />
            {isPurchase ? 'Paid now (cash purchase)' : 'Paid now (cash sale)'}
          </label>
          {settleNow && (
            <Field label={isPurchase ? 'Paid from' : 'Received in'}>
              <Select value={settleAccount} onChange={(e) => setSettleAccount(e.target.value)}>
                {(cashBank.data?.data ?? []).map((account) => (
                  <option key={account.acc_id} value={account.acc_id}>{account.acc_name}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Note"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
      </Card>

      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          justifyContent: 'flex-end',
          position: 'sticky',
          bottom: '1rem',
          background: 'var(--bg)',
          padding: '0.5rem 0',
        }}
      >
        <Button onClick={() => navigate(-1)}>Cancel</Button>
        <Button disabled={saving} onClick={() => save(true)}>Save &amp; new</Button>
        <Button tone="primary" disabled={saving} onClick={() => save(false)}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
