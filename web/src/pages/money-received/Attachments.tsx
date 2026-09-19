import { ScanLine, Upload } from 'lucide-react'
import { ATTACHMENTS_ENABLED, RECEIPT_SCAN_ENABLED } from './features'

/**
 * Payment proof.
 *
 * Drawn, and honest about being unavailable: this deployment has no document
 * store and the receipt payload has no attachment field, so a dropzone that
 * accepted a file would be a dropzone that lost it. See ./features.ts.
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
          <span title="Reading an amount off a photograph needs a document-extraction service, which this deployment does not have.">
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
            No document store is configured for this deployment, and the receipt itself has no attachment field — a file
            dropped here would be lost rather than filed.
          </small>
        </span>
      </div>
    </div>
  )
}
