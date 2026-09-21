/**
 * Withdrawal details — the card a bank withdrawal is actually typed into.
 *
 * It owns no data. Both account lists are read live from Books through this
 * product's own endpoints and handed in; the draft and the save live in
 * BankWithdrawalPage. That split is what lets the panel beside it put values
 * into these fields without this component knowing it exists.
 */

import { useId, type ReactNode, type RefObject } from 'react'
import { AlertCircle, ArrowRightLeft, Info, Loader2, RotateCcw, Save } from 'lucide-react'
import { money } from '../../ui'
import { groupAmount, NOTE_LIMIT, parseAmount, type WithdrawalDraft, type WithdrawalErrors, type WithdrawalField } from './withdrawalForm'
import type { AccountOption } from './accounts'

export type SaveMode = 'save' | 'save-new'

export interface AccountListState {
  loading: boolean
  error: string | null
  reload: () => void
}

export interface WithdrawalFormCardProps {
  draft: WithdrawalDraft
  onChange: (patch: Partial<WithdrawalDraft>) => void
  errors: WithdrawalErrors
  /** Errors stay quiet until the first save attempt, then follow every keystroke. */
  showErrors: boolean
  currency: string
  bankOptions: AccountOption[]
  cashOptions: AccountOption[]
  accounts: AccountListState
  selectedBank: AccountOption | null
  saving: SaveMode | null
  dirty: boolean
  onSave: (mode: SaveMode) => void
  onClear: () => void
  fieldRefs: {
    amount: RefObject<HTMLInputElement | null>
    date: RefObject<HTMLInputElement | null>
    bank: RefObject<HTMLSelectElement | null>
    cash: RefObject<HTMLSelectElement | null>
  }
}

export function WithdrawalFormCard(props: WithdrawalFormCardProps) {
  const { draft, onChange, errors, showErrors, saving } = props
  const shown = (field: WithdrawalField) => (showErrors ? errors[field] : undefined)
  const busy = saving !== null

  return (
    <form
      className="billing-withdrawal-card"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        props.onSave('save')
      }}
    >
      <div className="billing-withdrawal-card__head">
        <h2>Withdrawal details</h2>
        <p>Enter the withdrawal information below.</p>
      </div>

      <div className="billing-withdrawal-grid">
        <AmountField
          value={draft.amount}
          currency={props.currency}
          error={shown('amount')}
          inputRef={props.fieldRefs.amount}
          onChange={(amount) => onChange({ amount })}
        />

        <Field id="withdrawal-date" label="Date" required error={shown('date')} hint="The date the cash left the bank">
          {(ids) => (
            <input
              {...ids}
              ref={props.fieldRefs.date}
              type="date"
              className={`billing-withdrawal-control${shown('date') ? ' billing-withdrawal-control--invalid' : ''}`}
              value={draft.date}
              onChange={(event) => onChange({ date: event.target.value })}
            />
          )}
        </Field>

        <AccountField
          id="withdrawal-bank"
          label="Bank account (taken from)"
          placeholder="Choose the bank account"
          emptyText="No bank accounts in this company yet. Bank ledgers are added in Smart Books."
          hint={bankHint(props.selectedBank)}
          options={props.bankOptions}
          accounts={props.accounts}
          value={draft.bankAccountId}
          error={shown('bankAccountId')}
          selectRef={props.fieldRefs.bank}
          onChange={(bankAccountId) => onChange({ bankAccountId })}
        />

        <AccountField
          id="withdrawal-cash"
          label="Into cash account"
          placeholder="Choose the cash account"
          emptyText="No cash accounts in this company yet. Cash ledgers are added in Smart Books."
          hint="Record withdrawal into this cash account"
          options={props.cashOptions}
          accounts={props.accounts}
          value={draft.cashAccountId}
          error={shown('cashAccountId')}
          selectRef={props.fieldRefs.cash}
          onChange={(cashAccountId) => onChange({ cashAccountId })}
        />

        <Field
          id="withdrawal-reference"
          label="Reference / Cheque details"
          error={shown('reference')}
          hint="Enter cheque number, UTR number or reference"
        >
          {(ids) => (
            <input
              {...ids}
              className="billing-withdrawal-control"
              value={draft.reference}
              autoComplete="off"
              placeholder="e.g. Cheque no., UTR, Slip no."
              onChange={(event) => onChange({ reference: event.target.value })}
            />
          )}
        </Field>

        <Field
          id="withdrawal-note"
          label="Notes (optional)"
          error={shown('note')}
          hint="Purpose, remarks or any additional details"
          count={draft.note.length > NOTE_LIMIT - 100 ? `${draft.note.length}/${NOTE_LIMIT}` : undefined}
        >
          {(ids) => (
            <textarea
              {...ids}
              className="billing-withdrawal-control"
              value={draft.note}
              maxLength={NOTE_LIMIT}
              placeholder="Add a note…"
              onChange={(event) => onChange({ note: event.target.value })}
            />
          )}
        </Field>
      </div>

      {/* Informational, not a warning: it says what the button is about to do. */}
      <p className="billing-withdrawal-strip">
        <Info size={16} aria-hidden />
        <span>
          This will create a <strong>bank withdrawal</strong> entry moving money from your selected bank account to
          cash. Smart Books makes the accounting entry and gives it its number.
        </span>
      </p>

      <div className="billing-withdrawal-actions">
        <button
          type="button"
          className="billing-button billing-button--quiet"
          onClick={props.onClear}
          disabled={busy || !props.dirty}
          title={props.dirty ? undefined : 'Nothing has been entered yet'}
        >
          <RotateCcw size={15} aria-hidden /> Clear all
        </button>

        <div className="billing-withdrawal-actions__right">
          <button
            type="button"
            className="billing-button"
            disabled={busy}
            onClick={() => props.onSave('save-new')}
          >
            {saving === 'save-new' ? <Loader2 size={15} aria-hidden className="spin" /> : <ArrowRightLeft size={15} aria-hidden />}
            {saving === 'save-new' ? 'Saving…' : 'Save & New'}
          </button>

          <button type="submit" className="billing-button billing-button--primary" disabled={busy}>
            {saving === 'save' ? <Loader2 size={15} aria-hidden className="spin" /> : <Save size={15} aria-hidden />}
            {saving === 'save' ? 'Saving…' : 'Save withdrawal'}
          </button>
        </div>
      </div>
    </form>
  )
}

/** What to say under the bank dropdown once one is chosen. */
function bankHint(bank: AccountOption | null): ReactNode {
  if (!bank) return 'The bank ledger the cash was drawn from'
  if (bank.balance === null) return 'Balance not shown with your Billing profile'

  return `Available balance: ${money(bank.balance)}`
}

// ---------------------------------------------------------------------------
// One field, its label, and whatever it has to say for itself
// ---------------------------------------------------------------------------

interface ControlIds {
  id: string
  'aria-invalid'?: true
  'aria-describedby'?: string
  'aria-required'?: true
}

function Field({
  id,
  label,
  required = false,
  error,
  hint,
  count,
  children,
}: {
  id: string
  label: string
  required?: boolean
  error?: string
  hint?: ReactNode
  count?: string
  children: (ids: ControlIds) => ReactNode
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  const ids: ControlIds = {
    id,
    ...(error ? { 'aria-invalid': true as const } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(required ? { 'aria-required': true as const } : {}),
  }

  return (
    <div className="billing-withdrawal-field">
      <div className="billing-withdrawal-field__label">
        <label htmlFor={id}>
          {label}
          {required && (
            <>
              <span className="billing-withdrawal-field__required" aria-hidden>*</span>
              <span className="billing-sr-only"> (required)</span>
            </>
          )}
        </label>
      </div>

      {children(ids)}

      {/* Never colour alone: an error carries an icon and a sentence. */}
      {error && (
        <p className="billing-withdrawal-field__error" id={`${id}-error`}>
          <AlertCircle size={13} aria-hidden /> {error}
        </p>
      )}
      {!error && hint && (
        <p className="billing-withdrawal-field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {count && <div className="billing-withdrawal-field__count">{count}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Amount
// ---------------------------------------------------------------------------

/**
 * The money field.
 *
 * Grouped on blur and left alone while typing — reformatting under a cursor
 * moves the cursor, and somebody entering a stack of withdrawals notices that
 * long before they notice the grouping.
 */
function AmountField({
  value,
  currency,
  error,
  inputRef,
  onChange,
}: {
  value: string
  currency: string
  error?: string
  inputRef: RefObject<HTMLInputElement | null>
  onChange: (value: string) => void
}) {
  return (
    <Field id="withdrawal-amount" label="Amount" required error={error} hint="Enter the withdrawal amount">
      {(ids) => (
        <div className={`billing-withdrawal-affix${error ? ' billing-withdrawal-affix--invalid' : ''}`}>
          <span className="billing-withdrawal-affix__prefix" aria-hidden>{currency}</span>
          <input
            {...ids}
            ref={inputRef}
            className="billing-withdrawal-control billing-withdrawal-amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onFocus={(event) => event.target.select()}
            onBlur={() => {
              const parsed = parseAmount(value)
              if (parsed !== null && parsed > 0) onChange(groupAmount(parsed))
            }}
          />
        </div>
      )}
    </Field>
  )
}

// ---------------------------------------------------------------------------
// The two account dropdowns
// ---------------------------------------------------------------------------

/**
 * A ledger picker.
 *
 * A styled native select, which is what every other account dropdown in this
 * product is: it is keyboard-navigable and screen-reader-correct without being
 * re-implemented, and on a phone it opens the platform's own picker rather than
 * a list squeezed into a card.
 */
function AccountField({
  id,
  label,
  placeholder,
  emptyText,
  hint,
  options,
  accounts,
  value,
  error,
  selectRef,
  onChange,
}: {
  id: string
  label: string
  placeholder: string
  emptyText: string
  hint: ReactNode
  options: AccountOption[]
  accounts: AccountListState
  value: string
  error?: string
  selectRef: RefObject<HTMLSelectElement | null>
  onChange: (value: string) => void
}) {
  const missing = !accounts.loading && !accounts.error && options.length === 0
  const retryId = useId()

  return (
    <Field id={id} label={label} required error={error} hint={missing ? emptyText : hint}>
      {(ids) => (
        <>
          <select
            {...ids}
            {...(accounts.error ? { 'aria-describedby': retryId } : {})}
            ref={selectRef}
            className={`billing-withdrawal-control${error ? ' billing-withdrawal-control--invalid' : ''}`}
            value={value}
            disabled={accounts.loading}
            onChange={(event) => onChange(event.target.value)}
          >
            <option value="">{accounts.loading ? 'Loading…' : placeholder}</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {optionLabel(option)}
              </option>
            ))}
            {/* A value chosen before a reload keeps its slot rather than
                silently falling back to the placeholder. */}
            {value !== '' && !options.some((option) => String(option.id) === value) && (
              <option value={value}>Account {value}</option>
            )}
          </select>

          {accounts.error && (
            <div className="billing-withdrawal-retry" id={retryId}>
              <span>We couldn’t load this list.</span>
              <button type="button" className="billing-button billing-button--small" onClick={accounts.reload}>
                Retry
              </button>
            </div>
          )}
        </>
      )}
    </Field>
  )
}

function optionLabel(option: AccountOption): string {
  const parts = [option.name]
  if (option.accountNo) parts.push(option.accountNo)
  if (option.balance !== null) parts.push(money(option.balance))

  return parts.join(' · ')
}
