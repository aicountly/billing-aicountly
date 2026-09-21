/**
 * Search, the quick filters, the advanced panel and the export button.
 *
 * The search is sent to the server, debounced, because the table is paged there
 * — searching only the twenty-five rows in the browser would find nothing on
 * page two and quietly say so.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Loader2, Search, SlidersHorizontal, X } from 'lucide-react'
import { useDismiss } from './parts'
import { ADVANCED_KEYS, type PayablesQuery } from './query'
import type { DueParty, PayableCategories } from '../../services/types'

const CHIPS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'All bills' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'due_today', label: 'Due today' },
  { key: 'due_this_week', label: 'Due this week' },
  { key: 'not_due', label: 'Not yet due' },
]

/**
 * Filters that have no chip of their own, shown only while one is in force.
 *
 * "Next 30 days" comes from View all on the upcoming card and "No due date"
 * from the ageing bar. Neither earns a permanent chip, but a table narrowed by
 * something with nothing on screen admitting to it is a table people think is
 * broken.
 */
const IMPLIED: Record<string, string> = {
  next_30_days: 'Next 30 days',
  no_due_date: 'No due date',
  partially_paid: 'Part paid',
}

/** How long to wait before asking the server. Long enough to type a word. */
const DEBOUNCE_MS = 400

export function PayablesToolbar({
  query,
  patch,
  clearAdvanced,
  advancedCount,
  suppliers,
  categories,
  canExport,
  exporting,
  onExport,
}: {
  query: PayablesQuery
  patch: (changes: Partial<PayablesQuery>) => void
  clearAdvanced: () => void
  advancedCount: number
  suppliers: DueParty[]
  categories: PayableCategories | null
  canExport: boolean
  exporting: boolean
  onExport: () => void
}) {
  const [draft, setDraft] = useState(query.search)
  const committed = useRef(query.search)
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Somebody cleared the filters, or came back with the browser button: follow
  // the URL rather than leaving a stale word in the box.
  useEffect(() => {
    if (query.search !== committed.current) {
      committed.current = query.search
      setDraft(query.search)
    }
  }, [query.search])

  useEffect(() => {
    if (draft === committed.current) return undefined
    const timer = window.setTimeout(() => {
      committed.current = draft
      patch({ search: draft })
    }, DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [draft, patch])

  const closeFilters = useCallback(() => setFiltersOpen(false), [])
  const panel = useDismiss<HTMLDivElement>(filtersOpen, closeFilters)

  return (
    <div className="mtp-toolbar">
      <div className="mtp-toolbar__left">
        <div className="mtp-search">
          <span className="mtp-search__icon" aria-hidden="true"><Search size={16} /></span>
          <input
            type="search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Search by supplier, bill no., reference…"
            aria-label="Search the bills below"
          />
        </div>

        <div className="mtp-chips" role="group" aria-label="Quick filters">
          {[...CHIPS, ...(IMPLIED[query.status] ? [{ key: query.status, label: IMPLIED[query.status] }] : [])].map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="mtp-chip"
              aria-pressed={query.status === chip.key}
              onClick={() => patch({ status: chip.key })}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mtp-toolbar__right">
        <div style={{ position: 'relative' }} ref={panel}>
          <button
            type="button"
            className="billing-button billing-button--small"
            aria-expanded={filtersOpen}
            aria-haspopup="dialog"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <SlidersHorizontal size={15} aria-hidden /> Filters
            {advancedCount > 0 && <span className="mtp-count">{advancedCount}</span>}
          </button>

          {filtersOpen && (
            <AdvancedFilters
              query={query}
              suppliers={suppliers}
              categories={categories}
              onApply={(changes) => {
                patch(changes)
                setFiltersOpen(false)
              }}
              onClear={() => {
                clearAdvanced()
                setFiltersOpen(false)
              }}
              onCancel={closeFilters}
            />
          )}
        </div>

        {canExport && (
          <button type="button" className="billing-button billing-button--small" onClick={onExport} disabled={exporting}>
            {exporting ? <Loader2 size={15} className="spin" aria-hidden /> : <Download size={15} aria-hidden />}
            {exporting ? 'Building…' : 'Export'}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Everything that is not a chip.
 *
 * Company, branch and financial year are deliberately absent: they are chosen
 * once in the header and already scope every call this page makes. Repeating
 * them here would give the user two places to set the same thing and one of
 * them would be wrong.
 */
function AdvancedFilters({
  query,
  suppliers,
  categories,
  onApply,
  onClear,
  onCancel,
}: {
  query: PayablesQuery
  suppliers: DueParty[]
  categories: PayableCategories | null
  onApply: (changes: Partial<PayablesQuery>) => void
  onClear: () => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<Partial<PayablesQuery>>(() => {
    const initial: Partial<PayablesQuery> = {}
    for (const key of ADVANCED_KEYS) initial[key] = query[key]

    return initial
  })

  const set = (key: (typeof ADVANCED_KEYS)[number], value: string) => setDraft((current) => ({ ...current, [key]: value }))
  const filled = ADVANCED_KEYS.filter((key) => (draft[key] ?? '') !== '').length
  const categoryRows = (categories?.rows ?? []).filter((row) => !row.key.startsWith('__'))

  return (
    <div className="mtp-filters" role="dialog" aria-label="Advanced filters">
      <div className="mtp-filters__grid">
        <label className="billing-field">
          <span>Supplier</span>
          <select value={draft.supplier_id ?? ''} onChange={(event) => set('supplier_id', event.target.value)}>
            <option value="">Any supplier</option>
            {suppliers.map((supplier) => (
              <option key={supplier.account_id} value={supplier.account_id}>{supplier.account_name}</option>
            ))}
          </select>
        </label>

        <label className="billing-field">
          <span>Ageing bucket</span>
          <select value={draft.age_bucket ?? ''} onChange={(event) => set('age_bucket', event.target.value)}>
            <option value="">Any age</option>
            <option value="current">Not yet due</option>
            <option value="1_30">1–30 days overdue</option>
            <option value="31_60">31–60 days overdue</option>
            <option value="61_90">61–90 days overdue</option>
            <option value="90_plus">Over 90 days overdue</option>
            <option value="no_due_date">No due date</option>
          </select>
        </label>

        <label className="billing-field">
          <span>Bill date</span>
          <span className="mtp-filters__pair">
            <input type="date" value={draft.bill_date_from ?? ''} onChange={(event) => set('bill_date_from', event.target.value)} aria-label="Bill date from" />
            <span style={{ color: 'var(--billing-muted)' }}>to</span>
            <input type="date" value={draft.bill_date_to ?? ''} onChange={(event) => set('bill_date_to', event.target.value)} aria-label="Bill date to" />
          </span>
        </label>

        <label className="billing-field">
          <span>Due date</span>
          <span className="mtp-filters__pair">
            <input type="date" value={draft.due_date_from ?? ''} onChange={(event) => set('due_date_from', event.target.value)} aria-label="Due date from" />
            <span style={{ color: 'var(--billing-muted)' }}>to</span>
            <input type="date" value={draft.due_date_to ?? ''} onChange={(event) => set('due_date_to', event.target.value)} aria-label="Due date to" />
          </span>
        </label>

        <label className="billing-field">
          <span>Outstanding amount</span>
          <span className="mtp-filters__pair">
            <input
              type="number"
              inputMode="decimal"
              min="0"
              value={draft.amount_min ?? ''}
              onChange={(event) => set('amount_min', event.target.value)}
              placeholder="Min"
              aria-label="Minimum outstanding amount"
            />
            <span style={{ color: 'var(--billing-muted)' }}>to</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              value={draft.amount_max ?? ''}
              onChange={(event) => set('amount_max', event.target.value)}
              placeholder="Max"
              aria-label="Maximum outstanding amount"
            />
          </span>
        </label>

        <label className="billing-field">
          <span>Reference</span>
          <input
            type="text"
            value={draft.reference ?? ''}
            onChange={(event) => set('reference', event.target.value)}
            placeholder="PO number, order no."
          />
        </label>

        {categoryRows.length > 0 && (
          <label className="billing-field">
            <span>Category</span>
            <select value={draft.category ?? ''} onChange={(event) => set('category', event.target.value)}>
              <option value="">Any category</option>
              {categoryRows.map((row) => (
                <option key={row.key} value={row.key}>{row.label}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="mtp-filters__foot">
        <button type="button" className="billing-button billing-button--quiet billing-button--small" onClick={onClear}>
          <X size={14} aria-hidden /> Clear all
        </button>
        <span style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="billing-button billing-button--small" onClick={onCancel}>Cancel</button>
          <button type="button" className="billing-button billing-button--primary billing-button--small" onClick={() => onApply(draft)}>
            Apply{filled > 0 ? ` (${filled})` : ''}
          </button>
        </span>
      </div>
    </div>
  )
}
