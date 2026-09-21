/**
 * The running total, and an honest account of where it comes from.
 *
 * SUBTOTAL, DISCOUNT AND TAXABLE VALUE ARE EXACT: the backend computes each
 * line the same way before it sends anything on, so what is shown here is what
 * will be sent.
 *
 * THE TAX IS AN ESTIMATE and is labelled as one. It is worked out from the rate
 * on the tax category the user picked from Books' own master, split by the
 * treatment the two GSTINs imply. Smart Books applies the real tax, along with
 * any other charges and the rounding, when it posts the voucher — and this
 * product has nowhere to send an other-charge or a round-off of its own, so
 * there are no editable rows for them here pretending otherwise.
 */

import { Calculator } from 'lucide-react'
import { money } from '../../ui'
import type { GstMode } from './gst'
import type { PurchaseTotals } from './model'

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: string
  value: string
  strong?: boolean
  muted?: boolean
}) {
  return (
    <div className={`purchase-summary__row${strong ? ' purchase-summary__row--strong' : ''}`}>
      <span>{label}</span>
      <strong style={muted ? { color: 'var(--billing-muted)', fontWeight: 500 } : undefined}>{value}</strong>
    </div>
  )
}

export function PurchaseSummary({
  totals,
  gstMode,
  taxRatesUnpriced,
}: {
  totals: PurchaseTotals
  gstMode: GstMode
  /** Books' master answered but carried no percentages, so no tax can be previewed at all. */
  taxRatesUnpriced: boolean
}) {
  const noGst = gstMode.treatment === 'no_gst'
  const estimated = totals.taxEstimable
  const unknownSplit = gstMode.treatment === 'unknown'

  const taxValue = estimated ? money(totals.tax) : '—'

  return (
    <section className="purchase-card" aria-labelledby="purchase-summary-heading">
      <div className="purchase-card__head">
        <span className="purchase-card__mark" aria-hidden>
          <Calculator size={17} />
        </span>
        <div>
          <h2 id="purchase-summary-heading">Purchase Summary</h2>
          <p>Totals are calculated automatically</p>
        </div>
      </div>

      <Row label="Subtotal" value={money(totals.subtotal)} />
      <Row label="Discount" value={totals.discount > 0 ? `− ${money(totals.discount)}` : money(0)} />

      <div className="purchase-summary__rule" />

      <Row label="Taxable Value" value={money(totals.taxable)} strong />

      {!noGst && (
        <>
          {unknownSplit ? (
            <Row label="GST (estimated)" value={taxValue} muted={!estimated} />
          ) : gstMode.treatment === 'intrastate' ? (
            <>
              <Row label="CGST (estimated)" value={estimated ? money(totals.cgst) : '—'} muted={!estimated} />
              <Row label="SGST (estimated)" value={estimated ? money(totals.sgst) : '—'} muted={!estimated} />
            </>
          ) : (
            <Row label="IGST (estimated)" value={estimated ? money(totals.igst) : '—'} muted={!estimated} />
          )}
        </>
      )}

      <div className="purchase-summary__total">
        <span>{estimated || noGst ? 'Grand Total' : 'Taxable Value'}</span>
        <strong>{money(totals.grandTotal)}</strong>
      </div>

      {/* Only when there is more than one rate on the bill — a breakup of one
          row is a disclosure that says what the row above it already said. */}
      {estimated && totals.buckets.length > 1 && (
        <details className="purchase-summary__breakup">
          <summary>Tax breakup</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">Rate</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Taxable
                </th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Tax
                </th>
              </tr>
            </thead>
            <tbody>
              {totals.buckets.map((bucket) => (
                <tr key={bucket.rate}>
                  <td>{bucket.rate}%</td>
                  <td>{money(bucket.taxable)}</td>
                  <td>{money(bucket.tax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      <p className="purchase-summary__note">
        {noGst ? (
          <>This company is not registered under GST, so no tax is shown. </>
        ) : taxRatesUnpriced ? (
          <>
            Smart Books&apos; tax master carries no percentages here, so the tax cannot be previewed.{' '}
          </>
        ) : !estimated ? (
          <>A line still has no GST rate, so the tax is not previewed yet. </>
        ) : (
          <>{gstMode.reason} </>
        )}
        Smart Books works out the final GST, any other charges and the rounding when it posts this bill.
      </p>
    </section>
  )
}
