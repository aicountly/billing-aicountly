/**
 * Basic Details — the card an expense is actually typed into.
 *
 * It owns no data. Every list on it (heads, cash and bank accounts, tax
 * categories, parties) is read live from Books through this product's own
 * endpoints and handed in; the draft and the save live in ExpensePage. That
 * split is what lets the quick-category cards and the bill reader on the right
 * put values into these fields without this component knowing they exist.
 */

import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  AlertCircle,
  Building2,
  ChevronDown,
  FileText,
  Info,
  Loader2,
  Paperclip,
  RotateCcw,
  Save,
  UserRound,
  X,
} from 'lucide-react'
import { api, type ListResponse } from '../../services/api'
import type { AsyncState } from '../../hooks/useApi'
import type { CatalogAccount, CatalogParty, DocumentCapability } from '../../services/types'
import {
  groupAmount,
  NOTE_LIMIT,
  parseAmount,
  readId,
  readText,
  type ExpenseDraft,
  type ExpenseErrors,
  type ExpenseField,
} from './expenseForm'

export type SaveMode = 'save' | 'save-new' | 'save-view'

export interface ExpenseFormCardProps {
  draft: ExpenseDraft
  onChange: (patch: Partial<ExpenseDraft>) => void
  errors: ExpenseErrors
  /** Errors stay quiet until the first save attempt, then follow every keystroke. */
  showErrors: boolean
  currency: string
  categories: AsyncState<ListResponse<CatalogAccount>>
  paidFrom: AsyncState<ListResponse<CatalogAccount>>
  taxCategories: AsyncState<ListResponse<Record<string, unknown>>>
  billStorage: DocumentCapability | null
  /** Fields the bill reader filled, highlighted until the person edits them. */
  aiFilled: ReadonlySet<ExpenseField>
  saving: boolean
  saveAndNew: boolean
  onSaveAndNewChange: (value: boolean) => void
  onSave: (mode: SaveMode) => void
  onReset: () => void
  onCancel: () => void
  fieldRefs: {
    amount: RefObject<HTMLInputElement | null>
    category: RefObject<HTMLSelectElement | null>
    paidFrom: RefObject<HTMLSelectElement | null>
    vendor: RefObject<HTMLInputElement | null>
  }
}

export function ExpenseFormCard(props: ExpenseFormCardProps) {
  const { draft, onChange, errors, showErrors, saving, aiFilled } = props
  const shown = (field: ExpenseField) => (showErrors ? errors[field] : undefined)

  return (
    <form
      className="billing-expense-card"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        props.onSave(props.saveAndNew ? 'save-new' : 'save')
      }}
    >
      <div className="billing-expense-card__head">
        <span className="billing-expense-card__step" aria-hidden>1</span>
        <h2>Basic Details</h2>
      </div>

      <div className="billing-expense-grid billing-expense-grid--top">
        <AmountField
          value={draft.amount}
          currency={props.currency}
          error={shown('amount')}
          filled={aiFilled.has('amount')}
          inputRef={props.fieldRefs.amount}
          onChange={(amount) => onChange({ amount })}
        />

        <Field id="expense-date" label="Expense Date" required error={shown('date')} filled={aiFilled.has('date')}>
          {(ids) => (
            <input
              {...ids}
              type="date"
              className="billing-expense-control"
              value={draft.date}
              onChange={(event) => onChange({ date: event.target.value })}
            />
          )}
        </Field>

        <AccountField
          id="expense-category"
          label="What is this expense for?"
          required
          placeholder="Choose expense category"
          emptyText="No expense categories found. Add an expense head in Smart Books."
          state={props.categories}
          value={draft.categoryId}
          error={shown('categoryId')}
          filled={aiFilled.has('categoryId')}
          selectRef={props.fieldRefs.category}
          onChange={(categoryId) => onChange({ categoryId })}
        />

        <AccountField
          id="expense-paid-from"
          label="Paid From"
          required
          placeholder="Choose bank / cash / card"
          emptyText="No payment accounts found. Add a cash or bank ledger in Smart Books."
          state={props.paidFrom}
          value={draft.paidFromId}
          error={shown('paidFromId')}
          filled={aiFilled.has('paidFromId')}
          selectRef={props.fieldRefs.paidFrom}
          onChange={(paidFromId) => onChange({ paidFromId })}
        />

        <div className="billing-expense-grid__bill">
          <BillReceiptField
            value={draft.billReference}
            capability={props.billStorage}
            onChange={(billReference) => onChange({ billReference })}
          />
        </div>
      </div>

      <div className="billing-expense-grid billing-expense-grid--rest">
        <VendorField
          vendor={draft.vendor}
          filled={aiFilled.has('vendor')}
          inputRef={props.fieldRefs.vendor}
          onChange={(vendor) => onChange({ vendor })}
        />

        <Field
          id="expense-reference"
          label="Reference No. / Bill No."
          filled={aiFilled.has('reference')}
        >
          {(ids) => (
            <input
              {...ids}
              className="billing-expense-control"
              value={draft.reference}
              placeholder="e.g. INV-001, CASH, UPI Ref"
              onChange={(event) => onChange({ reference: event.target.value })}
            />
          )}
        </Field>

        <TaxCategoryField
          state={props.taxCategories}
          value={draft.taxCategoryId}
          vendor={draft.vendor}
          onChange={(taxCategoryId) => onChange({ taxCategoryId })}
        />

        <div className="billing-expense-field">
          <div className="billing-expense-field__label">
            <span>Input GST credit</span>
          </div>
          <p className="billing-expense-aside-note" role="note">
            <Info size={14} aria-hidden />
            <span>
              {draft.vendor?.gstin
                ? `${draft.vendor.acc_name} is registered as ${draft.vendor.gstin}. Pick the treatment beside this and Smart Books works out the credit.`
                : 'Pick a registered vendor and a GST treatment to claim input credit. Smart Books does the split.'}
            </span>
          </p>
        </div>

        <div className="billing-expense-grid__full">
          <Field
            id="expense-note"
            label="Notes"
            error={shown('note')}
            filled={aiFilled.has('note')}
            count={`${draft.note.length}/${NOTE_LIMIT}`}
          >
            {(ids) => (
              <textarea
                {...ids}
                className="billing-expense-control"
                value={draft.note}
                maxLength={NOTE_LIMIT}
                placeholder="Add a note (optional)…"
                onChange={(event) => onChange({ note: event.target.value })}
              />
            )}
          </Field>
        </div>
      </div>

      <FormActions
        saving={saving}
        saveAndNew={props.saveAndNew}
        onSaveAndNewChange={props.onSaveAndNewChange}
        onSave={props.onSave}
        onReset={props.onReset}
        onCancel={props.onCancel}
      />
    </form>
  )
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
  action,
  filled = false,
  children,
}: {
  id: string
  label: string
  required?: boolean
  error?: string
  hint?: ReactNode
  count?: string
  action?: ReactNode
  filled?: boolean
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
    <div className={`billing-expense-field${filled ? ' billing-expense-field--filled' : ''}`}>
      <div className="billing-expense-field__label">
        <label htmlFor={id}>
          {label}
          {required && (
            <>
              <span className="billing-expense-field__required" aria-hidden>*</span>
              <span className="billing-sr-only"> (required)</span>
            </>
          )}
        </label>
        {action}
      </div>

      {children(ids)}

      {/* Never colour alone: an error carries an icon and a sentence. */}
      {error && (
        <p className="billing-expense-field__error" id={`${id}-error`}>
          <AlertCircle size={13} aria-hidden /> {error}
        </p>
      )}
      {!error && hint && (
        <p className="billing-expense-field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {count && <div className="billing-expense-field__count">{count}</div>}
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
 * moves the cursor, and a person entering a hundred bills notices that long
 * before they notice the grouping.
 */
function AmountField({
  value,
  currency,
  error,
  filled,
  inputRef,
  onChange,
}: {
  value: string
  currency: string
  error?: string
  filled: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onChange: (value: string) => void
}) {
  return (
    <Field id="expense-amount" label="Expense Amount" required error={error} filled={filled}>
      {(ids) => (
        <div className={`billing-expense-affix${error ? ' billing-expense-affix--invalid' : ''}`}>
          <span className="billing-expense-affix__prefix" aria-hidden>{currency}</span>
          <input
            {...ids}
            ref={inputRef}
            className="billing-expense-control billing-expense-amount"
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

function AccountField({
  id,
  label,
  required,
  placeholder,
  emptyText,
  state,
  value,
  error,
  filled,
  selectRef,
  onChange,
}: {
  id: string
  label: string
  required?: boolean
  placeholder: string
  emptyText: string
  state: AsyncState<ListResponse<CatalogAccount>>
  value: string
  error?: string
  filled: boolean
  selectRef: RefObject<HTMLSelectElement | null>
  onChange: (value: string) => void
}) {
  const rows = state.data?.data ?? []
  const missing = !state.loading && !state.error && rows.length === 0

  return (
    <Field
      id={id}
      label={label}
      required={required}
      error={error}
      filled={filled}
      hint={missing ? emptyText : undefined}
    >
      {(ids) => (
        <>
          <select
            {...ids}
            ref={selectRef}
            className={`billing-expense-control${error ? ' billing-expense-control--invalid' : ''}`}
            value={value}
            disabled={state.loading}
            onChange={(event) => onChange(event.target.value)}
          >
            <option value="">{state.loading ? 'Loading…' : placeholder}</option>
            {rows.map((row) => (
              <option key={row.acc_id} value={row.acc_id}>
                {row.acc_name}
              </option>
            ))}
            {/* A value chosen before a reload keeps its slot rather than
                silently falling back to "Choose…". */}
            {value !== '' && !rows.some((row) => String(row.acc_id) === value) && (
              <option value={value}>Account {value}</option>
            )}
          </select>

          {state.error && (
            <div className="billing-expense-retry">
              <span>We couldn’t load this list.</span>
              <button type="button" className="billing-button billing-button--small" onClick={state.reload}>
                Retry
              </button>
            </div>
          )}
        </>
      )}
    </Field>
  )
}

// ---------------------------------------------------------------------------
// GST treatment
// ---------------------------------------------------------------------------

/**
 * The GST treatment of the expense, which is a Books tax category.
 *
 * Not an enum of our own: Books decides what each category means and works out
 * the credit, and a second vocabulary here would be a second opinion about tax.
 * The list is whatever this company has configured, read live.
 */
function TaxCategoryField({
  state,
  value,
  vendor,
  onChange,
}: {
  state: AsyncState<ListResponse<Record<string, unknown>>>
  value: string
  vendor: CatalogParty | null
  onChange: (value: string) => void
}) {
  const options = useMemo(() => {
    return (state.data?.data ?? [])
      .map((row) => ({
        id: readId(row, ['tax_cat_id', 'tax_category_id', 'taxcat_id', 'id']),
        name: readText(row, ['tax_cat_name', 'tax_category_name', 'name', 'label', 'description']),
      }))
      .filter((row): row is { id: number; name: string } => row.id !== null && row.name !== null)
  }, [state.data])

  const unavailable = !state.loading && options.length === 0

  return (
    <Field
      id="expense-gst"
      label="GST Treatment"
      hint={
        unavailable
          ? 'No GST categories are configured for this company, so this expense is recorded without one.'
          : vendor?.gstin
            ? `${vendor.acc_name} is GST registered.`
            : undefined
      }
    >
      {(ids) => (
        <select
          {...ids}
          className="billing-expense-control"
          value={value}
          disabled={state.loading || unavailable}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{state.loading ? 'Loading…' : 'No GST on this expense'}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  )
}

// ---------------------------------------------------------------------------
// Vendor / Paid To
// ---------------------------------------------------------------------------

/**
 * Who it was paid to, searched in Books as you type.
 *
 * Optional on purpose: a great many expenses are paid to somebody who is not a
 * ledger in anybody's books, and forcing one to be invented is how a chart of
 * accounts fills up with people nobody deals with twice.
 */
function VendorField({
  vendor,
  filled,
  inputRef,
  onChange,
}: {
  vendor: CatalogParty | null
  filled: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onChange: (vendor: CatalogParty | null) => void
}) {
  const listId = useId()
  const [term, setTerm] = useState('')
  const [options, setOptions] = useState<CatalogParty[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)

  // Debounced, because this fires at Books on every keystroke otherwise.
  useEffect(() => {
    const trimmed = term.trim()
    if (trimmed.length < 2) {
      setOptions([])
      setFailed(false)
      return undefined
    }

    const controller = new AbortController()
    const timer = setTimeout(() => {
      setBusy(true)
      setFailed(false)
      api
        .list<CatalogParty>('v1/catalog/parties', { q: trimmed, side: 'supplier', limit: 20 }, controller.signal)
        .then((response) => {
          setOptions(response.data)
          setActive(0)
        })
        .catch(() => {
          if (!controller.signal.aborted) setFailed(true)
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false)
        })
    }, 250)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [term])

  useEffect(() => {
    function away(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [])

  function choose(party: CatalogParty) {
    onChange(party)
    setTerm('')
    setOpen(false)
  }

  if (vendor) {
    return (
      <div className={`billing-expense-field${filled ? ' billing-expense-field--filled' : ''}`}>
        <div className="billing-expense-field__label">
          <span id="expense-vendor-label">Vendor / Paid To</span>
        </div>
        <div className="billing-expense-picker__chosen">
          <Building2 size={16} aria-hidden style={{ color: 'var(--billing-action)', flexShrink: 0 }} />
          <span className="billing-expense-picker__chosen-name billing-expense-picker__truncate">
            {vendor.acc_name}
            <span className="billing-expense-picker__truncate">{vendor.gstin ? `GSTIN ${vendor.gstin}` : 'No GSTIN on this party'}</span>
          </span>
          <button
            type="button"
            className="billing-expense-tip__close"
            style={{ marginLeft: 'auto' }}
            aria-label={`Remove ${vendor.acc_name}`}
            onClick={() => {
              onChange(null)
              window.setTimeout(() => inputRef.current?.focus(), 0)
            }}
          >
            <X size={15} aria-hidden />
          </button>
        </div>
      </div>
    )
  }

  const showMenu = open && term.trim().length >= 2

  return (
    <div className="billing-expense-field">
      <div className="billing-expense-field__label">
        <label htmlFor="expense-vendor">Vendor / Paid To</label>
      </div>

      <div className="billing-expense-picker" ref={box}>
        <div className="billing-expense-affix">
          <span className="billing-expense-affix__prefix" aria-hidden>
            <UserRound size={15} />
          </span>
          <input
            id="expense-vendor"
            ref={inputRef}
            className="billing-expense-control"
            role="combobox"
            aria-expanded={showMenu}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showMenu && options[active] ? `${listId}-${options[active].acc_id}` : undefined}
            autoComplete="off"
            placeholder="Search vendor / party"
            value={term}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setTerm(event.target.value)
              setOpen(true)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setOpen(false)
                return
              }
              if (!showMenu || options.length === 0) return
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((n) => Math.min(n + 1, options.length - 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((n) => Math.max(n - 1, 0))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                const chosen = options[active]
                if (chosen) choose(chosen)
              }
            }}
          />
        </div>

        {showMenu && (
          <div className="billing-expense-picker__menu" id={listId} role="listbox" aria-label="Matching parties">
            {busy && <p className="billing-expense-picker__note">Searching…</p>}
            {failed && (
              <p className="billing-expense-picker__note">
                Could not reach the app that holds this list. Try again in a moment.
              </p>
            )}
            {!busy && !failed && options.length === 0 && (
              <p className="billing-expense-picker__note">
                No matching vendors. A new party is added in Smart Books — leave this blank for a cash expense.
              </p>
            )}
            {options.map((party, index) => (
              <button
                key={party.acc_id}
                id={`${listId}-${party.acc_id}`}
                type="button"
                role="option"
                aria-selected={index === active}
                className="billing-expense-picker__option"
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(party)}
              >
                <span className="billing-expense-picker__truncate">{party.acc_name}</span>
                {party.gstin && <small>GSTIN {party.gstin}</small>}
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="billing-expense-field__hint">Optional. Leave blank for a cash expense with no party.</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bill / Receipt
// ---------------------------------------------------------------------------

/**
 * Where the bill is.
 *
 * This deployment has nowhere to put the file — see DocumentCapture on the
 * server, and docs/BILLING_API_DEPENDENCIES.md for what would change that — so
 * the block records WHERE the bill is kept instead of showing a drop zone that
 * would swallow a photo and lose it. The reference goes to Books on the voucher
 * as `attachment_ref`, which is a field the expense already had.
 */
function BillReceiptField({
  value,
  capability,
  onChange,
}: {
  value: string
  capability: DocumentCapability | null
  onChange: (value: string) => void
}) {
  return (
    <div className="billing-expense-bill">
      <div className="billing-expense-bill__head">
        <span className="billing-expense-bill__mark" aria-hidden>
          <Paperclip size={15} />
        </span>
        <label htmlFor="expense-bill-reference">Bill / Receipt</label>
      </div>

      <input
        id="expense-bill-reference"
        className="billing-expense-control"
        value={value}
        placeholder="e.g. Bill file 12, drive link"
        aria-describedby="expense-bill-why"
        onChange={(event) => onChange(event.target.value)}
      />

      <p className="billing-expense-bill__why" id="expense-bill-why">
        <FileText size={12} aria-hidden style={{ verticalAlign: '-1px', marginRight: 4 }} />
        {capability && !capability.available && capability.reason
          ? capability.reason
          : 'Kept with the voucher in Smart Books.'}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The bar along the bottom
// ---------------------------------------------------------------------------

function FormActions({
  saving,
  saveAndNew,
  onSaveAndNewChange,
  onSave,
  onReset,
  onCancel,
}: {
  saving: boolean
  saveAndNew: boolean
  onSaveAndNewChange: (value: boolean) => void
  onSave: (mode: SaveMode) => void
  onReset: () => void
  onCancel: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return undefined

    function away(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setMenuOpen(false)
    }
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }

    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
    }
  }, [menuOpen])

  return (
    <div className="billing-expense-actions">
      <button type="button" className="billing-button billing-button--quiet" onClick={onReset} disabled={saving}>
        <RotateCcw size={15} aria-hidden /> Reset
      </button>

      <div className="billing-expense-actions__right">
        <label className="billing-expense-check">
          <input
            type="checkbox"
            checked={saveAndNew}
            onChange={(event) => onSaveAndNewChange(event.target.checked)}
          />
          <span>Save and add another</span>
        </label>

        <button type="button" className="billing-button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>

        <div className="billing-expense-split" ref={box}>
          <button type="submit" className="billing-button billing-button--primary" disabled={saving}>
            {saving ? <Loader2 size={15} aria-hidden className="spin" /> : <Save size={15} aria-hidden />}
            {saving ? 'Saving…' : 'Save Expense'}
          </button>
          <button
            type="button"
            className="billing-expense-split__more"
            aria-label="More ways to save"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={saving}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <ChevronDown size={15} aria-hidden />
          </button>

          {menuOpen && (
            <div className="billing-expense-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="billing-expense-menu__item"
                onClick={() => {
                  setMenuOpen(false)
                  onSave('save')
                }}
              >
                Save
              </button>
              <button
                type="button"
                role="menuitem"
                className="billing-expense-menu__item"
                onClick={() => {
                  setMenuOpen(false)
                  onSave('save-new')
                }}
              >
                Save &amp; add another
              </button>
              <button
                type="button"
                role="menuitem"
                className="billing-expense-menu__item"
                onClick={() => {
                  setMenuOpen(false)
                  onSave('save-view')
                }}
              >
                Save &amp; view the entry
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
