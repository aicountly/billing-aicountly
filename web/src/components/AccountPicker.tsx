/**
 * Choosing a cash or bank ledger, with enough beside each name to choose right.
 *
 * A `<select>` of twenty ledgers called "HDFC Bank", "HDFC Bank - 2" and "HDFC
 * Current" is how money gets deposited into the wrong account, and the person
 * who finds out is the one reconciling the statement next month. So each option
 * carries what tells them apart — what kind of account it is, the last four
 * digits when Books gives them, and the balance when this profile may see one.
 *
 * WHERE THE DATA COMES FROM. Nowhere near here. The caller passes a list it has
 * already read live, in one call, and this component only renders and filters
 * it. That is deliberate: a picker that fetched its own options would fetch
 * them twice on a screen with two pickers, and fetch a balance per row.
 *
 * Nothing is stored. The only thing that survives a choice is the account id.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { money } from '../ui'

export interface PickableAccount {
  id: number
  name: string
  /** Null when this profile may not see balances, so the kind cannot be read. */
  kind: 'cash' | 'bank' | null
  /** Null when unknown — never 0, which would read as an empty till. */
  balance: number | null
  /** Last four digits only. Books is never asked to hand over the rest. */
  maskedNumber: string | null
  bankName: string | null
}

export function AccountPicker({
  id,
  label,
  required = false,
  placeholder,
  accounts,
  value,
  onChange,
  loading = false,
  error,
  hint,
  emptyText = 'No accounts to choose from.',
  inputRef,
}: {
  id: string
  label: string
  required?: boolean
  placeholder: string
  accounts: PickableAccount[]
  value: number | null
  onChange: (accountId: number | null) => void
  loading?: boolean
  error?: string | null
  hint?: string | null
  emptyText?: string
  inputRef?: React.RefObject<HTMLInputElement | null>
}) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [highlighted, setHighlighted] = useState(0)

  const box = useRef<HTMLDivElement>(null)
  const ownInput = useRef<HTMLInputElement>(null)
  const input = inputRef ?? ownInput

  const selected = useMemo(() => accounts.find((account) => account.id === value) ?? null, [accounts, value])

  const matches = useMemo(() => {
    const query = term.trim().toLowerCase()
    if (!query) return accounts
    return accounts.filter(
      (account) =>
        account.name.toLowerCase().includes(query) ||
        (account.bankName ?? '').toLowerCase().includes(query) ||
        (account.maskedNumber ?? '').includes(query),
    )
  }, [accounts, term])

  useEffect(() => {
    if (!open) return undefined

    function onPointerDown(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function close() {
    setOpen(false)
    setTerm('')
  }

  function pick(account: PickableAccount) {
    onChange(account.id)
    close()
    input.current?.focus()
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      if (open) {
        // Escape closes what is open and nothing else. It never clears the
        // field and it never leaves the form.
        event.stopPropagation()
        close()
      }
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      setHighlighted((index) => {
        const next = event.key === 'ArrowDown' ? index + 1 : index - 1
        if (matches.length === 0) return 0
        return (next + matches.length) % matches.length
      })
      return
    }
    if (event.key === 'Home' && open) {
      event.preventDefault()
      setHighlighted(0)
      return
    }
    if (event.key === 'End' && open) {
      event.preventDefault()
      setHighlighted(Math.max(0, matches.length - 1))
      return
    }
    if (event.key === 'Enter' && open) {
      // Always swallowed while the list is open: Enter here means "this one",
      // never "submit the form behind the list".
      event.preventDefault()
      const chosen = matches[highlighted]
      if (chosen) pick(chosen)
    }
  }

  const describedBy = [error ? `${id}-error` : null, hint && !error ? `${id}-hint` : null].filter(Boolean).join(' ')

  return (
    <div className="bd-field" ref={box}>
      <label className="bd-label" htmlFor={id}>
        {label}
        {required && (
          <span className="bd-required" aria-hidden="true">
            {' '}
            *
          </span>
        )}
        {required && <span className="billing-sr-only"> (required)</span>}
      </label>

      <div className={`bd-combobox${error ? ' is-invalid' : ''}`}>
        <Search size={15} className="bd-combobox__icon" aria-hidden />
        <input
          id={id}
          ref={input}
          type="text"
          className="bd-combobox__input"
          role="combobox"
          autoComplete="off"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[highlighted] ? `${listId}-${matches[highlighted].id}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          disabled={loading}
          placeholder={loading ? 'Reading your accounts…' : placeholder}
          // Closed, the field reads as the chosen account. Open, it is a search
          // box — which is why the choice is restored, not cleared, on Escape.
          value={open ? term : (selected?.name ?? '')}
          onChange={(event) => {
            setTerm(event.target.value)
            setHighlighted(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <ChevronDown size={16} className="bd-combobox__chevron" aria-hidden />
      </div>

      {open && (
        <div className="bd-options" id={listId} role="listbox" aria-label={label}>
          {matches.length === 0 && (
            <p className="bd-options__empty">{accounts.length === 0 ? emptyText : `Nothing matched “${term.trim()}”.`}</p>
          )}
          {matches.map((account, index) => (
            <button
              key={account.id}
              id={`${listId}-${account.id}`}
              type="button"
              role="option"
              aria-selected={account.id === value}
              className={`bd-option${index === highlighted ? ' is-active' : ''}`}
              onMouseEnter={() => setHighlighted(index)}
              // Mouse down rather than click: a click fires after blur, and by
              // then the panel this option lives in has already closed.
              onMouseDown={(event) => {
                event.preventDefault()
                pick(account)
              }}
            >
              <span className="bd-option__main">
                <span className="bd-option__name">{account.name}</span>
                {/* No balance here: it has a column of its own on the right,
                    and saying it twice on one row reads as two figures. */}
                <span className="bd-option__meta">{describe(account, false)}</span>
              </span>
              {account.balance !== null && (
                <span className="bd-option__balance num">{money(account.balance)}</span>
              )}
              {account.id === value && <Check size={15} className="bd-option__tick" aria-hidden />}
            </button>
          ))}
        </div>
      )}

      {selected && !open && <p className="bd-field__selected">{describe(selected, true)}</p>}
      {hint && !error && (
        <p className="bd-field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="bd-field__error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  )
}

/** What tells one HDFC from another, in as few words as carry the difference. */
function describe(account: PickableAccount, withBalance: boolean): string {
  const parts: string[] = []
  if (account.kind === 'cash') parts.push('Cash account')
  if (account.kind === 'bank') parts.push(account.bankName ?? 'Bank account')
  if (account.maskedNumber) parts.push(`••••${account.maskedNumber}`)
  if (withBalance && account.balance !== null) parts.push(`Balance ${money(account.balance)}`)

  return parts.join(' · ') || 'Ledger in Smart Books'
}
