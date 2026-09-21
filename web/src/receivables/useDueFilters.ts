/**
 * The filter state, kept in the address bar.
 *
 * Every narrowing of this screen is a query parameter, which buys three things
 * that a `useState` would not: the back button undoes a filter, a link to
 * "everything over ninety days for this customer" can be pasted into a message,
 * and a refresh lands on the same list rather than at the top of the ledger.
 *
 * Nothing here is trusted. The parameters are read defensively and anything
 * unrecognised falls back to the default — a hand-typed `?status=nonsense` must
 * show the whole list, not an empty one. The company, branch and financial year
 * are NOT here: they belong to the header and to the API's own scoping, and a
 * screen that let you type a cmp_id into the URL would be a screen that decides
 * tenancy in the browser.
 */

import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AGEING_BUCKETS,
  DEFAULT_FILTERS,
  PAGE_SIZES,
  type AgeingKey,
  type DueFilters,
  type SortDirection,
  type SortKey,
  type StatusFilter,
} from './model'

const STATUSES: StatusFilter[] = ['all', 'not_yet_due', 'due_today', 'due_soon', 'overdue', 'no_due_date', 'part_paid']
const SORTS: SortKey[] = ['due_date', 'days_overdue', 'balance', 'account_name', 'bill_date']

/** Which query parameter carries which filter. Short, because they end up shared. */
const PARAM = {
  q: 'q',
  account: 'party',
  status: 'status',
  ageing: 'age',
  dueFrom: 'from',
  dueTo: 'to',
  minAmount: 'min',
  maxAmount: 'max',
  minDaysOverdue: 'late',
  sort: 'sort',
  dir: 'dir',
  page: 'page',
  size: 'size',
} as const

function readNumber(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function readDate(raw: string | null): string | null {
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null
}

function readFilters(params: URLSearchParams): DueFilters {
  const status = params.get(PARAM.status) as StatusFilter | null
  const ageing = params.get(PARAM.ageing) as AgeingKey | null
  const sort = params.get(PARAM.sort) as SortKey | null
  const dir = params.get(PARAM.dir)
  const size = readNumber(params.get(PARAM.size))
  const page = readNumber(params.get(PARAM.page))

  return {
    q: params.get(PARAM.q) ?? DEFAULT_FILTERS.q,
    account: readNumber(params.get(PARAM.account)),
    status: status && STATUSES.includes(status) ? status : DEFAULT_FILTERS.status,
    ageing: ageing && AGEING_BUCKETS.some((bucket) => bucket.key === ageing) ? ageing : DEFAULT_FILTERS.ageing,
    dueFrom: readDate(params.get(PARAM.dueFrom)),
    dueTo: readDate(params.get(PARAM.dueTo)),
    minAmount: readNumber(params.get(PARAM.minAmount)),
    maxAmount: readNumber(params.get(PARAM.maxAmount)),
    minDaysOverdue: readNumber(params.get(PARAM.minDaysOverdue)),
    sort: sort && SORTS.includes(sort) ? sort : DEFAULT_FILTERS.sort,
    dir: dir === 'asc' || dir === 'desc' ? (dir as SortDirection) : DEFAULT_FILTERS.dir,
    page: page !== null && page >= 1 ? Math.trunc(page) : DEFAULT_FILTERS.page,
    size: size !== null && PAGE_SIZES.includes(size as (typeof PAGE_SIZES)[number]) ? size : DEFAULT_FILTERS.size,
  }
}

/** Only what differs from the default is written, so a clean view has a clean URL. */
function writeFilters(filters: DueFilters, existing: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(existing)

  const set = (key: string, value: string | number | null, fallback: string | number | null) => {
    if (value === null || value === '' || value === fallback) next.delete(key)
    else next.set(key, String(value))
  }

  set(PARAM.q, filters.q.trim(), '')
  set(PARAM.account, filters.account, null)
  set(PARAM.status, filters.status, DEFAULT_FILTERS.status)
  set(PARAM.ageing, filters.ageing, DEFAULT_FILTERS.ageing)
  set(PARAM.dueFrom, filters.dueFrom, null)
  set(PARAM.dueTo, filters.dueTo, null)
  set(PARAM.minAmount, filters.minAmount, null)
  set(PARAM.maxAmount, filters.maxAmount, null)
  set(PARAM.minDaysOverdue, filters.minDaysOverdue, null)
  set(PARAM.sort, filters.sort, DEFAULT_FILTERS.sort)
  set(PARAM.dir, filters.dir, DEFAULT_FILTERS.dir)
  set(PARAM.page, filters.page, DEFAULT_FILTERS.page)
  set(PARAM.size, filters.size, DEFAULT_FILTERS.size)

  return next
}

/** Anything that changes WHICH rows are shown. Changing one of these resets the page. */
const NARROWING: Array<keyof DueFilters> = [
  'q',
  'account',
  'status',
  'ageing',
  'dueFrom',
  'dueTo',
  'minAmount',
  'maxAmount',
  'minDaysOverdue',
]

export interface DueFilterState {
  filters: DueFilters
  /** Merge a change in. Page 1 is restored whenever the set of rows changes. */
  update: (patch: Partial<DueFilters>) => void
  clear: () => void
  /** The current filters as a query string, for a saved view or a shared link. */
  query: string
}

export function useDueFilters(): DueFilterState {
  const [params, setParams] = useSearchParams()

  const filters = useMemo(() => readFilters(params), [params])

  const update = useCallback(
    (patch: Partial<DueFilters>) => {
      setParams(
        (current) => {
          const base = readFilters(current)
          const narrowed = NARROWING.some((key) => key in patch && patch[key] !== base[key])
          const next: DueFilters = { ...base, ...patch }
          if (narrowed && !('page' in patch)) next.page = 1

          return writeFilters(next, current)
        },
        // A pushed entry, so the back button undoes the filter the user just
        // applied. Paging is the exception — twelve pages of history between
        // this screen and the one before it is not a useful back button.
        { replace: 'page' in patch && Object.keys(patch).length === 1 },
      )
    },
    [setParams],
  )

  const clear = useCallback(() => {
    setParams((current) => writeFilters({ ...DEFAULT_FILTERS }, new URLSearchParams(current.has('view') ? { view: current.get('view') as string } : {})))
  }, [setParams])

  return { filters, update, clear, query: writeFilters(filters, new URLSearchParams()).toString() }
}
