/**
 * What saving this will actually do, in the other two products.
 *
 * EXPLANATORY ONLY. Billing holds no ledger and no stock balance; it sends the
 * document to Smart Books, which owns the accounting and the stock posting
 * behind it. This panel says which of those will happen from what is on the
 * form right now — a services purchase genuinely moves no stock, and saying so
 * is the difference between a user trusting this screen and checking Inventory
 * afterwards every time.
 */

import { Boxes, BookOpen, Wallet } from 'lucide-react'
import { money } from '../../ui'
import type { PurchaseForm } from './model'

function ImpactRow({
  icon,
  title,
  detail,
  status,
  tone,
}: {
  icon: React.ReactNode
  title: string
  detail: string
  status: string
  tone: 'yes' | 'no' | 'warn'
}) {
  return (
    <div className="purchase-impact__row">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, minWidth: 0 }}>
        <span aria-hidden style={{ color: 'var(--billing-muted)', marginTop: 1 }}>
          {icon}
        </span>
        <div style={{ minWidth: 0 }}>
          <strong>{title}</strong>
          <span>{detail}</span>
        </div>
      </div>
      <span className={`purchase-pill purchase-pill--${tone}`}>{status}</span>
    </div>
  )
}

export function PurchaseImpactPanel({
  form,
  warehouseName,
  grandTotal,
  settleAccountName,
}: {
  form: PurchaseForm
  warehouseName: string | null
  grandTotal: number
  settleAccountName: string | null
}) {
  const goods = form.purchaseType === 'goods'

  return (
    <section className="purchase-card purchase-impact" aria-labelledby="purchase-impact-heading">
      <h2 id="purchase-impact-heading">Integrations &amp; Impact</h2>
      <p>What saving this will do elsewhere in Aicountly.</p>

      <ImpactRow
        icon={<BookOpen size={16} />}
        title="Smart Books"
        detail="Posts the purchase voucher and the GST"
        status="Enabled"
        tone="yes"
      />

      <ImpactRow
        icon={<Boxes size={16} />}
        title="Inventory"
        detail={
          goods
            ? warehouseName
              ? `Goods received into ${warehouseName}`
              : 'Choose a warehouse to receive the goods'
            : 'No stock movement on a services purchase'
        }
        status={goods ? (warehouseName ? 'Yes' : 'Pending') : 'No'}
        tone={goods ? (warehouseName ? 'yes' : 'warn') : 'no'}
      />

      <ImpactRow
        icon={<Wallet size={16} />}
        title={form.paidNow ? 'Cash & bank' : 'Money to Pay'}
        detail={
          form.paidNow
            ? settleAccountName
              ? `${money(grandTotal)} leaves ${settleAccountName}`
              : 'Choose the account this was paid from'
            : form.supplier
              ? `${form.supplier.name}’s balance goes up by ${money(grandTotal)}`
              : 'The supplier’s balance will go up'
        }
        status={form.paidNow ? 'Paid' : 'Outstanding'}
        tone={form.paidNow ? 'yes' : 'warn'}
      />
    </section>
  )
}
