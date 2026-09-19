/**
 * Money received.
 *
 * The user sees "Money received"; internally it is a receipt voucher, and the
 * word "voucher" never appears on screen. What this screen is FOR is one
 * person, at a counter or a desk, recording money that has just arrived — so
 * the whole of it is arranged around getting from a customer's name to a saved
 * receipt in a few seconds, with everything needed to be sure it is right
 * visible without leaving the page.
 *
 * WHAT IS NOT DECIDED HERE. Billing does not make the accounting entry. It
 * takes what was typed, checks the obvious things instantly so nobody waits on
 * a round trip to be told the amount is blank, and asks Smart Books — which
 * validates the allocation against the bills IT knows are still open, and whose
 * answer is the one that counts. The payload sent is the same contract the
 * previous screen sent, field for field.
 *
 * THE TABS CHANGE WHAT YOU SEE, NOT WHAT IS POSTED. Simple still settles the
 * customer's oldest open bills, exactly as this screen did before the redesign;
 * it just says so in a line instead of showing the table. Against invoice opens
 * that table. Advance is the one tab that changes the accounting — it allocates
 * nothing, which is what an advance is — and it says so on its face.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  FileText,
  Keyboard,
  PlayCircle,
  Receipt,
  RotateCcw,
  Wallet,
} from 'lucide-react'
import { api, ApiError } from '../../services/api'
import type { TransactionRequest } from '../../services/types'
import { useBilling } from '../../context/BillingContext'
import { date as formatDate, money, Notice } from '../../ui'
import {
  isoDate,
  useCashBankAccounts,
  useCustomerDues,
  useOpenBills,
  useRecentReceipts,
  type ReceiptRow,
} from './data'
import {
  PAYMENT_MODES,
  REFERENCE_HINTS,
  allocateOldestFirst,
  billKey,
  fromPaise,
  parseAmount,
  toPaise,
  useReceiptForm,
  useReceiptMaths,
  type PaymentMode,
  type ReceiptFieldErrors,
  type ReceiptType,
  type SaveTarget,
} from './form'
import { AmountInput, Field, IconInput, RemarksInput } from './fields'
import { Attachments } from './Attachments'
import { CustomerPicker } from './CustomerPicker'
import { AllocationArea } from './InvoiceAllocator'
import { CustomerSummary, ReceiptAssistant, ReceiptTips } from './Insights'
import { RecentReceipts } from './RecentReceipts'
import { SaveButton } from './SaveButton'
import '../../styles/money-received.css'

/** Books stores the narration; 250 keeps a remark a remark. */
const REMARKS_LIMIT = 250

const TABS: Array<{ id: ReceiptType; label: string; disabled?: boolean; why?: string }> = [
  { id: 'simple', label: 'Simple' },
  { id: 'against_invoice', label: 'Against invoice' },
  { id: 'advance', label: 'Advance' },
  {
    id: 'refund',
    label: 'Refund',
    disabled: true,
    why: 'A refund is money going out, and it is recorded on Money paid. This screen only records money coming in.',
  },
]

export default function MoneyReceived() {
  const navigate = useNavigate()
  const { can } = useBilling()

  const today = useMemo(() => isoDate(new Date()), [])
  const form = useReceiptForm(today)

  const accounts = useCashBankAccounts()
  const openBills = useOpenBills(form.party?.id ?? null)
  const dues = useCustomerDues(form.party?.id ?? null)
  const recent = useRecentReceipts(90)

  const bills = useMemo(() => openBills.data?.data.bills ?? [], [openBills.data])
  const maths = useReceiptMaths(form, bills)

  const [errors, setErrors] = useState<ReceiptFieldErrors>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [retryId, setRetryId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<{ requestId: number; amount: number; party: string } | null>(null)
  const [showAssistant, setShowAssistant] = useState(true)
  const [showTips, setShowTips] = useState(true)
  const [shortcuts, setShortcuts] = useState(false)
  const [refundAsked, setRefundAsked] = useState(false)

  const customerInput = useRef<HTMLInputElement>(null)
  const amountInput = useRef<HTMLInputElement>(null)
  const accountInput = useRef<HTMLSelectElement>(null)
  const saveRef = useRef<(target: SaveTarget) => void>(() => {})

  const accountRows = useMemo(() => accounts.data?.data ?? [], [accounts.data])

  // The first cash or bank account, once, so the commonest receipt is one field
  // shorter. A choice the user has already made is never overwritten.
  useEffect(() => {
    if (form.accountId === '' && accountRows.length > 0) form.setAccountId(String(accountRows[0].acc_id))
  }, [accountRows, form.accountId, form.setAccountId])

  /**
   * Alt+M puts the cursor where the next receipt starts, and Ctrl/Cmd+Enter
   * saves. Neither is a browser shortcut, and both are listed under Shortcuts
   * rather than being folklore.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'm') {
        event.preventDefault()
        ;(customerInput.current ?? amountInput.current)?.focus()
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        saveRef.current('stay')
      }
      if (event.key === 'Escape') setShortcuts(false)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // The Ctrl+Enter handler is registered once; this keeps the function it
  // calls in step with the state of the current render.
  useEffect(() => {
    saveRef.current = save
  })

  if (!can('receipt.create')) {
    return (
      <Notice tone="warning" title="Not in your Billing profile">
        You do not have permission to record money received. Ask the owner of this company to add it to your profile.
      </Notice>
    )
  }

  const outstandingPaise = bills.reduce((sum, bill) => sum + toPaise(bill.balance), 0)
  const referenceHint = REFERENCE_HINTS[form.mode]
  const parsedAmount = parseAmount(form.amount)

  function clearError(field: keyof ReceiptFieldErrors) {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))
  }

  /** Everything that can be known without asking the server. */
  function validate(): ReceiptFieldErrors {
    const found: ReceiptFieldErrors = {}

    if (!form.party) found.party = 'Choose the customer this money came from.'
    if (parsedAmount === null || parsedAmount <= 0) found.amount = 'Enter an amount greater than zero.'
    if (!form.entryDate) found.entryDate = 'Choose the date this money was received.'
    if (!form.accountId) found.accountId = 'Choose where the money was received.'

    if (maths.overAllocated) {
      found.allocations = `You have allocated ${money(fromPaise(maths.allocatedPaise))} against a receipt of ${money(
        fromPaise(maths.amountPaise),
      )}.`
    } else if (maths.overAllocatedBills.length > 0) {
      found.allocations = 'One adjustment is larger than the bill it is against.'
    }

    return found
  }

  async function save(target: SaveTarget) {
    if (saving) return

    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) {
      setFailure(null)
      // Straight to the first thing that needs fixing, rather than leaving the
      // user to find the red text on a long form.
      if (found.party) customerInput.current?.focus()
      else if (found.amount) amountInput.current?.focus()
      else if (found.accountId) accountInput.current?.focus()
      return
    }

    setSaving(true)
    setFailure(null)
    setRetryId(null)

    try {
      const response = await api.post<TransactionRequest>('v1/transactions/receipt', {
        party_account_id: form.party!.id,
        amount: fromPaise(maths.amountPaise),
        date: form.entryDate,
        cash_bank_account_id: Number(form.accountId),
        payment_mode: form.mode,
        instrument_no: form.reference || undefined,
        instrument_date: form.mode === 'cheque' && form.instrumentDate ? form.instrumentDate : undefined,
        narration: form.remarks || undefined,
        allocations: Object.entries(maths.allocations)
          .map(([key, value]) => {
            const applied = toPaise(parseAmount(value) ?? 0)
            const bill = bills.find((row) => billKey(row) === key)
            return { voucher_id: bill?.voucher_id, bill_no: bill?.bill_no, amount: fromPaise(applied) }
          })
          .filter((allocation) => allocation.amount > 0),
      })

      const requestId = response.data.request_id

      if (target === 'view') {
        navigate(`/money-in/${requestId}`)
        return
      }

      // Books has the receipt now, so everything drawn from Books is stale:
      // the register, what this customer owes, and which bills are still open.
      recent.reload()
      dues.reload()
      openBills.reload()

      setSaved({ requestId, amount: fromPaise(maths.amountPaise), party: form.party!.name })
      form.reset({ party: target === 'another' })
      setErrors({})
      window.requestAnimationFrame(() => (target === 'another' ? amountInput : customerInput).current?.focus())
    } catch (error) {
      if (error instanceof ApiError) {
        setFailure(error.message)
        // The backend names the field it refused, in the same words the form
        // uses, so its message lands under the box rather than only in a toast.
        const field = typeof error.details.field === 'string' ? error.details.field : null
        const mapped: Record<string, keyof ReceiptFieldErrors> = {
          party_account_id: 'party',
          amount: 'amount',
          cash_bank_account_id: 'accountId',
          allocations: 'allocations',
        }
        if (field && mapped[field]) setErrors({ [mapped[field]]: error.message })

        const id = error.details.request_id
        if (error.retryable && typeof id === 'number') setRetryId(id)
      } else {
        setFailure('Unable to save the receipt. Check your connection and try again.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function retry() {
    if (retryId === null || saving) return
    setSaving(true)
    try {
      const response = await api.post<TransactionRequest>(`v1/transactions/${retryId}/retry`, {})
      navigate(`/money-in/${response.data.request_id}`)
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : 'That did not work. Try again in a moment.')
    } finally {
      setSaving(false)
    }
  }

  /** The assistant's one job: fill this receipt from what is actually open. */
  function fillFromOpenBills() {
    if (bills.length === 0) return

    const amountPaise = maths.amountPaise > 0 ? maths.amountPaise : outstandingPaise
    if (maths.amountPaise <= 0) form.setAmount(fromPaise(outstandingPaise).toFixed(2))

    form.setReceiptType('against_invoice')
    form.setAutoAllocate(false)
    form.replaceAllocations(allocateOldestFirst(bills, amountPaise))
    clearError('amount')
  }

  function useCustomerFromRow(row: ReceiptRow) {
    if (row.party_id === null) return
    form.setParty({ id: row.party_id, name: row.party ?? 'Customer', gstin: null })
    setSaved(null)
    window.requestAnimationFrame(() => amountInput.current?.focus())
  }

  const customerPayments = form.party
    ? (recent.data?.data.rows ?? []).filter((row) => row.party_id === form.party?.id)
    : []

  return (
    <div className="billing-receipt">
      <header className="billing-page-heading">
        <div>
          <nav className="billing-receipt-breadcrumb" aria-label="Breadcrumb">
            <span>Money</span>
            <span aria-hidden="true">›</span>
            <strong aria-current="page">Money received</strong>
          </nav>

          <div className="billing-receipt-title">
            <span className="billing-receipt-mark" aria-hidden="true">
              <Receipt size={19} />
            </span>
            <div>
              <h1>Money received</h1>
              <p>Record payments received from your customers.</p>
            </div>
          </div>
        </div>

        <div className="billing-actions" style={{ position: 'relative' }}>
          <button
            type="button"
            className="billing-button billing-button--small"
            aria-expanded={shortcuts}
            aria-haspopup="dialog"
            onClick={() => setShortcuts((value) => !value)}
          >
            <Keyboard size={15} aria-hidden /> Shortcuts <kbd className="billing-receipt-kbd">Alt + M</kbd>
          </button>

          <span title="A guide for this screen has not been published yet.">
            <button type="button" className="billing-button billing-button--small" disabled>
              <PlayCircle size={15} aria-hidden /> Video guide
            </button>
          </span>

          {shortcuts && (
            <div className="billing-receipt-menu billing-receipt-menu--below" role="dialog" aria-label="Keyboard shortcuts">
              <div style={{ padding: '8px 10px', display: 'grid', gap: 8, fontSize: 13 }}>
                <ShortcutRow keys="Alt + M" what="Jump to the customer box" />
                <ShortcutRow keys="↑ ↓ Enter" what="Choose a customer without the mouse" />
                <ShortcutRow keys="Ctrl / ⌘ + Enter" what="Save this receipt" />
                <ShortcutRow keys="Esc" what="Close this, and any open list" />
              </div>
            </div>
          )}
        </div>
      </header>

      {saved && (
        <Notice
          tone="success"
          title="Money received recorded"
          onDismiss={() => setSaved(null)}
          action={
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="billing-button billing-button--small"
                onClick={() => navigate(`/money-in/${saved.requestId}`)}
              >
                View receipt
              </button>
              <button
                type="button"
                className="billing-button billing-button--small billing-button--soft"
                onClick={() => {
                  setSaved(null)
                  customerInput.current?.focus()
                }}
              >
                Record another
              </button>
            </div>
          }
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <CheckCircle2 size={15} aria-hidden /> {money(saved.amount)} from {saved.party} has been sent to Smart
            Books.
          </span>
        </Notice>
      )}

      {failure && (
        <Notice
          tone="danger"
          title="Could not save this receipt"
          onDismiss={() => setFailure(null)}
          action={
            retryId !== null ? (
              <button type="button" className="billing-button billing-button--small" disabled={saving} onClick={retry}>
                Retry
              </button>
            ) : undefined
          }
        >
          {failure}
        </Notice>
      )}

      <div className="billing-receipt-grid">
        <div className="billing-receipt-main">
          <section className="billing-panel" aria-labelledby="payment-details-title">
            <div className="billing-receipt-cardhead">
              <div className="billing-receipt-cardhead__title">
                <span className="billing-receipt-mark billing-receipt-mark--sm" aria-hidden="true">
                  <Wallet size={16} />
                </span>
                <div>
                  <h2 id="payment-details-title">Payment details</h2>
                  <p>Enter customer and payment information.</p>
                </div>
              </div>

              <ReceiptTabs
                chosen={form.receiptType}
                onChoose={form.setReceiptType}
                onRefund={() => setRefundAsked(true)}
              />
            </div>

            {refundAsked && (
              <div
                className="billing-receipt-banner billing-receipt-banner--warning"
                role="status"
                style={{ marginBottom: 14 }}
              >
                <span className="billing-receipt-banner__icon" aria-hidden="true">
                  <AlertTriangle size={16} />
                </span>
                <p>
                  <strong>A refund is money going out.</strong>
                  This screen records money coming in, so a refund to a customer is recorded on Money paid — where it
                  becomes a payment against their account, which is what it is.
                </p>
                <span style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  {can('payment.create') && (
                    <button
                      type="button"
                      className="billing-button billing-button--small"
                      onClick={() => navigate('/money-out/new')}
                    >
                      Go to Money paid
                    </button>
                  )}
                  <button
                    type="button"
                    className="billing-iconbutton"
                    aria-label="Dismiss"
                    onClick={() => setRefundAsked(false)}
                  >
                    ×
                  </button>
                </span>
              </div>
            )}

            <div className="billing-receipt-fields">
              <CustomerPicker
                party={form.party}
                inputRef={customerInput}
                error={errors.party}
                onPick={(party) => {
                  form.setParty(party)
                  form.replaceAllocations({})
                  clearError('party')
                }}
                onClear={() => {
                  form.setParty(null)
                  form.replaceAllocations({})
                }}
              />

              <Field label="Amount" required error={errors.amount} htmlFor="receipt-amount">
                <AmountInput
                  id="receipt-amount"
                  inputRef={amountInput}
                  value={form.amount}
                  invalid={Boolean(errors.amount)}
                  onChange={(value) => {
                    form.setAmount(value)
                    clearError('amount')
                  }}
                />
              </Field>

              <Field
                label="Date"
                required
                error={errors.entryDate}
                htmlFor="receipt-date"
                hint={form.entryDate ? formatDate(form.entryDate) : undefined}
              >
                <IconInput icon={<Calendar size={15} />}>
                  <input
                    id="receipt-date"
                    type="date"
                    value={form.entryDate}
                    max={today}
                    onChange={(event) => {
                      form.setEntryDate(event.target.value)
                      clearError('entryDate')
                    }}
                  />
                </IconInput>
              </Field>

              <Field
                label="Received in"
                required
                error={errors.accountId ?? (accounts.error ? 'Could not read your cash and bank accounts.' : undefined)}
                htmlFor="receipt-account"
                hint="The till or bank account the money went into."
              >
                <select
                  id="receipt-account"
                  ref={accountInput}
                  value={form.accountId}
                  disabled={accounts.loading}
                  onChange={(event) => {
                    form.setAccountId(event.target.value)
                    clearError('accountId')
                  }}
                >
                  {accounts.loading && <option value="">Reading your accounts…</option>}
                  {!accounts.loading && accountRows.length === 0 && <option value="">No accounts available</option>}
                  {accountRows.map((row) => (
                    <option key={row.acc_id} value={row.acc_id}>
                      {row.acc_name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="How" required htmlFor="receipt-mode">
                <select
                  id="receipt-mode"
                  value={form.mode}
                  onChange={(event) => form.setMode(event.target.value as PaymentMode)}
                >
                  {PAYMENT_MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label={referenceHint.label}
                htmlFor="receipt-reference"
                hint={form.mode === 'cash' ? undefined : 'Worth filling in — it is what reconciles this against the bank.'}
              >
                <IconInput icon={<FileText size={15} />}>
                  <input
                    id="receipt-reference"
                    value={form.reference}
                    placeholder={referenceHint.placeholder}
                    autoComplete="off"
                    onChange={(event) => form.setReference(event.target.value)}
                  />
                </IconInput>
              </Field>

              {/* Books stores a cheque's own date beside its number, so the one
                  mode that has a second date asks for it. */}
              {form.mode === 'cheque' && (
                <Field label="Cheque date" htmlFor="receipt-instrument-date">
                  <IconInput icon={<Calendar size={15} />}>
                    <input
                      id="receipt-instrument-date"
                      type="date"
                      value={form.instrumentDate}
                      onChange={(event) => form.setInstrumentDate(event.target.value)}
                    />
                  </IconInput>
                </Field>
              )}
            </div>

            <div style={{ marginTop: 14 }}>
              <RemarksInput value={form.remarks} onChange={form.setRemarks} limit={REMARKS_LIMIT} />
            </div>

            <AllocationArea
              bills={bills}
              loading={openBills.loading}
              error={openBills.error}
              onRetry={openBills.reload}
              form={form}
              maths={maths}
              allocationError={errors.allocations}
            />

            <Attachments />

            <footer className="billing-receipt-footer">
              <button
                type="button"
                className="billing-button billing-button--quiet billing-button--small"
                onClick={() => {
                  form.reset()
                  setErrors({})
                  setFailure(null)
                  customerInput.current?.focus()
                }}
              >
                <RotateCcw size={14} aria-hidden /> Clear form
              </button>

              <div className="billing-receipt-footer__actions">
                <button type="button" className="billing-button" onClick={() => navigate(-1)}>
                  Cancel
                </button>
                <SaveButton saving={saving} onSave={save} />
              </div>
            </footer>
          </section>

          <RecentReceipts
            rows={recent.data?.data.rows ?? []}
            loading={recent.loading}
            error={recent.error}
            allowed={recent.allowed}
            onRetry={recent.reload}
            onUseCustomer={useCustomerFromRow}
          />
        </div>

        <aside className="billing-receipt-aside" aria-label="About this receipt">
          {showAssistant && (
            <ReceiptAssistant
              party={form.party}
              bills={bills}
              loading={openBills.loading}
              outstandingPaise={outstandingPaise}
              onFill={fillFromOpenBills}
              onDismiss={() => setShowAssistant(false)}
            />
          )}

          <CustomerSummary
            party={form.party}
            dues={{
              total: dues.data?.data.total ?? null,
              overdue: dues.data?.data.overdue ?? null,
              loading: dues.loading,
              error: dues.error,
              allowed: dues.allowed,
            }}
            payments={customerPayments}
            paymentsAllowed={recent.allowed}
            paymentsLoading={recent.loading}
            mayViewLedger={can('statement.view')}
          />

          {showTips && <ReceiptTips onDismiss={() => setShowTips(false)} />}
        </aside>
      </div>
    </div>
  )
}

/**
 * The four kinds of receipt.
 *
 * Refund is drawn and refused rather than hidden: somebody looking for it needs
 * to be told where it lives, not left wondering whether this product can do it.
 * It is `aria-disabled` rather than `disabled` precisely so it stays reachable —
 * a control a keyboard cannot land on is a control that never explains itself —
 * and it answers the question on focus as well as on a click, so the reason
 * arrives however somebody got to it.
 */
function ReceiptTabs({
  chosen,
  onChoose,
  onRefund,
}: {
  chosen: ReceiptType
  onChoose: (type: ReceiptType) => void
  onRefund: () => void
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([])
  const selectable = TABS.filter((tab) => !tab.disabled)

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()

    const step = event.key === 'ArrowRight' ? 1 : -1
    const here = Math.max(
      selectable.findIndex((tab) => tab.id === chosen),
      0,
    )
    const next = selectable[(here + step + selectable.length) % selectable.length]

    onChoose(next.id)
    buttons.current[TABS.findIndex((tab) => tab.id === next.id)]?.focus()
  }

  return (
    <div
      className="billing-receipt-tabs"
      role="tablist"
      aria-label="What kind of receipt is this?"
      onKeyDown={onKeyDown}
    >
      {TABS.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          ref={(node) => {
            buttons.current[index] = node
          }}
          className="billing-receipt-tab"
          aria-selected={!tab.disabled && chosen === tab.id}
          aria-disabled={tab.disabled || undefined}
          aria-describedby={tab.disabled ? 'receipt-tab-refund-why' : undefined}
          title={tab.why}
          tabIndex={tab.disabled || chosen === tab.id ? 0 : -1}
          onFocus={tab.disabled ? onRefund : undefined}
          onClick={() => (tab.disabled ? onRefund() : onChoose(tab.id))}
        >
          {tab.label}
        </button>
      ))}
      <span className="billing-sr-only" id="receipt-tab-refund-why">
        {TABS.find((tab) => tab.disabled)?.why}
      </span>
    </div>
  )
}

function ShortcutRow({ keys, what }: { keys: string; what: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
      <span>{what}</span>
      <kbd className="billing-receipt-kbd">{keys}</kbd>
    </div>
  )
}
