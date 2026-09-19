/**
 * One authoritative shape for the purchase being entered, and the arithmetic
 * that previews it.
 *
 * THE ARITHMETIC HERE IS A PREVIEW. The backend recomputes every line amount
 * the same way (qty × rate, less the line discount, rounded to four places)
 * before it sends anything to Books, and Books then applies the tax, any other
 * charges and the rounding that end up on the voucher. The figures below exist
 * so the person typing can see where the bill is going without waiting for a
 * round trip — not so a second set of books can be kept in a browser tab.
 *
 * Everything in `PurchaseForm` maps onto a field the Billing API already
 * accepts. Nothing is held here that has nowhere to be saved.
 */

import type { TaxRate } from './gst'

/**
 * Goods become `inventory_lines` and move stock; services become
 * `service_lines` and do not. That is the backend's own split — it keys off
 * whether a line carries an item id — so this choice is a real one, not a
 * label.
 */
export type PurchaseType = 'goods' | 'services'

export interface PurchaseSupplier {
  id: number
  name: string
  gstin: string | null
}

export interface PurchaseLine {
  /** Local only. Lines are identified by position when they reach the API. */
  key: string
  itemId: number | null
  label: string
  sku: string | null
  hsnSac: string | null
  unitId: number | null
  unitLabel: string | null
  description: string
  qty: string
  rate: string
  /** Set when the user edits a rate the item came with; the backend checks the permission. */
  rateWasChanged: boolean
  discountPc: string
  /** `tax_cat_id` as a string, because it comes off a <select>. '' is "not chosen". */
  taxCatId: string
}

export interface PurchaseForm {
  supplier: PurchaseSupplier | null
  purchaseDate: string
  supplierInvoiceNo: string
  supplierInvoiceDate: string
  dueDate: string
  purchaseType: PurchaseType
  /** Inventory's warehouse id, applied to every goods line. '' = not chosen. */
  warehouseId: string
  paymentTerms: string
  lines: PurchaseLine[]
  paidNow: boolean
  settleAccountId: string
  referenceNo: string
  note: string
}

let lineSequence = 0

export function emptyLine(): PurchaseLine {
  lineSequence += 1
  return {
    key: `line-${lineSequence}-${Math.random().toString(36).slice(2, 8)}`,
    itemId: null,
    label: '',
    sku: null,
    hsnSac: null,
    unitId: null,
    unitLabel: null,
    description: '',
    qty: '1',
    rate: '',
    rateWasChanged: false,
    discountPc: '0',
    taxCatId: '',
  }
}

export function emptyForm(today: string): PurchaseForm {
  return {
    supplier: null,
    purchaseDate: today,
    supplierInvoiceNo: '',
    supplierInvoiceDate: '',
    dueDate: '',
    purchaseType: 'goods',
    warehouseId: '',
    paymentTerms: 'Immediate',
    lines: [emptyLine()],
    paidNow: false,
    settleAccountId: '',
    referenceNo: '',
    note: '',
  }
}

/** A line the user has actually started. Blank trailing rows are not errors. */
export function isLineStarted(line: PurchaseLine): boolean {
  return (
    line.itemId !== null ||
    line.description.trim() !== '' ||
    line.label.trim() !== '' ||
    (line.rate.trim() !== '' && Number(line.rate) !== 0)
  )
}

// ---------------------------------------------------------------------------
// Payment terms
// ---------------------------------------------------------------------------

export interface PaymentTerm {
  value: string
  label: string
  /** Days after the purchase date. Null for Immediate and Custom. */
  days: number | null
}

export const PAYMENT_TERMS: PaymentTerm[] = [
  { value: 'Immediate', label: 'Immediate', days: 0 },
  { value: '7 Days', label: '7 days', days: 7 },
  { value: '15 Days', label: '15 days', days: 15 },
  { value: '30 Days', label: '30 days', days: 30 },
  { value: '45 Days', label: '45 days', days: 45 },
  { value: '60 Days', label: '60 days', days: 60 },
  { value: 'Custom', label: 'Custom', days: null },
]

/** The due date those terms imply, or '' when they imply nothing. */
export function dueDateFor(terms: string, purchaseDate: string): string {
  const term = PAYMENT_TERMS.find((entry) => entry.value === terms)
  if (!term || term.days === null || !purchaseDate) return ''

  const base = new Date(`${purchaseDate}T00:00:00Z`)
  if (Number.isNaN(base.getTime())) return ''

  base.setUTCDate(base.getUTCDate() + term.days)
  return base.toISOString().slice(0, 10)
}

/** Which named term a chosen due date matches, falling back to Custom. */
export function termsForDueDate(dueDate: string, purchaseDate: string): string {
  if (!dueDate || !purchaseDate) return 'Custom'

  for (const term of PAYMENT_TERMS) {
    if (term.days === null) continue
    if (dueDateFor(term.value, purchaseDate) === dueDate) return term.value
  }

  return 'Custom'
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

/** Money, to the paisa. Never a float straight out of a multiplication. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** What the backend does to a line amount before it sends it on. */
function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000
}

function numeric(value: string): number {
  const parsed = Number(String(value).trim())
  return Number.isFinite(parsed) ? parsed : 0
}

export interface LineTotals {
  base: number
  discountAmount: number
  taxable: number
  /** Null when no tax category is chosen, or the master carries no rate for it. */
  taxRate: number | null
  tax: number | null
  total: number
}

export function lineTotals(line: PurchaseLine, rates: Map<number, TaxRate>): LineTotals {
  const base = round4(numeric(line.qty) * numeric(line.rate))
  const discountAmount = round4((base * numeric(line.discountPc)) / 100)
  const taxable = round4(base - discountAmount)

  const chosen = line.taxCatId === '' ? undefined : rates.get(Number(line.taxCatId))
  const taxRate = chosen?.rate ?? null
  const tax = taxRate === null ? null : round2((taxable * taxRate) / 100)

  return {
    base: round2(base),
    discountAmount: round2(discountAmount),
    taxable: round2(taxable),
    taxRate,
    tax,
    total: round2(taxable + (tax ?? 0)),
  }
}

export interface TaxBucket {
  rate: number
  taxable: number
  tax: number
}

export interface PurchaseTotals {
  subtotal: number
  discount: number
  taxable: number
  /**
   * False when at least one started line has no rate this screen can read. The
   * summary then shows the taxable value and says the tax comes from Books,
   * rather than printing a total that is quietly short by one line's GST.
   */
  taxEstimable: boolean
  cgst: number
  sgst: number
  igst: number
  tax: number
  grandTotal: number
  buckets: TaxBucket[]
}

/**
 * The document totals.
 *
 * `treatment` decides only how the one tax figure is PRESENTED — halved into
 * CGST and SGST within a state, whole as IGST across two. It never changes how
 * much tax there is, which is the tax category's business.
 */
export function purchaseTotals(
  lines: PurchaseLine[],
  rates: Map<number, TaxRate>,
  treatment: 'intrastate' | 'interstate' | 'no_gst' | 'unknown',
): PurchaseTotals {
  let subtotal = 0
  let discount = 0
  let taxable = 0
  let tax = 0
  let taxEstimable = true

  const byRate = new Map<number, TaxBucket>()

  for (const line of lines) {
    if (!isLineStarted(line)) continue

    const totals = lineTotals(line, rates)
    subtotal += totals.base
    discount += totals.discountAmount
    taxable += totals.taxable

    if (totals.tax === null || totals.taxRate === null) {
      // A started line with no readable rate. Say so instead of treating it as
      // zero-rated, which would look like a complete total and be wrong.
      if (treatment !== 'no_gst') taxEstimable = false
      continue
    }

    tax += totals.tax

    const bucket = byRate.get(totals.taxRate)
    if (bucket) {
      bucket.taxable = round2(bucket.taxable + totals.taxable)
      bucket.tax = round2(bucket.tax + totals.tax)
    } else {
      byRate.set(totals.taxRate, { rate: totals.taxRate, taxable: totals.taxable, tax: totals.tax })
    }
  }

  subtotal = round2(subtotal)
  discount = round2(discount)
  taxable = round2(taxable)
  tax = treatment === 'no_gst' ? 0 : round2(tax)

  const showTax = taxEstimable && treatment !== 'no_gst'
  const intrastate = treatment === 'intrastate'

  return {
    subtotal,
    discount,
    taxable,
    taxEstimable: showTax,
    cgst: showTax && intrastate ? round2(tax / 2) : 0,
    sgst: showTax && intrastate ? round2(tax - round2(tax / 2)) : 0,
    igst: showTax && treatment === 'interstate' ? tax : 0,
    tax: showTax ? tax : 0,
    grandTotal: round2(taxable + (showTax ? tax : 0)),
    buckets: [...byRate.values()].sort((a, b) => a.rate - b.rate),
  }
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * Today, in the company's own timezone.
 *
 * `new Date().toISOString()` is UTC, and between midnight and 05:30 IST that is
 * yesterday — which on the 1st of April is the previous FINANCIAL YEAR. A shop
 * cashing up late would have its first bill of the year refused by the year
 * check below for no reason a human could work out.
 */
export function todayInTimezone(timezone?: string | null): string {
  const now = new Date()
  if (timezone) {
    try {
      // en-CA formats as YYYY-MM-DD, which is the format the API wants anyway.
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now)
    } catch {
      // An unknown zone in settings is not a reason to fail to open the screen.
    }
  }

  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}
