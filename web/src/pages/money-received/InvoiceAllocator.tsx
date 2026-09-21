/**
 * Which bills this receipt settles.
 *
 * The rows are Smart Books' bill-by-bill for this customer, read when the
 * customer was chosen. Billing keeps no copy of an invoice, so what is offered
 * here is what is still open at this moment — not what was open when the screen
 * was opened this morning.
 *
 * The client stops an allocation that is larger than the bill or larger than
 * the receipt, because it can do that instantly and without a round trip. It is
 * not the check that matters: Books validates the same thing again and its
 * answer is the one that decides.
 */

import { AlertTriangle, Info, Landmark, Wand2 } from 'lucide-react'
import { date as formatDate, money } from '../../ui'
import { Badge, EmptyState, ErrorState, SkeletonRows } from '../../dashboards/kit'
import type { OpenBill } from './data'
import {
  allocateOldestFirst,
  billKey,
  fromPaise,
  oldestFirst,
  parseAmount,
  toPaise,
  type ReceiptForm,
  type ReceiptMaths,
} from './form'

/** Days late, worked out against the browser's today. Negative means not yet due. */
function daysOverdue(due: string | null): number {
  if (!due) return 0
  const dueAt = new Date(`${due}T00:00:00`)
  if (Number.isNaN(dueAt.getTime())) return 0

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((today.getTime() - dueAt.getTime()) / 86_400_000)
}

export function InvoiceAllocator({
  bills,
  loading,
  error,
  onRetry,
  form,
  maths,
}: {
  bills: OpenBill[]
  loading: boolean
  error: string | null
  onRetry: () => void
  form: ReceiptForm
  maths: ReceiptMaths
}) {
  if (loading) return <SkeletonRows rows={4} />

  if (error) {
    return <ErrorState message={`Could not read this customer's open bills. ${error}`} onRetry={onRetry} />
  }

  if (bills.length === 0) {
    return (
      <EmptyState>
        No unpaid invoices were found for this customer. The whole receipt will sit on account until it is settled
        against a future bill.
      </EmptyState>
    )
  }

  const rows = oldestFirst(bills)
  const locked = form.autoAllocate

  function setRow(key: string, value: string) {
    form.setAllocation(key, value)
  }

  /** Tick a bill: fill it with whatever is left, up to its own balance. */
  function toggle(bill: OpenBill, checked: boolean) {
    const key = billKey(bill)
    if (!checked) {
      setRow(key, '')
      return
    }

    const alreadyOnThisBill = toPaise(parseAmount(maths.allocations[key] ?? '') ?? 0)
    const room = maths.amountPaise - maths.allocatedPaise + alreadyOnThisBill
    const applied = Math.max(Math.min(room, toPaise(bill.balance)), 0)
    setRow(key, applied > 0 ? fromPaise(applied).toFixed(2) : '')
  }

  return (
    <>
      <div className="billing-receipt-section__head">
        <div>
          <h3>Settle against invoices</h3>
          <p>
            {rows.length} open {rows.length === 1 ? 'bill' : 'bills'}, read from Smart Books when you chose this
            customer.
          </p>
        </div>

        <div className="billing-filters">
          <label className="billing-data-status" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={form.autoAllocate}
              onChange={(event) => {
                const auto = event.target.checked
                form.setAutoAllocate(auto)
                // Coming off automatic keeps what automatic had worked out, so
                // the table does not empty itself under the user's hands.
                if (!auto) form.replaceAllocations(allocateOldestFirst(bills, maths.amountPaise))
              }}
            />
            Oldest first, automatically
          </label>

          {!form.autoAllocate && (
            <button
              type="button"
              className="billing-button billing-button--soft billing-button--small"
              onClick={() => form.replaceAllocations(allocateOldestFirst(bills, maths.amountPaise))}
            >
              <Wand2 size={14} aria-hidden /> Auto allocate
            </button>
          )}
        </div>
      </div>

      <div className="billing-receipt-alloc">
        <div className="billing-table-scroll">
          <table className="billing-table">
            <thead>
              <tr>
                <th scope="col">
                  <span className="billing-sr-only">Settle</span>
                </th>
                <th scope="col">Invoice</th>
                <th scope="col">Dated</th>
                <th scope="col">Due</th>
                <th scope="col" className="billing-amount">
                  Pending
                </th>
                <th scope="col" className="billing-amount">
                  Amount to adjust
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((bill) => {
                const key = billKey(bill)
                const value = maths.allocations[key] ?? ''
                const late = daysOverdue(bill.due_date)
                const tooMuch = maths.overAllocatedBills.includes(key)

                return (
                  <tr key={key || `${bill.bill_no}-${bill.bill_date}`}>
                    <td>
                      <input
                        type="checkbox"
                        checked={(parseAmount(value) ?? 0) > 0}
                        disabled={locked}
                        onChange={(event) => toggle(bill, event.target.checked)}
                        aria-label={`Settle ${bill.bill_no ?? 'this bill'}`}
                      />
                    </td>
                    <td>
                      <strong style={{ fontWeight: 650 }}>{bill.bill_no ?? '—'}</strong>
                      {late > 0 && (
                        <>
                          {' '}
                          <Badge tone="danger">{late} days late</Badge>
                        </>
                      )}
                    </td>
                    <td>{formatDate(bill.bill_date)}</td>
                    <td>{formatDate(bill.due_date)}</td>
                    <td className="billing-amount">{money(bill.balance)}</td>
                    <td className="billing-amount">
                      <input
                        className="billing-receipt-alloc__input"
                        inputMode="decimal"
                        value={value}
                        disabled={locked}
                        aria-invalid={tooMuch || undefined}
                        aria-label={`Amount to adjust against ${bill.bill_no ?? 'this bill'}`}
                        onChange={(event) => {
                          const next = event.target.value
                          if (next === '' || parseAmount(next) !== null) setRow(key, next.replace(/[\s,₹]/g, ''))
                        }}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <AllocationTotals maths={maths} />

      {maths.overAllocatedBills.length > 0 && (
        <p className="billing-receipt-field__error" style={{ marginTop: 10 }}>
          <AlertTriangle size={13} aria-hidden /> One of these adjustments is larger than the bill it is against.
        </p>
      )}
    </>
  )
}

/**
 * Receipt, allocated, and what is left.
 *
 * The third figure changes its own tone rather than its wording: money left
 * over is on account, which is normal; money over-allocated is an error Books
 * would refuse, and it says so before the user presses Save.
 */
export function AllocationTotals({ maths }: { maths: ReceiptMaths }) {
  const leftover = maths.unallocatedPaise

  return (
    <div className="billing-receipt-totals">
      <div className="billing-receipt-total">
        <span>Receipt amount</span>
        <strong>{money(fromPaise(maths.amountPaise))}</strong>
      </div>
      <div className="billing-receipt-total billing-receipt-total--good">
        <span>Allocated to bills</span>
        <strong>{money(fromPaise(maths.allocatedPaise))}</strong>
      </div>
      <div
        className={`billing-receipt-total ${
          leftover < 0 ? 'billing-receipt-total--bad' : leftover > 0 ? 'billing-receipt-total--warn' : ''
        }`.trim()}
      >
        <span>{leftover < 0 ? 'Over-allocated' : 'Left on account'}</span>
        <strong>{money(fromPaise(Math.abs(leftover)))}</strong>
      </div>
    </div>
  )
}

/**
 * What happens to the open bills, in each of the three live tabs.
 *
 * Simple does not hide the allocation — it states it in a line and offers the
 * table. A receipt that silently cleared two invoices the user never saw is the
 * one thing this screen must not do.
 */
export function AllocationArea({
  bills,
  loading,
  error,
  onRetry,
  form,
  maths,
  allocationError,
}: {
  bills: OpenBill[]
  loading: boolean
  error: string | null
  onRetry: () => void
  form: ReceiptForm
  maths: ReceiptMaths
  allocationError?: string
}) {
  if (!form.party) return null

  if (form.receiptType === 'advance') {
    return (
      <div className="billing-receipt-section">
        <div className="billing-receipt-banner billing-receipt-banner--info">
          <span className="billing-receipt-banner__icon" aria-hidden="true">
            <Info size={16} />
          </span>
          <p>
            <strong>Advance receipt — no bill is settled now.</strong>
            The whole amount sits on this customer&rsquo;s account in Smart Books until a bill is settled against it.
            {bills.length > 0 && ` They do have ${bills.length} open ${bills.length === 1 ? 'bill' : 'bills'}.`}
          </p>
        </div>
      </div>
    )
  }

  if (form.receiptType === 'against_invoice') {
    return (
      <div className="billing-receipt-section">
        <InvoiceAllocator bills={bills} loading={loading} error={error} onRetry={onRetry} form={form} maths={maths} />
        {allocationError && (
          <p className="billing-receipt-field__error" style={{ marginTop: 10 }}>
            <AlertTriangle size={13} aria-hidden /> {allocationError}
          </p>
        )}
      </div>
    )
  }

  // Simple. One line about what will be settled, and a way into the detail.
  if (loading || bills.length === 0) return null

  const settling = Object.values(maths.allocations).filter((value) => (parseAmount(value) ?? 0) > 0).length

  return (
    <div className="billing-receipt-section">
      <div className="billing-receipt-banner">
        <span className="billing-receipt-banner__icon" aria-hidden="true">
          <Landmark size={16} />
        </span>
        <p>
          {settling === 0 ? (
            <>
              This customer has {bills.length} open {bills.length === 1 ? 'bill' : 'bills'}. Enter an amount and it will
              settle the oldest first.
            </>
          ) : (
            <>
              Settling {settling} {settling === 1 ? 'bill' : 'bills'}, oldest first
              {maths.unallocatedPaise > 0 && <> · {money(fromPaise(maths.unallocatedPaise))} left on account</>}.
            </>
          )}{' '}
          <button
            type="button"
            className="billing-button billing-button--quiet billing-button--small"
            style={{ minHeight: 0, padding: '2px 6px', color: 'var(--billing-action)', fontWeight: 650 }}
            onClick={() => form.setReceiptType('against_invoice')}
          >
            Choose bills
          </button>
        </p>
      </div>

      {settling > 0 && <AllocationTotals maths={maths} />}
    </div>
  )
}
