/**
 * The arithmetic the dashboard does in the browser.
 *
 *   node --test --experimental-strip-types src/dashboards/
 *
 * Or `npm test`, which is the same thing. No test framework and no build step:
 * these are pure functions over plain values, and Node has run `.ts` directly
 * since 22.6.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { groupPoints, readableRange, weekStart } from './trend.ts'

describe('grouping the trend into weeks', () => {
  it('adds the days up without losing a paisa', () => {
    // Thirty amounts that each land badly in binary. Added as floats this
    // comes to 6.000000000000001 and the chart disagrees with the card above
    // it by a rounding error nobody can find.
    const points = Array.from({ length: 30 }, (_, index) => ({
      label: `2026-09-${String(index + 1).padStart(2, '0')}`,
      value: 0.2,
    }))

    const weeks = groupPoints(points, 'week')
    const total = weeks.reduce((sum, week) => sum + week.value, 0)

    assert.equal(Number(total.toFixed(2)), 6)
    for (const week of weeks) {
      assert.equal(week.value, Number(week.value.toFixed(2)), `${week.label} is a clean amount`)
    }
  })

  it('leaves the daily series exactly as it arrived', () => {
    const points = [
      { label: '2026-09-01', value: 100.5 },
      { label: '2026-09-02', value: 200.25 },
    ]

    assert.deepEqual(groupPoints(points, 'day'), points)
  })

  it('puts a week under its Monday and keeps the weeks in order', () => {
    // 2026-09-01 is a Tuesday, so the first week is Mon 31 Aug.
    const points = [
      { label: '2026-09-01', value: 10 },
      { label: '2026-09-06', value: 5 }, // Sunday — same week
      { label: '2026-09-07', value: 3 }, // Monday — the next one
    ]

    assert.deepEqual(groupPoints(points, 'week'), [
      { label: '2026-08-31', value: 15 },
      { label: '2026-09-07', value: 3 },
    ])
  })

  it('never folds an unreadable date into somebody else\'s week', () => {
    const points = [
      { label: '2026-09-01', value: 10 },
      { label: 'not-a-date', value: 999 },
      { label: '2026-09-02', value: 20 },
    ]

    const weeks = groupPoints(points, 'week')

    assert.equal(weeks.length, 3, 'the bad row stands alone')
    assert.deepEqual(weeks[1], { label: 'not-a-date', value: 999 })
    // And the two real days are not merged across it, because they are no
    // longer adjacent — which is honest: the order came from the server.
    assert.equal(weeks[0].value, 10)
    assert.equal(weeks[2].value, 20)
  })

  it('handles an empty series without inventing a week', () => {
    assert.deepEqual(groupPoints([], 'week'), [])
  })
})

describe('weekStart', () => {
  it('reads a date as local midnight, not as UTC', () => {
    // Read as UTC, this is the 31st in any timezone behind UTC, which lands in
    // the week before the one it belongs to.
    assert.equal(weekStart('2026-09-01'), '2026-08-31')
  })

  it('leaves a Monday where it is', () => {
    assert.equal(weekStart('2026-09-07'), '2026-09-07')
  })

  it('refuses a date it cannot read', () => {
    assert.equal(weekStart('2026-13-45'), null)
    assert.equal(weekStart(''), null)
  })
})

describe('writing the reporting window', () => {
  it('says the month once when both ends share it', () => {
    assert.match(readableRange('2026-09-01', '2026-09-19'), /^01 – 19 Sept? 2026$/)
  })

  it('says the year once when both ends share it', () => {
    assert.match(readableRange('2026-08-20', '2026-09-19'), /^20 Aug – 19 Sept? 2026$/)
  })

  it('writes both ends in full across a year boundary', () => {
    assert.match(readableRange('2025-12-20', '2026-01-05'), /^20 Dec 2025 – 05 Jan 2026$/)
  })

  it('writes a single day once, not as a range to itself', () => {
    assert.match(readableRange('2026-09-19', '2026-09-19'), /^19 Sept? 2026$/)
  })

  it('keeps the ISO pair when a date will not parse', () => {
    // Recoverable. A screen quietly showing today instead is not.
    assert.equal(readableRange('nonsense', '2026-09-19'), 'nonsense → 2026-09-19')
  })
})
