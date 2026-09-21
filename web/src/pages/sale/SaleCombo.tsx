/**
 * The type-ahead this screen searches customers and items with.
 *
 * One component for both, because the two have to behave identically under the
 * hands of somebody billing at a counter: the same debounce, the same arrow
 * keys, the same three states when nothing comes back. A second implementation
 * is how the item box ends up selecting on Tab and the customer box does not.
 *
 * WHAT IT DOES NOT DO: hold a list. Every keystroke asks the product that owns
 * the records — Books for parties, Inventory for items — through this product's
 * own read-through endpoints. Nothing is prefetched and nothing survives the
 * choice except the record the caller was handed.
 */

import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Loader2, Search, X } from 'lucide-react'

export interface ComboRenderedOption {
  /** The bold first line. */
  name: string
  /** Right of the name — a rate, a balance. */
  trailing?: ReactNode
  /** Small grey facts underneath: GSTIN, SKU, HSN, stock. */
  meta?: ReactNode[]
}

export function SaleCombo<T>({
  label,
  placeholder,
  search,
  renderOption,
  keyOf,
  onPick,
  onSubmitTerm,
  idleOptions,
  idleHeading,
  selected,
  onClear,
  compact = false,
  invalid = false,
  autoFocus = false,
  inputRef,
  describedBy,
  minChars = 2,
  emptyAction,
}: {
  label: string
  placeholder: string
  search: (term: string, signal: AbortSignal) => Promise<T[]>
  renderOption: (record: T) => ComboRenderedOption
  keyOf: (record: T) => string | number
  onPick: (record: T) => void
  /**
   * Enter pressed with nothing highlighted. A barcode reader is a keyboard that
   * types fast and presses Enter, so this is how a scan reaches the caller.
   */
  onSubmitTerm?: (term: string) => void
  /** Offered before anything is typed — recent customers, this user's usual items. */
  idleOptions?: T[]
  idleHeading?: string
  /** What is currently chosen, shown in the box instead of the placeholder. */
  selected?: string | null
  onClear?: () => void
  compact?: boolean
  invalid?: boolean
  autoFocus?: boolean
  inputRef?: RefObject<HTMLInputElement | null>
  describedBy?: string
  minChars?: number
  emptyAction?: ReactNode
}) {
  const listId = useId()
  const [term, setTerm] = useState('')
  const [options, setOptions] = useState<T[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [active, setActive] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const fallbackRef = useRef<HTMLInputElement>(null)
  const field = inputRef ?? fallbackRef

  const trimmed = term.trim()
  const searching = trimmed.length >= minChars

  /** What the list is showing right now: the search results, or the idle list. */
  const shown = useMemo(
    () => (searching ? options : (idleOptions ?? [])),
    [searching, options, idleOptions],
  )

  // Debounced: without it this fires at Books or Inventory on every keystroke.
  useEffect(() => {
    if (!searching) {
      setOptions([])
      setFailed(false)
      setBusy(false)
      return undefined
    }

    const controller = new AbortController()
    const timer = setTimeout(() => {
      setBusy(true)
      setFailed(false)
      search(trimmed, controller.signal)
        .then((rows) => {
          if (controller.signal.aborted) return
          setOptions(rows)
          setActive(0)
        })
        .catch(() => {
          if (!controller.signal.aborted) setFailed(true)
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false)
        })
    }, 280)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [trimmed, searching, search, attempt])

  useEffect(() => {
    function away(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [])

  function choose(record: T) {
    onPick(record)
    setTerm('')
    setOptions([])
    setOpen(false)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((index) => Math.min(index + 1, Math.max(shown.length - 1, 0)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
      return
    }
    if (event.key === 'Escape') {
      if (open) {
        event.stopPropagation()
        setOpen(false)
      }
      return
    }
    if (event.key !== 'Enter') return

    const chosen = open ? shown[active] : undefined
    if (chosen !== undefined) {
      // Stop the Enter from also being the "move to the next field" the page
      // listens for: picking an option IS what this Enter did.
      event.preventDefault()
      event.stopPropagation()
      choose(chosen)
      return
    }
    // Nothing to pick. A barcode reader has just typed a code and pressed
    // Enter, so hand the caller the raw term rather than swallowing it.
    if (onSubmitTerm && trimmed !== '' && !busy) {
      event.preventDefault()
      event.stopPropagation()
      onSubmitTerm(trimmed)
      setTerm('')
      setOpen(false)
    }
  }

  const showList = open && (searching || (shown.length > 0 && trimmed === ''))

  return (
    <div
      ref={box}
      className={`billing-sale-combo${compact ? ' billing-sale-combo--compact' : ''}${invalid ? ' billing-sale-combo--invalid' : ''}`}
    >
      <div className="billing-sale-combo__field">
        <Search size={compact ? 13 : 15} className="billing-sale-combo__icon" aria-hidden />
        <input
          ref={field}
          className="billing-sale-combo__input"
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={label}
          aria-describedby={describedBy}
          aria-activedescendant={showList && shown[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          placeholder={selected ?? placeholder}
          value={term}
          autoFocus={autoFocus}
          onChange={(event) => {
            setTerm(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {busy && <Loader2 size={14} className="billing-sale-combo__busy spin" aria-hidden />}
        {!busy && selected && onClear && (
          <button type="button" className="billing-sale-combo__clear" onClick={onClear} aria-label={`Clear ${label}`}>
            <X size={14} aria-hidden />
          </button>
        )}
      </div>

      {showList && (
        <ul className="billing-sale-combo__list" id={listId} role="listbox" aria-label={label}>
          {busy && shown.length === 0 && (
            <li className="billing-sale-combo__status">
              <Loader2 size={14} className="spin" aria-hidden /> Searching…
            </li>
          )}

          {failed && (
            <li className="billing-sale-combo__status billing-sale-combo__status--error">
              <span>Could not reach the app that holds this list.</span>
              <button type="button" className="billing-sale-combo__retry" onClick={() => setAttempt((n) => n + 1)}>
                Retry
              </button>
            </li>
          )}

          {!busy && !failed && searching && shown.length === 0 && (
            <li className="billing-sale-combo__status">
              <span>No matches for “{trimmed}”.</span>
              {emptyAction}
            </li>
          )}

          {!searching && idleHeading && shown.length > 0 && (
            <li className="billing-sale-combo__status" aria-hidden>
              {idleHeading}
            </li>
          )}

          {shown.map((record, index) => {
            const rendered = renderOption(record)

            return (
              <li key={keyOf(record)} role="presentation">
                <button
                  type="button"
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className="billing-sale-combo__option"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(record)}
                >
                  <span className="billing-sale-combo__option-top">
                    <span className="billing-sale-combo__option-name">{rendered.name}</span>
                    {rendered.trailing !== undefined && <span className="num">{rendered.trailing}</span>}
                  </span>
                  {rendered.meta && rendered.meta.filter(Boolean).length > 0 && (
                    <span className="billing-sale-combo__option-meta">
                      {rendered.meta.filter(Boolean).map((part, position) => (
                        <span key={position}>{part}</span>
                      ))}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
