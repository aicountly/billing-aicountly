/**
 * The arithmetic behind Money to Collect and Money to Pay.
 *
 * Pure functions over the shape `v1/receivables` and `v1/payables` already
 * return. It imports nothing — not React, not the API client, not even the
 * formatter — and that is deliberate for two reasons.
 *
 *  1. Every figure on this screen is Smart Books' own. What is re-derived here
 *     is only what the API leaves out (a bucket per row, a status, a count),
 *     and it is derived against the response's OWN `as_on` date rather than the
 *     browser's clock, so a row can never disagree with the totals above it.
 *  2. It runs under `node --test` with no bundler, which is where the ageing
 *     and status rules are actually checked.
 *
 * A figure the API did not send is `null` here and renders as "not known".
 * Never a zero: a zero and an absent field look identical on screen and one of
 * them means "this customer has paid".
 */

// ---------------------------------------------------------------------------
// What the API sends
// ---------------------------------------------------------------------------

/** One outstanding bill, as `v1/receivables` lists it. */
export interface DueBillInput {
  account_id: number
  account_name: string
  bill_no: string | null
  bill_date: string | null
  due_date: string | null
  balance: number
  days_overdue: number
  voucher_id: number | null
  voucher_uuid: string | null
  /** Present only when Books sent a gross figure for the bill. */
  bill_amount?: number | null
  /** Gross less balance, when the gross is known. */
  received?: number | null
}

export interface DuePartyInput {
  account_id: number
  account_name: string
  total: number
  overdue: number
  bill_count: number
  oldest_overdue_days: number
}

export interface DuesInput {
  title: string
  as_on: string
  source: string
  total: number
  overdue: number
  due_today: number
  due_this_week: number
  ageing: Record<AgeingKey, number>
  ageing_reconciles: boolean
  parties: DuePartyInput[]
  bills: DueBillInput[]
  note: string
}

// ---------------------------------------------------------------------------
// Ageing
// ---------------------------------------------------------------------------

export type AgeingKey = 'current' | '1_30' | '31_60' | '61_90' | '90_plus' | 'no_due_date'

export interface AgeingDefinition {
  key: AgeingKey
  label: string
  /** Short form, for a chart axis where the full label will not fit. */
  short: string
  tone: 'ok' | 'warning' | 'danger' | 'neutral'
  colour: string
}

/**
 * Mutually exclusive and exhaustive, in the order a person reads them.
 *
 * `no_due_date` is its own bucket rather than being folded into "not yet due":
 * an undated bill might be months late, and hiding it in the green bar is how
 * it stays unchased. The colours run green → blue → amber → orange → red, which
 * is the order of concern rather than the order of the alphabet.
 */
export const AGEING_BUCKETS: AgeingDefinition[] = [
  { key: 'current', label: 'Not yet due', short: 'Not due', tone: 'ok', colour: '#2f9e28' },
  { key: '1_30', label: '1–30 days', short: '1–30', tone: 'warning', colour: '#2563eb' },
  { key: '31_60', label: '31–60 days', short: '31–60', tone: 'warning', colour: '#e3a008' },
  { key: '61_90', label: '61–90 days', short: '61–90', tone: 'danger', colour: '#dd6b20' },
  { key: '90_plus', label: 'Over 90 days', short: '90+', tone: 'danger', colour: '#d4562a' },
  { key: 'no_due_date', label: 'No due date', short: 'Undated', tone: 'neutral', colour: '#7d8d84' },
]

export function ageingDefinition(key: AgeingKey): AgeingDefinition {
  return AGEING_BUCKETS.find((bucket) => bucket.key === key) ?? AGEING_BUCKETS[5]
}

// ---------------------------------------------------------------------------
// Calendar days, without a timezone in the way
// ---------------------------------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/

/** A date as whole days since the epoch, read at UTC midnight. Null if unparseable. */
export function toUtcDay(value: string | null | undefined): number | null {
  if (!value) return null
  const parts = ISO_DATE.exec(value)
  if (!parts) return null

  const stamp = Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
  return Number.isFinite(stamp) ? stamp / 86_400_000 : null
}

/**
 * Whole calendar days from one date to the next.
 *
 * Both ends are read at UTC midnight, so the answer is a count of days on a
 * calendar rather than a division of milliseconds — which is the same number
 * right up until a daylight-saving boundary or a browser an hour off UTC turns
 * "due today" into "one day overdue".
 */
export function calendarDaysBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  const start = toUtcDay(from)
  const end = toUtcDay(to)
  if (start === null || end === null) return null

  return end - start
}

// ---------------------------------------------------------------------------
// One row, ready to draw
// ---------------------------------------------------------------------------

/** Where a bill stands against its own due date. Never a settlement state. */
export type DueTiming = 'not_yet_due' | 'due_today' | 'due_soon' | 'overdue' | 'no_due_date'

export interface DueRow {
  key: string
  accountId: number
  accountName: string
  billNo: string | null
  billDate: string | null
  dueDate: string | null
  balance: number
  /** Null when Books did not send a gross figure for this bill. */
  billAmount: number | null
  /** Null for the same reason. Not a zero — zero means "nothing has been paid". */
  received: number | null
  daysOverdue: number
  /** Days still to run. Null once the date has passed, or when there is no date. */
  daysUntilDue: number | null
  bucket: AgeingKey
  timing: DueTiming
  /** Something has been received against this bill and something is still owed. */
  partPaid: boolean
  voucherId: number | null
  voucherUuid: string | null
}

/** Bills falling due within this many days count as "due soon". */
export const DUE_SOON_DAYS = 7

/**
 * The ageing bucket for one bill.
 *
 * Measured from the DUE date, never the bill date: a bill on 60-day terms
 * raised 45 days ago is not overdue, and filing it under 31–60 would have
 * somebody ringing a customer who is well within terms. This mirrors the
 * server's own bucketing (DuesService::dues) so the table and the bar chart
 * cannot disagree.
 */
export function bucketOf(daysOverdue: number, dueDate: string | null): AgeingKey {
  if (!dueDate) return 'no_due_date'
  if (daysOverdue <= 0) return 'current'
  if (daysOverdue <= 30) return '1_30'
  if (daysOverdue <= 60) return '31_60'
  if (daysOverdue <= 90) return '61_90'

  return '90_plus'
}

/**
 * Where a bill stands, as at the date the server read it.
 *
 * Timing only. Whether a bill is part paid is a separate fact carried on the
 * row beside this one, because a part-paid bill that is ninety days late is
 * still ninety days late and collapsing the two loses the half that matters.
 */
export function timingOf(daysOverdue: number, daysUntilDue: number | null, dueDate: string | null): DueTiming {
  if (!dueDate) return 'no_due_date'
  if (daysOverdue > 0) return 'overdue'
  if (daysUntilDue === null) return 'no_due_date'
  if (daysUntilDue <= 0) return 'due_today'
  if (daysUntilDue <= DUE_SOON_DAYS) return 'due_soon'

  return 'not_yet_due'
}

function finiteOrNull(value: unknown): number | null {
  const amount = typeof value === 'string' ? Number.parseFloat(value) : value
  return typeof amount === 'number' && Number.isFinite(amount) ? amount : null
}

/** One API bill, normalised for the screen. `asOn` is the response's own date. */
export function toRow(bill: DueBillInput, asOn: string, index: number): DueRow {
  const daysOverdue = Math.max(0, Math.trunc(finiteOrNull(bill.days_overdue) ?? 0))
  const untilDue = daysOverdue > 0 ? null : calendarDaysBetween(asOn, bill.due_date)
  const billAmount = finiteOrNull(bill.bill_amount)

  // Received is only ever the difference between two figures Books sent. It is
  // never inferred from the balance alone, because "nothing received" and "we
  // were not told the invoice value" are different answers.
  const received = billAmount === null ? finiteOrNull(bill.received) : Math.max(0, billAmount - bill.balance)

  return {
    key: String(bill.voucher_uuid ?? bill.voucher_id ?? `${bill.account_id}-${bill.bill_no ?? index}`),
    accountId: bill.account_id,
    accountName: bill.account_name,
    billNo: bill.bill_no,
    billDate: bill.bill_date,
    dueDate: bill.due_date,
    balance: finiteOrNull(bill.balance) ?? 0,
    billAmount,
    received,
    daysOverdue,
    daysUntilDue: untilDue,
    bucket: bucketOf(daysOverdue, bill.due_date),
    timing: timingOf(daysOverdue, untilDue, bill.due_date),
    partPaid: received !== null && received > 0,
    voucherId: bill.voucher_id,
    voucherUuid: bill.voucher_uuid,
  }
}

export function toRows(dues: DuesInput | null | undefined): DueRow[] {
  if (!dues) return []
  return dues.bills.map((bill, index) => toRow(bill, dues.as_on, index))
}

// ---------------------------------------------------------------------------
// Filtering, sorting, paging
// ---------------------------------------------------------------------------

export type StatusFilter = 'all' | DueTiming | 'part_paid'
export type SortKey = 'due_date' | 'days_overdue' | 'balance' | 'account_name' | 'bill_date'
export type SortDirection = 'asc' | 'desc'

export interface DueFilters {
  q: string
  account: number | null
  status: StatusFilter
  ageing: AgeingKey | 'all'
  dueFrom: string | null
  dueTo: string | null
  minAmount: number | null
  maxAmount: number | null
  minDaysOverdue: number | null
  sort: SortKey
  dir: SortDirection
  page: number
  size: number
}

export const DEFAULT_FILTERS: DueFilters = {
  q: '',
  account: null,
  status: 'all',
  ageing: 'all',
  dueFrom: null,
  dueTo: null,
  minAmount: null,
  maxAmount: null,
  minDaysOverdue: null,
  sort: 'days_overdue',
  dir: 'desc',
  page: 1,
  size: 10,
}

export const PAGE_SIZES = [10, 25, 50, 100] as const

/** Which filters are doing something. Drives the chips and the "clear all". */
export function activeFilterCount(filters: DueFilters): number {
  let count = 0
  if (filters.q.trim() !== '') count += 1
  if (filters.account !== null) count += 1
  if (filters.status !== 'all') count += 1
  if (filters.ageing !== 'all') count += 1
  if (filters.dueFrom) count += 1
  if (filters.dueTo) count += 1
  if (filters.minAmount !== null) count += 1
  if (filters.maxAmount !== null) count += 1
  if (filters.minDaysOverdue !== null) count += 1

  return count
}

export function matches(row: DueRow, filters: DueFilters): boolean {
  const term = filters.q.trim().toLowerCase()
  if (term !== '') {
    const haystack = `${row.accountName} ${row.billNo ?? ''}`.toLowerCase()
    if (!haystack.includes(term)) return false
  }

  if (filters.account !== null && row.accountId !== filters.account) return false
  if (filters.ageing !== 'all' && row.bucket !== filters.ageing) return false

  if (filters.status !== 'all') {
    if (filters.status === 'part_paid') {
      if (!row.partPaid) return false
    } else if (row.timing !== filters.status) {
      return false
    }
  }

  const due = toUtcDay(row.dueDate)
  if (filters.dueFrom) {
    const from = toUtcDay(filters.dueFrom)
    if (from !== null && (due === null || due < from)) return false
  }
  if (filters.dueTo) {
    const to = toUtcDay(filters.dueTo)
    if (to !== null && (due === null || due > to)) return false
  }

  if (filters.minAmount !== null && row.balance < filters.minAmount) return false
  if (filters.maxAmount !== null && row.balance > filters.maxAmount) return false
  if (filters.minDaysOverdue !== null && row.daysOverdue < filters.minDaysOverdue) return false

  return true
}

/**
 * Sorted, with a stable tie-break.
 *
 * Two bills the same number of days late must not swap places between renders —
 * a list that reshuffles under the pointer is a list somebody clicks the wrong
 * row in.
 */
export function sortRows(rows: DueRow[], sort: SortKey, dir: SortDirection): DueRow[] {
  const factor = dir === 'asc' ? 1 : -1

  return [...rows].sort((a, b) => {
    let order = 0
    switch (sort) {
      case 'account_name':
        order = a.accountName.localeCompare(b.accountName, 'en-IN')
        break
      case 'balance':
        order = a.balance - b.balance
        break
      case 'due_date':
        // An undated bill sorts last whichever way the column is pointed: it has
        // no position on a timeline, and floating it to the top of "soonest
        // first" would bury the bill that is actually due tomorrow.
        order = (toUtcDay(a.dueDate) ?? Number.POSITIVE_INFINITY) - (toUtcDay(b.dueDate) ?? Number.POSITIVE_INFINITY)
        if (!Number.isFinite(order)) order = a.dueDate ? -1 : b.dueDate ? 1 : 0
        break
      case 'bill_date':
        order = (toUtcDay(a.billDate) ?? 0) - (toUtcDay(b.billDate) ?? 0)
        break
      default:
        order = a.daysOverdue - b.daysOverdue
    }

    if (order !== 0) return order * factor
    return a.key.localeCompare(b.key)
  })
}

export interface Page<T> {
  rows: T[]
  page: number
  size: number
  total: number
  totalPages: number
  from: number
  to: number
}

/** One page, with the page number clamped so a filter change cannot strand it. */
export function paginate<T>(rows: T[], page: number, size: number): Page<T> {
  const totalPages = Math.max(1, Math.ceil(rows.length / size))
  const current = Math.min(Math.max(1, page), totalPages)
  const start = (current - 1) * size

  return {
    rows: rows.slice(start, start + size),
    page: current,
    size,
    total: rows.length,
    totalPages,
    from: rows.length === 0 ? 0 : start + 1,
    to: Math.min(start + size, rows.length),
  }
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export interface DueSummary {
  total: number
  overdue: number
  overdueShare: number
  overdueCount: number
  dueToday: number
  dueTodayCount: number
  dueThisWeek: number
  dueThisWeekCount: number
  billCount: number
  partyCount: number
  severelyOverdue: number
  severelyOverdueCount: number
  partPaidKnown: boolean
  received: number | null
  invoiced: number | null
}

/**
 * The headline figures.
 *
 * The money comes from the server, which worked it out from the same rows and
 * is the one that reconciled the buckets against the total. Only the COUNTS are
 * derived here, and only because the API sends amounts without them — counting
 * the rows it did send is exact, not an estimate.
 */
export function summarise(dues: DuesInput | null | undefined, rows: DueRow[]): DueSummary {
  let overdueCount = 0
  let dueTodayCount = 0
  let dueThisWeekCount = 0
  let severelyOverdue = 0
  let severelyOverdueCount = 0
  let received = 0
  let invoiced = 0
  let grossKnown = 0

  for (const row of rows) {
    if (row.timing === 'overdue') overdueCount += 1
    if (row.timing === 'due_today') dueTodayCount += 1
    if (row.timing === 'due_today' || row.timing === 'due_soon') dueThisWeekCount += 1
    if (row.bucket === '61_90' || row.bucket === '90_plus') {
      severelyOverdue += row.balance
      severelyOverdueCount += 1
    }
    if (row.billAmount !== null) {
      grossKnown += 1
      invoiced += row.billAmount
      received += row.received ?? 0
    }
  }

  const total = dues?.total ?? 0
  const overdue = dues?.overdue ?? 0

  return {
    total,
    overdue,
    overdueShare: total > 0 ? round1((overdue / total) * 100) : 0,
    overdueCount,
    dueToday: dues?.due_today ?? 0,
    dueTodayCount,
    dueThisWeek: dues?.due_this_week ?? 0,
    dueThisWeekCount,
    billCount: rows.length,
    partyCount: dues?.parties.length ?? 0,
    severelyOverdue: round2(severelyOverdue),
    severelyOverdueCount,
    // Only claimed when EVERY row carried a gross figure. A part-known total is
    // a wrong total, and "₹2L received" that silently covers half the ledger is
    // worse than no figure at all.
    partPaidKnown: rows.length > 0 && grossKnown === rows.length,
    received: rows.length > 0 && grossKnown === rows.length ? round2(received) : null,
    invoiced: rows.length > 0 && grossKnown === rows.length ? round2(invoiced) : null,
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

// ---------------------------------------------------------------------------
// Chart series
// ---------------------------------------------------------------------------

export interface AgeingSlice extends AgeingDefinition {
  amount: number
  count: number
  share: number
}

/**
 * The ageing bar, in both units.
 *
 * Amounts come from the server's own buckets so the chart agrees with the
 * report; counts are tallied from the rows, because the API sends no count.
 */
export function ageingSeries(dues: DuesInput | null | undefined, rows: DueRow[]): AgeingSlice[] {
  const counts = new Map<AgeingKey, number>()
  for (const row of rows) counts.set(row.bucket, (counts.get(row.bucket) ?? 0) + 1)

  const total = dues?.total ?? 0

  return AGEING_BUCKETS.map((bucket) => {
    const amount = dues?.ageing?.[bucket.key] ?? 0
    return {
      ...bucket,
      amount,
      count: counts.get(bucket.key) ?? 0,
      share: total > 0 ? round1((amount / total) * 100) : 0,
    }
  })
}

export interface PartyShare {
  id: string
  accountId: number | null
  label: string
  amount: number
  share: number
  colour: string
  billCount: number
}

/**
 * Deliberately NOT "by party type".
 *
 * Nothing in this deployment classifies a customer as regular, new, government
 * or export — Books' bill-by-bill carries no such field and neither does any
 * master Billing can read. Inventing one would put a confident label on a guess.
 * What IS known, exactly, is who owes what, so that is what this shows.
 */
const SHARE_COLOURS = ['#187a12', '#2563eb', '#7c3aed', '#e3a008', '#dd6b20', '#0f7fa8']
const OTHERS_COLOUR = '#7d8d84'

export function partyShares(dues: DuesInput | null | undefined, limit = 5): PartyShare[] {
  const parties = [...(dues?.parties ?? [])].sort((a, b) => b.total - a.total)
  const total = dues?.total ?? 0
  if (total <= 0 || parties.length === 0) return []

  const head = parties.slice(0, limit)
  const tail = parties.slice(limit)

  const shares: PartyShare[] = head.map((party, index) => ({
    id: `party-${party.account_id}`,
    accountId: party.account_id,
    label: party.account_name,
    amount: party.total,
    share: round1((party.total / total) * 100),
    colour: SHARE_COLOURS[index % SHARE_COLOURS.length],
    billCount: party.bill_count,
  }))

  if (tail.length > 0) {
    const rest = tail.reduce((sum, party) => sum + party.total, 0)
    shares.push({
      id: 'party-others',
      accountId: null,
      label: `${tail.length} other${tail.length === 1 ? '' : 's'}`,
      amount: round2(rest),
      share: round1((rest / total) * 100),
      colour: OTHERS_COLOUR,
      billCount: tail.reduce((sum, party) => sum + party.bill_count, 0),
    })
  }

  return shares
}

/** How much of the overdue money sits with the few biggest debtors. */
export interface Concentration {
  count: number
  amount: number
  share: number
  names: string[]
}

export function concentration(dues: DuesInput | null | undefined, limit = 5): Concentration | null {
  const overdueTotal = dues?.overdue ?? 0
  if (!dues || overdueTotal <= 0) return null

  const worst = dues.parties
    .filter((party) => party.overdue > 0)
    .sort((a, b) => b.overdue - a.overdue)
    .slice(0, limit)

  if (worst.length === 0) return null

  const amount = worst.reduce((sum, party) => sum + party.overdue, 0)

  return {
    count: worst.length,
    amount: round2(amount),
    share: round1((amount / overdueTotal) * 100),
    names: worst.map((party) => party.account_name),
  }
}

// ---------------------------------------------------------------------------
// Collection health — stated as the two numbers it is made of
// ---------------------------------------------------------------------------

export type HealthLevel = 'healthy' | 'watch' | 'attention'

export interface CollectionHealth {
  level: HealthLevel
  label: string
  /** The rule that produced the label, in words. Never an opaque score. */
  because: string
  overdueShare: number
  severeShare: number
}

/**
 * Two published percentages and two thresholds. That is the whole model.
 *
 * There is no weighting, no trend and no learned coefficient, because a
 * collections figure a user cannot check is a figure they should not act on.
 */
export function collectionHealth(summary: DueSummary): CollectionHealth | null {
  if (summary.total <= 0) return null

  const overdueShare = summary.overdueShare
  const severeShare = round1((summary.severelyOverdue / summary.total) * 100)

  const level: HealthLevel =
    overdueShare < 10 && severeShare < 5 ? 'healthy' : overdueShare < 30 && severeShare < 15 ? 'watch' : 'attention'

  const labels: Record<HealthLevel, string> = {
    healthy: 'Healthy',
    watch: 'Watch',
    attention: 'Needs attention',
  }

  return {
    level,
    label: labels[level],
    because: `${overdueShare}% of what is outstanding is overdue, and ${severeShare}% is more than 60 days late.`,
    overdueShare,
    severeShare,
  }
}

// ---------------------------------------------------------------------------
// Insights — sentences, each one arithmetic over the rows above
// ---------------------------------------------------------------------------

export interface Insight {
  id: string
  tone: 'info' | 'warning' | 'danger'
  text: string
  /** The filter this sentence is talking about, so it can be opened. */
  filter?: Partial<DueFilters>
}

export interface InsightContext {
  summary: DueSummary
  rows: DueRow[]
  dues: DuesInput | null | undefined
  side: 'receivable' | 'payable'
  formatMoney: (value: number) => string
}

/**
 * Every sentence here is a count or a sum of the rows on this page.
 *
 * Nothing is predicted, scored or phrased as advice the data does not support.
 * If a statement cannot be made from the figures, it is not made.
 */
export function insights({ summary, rows, dues, side, formatMoney }: InsightContext): Insight[] {
  const out: Insight[] = []
  const owes = side === 'receivable' ? 'owed to you' : 'you owe'

  if (summary.overdue > 0) {
    out.push({
      id: 'overdue',
      tone: 'danger',
      text: `${formatMoney(summary.overdue)} is overdue across ${summary.overdueCount} bill${
        summary.overdueCount === 1 ? '' : 's'
      } — ${summary.overdueShare}% of everything ${owes}.`,
      filter: { status: 'overdue' },
    })
  }

  const worst = concentration(dues)
  if (worst && worst.share >= 40 && worst.count > 1) {
    out.push({
      id: 'concentration',
      tone: 'warning',
      text: `${worst.count} ${side === 'receivable' ? 'customers' : 'suppliers'} hold ${worst.share}% of the overdue money (${formatMoney(
        worst.amount,
      )}): ${worst.names.join(', ')}.`,
    })
  }

  if (summary.severelyOverdueCount > 0) {
    out.push({
      id: 'severe',
      tone: 'danger',
      text: `${summary.severelyOverdueCount} bill${
        summary.severelyOverdueCount === 1 ? ' is' : 's are'
      } more than 60 days late, worth ${formatMoney(summary.severelyOverdue)}.`,
      filter: { ageing: '61_90' },
    })
  }

  if (summary.dueToday > 0) {
    out.push({
      id: 'due_today',
      tone: 'info',
      text: `${formatMoney(summary.dueToday)} falls due today across ${summary.dueTodayCount} bill${
        summary.dueTodayCount === 1 ? '' : 's'
      }.`,
      filter: { status: 'due_today' },
    })
  }

  if (summary.dueThisWeek > summary.dueToday) {
    out.push({
      id: 'due_week',
      tone: 'info',
      text: `${formatMoney(summary.dueThisWeek)} falls due within seven days, across ${summary.dueThisWeekCount} bill${
        summary.dueThisWeekCount === 1 ? '' : 's'
      }.`,
      filter: { status: 'due_soon' },
    })
  }

  const undated = rows.filter((row) => row.bucket === 'no_due_date')
  if (undated.length > 0) {
    out.push({
      id: 'undated',
      tone: 'warning',
      text: `${undated.length} bill${undated.length === 1 ? ' has' : 's have'} no due date, so ${
        undated.length === 1 ? 'it cannot' : 'they cannot'
      } be aged. Worth ${formatMoney(undated.reduce((sum, row) => sum + row.balance, 0))}.`,
      filter: { ageing: 'no_due_date' },
    })
  }

  const repeat = repeatOffender(dues)
  if (repeat) {
    out.push({
      id: 'repeat',
      tone: 'warning',
      text: `${repeat.account_name} has ${repeat.bill_count} unpaid bills, the oldest ${repeat.oldest_overdue_days} days past due.`,
      filter: { account: repeat.account_id },
    })
  }

  return out
}

/** The party with the most unpaid bills, where that is more than a couple. */
function repeatOffender(dues: DuesInput | null | undefined): DuePartyInput | null {
  const worst = [...(dues?.parties ?? [])]
    .filter((party) => party.bill_count >= 3 && party.oldest_overdue_days > 0)
    .sort((a, b) => b.bill_count - a.bill_count || b.overdue - a.overdue)[0]

  return worst ?? null
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const CSV_COLUMNS = [
  'Bill',
  'Dated',
  'Party',
  'Due',
  'Days overdue',
  'Bill amount',
  'Received',
  'Outstanding',
  'Status',
  'Ageing',
] as const

export const STATUS_WORDS: Record<DueTiming, string> = {
  not_yet_due: 'Not yet due',
  due_today: 'Due today',
  due_soon: 'Due soon',
  overdue: 'Overdue',
  no_due_date: 'No due date',
}

/**
 * A spreadsheet cell that cannot be read as a formula.
 *
 * A party named `=cmd|…` in a CSV is a command Excel offers to run, and a
 * receivables export is exactly the file somebody opens without thinking.
 */
function csvCell(value: string | number | null): string {
  if (value === null) return ''
  const text = String(value)
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text

  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

/** The rows currently filtered in — every one of them, not the visible page. */
export function toCsv(rows: DueRow[]): string {
  const lines = [CSV_COLUMNS.join(',')]

  for (const row of rows) {
    lines.push(
      [
        csvCell(row.billNo),
        csvCell(row.billDate),
        csvCell(row.accountName),
        csvCell(row.dueDate),
        csvCell(row.daysOverdue),
        csvCell(row.billAmount),
        csvCell(row.received),
        csvCell(row.balance),
        csvCell(STATUS_WORDS[row.timing] + (row.partPaid ? ' (part paid)' : '')),
        csvCell(ageingDefinition(row.bucket).label),
      ].join(','),
    )
  }

  return lines.join('\n')
}
