/**
 * The Items screen's state, kept in the address bar.
 *
 * Every narrowing a user can apply — what they searched for, which tab, which
 * group, how it is sorted, which page — is a query parameter and nothing else.
 * That is what makes the back button work, what makes a filtered list something
 * you can send to somebody, and what makes a reload land where you were rather
 * than at the top of an unfiltered catalogue.
 *
 * The tabs are not a separate parameter. "Low Stock" IS `?stock_status=low`,
 * so the tab bar and the filter row can never disagree about what is on screen
 * — which they would the moment the same thing had two places to be recorded.
 *
 * One thing deliberately NOT here: the list/grid choice. That is a preference
 * about how one person likes to look at a screen, not a description of what
 * the screen is showing, and putting it in a shared link would hand somebody
 * else your habits along with your filter.
 */

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ItemType } from '../../services/types'

export type ItemStatusFilter = 'active' | 'inactive'
export type ItemStockFilter = 'in' | 'low' | 'out'
export type ItemSort = 'name' | 'sku' | 'hsn_sac' | 'rate' | 'stock' | 'status'
export type SortOrder = 'asc' | 'desc'
export type ItemsTabKey = 'all' | 'stock' | 'service' | 'low' | 'inactive'

export const SORTABLE: ItemSort[] = ['name', 'sku', 'hsn_sac', 'rate', 'stock', 'status']
export const PAGE_SIZES = [25, 50, 100] as const

export interface ItemsQuery {
  q: string
  type: ItemType | null
  status: ItemStatusFilter | null
  stockStatus: ItemStockFilter | null
  groupId: number | null
  sort: ItemSort | null
  order: SortOrder
  page: number
  perPage: number
}

/** What a change to the query says; anything left out is kept. */
export type ItemsQueryPatch = Partial<ItemsQuery>

export const TABS: Array<{ key: ItemsTabKey; label: string; patch: ItemsQueryPatch }> = [
  { key: 'all', label: 'All Items', patch: { type: null, status: null, stockStatus: null } },
  { key: 'stock', label: 'Stock Items', patch: { type: 'stock', status: null, stockStatus: null } },
  { key: 'service', label: 'Service Items', patch: { type: 'service', status: null, stockStatus: null } },
  { key: 'low', label: 'Low Stock', patch: { type: null, status: null, stockStatus: 'low' } },
  { key: 'inactive', label: 'Inactive', patch: { type: null, status: 'inactive', stockStatus: null } },
]

/**
 * Which tab is lit, worked out from the filters rather than stored.
 *
 * Read most-specific first: somebody who is looking at inactive items and has
 * also narrowed to stock is on the Inactive tab, because that is the narrower
 * of the two and the one they will expect to click out of.
 */
export function activeTab(query: ItemsQuery): ItemsTabKey {
  if (query.stockStatus === 'low') return 'low'
  if (query.status === 'inactive') return 'inactive'
  if (query.type === 'stock') return 'stock'
  if (query.type === 'service') return 'service'
  return 'all'
}

/** Filters beyond the tabs and the search box, for the "More filters" count. */
export function extraFilterCount(query: ItemsQuery): number {
  let count = 0
  if (query.groupId !== null) count += 1
  if (query.stockStatus !== null && query.stockStatus !== 'low') count += 1
  if (query.status === 'active') count += 1
  return count
}

export function hasAnyFilter(query: ItemsQuery): boolean {
  return (
    query.q !== '' ||
    query.type !== null ||
    query.status !== null ||
    query.stockStatus !== null ||
    query.groupId !== null
  )
}

function oneOf<T extends string>(raw: string | null, allowed: readonly T[]): T | null {
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : null
}

export function readQuery(params: URLSearchParams): ItemsQuery {
  const perPageRaw = Number.parseInt(params.get('size') ?? '', 10)
  const pageRaw = Number.parseInt(params.get('page') ?? '', 10)
  const groupRaw = Number.parseInt(params.get('group') ?? '', 10)

  return {
    q: (params.get('q') ?? '').slice(0, 120),
    type: oneOf<ItemType>(params.get('type'), ['stock', 'service']),
    status: oneOf<ItemStatusFilter>(params.get('status'), ['active', 'inactive']),
    stockStatus: oneOf<ItemStockFilter>(params.get('stock_status'), ['in', 'low', 'out']),
    groupId: Number.isFinite(groupRaw) && groupRaw > 0 ? groupRaw : null,
    sort: oneOf<ItemSort>(params.get('sort'), SORTABLE),
    order: params.get('order') === 'desc' ? 'desc' : 'asc',
    page: Number.isFinite(pageRaw) && pageRaw > 1 ? pageRaw : 1,
    perPage: (PAGE_SIZES as readonly number[]).includes(perPageRaw) ? perPageRaw : PAGE_SIZES[0],
  }
}

/**
 * The query as a URL, with defaults left out.
 *
 * Writing `?page=1&order=asc&size=25` on every click would make the address bar
 * unreadable and every link longer than the screen it describes.
 */
export function writeQuery(query: ItemsQuery): URLSearchParams {
  const params = new URLSearchParams()
  if (query.q !== '') params.set('q', query.q)
  if (query.type) params.set('type', query.type)
  if (query.status) params.set('status', query.status)
  if (query.stockStatus) params.set('stock_status', query.stockStatus)
  if (query.groupId !== null) params.set('group', String(query.groupId))
  if (query.sort) {
    params.set('sort', query.sort)
    if (query.order === 'desc') params.set('order', 'desc')
  }
  if (query.page > 1) params.set('page', String(query.page))
  if (query.perPage !== PAGE_SIZES[0]) params.set('size', String(query.perPage))

  return params
}

/**
 * Read the query, and change it.
 *
 * Any patch that narrows the list resets to page one. The alternative is
 * searching from page four of the previous list and being shown an empty
 * screen that looks like "nothing matched".
 */
export function useItemsQuery(): {
  query: ItemsQuery
  patch: (changes: ItemsQueryPatch) => void
  reset: () => void
} {
  const [params, setParams] = useSearchParams()

  const query = useMemo(() => readQuery(params), [params])

  const patch = useCallback(
    (changes: ItemsQueryPatch) => {
      setParams(
        (current) => {
          const next = { ...readQuery(current), ...changes }
          const narrowed = Object.keys(changes).some((key) => key !== 'page')
          if (narrowed && changes.page === undefined) next.page = 1

          return writeQuery(next)
        },
        // Replace rather than push: a back button that walks back through
        // every keystroke of a search is a back button nobody can use.
        { replace: true },
      )
    },
    [setParams],
  )

  const reset = useCallback(() => {
    setParams(
      (current) => writeQuery({ ...readQuery(current), q: '', type: null, status: null, stockStatus: null, groupId: null, page: 1 }),
      { replace: true },
    )
  }, [setParams])

  return { query, patch, reset }
}

/** The query as this product's API takes it. */
export function toApiParams(query: ItemsQuery): Record<string, string | number | undefined> {
  return {
    q: query.q || undefined,
    type: query.type ?? undefined,
    status: query.status ?? undefined,
    stock_status: query.stockStatus ?? undefined,
    group_id: query.groupId ?? undefined,
    sort: query.sort ?? undefined,
    order: query.sort ? query.order : undefined,
    limit: query.perPage,
    offset: (query.page - 1) * query.perPage,
  }
}
