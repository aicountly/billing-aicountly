/**
 * Withdrawal details — the card a withdrawal is actually typed into.
 *
 * It owns no data. The two account lists are read live from Books through this
 * product's own endpoints and handed in; the draft and the save live in
 * BankWithdrawalPage. That split is what lets the panel beside it — "repeat
 * from last", "copy into this form" — put values into these fields without
 * this component knowing they exist.
 */

import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  AlertCircle,
  Banknote,
  Calendar,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  Info,
  Landmark,
  Loader2,
  RotateCcw,
  Search,
  Wallet,
} from 'lucide-react'
import { getAppById, launchApp } from '../../services/appLauncher'
import { money } from '../../ui'
import {
  groupAmount,
  NOTE_LIMIT,
  parseAmount,
  REFERENCE_LIMIT,
  type AccountOption,
  type WithdrawalDraft,
  type WithdrawalErrors,
  type WithdrawalField,
} from './withdrawalForm'

export type SaveMode = 'save' | 'save-new'

export interface WithdrawalFieldRefs {
  amount: RefObject<HTMLInputElement | null>
  date: RefObject<HTMLInputElement | null>
  bank: RefObject<HTMLButtonElement | null>
  cash: RefObject<HTMLButtonElement | null>
}

export interface WithdrawalFormCardProps {
  draft: WithdrawalDraft
  onChange: (patch: Partial<WithdrawalDraft>) => void
  errors: WithdrawalErrors
  /** Errors stay quiet until the first save attempt, then follow every keystroke. */
  showErrors: boolean
  currency: string
  bankAccounts: AccountOption[]
  cashAccounts: AccountOption[]
  accountsLoading: boolean
  accountsError: string | null
  onRetryAccounts: () => void
  /** Whether the profile may be shown a balance at all. */
  showBalances: boolean
  selectedBank: AccountOption | null
  /** More than the bank holds, per Books. A warning — an overdraft is legal. */
  overBalance: boolean
  saving: SaveMode | null
  disabled: boolean
  onSave: (mode: SaveMode) => void
  onClear: () => void
  fieldRefs: WithdrawalFieldRefs
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
      <header className="billing-withdrawal-card__head">
        <h2>Withdrawal details</h2>
        <p>Enter the withdrawal information below.</p>
      </header>

      <div className="billing-withdrawal-grid">
        <AmountField
          value={draft.amount}
          currency={props.currency}
          error={shown('amount')}
          inputRef={props.fieldRefs.amount}
          onChange={(amount) => onChange({ amount })}
        />

        <Field
          id="withdrawal-date"
          label="Date"
          required
          error={shown('date')}
          hint="Select the withdrawal date"
          icon={<Calendar size={15} />}
        >
          {(ids) => (
            <div className={`billing-withdrawal-affix${shown('date') ? ' billing-withdrawal-affix--invalid' : ''}`}>
              <span className="billing-withdrawal-affix__prefix" aria-hidden>
                <Calendar size={15} />
              </span>
              <input
                {...ids}
                ref={props.fieldRefs.date}
                type="date"
                className="billing-withdrawal-control"
                value={draft.date}
                onChange={(event) => onChange({ date: event.target.value })}
              />
            </div>
          )}
        </Field>

        <AccountSelect
          id="withdrawal-bank"
          label="Bank account (taken from)"
          placeholder="Choose the bank account"
          searchLabel="Search bank accounts"
          icon={<Landmark size={15} />}
          options={props.bankAccounts}
          value={draft.bankAccountId}
          onChange={(bankAccountId) => onChange({ bankAccountId })}
          loading={props.accountsLoading}
          listError={props.accountsError}
          onRetry={props.onRetryAccounts}
          showBalances={props.showBalances}
          emptyTitle="No bank accounts available"
          emptyHint="Cash and bank ledgers belong to Smart Books. Add one there and it appears here."
          error={shown('bankAccountId')}
          hint={bankHint(props.selectedBank, props.showBalances, props.overBalance)}
          hintTone={props.overBalance ? 'warning' : 'muted'}
          triggerRef={props.fieldRefs.bank}
        />

        <AccountSelect
          id="withdrawal-cash"
          label="Into cash account"
          placeholder="Choose the cash account"
          searchLabel="Search cash accounts"
          icon={<Wallet size={15} />}
          options={props.cashAccounts}
          value={draft.cashAccountId}
          onChange={(cashAccountId) => onChange({ cashAccountId })}
          loading={props.accountsLoading}
          listError={props.accountsError}
          onRetry={props.onRetryAccounts}
          showBalances={props.showBalances}
          emptyTitle="No cash accounts available"
          emptyHint="Cash ledgers belong to Smart Books. Add one there and it appears here."
          error={shown('cashAccountId')}
          hint="Record withdrawal into this cash account"
          triggerRef={props.fieldRefs.cash}
        />

        <Field
          id="withdrawal-reference"
          label="Reference / Cheque details"
          hint="Enter cheque number, UTR number or reference"
        >
          {(ids) => (
            <div className="billing-withdrawal-affix">
              <span className="billing-withdrawal-affix__prefix" aria-hidden>
                <FileText size={15} />
              </span>
              <input
                {...ids}
                className="billing-withdrawal-control"
                value={draft.reference}
                maxLength={REFERENCE_LIMIT}
                autoComplete="off"
                placeholder="e.g. Cheque no., UTR, Slip no."
                onChange={(event) => onChange({ reference: event.target.value })}
              />
            </div>
          )}
        </Field>

        <Field
          id="withdrawal-note"
          label="Notes (optional)"
          error={shown('note')}
          hint="Purpose, remarks or any additional details"
          count={draft.note.length > 0 ? `${draft.note.length}/${NOTE_LIMIT}` : undefined}
        >
          {(ids) => (
            <textarea
              {...ids}
              className="billing-withdrawal-control billing-withdrawal-control--area"
              value={draft.note}
              maxLength={NOTE_LIMIT}
              placeholder="Add a note…"
              onChange={(event) => onChange({ note: event.target.value })}
            />
          )}
        </Field>
      </div>

      <p className="billing-withdrawal-strip">
        <Info size={16} aria-hidden />
        <span>
          This will create a bank withdrawal entry moving money from your selected bank account to cash. Smart Books
          makes both sides of the entry and gives it its number.
        </span>
      </p>

      <footer className="billing-withdrawal-actions">
        <button
          type="button"
          className="billing-button billing-button--quiet"
          onClick={props.onClear}
          disabled={busy}
        >
          <RotateCcw size={15} aria-hidden /> Clear all
        </button>

        <div className="billing-withdrawal-actions__right">
          <button
            type="button"
            className="billing-button"
            onClick={() => props.onSave('save-new')}
            disabled={busy || props.disabled}
            title="Save this one and start another (Ctrl + Shift + S)"
          >
            {saving === 'save-new' ? <Loader2 size={15} aria-hidden className="spin" /> : <Banknote size={15} aria-hidden />}
            {saving === 'save-new' ? 'Saving…' : 'Save & New'}
          </button>

          <button
            type="submit"
            className="billing-button billing-button--primary"
            disabled={busy || props.disabled}
            title="Save this withdrawal (Ctrl + S)"
          >
            {saving === 'save' ? <Loader2 size={15} aria-hidden className="spin" /> : <Check size={15} aria-hidden />}
            {saving === 'save' ? 'Saving…' : 'Save withdrawal'}
          </button>
        </div>
      </footer>
    </form>
  )
}

/** What sits under the bank field once one is chosen. */
function bankHint(bank: AccountOption | null, showBalances: boolean, overBalance: boolean): ReactNode {
  if (!bank) return 'The bank this cash is taken out of'
  if (!showBalances || bank.balance === null) return bank.maskedNumber ? `Account ${bank.maskedNumber}` : bank.name

  if (overBalance) {
    return `This is more than the ${money(bank.balance)} Smart Books shows. Save it anyway if this account may go overdrawn.`
  }

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
  hintTone = 'muted',
  count,
  icon,
  children,
}: {
  id: string
  label: string
  required?: boolean
  error?: string
  hint?: ReactNode
  hintTone?: 'muted' | 'warning'
  count?: string
  icon?: ReactNode
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
          {icon && <span aria-hidden className="billing-withdrawal-field__icon">{icon}</span>}
          {label}
          {required && (
            <>
              <span className="billing-withdrawal-field__required" aria-hidden>*</span>
              <span className="billing-sr-only"> (required)</span>
            </>
          )}
        </label>
        {count && <span className="billing-withdrawal-field__count">{count}</span>}
      </div>

      {children(ids)}

      {/* Never colour alone: an error carries an icon and a sentence. */}
      {error && (
        <p className="billing-withdrawal-field__error" id={`${id}-error`}>
          <AlertCircle size={13} aria-hidden /> {error}
        </p>
      )}
      {!error && hint && (
        <p
          className={`billing-withdrawal-field__hint${hintTone === 'warning' ? ' billing-withdrawal-field__hint--warning' : ''}`}
          id={`${id}-hint`}
        >
          {hintTone === 'warning' && <AlertCircle size={13} aria-hidden />} {hint}
        </p>
      )}
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
 * moves the cursor, and somebody entering the day's withdrawals notices that
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
// The account pickers
// ---------------------------------------------------------------------------

/**
 * Choosing a ledger from a list that may be long.
 *
 * A native select cannot show a balance beside a name, cannot be searched, and
 * on a phone hides the one number the person is choosing by. This is the
 * listbox pattern instead: a button that opens a panel, a filter, arrow keys,
 * Enter to choose, Escape to leave it as it was — and focus returns to the
 * button, so a keyboard user is never dropped at the top of the document.
 */
function AccountSelect({
  id,
  label,
  placeholder,
  searchLabel,
  icon,
  options,
  value,
  onChange,
  loading,
  listError,
  onRetry,
  showBalances,
  emptyTitle,
  emptyHint,
  error,
  hint,
  hintTone,
  triggerRef,
}: {
  id: string
  label: string
  placeholder: string
  searchLabel: string
  icon: ReactNode
  options: AccountOption[]
  value: string
  onChange: (value: string) => void
  loading: boolean
  listError: string | null
  onRetry: () => void
  showBalances: boolean
  emptyTitle: string
  emptyHint: string
  error?: string
  hint?: ReactNode
  hintTone?: 'muted' | 'warning'
  triggerRef: RefObject<HTMLButtonElement | null>
}) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)

  const selected = useMemo(() => options.find((option) => String(option.id) === value) ?? null, [options, value])

  const matches = useMemo(() => {
    const needle = term.trim().toLowerCase()
    if (needle === '') return options

    return options.filter(
      (option) =>
        option.name.toLowerCase().includes(needle) || (option.maskedNumber ?? '').toLowerCase().includes(needle),
    )
  }, [options, term])

  useEffect(() => {
    if (!open) return undefined

    function away(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }

    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  // Opening puts the cursor in the filter, and the highlight on what is
  // already chosen rather than on the top of the list.
  useEffect(() => {
    if (!open) return
    setTerm('')
    setActive(Math.max(0, options.findIndex((option) => String(option.id) === value)))
    window.setTimeout(() => search.current?.focus(), 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    setActive((current) => (current >= matches.length ? 0 : current))
  }, [matches.length])

  function close(focusTrigger = true) {
    setOpen(false)
    if (focusTrigger) window.setTimeout(() => triggerRef.current?.focus(), 0)
  }

  function choose(option: AccountOption) {
    onChange(String(option.id))
    close()
  }

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    // Escape is handled on the panel, so it closes the list from the filter
    // and from an option alike.
    if (event.key === 'Escape') return
    if (event.key === 'Tab') {
      setOpen(false)
      return
    }
    if (matches.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((n) => Math.min(n + 1, matches.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((n) => Math.max(n - 1, 0))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActive(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setActive(matches.length - 1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const chosen = matches[active]
      if (chosen) choose(chosen)
    }
  }

  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  const empty = !loading && listError === null && options.length === 0

  return (
    <div className="billing-withdrawal-field">
      <div className="billing-withdrawal-field__label">
        <span id={`${id}-label`}>
          <span aria-hidden className="billing-withdrawal-field__icon">{icon}</span>
          {label}
          <span className="billing-withdrawal-field__required" aria-hidden>*</span>
          <span className="billing-sr-only"> (required)</span>
        </span>
      </div>

      <div className="billing-withdrawal-select" ref={box}>
        <button
          type="button"
          id={id}
          ref={triggerRef}
          className={`billing-withdrawal-select__trigger${error ? ' billing-withdrawal-select__trigger--invalid' : ''}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={`${id}-label ${id}`}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          aria-required
          disabled={loading || empty}
          onClick={() => setOpen((value) => !value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              setOpen(true)
            }
          }}
        >
          <span className="billing-withdrawal-select__mark" aria-hidden>
            {loading ? <Loader2 size={15} className="spin" /> : icon}
          </span>

          <span className="billing-withdrawal-select__value">
            {loading && <span className="billing-withdrawal-select__placeholder">Loading accounts…</span>}
            {!loading && empty && <span className="billing-withdrawal-select__placeholder">{emptyTitle}</span>}
            {!loading && !empty && !selected && (
              <span className="billing-withdrawal-select__placeholder">{placeholder}</span>
            )}
            {!loading && selected && (
              <>
                <span className="billing-withdrawal-select__name">{selected.name}</span>
                {selected.maskedNumber && (
                  <span className="billing-withdrawal-select__sub">{selected.maskedNumber}</span>
                )}
              </>
            )}
          </span>

          <ChevronDown size={16} aria-hidden className="billing-withdrawal-select__chevron" />
        </button>

        {open && (
          <div
            className="billing-withdrawal-select__panel"
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              close()
            }}
          >
            <div className="billing-withdrawal-select__search">
              <Search size={14} aria-hidden />
              <input
                ref={search}
                type="text"
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-autocomplete="list"
                aria-label={searchLabel}
                aria-activedescendant={matches[active] ? `${listId}-${matches[active].id}` : undefined}
                autoComplete="off"
                placeholder="Type to filter…"
                value={term}
                onChange={(event) => {
                  setTerm(event.target.value)
                  setActive(0)
                }}
                onKeyDown={onSearchKeyDown}
              />
            </div>

            <ul className="billing-withdrawal-select__list" id={listId} role="listbox" aria-label={label}>
              {matches.length === 0 && (
                <li className="billing-withdrawal-select__note" role="presentation">
                  Nothing matches “{term.trim()}”.
                </li>
              )}
              {matches.map((option, index) => (
                <li key={option.id} role="presentation">
                  <button
                    type="button"
                    id={`${listId}-${option.id}`}
                    role="option"
                    aria-selected={String(option.id) === value}
                    className={`billing-withdrawal-select__option${index === active ? ' is-active' : ''}`}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(option)}
                  >
                    <span className="billing-withdrawal-select__option-main">
                      <span className="billing-withdrawal-select__name">{option.name}</span>
                      {(option.maskedNumber || option.kind) && (
                        <span className="billing-withdrawal-select__sub">
                          {[option.maskedNumber, option.kind === 'bank' ? 'Bank' : option.kind === 'cash' ? 'Cash' : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      )}
                    </span>
                    {showBalances && option.balance !== null && (
                      <span className="billing-withdrawal-select__balance">{money(option.balance)}</span>
                    )}
                    {String(option.id) === value && <Check size={15} aria-hidden />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {listError !== null && (
        <div className="billing-withdrawal-retry">
          <span>We couldn’t load this list.</span>
          <button type="button" className="billing-button billing-button--small" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}

      {empty && (
        <div className="billing-withdrawal-retry">
          <span>{emptyHint}</span>
          <button
            type="button"
            className="billing-button billing-button--small"
            onClick={() => launchApp(getAppById('books'), { newTab: true })}
          >
            <ExternalLink size={14} aria-hidden /> Open Smart Books
          </button>
        </div>
      )}

      {error && (
        <p className="billing-withdrawal-field__error" id={`${id}-error`}>
          <AlertCircle size={13} aria-hidden /> {error}
        </p>
      )}
      {!error && hint && (
        <p
          className={`billing-withdrawal-field__hint${hintTone === 'warning' ? ' billing-withdrawal-field__hint--warning' : ''}`}
          id={`${id}-hint`}
        >
          {hintTone === 'warning' && <AlertCircle size={13} aria-hidden />} {hint}
        </p>
      )}
    </div>
  )
}
