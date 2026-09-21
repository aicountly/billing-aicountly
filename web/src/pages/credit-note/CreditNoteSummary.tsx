/**
 * The rail: what this note comes to, what it moves, and what Smart Books will
 * do with it.
 *
 * THE RULE THIS FILE KEEPS. Billing does not calculate tax — Books does, the
 * same way it did on the invoice being credited. So the amounts here are
 * before tax and say so, the GST row names who works it out instead of
 * printing a figure this product cannot stand behind, and the posting preview
 * shows the direction of each leg with an amount only where there is one to
 * show. A confident wrong number on a credit note is worse than an honest
 * blank: it is the number somebody reconciles against.
 */

import { AlertTriangle, Boxes, Calculator, Info, Sparkles } from 'lucide-react'
import type { CatalogParty, OriginalDocument } from '../../services/types'
import { money, qty as formatQty } from '../../ui'
import type { CreditNoteTotals, ReturnMode } from './creditNote'

export function CreditNoteSummary({
  totals,
  mode,
  customer,
  invoice,
  stock,
  warehouseName,
  gstRegistered,
  taxRates,
  warnings,
}: {
  totals: CreditNoteTotals
  mode: ReturnMode
  customer: CatalogParty | null
  invoice: OriginalDocument | null
  stock: Array<{ warehouseId: string; units: number }>
  warehouseName: (id: string) => string
  gstRegistered: boolean
  taxRates: number[]
  warnings: string[]
}) {
  const goodsReturn = mode === 'GOODS_RETURN'
  const started = totals.lineCount > 0

  return (
    <>
      <section className="billing-cn-rail-card" aria-labelledby="billing-cn-amounts-title">
        <div className="billing-cn-rail-card__head">
          <Calculator size={16} aria-hidden />
          <h3 id="billing-cn-amounts-title">Amount summary</h3>
        </div>
        <div className="billing-cn-rail-card__body">
          <div className="billing-cn-row">
            <span>Subtotal</span>
            <strong>{money(totals.subtotal)}</strong>
          </div>
          <div className="billing-cn-row">
            <span>Discount</span>
            <strong>{totals.discount > 0 ? `− ${money(totals.discount)}` : money(0)}</strong>
          </div>
          <div className="billing-cn-row billing-cn-row--quiet billing-cn-row--rule">
            <span>
              GST{taxRates.length > 0 && ` (${taxRates.map((rate) => `${formatQty(rate)}%`).join(', ')})`}
            </span>
            <strong>{gstRegistered ? 'Smart Books' : 'Not registered'}</strong>
          </div>

          <div className="billing-cn-total">
            <span>
              Total credit
              <small>before tax</small>
            </span>
            <strong>{money(totals.taxable)}</strong>
          </div>
        </div>
        <p className="billing-cn-rail-card__note" style={{ padding: '0 16px 14px' }}>
          {gstRegistered
            ? 'Smart Books adds the GST — the same split, place of supply and rounding it used on the bill — and prints the note.'
            : 'This company is not registered for GST, so no tax is added to this note.'}
        </p>
      </section>

      <section className="billing-cn-rail-card" aria-labelledby="billing-cn-stock-title">
        <div className="billing-cn-rail-card__head">
          <Boxes size={16} aria-hidden />
          <h3 id="billing-cn-stock-title">Stock impact</h3>
        </div>
        <div className="billing-cn-rail-card__body">
          {!goodsReturn ? (
            <>
              <div className="billing-cn-row">
                <span>Stock movement</span>
                <strong>None</strong>
              </div>
              <p className="billing-cn-rail-card__note" style={{ padding: '6px 0 0' }}>
                This note adjusts the value of the bill. Nothing is added back to stock.
              </p>
            </>
          ) : stock.length === 0 ? (
            <p className="billing-cn-rail-card__note" style={{ padding: 0 }}>
              Add the items coming back and the quantities appear here, warehouse by warehouse.
            </p>
          ) : (
            <>
              <div className="billing-cn-row">
                <span>Going back into stock</span>
                <strong>{formatQty(totals.units)} units</strong>
              </div>
              {stock.map((entry) => (
                <div className="billing-cn-row billing-cn-row--quiet" key={entry.warehouseId || 'unset'}>
                  <span>{entry.warehouseId === '' ? 'Warehouse not chosen' : warehouseName(entry.warehouseId)}</span>
                  <strong>{formatQty(entry.units)}</strong>
                </div>
              ))}
              <p className="billing-cn-rail-card__note" style={{ padding: '8px 0 0' }}>
                Inventory moves the stock when the note is issued. Billing keeps no stock of its own.
              </p>
            </>
          )}
        </div>
      </section>

      <section className="billing-cn-rail-card" aria-labelledby="billing-cn-posting-title">
        <div className="billing-cn-rail-card__head">
          <Info size={16} aria-hidden />
          <h3 id="billing-cn-posting-title">What Smart Books will do</h3>
        </div>

        {!started || !customer ? (
          <div className="billing-cn-rail-card__body">
            <p className="billing-cn-rail-card__note" style={{ padding: 0 }}>
              Choose the customer, the bill and what is being credited, and the entries Smart Books will make appear
              here.
            </p>
          </div>
        ) : (
          <div className="billing-cn-rail-card__body">
            <div className="billing-cn-row">
              <span>{goodsReturn ? 'Sales return' : 'Sales value'}</span>
              <strong>Dr {money(totals.taxable)}</strong>
            </div>
            {gstRegistered && (
              <div className="billing-cn-row billing-cn-row--quiet">
                <span>Output GST</span>
                <strong>Dr by Smart Books</strong>
              </div>
            )}
            <div className="billing-cn-row billing-cn-row--rule">
              <span>{customer.acc_name}</span>
              <strong>Cr {gstRegistered ? 'with tax' : money(totals.taxable)}</strong>
            </div>
            <p className="billing-cn-rail-card__note" style={{ padding: '8px 0 0' }}>
              The direction of each leg, from the note you are raising. Smart Books picks the exact heads from this
              company’s chart of accounts and works out the tax
              {invoice?.document_no ? ` against ${invoice.document_no}` : ''}.
            </p>
          </div>
        )}

        <div className="billing-cn-tip">
          {warnings.length > 0 ? <AlertTriangle size={15} aria-hidden /> : <Sparkles size={15} aria-hidden />}
          <div>
            <strong>{warnings.length > 0 ? 'Worth a look before you issue this' : 'Before you issue this'}</strong>
            {warnings.length > 0 ? (
              <ul>
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : (
              <p>
                {goodsReturn
                  ? 'Smart Books adjusts what this customer owes and the GST on it, and Inventory takes the stock back — both from this one note.'
                  : 'Smart Books adjusts what this customer owes and the GST on it. No stock moves.'}
              </p>
            )}
          </div>
        </div>
      </section>
    </>
  )
}
