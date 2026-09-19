/**
 * The Items workspace state, kept in the address bar.
 *
 * Every filter, the sort, the page and the tab live in the query string rather
 * than in component state. Three things follow from that and all three are the
 * point: a reload returns to the same view, Back undoes a filter instead of
 * leaving the screen, and a link to "the low-stock items in Stationery" is
 * something one person can send another.
 *
 *   /items?type=stock&group_id=4&sort=rate&order=desc&page=2
 *
 * Changing anything but the page returns to page one. Staying on page 7 of a
 * list that now has two pages is how a filter looks broken.
 */

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ItemStatus, ItemType } from '../../services/types'

export const ITEM_SORTS = ['name', 'sku', 'hsn_sac', 'rate', 'stock', 'status'] as const
export type ItemSort = (typeof ITEM_SORTS)[number]

export const PAGE_SIZES = [25, 50, 100] as const
const DEFAULT_PAGE_SIZE = 25

export type ItemTab = 'all' | 'stock' | 'service' | 'low' | 'inactive'

export interface ItemsQuery {
  q: string
  type: ItemType | ''
  status: ItemStatus | ''
  stockStatus: 'low' | 'out' | ''
  groupId: number | null
  warehouseId: number | null
  sort: ItemSort | ''
  order: 'asc' | 'desc'
  page: number
  perPage: number
}

/** The filters beyond the tabs and the search box, for the "More filters" count. */
export function extraFilterCount(query: ItemsQuery): number {
  let count = 0
  if (query.warehouseId !== null) count += 1
  if (query.stockStatus === 'out') count += 1
  return count
}

export function hasAnyFilter(query: ItemsQuery): boolean {
  return (
    query.q !== '' ||
    query.type !== '' ||
    query.status !== '' ||
    query.stockStatus !== '' ||
    query.groupId !== null ||
    query.warehouseId !== null
  )
}

/**
 * Which tab is lit.
 *
 * The tabs are shortcuts for filter combinations, not a sixth filter, so the
 * highlight is read back out of the filters. "Low stock" and "Inactive" win
 * over a type, because those are what the person chose most recently when both
 * are set — and a stock filter applied on top of the Stock tab keeps that tab
 * lit rather than jumping the highlight somewhere the user did not click.
 */
export function activeTab(query: ItemsQuery): ItemTab {
  if (query.stockStatus === 'low') return 'low'
  if (query.status === 'inactive' && query.type === '') return 'inactive'
  if (query.type === 'stock') return 'stock'
  if (query.type === 'service') return 'service'
  return 'all'
}

/** What a tab sets. Everything a tab does not own is cleared, so tabs are not sticky. */
export function tabFilters(tab: ItemTab): Pick<ItemsQuery, 'type' | 'status' | 'stockStatus'> {
  switch (tab) {
    case 'stock':
      return { type: 'stock', status: '', stockStatus: '' }
    case 'service':
      return { type: 'service', status: '', stockStatus: '' }
    case 'low':
      return { type: '', status: '', stockStatus: 'low' }
    case 'inactive':
      return { type: '', status: 'inactive', stockStatus: '' }
    default:
      return { type: '', status: '', stockStatus: '' }
  }
}

function oneOf<T extends string>(raw: string | null, allowed: readonly T[]): T | '' {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : ''
}

function positive(raw: string | null): number | null {
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : null
}

export interface ItemsQueryState {
  query: ItemsQuery
  /** Merge a change in. Resets to page one unless the change is the page itself. */
  patch: (next: Partial<ItemsQuery>) => void
  setTab: (tab: ItemTab) => void
  /** Toggles direction on the column already sorted, otherwise sorts it ascending. */
  toggleSort: (column: ItemSort) => void
  clearFilters: () => void
}

export function useItemsQuery(): ItemsQueryState {
  const [params, setParams] = useSearchParams()

  const query = useMemo<ItemsQuery>(() => {
    const sort = oneOf(params.get('sort'), ITEM_SORTS)
    const perPage = Number(params.get('per_page'))
    const page = Number(params.get('page'))

    return {
      q: params.get('q') ?? '',
      type: oneOf<ItemType>(params.get('type'), ['stock', 'service']),
      status: oneOf<ItemStatus>(params.get('status'), ['active', 'inactive']),
      stockStatus: oneOf<'low' | 'out'>(params.get('stock_status'), ['low', 'out']),
      groupId: positive(params.get('group_id')),
      warehouseId: positive(params.get('warehouse_id')),
      sort,
      order: params.get('order') === 'desc' ? 'desc' : 'asc',
      page: Number.isInteger(page) && page > 0 ? page : 1,
      perPage: (PAGE_SIZES as readonly number[]).includes(perPage) ? perPage : DEFAULT_PAGE_SIZE,
    }
  }, [params])

  const patch = useCallback(
    (next: Partial<ItemsQuery>) => {
      const merged: ItemsQuery = { ...query, ...next, page: next.page ?? (Object.keys(next).length > 0 ? 1 : query.page) }
      const search = new URLSearchParams()

      if (merged.q) search.set('q', merged.q)
      if (merged.type) search.set('type', merged.type)
      if (merged.status) search.set('status', merged.status)
      if (merged.stockStatus) search.set('stock_status', merged.stockStatus)
      if (merged.groupId !== null) search.set('group_id', String(merged.groupId))
      if (merged.warehouseId !== null) search.set('warehouse_id', String(merged.warehouseId))
      if (merged.sort) {
        search.set('sort', merged.sort)
        search.set('order', merged.order)
      }
      if (merged.page > 1) search.set('page', String(merged.page))
      if (merged.perPage !== DEFAULT_PAGE_SIZE) search.set('per_page', String(merged.perPage))

      // Typing in the search box must not write one history entry per pause —
      // Back would then walk the word back a letter at a time.
      setParams(search, { replace: true })
    },
    [query, setParams],
  )

  const setTab = useCallback((tab: ItemTab) => patch(tabFilters(tab)), [patch])

  const toggleSort = useCallback(
    (column: ItemSort) =>
      patch(
        query.sort === column
          ? { order: query.order === 'asc' ? 'desc' : 'asc' }
          : { sort: column, order: 'asc' },
      ),
    [patch, query.order, query.sort],
  )

  const clearFilters = useCallback(
    () => patch({ q: '', type: '', status: '', stockStatus: '', groupId: null, warehouseId: null }),
    [patch],
  )

  return { query, patch, setTab, toggleSort, clearFilters }
}
