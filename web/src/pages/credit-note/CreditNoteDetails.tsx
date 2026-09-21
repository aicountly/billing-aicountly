/**
 * Who, against what, why, and which kind of note this is.
 *
 * The four answers that decide everything below them: choosing the customer
 * reads their bills, choosing the bill proposes the lines, and choosing the
 * reason proposes whether goods are coming back. Each of those is a proposal
 * the person can overrule — the screen is trying to save typing, not to make
 * the decision.
 */

import { Hash, Info } from 'lucide-react'
import type { OriginalDocument } from '../../services/types'
import { CustomerField, Field, InvoiceField } from './fields'
import {
  CREDIT_REASONS,
  REMARKS_LIMIT,
  type CreditNoteDraft,
  type CreditNoteErrors,
  type ReturnMode,
} from './creditNote'

export interface CreditNoteDetailsProps {
  draft: CreditNoteDraft
  errors: CreditNoteErrors
  showErrors: boolean
  documents: OriginalDocument[]
  documentsLoading: boolean
  documentsFailed: boolean
  outstandingAvailable: boolean
  fyLabel: string | null
  onPatch: (patch: Partial<CreditNoteDraft>) => void
  onPickCustomer: (customer: CreditNoteDraft['customer']) => void
  onPickInvoice: (invoice: OriginalDocument | null) => void
  onPickReason: (reasonCode: string) => void
  onPickMode: (mode: ReturnMode) => void
  refs: {
    customer: React.RefObject<HTMLInputElement | null>
    invoice: React.RefObject<HTMLInputElement | null>
    date: React.RefObject<HTMLInputElement | null>
    reason: React.RefObject<HTMLSelectElement | null>
  }
}

export function CreditNoteDetails(props: CreditNoteDetailsProps) {
  const { draft, errors, showErrors, onPatch } = props
  const shown = (field: 'customer' | 'date' | 'invoice' | 'reasonCode' | 'remarks') =>
    showErrors ? errors[field] : undefined
  const reason = CREDIT_REASONS.find((option) => option.value === draft.reasonCode)

  return (
    <section className="billing-cn-card" aria-labelledby="billing-cn-details-title">
      <div className="billing-cn-card__head">
        <div>
          <h2 id="billing-cn-details-title">Credit note details</h2>
          <p>Who is being credited, against which bill, and why.</p>
        </div>
      </div>

      <div className="billing-cn-card__body">
        <div className="billing-cn-grid billing-cn-grid--three">
          <CustomerField
            value={draft.customer}
            onChange={props.onPickCustomer}
            error={shown('customer')}
            inputRef={props.refs.customer}
          />

          <Field
            label="Credit note date"
            required
            htmlFor="billing-cn-date"
            error={shown('date')}
            hint={shown('date') ? undefined : props.fyLabel ? `Inside ${props.fyLabel}.` : undefined}
          >
            <input
              id="billing-cn-date"
              ref={props.refs.date}
              type="date"
              className="billing-cn-control"
              value={draft.date}
              aria-invalid={shown('date') ? true : undefined}
              onChange={(event) => onPatch({ date: event.target.value })}
            />
          </Field>

          {/* Books numbers the note when it posts it, on this company's own
              series. There is nothing to show before then and nothing to
              regenerate, so the field says what will happen instead of
              printing a number this product would have had to invent. */}
          <Field
            label="Credit note number"
            htmlFor="billing-cn-number"
            hint="Smart Books numbers it on the company’s own series when the note is issued."
          >
            <div className="billing-cn-combo__input">
              <span className="billing-cn-combo__icon" aria-hidden>
                <Hash size={15} />
              </span>
              <input
                id="billing-cn-number"
                className="billing-cn-control"
                value="Allotted on issue"
                readOnly
                disabled
              />
            </div>
          </Field>
        </div>

        <div className="billing-cn-grid billing-cn-grid--two">
          <InvoiceField
            value={draft.invoice}
            documents={props.documents}
            loading={props.documentsLoading}
            failed={props.documentsFailed}
            outstandingAvailable={props.outstandingAvailable}
            onChange={props.onPickInvoice}
            error={shown('invoice')}
            disabled={!draft.customer}
            inputRef={props.refs.invoice}
          />

          <Field
            label="Reason"
            required
            htmlFor="billing-cn-reason"
            error={shown('reasonCode')}
            hint={shown('reasonCode') ? undefined : (reason?.hint ?? 'Kept with the note and shown on it.')}
          >
            <select
              id="billing-cn-reason"
              ref={props.refs.reason}
              className="billing-cn-control"
              value={draft.reasonCode}
              aria-invalid={shown('reasonCode') ? true : undefined}
              onChange={(event) => props.onPickReason(event.target.value)}
            >
              <option value="">Choose a reason…</option>
              {CREDIT_REASONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div
          className="billing-cn-modes"
          role="radiogroup"
          aria-label="What this credit note does"
        >
          <ModeOption
            checked={draft.mode === 'GOODS_RETURN'}
            title="Goods came back"
            detail="The items return to stock. Inventory adds them back when the note is issued."
            onSelect={() => props.onPickMode('GOODS_RETURN')}
          />
          <ModeOption
            checked={draft.mode === 'VALUE_ADJUSTMENT'}
            title="Value adjustment only"
            detail="Use this when the price was wrong or a discount was agreed afterwards. Nothing is returned to stock."
            onSelect={() => props.onPickMode('VALUE_ADJUSTMENT')}
          />
        </div>

        <Field
          label="Remarks"
          htmlFor="billing-cn-remarks"
          optional="Optional"
          error={shown('remarks')}
          hint={
            shown('remarks') ? undefined : (
              <>
                <Info size={13} aria-hidden /> Goes to Smart Books as the narration and stays with the note.
              </>
            )
          }
        >
          <div className="billing-cn-remarks">
            <textarea
              id="billing-cn-remarks"
              className="billing-cn-control"
              value={draft.remarks}
              maxLength={REMARKS_LIMIT}
              placeholder="Add any additional notes…"
              aria-invalid={shown('remarks') ? true : undefined}
              onChange={(event) => onPatch({ remarks: event.target.value })}
            />
            <span className="billing-cn-remarks__count" aria-live="polite">
              {draft.remarks.length}/{REMARKS_LIMIT}
            </span>
          </div>
        </Field>
      </div>
    </section>
  )
}

function ModeOption({
  checked,
  title,
  detail,
  onSelect,
}: {
  checked: boolean
  title: string
  detail: string
  onSelect: () => void
}) {
  return (
    <button type="button" role="radio" aria-checked={checked} className="billing-cn-mode" onClick={onSelect}>
      <span className="billing-cn-mode__dot" aria-hidden>
        <svg width="10" height="10" viewBox="0 0 10 10" focusable="false">
          <circle cx="5" cy="5" r="3.2" fill="currentColor" />
        </svg>
      </span>
      <span>
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
    </button>
  )
}
