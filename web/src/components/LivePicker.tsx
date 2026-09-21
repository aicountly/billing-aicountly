import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { api } from '../services/api'
import type { CatalogItem, CatalogParty } from '../services/types'

/**
 * Type-ahead pickers for records another product owns.
 *
 * Every keystroke asks Inventory (items) or Books (parties) through this
 * product's read-through endpoint. Nothing is prefetched into a local list and
 * nothing survives the choice except the id.
 *
 * The BEHAVIOUR lives in `useTypeahead` and the MARKUP lives in whoever calls
 * it. That split exists because the behaviour is the part with the sharp edges
 * — a debounce, an abort on every new term, and a highlight that has to survive
 * a response arriving after the user has already typed further — and the money
 * and debit note screens need the same behaviour inside a different control.
 * Two copies of this logic would be two sets of those bugs.
 */

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

export interface Typeahead<T> {
  term: string
  setTerm: (term: string) => void
  options: T[]
  open: boolean
  setOpen: (open: boolean) => void
  busy: boolean
  failed: boolean
  highlighted: number
  setHighlighted: (index: number) => void
  /** True once the term is long enough for the list to be worth drawing. */
  ready: boolean
  choose: (record: T) => void
  onKeyDown: (event: React.KeyboardEvent) => void
  boxRef: React.RefObject<HTMLDivElement | null>
}

export function useTypeahead<T>({
  search,
  onPick,
  minChars = 2,
  debounceMs = 250,
}: {
  search: (term: string, signal: AbortSignal) => Promise<T[]>
  onPick: (record: T) => void
  minChars?: number
  debounceMs?: number
}): Typeahead<T> {
  const [term, setTerm] = useState('')
  const [options, setOptions] = useState<T[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const debounced = useDebounced(term, debounceMs)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (debounced.trim().length < minChars) {
      setOptions([])
      return
    }

    const controller = new AbortController()
    setBusy(true)
    setFailed(false)

    search(debounced.trim(), controller.signal)
      .then((rows) => {
        setOptions(rows)
        setHighlighted(0)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
      .finally(() => setBusy(false))

    return () => controller.abort()
  }, [debounced, search, minChars])

  useEffect(() => {
    function onClickAway(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickAway)
    return () => document.removeEventListener('mousedown', onClickAway)
  }, [])

  const choose = useCallback(
    (record: T) => {
      onPick(record)
      setTerm('')
      setOpen(false)
    },
    [onPick],
  )

  /**
   * Arrow keys and Enter, because this screen is used at a counter with a
   * customer waiting and reaching for the mouse costs real seconds.
   *
   * Escape closes the list and stops there — it does not bubble on to clear the
   * field or leave the screen, which is what the browser would otherwise do
   * with it inside a form.
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape' && open) {
        event.stopPropagation()
        setOpen(false)
        return
      }
      if (!open || options.length === 0) return

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setHighlighted(Math.min(highlighted + 1, options.length - 1))
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setHighlighted(Math.max(highlighted - 1, 0))
      } else if (event.key === 'Enter') {
        event.preventDefault()
        const chosen = options[highlighted]
        if (chosen) choose(chosen)
      }
    },
    [open, options, highlighted, choose],
  )

  return {
    term,
    setTerm,
    options,
    open,
    setOpen,
    busy,
    failed,
    highlighted,
    setHighlighted,
    ready: term.trim().length >= minChars,
    choose,
    onKeyDown,
    boxRef,
  }
}

/** The search used by every party field in the app, parameterised by side. */
export function usePartySearch(side: 'customer' | 'supplier') {
  return useMemo(
    () => async (term: string, signal: AbortSignal) => {
      const response = await api.list<CatalogParty>('v1/catalog/parties', { q: term, side }, signal)
      return response.data
    },
    [side],
  )
}

/**
 * The optional props exist so a screen can put this picker inside its own field
 * layout — with that layout's label, control styling and error wiring — without
 * a second copy of `useTypeahead`'s wiring. Left out, the picker looks and
 * behaves exactly as it always has.
 */
interface PickerChrome {
  /** Hide the built-in label when the surrounding field already draws one. */
  hideLabel?: boolean
  required?: boolean
  /** Replaces the built-in inline control styling. */
  inputClassName?: string
  inputId?: string
  describedBy?: string
  /** The surrounding field prints the message; this only marks the control. */
  invalid?: boolean
}

function Picker<T>({
  label,
  placeholder,
  selectedLabel,
  onPick,
  search,
  renderOption,
  keyOf,
  autoFocus,
  hideLabel = false,
  required = false,
  inputClassName,
  inputId,
  describedBy,
  invalid = false,
}: PickerChrome & {
  label: string
  placeholder?: string
  selectedLabel?: string | null
  onPick: (record: T) => void
  search: (term: string, signal: AbortSignal) => Promise<T[]>
  renderOption: (record: T) => ReactNode
  keyOf: (record: T) => string | number
  autoFocus?: boolean
}) {
  const picker = useTypeahead<T>({ search, onPick })
  const generatedId = useId()
  const listId = `${inputId ?? generatedId}-options`
  const showList = picker.open && picker.ready

  return (
    <div ref={picker.boxRef} style={{ position: 'relative' }}>
      {!hideLabel && (
        <label
          htmlFor={inputId}
          style={{ display: 'block', fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '0.25rem' }}
        >
          {label}
          {required && <span style={{ color: 'var(--danger)', marginLeft: 2 }} aria-hidden>*</span>}
        </label>
      )}
      <div style={{ position: 'relative' }}>
        <Search size={14} aria-hidden style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)', zIndex: 1 }} />
        <input
          id={inputId}
          value={picker.term}
          placeholder={selectedLabel ?? placeholder ?? 'Type to search…'}
          autoFocus={autoFocus}
          role="combobox"
          aria-expanded={showList}
          aria-controls={showList ? listId : undefined}
          aria-autocomplete="list"
          aria-label={hideLabel ? label : undefined}
          aria-required={required || undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(event) => {
            picker.setTerm(event.target.value)
            picker.setOpen(true)
          }}
          onFocus={() => picker.setOpen(true)}
          onKeyDown={picker.onKeyDown}
          className={inputClassName}
          style={
            inputClassName
              ? { paddingLeft: '1.9rem' }
              : {
                  width: '100%',
                  padding: '0.5rem 0.55rem 0.5rem 1.7rem',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--surface)',
                  fontSize: '1rem',
                }
          }
        />
      </div>

      {showList && (
        <div
          id={listId}
          role="listbox"
          aria-label={label}
          style={{
            position: 'absolute',
            zIndex: 20,
            top: '100%',
            left: 0,
            right: 0,
            marginTop: '0.2rem',
            background: 'var(--surface)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-lg)',
            maxHeight: '16rem',
            overflowY: 'auto',
          }}
        >
          {picker.busy && <div style={{ padding: '0.6rem', color: 'var(--muted)' }}>Searching…</div>}
          {picker.failed && (
            <div style={{ padding: '0.6rem', color: 'var(--danger)' }}>
              Could not reach the app that holds this list. Try again in a moment.
            </div>
          )}
          {!picker.busy && !picker.failed && picker.options.length === 0 && (
            <div style={{ padding: '0.6rem', color: 'var(--muted)' }}>No matches.</div>
          )}
          {picker.options.map((option, index) => (
            <button
              key={keyOf(option)}
              type="button"
              role="option"
              aria-selected={index === picker.highlighted}
              onMouseEnter={() => picker.setHighlighted(index)}
              onClick={() => picker.choose(option)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '0.55rem 0.6rem',
                border: 'none',
                background: index === picker.highlighted ? 'var(--surface-2)' : 'transparent',
                cursor: 'pointer',
              }}
            >
              {renderOption(option)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ItemPicker({
  onPick,
  selectedLabel,
  autoFocus,
  ...chrome
}: PickerChrome & {
  onPick: (item: CatalogItem) => void
  selectedLabel?: string | null
  autoFocus?: boolean
}) {
  const search = useMemo(
    () => async (term: string, signal: AbortSignal) => {
      const response = await api.list<CatalogItem>('v1/catalog/items/search', { q: term }, signal)
      return response.data
    },
    [],
  )

  return (
    <Picker
      {...chrome}
      label="Item"
      placeholder="Search or select item…"
      selectedLabel={selectedLabel}
      onPick={onPick}
      search={search}
      autoFocus={autoFocus}
      keyOf={(item) => item.item_id}
      renderOption={(item) => (
        <>
          <span style={{ display: 'block' }}>{item.item_name}</span>
          {(item.item_sku || item.hsn_sac) && (
            <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--muted)' }}>
              {[item.item_sku, item.hsn_sac ? `HSN ${item.hsn_sac}` : null].filter(Boolean).join(' · ')}
            </span>
          )}
        </>
      )}
    />
  )
}

export function PartyPicker({
  side = 'customer',
  onPick,
  selectedLabel,
  autoFocus,
  ...chrome
}: PickerChrome & {
  side?: 'customer' | 'supplier'
  onPick: (party: CatalogParty) => void
  selectedLabel?: string | null
  autoFocus?: boolean
}) {
  const search = usePartySearch(side)

  return (
    <Picker
      {...chrome}
      label={side === 'supplier' ? 'Supplier' : 'Customer'}
      placeholder={side === 'supplier' ? 'Select supplier' : 'Type a name…'}
      selectedLabel={selectedLabel}
      onPick={onPick}
      search={search}
      autoFocus={autoFocus}
      keyOf={(party) => party.acc_id}
      renderOption={(party) => (
        <>
          <span style={{ display: 'block' }}>{party.acc_name}</span>
          {party.gstin && (
            <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--muted)' }}>{party.gstin}</span>
          )}
        </>
      )}
    />
  )
}
