/**
 * Attachments — deliberately not wired up.
 *
 * There is no attachment endpoint in this deployment: nothing in the Billing
 * API stores a file against a transaction request, and the voucher Smart Books
 * creates is reached through an id, not an upload. A drop zone that accepted a
 * supplier's bill and then lost it on save would be worse than no drop zone —
 * the user would stop keeping the paper.
 *
 * So it is shown, disabled, and says exactly that. THE INTEGRATION POINT: when
 * an upload endpoint exists, this component is the only thing that changes —
 * take the files here, POST them, and put the returned reference on the payload
 * as `attachment_ref`, which the backend's expense path already reads.
 */

import { Paperclip, Upload } from 'lucide-react'

export function PurchaseAttachments() {
  return (
    <section className="purchase-card" aria-labelledby="purchase-attachments-heading">
      <div className="purchase-card__head">
        <span className="purchase-card__mark" aria-hidden>
          <Paperclip size={17} />
        </span>
        <div>
          <h2 id="purchase-attachments-heading">Attachments</h2>
          <p>Upload supplier bills or supporting documents</p>
        </div>
      </div>

      <div className="purchase-dropzone purchase-dropzone--disabled" aria-disabled="true">
        <Upload size={20} aria-hidden style={{ color: 'var(--billing-border-strong)' }} />
        <strong>Uploading isn’t available yet</strong>
        <span>This deployment has no endpoint to store a file against a purchase.</span>
        <small>Keep the supplier’s bill with your paper records for now.</small>
      </div>
    </section>
  )
}
