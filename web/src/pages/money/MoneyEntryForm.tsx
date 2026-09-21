/**
 * The entry card: who, how much, out of what, and against which bills.
 *
 * The bill-by-bill allocation is the part of this screen that does real
 * accounting work, and it is kept exactly where it was — a payment applied to
 * the oldest bill first, with the remainder stated as sitting on account. It
 * has moved INTO this card rather than sitting below it, so the number being
 * applied and the number being typed are on screen together.
 */

import type { RefObject } from 'react'
import {
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Hash,
  Landmark,
  Loader2,
  Save,
  Search,
  WalletCards,
  X,
} from 'lucide-react'
import { useTypeahead, usePartySearch } from '../../components/LivePicker'
import type { CashBankAccount, CatalogParty } from '../../services/types'
import { DataTable, date as formatDate, money } from '../../ui'
import { fromPaise, purposesFor, PAYMENT_MODES, type Direction } from './money'
import { billKey, NARRATION_LIMIT, type OpenBill, type useMoneyForm } from './useMoneyForm'

type Form = ReturnType<typeof useMoneyForm>

export function MoneyEntryForm({
  direction,
  form,
  accounts,
  accountsLoading,
  bills,
  billsLoading,
  billsFailed,
  allocationOpen,
  onAllocationOpenChange,
  partyInputRef,
  partyChangeRef,
  amountInputRef,
  dateInputRef,
  referenceInputRef,
  onCancel,
  onExpense,
  canSave,
  saveAndNew,
  onSaveAndNewChange,
}: {
  direction: Direction
  form: Form
  accounts: CashBankAccount[]
  accountsLoading: boolean
  bills: OpenBill[]
  billsLoading: boolean
  billsFailed: boolean
  allocationOpen: boolean
  onAllocationOpenChange: (open: boolean) => void
  partyInputRef: RefObject<HTMLInputElement | null>
  partyChangeRef: RefObject<HTMLButtonElement | null>
  amountInputRef: RefObject<HTMLInputElement | null>
  dateInputRef: RefObject<HTMLInputElement | null>
  referenceInputRef: RefObject<HTMLInputElement | null>
  onCancel: () => void
  onExpense: () => void
  canSave: boolean
  saveAndNew: boolean
  onSaveAndNewChange: (value: boolean) => void
}) {
  const isOut = direction === 'out'
  const { values, errors } = form

  const search = usePartySearch(isOut ? 'supplier' : 'customer')
  const picker = useTypeahead<CatalogParty>({ search, onPick: form.pickParty })

  const selectedAccount = accounts.find((account) => String(account.acc_id) === values.accountId)
  const purposes = purposesFor(direction)

  return (
    <section className="billing-panel">
      <div className="billing-panel__heading">
        <div className="billing-money__card-heading">
          <span className="billing-money__card-mark" aria-hidden="true">
            <WalletCards size={21} />
          </span>
          <div>
            <h2>{isOut ? 'Create money paid entry' : 'Create money received entry'}</h2>
            <p>
              {isOut
                ? 'Make a payment to a supplier, expense or other party'
                : 'Record money received from a customer or other party'}
            </p>
          </div>
        </div>

        {/* One entry at a time is all this product records. The second tab is
            drawn because the workflow is planned, and disabled because there is
            no bulk endpoint behind it — a tab that opened an empty screen would
            be worse than one that says so. */}
        <div className="billing-segmented" role="group" aria-label="Entry type">
          <button type="button" className="billing-segmented__option" aria-pressed="true">
            Single payment
          </button>
          <button
            type="button"
            className="billing-segmented__option"
            aria-pressed="false"
            disabled
            title="Paying several parties in one go is not available yet."
          >
            Multiple payments
          </button>
        </div>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void form.save(saveAndNew)
        }}
        noValidate
      >
        <div className="billing-money__grid">
          {/* ------------------------------------------------------- party */}
          <div className="billing-field" ref={picker.boxRef} style={{ position: 'relative' }}>
            <label htmlFor="money-party">
              {isOut ? 'Supplier / Party' : 'Customer / Party'} <span className="billing-money__required">*</span>
            </label>

            {values.party ? (
              <div className="billing-money__shell">
                <span className="billing-money__icon" aria-hidden="true">
                  <Building2 size={15} />
                </span>
                <span className="billing-money__picked">
                  <span style={{ minWidth: 0 }}>
                    <span className="billing-money__picked-name">{values.party.name}</span>
                    {values.party.gstin && (
                      <span className="billing-money__picked-meta">GSTIN {values.party.gstin}</span>
                    )}
                  </span>
                </span>
                <button
                  ref={partyChangeRef}
                  type="button"
                  className="billing-money__clear"
                  onClick={() => {
                    form.clearParty()
                    picker.setTerm('')
                    window.setTimeout(() => partyInputRef.current?.focus(), 0)
                  }}
                  aria-label={`Change the ${isOut ? 'supplier' : 'customer'}, currently ${values.party.name}`}
                  title="Choose someone else"
                >
                  <X size={15} aria-hidden />
                </button>
              </div>
            ) : (
              <div className="billing-money__shell" data-invalid={errors.party ? 'true' : undefined}>
                <span className="billing-money__icon" aria-hidden="true">
                  <Search size={15} />
                </span>
                <input
                  id="money-party"
                  ref={partyInputRef}
                  value={picker.term}
                  role="combobox"
                  autoComplete="off"
                  aria-expanded={picker.open && picker.ready}
                  aria-controls="money-party-options"
                  aria-autocomplete="list"
                  aria-invalid={errors.party ? true : undefined}
                  aria-describedby={errors.party ? 'money-party-error' : undefined}
                  placeholder={isOut ? 'Search supplier, party or expense…' : 'Search customer or party…'}
                  onChange={(event) => {
                    picker.setTerm(event.target.value)
                    picker.setOpen(true)
                    form.clearError('party')
                  }}
                  onFocus={() => picker.setOpen(true)}
                  onKeyDown={picker.onKeyDown}
                />
              </div>
            )}

            {picker.open && picker.ready && !values.party && (
              <div id="money-party-options" role="listbox" aria-label="Matching parties" className="billing-money__options">
                {picker.busy && <p className="billing-money__option-note">Searching…</p>}
                {picker.failed && (
                  <p className="billing-money__option-note billing-money__option-note--error">
                    Could not reach the app that holds this list. Try again in a moment.
                  </p>
                )}
                {!picker.busy && !picker.failed && picker.options.length === 0 && (
                  <p className="billing-money__option-note">No matches.</p>
                )}
                {picker.options.map((option, index) => (
                  <button
                    key={option.acc_id}
                    type="button"
                    role="option"
                    aria-selected={index === picker.highlighted}
                    className="billing-money__option"
                    onMouseEnter={() => picker.setHighlighted(index)}
                    onClick={() => picker.choose(option)}
                  >
                    <span className="billing-money__option-name">{option.acc_name}</span>
                    <span className="billing-money__option-meta">
                      {isOut ? 'Supplier' : 'Customer'}
                      {option.gstin ? ` · GSTIN ${option.gstin}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {errors.party && (
              <span className="billing-field__error" id="money-party-error">
                {errors.party}
              </span>
            )}
          </div>

          {/* ------------------------------------------------------ amount */}
          <div className="billing-field">
            <label htmlFor="money-amount">
              Amount <span className="billing-money__required">*</span>
            </label>
            <div className="billing-money__shell" data-invalid={errors.amount ? 'true' : undefined}>
              <span className="billing-money__prefix" aria-hidden="true">
                ₹
              </span>
              <input
                id="money-amount"
                ref={amountInputRef}
                className="billing-money__amount"
                value={values.amount}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                aria-invalid={errors.amount ? true : undefined}
                aria-describedby={errors.amount ? 'money-amount-error' : undefined}
                onChange={(event) => form.setAmount(event.target.value)}
              />
            </div>
            {errors.amount && (
              <span className="billing-field__error" id="money-amount-error">
                {errors.amount}
              </span>
            )}
          </div>

          {/* -------------------------------------------------------- date */}
          <div className="billing-field">
            <label htmlFor="money-date">
              {isOut ? 'Payment date' : 'Receipt date'} <span className="billing-money__required">*</span>
            </label>
            <div className="billing-money__shell" data-invalid={errors.entryDate ? 'true' : undefined}>
              <span className="billing-money__icon" aria-hidden="true">
                <CalendarDays size={15} />
              </span>
              <input
                id="money-date"
                ref={dateInputRef}
                type="date"
                value={values.entryDate}
                aria-invalid={errors.entryDate ? true : undefined}
                aria-describedby={errors.entryDate ? 'money-date-error' : undefined}
                onChange={(event) => form.setEntryDate(event.target.value)}
              />
            </div>
            {errors.entryDate && (
              <span className="billing-field__error" id="money-date-error">
                {errors.entryDate}
              </span>
            )}
          </div>

          {/* --------------------------------------------------- paid from */}
          <div className="billing-field">
            <label htmlFor="money-account">
              {isOut ? 'Paid from' : 'Received in'} <span className="billing-money__required">*</span>
            </label>
            <div className="billing-money__shell" data-invalid={errors.accountId ? 'true' : undefined}>
              <span className="billing-money__icon" aria-hidden="true">
                <Landmark size={15} />
              </span>
              <select
                id="money-account"
                value={values.accountId}
                disabled={accountsLoading}
                aria-invalid={errors.accountId ? true : undefined}
                aria-describedby={errors.accountId ? 'money-account-error' : 'money-account-hint'}
                onChange={(event) => {
                  form.set('accountId', event.target.value)
                  form.clearError('accountId')
                }}
              >
                <option value="">{accountsLoading ? 'Loading accounts…' : 'Choose an account…'}</option>
                {accounts.map((account) => (
                  <option key={account.acc_id} value={account.acc_id}>
                    {account.acc_name}
                  </option>
                ))}
              </select>
            </div>
            {errors.accountId ? (
              <span className="billing-field__error" id="money-account-error">
                {errors.accountId}
              </span>
            ) : (
              /* Books' own name for the group this account sits in, when it
                 gives one. Never guessed from the account name. */
              selectedAccount?.group_name && (
                <span className="billing-field__hint" id="money-account-hint">
                  {selectedAccount.group_name}
                </span>
              )
            )}
          </div>

          {/* -------------------------------------------------------- mode */}
          <div className="billing-field">
            <label htmlFor="money-mode">
              Payment mode <span className="billing-money__required">*</span>
            </label>
            <div className="billing-money__shell" data-invalid={errors.mode ? 'true' : undefined}>
              <span className="billing-money__icon" aria-hidden="true">
                <CreditCard size={15} />
              </span>
              <select
                id="money-mode"
                value={values.mode}
                aria-invalid={errors.mode ? true : undefined}
                onChange={(event) => {
                  form.set('mode', event.target.value)
                  form.clearError('mode')
                }}
              >
                {PAYMENT_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* --------------------------------------------------- reference */}
          <div className="billing-field">
            <label htmlFor="money-reference">Reference no.</label>
            <div className="billing-money__shell">
              <input
                id="money-reference"
                ref={referenceInputRef}
                value={values.reference}
                autoComplete="off"
                placeholder={form.mode?.referencePlaceholder ?? 'Cheque / UTR / ref no.'}
                onChange={(event) => form.set('reference', event.target.value)}
              />
              <span className="billing-money__suffix" aria-hidden="true">
                <Hash size={15} />
              </span>
            </div>
          </div>
        </div>

        {/* ---------------------------------------------------- narration */}
        <div className="billing-field billing-money__field-full">
          <div className="billing-money__field-foot">
            <label htmlFor="money-narration">Remarks / narration</label>
            <span className="billing-field__hint" aria-hidden="true">
              {values.narration.length}/{NARRATION_LIMIT}
            </span>
          </div>
          <textarea
            id="money-narration"
            value={values.narration}
            maxLength={NARRATION_LIMIT}
            rows={3}
            placeholder="Enter payment details, purpose, or notes…"
            onChange={(event) => form.set('narration', event.target.value.slice(0, NARRATION_LIMIT))}
          />
          <span className="billing-sr-only" aria-live="polite">
            {NARRATION_LIMIT - values.narration.length} characters left
          </span>
        </div>

        {/* -------------------------------------------------------- chips */}
        <div className="billing-money__chips">
          <span className="billing-money__chips-label" id="money-purpose-label">
            Quick add:
          </span>
          <span className="billing-sr-only" id="money-purpose-help">
            These change how this entry is applied to open bills. They are not saved as a label.
          </span>
          {purposes.map((purpose) => (
            <button
              key={purpose.key}
              type="button"
              className="billing-money__chip"
              aria-pressed={values.purpose === purpose.key}
              aria-describedby="money-purpose-help"
              title={purpose.hint}
              onClick={() => {
                if (purpose.effect === 'go-to-expense') {
                  onExpense()
                  return
                }
                if (values.purpose === purpose.key) {
                  form.clearPurpose()
                  return
                }
                form.applyPurpose(purpose.key, purpose.effect)
                if (purpose.effect !== 'on-account' && bills.length > 0) onAllocationOpenChange(true)
              }}
            >
              {purpose.label}
            </button>
          ))}
        </div>

        {values.purpose && (
          <p className="billing-field__hint" style={{ marginTop: 8 }} aria-live="polite">
            {purposes.find((purpose) => purpose.key === values.purpose)?.hint}
          </p>
        )}

        {/* --------------------------------------------------- allocation */}
        {values.party && (
          <AllocationSection
            direction={direction}
            form={form}
            bills={bills}
            loading={billsLoading}
            failed={billsFailed}
            open={allocationOpen}
            onOpenChange={onAllocationOpenChange}
          />
        )}

        {/* ------------------------------------------------------- footer */}
        <footer className="billing-money__footer">
          <label className="billing-money__save-new">
            <input type="checkbox" checked={saveAndNew} onChange={(event) => onSaveAndNewChange(event.target.checked)} />
            <span>Save &amp; new</span>
          </label>

          <div className="billing-money__actions">
            <button type="button" className="billing-button" onClick={onCancel} disabled={form.saving}>
              Cancel
            </button>
            <button
              type="submit"
              className="billing-button billing-button--primary"
              disabled={form.saving || !canSave}
              title={canSave ? undefined : 'Your Billing profile cannot record this.'}
            >
              {form.saving ? (
                <>
                  <Loader2 size={15} className="spin" aria-hidden /> Saving…
                </>
              ) : (
                <>
                  <Save size={15} aria-hidden /> {isOut ? 'Save payment' : 'Save receipt'}
                </>
              )}
            </button>
          </div>
        </footer>
      </form>

      {/* Stated because this screen is used by people who key twenty of these
          between customers, and a shortcut nobody is told about is a shortcut
          nobody uses. */}
      <p className="billing-panel__footnote">
        Shortcuts: Alt+P {isOut ? 'supplier' : 'customer'} · Alt+A amount · Alt+D date · Ctrl/Cmd+Enter save
      </p>
    </section>
  )
}

/**
 * Which bills this money is against.
 *
 * Open bills come from Books each time a party is picked, for the reason the
 * whole product is built that way: allocating against a bill somebody settled
 * this morning is exactly what a stored copy would let you do.
 */
function AllocationSection({
  direction,
  form,
  bills,
  loading,
  failed,
  open,
  onOpenChange,
}: {
  direction: Direction
  form: Form
  bills: OpenBill[]
  loading: boolean
  failed: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const isOut = direction === 'out'
  const onAccountPaise = form.amountPaise - form.allocatedPaise
  const Chevron = open ? ChevronUp : ChevronDown

  return (
    <div className="billing-money__allocation" id="money-allocation">
      <div className="billing-money__allocation-head">
        <button
          type="button"
          className="billing-money__allocation-title billing-button billing-button--quiet billing-button--small"
          aria-expanded={open}
          aria-controls="money-allocation-body"
          onClick={() => onOpenChange(!open)}
        >
          <Chevron size={15} aria-hidden />
          {isOut ? 'Which bills is this against?' : 'Which invoices is this against?'}
          {!loading && !failed && <span className="billing-money__muted">({bills.length} open)</span>}
        </button>

        {open && bills.length > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={form.autoAllocate}
              style={{ width: 16, height: 16, minHeight: 'auto', accentColor: 'var(--billing-action)' }}
              onChange={(event) => form.setAutoAllocate(event.target.checked)}
            />
            Oldest first
          </label>
        )}
      </div>

      {open && (
        <div className="billing-money__allocation-body" id="money-allocation-body">
          {failed ? (
            <p className="billing-field__hint" style={{ padding: '14px 0' }}>
              Open {isOut ? 'bills' : 'invoices'} could not be read just now. You can still save this entry — it will
              sit on account.
            </p>
          ) : (
            <>
              <DataTable
                loading={loading}
                rows={bills}
                rowKey={billKey}
                empty={`Nothing outstanding — this will sit on account.`}
                columns={[
                  { key: 'bill', header: isOut ? 'Bill' : 'Invoice', render: (bill) => bill.bill_no ?? '—' },
                  { key: 'date', header: 'Dated', render: (bill) => formatDate(bill.bill_date) },
                  { key: 'due', header: 'Due', render: (bill) => formatDate(bill.due_date) },
                  {
                    key: 'balance',
                    header: 'Outstanding',
                    numeric: true,
                    render: (bill) => money(bill.balance),
                  },
                  {
                    key: 'apply',
                    header: 'Applying',
                    numeric: true,
                    render: (bill) => {
                      const key = billKey(bill)
                      return (
                        <>
                          <label className="billing-sr-only" htmlFor={`money-apply-${key}`}>
                            Amount applied to {bill.bill_no ?? 'this bill'}
                          </label>
                          <input
                            id={`money-apply-${key}`}
                            className="billing-money__allocation-input"
                            value={form.allocations[key] ?? ''}
                            inputMode="decimal"
                            disabled={form.autoAllocate}
                            onChange={(event) => form.setAllocation(key, event.target.value)}
                          />
                        </>
                      )
                    },
                  },
                ]}
              />

              {bills.length > 0 && (
                <div className="billing-money__allocation-totals">
                  <span className="billing-money__allocation-total">
                    Applied <strong>{money(fromPaise(form.allocatedPaise))}</strong>
                  </span>
                  <span
                    className={`billing-money__allocation-total${onAccountPaise < 0 ? ' billing-money__allocation-total--over' : ''}`}
                  >
                    On account <strong>{money(fromPaise(onAccountPaise))}</strong>
                  </span>
                </div>
              )}

              {form.errors.allocations && (
                <p className="billing-field__error" role="alert" style={{ textAlign: 'right', marginBottom: 0 }}>
                  {form.errors.allocations}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
