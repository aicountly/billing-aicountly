/**
 * The ageing and status rules, checked without a browser.
 *
 * `src/receivables/model.ts` imports nothing, so node runs it as-is with
 * `--experimental-strip-types`. No bundler, no test framework, no third
 * dependency added to a product that ships four.
 *
 *   npm test
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  activeFilterCount,
  ageingSeries,
  bucketOf,
  calendarDaysBetween,
  collectionHealth,
  concentration,
  DEFAULT_FILTERS,
  insights,
  matches,
  paginate,
  partyShares,
  sortRows,
  summarise,
  timingOf,
  toCsv,
  toRow,
  toRows,
  type DueBillInput,
  type DuesInput,
} from './model.ts'

const AS_ON = '2026-09-19'

function bill(overrides: Partial<DueBillInput> = {}): DueBillInput {
  return {
    account_id: 1,
    account_name: 'ABC Traders',
    bill_no: 'INV-2026-0012',
    bill_date: '2026-09-05',
    due_date: '2026-09-20',
    balance: 124800,
    days_overdue: 0,
    voucher_id: 4101,
    voucher_uuid: 'vch-1',
    ...overrides,
  }
}

function dues(overrides: Partial<DuesInput> = {}): DuesInput {
  return {
    title: 'Money to collect',
    as_on: AS_ON,
    source: 'books',
    total: 0,
    overdue: 0,
    due_today: 0,
    due_this_week: 0,
    ageing: { current: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0, no_due_date: 0 },
    ageing_reconciles: true,
    parties: [],
    bills: [],
    note: '',
    ...overrides,
  }
}

const inr = (value: number) => `₹${value}`

describe('calendar days', () => {
  it('counts whole days between two dates', () => {
    assert.equal(calendarDaysBetween('2026-09-19', '2026-09-20'), 1)
    assert.equal(calendarDaysBetween('2026-09-19', '2026-09-19'), 0)
    assert.equal(calendarDaysBetween('2026-09-20', '2026-09-19'), -1)
  })

  it('crosses a month and a year end without drifting', () => {
    assert.equal(calendarDaysBetween('2026-03-31', '2026-04-01'), 1)
    assert.equal(calendarDaysBetween('2025-12-31', '2026-01-01'), 1)
    assert.equal(calendarDaysBetween('2026-01-01', '2026-12-31'), 364)
  })

  it('ignores a time part rather than letting it shift the answer', () => {
    // The off-by-one this rules out: a timestamp late in the day, divided by
    // 86400000, lands on the previous date in a timezone behind UTC.
    assert.equal(calendarDaysBetween('2026-09-19T23:30:00+05:30', '2026-09-20T00:30:00+05:30'), 1)
  })

  it('answers null for a date it cannot read', () => {
    assert.equal(calendarDaysBetween('2026-09-19', null), null)
    assert.equal(calendarDaysBetween('2026-09-19', 'not a date'), null)
  })
})

describe('ageing buckets', () => {
  it('puts every boundary in exactly one bucket', () => {
    assert.equal(bucketOf(0, '2026-09-20'), 'current')
    assert.equal(bucketOf(1, '2026-09-18'), '1_30')
    assert.equal(bucketOf(30, '2026-08-20'), '1_30')
    assert.equal(bucketOf(31, '2026-08-19'), '31_60')
    assert.equal(bucketOf(60, '2026-07-21'), '31_60')
    assert.equal(bucketOf(61, '2026-07-20'), '61_90')
    assert.equal(bucketOf(90, '2026-06-21'), '61_90')
    assert.equal(bucketOf(91, '2026-06-20'), '90_plus')
  })

  it('gives an undated bill its own bucket rather than calling it current', () => {
    assert.equal(bucketOf(0, null), 'no_due_date')
  })
})

describe('status', () => {
  it('reads timing from the due date, as at the date the server read', () => {
    assert.equal(timingOf(0, 5, '2026-09-24'), 'due_soon')
    assert.equal(timingOf(0, 0, '2026-09-19'), 'due_today')
    assert.equal(timingOf(0, 8, '2026-09-27'), 'not_yet_due')
    assert.equal(timingOf(1, null, '2026-09-18'), 'overdue')
    assert.equal(timingOf(0, null, null), 'no_due_date')
  })

  it('keeps part paid separate from being late', () => {
    const row = toRow(bill({ days_overdue: 75, due_date: '2026-07-06', balance: 50000, bill_amount: 200000 }), AS_ON, 0)

    assert.equal(row.timing, 'overdue', 'still overdue')
    assert.equal(row.bucket, '61_90')
    assert.equal(row.partPaid, true)
    assert.equal(row.received, 150000)
  })
})

describe('a row', () => {
  it('counts the days still to run on a bill that is not yet due', () => {
    const row = toRow(bill({ due_date: '2026-09-20', days_overdue: 0 }), AS_ON, 0)

    assert.equal(row.daysUntilDue, 1)
    assert.equal(row.daysOverdue, 0)
    assert.equal(row.timing, 'due_soon')
  })

  it('leaves received unknown when Books sent no invoice value', () => {
    const row = toRow(bill(), AS_ON, 0)

    // Not zero. "Nothing received" and "we were not told the invoice value" are
    // different answers and only one of them may be printed as ₹0.00.
    assert.equal(row.received, null)
    assert.equal(row.billAmount, null)
    assert.equal(row.partPaid, false)
  })

  it('never reports a negative amount received', () => {
    const row = toRow(bill({ balance: 120, bill_amount: 100 }), AS_ON, 0)
    assert.equal(row.received, 0)
  })

  it('survives a bill with no number and no voucher', () => {
    const row = toRow(bill({ bill_no: null, voucher_id: null, voucher_uuid: null }), AS_ON, 7)
    assert.equal(row.key, '1-7')
  })
})

describe('filters', () => {
  const rows = toRows(
    dues({
      bills: [
        bill({ voucher_uuid: 'a', account_id: 1, account_name: 'ABC Traders', days_overdue: 0, due_date: '2026-09-19', balance: 1000 }),
        bill({ voucher_uuid: 'b', account_id: 2, account_name: 'Sharma Enterprises', bill_no: 'INV-11', days_overdue: 7, due_date: '2026-09-12', balance: 2000 }),
        bill({ voucher_uuid: 'c', account_id: 3, account_name: 'Kumar & Sons', bill_no: 'INV-09', days_overdue: 95, due_date: '2026-06-16', balance: 3000 }),
        bill({ voucher_uuid: 'd', account_id: 3, account_name: 'Kumar & Sons', bill_no: null, days_overdue: 0, due_date: null, balance: 4000 }),
      ],
    }),
  )

  const withFilter = (patch: Partial<typeof DEFAULT_FILTERS>) =>
    rows.filter((row) => matches(row, { ...DEFAULT_FILTERS, ...patch })).map((row) => row.key)

  it('searches the party name and the bill number, case-insensitively', () => {
    assert.deepEqual(withFilter({ q: 'kumar' }), ['c', 'd'])
    assert.deepEqual(withFilter({ q: 'INV-11' }), ['b'])
    assert.deepEqual(withFilter({ q: 'nobody' }), [])
  })

  it('filters by party, status and ageing', () => {
    assert.deepEqual(withFilter({ account: 3 }), ['c', 'd'])
    assert.deepEqual(withFilter({ status: 'due_today' }), ['a'])
    assert.deepEqual(withFilter({ status: 'overdue' }), ['b', 'c'])
    assert.deepEqual(withFilter({ ageing: '90_plus' }), ['c'])
    assert.deepEqual(withFilter({ ageing: 'no_due_date' }), ['d'])
  })

  it('filters by amount, due date and how late', () => {
    assert.deepEqual(withFilter({ minAmount: 2500 }), ['c', 'd'])
    assert.deepEqual(withFilter({ maxAmount: 1500 }), ['a'])
    assert.deepEqual(withFilter({ minDaysOverdue: 10 }), ['c'])
    assert.deepEqual(withFilter({ dueFrom: '2026-09-13' }), ['a'])
    assert.deepEqual(withFilter({ dueTo: '2026-09-12' }), ['b', 'c'])
  })

  it('counts what is actually narrowing the list', () => {
    assert.equal(activeFilterCount(DEFAULT_FILTERS), 0)
    assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, q: '   ' }), 0, 'whitespace is not a filter')
    assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, q: 'abc', status: 'overdue' }), 2)
  })

  it('sorts, with undated bills last either way', () => {
    assert.deepEqual(sortRows(rows, 'days_overdue', 'desc').map((r) => r.key), ['c', 'b', 'a', 'd'])
    assert.deepEqual(sortRows(rows, 'balance', 'asc').map((r) => r.key), ['a', 'b', 'c', 'd'])
    assert.equal(sortRows(rows, 'due_date', 'asc').at(-1)?.key, 'd')
  })
})

describe('paging', () => {
  const rows = Array.from({ length: 84 }, (_, index) => index)

  it('reports the window the way the screen says it', () => {
    const page = paginate(rows, 1, 10)
    assert.equal(page.from, 1)
    assert.equal(page.to, 10)
    assert.equal(page.total, 84)
    assert.equal(page.totalPages, 9)
  })

  it('clamps a page a filter change has stranded', () => {
    assert.equal(paginate(rows, 99, 10).page, 9)
    assert.equal(paginate([], 4, 10).page, 1)
    assert.equal(paginate([], 1, 10).from, 0)
  })

  it('gives a short last page its real bounds', () => {
    const page = paginate(rows, 9, 10)
    assert.equal(page.from, 81)
    assert.equal(page.to, 84)
    assert.equal(page.rows.length, 4)
  })
})

describe('the summary', () => {
  const payload = dues({
    total: 1248560,
    overdue: 732400,
    due_today: 124800,
    due_this_week: 218600,
    ageing: { current: 120160, '1_30': 218600, '31_60': 204300, '61_90': 132450, '90_plus': 273050, no_due_date: 300000 },
    parties: [
      { account_id: 1, account_name: 'ABC Traders', total: 500000, overdue: 400000, bill_count: 3, oldest_overdue_days: 75 },
      { account_id: 2, account_name: 'Sharma Enterprises', total: 300000, overdue: 200000, bill_count: 1, oldest_overdue_days: 12 },
    ],
    bills: [
      bill({ voucher_uuid: 'a', days_overdue: 0, due_date: '2026-09-19', balance: 124800 }),
      bill({ voucher_uuid: 'b', days_overdue: 0, due_date: '2026-09-23', balance: 93800 }),
      bill({ voucher_uuid: 'c', days_overdue: 70, due_date: '2026-07-11', balance: 132450 }),
      bill({ voucher_uuid: 'd', days_overdue: 120, due_date: '2026-05-22', balance: 273050 }),
    ],
  })
  const rows = toRows(payload)
  const summary = summarise(payload, rows)

  it('takes the money from the server and counts the rows itself', () => {
    assert.equal(summary.total, 1248560)
    assert.equal(summary.overdue, 732400)
    assert.equal(summary.overdueShare, 58.7)
    assert.equal(summary.overdueCount, 2)
    assert.equal(summary.dueTodayCount, 1)
    assert.equal(summary.dueThisWeekCount, 2)
    assert.equal(summary.billCount, 4)
    assert.equal(summary.partyCount, 2)
  })

  it('adds up what is more than sixty days late', () => {
    assert.equal(summary.severelyOverdueCount, 2)
    assert.equal(summary.severelyOverdue, 405500)
  })

  it('refuses a received total unless every bill carried an invoice value', () => {
    assert.equal(summary.partPaidKnown, false)
    assert.equal(summary.received, null)
    assert.equal(summary.invoiced, null)
  })

  it('reports received once Books sends the gross on every row', () => {
    const known = dues({
      total: 300,
      bills: [
        bill({ voucher_uuid: 'a', balance: 100, bill_amount: 250 }),
        bill({ voucher_uuid: 'b', balance: 200, bill_amount: 200 }),
      ],
    })
    const full = summarise(known, toRows(known))

    assert.equal(full.partPaidKnown, true)
    assert.equal(full.invoiced, 450)
    assert.equal(full.received, 150)
  })

  it('does not divide by zero on an empty ledger', () => {
    const empty = summarise(dues(), [])
    assert.equal(empty.overdueShare, 0)
    assert.equal(empty.total, 0)
    assert.equal(collectionHealth(empty), null)
  })

  it('draws the ageing bar from the server buckets and its own counts', () => {
    const series = ageingSeries(payload, rows)
    const bucket = series.find((slice) => slice.key === '90_plus')

    assert.equal(bucket?.amount, 273050)
    assert.equal(bucket?.count, 1)
    assert.equal(series.find((slice) => slice.key === 'current')?.count, 2)
    assert.equal(series.length, 6, 'every bucket is drawn, including the empty ones')
  })

  it('shares out the money by party, with the tail gathered up', () => {
    const shares = partyShares(payload, 1)

    assert.equal(shares[0].label, 'ABC Traders')
    assert.equal(shares[0].share, 40.0)
    assert.equal(shares[1].label, '1 other')
    assert.equal(shares[1].amount, 300000)
  })

  it('says where the overdue money is concentrated', () => {
    const worst = concentration(payload)

    assert.equal(worst?.count, 2)
    assert.equal(worst?.amount, 600000)
    assert.equal(worst?.share, 81.9)
  })
})

describe('collection health', () => {
  const at = (total: number, overdue: number, severe: number) =>
    collectionHealth({ ...summarise(dues({ total, overdue }), []), severelyOverdue: severe })

  it('labels from two published percentages', () => {
    assert.equal(at(1000, 50, 10)?.level, 'healthy')
    assert.equal(at(1000, 200, 100)?.level, 'watch')
    assert.equal(at(1000, 400, 300)?.level, 'attention')
  })

  it('escalates on age even when the overdue share looks calm', () => {
    // 9% overdue would read as healthy on its own. A tenth of the ledger being
    // more than sixty days late is what moves it, and that is the whole point
    // of grading on two numbers rather than one.
    assert.equal(at(1000, 90, 100)?.level, 'watch')
    assert.equal(at(1000, 90, 200)?.level, 'attention')
  })

  it('says why, in the numbers it used', () => {
    assert.match(at(1000, 200, 100)!.because, /20% of what is outstanding is overdue/)
  })
})

describe('insights', () => {
  const payload = dues({
    total: 100000,
    overdue: 60000,
    due_today: 10000,
    due_this_week: 25000,
    parties: [
      { account_id: 1, account_name: 'ABC Traders', total: 50000, overdue: 40000, bill_count: 3, oldest_overdue_days: 75 },
      { account_id: 2, account_name: 'Kumar & Sons', total: 30000, overdue: 20000, bill_count: 1, oldest_overdue_days: 20 },
    ],
    bills: [
      bill({ voucher_uuid: 'a', days_overdue: 75, due_date: '2026-07-06', balance: 40000 }),
      bill({ voucher_uuid: 'b', days_overdue: 20, due_date: '2026-08-30', balance: 20000 }),
      bill({ voucher_uuid: 'c', days_overdue: 0, due_date: '2026-09-19', balance: 10000 }),
      bill({ voucher_uuid: 'd', days_overdue: 0, due_date: null, balance: 30000 }),
    ],
  })
  const rows = toRows(payload)
  const lines = insights({ summary: summarise(payload, rows), rows, dues: payload, side: 'receivable', formatMoney: inr })
  const text = lines.map((line) => line.text).join(' | ')

  it('states the overdue position with its count and share', () => {
    assert.match(text, /₹60000 is overdue across 2 bills — 60% of everything owed to you/)
  })

  it('names the customers holding the overdue money', () => {
    assert.match(text, /2 customers hold 100% of the overdue money/)
    assert.match(text, /ABC Traders, Kumar & Sons/)
  })

  it('flags undated bills rather than ageing them silently', () => {
    assert.match(text, /1 bill has no due date/)
  })

  it('names a customer with several unpaid bills', () => {
    assert.match(text, /ABC Traders has 3 unpaid bills, the oldest 75 days past due/)
  })

  it('says nothing at all about an empty ledger', () => {
    const quiet = dues()
    assert.deepEqual(
      insights({ summary: summarise(quiet, []), rows: [], dues: quiet, side: 'receivable', formatMoney: inr }),
      [],
    )
  })

  it('each sentence can be opened as a filter', () => {
    assert.deepEqual(lines.find((line) => line.id === 'overdue')?.filter, { status: 'overdue' })
  })
})

describe('the CSV export', () => {
  const rows = toRows(dues({ bills: [bill({ balance: 124800, days_overdue: 4, due_date: '2026-09-15' })] }))

  it('writes a header and one line per row', () => {
    const lines = toCsv(rows).split('\n')
    assert.equal(lines.length, 2)
    assert.match(lines[0], /^Bill,Dated,Party,Due/)
    assert.match(lines[1], /INV-2026-0012,2026-09-05,ABC Traders,2026-09-15,4,,,124800,Overdue,1–30 days/)
  })

  it('leaves an unknown figure empty rather than writing a zero', () => {
    assert.match(toCsv(rows).split('\n')[1], /,,,124800,/)
  })

  it('defuses a party name a spreadsheet would run', () => {
    const risky = toRows(dues({ bills: [bill({ account_name: '=cmd|calc' })] }))
    assert.match(toCsv(risky), /'=cmd\|calc/)
  })

  it('quotes a party name containing a comma', () => {
    const comma = toRows(dues({ bills: [bill({ account_name: 'Gupta, Sons & Co' })] }))
    assert.match(toCsv(comma), /"Gupta, Sons & Co"/)
  })
})
