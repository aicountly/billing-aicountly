/**
 * The party directory, as the screen sees it.
 *
 * Smart Books owns the party. This module describes what Billing's own
 * `v1/parties` endpoints return — which is Books' answer, composed on the
 * request that drew it — and turns the screen's filter state into a query
 * string. Nothing here caches a party beyond the life of the response.
 *
 * Two shapes recur and both matter:
 *
 *   value === null   the field was not readable, and the cell draws "—"
 *   value === 0      Books said nought, and the cell draws ₹ 0.00
 *
 * They are never collapsed into one. A customer who owes nothing and a balance
 * nobody could read look identical once that distinction is lost, and only one
 * of them is safe to act on.
 */

import { api, type ListMeta, type QueryParams } from './api'

export type PartySide = 'customer' | 'supplier'
export type PartyTab = 'all' | 'customer' | 'supplier' | 'inactive'
export type PartyStatus = 'active' | 'inactive'

/** A party as Books describes it, with its live balance beside it. Rendered, never stored. */
export interface Party {
  account_id: number
  name: string
  type: PartySide
  gstin: string | null
  pan: string | null
  phone: string | null
  email: string | null
  city: string | null
  state: string | null
  group: string | null
  credit_limit: number | null
  credit_days: number | null
  status: PartyStatus | null
  last_transaction_at: string | null
  updated_at: string | null
  outstanding: number | null
  overdue: number | null
  bill_count: number | null
  oldest_overdue_days: number | null
  over_credit_limit?: boolean
}

export interface PartyListMeta extends ListMeta {
  /** False when `total` is the number of rows read rather than the size of the list. */
  total_known: boolean
  complete: boolean
  sides: PartySide[]
  source: string
  note: string
}

export interface PartyListResponse {
  data: Party[]
  meta: PartyListMeta
}

export interface PartyInsight {
  kind: string
  tone: 'info' | 'warning' | 'danger'
  message: string
}

/**
 * The figures above the list.
 *
 * Every count is nullable on purpose: the server returns null for anything it
 * could not establish from a complete reading, and the cards draw that as
 * "Not available" rather than as a number nobody can stand behind.
 */
export interface PartyOverview {
  total_parties: number | null
  customers: number | null
  suppliers: number | null
  active_parties: number | null
  inactive_parties: number | null
  status_known: number
  active_percentage: number | null
  credit_limit_exposure: number | null
  parties_over_limit: number | null
  gst_registered: number | null
  without_activity_90d: number | null
  overdue_receivables: number | null
  total_receivable: number | null
  total_payable: number | null
  overdue_payables: number | null
  duplicate_groups: number | null
  complete: boolean
  facets: { states: string[]; groups: string[]; cities: string[] }
  insights: PartyInsight[]
  may_see_customers: boolean
  may_see_suppliers: boolean
  source: string
  note: string
}

export interface DuplicateMember {
  account_id: number
  name: string
  type: PartySide
  gstin: string | null
  phone: string | null
  email: string | null
  state: string | null
  outstanding: number | null
}

export interface DuplicateGroup {
  key: string
  reason: string
  field: 'gstin' | 'phone' | 'email' | 'name'
  members: DuplicateMember[]
}

export interface DuplicateResponse {
  groups: DuplicateGroup[]
  complete: boolean
  note: string
}

// ---------------------------------------------------------------------------
// The filter state, and the query string it becomes
// ---------------------------------------------------------------------------

export type BalanceFilter = 'any' | 'outstanding' | 'settled' | 'overdue'
export type CreditFilter = 'any' | 'within' | 'over' | 'none'
export type GstFilter = 'any' | 'registered' | 'unregistered'
export type ActivityFilter = 'any' | 'last_7' | 'last_30' | 'last_90' | 'none'
export type PartySort = 'name' | 'outstanding' | 'overdue' | 'credit_limit' | 'last_transaction' | 'updated_at' | 'state'

export interface PartyQuery {
  /** Which half of the directory. Independent of status, so "inactive suppliers" is expressible. */
  side: 'all' | PartySide
  search: string
  status: 'all' | PartyStatus
  state: string
  group: string
  city: string
  balance: BalanceFilter
  credit: CreditFilter
  gst: GstFilter
  activity: ActivityFilter
  sort: PartySort
  order: 'asc' | 'desc'
  page: number
  pageSize: number
}

export const PARTY_PAGE_SIZES = [20, 50, 100] as const

export const DEFAULT_PARTY_QUERY: PartyQuery = {
  side: 'all',
  search: '',
  status: 'all',
  state: 'all',
  group: 'all',
  city: '',
  balance: 'any',
  credit: 'any',
  gst: 'any',
  activity: 'any',
  sort: 'name',
  order: 'asc',
  page: 1,
  pageSize: 20,
}

/**
 * The four tabs are two filters wearing one hat.
 *
 * All / Customers / Suppliers choose a side; Inactive chooses a status. Keeping
 * them as one selected tab over two pieces of state is what stops the screen
 * contradicting itself — an "Inactive" tab sitting above a Status filter
 * reading "Active" shows nothing and explains nothing.
 */
export function tabOf(query: PartyQuery): PartyTab {
  if (query.status === 'inactive') return 'inactive'
  if (query.side === 'customer' || query.side === 'supplier') return query.side
  return 'all'
}

export function applyTab(query: PartyQuery, tab: PartyTab): PartyQuery {
  switch (tab) {
    case 'customer':
    case 'supplier':
      // Leaving the Inactive status on would hand back an empty Customers tab.
      return { ...query, side: tab, status: query.status === 'inactive' ? 'all' : query.status, page: 1 }
    case 'inactive':
      return { ...query, status: 'inactive', page: 1 }
    default:
      return { ...query, side: 'all', status: 'all', page: 1 }
  }
}

/** How many of the optional filters are on, for the badge on More filters. */
export function activeFilterCount(query: PartyQuery): number {
  let count = 0
  if (query.state !== 'all') count++
  if (query.group !== 'all') count++
  if (query.city.trim() !== '') count++
  if (query.balance !== 'any') count++
  if (query.credit !== 'any') count++
  if (query.gst !== 'any') count++
  if (query.activity !== 'any') count++
  return count
}

export function partyQueryParams(query: PartyQuery): QueryParams {
  return {
    side: query.side,
    q: query.search.trim() || undefined,
    status: query.status,
    state: query.state,
    group: query.group,
    city: query.city.trim() || undefined,
    balance: query.balance,
    credit: query.credit,
    gst: query.gst,
    activity: query.activity,
    sort: query.sort,
    order: query.order,
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  }
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export const parties = {
  list: (query: PartyQuery, signal?: AbortSignal) =>
    api.get<PartyListResponse>('v1/parties', partyQueryParams(query), signal),

  overview: (signal?: AbortSignal) => api.one<PartyOverview>('v1/parties/overview', undefined, signal),

  duplicates: (signal?: AbortSignal) => api.one<DuplicateResponse>('v1/parties/duplicates', undefined, signal),

  /** The filtered list as a file. The server refuses a partial reading rather than sending a short one. */
  exportCsv: (query: PartyQuery) => api.download('v1/parties/export', partyQueryParams(query)),
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

/** Initials for the avatar, from a real name only. Never more than two letters. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0] ?? ''}${words[1][0] ?? ''}`.toUpperCase()
}

/**
 * Whether a name reads as an organisation rather than a person.
 *
 * Only decides which icon to draw, so being wrong costs nothing; it is never
 * used to classify a party or to decide what may be done with one.
 */
export function looksLikeOrganisation(name: string): boolean {
  return /\b(ltd|limited|pvt|private|llp|inc|corp|company|co|enterprises|industries|traders|distributors|services|solutions)\b/i.test(
    name,
  )
}

export function partyTypeLabel(type: PartySide): string {
  return type === 'supplier' ? 'Supplier' : 'Customer'
}

// ---------------------------------------------------------------------------
// The address bar
// ---------------------------------------------------------------------------

/**
 * Filters live in the URL, not only in React state.
 *
 * So that "the customers in Karnataka who owe something" is a link somebody can
 * send to their accountant, and so that going back from a statement returns to
 * the list as it was rather than to page one of everything.
 *
 * Anything unrecognised falls back to the default rather than being trusted: a
 * hand-typed query string is an input like any other.
 */
export function readPartyQuery(params: URLSearchParams): PartyQuery {
  const pick = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = params.get(key)
    return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
  }

  const size = Number(params.get('size') ?? '')
  const page = Number(params.get('page') ?? '')

  return {
    side: pick('side', ['all', 'customer', 'supplier'] as const, 'all'),
    search: params.get('q') ?? '',
    status: pick('status', ['all', 'active', 'inactive'] as const, 'all'),
    state: params.get('state') ?? 'all',
    group: params.get('group') ?? 'all',
    city: params.get('city') ?? '',
    balance: pick('balance', ['any', 'outstanding', 'settled', 'overdue'] as const, 'any'),
    credit: pick('credit', ['any', 'within', 'over', 'none'] as const, 'any'),
    gst: pick('gst', ['any', 'registered', 'unregistered'] as const, 'any'),
    activity: pick('activity', ['any', 'last_7', 'last_30', 'last_90', 'none'] as const, 'any'),
    sort: pick(
      'sort',
      ['name', 'outstanding', 'overdue', 'credit_limit', 'last_transaction', 'updated_at', 'state'] as const,
      'name',
    ),
    order: pick('order', ['asc', 'desc'] as const, 'asc'),
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
    pageSize: (PARTY_PAGE_SIZES as readonly number[]).includes(size) ? size : 20,
  }
}

/** Only what differs from the default, so an untouched screen has a clean URL. */
export function writePartyQuery(query: PartyQuery): URLSearchParams {
  const params = new URLSearchParams()
  const put = (key: string, value: string, fallback: string) => {
    if (value !== fallback && value !== '') params.set(key, value)
  }

  put('side', query.side, 'all')
  put('q', query.search.trim(), '')
  put('status', query.status, 'all')
  put('state', query.state, 'all')
  put('group', query.group, 'all')
  put('city', query.city.trim(), '')
  put('balance', query.balance, 'any')
  put('credit', query.credit, 'any')
  put('gst', query.gst, 'any')
  put('activity', query.activity, 'any')
  put('sort', query.sort, 'name')
  put('order', query.order, 'asc')
  if (query.page > 1) params.set('page', String(query.page))
  if (query.pageSize !== 20) params.set('size', String(query.pageSize))

  return params
}
