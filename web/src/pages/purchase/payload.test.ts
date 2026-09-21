/**
 * What actually reaches POST /v1/transactions/purchase.
 *
 *   node --test --experimental-strip-types src/pages/purchase/
 *
 * This is the boundary where the screen's vocabulary becomes the API's, so the
 * tests are about the contract rather than the arithmetic: that every field the
 * backend reads is sent, that nothing it does NOT read is sent (a key the
 * server ignores is a promise to the user that it was saved), and that a
 * services purchase cannot be mistaken downstream for stock arriving.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { emptyForm, emptyLine, type PurchaseForm, type PurchaseLine } from './model.ts'
import { toPurchasePayload } from './payload.ts'

const line = (over: Partial<PurchaseLine> = {}): PurchaseLine => ({ ...emptyLine(), ...over })

const form = (over: Partial<PurchaseForm> = {}): PurchaseForm => ({
  ...emptyForm('2026-09-21'),
  supplier: { id: 501, name: 'Sharma Paper Mart', gstin: '27AAECS1234F1Z2' },
  supplierInvoiceNo: 'INV-001',
  supplierInvoiceDate: '2026-09-17',
  dueDate: '2026-10-21',
  paymentTerms: '30 Days',
  warehouseId: '3',
  note: 'delivered short',
  lines: [
    line({ itemId: 11, unitId: 4, hsnSac: '4802', qty: '10', rate: '200', discountPc: '5', taxCatId: '4', rateWasChanged: true }),
    line(),
  ],
  ...over,
})

describe('a goods purchase', () => {
  const body = toPurchasePayload(form())

  it('sends only the lines somebody started', () => {
    assert.equal(body.lines.length, 1)
  })

  it('carries every line field the backend reads', () => {
    assert.deepEqual(body.lines[0], {
      item_id: 11,
      unit_id: 4,
      warehouse_id: 3,
      description: undefined,
      qty: 10,
      rate: 200,
      discount_pc: 5,
      tax_cat_id: 4,
      hsn_sac: '4802',
      rate_was_changed: true,
    })
  })

  it('carries the document fields the old screen never sent', () => {
    assert.equal(body.supplier_invoice_no, 'INV-001')
    assert.equal(body.supplier_invoice_date, '2026-09-17')
    assert.equal(body.payment_terms, '30 Days')
    assert.equal(body.due_date, '2026-10-21')
    assert.equal(body.narration, 'delivered short')
    assert.equal(body.party_account_id, 501)
  })

  it('sends no total of its own', () => {
    // Books works out the tax and the rounding. A total sent from here would be
    // a second opinion the server has no reason to trust and no field to hold.
    assert.deepEqual(
      Object.keys(body).filter((key) => /total|grand|tax_amount|cgst|sgst|igst/.test(key)),
      [],
    )
  })

  it('flags an overridden rate, because the backend checks the permission on it', () => {
    assert.equal(body.lines[0].rate_was_changed, true)
    assert.equal(toPurchasePayload(form({ lines: [line({ itemId: 11, qty: '1', rate: '5' })] })).lines[0].rate_was_changed, false)
  })
})

describe('paying for it now, or not', () => {
  it('sends the settlement account and the reference only when it is paid', () => {
    const paid = toPurchasePayload(form({ paidNow: true, settleAccountId: '41', referenceNo: 'UTR9911' }))

    assert.equal(paid.settled_to_account_id, 41)
    assert.equal(paid.reference_no, 'UTR9911')
  })

  it('sends neither on a credit purchase, so nothing reads as settled', () => {
    const credit = toPurchasePayload(form({ referenceNo: 'UTR9911' }))

    assert.equal(credit.settled_to_account_id, undefined)
    assert.equal(credit.reference_no, undefined)
  })
})

describe('a services purchase', () => {
  const body = toPurchasePayload(
    form({
      purchaseType: 'services',
      lines: [line({ itemId: 11, label: 'Annual audit fee', qty: '1', rate: '25000', taxCatId: '4' })],
    }),
  )

  it('strips the item, so the backend files it as a service line', () => {
    assert.equal(body.lines[0].item_id, null)
    assert.equal(body.lines[0].unit_id, null)
  })

  it('sends no warehouse, so nothing downstream reads it as stock arriving', () => {
    assert.equal('warehouse_id' in body.lines[0], false)
  })

  it('falls back to the item name for the description the backend requires', () => {
    assert.equal(body.lines[0].description, 'Annual audit fee')
  })
})

describe('refusing to build a purchase that cannot exist', () => {
  it('throws rather than posting one with no supplier', () => {
    assert.throws(() => toPurchasePayload(form({ supplier: null })), /supplier/i)
  })

  it('leaves an empty optional out rather than sending a blank string', () => {
    const bare = toPurchasePayload(form({ supplierInvoiceNo: '   ', note: '', supplierInvoiceDate: '' }))

    assert.equal(bare.supplier_invoice_no, undefined)
    assert.equal(bare.narration, undefined)
    assert.equal(bare.supplier_invoice_date, undefined)
  })
})
