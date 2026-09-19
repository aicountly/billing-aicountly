/**
 * The type-ahead this product searches other products' records with.
 *
 * Every keystroke asks the product that OWNS the list — Inventory for items,
 * Books for parties — through this product's read-through endpoints. Nothing is
 * prefetched into a local array and nothing survives the choice except the id,
 * which is the rule the rest of Billing follows.
 *
 * It is its own component because two screens need the same search with
 * different shapes around it: the counter's single tall field (LivePicker,
 * which is built on this) and the purchase grid's dense in-cell field, whose
 * list has to escape a horizontally scrolling table. That escape is the
 * `portal` prop — a dropdown inside `overflow-x: auto` is clipped by it, and a
 * purchase line whose item list is half visible is a line nobody can fill in.
 *
 * Accessibility follows the ARIA combobox pattern: the input owns the listbox,
 * the active option is named by `aria-activedescendant` rather than focused so
 * the caret never leaves the field, and every state the eye gets — searching,
 * failed, empty — a screen reader gets as well.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react'
import { createPortal } from 'react-dom'

/** Where a portalled list should be drawn, in viewport coordinates. */
interface AnchorRect {
  left: number
  top: number
  bottom: number
  width: number
}

export interface ComboboxProps<T> {
  /** Visible label. Omit for an in-grid field and pass `ariaLabel` instead. */
  label?: string
  /** Names the field when there is no visible label. */
  ariaLabel?: string
  placeholder?: string
  /**
   * What is already chosen, shown as the placeholder rather than the value —
   * typing starts a fresh search instead of editing a name that belongs to
   * another product.
   */
  selectedLabel?: string | null
  /** Characters before the first request. Two by default; one letter matches everything. */
  minChars?: number
  debounceMs?: number
  autoFocus?: boolean
  disabled?: boolean
  /** Draws the error border. The message belongs to the field around it. */
  invalid?: boolean
  /** Grid height rather than form height. */
  dense?: boolean
  id?: string
  /** Any React ref, including a callback — the grid uses one to move focus between rows. */
  inputRef?: Ref<HTMLInputElement>
  /** Render the list in a portal. Needed inside anything that scrolls or clips. */
  portal?: boolean
  leading?: ReactNode
  emptyMessage?: string
  /** A row under the results — a hint, a count, an "add this one" action. */
  footer?: (close: () => void, term: string) => ReactNode
  search: (term: string, signal: AbortSignal) => Promise<T[]>
  keyOf: (record: T) => string | number
  renderOption: (record: T) => ReactNode
  onPick: (record: T) => void
  /** Keys this combobox did not consume — Enter-to-advance in a grid, for instance. */
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
}

export function Combobox<T>({
  label,
  ariaLabel,
  placeholder,
  selectedLabel,
  minChars = 2,
  debounceMs = 250,
  autoFocus,
  disabled,
  invalid,
  dense,
  id,
  inputRef,
  portal,
  leading,
  emptyMessage = 'No matches.',
  footer,
  search,
  keyOf,
  renderOption,
  onPick,
  onKeyDown,
}: ComboboxProps<T>) {
  const generatedId = useId()
  const fieldId = id ?? `combobox-${generatedId}`
  const listId = `${fieldId}-list`

  const [term, setTerm] = useState('')
  const [options, setOptions] = useState<T[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const [anchor, setAnchor] = useState<AnchorRect | null>(null)

  const boxRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const showList = open && term.trim().length >= minChars

  // ------------------------------------------------------------- searching

  useEffect(() => {
    const trimmed = term.trim()
    if (trimmed.length < minChars) {
      setOptions([])
      setBusy(false)
      setFailed(false)
      return undefined
    }

    const controller = new AbortController()

    // Debounced, then aborted on the way out: without the abort a user typing
    // faster than the network gets the FIRST response painted last, and the
    // list shows matches for a word they have already finished replacing.
    const timer = setTimeout(() => {
      setBusy(true)
      setFailed(false)

      search(trimmed, controller.signal)
        .then((rows) => {
          if (controller.signal.aborted) return
          setOptions(rows)
          setHighlighted(0)
        })
        .catch(() => {
          if (!controller.signal.aborted) setFailed(true)
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false)
        })
    }, debounceMs)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [term, minChars, debounceMs, search])

  // ------------------------------------------------------------ positioning

  const measure = useCallback(() => {
    const node = boxRef.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    setAnchor({ left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width })
  }, [])

  useLayoutEffect(() => {
    if (!portal || !showList) return undefined

    measure()
    // Capture phase: the table this field sits in scrolls, and a scroll on an
    // ancestor does not bubble.
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)

    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [portal, showList, measure])

  // ------------------------------------------------------------- dismissal

  useEffect(() => {
    if (!open) return undefined

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (boxRef.current?.contains(target)) return
      if (listRef.current?.contains(target)) return
      setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  function choose(record: T) {
    onPick(record)
    setTerm('')
    setOptions([])
    setOpen(false)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      // Stopped here so Escape closes the list without also closing whatever
      // dialog or drawer the field happens to be sitting in.
      event.stopPropagation()
      setOpen(false)
      return
    }

    if (showList && options.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setHighlighted((n) => Math.min(n + 1, options.length - 1))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setHighlighted((n) => Math.max(n - 1, 0))
        return
      }
      if (event.key === 'Enter') {
        const chosen = options[highlighted]
        if (chosen !== undefined) {
          event.preventDefault()
          choose(chosen)
          return
        }
      }
    }

    onKeyDown?.(event)
  }

  const activeId = showList && options.length > 0 ? `${listId}-option-${highlighted}` : undefined

  /** Flipped above the field when there is no room below it. */
  function floatingPosition(rect: AnchorRect) {
    const roomBelow = window.innerHeight - rect.bottom
    return roomBelow < 240 && rect.top > 260
      ? { bottom: window.innerHeight - rect.top + 4 }
      : { top: rect.bottom + 4 }
  }

  const list = (
    <div
      ref={listRef}
      id={listId}
      role="listbox"
      aria-label={label ?? ariaLabel ?? 'Results'}
      className={`billing-combobox__list${portal ? ' billing-combobox__list--floating' : ''}`}
      style={
        portal && anchor
          ? { left: anchor.left, width: Math.max(anchor.width, 260), ...floatingPosition(anchor) }
          : undefined
      }
    >
      {busy && (
        <p className="billing-combobox__state" role="status">
          Searching…
        </p>
      )}

      {failed && (
        <p className="billing-combobox__state billing-combobox__state--error" role="status">
          Could not reach the app that holds this list. Try again in a moment.
        </p>
      )}

      {!busy && !failed && options.length === 0 && (
        <p className="billing-combobox__state" role="status">
          {emptyMessage}
        </p>
      )}

      {options.map((option, index) => (
        <button
          key={keyOf(option)}
          id={`${listId}-option-${index}`}
          type="button"
          role="option"
          aria-selected={index === highlighted}
          tabIndex={-1}
          className={`billing-combobox__option${index === highlighted ? ' is-active' : ''}`}
          onMouseEnter={() => setHighlighted(index)}
          onClick={() => choose(option)}
        >
          {renderOption(option)}
        </button>
      ))}

      {footer?.(() => setOpen(false), term.trim())}
    </div>
  )

  return (
    <div ref={boxRef} className={`billing-combobox${dense ? ' billing-combobox--dense' : ''}`}>
      {label && (
        <label className="billing-combobox__label" htmlFor={fieldId}>
          {label}
        </label>
      )}

      <div className="billing-combobox__control">
        {leading && (
          <span className="billing-combobox__leading" aria-hidden>
            {leading}
          </span>
        )}
        <input
          id={fieldId}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-label={label ? undefined : ariaLabel}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          className={`billing-combobox__input${leading ? ' has-leading' : ''}${invalid ? ' is-invalid' : ''}`}
          value={term}
          placeholder={selectedLabel ?? placeholder ?? 'Type to search…'}
          // The grid is narrow and a long item name is cut off in it. The full
          // name on hover costs nothing and saves opening the line to read it.
          title={selectedLabel ?? undefined}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(event) => {
            setTerm(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
      </div>

      {showList && (portal ? createPortal(list, document.body) : list)}
    </div>
  )
}
