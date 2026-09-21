/**
 * What the Money to Pay table is currently showing — held in the URL.
 *
 * The URL is the state, not a copy of it. A payables screen is something people
 * send each other ("look at the overdue ones for Northern") and come back to
 * after opening a bill, and a filter kept only in React is a filter that is
 * gone on both. SaleEditor already reads its party from the query string; this
 * is the same idea with more of it.
 *
 * Only what differs from the default is written, so a plain /payables stays a
 * plain /payables.
 */

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

export const PAGE_SIZES = [25, 50, 100] as const
export const DEFAULT_PAGE_SIZE = 25

export interface PayablesQuery {
  status: string
  search: string
  supplier_id: string
  category: string
  age_bucket: string
  reference: string
  bill_date_from: string
  bill_date_to: string
  due_date_from: string
  due_date_to: string
  amount_min: string
  amount_max: string
  sort_by: string
  sort_dir: 'asc' | 'desc'
  page: number
  page_size: number
}

/**
 * The filters that live behind the Filters button, as opposed to the chips and
 * the search box which are always on screen. The count on the button is the
 * number of these that are set — a badge that also counted the visible ones
 * would tell the user something they can already see.
 */
export const ADVANCED_KEYS = [
  'supplier_id',
  'category',
  'age_bucket',
  'reference',
  'bill_date_from',
  'bill_date_to',
  'due_date_from',
  'due_date_to',
  'amount_min',
  'amount_max',
] as const

export type AdvancedKey = (typeof ADVANCED_KEYS)[number]

export const EMPTY_QUERY: PayablesQuery = {
  status: 'all',
  search: '',
  supplier_id: '',
  category: '',
  age_bucket: '',
  reference: '',
  bill_date_from: '',
  bill_date_to: '',
  due_date_from: '',
  due_date_to: '',
  amount_min: '',
  amount_max: '',
  sort_by: 'due_date',
  sort_dir: 'asc',
  page: 1,
  page_size: DEFAULT_PAGE_SIZE,
}

export interface PayablesQueryState {
  query: PayablesQuery
  /** Change some of it. Anything but the page number sends you back to page one. */
  patch: (changes: Partial<PayablesQuery>) => void
  /** Back to every bill, unsorted by anything but the due date. */
  reset: () => void
  /** Just the advanced filters, left as they were otherwise. */
  clearAdvanced: () => void
  advancedCount: number
  isFiltered: boolean
}

export function usePayablesQuery(): PayablesQueryState {
  const [params, setParams] = useSearchParams()

  const query = useMemo<PayablesQuery>(() => {
    const read = (key: keyof PayablesQuery) => params.get(key) ?? ''
    const size = Number(params.get('page_size') ?? DEFAULT_PAGE_SIZE)

    return {
      ...EMPTY_QUERY,
      status: read('status') || 'all',
      search: read('search'),
      supplier_id: read('supplier_id'),
      category: read('category'),
      age_bucket: read('age_bucket'),
      reference: read('reference'),
      bill_date_from: read('bill_date_from'),
      bill_date_to: read('bill_date_to'),
      due_date_from: read('due_date_from'),
      due_date_to: read('due_date_to'),
      amount_min: read('amount_min'),
      amount_max: read('amount_max'),
      sort_by: read('sort_by') || EMPTY_QUERY.sort_by,
      sort_dir: read('sort_dir') === 'desc' ? 'desc' : 'asc',
      page: Math.max(1, Number(params.get('page') ?? 1) || 1),
      page_size: (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE,
    }
  }, [params])

  const write = useCallback(
    (next: PayablesQuery) => {
      const out = new URLSearchParams()
      for (const [key, value] of Object.entries(next)) {
        const fallback = EMPTY_QUERY[key as keyof PayablesQuery]
        if (value === '' || value === null || value === undefined || value === fallback) continue
        out.set(key, String(value))
      }
      // replace, so paging through a list does not fill the back button with
      // twelve versions of the same screen.
      setParams(out, { replace: true })
    },
    [setParams],
  )

  const patch = useCallback(
    (changes: Partial<PayablesQuery>) => {
      const onlyPaging = Object.keys(changes).every((key) => key === 'page')
      write({ ...query, ...changes, page: onlyPaging ? (changes.page ?? query.page) : 1 })
    },
    [query, write],
  )

  const reset = useCallback(() => write({ ...EMPTY_QUERY, page_size: query.page_size }), [query.page_size, write])

  const clearAdvanced = useCallback(() => {
    const cleared: Partial<PayablesQuery> = {}
    for (const key of ADVANCED_KEYS) cleared[key] = ''
    patch(cleared)
  }, [patch])

  const advancedCount = ADVANCED_KEYS.filter((key) => query[key] !== '').length

  return {
    query,
    patch,
    reset,
    clearAdvanced,
    advancedCount,
    isFiltered: advancedCount > 0 || query.search !== '' || query.status !== 'all',
  }
}

/** The query as the API takes it. Empty values are dropped by the api layer. */
export function toApiParams(query: PayablesQuery): Record<string, string | number | undefined> {
  return {
    search: query.search || undefined,
    status: query.status === 'all' ? undefined : query.status,
    supplier_id: query.supplier_id || undefined,
    category: query.category || undefined,
    age_bucket: query.age_bucket || undefined,
    reference: query.reference || undefined,
    bill_date_from: query.bill_date_from || undefined,
    bill_date_to: query.bill_date_to || undefined,
    due_date_from: query.due_date_from || undefined,
    due_date_to: query.due_date_to || undefined,
    amount_min: query.amount_min || undefined,
    amount_max: query.amount_max || undefined,
    sort_by: query.sort_by,
    sort_dir: query.sort_dir,
    page: query.page,
    page_size: query.page_size,
  }
}
