/**
 * Search and filters.
 *
 * Every control here maps to a parameter the API forwards to Inventory. There
 * is deliberately no "price between" and no "modified after": those would be
 * filters this screen applies to one page of results, which is a filter that
 * lies on page two. When Inventory offers them, they belong here; until then
 * they do not.
 *
 * The search box is debounced by the page, not by this component, because the
 * page is what turns a settled term into a request.
 */

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Filter, LayoutGrid, List, Search, X } from 'lucide-react'
import { Popover } from '../../components/Popover'
import type { ItemGroup } from '../../services/types'
import type { ItemsQuery } from './useItemsQuery'
import { extraFilterCount } from './useItemsQuery'

export interface WarehouseOption {
  id: number
  name: string
}

export function groupId(group: ItemGroup): number | null {
  const value = group.item_group_id ?? group.group_id ?? group.id
  return typeof value === 'number' && value > 0 ? value : null
}

export function groupName(group: ItemGroup): string {
  return group.item_group_name ?? group.group_name ?? group.name ?? 'Unnamed group'
}

export function ItemsToolbar({
  query,
  term,
  onTerm,
  onPatch,
  onClear,
  groups,
  groupsLoading,
  warehouses,
  view,
  onView,
  anyFilter,
}: {
  query: ItemsQuery
  term: string
  onTerm: (term: string) => void
  onPatch: (next: Partial<ItemsQuery>) => void
  onClear: () => void
  groups: ItemGroup[]
  groupsLoading: boolean
  warehouses: WarehouseOption[]
  view: 'list' | 'grid'
  onView: (view: 'list' | 'grid') => void
  anyFilter: boolean
}) {
  const extras = extraFilterCount(query)
  const input = useRef<HTMLInputElement | null>(null)

  return (
    <div className="items-toolbar">
      <form
        className="items-search"
        role="search"
        onSubmit={(event) => {
          // Enter searches now rather than waiting out the debounce — at a
          // counter that pause is the difference between fast and sluggish.
          event.preventDefault()
          onPatch({ q: term.trim() })
        }}
      >
        <Search size={15} className="items-search__icon" aria-hidden />
        <label className="billing-sr-only" htmlFor="items-search">
          Search items
        </label>
        <input
          id="items-search"
          ref={input}
          type="search"
          className="items-search__input"
          placeholder="Search by item name, SKU, HSN/SAC, barcode…"
          value={term}
          onChange={(event) => onTerm(event.target.value)}
        />
        {term !== '' && (
          <button
            type="button"
            className="items-search__clear"
            aria-label="Clear the search"
            title="Clear the search"
            onClick={() => {
              onTerm('')
              onPatch({ q: '' })
              input.current?.focus()
            }}
          >
            <X size={14} aria-hidden />
          </button>
        )}
      </form>

      <label className="billing-sr-only" htmlFor="items-group">
        Item group
      </label>
      <select
        id="items-group"
        className="items-select"
        value={query.groupId ?? ''}
        disabled={groupsLoading && groups.length === 0}
        onChange={(event) => onPatch({ groupId: event.target.value === '' ? null : Number(event.target.value) })}
      >
        <option value="">{groupsLoading && groups.length === 0 ? 'Loading groups…' : 'All groups'}</option>
        {groups.map((group) => {
          const id = groupId(group)
          return id === null ? null : (
            <option key={id} value={id}>
              {groupName(group)}
            </option>
          )
        })}
      </select>

      <label className="billing-sr-only" htmlFor="items-type">
        Item type
      </label>
      <select
        id="items-type"
        className="items-select"
        value={query.type}
        onChange={(event) => onPatch({ type: event.target.value as ItemsQuery['type'] })}
      >
        <option value="">All types</option>
        <option value="stock">Stock</option>
        <option value="service">Service</option>
      </select>

      <label className="billing-sr-only" htmlFor="items-status">
        Item status
      </label>
      <select
        id="items-status"
        className="items-select"
        value={query.status}
        onChange={(event) => onPatch({ status: event.target.value as ItemsQuery['status'] })}
      >
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </select>

      <Popover
        ariaLabel={extras > 0 ? `More filters, ${extras} applied` : 'More filters'}
        triggerClassName="billing-button billing-button--small items-morefilters"
        panelClassName="items-filterpanel"
        label={
          <>
            <Filter size={14} aria-hidden /> More filters
            {extras > 0 && <span className="items-morefilters__count">{extras}</span>}
            <ChevronDown size={14} aria-hidden style={{ color: 'var(--billing-muted)' }} />
          </>
        }
      >
        {() => (
          <>
            <div className="billing-menu__heading">
              <strong>More filters</strong>
              <div style={{ color: 'var(--billing-muted)', fontSize: 12 }}>
                Applied by Aicountly Inventory, not by this screen.
              </div>
            </div>

            <div className="items-filterfield">
              <label htmlFor="items-warehouse">Warehouse</label>
              <select
                id="items-warehouse"
                className="items-select items-select--block"
                value={query.warehouseId ?? ''}
                onChange={(event) =>
                  onPatch({ warehouseId: event.target.value === '' ? null : Number(event.target.value) })
                }
              >
                <option value="">Every warehouse</option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
              {warehouses.length === 0 && (
                <span className="items-filterfield__hint">Inventory listed no warehouses for this company.</span>
              )}
            </div>

            <div className="items-filterfield">
              <label htmlFor="items-availability">Stock availability</label>
              <select
                id="items-availability"
                className="items-select items-select--block"
                value={query.stockStatus}
                onChange={(event) => onPatch({ stockStatus: event.target.value as ItemsQuery['stockStatus'] })}
              >
                <option value="">Any</option>
                <option value="low">At or below the reorder level</option>
                <option value="out">Out of stock</option>
              </select>
            </div>
          </>
        )}
      </Popover>

      {anyFilter && (
        <button type="button" className="billing-button billing-button--quiet billing-button--small" onClick={onClear}>
          Clear all
        </button>
      )}

      <span className="items-toolbar__spacer" />

      <div className="items-view" role="group" aria-label="How to show the items">
        <span className="items-view__label">View</span>
        <button
          type="button"
          className="items-view__button"
          aria-pressed={view === 'list'}
          aria-label="List view"
          title="List view"
          onClick={() => onView('list')}
        >
          <List size={16} aria-hidden />
        </button>
        <button
          type="button"
          className="items-view__button"
          aria-pressed={view === 'grid'}
          aria-label="Grid view"
          title="Grid view"
          onClick={() => onView('grid')}
        >
          <LayoutGrid size={16} aria-hidden />
        </button>
      </div>
    </div>
  )
}

/**
 * How the list view is remembered.
 *
 * There is no per-user preference store in this product, and adding a table to
 * hold "this person likes the grid" would be a schema for a checkbox. Local
 * storage is the right size for it, and a browser that refuses storage simply
 * opens on the list every time.
 */
const VIEW_KEY = 'billing:items:view'

export function useItemsView(): ['list' | 'grid', (view: 'list' | 'grid') => void] {
  const [view, setView] = useState<'list' | 'grid'>(() => {
    try {
      return window.localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'
    } catch {
      return 'list'
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_KEY, view)
    } catch {
      /* private window, or storage the browser refuses. The choice still holds for this visit. */
    }
  }, [view])

  return [view, setView]
}
