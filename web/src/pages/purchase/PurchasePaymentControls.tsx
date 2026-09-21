/**
 * Whether this bill is already paid, and anything else worth writing down.
 *
 * "Paid now" is the backend's `settled_to_account_id`: naming the cash or bank
 * account is what makes Smart Books create the payment side of the purchase.
 * There is no separate payment-mode field on a purchase in this API — the
 * ACCOUNT is the mode, which is why the control asks which account rather than
 * offering a list of words nothing would be saved from.
 */

import { CreditCard } from 'lucide-react'
import type { CashBankAccount } from '../../services/types'
import { Field } from './PurchaseFields'
import type { PurchaseForm } from './model'
import type { PurchaseErrors } from './usePurchaseForm'

export function PurchasePaymentControls({
  form,
  errors,
  showErrors,
  cashBank,
  cashBankFailed,
  onPatch,
}: {
  form: PurchaseForm
  errors: PurchaseErrors
  showErrors: boolean
  cashBank: CashBankAccount[]
  cashBankFailed: boolean
  onPatch: (partial: Partial<PurchaseForm>) => void
}) {
  return (
    <section className="purchase-card" aria-labelledby="purchase-payment-heading">
      <div className="purchase-card__head">
        <span className="purchase-card__mark" aria-hidden>
          <CreditCard size={17} />
        </span>
        <div>
          <h2 id="purchase-payment-heading">Payment &amp; Purchase Controls</h2>
          <p>Set payment details and additional notes</p>
        </div>
      </div>

      <label className="purchase-check">
        <input
          type="checkbox"
          checked={form.paidNow}
          onChange={(event) => {
            const paidNow = event.target.checked
            onPatch({
              paidNow,
              // First account by default, the same convention the counter's
              // screens use. Cleared again when the box is unticked so nothing
              // unused is sent.
              settleAccountId:
                paidNow && form.settleAccountId === '' && cashBank.length > 0
                  ? String(cashBank[0].acc_id)
                  : paidNow
                    ? form.settleAccountId
                    : '',
            })
          }}
        />
        <span>
          Paid now (cash purchase)
          <span>
            {form.paidNow
              ? 'Smart Books will record the payment alongside the bill.'
              : 'Leave unticked and this stays outstanding under Money to Pay.'}
          </span>
        </span>
      </label>

      <div className="purchase-grid purchase-grid--2">
        <Field
          label="Paid from"
          htmlFor="purchase-settle-account"
          required={form.paidNow}
          error={showErrors ? errors.settleAccount : undefined}
          hint={
            cashBankFailed
              ? 'Couldn’t load your cash and bank accounts from Smart Books.'
              : 'The account the money left. This is what records how it was paid.'
          }
        >
          <select
            id="purchase-settle-account"
            className={`purchase-select${showErrors && errors.settleAccount ? ' is-invalid' : ''}`}
            aria-invalid={showErrors && Boolean(errors.settleAccount)}
            value={form.settleAccountId}
            disabled={!form.paidNow}
            onChange={(event) => onPatch({ settleAccountId: event.target.value })}
          >
            <option value="">{cashBank.length === 0 ? 'No cash or bank accounts' : 'Select account'}</option>
            {cashBank.map((account) => (
              <option key={account.acc_id} value={account.acc_id}>
                {account.acc_name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Reference No."
          htmlFor="purchase-reference"
          hint="Kept on the voucher so the payment can be matched later."
        >
          <input
            id="purchase-reference"
            type="text"
            className="purchase-input"
            placeholder="e.g. UTR / Cheque no."
            value={form.referenceNo}
            disabled={!form.paidNow}
            onChange={(event) => onPatch({ referenceNo: event.target.value })}
          />
        </Field>
      </div>

      <div style={{ marginTop: 12 }}>
        <Field label="Purchase Note" htmlFor="purchase-note" hint="Saved as the voucher narration.">
          <textarea
            id="purchase-note"
            className="purchase-textarea"
            placeholder="Add any note (optional)..."
            value={form.note}
            onChange={(event) => onPatch({ note: event.target.value })}
          />
        </Field>
      </div>
    </section>
  )
}
