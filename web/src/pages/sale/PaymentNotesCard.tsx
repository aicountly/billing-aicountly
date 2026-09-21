/**
 * Whether the money came in now, and what goes on the bill besides the items.
 *
 * "Paid now" is not a second transaction invented here: it tells Books which
 * cash or bank ledger received the money, and Books makes the receipt side of
 * the voucher. Billing records no payment of its own — there is no payment
 * table in this product.
 */

import { Info, Paperclip, ScrollText } from 'lucide-react'
import type { CashBankAccount } from '../../services/types'
import { Field, Segmented } from './SaleFields'
import {
  NOTE_LIMIT,
  PAYMENT_MODES,
  PAYMENT_MODE_LABELS,
  type PaymentMode,
  type SaleDraft,
  type SaleErrors,
} from './saleForm'

export function PaymentNotesCard({
  draft,
  onChange,
  errors,
  showErrors,
  accounts,
  accountsLoading,
  accountsFailed,
  hasTerms,
  onEditTerms,
}: {
  draft: SaleDraft
  onChange: (patch: Partial<SaleDraft>) => void
  errors: SaleErrors
  showErrors: boolean
  accounts: CashBankAccount[]
  accountsLoading: boolean
  accountsFailed: boolean
  hasTerms: boolean
  onEditTerms: () => void
}) {
  const settleError = showErrors ? errors.settleAccountId : undefined

  return (
    <section className="billing-sale-card" aria-labelledby="sale-payment-heading">
      <header className="billing-sale-card__head">
        <div>
          <h2 id="sale-payment-heading">Payment &amp; notes</h2>
          <p>Leave it unpaid and the bill goes on the customer&rsquo;s account.</p>
        </div>
        <label className="billing-sale-payment__toggle">
          <input
            type="checkbox"
            checked={draft.paidNow}
            onChange={(event) => onChange({ paidNow: event.target.checked })}
          />
          Paid now (cash sale)
          <span
            title="Smart Books makes the receipt side of the voucher against the ledger you pick. Billing records no payment of its own."
            aria-hidden
            style={{ display: 'inline-flex', color: 'var(--billing-muted)' }}
          >
            <Info size={14} />
          </span>
        </label>
      </header>

      <div className="billing-sale-payment">
        <div>
          <div className="billing-sale__field">
            <span className="billing-sale__label">
              Payment mode
              {!draft.paidNow && <span className="billing-sale__label-note">tick “paid now” to set one</span>}
            </span>
            <Segmented<PaymentMode>
              label="Payment mode"
              options={PAYMENT_MODES.map((mode) => ({ value: mode, label: PAYMENT_MODE_LABELS[mode] }))}
              value={draft.paidNow ? draft.paymentMode : null}
              disabled={!draft.paidNow}
              onChange={(paymentMode) => onChange({ paymentMode })}
            />
          </div>

          {draft.paidNow && (
            <div style={{ marginTop: 12 }}>
              <Field
                label="Received in"
                htmlFor="sale-settle-account"
                error={settleError}
                hint={
                  accountsFailed
                    ? 'Could not reach Smart Books for the cash and bank ledgers.'
                    : 'Cash and bank ledgers, as Smart Books holds them.'
                }
              >
                <select
                  id="sale-settle-account"
                  className={`billing-sale__control${settleError ? ' billing-sale__control--invalid' : ''}`}
                  value={draft.settleAccountId}
                  disabled={accountsLoading || accounts.length === 0}
                  onChange={(event) => onChange({ settleAccountId: event.target.value })}
                >
                  <option value="">
                    {accountsLoading ? 'Loading…' : accounts.length === 0 ? 'None available' : 'Choose a ledger…'}
                  </option>
                  {accounts.map((account) => (
                    <option key={account.acc_id} value={account.acc_id}>
                      {account.acc_name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          {/* Disabled, with the reason, rather than a drop zone that silently
              drops the file: this product has no document store, and one built
              inside it would be deleted by the next deploy. */}
          <div className="billing-sale-payment__attach" role="note">
            <strong>
              <Paperclip size={13} aria-hidden /> Attachment
            </strong>
            <span>
              Billing has nowhere to keep a file, so a PDF or photo cannot be attached to a bill here. Record where it is
              kept in the note.
            </span>
          </div>
        </div>

        <div>
          <Field
            label="Reference / note"
            note="optional"
            htmlFor="sale-note"
            hint="Printed on the bill by Smart Books."
          >
            <textarea
              id="sale-note"
              className="billing-sale__textarea"
              maxLength={NOTE_LIMIT}
              placeholder="Add a note for your customer…"
              value={draft.note}
              onChange={(event) => onChange({ note: event.target.value.slice(0, NOTE_LIMIT) })}
            />
          </Field>
          <p className="billing-sale-payment__count">
            {draft.note.length}/{NOTE_LIMIT}
          </p>

          <button type="button" className="billing-sale-payment__row" onClick={onEditTerms}>
            <span>
              <strong>
                <ScrollText size={13} aria-hidden /> Terms &amp; conditions
              </strong>
              {/* What is on THIS bill comes first: the company default only
                  matters while the bill carries nothing. */}
              <span>
                {draft.terms.trim() !== ''
                  ? 'On this bill — open to edit or remove them'
                  : hasTerms
                    ? 'This company has default terms — add them to this bill'
                    : 'No default terms set for sales bills yet'}
              </span>
            </span>
            <span aria-hidden>›</span>
          </button>
        </div>
      </div>
    </section>
  )
}
