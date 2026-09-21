/**
 * Who the money came from.
 *
 * Every keystroke asks Smart Books through this product's read-through
 * endpoint — the same `v1/catalog/parties` the rest of Billing uses. Nothing is
 * prefetched, no list of customers is held in the browser, and nothing survives
 * the choice except the account id.
 *
 * It is a combobox in the ARIA sense: the input keeps focus, the arrow keys
 * move a highlight the input announces through aria-activedescendant, Enter
 * chooses and Escape closes. Somebody at a counter with a customer waiting
 * should never have to reach for the mouse.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { api } from '../../services/api'
import type { CatalogParty } from '../../services/types'
import type { ChosenParty } from './form'
import { Field } from './fields'

const MIN_TERM = 2

export function CustomerPicker({
  party,
  onPick,
  onClear,
  error,
  inputRef,
}: {
  party: ChosenParty | null
  onPick: (party: ChosenParty) => void
  onClear: () => void
  error?: string
  inputRef?: React.RefObject<HTMLInputElement | null>
}) {
  const listId = useId()
  const fieldId = useId()
  const [term, setTerm] = useState('')
  const [options, setOptions] = useState<CatalogParty[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const box = useRef<HTMLDivElement>(null)

  // 250ms, the same wait the item and party pickers elsewhere use. Fast enough
  // to feel live, slow enough that a five-letter name is one request.
  useEffect(() => {
    const trimmed = term.trim()
    if (trimmed.length < MIN_TERM) {
      setOptions([])
      setBusy(false)
      setFailed(false)
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(() => {
      setBusy(true)
      setFailed(false)
      api
        .list<CatalogParty>('v1/catalog/parties', { q: trimmed, side: 'customer' }, controller.signal)
        .then((response) => {
          setOptions(response.data)
          setHighlighted(0)
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
    function onPointerDown(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  function choose(option: CatalogParty) {
    onPick({ id: option.acc_id, name: option.acc_name, gstin: option.gstin ?? null })
    setTerm('')
    setOptions([])
    setOpen(false)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!open || options.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlighted((n) => (n + 1) % options.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlighted((n) => (n - 1 + options.length) % options.length)
    } else if (event.key === 'Enter') {
      const chosen = options[highlighted]
      if (chosen) {
        event.preventDefault()
        choose(chosen)
      }
    }
  }

  if (party) {
    return (
      <Field label="Customer" required error={error}>
        <div className="billing-receipt-combo__chosen">
          <span style={{ minWidth: 0 }}>
            <strong>{party.name}</strong>
            {party.gstin && <small>{party.gstin}</small>}
          </span>
          <button
            type="button"
            className="billing-iconbutton"
            onClick={() => {
              onClear()
              setTerm('')
              // Back to the box the user just cleared, ready for the next name.
              window.requestAnimationFrame(() => inputRef?.current?.focus())
            }}
            aria-label={`Clear ${party.name}`}
            title="Choose a different customer"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
      </Field>
    )
  }

  const showList = open && term.trim().length >= MIN_TERM

  return (
    <Field label="Customer" required error={error} htmlFor={fieldId}>
      <div className="billing-receipt-combo" ref={box}>
        <div className="billing-receipt-input">
          <span className="billing-receipt-input__icon" aria-hidden="true">
            <Search size={15} />
          </span>
          <input
            id={fieldId}
            ref={inputRef}
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList && options.length > 0 ? `${listId}-${highlighted}` : undefined}
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            placeholder="Search customer name / code…"
            value={term}
            onChange={(event) => {
              setTerm(event.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />
        </div>

        {showList && (
          <ul className="billing-receipt-combo__list" id={listId} role="listbox" aria-label="Matching customers">
            {busy && <li className="billing-receipt-combo__note">Searching Smart Books…</li>}
            {failed && (
              <li className="billing-receipt-combo__note" style={{ color: 'var(--billing-danger)' }}>
                Could not reach the app that holds your customers. Try again in a moment.
              </li>
            )}
            {!busy && !failed && options.length === 0 && (
              <li className="billing-receipt-combo__note">No customer matches that.</li>
            )}
            {options.map((option, index) => (
              <li
                key={option.acc_id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === highlighted}
                className="billing-receipt-combo__option"
                onMouseEnter={() => setHighlighted(index)}
                onMouseDown={(event) => {
                  // mousedown rather than click: the input must not lose focus
                  // and close the list before the choice lands.
                  event.preventDefault()
                  choose(option)
                }}
              >
                {option.acc_name}
                {option.gstin && <small>{option.gstin}</small>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Field>
  )
}
