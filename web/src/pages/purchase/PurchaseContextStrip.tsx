/**
 * Six facts about the bill being entered, before the bill is entered.
 *
 * Every value here is read from somewhere real — the save state of this form,
 * Books' payables report, the two GSTINs, Inventory's warehouse list — or it
 * says plainly that it could not be read. None of them is decorative, and none
 * is a number this screen made up to fill a card.
 */

import { ChevronRight, FileText, Landmark, Percent, ShieldCheck, Sparkles, Warehouse } from 'lucide-react'
import { money } from '../../ui'
import type { GstMode } from './gst'
import type { SupplierInsight } from './useSupplierInsight'

export type SaveState = 'unsaved' | 'saving' | 'saved'

function Cell({
  icon,
  tone,
  label,
  value,
  muted,
  title,
}: {
  icon: React.ReactNode
  tone?: 'green' | 'blue' | 'amber' | 'slate'
  label: string
  value: string
  muted?: boolean
  title?: string
}) {
  return (
    <div className="purchase-strip__cell" title={title}>
      <span className={`purchase-strip__icon${tone ? ` purchase-strip__icon--${tone}` : ''}`} aria-hidden>
        {icon}
      </span>
      <span className="purchase-strip__body">
        <span className="purchase-strip__label">{label}</span>
        <span className={`purchase-strip__value${muted ? ' purchase-strip__value--muted' : ''}`}>{value}</span>
      </span>
    </div>
  )
}

/** The supplier card's one line, and whether it is a real figure or a reason. */
function supplierLine(
  hasSupplier: boolean,
  insight: SupplierInsight,
): { text: string; muted: boolean; title: string } {
  if (!hasSupplier) {
    return { text: 'Select supplier', muted: true, title: 'Recent purchase and payment behaviour' }
  }
  if (insight.loading) {
    return { text: 'Reading…', muted: true, title: 'Reading this supplier from Smart Books' }
  }

  if (insight.outstanding !== null) {
    const bills = insight.openBills !== null && insight.openBills > 0 ? ` · ${insight.openBills} open` : ''
    return {
      text: insight.outstanding > 0 ? `Outstanding ${money(insight.outstanding)}${bills}` : 'Nothing outstanding',
      muted: false,
      title:
        insight.overdue !== null && insight.overdue > 0
          ? `${money(insight.overdue)} of this is already overdue. Read from Smart Books just now.`
          : 'Outstanding payable to this supplier, read from Smart Books just now.',
    }
  }

  if (insight.recentPurchases !== null && insight.recentPurchases > 0) {
    return {
      text: `${insight.recentPurchases} recent purchase${insight.recentPurchases === 1 ? '' : 's'}`,
      muted: false,
      title: "Bills on Smart Books' purchase register for this supplier in the last year.",
    }
  }

  return {
    text: insight.unavailable ?? 'No history yet',
    muted: true,
    title: insight.unavailable ?? 'Nothing on record for this supplier yet.',
  }
}

export function PurchaseContextStrip({
  saveState,
  hasSupplier,
  insight,
  gstMode,
  warehouseLabel,
  onOpenHelper,
}: {
  saveState: SaveState
  hasSupplier: boolean
  insight: SupplierInsight
  gstMode: GstMode
  warehouseLabel: string | null
  onOpenHelper: () => void
}) {
  const supplier = supplierLine(hasSupplier, insight)

  const saveLabel =
    saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Sent to Smart Books' : 'Not saved yet'

  return (
    <section className="purchase-strip" aria-label="This purchase at a glance">
      <Cell
        icon={<FileText size={17} />}
        tone="slate"
        label="Draft"
        value={saveLabel}
        muted={saveState === 'unsaved'}
        title="Billing keeps nothing until you save. Smart Books then posts the voucher."
      />

      <Cell
        icon={<ShieldCheck size={17} />}
        tone="green"
        label="Supplier Health"
        value={supplier.text}
        muted={supplier.muted}
        title={supplier.title}
      />

      <Cell
        icon={<Percent size={17} />}
        tone="blue"
        label="GST Mode"
        value={gstMode.label}
        title={`${gstMode.reason} Determined from the supplier and your company GSTIN.`}
      />

      <Cell
        icon={<Warehouse size={17} />}
        tone="amber"
        label="Warehouse"
        value={warehouseLabel ?? 'Not chosen'}
        muted={warehouseLabel === null}
        title="Inventory will receive the goods here."
      />

      <Cell
        icon={<Landmark size={17} />}
        tone="slate"
        label="Approval Flow"
        value="Not required"
        muted
        title="Billing has no approval step. A saved purchase goes straight to Smart Books, which decides whether it posts."
      />

      <button type="button" className="purchase-strip__helper" onClick={onOpenHelper}>
        <Sparkles size={17} aria-hidden />
        <span>
          <strong>AI Purchase Helper</strong>
          <small>Smarter. Faster. Error free.</small>
        </span>
        <ChevronRight size={16} aria-hidden />
      </button>
    </section>
  )
}
