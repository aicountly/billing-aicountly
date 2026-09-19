/**
 * A ledger picker that behaves like a control rather than a native select.
 *
 * The native <select> is fine for five payment modes and wrong for a list of
 * accounts: it cannot show the account number under the name, cannot be typed
 * into, and cannot say "Smart Books did not answer" — it just sits there empty,
 * which a user reads as "this business has no bank account".
 *
 * So this is the ARIA combobox pattern, and the states are part of it:
 * loading, empty (with whatever the caller wants to offer instead), and failed
 * (with a retry). Keyboard throughout — arrows, Home/End, Enter, Escape — and
 * focus returns to the trigger when it closes, because this screen is used at a
 * counter by people who never touch the mouse.
 */

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, Check, ChevronDown, Search } from 'lucide-react'

export interface AccountOption {
  id: number
  name: string
  /** Account number, or the accounting group — whatever identifies it. */
  secondary?: string | null
  /** Right-aligned, usually the balance. Already formatted. */
  trailing?: string | null
}

export function AccountSelect({
  id,
  label,
  required = false,
  value,
  onChange,
  options,
  placeholder = 'Choose…',
  loading = false,
  error = null,
  onRetry,
  emptyMessage = 'Nothing to choose from.',
  emptyAction,
  hint,
  fieldError,
  disabled = false,
  icon,
}: {
  id: string
  label: string
  required?: boolean
  value: number | null
  onChange: (next: number) => void
  options: AccountOption[]
  placeholder?: string
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  emptyMessage?: ReactNode
  emptyAction?: ReactNode
  hint?: ReactNode
  fieldError?: string
  disabled?: boolean
  icon?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [active, setActive] = useState(0)

  const wrap = useRef<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const search = useRef<HTMLInputElement | null>(null)
  const list = useRef<HTMLUListElement | null>(null)

  const listId = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`

  const selected = options.find((option) => option.id === value) ?? null

  const matches = useMemo(() => {
    const needle = term.trim().toLowerCase()
    if (!needle) return options
    return options.filter(
      (option) =>
        option.name.toLowerCase().includes(needle) ||
        (option.secondary ?? '').toLowerCase().includes(needle),
    )
  }, [options, term])

  // Opening lands on the current choice rather than the top of the list: the
  // commonest reason to open this is to look at what is already chosen.
  useEffect(() => {
    if (!open) return
    const index = matches.findIndex((option) => option.id === value)
    setActive(index >= 0 ? index : 0)
    const timer = window.setTimeout(() => search.current?.focus(), 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    setActive((current) => (current > matches.length - 1 ? 0 : current))
  }, [matches.length])

  useEffect(() => {
    if (!open) return undefined

    function onPointerDown(event: MouseEvent) {
      if (wrap.current && !wrap.current.contains(event.target as Node)) close(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open || !list.current) return
    list.current.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  function close(refocus = true) {
    setOpen(false)
    setTerm('')
    if (refocus) trigger.current?.focus()
  }

  function choose(option: AccountOption) {
    onChange(option.id)
    close()
  }

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key === 'Tab') {
      close(false)
      return
    }
    if (matches.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((n) => (n + 1) % matches.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((n) => (n - 1 + matches.length) % matches.length)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActive(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setActive(matches.length - 1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const option = matches[active]
      if (option) choose(option)
    }
  }

  const describedBy = [fieldError ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ')
  const unusable = disabled || loading || Boolean(error)

  return (
    <div className="billing-field billing-ledger-field">
      <label id={`${id}-label`} htmlFor={id}>
        {label}
        {required && <span className="billing-required" aria-hidden> *</span>}
        {required && <span className="billing-sr-only"> (required)</span>}
      </label>

      <div className="billing-ledger-select" ref={wrap}>
        <button
          type="button"
          id={id}
          ref={trigger}
          className="billing-ledger-select__trigger"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          aria-labelledby={`${id}-label ${id}`}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={describedBy || undefined}
          disabled={unusable}
          onClick={() => setOpen((value) => !value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setOpen(true)
            }
          }}
        >
          {icon && <span className="billing-ledger-select__icon" aria-hidden>{icon}</span>}
          <span className="billing-ledger-select__value">
            {loading && <span className="billing-ledger-select__muted">Loading accounts…</span>}
            {!loading && error && <span className="billing-ledger-select__muted">Unavailable</span>}
            {!loading && !error && selected && (
              <>
                <span className="billing-ledger-select__name">{selected.name}</span>
                {selected.secondary && (
                  <span className="billing-ledger-select__secondary">{selected.secondary}</span>
                )}
              </>
            )}
            {!loading && !error && !selected && <span className="billing-ledger-select__muted">{placeholder}</span>}
          </span>
          <ChevronDown size={16} aria-hidden className="billing-ledger-select__chevron" />
        </button>

        {open && (
          <div className="billing-ledger-select__popup">
            <div className="billing-ledger-select__search">
              <Search size={14} aria-hidden />
              <input
                ref={search}
                type="text"
                value={term}
                placeholder="Search accounts…"
                aria-label={`Search ${label.toLowerCase()}`}
                aria-controls={listId}
                aria-activedescendant={matches[active] ? `${listId}-${matches[active].id}` : undefined}
                onChange={(event) => setTerm(event.target.value)}
                onKeyDown={onSearchKeyDown}
              />
            </div>

            <ul className="billing-ledger-select__list" id={listId} role="listbox" aria-label={label} ref={list}>
              {matches.map((option, index) => (
                <li
                  key={option.id}
                  id={`${listId}-${option.id}`}
                  role="option"
                  aria-selected={option.id === value}
                  data-active={index === active}
                  className="billing-ledger-select__option"
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                >
                  <span className="billing-ledger-select__option-main">
                    <span className="billing-ledger-select__name">{option.name}</span>
                    {option.secondary && (
                      <span className="billing-ledger-select__secondary">{option.secondary}</span>
                    )}
                  </span>
                  {option.trailing && <span className="billing-ledger-select__trailing num">{option.trailing}</span>}
                  {option.id === value && <Check size={15} aria-hidden className="billing-ledger-select__tick" />}
                </li>
              ))}
              {matches.length === 0 && (
                <li className="billing-ledger-select__none" role="presentation">
                  {options.length === 0 ? emptyMessage : `Nothing matches “${term.trim()}”.`}
                  {options.length === 0 && emptyAction && (
                    <span className="billing-ledger-select__none-action">{emptyAction}</span>
                  )}
                </li>
              )}
            </ul>
          </div>
        )}
      </div>

      {error && (
        <p className="billing-field__error billing-ledger-field__failed">
          <AlertCircle size={13} aria-hidden /> {error}
          {onRetry && (
            <button type="button" className="billing-linkbutton" onClick={onRetry}>
              Try again
            </button>
          )}
        </p>
      )}

      {!error && !loading && options.length === 0 && (
        <p className="billing-field__hint">
          {emptyMessage}
          {emptyAction && <> {emptyAction}</>}
        </p>
      )}

      {fieldError && <p className="billing-field__error" id={errorId}>{fieldError}</p>}
      {hint && !fieldError && <p className="billing-field__hint" id={hintId}>{hint}</p>}
    </div>
  )
}
