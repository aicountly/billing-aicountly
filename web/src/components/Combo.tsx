/**
 * The type-ahead this product searches other products' records with.
 *
 * One component everywhere, because they have to behave identically under the
 * hands of somebody billing at a counter: the same debounce, the same arrow
 * keys, the same three states when nothing comes back. A second implementation
 * is how the item box ends up selecting on Tab and the customer box does not.
 * It started on the bill screen and now serves the purchase grid as well,
 * which is why it lives here rather than under one screen's folder.
 *
 * WHAT IT DOES NOT DO: hold a list. Every keystroke asks the product that owns
 * the records — Books for parties, Inventory for items — through this product's
 * own read-through endpoints. Nothing is prefetched and nothing survives the
 * choice except the record the caller was handed.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Search, X } from 'lucide-react'

export interface ComboRenderedOption {
  /** The bold first line. */
  name: string
  /** Right of the name — a rate, a balance. */
  trailing?: ReactNode
  /** Small grey facts underneath: GSTIN, SKU, HSN, stock. */
  meta?: ReactNode[]
}

export function Combo<T>({
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
  portal = false,
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
  inputRef?: Ref<HTMLInputElement>
  describedBy?: string
  minChars?: number
  emptyAction?: ReactNode
  /**
   * Draw the list in a portal, positioned against the viewport.
   *
   * A grid scrolls sideways (`overflow-x: auto`), and an absolutely positioned
   * list inside one is clipped by it — a line whose item list is half visible
   * is a line nobody can fill in. Pass this wherever the field sits in a
   * scroller.
   */
  portal?: boolean
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
  const list = useRef<HTMLUListElement>(null)
  const [anchor, setAnchor] = useState<{ left: number; top: number; bottom: number; width: number } | null>(null)

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
      const target = event.target as Node
      // The portalled list is not a DOM descendant of the box, so it has to be
      // asked separately or clicking an option would close the list first.
      if (box.current?.contains(target) || list.current?.contains(target)) return
      setOpen(false)
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

  const measure = useCallback(() => {
    const rect = box.current?.getBoundingClientRect()
    if (rect) setAnchor({ left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width })
  }, [])

  useLayoutEffect(() => {
    if (!portal || !showList) return undefined

    measure()
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [portal, showList, measure])

  /** Above the field when there is no room for the list below it. */
  const floating =
    portal && anchor
      ? {
          left: anchor.left,
          width: Math.max(anchor.width, 260),
          ...(window.innerHeight - anchor.bottom < 240 && anchor.top > 260
            ? { bottom: window.innerHeight - anchor.top + 4 }
            : { top: anchor.bottom + 4 }),
        }
      : undefined

  const renderList = (node: ReactNode) => (portal ? createPortal(node, document.body) : node)

  return (
    <div
      ref={box}
      className={`billing-combo${compact ? ' billing-combo--compact' : ''}${invalid ? ' billing-combo--invalid' : ''}`}
    >
      <div className="billing-combo__field">
        <Search size={compact ? 13 : 15} className="billing-combo__icon" aria-hidden />
        <input
          ref={inputRef}
          className="billing-combo__input"
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={label}
          aria-describedby={describedBy}
          // The red border is not enough on its own: colour is the one signal
          // a screen reader and a colour-blind user both miss.
          aria-invalid={invalid || undefined}
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
        {busy && <Loader2 size={14} className="billing-combo__busy spin" aria-hidden />}
        {!busy && selected && onClear && (
          <button type="button" className="billing-combo__clear" onClick={onClear} aria-label={`Clear ${label}`}>
            <X size={14} aria-hidden />
          </button>
        )}
      </div>

      {showList && renderList(
        <ul
          ref={list}
          className={`billing-combo__list${portal ? ' billing-combo__list--floating' : ''}`}
          id={listId}
          role="listbox"
          aria-label={label}
          style={floating}
        >
          {busy && shown.length === 0 && (
            <li className="billing-combo__status">
              <Loader2 size={14} className="spin" aria-hidden /> Searching…
            </li>
          )}

          {failed && (
            <li className="billing-combo__status billing-combo__status--error">
              <span>Could not reach the app that holds this list.</span>
              <button type="button" className="billing-combo__retry" onClick={() => setAttempt((n) => n + 1)}>
                Retry
              </button>
            </li>
          )}

          {!busy && !failed && searching && shown.length === 0 && (
            <li className="billing-combo__status">
              <span>No matches for “{trimmed}”.</span>
              {emptyAction}
            </li>
          )}

          {!searching && idleHeading && shown.length > 0 && (
            <li className="billing-combo__status" aria-hidden>
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
                  className="billing-combo__option"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(record)}
                >
                  <span className="billing-combo__option-top">
                    <span className="billing-combo__option-name">{rendered.name}</span>
                    {rendered.trailing !== undefined && <span className="num">{rendered.trailing}</span>}
                  </span>
                  {rendered.meta && rendered.meta.filter(Boolean).length > 0 && (
                    <span className="billing-combo__option-meta">
                      {rendered.meta.filter(Boolean).map((part, position) => (
                        <span key={position}>{part}</span>
                      ))}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>,
      )}
    </div>
  )
}
