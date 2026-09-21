import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { api, ApiError } from '../services/api'
import type {
  CashBankAccount,
  CatalogItem,
  CatalogParty,
  OriginalDocument,
  TransactionRequest,
} from '../services/types'
import { useApi } from '../hooks/useApi'
import { useBilling } from '../context/BillingContext'
import { ItemPicker, PartyPicker } from '../components/LivePicker'
import { Button, Card, date as formatDate, DataTable, Field, Input, money, Notice, Select, Textarea } from '../ui'

type EditorKind = 'sale' | 'purchase' | 'credit_note' | 'debit_note'

/**
 * Why a note is being raised.
 *
 * Billing's vocabulary for the shopkeeper's screen, not a tax classification —
 * Books decides what each one means in the accounts. What matters here is that
 * the person who reads this note in six months knows what happened.
 */
const CREDIT_REASONS = [
  { value: 'goods_returned', label: 'Goods came back' },
  { value: 'price_adjustment', label: 'Price was wrong' },
  { value: 'discount_agreed', label: 'Discount agreed afterwards' },
  { value: 'damaged', label: 'Goods were damaged or short' },
  { value: 'cancelled', label: 'Order cancelled' },
  { value: 'other', label: 'Something else' },
] as const

const DEBIT_REASONS = [
  { value: 'goods_returned', label: 'Goods sent back to the supplier' },
  { value: 'price_adjustment', label: 'Supplier billed the wrong price' },
  { value: 'shortage', label: 'Short delivery' },
  { value: 'damaged', label: 'Damaged on arrival' },
  { value: 'other', label: 'Something else' },
] as const

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
export default function SaleEditor({ kind = 'sale' }: { kind?: EditorKind }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { can, scope } = useBilling()

  const isNote = kind === 'credit_note' || kind === 'debit_note'
  // Debit notes and purchases both face a supplier; credit notes and sales both
  // face a customer. One flag rather than four branches per field.
  const isPurchase = kind === 'purchase' || kind === 'debit_note'

  const title = {
    sale: 'New bill',
    purchase: 'Record a purchase',
    credit_note: 'Credit note',
    debit_note: 'Debit note',
  }[kind]

  // The biller desk hands over whatever it had. A search box that forgets the
  // customer you just picked is a search box you do twice.
  const [party, setParty] = useState<{ id: number; name: string } | null>(() => {
    const id = Number(params.get('party_account_id') ?? '')
    const name = params.get('party_name')
    return id > 0 ? { id, name: name ?? `Account ${id}` } : null
  })
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()])
  const [settleNow, setSettleNow] = useState(false)
  const [settleAccount, setSettleAccount] = useState('')
  const [notes, setNotes] = useState('')
  const [against, setAgainst] = useState<OriginalDocument | null>(null)
  const [reason, setReason] = useState('')
  const [valueOnly, setValueOnly] = useState(false)
  const [adjustment, setAdjustment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryId, setRetryId] = useState<number | null>(null)

  const mayDiscount = can('discount.override')

  /**
   * The invoices (or bills) this note could be against.
   *
   * Books owns the original; there is no Billing copy of an invoice to choose
   * from, so this is a live read, and it only happens once a party is chosen.
   */
  const originals = useApi(
    (signal) =>
      api.one<{ documents: OriginalDocument[]; complete: boolean; note: string }>(
        'v1/original-documents',
        { party_account_id: party?.id, kind: isPurchase ? 'purchase' : 'sale' },
        signal,
      ),
    [party?.id, kind, scope?.cmp_id, scope?.fy_id],
    Boolean(scope && party && isNote),
  )

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

  /**
   * An item or a barcode handed over by the biller desk.
   *
   * Resolved through Inventory here rather than trusted from the URL: the id in
   * a query string is a request, not a fact, and the name and rate have to come
   * from the product that owns them either way.
   */
  useEffect(() => {
    const itemId = params.get('item_id')
    const scan = params.get('scan')
    if (!itemId && !scan) return

    const controller = new AbortController()
    const lookup = itemId
      ? // By id, from Inventory. This used to ask for the first page of the
        // catalogue and look for the id in it, which found the item only when
        // it happened to be the first one in the list.
        api
          .one<CatalogItem>(`v1/catalog/items/${encodeURIComponent(itemId)}`, undefined, controller.signal)
          .then((response) => response.data)
      : api
          .one<CatalogItem>(`v1/catalog/items/barcode/${encodeURIComponent(scan as string)}`, undefined, controller.signal)
          .then((response) => response.data)
          .catch(() =>
            api
              .get<{ data: CatalogItem[] }>('v1/catalog/items/search', { q: scan as string, limit: 1 }, controller.signal)
              .then((response) => response.data[0] ?? null),
          )

    lookup
      .then((item) => {
        if (item && !controller.signal.aborted) addItem(item)
      })
      .catch(() => {
        // The desk's suggestion could not be resolved. The editor is still
        // perfectly usable, so this is not worth an error dialog.
      })

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, scope?.cmp_id])

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

  const lineSubtotal = lines.reduce((sum, line) => {
    const gross = Number(line.qty || 0) * Number(line.rate || 0)
    return sum + gross - (gross * Number(line.discount_pc || 0)) / 100
  }, 0)

  // A value-only note has no lines to add up; the adjustment IS the amount.
  const subtotal = valueOnly ? Number(adjustment || 0) : lineSubtotal

  /**
   * How much of the original is left to credit.
   *
   * Books decides what may actually be adjusted — this is the figure on the
   * register, shown so somebody can see at a glance that a ₹40,000 credit
   * against a ₹18,000 invoice needs a second look before it is saved.
   */
  const overAdjusted = useMemo(
    () => (against?.amount != null && subtotal > against.amount + 0.005 ? against.amount : null),
    [against, subtotal],
  )

  async function save(andNew: boolean) {
    if (!party) {
      setError(isPurchase ? 'Choose the supplier first.' : 'Choose the customer first.')
      return
    }
    if (isNote && !reason) {
      setError('Say why this note is being raised.')
      return
    }

    // A value-only note carries one described line and no item, so nothing
    // downstream reads it as goods coming back.
    const usable = valueOnly
      ? [
          {
            ...emptyLine(),
            description:
              notes.trim() ||
              `Adjustment against ${against?.document_no ?? 'the original document'}`,
            qty: '1',
            rate: adjustment || '0',
          },
        ]
      : lines.filter((line) => line.item_id !== null || line.description.trim() !== '')

    if (usable.length === 0) {
      setError(valueOnly ? 'Enter the amount being adjusted.' : 'Add at least one item.')
      return
    }
    if (valueOnly && Number(adjustment || 0) <= 0) {
      setError('Enter the amount being adjusted.')
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
        supplier_invoice_no: isPurchase && !isNote ? supplierInvoiceNo || undefined : undefined,
        settled_to_account_id: settleNow && settleAccount ? Number(settleAccount) : undefined,
        against_voucher_id: against?.voucher_id ?? undefined,
        against_voucher_no: against?.document_no ?? undefined,
        reason_code: isNote ? reason : undefined,
        value_adjustment_only: isNote ? valueOnly : undefined,
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
        setAgainst(null)
        setReason('')
        setValueOnly(false)
        setAdjustment('')
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
      <h1 style={{ margin: 0, fontSize: '1.3rem' }}>{title}</h1>
      {isNote && (
        <p style={{ margin: 0, color: 'var(--muted)' }}>
          {kind === 'credit_note'
            ? 'Credits a customer — because goods came back, or because the bill was wrong.'
            : 'Charges a supplier back — because goods went back, or because the bill was wrong.'}{' '}
          Smart Books works out the accounting and the tax.
        </p>
      )}

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
          {isPurchase && !isNote && (
            <Field label="Supplier invoice number">
              <Input value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} />
            </Field>
          )}
        </div>
      </Card>

      {isNote && (
        <Card
          title="Which document is this against?"
          action={
            against ? (
              <Button tone="ghost" onClick={() => setAgainst(null)}>Choose another</Button>
            ) : undefined
          }
        >
          {!party ? (
            <p style={{ color: 'var(--muted)', margin: 0 }}>
              Choose the {isPurchase ? 'supplier' : 'customer'} first and their documents will be listed here.
            </p>
          ) : against ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
              <div>
                <strong>{against.document_no ?? 'Document'}</strong>
                <div style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>
                  {formatDate(against.date)}
                  {against.amount !== null && <> · {money(against.amount)}</>}
                </div>
              </div>
              <span style={{ color: 'var(--muted)', fontSize: '0.8rem', maxWidth: '26rem' }}>
                The note will carry this reference, so the two can be matched later without anybody ringing up.
              </span>
            </div>
          ) : originals.error ? (
            <Notice tone="warning" title="Could not list the original documents">
              {originals.error} You can still raise the note without a reference, but it will be harder to match.
            </Notice>
          ) : (
            <>
              <DataTable
                loading={originals.loading}
                rows={originals.data?.data.documents ?? []}
                rowKey={(row) => String(row.voucher_id ?? row.document_no)}
                onRowClick={(row) => setAgainst(row)}
                empty={`Nothing on record for this ${isPurchase ? 'supplier' : 'customer'} in the last year.`}
                columns={[
                  { key: 'no', header: 'Document', render: (row) => row.document_no ?? '—' },
                  { key: 'date', header: 'Dated', render: (row) => formatDate(row.date) },
                  { key: 'amount', header: 'Value', numeric: true, render: (row) => (row.amount === null ? '—' : money(row.amount)) },
                  {
                    key: 'pick',
                    header: '',
                    render: (row) => (
                      <Button onClick={() => setAgainst(row)}>Use this</Button>
                    ),
                  },
                ]}
              />
              {originals.data && (
                <p style={{ color: 'var(--muted)', fontSize: '0.78rem', marginTop: '0.6rem', marginBottom: 0 }}>
                  {originals.data.data.note}
                </p>
              )}
            </>
          )}
        </Card>
      )}

      {isNote && (
        <Card title="What happened">
          <div style={{ display: 'grid', gap: '0.85rem' }}>
            <Field label="Reason" hint="Shown on the note and kept with it.">
              <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">Choose a reason…</option>
                {(kind === 'credit_note' ? CREDIT_REASONS : DEBIT_REASONS).map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </Field>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
              <input
                type="checkbox"
                checked={valueOnly}
                onChange={(e) => setValueOnly(e.target.checked)}
                style={{ marginTop: '0.2rem' }}
              />
              <span>
                Adjust the value only — no goods came back
                <span style={{ display: 'block', color: 'var(--muted)', fontSize: '0.8rem' }}>
                  Use this when the price was wrong or a discount was agreed afterwards. Nothing is returned to stock.
                </span>
              </span>
            </label>

            {valueOnly && (
              <Field label="Amount to adjust" hint="Before tax. Smart Books works out the rest.">
                <Input
                  value={adjustment}
                  inputMode="decimal"
                  onChange={(e) => setAdjustment(e.target.value)}
                  style={{ textAlign: 'right', fontSize: '1.15rem' }}
                />
              </Field>
            )}

            <Field label="Remarks">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>

            {overAdjusted !== null && (
              <Notice tone="warning" title="This is more than the original">
                The document you picked is {money(overAdjusted)}. Smart Books decides what may actually be adjusted and
                may refuse this — check the figures before saving.
              </Notice>
            )}
          </div>
        </Card>
      )}

      {!isPurchase && !isNote && (favourites.data?.data.length ?? 0) > 0 && (
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

      {!valueOnly && (
      <Card
        title={isNote ? 'What is coming back' : 'Items'}
        action={<Button onClick={() => setLines((c) => [...c, emptyLine()])}>Add line</Button>}
      >
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
          <span className="num" style={{ fontSize: '1.3rem', fontWeight: 600 }}>{money(lineSubtotal)}</span>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: '0.78rem', marginTop: '0.3rem', marginBottom: 0, textAlign: 'right' }}>
          Smart Books works out the GST and prints the document.
        </p>
      </Card>
      )}

      {!isNote && (
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
      )}

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
        {!isNote && <Button disabled={saving} onClick={() => save(true)}>Save &amp; new</Button>}
        <Button tone="primary" disabled={saving} onClick={() => save(false)}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
