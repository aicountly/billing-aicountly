/**
 * The running total, and what it is made of.
 *
 * READ THE COMMENT AT THE TOP OF saleForm.ts BEFORE CHANGING ANYTHING HERE.
 *
 * Subtotal, discount and taxable value are arithmetic on what the user typed,
 * and they are exact. The GST block is a PREVIEW worked out from the tax
 * categories Smart Books returned for this company and the two state codes on
 * the document — it is labelled as an estimate, it is never sent anywhere, and
 * when it cannot honestly be drawn the panel says why instead of showing a
 * nought. Smart Books issues the invoice, its GST, its rounding and its number.
 */

import { Eye, Printer, Send, Share2, Sparkles } from 'lucide-react'
import { money } from '../../ui'
import { fromPaise, grouped, stateName, type SaleTotals, type SupplyKind } from './saleForm'

export function BillSummaryPanel({
  totals,
  supply,
  placeOfSupply,
  canPreview,
  onPreview,
  onPrint,
}: {
  totals: SaleTotals
  supply: SupplyKind
  placeOfSupply: string
  canPreview: boolean
  onPreview: () => void
  onPrint: () => void
}) {
  const tax = totals.tax
  const estimated = tax !== null

  return (
    <aside className="billing-sale-summary" aria-labelledby="sale-summary-heading">
      <div className="billing-sale-summary__head">
        <h2 id="sale-summary-heading" style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
          Bill summary
        </h2>
        <span className="billing-sale-summary__currency" title="Billing bills in rupees. Smart Books holds the currency of the voucher.">
          INR ₹
        </span>
      </div>

      <div className="billing-sale-summary__row">
        <span>Subtotal</span>
        <strong>{grouped(totals.subtotalPaise)}</strong>
      </div>

      <div className="billing-sale-summary__row">
        <span>Discount</span>
        <strong>{totals.discountPaise > 0 ? `− ${grouped(totals.discountPaise)}` : grouped(0)}</strong>
      </div>

      <div className="billing-sale-summary__divider" />

      <div className="billing-sale-summary__row">
        <span>Taxable value</span>
        <strong>{grouped(totals.taxablePaise)}</strong>
      </div>

      {tax ? (
        <>
          {/* One rate is the ordinary bill, and it reads as the invoice will:
              CGST 9% and SGST 9% of an 18% category. More than one rate needs
              the bands spelled out first, or the totals are two numbers with
              no arithmetic anybody can follow. */}
          {tax.bands.length > 1 &&
            tax.bands.map((band) => (
              <div key={band.ratePc} className="billing-sale-summary__row billing-sale-summary__row--muted">
                <span>
                  {supply === 'intra' ? 'CGST + SGST' : 'IGST'} {band.ratePc}% on {grouped(band.taxablePaise)}
                </span>
                <strong>{grouped(band.cgstPaise + band.sgstPaise + band.igstPaise)}</strong>
              </div>
            ))}

          {supply === 'intra' && (
            <>
              <div className="billing-sale-summary__row">
                <span>CGST{tax.bands.length === 1 ? ` (${tax.bands[0].ratePc / 2}%)` : ''}</span>
                <strong>{grouped(tax.cgstPaise)}</strong>
              </div>
              <div className="billing-sale-summary__row">
                <span>SGST{tax.bands.length === 1 ? ` (${tax.bands[0].ratePc / 2}%)` : ''}</span>
                <strong>{grouped(tax.sgstPaise)}</strong>
              </div>
            </>
          )}

          {supply === 'inter' && (
            <div className="billing-sale-summary__row">
              <span>IGST{tax.bands.length === 1 ? ` (${tax.bands[0].ratePc}%)` : ''}</span>
              <strong>{grouped(tax.igstPaise)}</strong>
            </div>
          )}

          <div className="billing-sale-summary__divider" />

          <div className="billing-sale-summary__row billing-sale-summary__row--muted">
            <span>Round off</span>
            <strong>
              {totals.roundOffPaise === 0
                ? grouped(0)
                : `${totals.roundOffPaise > 0 ? '+' : '−'} ${grouped(Math.abs(totals.roundOffPaise))}`}
            </strong>
          </div>
        </>
      ) : (
        totals.taxUnavailable && <p className="billing-sale-summary__note">{totals.taxUnavailable}</p>
      )}

      <div className="billing-sale-summary__total">
        <span className="billing-sale-summary__total-label">
          {estimated ? 'Grand total' : 'Total before tax'}
          <span>
            {estimated
              ? `Estimated · ${supply === 'intra' ? `within ${stateName(placeOfSupply) || 'the state'}` : 'inter-state'}`
              : 'Smart Books adds the GST'}
          </span>
        </span>
        <strong>{money(fromPaise(totals.grandTotalPaise))}</strong>
      </div>

      <div className="billing-sale-summary__smart">
        <Sparkles size={15} aria-hidden style={{ color: 'var(--billing-action)', flexShrink: 0, marginTop: 1 }} />
        <div>
          <strong>Smart Books</strong>
          <span>
            Works out the GST, numbers the invoice and keeps the accounting. The figures here are this screen&rsquo;s
            arithmetic on what you typed.
          </span>
        </div>
      </div>

      <div className="billing-sale-summary__docs">
        <button
          type="button"
          className="billing-sale-summary__doc"
          onClick={onPreview}
          disabled={!canPreview}
          title={canPreview ? 'See the bill as it stands' : 'Add an item first'}
        >
          <Eye size={14} aria-hidden /> Preview
        </button>
        <button
          type="button"
          className="billing-sale-summary__doc"
          onClick={onPrint}
          disabled={!canPreview}
          title={canPreview ? 'Print this preview — the tax invoice is printed from Smart Books once saved' : 'Add an item first'}
        >
          <Printer size={14} aria-hidden /> Print
        </button>
        <button
          type="button"
          className="billing-sale-summary__doc"
          disabled
          title="Smart Books shares the invoice once this bill is saved. Billing has no sharing of its own."
        >
          <Share2 size={14} aria-hidden /> Share
        </button>
        <button
          type="button"
          className="billing-sale-summary__doc"
          disabled
          title="Smart Books sends the invoice once this bill is saved. Billing has no e-mail or messaging of its own."
        >
          <Send size={14} aria-hidden /> Send
        </button>
      </div>

      <p className="billing-sale-summary__note" style={{ marginTop: 8 }}>
        Sharing and sending happen in Smart Books once the bill is saved — it holds the invoice and its number.
      </p>
    </aside>
  )
}
