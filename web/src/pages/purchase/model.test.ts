/**
 * The arithmetic and the dates behind Purchases → New purchase.
 *
 *   node --test --experimental-strip-types src/pages/purchase/
 *
 * Or `npm test`. These figures are a PREVIEW — Books applies the real tax and
 * the rounding when it posts — but the subtotal, the discount and the taxable
 * value are the exact numbers the backend recomputes, so a mistake here is a
 * mistake the user watches happen and then sees contradicted on the voucher.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TaxRate } from './gst.ts'
import {
  dueDateFor,
  emptyForm,
  emptyLine,
  isLineStarted,
  purchaseTotals,
  termsForDueDate,
  todayInTimezone,
  type PurchaseLine,
} from './model.ts'

const RATES = new Map<number, TaxRate>([
  [4, { id: 4, name: 'GST 18%', rate: 18 }],
  [2, { id: 2, name: 'GST 5%', rate: 5 }],
  [9, { id: 9, name: 'Unpriced', rate: null }],
])

const line = (over: Partial<PurchaseLine> = {}): PurchaseLine => ({ ...emptyLine(), ...over })

describe('adding a purchase up', () => {
  const goods = [
    line({ itemId: 1, qty: '10', rate: '200', discountPc: '0', taxCatId: '4' }),
    line({ itemId: 2, qty: '4', rate: '50', discountPc: '10', taxCatId: '2' }),
    line(), // the blank row that is always left ready
  ]

  it('counts the started lines and ignores the blank one', () => {
    const totals = purchaseTotals(goods, RATES, 'intrastate')

    assert.equal(totals.subtotal, 2200)
    assert.equal(totals.discount, 20)
    assert.equal(totals.taxable, 2180)
    assert.equal(totals.grandTotal, 2549)
  })

  it('splits within a state without losing a paisa', () => {
    // 5% of 0.55 is 0.0275. Halved naively that is 0.01375 twice, and two
    // rounded halves come to 0.02 against a tax of 0.03 — a rupee a day in a
    // shop that bills all day, and it is the total on screen that is wrong.
    const totals = purchaseTotals([line({ itemId: 1, qty: '1', rate: '0.55', taxCatId: '2' })], RATES, 'intrastate')

    assert.equal(Number((totals.cgst + totals.sgst).toFixed(2)), totals.tax)
  })

  it('puts the whole tax on IGST across two states, and nothing on CGST', () => {
    const totals = purchaseTotals(goods, RATES, 'interstate')

    assert.equal(totals.igst, 369)
    assert.equal(totals.cgst, 0)
    assert.equal(totals.sgst, 0)
  })

  it('refuses to estimate when a started line has no readable rate', () => {
    // The dangerous case: treating the rateless line as zero-rated would show a
    // complete-looking total that is short by that line's GST.
    const totals = purchaseTotals(
      [line({ itemId: 1, qty: '1', rate: '100', taxCatId: '4' }), line({ itemId: 2, qty: '1', rate: '100', taxCatId: '' })],
      RATES,
      'intrastate',
    )

    assert.equal(totals.taxEstimable, false)
    assert.equal(totals.grandTotal, 200, 'falls back to the taxable value rather than a wrong total')
  })

  it('shows no tax at all for a business that is not registered', () => {
    assert.equal(purchaseTotals(goods, RATES, 'no_gst').tax, 0)
  })

  it('never produces NaN from what somebody typed', () => {
    const totals = purchaseTotals([line({ itemId: 1, qty: 'abc', rate: '--' })], RATES, 'intrastate')

    assert.equal(totals.grandTotal, 0)
    assert.ok(Number.isFinite(totals.taxable))
  })

  it('buckets the bill by rate, in order', () => {
    assert.deepEqual(
      purchaseTotals(goods, RATES, 'intrastate').buckets.map((bucket) => bucket.rate),
      [5, 18],
    )
  })
})

describe('what counts as a line somebody started', () => {
  it('ignores an untouched row', () => {
    assert.equal(isLineStarted(emptyLine()), false)
  })

  it('counts a row with only a description, which is what a service is', () => {
    assert.equal(isLineStarted(line({ description: 'Annual audit fee' })), true)
  })

  it('counts a row with a rate typed but no item yet', () => {
    assert.equal(isLineStarted(line({ rate: '250' })), true)
  })
})

describe('payment terms and the due date they imply', () => {
  it('counts the days forward', () => {
    assert.equal(dueDateFor('30 Days', '2026-09-19'), '2026-10-19')
  })

  it('crosses a year end', () => {
    assert.equal(dueDateFor('45 Days', '2026-12-01'), '2027-01-15')
  })

  it('makes Immediate the same day, and Custom no day at all', () => {
    assert.equal(dueDateFor('Immediate', '2026-09-19'), '2026-09-19')
    assert.equal(dueDateFor('Custom', '2026-09-19'), '')
  })

  it('reads the terms back off a date, and calls anything else Custom', () => {
    assert.equal(termsForDueDate('2026-10-19', '2026-09-19'), '30 Days')
    assert.equal(termsForDueDate('2026-10-20', '2026-09-19'), 'Custom')
  })
})

describe("the company's own today", () => {
  it('answers in the company timezone', () => {
    assert.match(todayInTimezone('Asia/Kolkata'), /^\d{4}-\d{2}-\d{2}$/)
  })

  it('still answers when the stored timezone is nonsense', () => {
    // A bad zone in settings must not be the reason a screen fails to open.
    assert.match(todayInTimezone('Not/AZone'), /^\d{4}-\d{2}-\d{2}$/)
  })

  it('opens a blank purchase on that day', () => {
    assert.equal(emptyForm('2026-09-21').purchaseDate, '2026-09-21')
  })
})
