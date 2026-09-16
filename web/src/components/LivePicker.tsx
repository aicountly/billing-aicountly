import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { api } from '../services/api'
import type { CatalogItem, CatalogParty } from '../services/types'

/**
 * Type-ahead pickers for records another product owns.
 *
 * Every keystroke asks Inventory (items) or Books (parties) through this
 * product's read-through endpoint. Nothing is prefetched into a local list and
 * nothing survives the choice except the id.
 */

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
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
}: {
  label: string
  placeholder?: string
  selectedLabel?: string | null
  onPick: (record: T) => void
  search: (term: string, signal: AbortSignal) => Promise<T[]>
  renderOption: (record: T) => string
  keyOf: (record: T) => string | number
  autoFocus?: boolean
}) {
  const [term, setTerm] = useState('')
  const [options, setOptions] = useState<T[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const debounced = useDebounced(term, 250)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (debounced.trim().length < 2) {
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
  }, [debounced, search])

  useEffect(() => {
    function onClickAway(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickAway)
    return () => document.removeEventListener('mousedown', onClickAway)
  }, [])

  /**
   * Arrow keys and Enter, because this screen is used at a counter with a
   * customer waiting and reaching for the mouse costs real seconds.
   */
  function onKeyDown(event: React.KeyboardEvent) {
    if (!open || options.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlighted((n) => Math.min(n + 1, options.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlighted((n) => Math.max(n - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const chosen = options[highlighted]
      if (chosen) {
        onPick(chosen)
        setTerm('')
        setOpen(false)
      }
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--muted)', marginBottom: '0.25rem' }}>{label}</span>
      <div style={{ position: 'relative' }}>
        <Search size={14} aria-hidden style={{ position: 'absolute', left: '0.5rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
        <input
          value={term}
          placeholder={selectedLabel ?? placeholder ?? 'Type to search…'}
          autoFocus={autoFocus}
          onChange={(event) => {
            setTerm(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          style={{
            width: '100%',
            padding: '0.5rem 0.55rem 0.5rem 1.7rem',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--surface)',
            fontSize: '1rem',
          }}
        />
      </div>

      {open && term.trim().length >= 2 && (
        <div
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
          {busy && <div style={{ padding: '0.6rem', color: 'var(--muted)' }}>Searching…</div>}
          {failed && (
            <div style={{ padding: '0.6rem', color: 'var(--danger)' }}>
              Could not reach the app that holds this list. Try again in a moment.
            </div>
          )}
          {!busy && !failed && options.length === 0 && <div style={{ padding: '0.6rem', color: 'var(--muted)' }}>No matches.</div>}
          {options.map((option, index) => (
            <button
              key={keyOf(option)}
              type="button"
              onMouseEnter={() => setHighlighted(index)}
              onClick={() => {
                onPick(option)
                setTerm('')
                setOpen(false)
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '0.55rem 0.6rem',
                border: 'none',
                background: index === highlighted ? 'var(--surface-2)' : 'transparent',
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
}: {
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
      label="Item"
      placeholder="Type or scan…"
      selectedLabel={selectedLabel}
      onPick={onPick}
      search={search}
      autoFocus={autoFocus}
      keyOf={(item) => item.item_id}
      renderOption={(item) => (item.item_sku ? `${item.item_name} · ${item.item_sku}` : item.item_name)}
    />
  )
}

export function PartyPicker({
  side = 'customer',
  onPick,
  selectedLabel,
  autoFocus,
}: {
  side?: 'customer' | 'supplier'
  onPick: (party: CatalogParty) => void
  selectedLabel?: string | null
  autoFocus?: boolean
}) {
  const search = useMemo(
    () => async (term: string, signal: AbortSignal) => {
      const response = await api.list<CatalogParty>('v1/catalog/parties', { q: term, side }, signal)
      return response.data
    },
    [side],
  )

  return (
    <Picker
      label={side === 'supplier' ? 'Supplier' : 'Customer'}
      placeholder="Type a name…"
      selectedLabel={selectedLabel}
      onPick={onPick}
      search={search}
      autoFocus={autoFocus}
      keyOf={(party) => party.acc_id}
      renderOption={(party) => (party.gstin ? `${party.acc_name} · ${party.gstin}` : party.acc_name)}
    />
  )
}
