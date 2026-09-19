/**
 * The three cards beside the form.
 *
 * ABOUT THE ASSISTANT. There is no model behind it and it does not say there
 * is. This deployment has no assistant service and no receipt-matching
 * endpoint — see docs/BILLING_API_DEPENDENCIES.md — so the card does the one
 * thing that can be done honestly and instantly: it reads the customer's open
 * bills from Smart Books and fills the receipt in, oldest bill first. Every
 * figure it puts on the screen stays editable, and nothing is posted until the
 * person presses Save. When a matching service does exist, it arrives behind
 * this same button; until then the card describes what it actually does.
 */

import { Link } from 'react-router-dom'
import { Lightbulb, Sparkles, UserRound, X } from 'lucide-react'
import { date as formatDate, money } from '../../ui'
import { SkeletonRows } from '../../dashboards/kit'
import type { OpenBill, ReceiptRow } from './data'
import { fromPaise, modeWords, type ChosenParty } from './form'

export function ReceiptAssistant({
  party,
  bills,
  loading,
  outstandingPaise,
  onFill,
  onDismiss,
}: {
  party: ChosenParty | null
  bills: OpenBill[]
  loading: boolean
  outstandingPaise: number
  onFill: () => void
  onDismiss: () => void
}) {
  const ready = Boolean(party) && !loading && bills.length > 0

  const explanation = !party
    ? 'Choose a customer and this will read their open bills from Smart Books.'
    : loading
      ? 'Reading this customer’s open bills…'
      : bills.length === 0
        ? 'This customer has no open bills, so there is nothing to match. Record it as a plain receipt or an advance.'
        : `${bills.length} open ${bills.length === 1 ? 'bill' : 'bills'} worth ${money(
            fromPaise(outstandingPaise),
          )}. Fill the receipt from them, oldest first — you can change anything before saving.`

  return (
    <section className="billing-receipt-assistant" aria-labelledby="receipt-assistant-title">
      <button type="button" className="billing-receipt-dismiss" onClick={onDismiss} aria-label="Hide the assistant">
        <X size={16} aria-hidden />
      </button>

      <div className="billing-receipt-assistant__head">
        <span className="billing-receipt-mark billing-receipt-mark--sm" aria-hidden="true">
          <Sparkles size={17} />
        </span>
        <div>
          <h2 id="receipt-assistant-title">Assistant</h2>
          <p>{explanation}</p>
        </div>
      </div>

      <div style={{ marginTop: 13, marginLeft: 43 }}>
        <button
          type="button"
          className="billing-button billing-button--primary billing-button--small"
          disabled={!ready}
          onClick={onFill}
        >
          <Sparkles size={14} aria-hidden /> Fill from open bills
        </button>
      </div>
    </section>
  )
}

/**
 * What this customer owes, and what they have paid lately.
 *
 * Outstanding and overdue are Smart Books' bill-by-bill for this one account.
 * A credit limit is NOT shown as a figure, because no product in this
 * deployment serves one: an invented limit on a screen where somebody decides
 * whether to accept an order is worse than a dash.
 */
export function CustomerSummary({
  party,
  dues,
  payments,
  paymentsAllowed,
  paymentsLoading,
  mayViewLedger,
}: {
  party: ChosenParty | null
  dues: { total: number | null; overdue: number | null; loading: boolean; error: string | null; allowed: boolean }
  payments: ReceiptRow[]
  paymentsAllowed: boolean
  paymentsLoading: boolean
  mayViewLedger: boolean
}) {
  return (
    <section className="billing-panel" aria-labelledby="customer-summary-title">
      <div className="billing-panel__heading" style={{ marginBottom: 0 }}>
        <div className="billing-receipt-cardhead__title">
          <span className="billing-receipt-mark billing-receipt-mark--sm" aria-hidden="true">
            <UserRound size={16} />
          </span>
          <h2 id="customer-summary-title" style={{ fontSize: 14.5 }}>
            Customer summary
          </h2>
        </div>

        {party && mayViewLedger && (
          <Link
            className="billing-button billing-button--small"
            style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
            to={`/parties/${party.id}`}
          >
            View ledger
          </Link>
        )}
      </div>

      {!party ? (
        <p style={{ margin: '14px 0 0', color: 'var(--billing-muted)', fontSize: 13 }}>
          Choose a customer to see what they owe, how much of it is late, and what they have paid recently.
        </p>
      ) : (
        <>
          <div className="billing-receipt-party" style={{ marginTop: 14 }}>
            <span className="billing-receipt-avatar" aria-hidden="true">
              {initials(party.name)}
            </span>
            <span style={{ minWidth: 0 }}>
              <strong>{party.name}</strong>
              <span>{party.gstin ?? 'No GSTIN on record'}</span>
            </span>
          </div>

          <div className="billing-receipt-metrics">
            <Metric
              label="Outstanding"
              tone="danger"
              loading={dues.loading}
              value={dues.total}
              unavailable={!dues.allowed ? 'Your Billing profile does not show what is owed.' : dues.error}
            />
            <Metric
              label="Overdue"
              tone="danger"
              loading={dues.loading}
              value={dues.overdue}
              unavailable={!dues.allowed ? 'Your Billing profile does not show what is owed.' : dues.error}
            />
            <Metric
              label="Credit limit"
              tone="muted"
              loading={false}
              value={null}
              unavailable="No product in this deployment holds a credit limit for a customer."
            />
          </div>

          <div className="billing-receipt-history">
            <div className="billing-receipt-history__head">
              <strong>Recent payments from this customer</strong>
              {mayViewLedger && (
                <Link to={`/parties/${party.id}`} style={{ fontSize: 12 }}>
                  View all
                </Link>
              )}
            </div>

            {!paymentsAllowed ? (
              <p style={{ margin: '8px 0 0', color: 'var(--billing-muted)', fontSize: 12 }}>
                Your Billing profile does not include the receipt register, so past receipts are not listed here.
              </p>
            ) : paymentsLoading ? (
              <SkeletonRows rows={3} />
            ) : payments.length === 0 ? (
              <p style={{ margin: '8px 0 0', color: 'var(--billing-muted)', fontSize: 12 }}>
                No receipts from this customer in the last 90 days.
              </p>
            ) : (
              payments.slice(0, 3).map((row, index) => (
                <div className="billing-receipt-history__row" key={row.voucher_id ?? `${row.document_no}-${index}`}>
                  <span>{formatDate(row.date)}</span>
                  <b>{row.amount === null ? '—' : money(row.amount)}</b>
                  <span>{row.reference_no ?? row.document_no ?? '—'}</span>
                  <span style={{ textAlign: 'right' }}>{modeWords(row.payment_mode)}</span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </section>
  )
}

function Metric({
  label,
  value,
  tone,
  loading,
  unavailable,
}: {
  label: string
  value: number | null
  tone: 'danger' | 'info' | 'muted'
  loading: boolean
  unavailable?: string | null
}) {
  const missing = value === null || Boolean(unavailable)

  return (
    <div className={`billing-receipt-metric billing-receipt-metric--${missing ? 'muted' : tone}`} title={unavailable ?? undefined}>
      <span>{label}</span>
      {loading ? (
        <span className="billing-skeleton billing-skeleton--line" style={{ marginTop: 6, height: 16 }} />
      ) : (
        <strong>{missing ? '—' : money(value)}</strong>
      )}
    </div>
  )
}

export function ReceiptTips({ onDismiss }: { onDismiss: () => void }) {
  return (
    <section className="billing-receipt-tips" aria-labelledby="receipt-tips-title">
      <button type="button" className="billing-receipt-dismiss" onClick={onDismiss} aria-label="Hide these tips">
        <X size={16} aria-hidden />
      </button>

      <div className="billing-receipt-tips__layout">
        <span className="billing-receipt-tips__mark" aria-hidden="true">
          <Lightbulb size={17} />
        </span>
        <div>
          <h2 id="receipt-tips-title">Tips</h2>
          <ul>
            <li>Use <strong>Against invoice</strong> to choose exactly which bills this money clears.</li>
            <li>A receipt with money left over sits on account until a later bill is settled against it.</li>
            <li>Use <strong>Advance</strong> when the money arrived before the bill did.</li>
          </ul>
        </div>
      </div>
    </section>
  )
}

/** Two letters from a real name; a blank rather than a punctuation mark. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
  return /[a-z0-9]/i.test(letters) ? letters.toUpperCase() : ''
}
