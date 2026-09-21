/**
 * The tab bar and the filter row.
 *
 * Every control here writes to the address bar and nothing else — there is no
 * second copy of "what is on screen" for the two rows to disagree about. The
 * tabs ARE filters: "Low Stock" is `?stock_status=low`, so arriving on that URL
 * and clicking that tab land in exactly the same place.
 *
 * The search box is the one piece of local state, because a field that only
 * updates when the network answers is a field that eats characters. It types
 * immediately, settles after a moment, and only then changes the query.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { Filter, LayoutGrid, List, Search, SlidersHorizontal, X } from 'lucide-react'
import type { ItemGroup, ItemType } from '../../services/types'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import {
  activeTab,
  extraFilterCount,
  TABS,
  type ItemsQuery,
  type ItemsQueryPatch,
  type ItemStatusFilter,
  type ItemStockFilter,
} from './itemsQuery'

export type ItemsView = 'list' | 'grid'

export function ItemsTabs({
  query,
  onPatch,
  groupsAction,
}: {
  query: ItemsQuery
  onPatch: (patch: ItemsQueryPatch) => void
  groupsAction: React.ReactNode
}) {
  const current = activeTab(query)

  return (
    <div className="billing-items-tabs">
      <nav className="billing-items-tabs__list" aria-label="Which items">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className="billing-items-tab"
            aria-current={tab.key === current ? 'page' : undefined}
            onClick={() => onPatch(tab.patch)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      {groupsAction && <div className="billing-items-tabs__aside">{groupsAction}</div>}
    </div>
  )
}

export function ItemsToolbar({
  query,
  onPatch,
  groups,
  groupsLoading,
  view,
  onView,
}: {
  query: ItemsQuery
  onPatch: (patch: ItemsQueryPatch) => void
  groups: ItemGroup[]
  groupsLoading: boolean
  view: ItemsView
  onView: (view: ItemsView) => void
}) {
  const searchId = useId()
  const [typed, setTyped] = useState(query.q)
  const settled = useDebouncedValue(typed, 350)

  // The URL is the source of truth: the back button, a KPI card and "clear
  // filters" all change it without touching this field, and it has to follow.
  const lastApplied = useRef(query.q)
  useEffect(() => {
    if (query.q !== lastApplied.current) {
      lastApplied.current = query.q
      setTyped(query.q)
    }
  }, [query.q])

  useEffect(() => {
    if (settled === lastApplied.current) return
    lastApplied.current = settled
    onPatch({ q: settled })
    // onPatch is stable for the life of the screen; adding it here would re-run
    // the search every time the query object is replaced, which is every search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled])

  const extras = extraFilterCount(query)

  return (
    <div className="billing-items-toolbar">
      <div className="billing-items-search">
        <Search size={16} className="billing-items-search__icon" aria-hidden />
        <label className="billing-sr-only" htmlFor={searchId}>
          Search items
        </label>
        <input
          id={searchId}
          type="search"
          className="billing-items-search__input"
          placeholder="Search by item name, SKU, HSN/SAC, barcode…"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            // Enter does not wait out the rest of the delay.
            if (event.key === 'Enter') {
              event.preventDefault()
              lastApplied.current = typed
              onPatch({ q: typed })
            }
          }}
        />
        {typed !== '' && (
          <button
            type="button"
            className="billing-items-search__clear"
            aria-label="Clear the search"
            onClick={() => {
              setTyped('')
              lastApplied.current = ''
              onPatch({ q: '' })
            }}
          >
            <X size={15} aria-hidden />
          </button>
        )}
      </div>

      <label className="billing-sr-only" htmlFor="items-group-filter">Item group</label>
      <select
        id="items-group-filter"
        className="billing-items-select"
        value={query.groupId === null ? '' : String(query.groupId)}
        disabled={groupsLoading || groups.length === 0}
        onChange={(event) => onPatch({ groupId: event.target.value === '' ? null : Number(event.target.value) })}
      >
        <option value="">{groupsLoading ? 'Loading groups…' : groups.length === 0 ? 'No groups' : 'All groups'}</option>
        {groups.map((group) => (
          <option key={group.group_id} value={group.group_id}>
            {group.group_name}
          </option>
        ))}
      </select>

      <label className="billing-sr-only" htmlFor="items-type-filter">Item type</label>
      <select
        id="items-type-filter"
        className="billing-items-select"
        value={query.type ?? ''}
        onChange={(event) => onPatch({ type: (event.target.value || null) as ItemType | null })}
      >
        <option value="">All types</option>
        <option value="stock">Stock</option>
        <option value="service">Service</option>
      </select>

      <label className="billing-sr-only" htmlFor="items-status-filter">Status</label>
      <select
        id="items-status-filter"
        className="billing-items-select"
        value={query.status ?? ''}
        onChange={(event) => onPatch({ status: (event.target.value || null) as ItemStatusFilter | null })}
      >
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>

      <MoreFilters query={query} onPatch={onPatch} count={extras} />

      <span className="billing-items-toolbar__spacer" />

      <div className="billing-items-view" role="group" aria-label="How to show the items">
        <span aria-hidden="true">View</span>
        <button
          type="button"
          className="billing-items-view__btn"
          aria-pressed={view === 'list'}
          aria-label="List view"
          title="List view"
          onClick={() => onView('list')}
        >
          <List size={17} aria-hidden />
        </button>
        <button
          type="button"
          className="billing-items-view__btn"
          aria-pressed={view === 'grid'}
          aria-label="Grid view"
          title="Grid view"
          onClick={() => onView('grid')}
        >
          <LayoutGrid size={17} aria-hidden />
        </button>
      </div>
    </div>
  )
}

/**
 * The filters that do not earn a permanent place in the row.
 *
 * Only what the API actually takes. An availability filter that the endpoint
 * cannot apply would be a control that does nothing, which is worse than one
 * that is not offered.
 */
function MoreFilters({
  query,
  onPatch,
  count: activeCount,
}: {
  query: ItemsQuery
  onPatch: (patch: ItemsQueryPatch) => void
  count: number
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return undefined

    function onPointerDown(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="billing-items-filterbtn" ref={box}>
      <button
        type="button"
        ref={trigger}
        className="billing-button billing-button--small"
        style={{ minHeight: 42 }}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal size={15} aria-hidden /> More filters
        {activeCount > 0 && <span className="billing-items-filterbtn__count">{activeCount}</span>}
      </button>

      {open && (
        <div className="billing-items-popover" role="dialog" aria-label="More filters">
          <h3>
            <Filter size={14} aria-hidden style={{ verticalAlign: '-2px', marginRight: 6 }} />
            Narrow the list
          </h3>

          <div className="billing-field">
            <label htmlFor="items-stock-filter">Stock availability</label>
            <select
              id="items-stock-filter"
              value={query.stockStatus ?? ''}
              onChange={(event) => onPatch({ stockStatus: (event.target.value || null) as ItemStockFilter | null })}
            >
              <option value="">Any</option>
              <option value="in">In stock</option>
              <option value="low">Running low</option>
              <option value="out">Out of stock</option>
            </select>
            <span className="billing-field__hint">
              Availability is Aicountly Inventory&rsquo;s own, read as this page draws.
            </span>
          </div>

          <div className="billing-items-popover__foot">
            <button
              type="button"
              className="billing-button billing-button--small"
              onClick={() => onPatch({ stockStatus: null, groupId: null, type: null, status: null })}
            >
              Clear these
            </button>
            <button
              type="button"
              className="billing-button billing-button--small billing-button--soft"
              onClick={() => {
                setOpen(false)
                trigger.current?.focus()
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
