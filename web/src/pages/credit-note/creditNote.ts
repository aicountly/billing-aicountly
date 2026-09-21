/**
 * The credit note draft, and the rules about it that are not React's business.
 *
 * Kept apart from the components so the validation can be read — and changed —
 * without scrolling through markup, and so the shape that becomes the API body
 * is written down in one place next to the rules that let it be sent.
 *
 * WHAT IS NOT HERE, DELIBERATELY: any tax. Not a rate, not a CGST/SGST split,
 * not a place of supply, not a rounding rule. Smart Books works out the tax on
 * a credit note exactly as it works out the tax on the invoice being credited,
 * and a second tax engine on this side would be a second answer to the one
 * question a credit note must not get wrong. Every figure this file produces is
 * BEFORE TAX and the screen says so wherever it shows one.
 */

import type { CatalogParty, OriginalDocument, OriginalDocumentLine } from '../../services/types'

export type ReturnMode = 'GOODS_RETURN' | 'VALUE_ADJUSTMENT'

/** The longest remark this screen accepts. Books takes the narration as free text. */
export const REMARKS_LIMIT = 500

/**
 * Why the note is being raised.
 *
 * THE CODES ARE THE CONTRACT. These six are what Billing has always sent as
 * `reason_code`, and Books decides what each one means in the accounts — so
 * the wording here can improve and the codes cannot change without agreeing a
 * new vocabulary with Books first.
 *
 * `mode` is what this reason usually means for stock. It is a PROPOSAL: picking
 * "Rate was wrong" moves the screen to a value adjustment because that is what
 * it nearly always is, and the person can move it straight back.
 */
export const CREDIT_REASONS: ReadonlyArray<{
  value: string
  label: string
  hint: string
  mode: ReturnMode
}> = [
  {
    value: 'goods_returned',
    label: 'Goods came back',
    hint: 'The customer returned the items and they are going back into stock.',
    mode: 'GOODS_RETURN',
  },
  {
    value: 'damaged',
    label: 'Goods were damaged or short',
    hint: 'Short delivery, or the goods arrived damaged.',
    mode: 'GOODS_RETURN',
  },
  {
    value: 'price_adjustment',
    label: 'The rate on the bill was wrong',
    hint: 'The value is being corrected. Nothing comes back.',
    mode: 'VALUE_ADJUSTMENT',
  },
  {
    value: 'discount_agreed',
    label: 'Discount agreed afterwards',
    hint: 'A discount settled after the bill went out.',
    mode: 'VALUE_ADJUSTMENT',
  },
  {
    value: 'cancelled',
    label: 'Order cancelled',
    hint: 'The whole order was called off.',
    mode: 'GOODS_RETURN',
  },
  {
    value: 'other',
    label: 'Something else',
    hint: 'Say what happened in the remarks below.',
    mode: 'GOODS_RETURN',
  },
]

/**
 * The state goods came back in.
 *
 * Billing's own words, recorded on the note and sent on with the line. There
 * is no condition or disposition list in Inventory to read this from yet — see
 * docs/BILLING_API_DEPENDENCIES.md — so the list is short, plain, and honest
 * about being ours.
 */
export const RETURN_CONDITIONS = ['Good', 'Damaged', 'Opened', 'Scrap'] as const

export interface CreditLine {
  key: string
  itemId: number | null
  name: string
  sku: string | null
  hsnSac: string | null
  unitId: number | null
  unitName: string | null
  description: string
  batchNo: string
  batchId: number | null
  /** A warehouse id as a select value, or '' for not chosen. */
  warehouseId: string
  condition: string
  qty: string
  rate: string
  discountPc: string
  taxCatId: string
  /** The GST rate Books had on the invoice line. Shown, never used to compute. */
  taxRate: number | null
  /** What the invoice had on this line, when the note started from one. */
  invoiceQty: number | null
  invoiceLineRef: string | null
  /** False for a service or described charge: creditable, but never stock. */
  stockable: boolean
  /** Set when a rate that came from the invoice is edited. Books checks the permission. */
  rateWasChanged: boolean
}

export interface CreditNoteDraft {
  customer: CatalogParty | null
  date: string
  invoice: OriginalDocument | null
  reasonCode: string
  mode: ReturnMode
  remarks: string
  lines: CreditLine[]
}

export type CreditNoteField = 'customer' | 'date' | 'invoice' | 'reasonCode' | 'remarks' | 'lines'

export type LineField = 'item' | 'qty' | 'rate' | 'discountPc' | 'warehouse'

export interface CreditNoteErrors {
  customer?: string
  date?: string
  invoice?: string
  reasonCode?: string
  remarks?: string
  lines?: string
  /** Line key → the fields on it that are wrong. */
  byLine: Record<string, Partial<Record<LineField, string>>>
}

export interface FinancialYearWindow {
  from: string | null
  to: string | null
  label: string | null
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function newKey(): string {
  return Math.random().toString(36).slice(2, 10)
}

export function emptyLine(): CreditLine {
  return {
    key: newKey(),
    itemId: null,
    name: '',
    sku: null,
    hsnSac: null,
    unitId: null,
    unitName: null,
    description: '',
    batchNo: '',
    batchId: null,
    warehouseId: '',
    condition: '',
    qty: '1',
    rate: '0',
    discountPc: '0',
    taxCatId: '',
    taxRate: null,
    invoiceQty: null,
    invoiceLineRef: null,
    stockable: true,
    rateWasChanged: false,
  }
}

export function emptyDraft(date = today()): CreditNoteDraft {
  return {
    customer: null,
    date,
    invoice: null,
    reasonCode: '',
    mode: 'GOODS_RETURN',
    remarks: '',
    lines: [],
  }
}

/**
 * A line proposed from what was billed on the invoice.
 *
 * The quantity starts at the invoiced quantity because "all of it came back"
 * is the common case and the other cases are one keystroke away. The rate is
 * the invoice's rate and is NOT marked as changed — crediting at the price the
 * customer was charged is the default, not an override.
 */
export function lineFromInvoice(line: OriginalDocumentLine, fallbackWarehouse: string): CreditLine {
  return {
    ...emptyLine(),
    itemId: line.item_id,
    name: line.item_name ?? '',
    sku: line.sku,
    hsnSac: line.hsn_sac,
    unitId: line.unit_id,
    unitName: line.unit_name,
    description: line.item_name ?? '',
    batchNo: line.batch_no ?? '',
    batchId: line.batch_id,
    warehouseId: line.warehouse_id !== null ? String(line.warehouse_id) : fallbackWarehouse,
    condition: line.stockable ? 'Good' : '',
    qty: line.qty !== null ? trimNumber(line.qty) : '1',
    rate: line.rate !== null ? trimNumber(line.rate) : '0',
    discountPc: line.discount_pc !== null ? trimNumber(line.discount_pc) : '0',
    taxCatId: line.tax_cat_id !== null ? String(line.tax_cat_id) : '',
    taxRate: line.tax_rate,
    invoiceQty: line.qty,
    invoiceLineRef: line.line_ref,
    stockable: line.stockable,
  }
}

/** 5.0000 reads worse than 5, and this text goes straight into an input. */
function trimNumber(value: number): string {
  return String(Number.parseFloat(value.toFixed(4)))
}

/**
 * A number as typed, or null when it is not one.
 *
 * Grouping separators are stripped rather than rejected: somebody who pastes
 * 1,250 from a bill should not be told that what they pasted is invalid.
 */
export function parseNumber(text: string): number | null {
  const cleaned = text.replace(/[\s,]/g, '')
  if (cleaned === '') return null
  const value = Number(cleaned)

  return Number.isFinite(value) ? value : null
}

export function lineAmount(line: CreditLine): number {
  const gross = (parseNumber(line.qty) ?? 0) * (parseNumber(line.rate) ?? 0)
  const discount = (gross * (parseNumber(line.discountPc) ?? 0)) / 100

  return round(gross - discount)
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

export interface CreditNoteTotals {
  /** Quantity × rate, before any discount. */
  subtotal: number
  discount: number
  /** What is being credited, BEFORE tax. Books adds the tax. */
  taxable: number
  lineCount: number
  /** Units going back into stock. Zero on a value adjustment. */
  units: number
}

export function totals(draft: CreditNoteDraft): CreditNoteTotals {
  let subtotal = 0
  let discount = 0
  let units = 0
  let lineCount = 0

  for (const line of draft.lines) {
    if (!isUsable(line)) continue
    lineCount++
    const gross = (parseNumber(line.qty) ?? 0) * (parseNumber(line.rate) ?? 0)
    subtotal += gross
    discount += (gross * (parseNumber(line.discountPc) ?? 0)) / 100
    if (draft.mode === 'GOODS_RETURN' && line.stockable) units += parseNumber(line.qty) ?? 0
  }

  return {
    subtotal: round(subtotal),
    discount: round(discount),
    taxable: round(subtotal - discount),
    lineCount,
    units: round(units),
  }
}

/** A line with nothing on it is a row the user has not filled in yet, not an error. */
export function isUsable(line: CreditLine): boolean {
  return line.itemId !== null || line.description.trim() !== ''
}

export function isBlank(line: CreditLine): boolean {
  return !isUsable(line) && (parseNumber(line.rate) ?? 0) === 0
}

/** Units per warehouse id, for the stock impact panel. Goods return only. */
export function stockByWarehouse(draft: CreditNoteDraft): Array<{ warehouseId: string; units: number }> {
  if (draft.mode !== 'GOODS_RETURN') return []

  const totalsByWarehouse = new Map<string, number>()
  for (const line of draft.lines) {
    if (!isUsable(line) || !line.stockable) continue
    const quantity = parseNumber(line.qty) ?? 0
    if (quantity <= 0) continue
    totalsByWarehouse.set(line.warehouseId, (totalsByWarehouse.get(line.warehouseId) ?? 0) + quantity)
  }

  return [...totalsByWarehouse.entries()].map(([warehouseId, units]) => ({ warehouseId, units: round(units) }))
}

/** The GST rates on the lines, as Books had them on the invoice. Display only. */
export function taxRatesOnLines(draft: CreditNoteDraft): number[] {
  const rates = new Set<number>()
  for (const line of draft.lines) {
    if (isUsable(line) && line.taxRate !== null) rates.add(line.taxRate)
  }

  return [...rates].sort((a, b) => a - b)
}

export interface ValidationContext {
  fy: FinancialYearWindow
  /** True once Inventory has given at least one warehouse to choose from. */
  warehousesAvailable: boolean
  /**
   * True when the invoice list could not be read. The reference then becomes
   * optional rather than a dead end — the note is worth more than the link.
   */
  invoiceListUnavailable: boolean
  mayDiscount: boolean
}

/**
 * Everything that must be true before this can be sent.
 *
 * The messages name the thing to do, not the rule that was broken. The backend
 * checks all of it again, and Smart Books checks what may actually be credited
 * — this is the courtesy that saves a round trip, never the control.
 */
export function validate(draft: CreditNoteDraft, context: ValidationContext): CreditNoteErrors {
  const errors: CreditNoteErrors = { byLine: {} }

  if (!draft.customer) errors.customer = 'Choose the customer this credit note is for.'

  if (!draft.date) {
    errors.date = 'Select the date for this credit note.'
  } else if (context.fy.from && context.fy.to && (draft.date < context.fy.from || draft.date > context.fy.to)) {
    errors.date = `That date is outside ${context.fy.label ?? 'the selected financial year'}. Change the date, or switch the year at the top of the page.`
  }

  if (!draft.invoice && !context.invoiceListUnavailable) {
    errors.invoice = 'Choose the bill this credit note is against.'
  }

  if (!draft.reasonCode) errors.reasonCode = 'Say why this credit note is being raised.'

  if (draft.remarks.length > REMARKS_LIMIT) {
    errors.remarks = `Keep the remarks to ${REMARKS_LIMIT} characters.`
  }

  const usable = draft.lines.filter(isUsable)
  if (usable.length === 0) {
    errors.lines =
      draft.mode === 'GOODS_RETURN'
        ? 'Add at least one item that is coming back.'
        : 'Add at least one line to adjust.'
  }

  for (const line of usable) {
    const problems: Partial<Record<LineField, string>> = {}

    if (line.itemId === null && line.description.trim() === '') {
      problems.item = 'Pick an item, or describe what is being credited.'
    }

    const quantity = parseNumber(line.qty)
    if (quantity === null || quantity <= 0) {
      problems.qty = 'Enter more than zero.'
    } else if (line.invoiceQty !== null && quantity > line.invoiceQty + 0.0001) {
      // The invoice quantity is a ceiling this screen can prove. Books decides
      // what is still eligible after any earlier notes — see the panel note.
      problems.qty = `The bill has ${trimNumber(line.invoiceQty)}${
        line.unitName ? ` ${line.unitName}` : ''
      } on this line. Credit that or less.`
    }

    const rate = parseNumber(line.rate)
    if (rate === null || rate < 0) {
      problems.rate = 'Enter a rate of zero or more.'
    }

    const discount = parseNumber(line.discountPc)
    if (discount === null || discount < 0 || discount > 100) {
      problems.discountPc = 'A discount is between 0 and 100.'
    } else if (discount > 0 && !context.mayDiscount) {
      problems.discountPc = 'Your Billing profile cannot give a discount.'
    }

    if (
      draft.mode === 'GOODS_RETURN' &&
      line.stockable &&
      context.warehousesAvailable &&
      line.warehouseId === ''
    ) {
      problems.warehouse = 'Say which warehouse it goes back into.'
    }

    if (Object.keys(problems).length > 0) errors.byLine[line.key] = problems
  }

  return errors
}

export function hasErrors(errors: CreditNoteErrors): boolean {
  return (
    errors.customer !== undefined ||
    errors.date !== undefined ||
    errors.invoice !== undefined ||
    errors.reasonCode !== undefined ||
    errors.remarks !== undefined ||
    errors.lines !== undefined ||
    Object.keys(errors.byLine).length > 0
  )
}

export function firstError(errors: CreditNoteErrors): CreditNoteField | null {
  const order: CreditNoteField[] = ['customer', 'invoice', 'reasonCode', 'date', 'lines', 'remarks']

  return order.find((field) => errors[field] !== undefined) ?? (Object.keys(errors.byLine).length > 0 ? 'lines' : null)
}

/**
 * Things worth saying out loud before the note is issued.
 *
 * Warnings, never blocks: every one of them is a real thing that legitimately
 * happens, and a screen that refuses them is a screen somebody works around.
 * Nothing here is invented — each check names the reading it is made from, and
 * a check whose reading is unavailable simply does not appear.
 */
export function warnings(draft: CreditNoteDraft, amounts: CreditNoteTotals): string[] {
  const notes: string[] = []
  const invoice = draft.invoice

  if (invoice?.amount != null && amounts.taxable > invoice.amount + 0.005) {
    notes.push(
      `This credits more than the bill is worth before tax. ${
        invoice.document_no ?? 'The bill'
      } is ${inr(invoice.amount)}. Smart Books may refuse it.`,
    )
  }

  if (invoice?.outstanding != null && invoice.outstanding <= 0.005) {
    notes.push(
      `${
        invoice.document_no ?? 'That bill'
      } is already settled in full, so this credit will sit on the customer's account rather than reduce what they owe.`,
    )
  } else if (invoice?.outstanding != null && amounts.taxable > invoice.outstanding + 0.005) {
    notes.push(
      `The credit is more than the ${inr(invoice.outstanding)} still unpaid on ${
        invoice.document_no ?? 'that bill'
      }. The difference stays on the customer's account.`,
    )
  }

  if (draft.mode === 'GOODS_RETURN' && amounts.units === 0 && amounts.lineCount > 0) {
    notes.push('Nothing on this note is stock coming back. If no goods returned, switch it to a value adjustment.')
  }

  return notes
}

/** Local to this file so a warning string never depends on the ui module. */
function inr(value: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value)
}

/**
 * The body `POST v1/transactions/credit_note` expects.
 *
 * Every key is one TransactionService already reads. The company, branch and
 * year are NOT set here — the API client puts the current scope on every call,
 * which is the only way a form that was open while somebody switched company
 * cannot post into the old one.
 *
 * THE VALUE ADJUSTMENT IS THE CAREFUL PART. A value-only note sends its lines
 * WITHOUT an item id, so the server files them as described charges and
 * nothing downstream can read them as goods coming back. The item's name is
 * kept in the description, which is what the old screen did and the reason it
 * did it — this version keeps the detail per line instead of collapsing the
 * whole note into one figure.
 */
export function toCreditNoteRequest(draft: CreditNoteDraft): Record<string, unknown> {
  const goodsReturn = draft.mode === 'GOODS_RETURN'

  return {
    party_account_id: draft.customer?.acc_id,
    date: draft.date,
    narration: draft.remarks.trim() || undefined,
    against_voucher_id: draft.invoice?.voucher_id ?? undefined,
    against_voucher_no: draft.invoice?.document_no ?? undefined,
    reason_code: draft.reasonCode,
    value_adjustment_only: !goodsReturn,
    lines: draft.lines.filter(isUsable).map((line) => ({
      item_id: goodsReturn ? line.itemId : null,
      unit_id: goodsReturn ? line.unitId : null,
      description: line.description.trim() || line.name || undefined,
      qty: parseNumber(line.qty) ?? 0,
      rate: parseNumber(line.rate) ?? 0,
      discount_pc: parseNumber(line.discountPc) ?? 0,
      rate_was_changed: line.rateWasChanged,
      tax_cat_id: line.taxCatId ? Number(line.taxCatId) : undefined,
      hsn_sac: line.hsnSac ?? undefined,
      warehouse_id: goodsReturn && line.warehouseId ? Number(line.warehouseId) : undefined,
      batch_id: goodsReturn && line.batchId !== null ? line.batchId : undefined,
      batch_no: goodsReturn && line.batchNo.trim() ? line.batchNo.trim() : undefined,
      return_condition: goodsReturn && line.condition ? line.condition : undefined,
      against_line_ref: line.invoiceLineRef ?? undefined,
    })),
  }
}

// ---------------------------------------------------------------------------
// The draft somebody left half typed
// ---------------------------------------------------------------------------

/**
 * Save draft keeps the note ON THIS DEVICE, and says so on the screen.
 *
 * There is no draft endpoint: Billing's `billing_transaction_requests` row is
 * created at the moment the note is sent to Books, and inventing a second
 * half-written-documents table here would be exactly the duplication this
 * product exists to avoid. What this does solve is the real complaint — a
 * twelve-line return, a phone call, a closed tab — and for that a browser
 * draft is enough, as long as nobody is told it is more than that.
 */
const DRAFT_KEY = 'billing:credit-note:draft'

export interface StoredDraft {
  savedAt: string
  draft: CreditNoteDraft
}

function draftKey(cmpId: number, fyId: number): string {
  return `${DRAFT_KEY}:${cmpId}:${fyId}`
}

export function saveDraft(cmpId: number, fyId: number, draft: CreditNoteDraft): boolean {
  try {
    const stored: StoredDraft = { savedAt: new Date().toISOString(), draft }
    window.localStorage.setItem(draftKey(cmpId, fyId), JSON.stringify(stored))
    return true
  } catch {
    // A private window, or storage the browser refuses. The note is still on
    // screen and can still be issued; only the safety net is missing.
    return false
  }
}

export function readDraft(cmpId: number, fyId: number): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(cmpId, fyId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredDraft>
    if (!parsed.draft || !Array.isArray(parsed.draft.lines)) return null

    // Re-key the lines. A key from a previous visit is fine, but a draft
    // written by an older version of this screen may have none at all.
    return {
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
      draft: {
        ...emptyDraft(),
        ...parsed.draft,
        lines: parsed.draft.lines.map((line) => ({ ...emptyLine(), ...line, key: line.key || newKey() })),
      },
    }
  } catch {
    return null
  }
}

export function clearDraft(cmpId: number, fyId: number): void {
  try {
    window.localStorage.removeItem(draftKey(cmpId, fyId))
  } catch {
    /* nothing to clear if storage is refused */
  }
}

/** True once there is anything in the note worth warning somebody about losing. */
export function isDirty(draft: CreditNoteDraft): boolean {
  return (
    draft.customer !== null ||
    draft.invoice !== null ||
    draft.reasonCode !== '' ||
    draft.remarks.trim() !== '' ||
    draft.lines.some(isUsable)
  )
}
