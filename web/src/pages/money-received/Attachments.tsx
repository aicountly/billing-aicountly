import { ScanLine, Upload } from 'lucide-react'
import { ATTACHMENTS_ENABLED, RECEIPT_SCAN_ENABLED } from './features'

/**
 * Payment proof.
 *
 * Drawn, and honest about being unavailable. There is nowhere in this
 * deployment to put a file and get it back, and — unlike an expense, which can
 * at least record WHERE its bill is kept — a receipt has no attachment field to
 * write a reference into. So this says so, rather than accepting a photo and
 * losing it. See ./features.ts and DocumentCapture in the API.
 */
export function Attachments() {
  if (ATTACHMENTS_ENABLED) return null

  return (
    <div className="billing-receipt-section">
      <div className="billing-receipt-section__head">
        <div className="billing-receipt-cardhead__title">
          <span className="billing-receipt-mark billing-receipt-mark--sm" aria-hidden="true">
            <Upload size={15} />
          </span>
          <div>
            <h3>
              Attachments <span style={{ fontWeight: 400, color: 'var(--billing-muted)' }}>(not available yet)</span>
            </h3>
            <p>Payment proof — a screenshot, a receipt, a bank advice.</p>
          </div>
        </div>

        {!RECEIPT_SCAN_ENABLED && (
          <span title="What this deployment can read is a supplier's bill, not a receipt. Reading a receipt needs its own call, and there is not one yet.">
            <button type="button" className="billing-button billing-button--small" disabled>
              <ScanLine size={14} aria-hidden /> Scan receipt
            </button>
          </span>
        )}
      </div>

      <div className="billing-receipt-drop" role="note">
        <Upload size={20} aria-hidden />
        <span>
          There is nowhere to keep a file yet, so this does not accept one.
          <small>
            No document store is configured for this deployment, and the receipt itself has no field to record where a
            proof is kept — so a file dropped here would be lost rather than filed.
          </small>
        </span>
      </div>
    </div>
  )
}
