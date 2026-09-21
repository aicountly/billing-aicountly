/**
 * The three controls the credit note screen needs that the UI kit has not got:
 * a labelled field, the customer search, and the bill picker.
 *
 * Both pickers are the app's own `useTypeahead` with different markup, which
 * is what that hook was split out for — the debounce, the abort on every new
 * term and the highlight that has to survive a late response are the parts
 * with the sharp edges, and a second copy of them would be a second set of
 * those bugs.
 */

import { useMemo, type ReactNode } from 'react'
import { AlertCircle, Building2, Check, FileText, Search, X } from 'lucide-react'
import { useTypeahead, usePartySearch } from '../../components/LivePicker'
import type { CatalogParty, OriginalDocument } from '../../services/types'
import { date as formatDate, money } from '../../ui'

export function Field({
  label,
  htmlFor,
  required,
  optional,
  hint,
  error,
  children,
}: {
  label: string
  htmlFor?: string
  required?: boolean
  optional?: string
  hint?: ReactNode
  error?: string
  children: ReactNode
}) {
  const describedBy = error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined

  return (
    <div className="billing-cn-field">
      <label className="billing-cn-field__label" htmlFor={htmlFor}>
        <span>
          {label}
          {required && (
            <>
              {' '}
              <span className="billing-cn-field__required" aria-hidden>
                *
              </span>
              <span className="billing-sr-only">(required)</span>
            </>
          )}
        </span>
        {optional && <span className="billing-cn-field__optional">{optional}</span>}
      </label>
      {children}
      {error ? (
        <span className="billing-cn-field__error" id={describedBy} role="alert">
          <AlertCircle size={13} aria-hidden />
          {error}
        </span>
      ) : (
        hint && (
          <span className="billing-cn-field__hint" id={describedBy}>
            {hint}
          </span>
        )
      )}
    </div>
  )
}

/**
 * The customer, searched live in Books through this product's own endpoint.
 *
 * Nothing is prefetched and nothing survives the choice except the account id
 * and the name to show next to it.
 */
export function CustomerField({
  value,
  onChange,
  error,
  disabled,
  inputRef,
}: {
  value: CatalogParty | null
  onChange: (party: CatalogParty | null) => void
  error?: string
  disabled?: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
}) {
  const search = usePartySearch('customer')
  const picker = useTypeahead<CatalogParty>({ search, onPick: onChange })
  const listId = 'billing-cn-customer-list'

  if (value) {
    return (
      <Field label="Customer" required htmlFor="billing-cn-customer">
        <div className="billing-cn-combo__chosen">
          <span className="billing-cn-insight__icon billing-cn-insight__icon--green" aria-hidden>
            <Building2 size={17} />
          </span>
          <span className="billing-cn-combo__chosen-body">
            <strong>{value.acc_name}</strong>
            <span>{value.gstin ? `GSTIN ${value.gstin}` : 'No GSTIN on this account'}</span>
          </span>
          <button
            type="button"
            className="billing-cn-combo__clear"
            onClick={() => onChange(null)}
            aria-label={`Change the customer, currently ${value.acc_name}`}
            disabled={disabled}
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      </Field>
    )
  }

  return (
    <Field
      label="Customer"
      required
      htmlFor="billing-cn-customer"
      error={error}
      hint={error ? undefined : 'Search by name or GSTIN.'}
    >
      <div className="billing-cn-combo" ref={picker.boxRef}>
        <div className="billing-cn-combo__input">
          <span className="billing-cn-combo__icon" aria-hidden>
            <Search size={15} />
          </span>
          <input
            id="billing-cn-customer"
            ref={inputRef}
            className="billing-cn-control"
            value={picker.term}
            disabled={disabled}
            placeholder="Search and select a customer…"
            role="combobox"
            aria-expanded={picker.open && picker.ready}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            onChange={(event) => {
              picker.setTerm(event.target.value)
              picker.setOpen(true)
            }}
            onFocus={() => picker.setOpen(true)}
            onKeyDown={picker.onKeyDown}
          />
        </div>

        {picker.open && picker.ready && (
          <div className="billing-cn-combo__list" id={listId} role="listbox" aria-label="Customers">
            {picker.busy && <p className="billing-cn-combo__note">Searching…</p>}
            {picker.failed && (
              <p className="billing-cn-combo__note billing-cn-combo__note--bad">
                Could not reach the app that holds this list. Try again in a moment.
              </p>
            )}
            {!picker.busy && !picker.failed && picker.options.length === 0 && (
              <p className="billing-cn-combo__note">No customer matches that.</p>
            )}
            {picker.options.map((party, index) => (
              <button
                key={party.acc_id}
                type="button"
                role="option"
                aria-selected={index === picker.highlighted}
                data-active={index === picker.highlighted}
                className="billing-cn-combo__option"
                onMouseEnter={() => picker.setHighlighted(index)}
                onClick={() => picker.choose(party)}
              >
                <span className="billing-cn-combo__line">
                  <strong>{party.acc_name}</strong>
                </span>
                {party.gstin && <span className="billing-cn-combo__meta">GSTIN {party.gstin}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </Field>
  )
}

/**
 * The bill this note is against.
 *
 * The list is the customer's own documents, already read from Books when the
 * customer was chosen, so the filtering here is local and instant. Each row
 * carries the value and what is still unpaid on it — the two figures somebody
 * checks before crediting anything.
 */
export function InvoiceField({
  value,
  documents,
  loading,
  failed,
  outstandingAvailable,
  onChange,
  error,
  disabled,
  inputRef,
}: {
  value: OriginalDocument | null
  documents: OriginalDocument[]
  loading: boolean
  failed: boolean
  outstandingAvailable: boolean
  onChange: (document: OriginalDocument | null) => void
  error?: string
  disabled?: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
}) {
  // A local filter over a list that is already here: no debounce to wait out
  // and no request to abort, so the hook's search resolves immediately.
  const search = useMemo(
    () => async (term: string) => {
      const needle = term.trim().toLowerCase()
      if (needle === '') return documents

      return documents.filter((document) =>
        [document.document_no, document.date, document.amount?.toFixed(2)]
          .filter((part): part is string => typeof part === 'string')
          .some((part) => part.toLowerCase().includes(needle)),
      )
    },
    [documents],
  )

  const picker = useTypeahead<OriginalDocument>({ search, onPick: onChange, minChars: 0, debounceMs: 0 })
  const listId = 'billing-cn-invoice-list'

  if (value) {
    return (
      <Field label="Against bill" required htmlFor="billing-cn-invoice">
        <div className="billing-cn-combo__chosen">
          <span className="billing-cn-insight__icon billing-cn-insight__icon--blue" aria-hidden>
            <FileText size={17} />
          </span>
          <span className="billing-cn-combo__chosen-body">
            <strong>{value.document_no ?? 'Bill'}</strong>
            <span>
              {formatDate(value.date)}
              {value.amount !== null && ` · ${money(value.amount)}`}
              {value.outstanding != null && ` · ${money(value.outstanding)} unpaid`}
            </span>
          </span>
          <button
            type="button"
            className="billing-cn-combo__clear"
            onClick={() => onChange(null)}
            aria-label={`Change the bill, currently ${value.document_no ?? 'the selected bill'}`}
            disabled={disabled}
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      </Field>
    )
  }

  return (
    <Field
      label="Against bill"
      required
      htmlFor="billing-cn-invoice"
      error={error}
      hint={
        error
          ? undefined
          : disabled
            ? 'Choose the customer first and their bills appear here.'
            : outstandingAvailable
              ? 'Their bills from the last year, with what is still unpaid.'
              : 'Their bills from the last year.'
      }
    >
      <div className="billing-cn-combo" ref={picker.boxRef}>
        <div className="billing-cn-combo__input">
          <span className="billing-cn-combo__icon" aria-hidden>
            <Search size={15} />
          </span>
          <input
            id="billing-cn-invoice"
            ref={inputRef}
            className="billing-cn-control"
            value={picker.term}
            disabled={disabled}
            placeholder={disabled ? 'Choose a customer first…' : 'Search and select a bill…'}
            role="combobox"
            aria-expanded={picker.open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            onChange={(event) => {
              picker.setTerm(event.target.value)
              picker.setOpen(true)
            }}
            onFocus={() => picker.setOpen(true)}
            onKeyDown={picker.onKeyDown}
          />
        </div>

        {picker.open && !disabled && (
          <div className="billing-cn-combo__list" id={listId} role="listbox" aria-label="Bills">
            {loading && <p className="billing-cn-combo__note">Reading this customer’s bills…</p>}
            {failed && (
              <p className="billing-cn-combo__note billing-cn-combo__note--bad">
                Smart Books did not answer. You can still raise the note without a reference.
              </p>
            )}
            {!loading && !failed && picker.options.length === 0 && (
              <p className="billing-cn-combo__note">
                {documents.length === 0
                  ? 'Nothing on record for this customer in the last year.'
                  : 'No bill matches that.'}
              </p>
            )}
            {picker.options.map((document, index) => (
              <button
                key={String(document.voucher_id ?? document.document_no)}
                type="button"
                role="option"
                aria-selected={index === picker.highlighted}
                data-active={index === picker.highlighted}
                className="billing-cn-combo__option"
                onMouseEnter={() => picker.setHighlighted(index)}
                onClick={() => picker.choose(document)}
              >
                <span className="billing-cn-combo__line">
                  <strong>{document.document_no ?? 'Bill'}</strong>
                  <span className="billing-cn-combo__meta billing-cn-combo__meta--strong">
                    {document.amount === null ? '—' : money(document.amount)}
                  </span>
                </span>
                <span className="billing-cn-combo__line">
                  <span className="billing-cn-combo__meta">{formatDate(document.date)}</span>
                  {document.outstanding != null && (
                    <span className="billing-cn-combo__meta">
                      {document.outstanding <= 0.005 ? (
                        <>
                          <Check size={11} aria-hidden /> settled
                        </>
                      ) : (
                        `${money(document.outstanding)} unpaid`
                      )}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Field>
  )
}
