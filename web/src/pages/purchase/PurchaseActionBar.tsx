/**
 * The one place this screen is saved from.
 *
 * Pinned to the bottom, so on a long bill the primary action is never scrolled
 * away from — and the buttons are disabled while a save is in flight, because
 * the classic small-business complaint is the network hiccuping, the user
 * pressing Save again, and the supplier getting two bills. (The backend guards
 * that too, with an idempotency key per request row; this is the half of it
 * that stops the second press happening at all.)
 */

import { Check, Loader2, Save } from 'lucide-react'

export function PurchaseActionBar({
  saving,
  mayCreate,
  blocked,
  onCancel,
  onSaveAndNew,
  onSave,
}: {
  saving: boolean
  mayCreate: boolean
  /** Shown beside the buttons once a save attempt has found something wrong. */
  blocked: string | null
  onCancel: () => void
  onSaveAndNew: () => void
  onSave: () => void
}) {
  const disabled = saving || !mayCreate

  return (
    <footer className="purchase-actions">
      <p className="purchase-actions__status" role="status">
        {saving ? (
          <>
            <Loader2 size={14} aria-hidden className="spin" />
            Sending this to Smart Books…
          </>
        ) : !mayCreate ? (
          'Your Billing profile cannot record a purchase.'
        ) : blocked ? (
          <span style={{ color: 'var(--billing-danger)' }}>{blocked}</span>
        ) : (
          'Smart Books posts the voucher when you save.'
        )}
      </p>

      <button type="button" className="purchase-btn" onClick={onCancel} disabled={saving}>
        Cancel
      </button>

      {/*
        There is no draft state in this product. A transaction request is
        PENDING, POSTING, POSTED, FAILED or CANCELLED — nothing stores an
        unfinished bill, so a "draft" here would either be a lie or a second,
        private copy of a purchase. It is shown disabled and says so.

        THE INTEGRATION POINT: when the backend grows a DRAFT status on
        billing_transaction_requests, this button posts the same payload with
        that status and the context strip's "Draft" card reads it back.
      */}
      <button
        type="button"
        className="purchase-btn"
        disabled
        title="Drafts aren’t available yet — this product stores a purchase only once Smart Books has it."
      >
        Save as Draft
      </button>

      <button type="button" className="purchase-btn" onClick={onSaveAndNew} disabled={disabled}>
        <Save size={15} aria-hidden />
        Save &amp; New
      </button>

      <button type="button" className="purchase-btn purchase-btn--primary" onClick={onSave} disabled={disabled}>
        {saving ? <Loader2 size={15} aria-hidden className="spin" /> : <Check size={15} aria-hidden />}
        {saving ? 'Saving…' : 'Save Purchase'}
      </button>
    </footer>
  )
}
