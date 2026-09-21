/**
 * The GST facts this screen works out for itself.
 *
 *   node --test --experimental-strip-types src/pages/purchase/
 *
 * Smart Books remains the tax authority. What is tested here is the PREVIEW
 * that decides whether a bill shows CGST + SGST or IGST, and what happens when
 * the facts to decide it are not there — because the failure that matters is
 * not an arithmetic slip, it is guessing a split confidently and being wrong.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { GST_STATES, parseTaxRates, resolveGstMode, stateFromGstin } from './gst.ts'

describe('reading a state out of a GSTIN', () => {
  it('takes the state from the first two digits, as the Act puts it there', () => {
    assert.equal(stateFromGstin('27AAECS1234F1Z2')?.label, 'Maharashtra (27)')
    assert.equal(stateFromGstin('07AABCD5678G1Z9')?.label, 'Delhi (07)')
  })

  it('answers nothing for a GSTIN it cannot read, rather than a wrong state', () => {
    assert.equal(stateFromGstin('ZZ123'), null)
    assert.equal(stateFromGstin(''), null)
    assert.equal(stateFromGstin(null), null)
    assert.equal(stateFromGstin('88XXXXX'), null, 'an unassigned code is not a state')
  })

  it('carries the codes a GSTIN can actually start with', () => {
    for (const code of ['01', '09', '24', '27', '29', '33', '37']) {
      assert.ok(GST_STATES[code], `${code} is a real GST state code`)
    }
  })
})

describe('which way the tax splits', () => {
  const both = { gstRegistered: true, supplierChosen: true }

  it('splits into CGST and SGST inside one state', () => {
    const mode = resolveGstMode({ ...both, companyGstin: '27A', supplierGstin: '27B' })

    assert.equal(mode.treatment, 'intrastate')
    assert.match(mode.splitLabel, /CGST \+ SGST/)
  })

  it('is IGST across two', () => {
    assert.equal(resolveGstMode({ ...both, companyGstin: '27A', supplierGstin: '07B' }).treatment, 'interstate')
  })

  it('shows no GST at all for a business that is not registered', () => {
    const mode = resolveGstMode({ ...both, gstRegistered: false, companyGstin: '27A', supplierGstin: '27B' })

    assert.equal(mode.treatment, 'no_gst')
  })

  it('says it does not know rather than guessing, when a GSTIN is missing', () => {
    const noSupplier = resolveGstMode({ ...both, companyGstin: '27A', supplierGstin: null })
    const noCompany = resolveGstMode({ ...both, companyGstin: null, supplierGstin: '27B' })

    assert.equal(noSupplier.treatment, 'unknown')
    assert.equal(noCompany.treatment, 'unknown')
  })

  it('gives a different reason before a supplier is chosen than after', () => {
    // "This supplier has no GSTIN" about a supplier nobody has picked yet is a
    // sentence that sends somebody looking at the wrong record.
    const before = resolveGstMode({ gstRegistered: true, supplierChosen: false, companyGstin: '27A', supplierGstin: null })
    const after = resolveGstMode({ gstRegistered: true, supplierChosen: true, companyGstin: '27A', supplierGstin: null })

    assert.notEqual(before.reason, after.reason)
    assert.match(before.reason, /Choose the supplier/)
  })
})

describe("reading Books' tax master, however it is spelled", () => {
  const parsed = parseTaxRates([
    { tax_cat_id: 4, tax_cat_name: 'GST 18%' },              // rate only in the name
    { tax_cat_id: 5, tax_cat_name: 'IGST', tax_rate: 12 },   // the usual column
    { id: 7, name: 'Split', cgst_rate: 6, sgst_rate: 6 },    // halves, no total
    { tax_cat_id: 8, name: 'Special', rate: '12.5' },        // a string
    { tax_cat_id: 9, name: 'Unknown scheme' },               // nothing to read
    { name: 'no id at all', rate: 5 },                       // unusable, dropped
  ])

  it('drops only the row with no id', () => {
    assert.equal(parsed.length, 5)
  })

  it('finds the rate wherever the deployment put it', () => {
    assert.equal(parsed.find((rate) => rate.id === 4)?.rate, 18, 'out of the name')
    assert.equal(parsed.find((rate) => rate.id === 5)?.rate, 12, 'out of tax_rate')
    assert.equal(parsed.find((rate) => rate.id === 7)?.rate, 12, 'summed from the halves')
    assert.equal(parsed.find((rate) => rate.id === 8)?.rate, 12.5, 'parsed from a string')
  })

  it('leaves a rate it cannot read as null rather than inventing 18%', () => {
    // A null here is what makes the summary say the tax is not previewed. An
    // assumed 18% would be wrong for half the country's goods and look right.
    assert.equal(parsed.find((rate) => rate.id === 9)?.rate, null)
  })

  it('sorts by rate, so the list reads the way the rates are spoken', () => {
    const rated = parsed.filter((rate) => rate.rate !== null).map((rate) => rate.rate)
    assert.deepEqual(rated, [...rated].sort((a, b) => (a ?? 0) - (b ?? 0)))
  })

  it('returns nothing for a master that did not answer with a list', () => {
    assert.deepEqual(parseTaxRates(null), [])
    assert.deepEqual(parseTaxRates({ data: 'nope' }), [])
  })
})
