/**
 * What happened, once Smart Books has it.
 *
 * Only the actions this product can actually carry out are offered. There is no
 * "download the PDF" or "send it to the supplier" here because neither exists
 * in Billing — the document belongs to Smart Books, and the link goes there
 * through the record of the request.
 */

import { Check, FilePlus2, Receipt } from 'lucide-react'
import { Link } from 'react-router-dom'
import { money } from '../../ui'
import type { TransactionRequest } from '../../services/types'

export function DebitNoteSuccess({
  request,
  supplierName,
  total,
  onAnother,
}: {
  request: TransactionRequest
  supplierName: string
  total: number
  onAnother: () => void
}) {
  const number = request.books_voucher_no

  return (
    <section className="dn-card" aria-live="polite">
      <div className="dn-success">
        <span className="dn-success__mark" aria-hidden><Check size={28} /></span>

        <div style={{ display: 'grid', gap: 8, justifyItems: 'center' }}>
          <h2>
            {number ? `Debit note ${number} posted` : 'Debit note posted'}
          </h2>
          <p>
            {money(total)} before tax has been charged back to {supplierName}. Smart Books has worked out the tax
            and the ledgers, and what you owe this supplier has come down.
          </p>
        </div>

        <div className="dn-success__actions">
          <Link className="billing-button billing-button--primary" to={`/purchases/${request.request_id}`}>
            <Receipt size={15} aria-hidden /> View this debit note
          </Link>
          <button type="button" className="billing-button" onClick={onAnother}>
            <FilePlus2 size={15} aria-hidden /> Create another
          </button>
          <Link className="billing-button" to="/payables">
            What I owe suppliers
          </Link>
        </div>
      </div>
    </section>
  )
}
