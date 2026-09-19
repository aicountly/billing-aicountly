/**
 * One bill, and what can be done about it.
 *
 * Everything here came from Books' bill-by-bill on this page load; Billing
 * holds no copy of a supplier bill and this panel does not pretend otherwise.
 * It links out to the two screens that DO exist — recording a payment, and the
 * supplier's ledger — rather than to a voucher page this product cannot resolve
 * from a Books voucher id.
 */

import { Banknote, Users } from 'lucide-react'
import { date, money, moneyPlain } from '../../ui'
import { DaysCell, Dialog, PartPaidBadge, StatusBadge, avatarColour, initials } from './parts'
import type { PayableBill } from '../../services/types'

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="mtp-fact__label">{label}</span>
      <span className="mtp-fact__value">{value}</span>
    </div>
  )
}

export function BillDetail({
  bill,
  canRecordPayment,
  canViewStatement,
  onClose,
  onRecordPayment,
  onOpenSupplier,
}: {
  bill: PayableBill
  canRecordPayment: boolean
  canViewStatement: boolean
  onClose: () => void
  onRecordPayment: () => void
  onOpenSupplier: () => void
}) {
  return (
    <Dialog
      title={bill.bill_no ?? 'Supplier bill'}
      description={`${bill.account_name} · outstanding ${money(bill.balance)}`}
      onClose={onClose}
      footer={
        <>
          {canViewStatement && (
            <button type="button" className="billing-button" onClick={onOpenSupplier}>
              <Users size={15} aria-hidden /> Supplier statement
            </button>
          )}
          {canRecordPayment && (
            <button type="button" className="billing-button billing-button--primary" onClick={onRecordPayment}>
              <Banknote size={15} aria-hidden /> Record a payment
            </button>
          )}
          <button type="button" className="billing-button" onClick={onClose}>Close</button>
        </>
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 16 }}>
        <span
          className="mtp-party__avatar"
          style={{ background: avatarColour(bill.account_id, bill.account_name), width: 38, height: 38, flexBasis: 38, fontSize: 13 }}
          aria-hidden="true"
        >
          {initials(bill.account_name)}
        </span>
        <span style={{ minWidth: 0 }}>
          <strong style={{ display: 'block' }}>{bill.account_name}</strong>
          {bill.category && <span style={{ color: 'var(--billing-muted)', fontSize: 12 }}>{bill.category}</span>}
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
          <StatusBadge status={bill.status} />
          {bill.partially_paid && <PartPaidBadge />}
        </span>
      </div>

      <div className="mtp-facts">
        <Fact label="Bill number" value={bill.bill_no ?? 'not recorded'} />
        <Fact label="Their reference" value={bill.reference ?? '—'} />
        <Fact label="Bill date" value={date(bill.bill_date)} />
        <Fact label="Due date" value={date(bill.due_date)} />
        <Fact
          label="Days"
          value={<DaysCell status={bill.status} daysOverdue={bill.days_overdue} daysToDue={bill.days_to_due} />}
        />
        <Fact label="Our document" value={bill.document_no ?? '—'} />
        <Fact label="Still outstanding" value={money(bill.balance)} />
        <Fact
          label="Bill value"
          value={
            bill.bill_amount === null
              ? <span style={{ color: 'var(--billing-muted)', fontWeight: 400 }}>not stated</span>
              : `${moneyPlain(bill.bill_amount)}${bill.paid_amount ? ` · ${moneyPlain(bill.paid_amount)} paid` : ''}`
          }
        />
      </div>

      <p style={{ marginBottom: 0, marginTop: 16, color: 'var(--billing-muted)', fontSize: 12 }}>
        Read from Smart Books&rsquo; bill-by-bill just now. Recording a payment writes a payment voucher in Smart Books
        against a cash or bank ledger — it does not instruct a bank.
      </p>
    </Dialog>
  )
}
