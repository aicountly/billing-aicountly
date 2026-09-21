/**
 * What the note comes to, and what it will do to the books.
 *
 * The figures here are a preview for the person typing, not the document:
 * Smart Books recomputes every one of them on posting, and the GST is not
 * worked out here at all. Both cards say which is which rather than leaving
 * somebody to assume the screen is the accounts.
 */

import { Calculator, Scale } from 'lucide-react'
import { money } from '../../ui'
import { Unavailable } from '../../dashboards/kit'
import type { Capability } from '../../services/types'
import { DnCard } from './parts'
import type { DebitNoteTotals, ReturnKind } from './model'

export function SummaryCard({
  totals,
  returnKind,
  overAdjustedAgainst,
}: {
  totals: DebitNoteTotals
  returnKind: ReturnKind
  /** What the chosen bill is worth, when the note has grown past it. */
  overAdjustedAgainst: number | null
}) {
  return (
    <DnCard title="Summary" icon={<Calculator size={15} />}>
      <div className="dn-sumline">
        <span>{returnKind === 'value_adjustment' ? 'Adjustment' : 'Items total'}</span>
        <strong>{money(totals.itemsTotal)}</strong>
      </div>

      {returnKind === 'goods_return' && (
        <div className="dn-sumline">
          <span>Discount (−)</span>
          <strong>{money(totals.discount)}</strong>
        </div>
      )}

      <div className="dn-sumline">
        <span>Tax</span>
        <em>Smart Books works it out</em>
      </div>

      <div className="dn-sumline dn-sumline--total">
        <span>Total before tax</span>
        <strong>{money(totals.taxable)}</strong>
      </div>

      <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--billing-muted)', lineHeight: 1.5 }}>
        Smart Books adds the GST, rounds the note and numbers it when this is posted. These figures are what you
        have typed, shown back to you.
      </p>

      {overAdjustedAgainst !== null && (
        <div style={{ marginTop: 12 }}>
          <Unavailable title="This is more than the bill it is against">
            The bill you picked is {money(overAdjustedAgainst)}. Smart Books decides what may actually be adjusted
            and may refuse this — worth checking the figures before posting.
          </Unavailable>
        </div>
      )}
    </DnCard>
  )
}

/**
 * The ledger effect — or, in this deployment, an honest account of why it
 * cannot be shown before posting.
 *
 * Which ledgers a debit note touches depends on the reason, the original bill,
 * whether the goods came back, the GST registration and the company's own
 * account settings. All of that lives in Smart Books. Drawing two plausible
 * rows here would be a guess printed in the place a person looks for a fact.
 */
export function AccountingImpactCard({
  capability,
  returnKind,
  taxable,
}: {
  capability: Capability
  returnKind: ReturnKind
  taxable: number
}) {
  return (
    <DnCard title="Accounting impact" icon={<Scale size={15} />} tone="doc">
      {capability.available ? (
        <p style={{ margin: 0, color: 'var(--billing-muted)' }}>
          A preview is configured for this deployment but this screen does not draw one yet.
        </p>
      ) : (
        <>
          <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.55 }}>
            Charging the supplier back reduces what you owe them by{' '}
            <strong className="num" style={{ fontVariantNumeric: 'tabular-nums' }}>{money(taxable)}</strong> plus tax.{' '}
            {returnKind === 'goods_return'
              ? 'Because the goods are going back, Inventory reduces the stock as well.'
              : 'Because no goods are coming back, no stock moves anywhere.'}
          </p>

          <Unavailable title="The ledgers are decided when this posts">
            {capability.reason ??
              'Smart Books works out the ledgers and the tax when the document is posted, and does not offer a preview of them beforehand.'}
          </Unavailable>

          <div className="dn-note">
            Exact ledgers and tax accounts follow your accounting settings in Smart Books — the reason on the note,
            the bill it is against and your GST registration all change them.
          </div>
        </>
      )}
    </DnCard>
  )
}
