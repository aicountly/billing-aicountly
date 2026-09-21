/**
 * The sales bill draft, its arithmetic and its validation.
 *
 * WHAT THIS FILE MAY AND MAY NOT DECIDE.
 *
 * It may add up what the user typed: quantity times rate, less a discount, per
 * line and for the document. Those are the commercial facts Billing agreed with
 * the customer, and the screen has to show them as they are typed or the
 * shopkeeper is billing blind.
 *
 * It may NOT decide the tax. Smart Books owns GST — the rate that applies, the
 * credit, the rounding and the figure that goes on the invoice — and
 * `TransactionService` deliberately sends it no tax amounts. What `estimate()`
 * below produces is a PREVIEW, built out of the tax categories Books itself
 * returned for this company and the two state codes on the document, and it is
 * labelled as one everywhere it is shown. It is never sent anywhere, never
 * stored, and when the rates cannot be read it is simply absent rather than
 * guessed. See docs/ARCHITECTURE.md.
 *
 * Money is added up in paise. 0.1 + 0.2 is not 0.3 in a double, and a bill that
 * is one paisa out is a bill somebody has to explain.
 */

import type { CatalogItem, CatalogParty } from '../../services/types'

/** An Inventory item as it actually arrives — the typed fields, plus whatever else. */
export type ItemRow = CatalogItem & Record<string, unknown>

export interface SaleLine {
  key: string
  itemId: number | null
  /** The item's name, as Inventory gave it. Shown, never sent as the item. */
  label: string
  sku: string | null
  hsn: string | null
  unitId: number | null
  /** Inventory's own name for the unit. '' when it did not send one. */
  unitLabel: string
  description: string
  qty: string
  rate: string
  /** Set when the rate the item came with is edited; the backend checks the permission. */
  rateWasChanged: boolean
  discountPc: string
  /** A Books tax category id, as a string for the <select>. */
  taxCategoryId: string
}

export interface SaleDraft {
  party: CatalogParty | null
  billDate: string
  dueDate: string
  /** A GST state code ('27'), or '' when not set. 'OS' for a place outside India. */
  placeOfSupply: string
  lines: SaleLine[]
  paidNow: boolean
  settleAccountId: string
  paymentMode: PaymentMode
  note: string
  terms: string
}

export const PAYMENT_MODES = ['cash', 'upi', 'bank_transfer', 'card', 'other'] as const
export type PaymentMode = (typeof PAYMENT_MODES)[number]

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  cash: 'Cash',
  upi: 'UPI',
  bank_transfer: 'Bank transfer',
  card: 'Card',
  other: 'Other',
}

export const NOTE_LIMIT = 500

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function newKey(): string {
  return Math.random().toString(36).slice(2)
}

export function emptyLine(): SaleLine {
  return {
    key: newKey(),
    itemId: null,
    label: '',
    sku: null,
    hsn: null,
    unitId: null,
    unitLabel: '',
    description: '',
    qty: '1',
    rate: '',
    rateWasChanged: false,
    discountPc: '',
    taxCategoryId: '',
  }
}

export function emptyDraft(): SaleDraft {
  const date = today()

  return {
    party: null,
    billDate: date,
    dueDate: '',
    placeOfSupply: '',
    lines: [emptyLine()],
    paidNow: false,
    settleAccountId: '',
    paymentMode: 'cash',
    note: '',
    terms: '',
  }
}

/** True when the line carries anything worth sending. */
export function lineHasContent(line: SaleLine): boolean {
  return line.itemId !== null || line.description.trim() !== ''
}

export function usableLines(draft: SaleDraft): SaleLine[] {
  return draft.lines.filter(lineHasContent)
}

// ---------------------------------------------------------------------------
// Money, in paise
// ---------------------------------------------------------------------------

/**
 * A typed decimal as paise.
 *
 * Parsed from the string the user is actually typing, so "12." and "" are a
 * number in progress rather than an error — validation decides what is
 * acceptable, not this.
 */
export function toPaise(value: string): number {
  const cleaned = value.trim().replace(/,/g, '')
  if (cleaned === '' || cleaned === '.' || cleaned === '-') return 0
  const amount = Number(cleaned)
  if (!Number.isFinite(amount)) return 0

  return Math.round(amount * 100)
}

export function toNumber(value: string): number {
  const cleaned = value.trim().replace(/,/g, '')
  if (cleaned === '') return 0
  const parsed = Number(cleaned)

  return Number.isFinite(parsed) ? parsed : 0
}

export function fromPaise(paise: number): number {
  return paise / 100
}

export interface LineAmounts {
  grossPaise: number
  discountPaise: number
  /** Gross less the discount: what tax would be worked out on. */
  taxablePaise: number
}

/**
 * One line's arithmetic.
 *
 * Quantity is not money and can carry four decimals (Books rounds it there
 * too), so the multiplication is done in rupees and rounded once, at the end,
 * to the paise the amount is actually expressed in.
 */
export function lineAmounts(line: SaleLine): LineAmounts {
  const qty = toNumber(line.qty)
  const ratePaise = toPaise(line.rate)
  const discountPc = toNumber(line.discountPc)

  const grossPaise = Math.round(qty * ratePaise)
  const discountPaise = discountPc > 0 ? Math.round((grossPaise * discountPc) / 100) : 0

  return { grossPaise, discountPaise, taxablePaise: grossPaise - discountPaise }
}

// ---------------------------------------------------------------------------
// GST states
// ---------------------------------------------------------------------------

/**
 * The GST state codes.
 *
 * Statutory, not configuration: these are the codes the GST Act assigns and the
 * first two digits of every GSTIN. Nothing here says which one this company is
 * in — that is read from the company's own GSTIN, and the customer's from
 * theirs.
 */
export const GST_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: '01', name: 'Jammu & Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra & Nagar Haveli and Daman & Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman & Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
  { code: '97', name: 'Other Territory' },
]

/** The code used for a supply outside India. Not a state, which is the point. */
export const OVERSEAS_CODE = 'OS'

export function stateName(code: string): string {
  if (code === OVERSEAS_CODE) return 'Outside India'

  return GST_STATES.find((state) => state.code === code)?.name ?? ''
}

/** The state a GSTIN belongs to — its first two digits, and nothing else. */
export function stateCodeFromGstin(gstin: string | null | undefined): string {
  const trimmed = (gstin ?? '').trim()
  if (trimmed.length < 2) return ''
  const code = trimmed.slice(0, 2)

  return GST_STATES.some((state) => state.code === code) ? code : ''
}

export function isValidGstin(gstin: string | null | undefined): boolean {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/i.test((gstin ?? '').trim())
}

/**
 * What Billing can tell about the customer's GST standing.
 *
 * Derived, never asked: a customer with a GSTIN is registered, a customer
 * without one is not, and a supply outside India is an export. This is a
 * READOUT of the two facts on the document — it is not a tax classification of
 * our own, because Smart Books owns that and a second vocabulary here would be
 * a second opinion about tax.
 */
export type GstTreatment = 'taxable' | 'unregistered' | 'overseas' | 'unknown'

export function gstTreatment(party: CatalogParty | null, placeOfSupply: string): GstTreatment {
  if (placeOfSupply === OVERSEAS_CODE) return 'overseas'
  if (!party) return 'unknown'

  return (party.gstin ?? '').trim() !== '' ? 'taxable' : 'unregistered'
}

/** Same state as the company, different state, outside India, or not yet known. */
export type SupplyKind = 'intra' | 'inter' | 'overseas' | 'unknown'

export function supplyKind(companyStateCode: string, placeOfSupply: string): SupplyKind {
  if (placeOfSupply === OVERSEAS_CODE) return 'overseas'
  if (!companyStateCode || !placeOfSupply) return 'unknown'

  return companyStateCode === placeOfSupply ? 'intra' : 'inter'
}

// ---------------------------------------------------------------------------
// Tax categories, as Books has them configured
// ---------------------------------------------------------------------------

export interface TaxCategory {
  id: number
  name: string
  /** The total GST percentage, when the row carries one. null when it does not. */
  ratePc: number | null
}

function readId(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'number' && Number.isFinite(value) && value !== 0) return value
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) !== 0) {
      return Number(value)
    }
  }

  return null
}

function readText(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }

  return null
}

function readRate(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key]
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : Number.NaN
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }

  return null
}

/**
 * The company's tax categories, normalised.
 *
 * The rate is read from whichever field this deployment's Books uses, and a
 * category whose rate cannot be read keeps `ratePc: null` — which switches the
 * summary's estimate off rather than filling it with a zero. The components
 * (CGST + SGST, or IGST) are summed when only they are present, because that is
 * how several Books configurations express the same 18%.
 */
export function parseTaxCategories(rows: Array<Record<string, unknown>>): TaxCategory[] {
  const out: TaxCategory[] = []

  for (const row of rows) {
    const id = readId(row, ['tax_cat_id', 'tax_category_id', 'taxcat_id', 'id'])
    const name = readText(row, ['tax_cat_name', 'tax_category_name', 'name', 'label', 'description'])
    if (id === null || name === null) continue

    let ratePc = readRate(row, ['total_rate', 'tax_rate', 'rate', 'gst_rate', 'rate_pc', 'tax_pc', 'percentage'])

    if (ratePc === null) {
      const igst = readRate(row, ['igst_rate', 'igst'])
      const cgst = readRate(row, ['cgst_rate', 'cgst'])
      const sgst = readRate(row, ['sgst_rate', 'sgst'])
      if (igst !== null) ratePc = igst
      else if (cgst !== null && sgst !== null) ratePc = cgst + sgst
    }

    // A percentage is not a rupee value; anything absurd is a field we have
    // misread, and a misread rate is worse than no estimate.
    if (ratePc !== null && (ratePc < 0 || ratePc > 100)) ratePc = null

    out.push({ id, name, ratePc })
  }

  return out
}

// ---------------------------------------------------------------------------
// The document total, and the tax preview
// ---------------------------------------------------------------------------

export interface TaxBand {
  /** The total GST percentage this band was worked out at. */
  ratePc: number
  taxablePaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
}

export interface TaxEstimate {
  bands: TaxBand[]
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  totalPaise: number
}

export interface SaleTotals {
  /** Before any discount. */
  subtotalPaise: number
  discountPaise: number
  taxablePaise: number
  /**
   * The GST preview, or null when it cannot honestly be drawn — no rates
   * configured, a line with no tax category, or a place of supply that has not
   * been chosen yet. Never a zero standing in for "we do not know".
   */
  tax: TaxEstimate | null
  /** Why the preview is absent, for the panel to say so. null when it is present. */
  taxUnavailable: string | null
  roundOffPaise: number
  /** Taxable value when there is no preview; taxable + GST, rounded, when there is. */
  grandTotalPaise: number
}

const HALF_UP = (value: number): number => Math.round(value)

export function summarise(
  draft: SaleDraft,
  taxCategories: TaxCategory[],
  supply: SupplyKind,
  taxCategoriesLoaded: boolean,
): SaleTotals {
  const lines = usableLines(draft)

  let subtotalPaise = 0
  let discountPaise = 0
  const byRate = new Map<number, number>()
  let missingRate = false

  for (const line of lines) {
    const amounts = lineAmounts(line)
    subtotalPaise += amounts.grossPaise
    discountPaise += amounts.discountPaise

    const category = taxCategories.find((row) => String(row.id) === line.taxCategoryId)
    if (!category || category.ratePc === null) {
      missingRate = true
      continue
    }
    byRate.set(category.ratePc, (byRate.get(category.ratePc) ?? 0) + amounts.taxablePaise)
  }

  const taxablePaise = subtotalPaise - discountPaise

  const reason = ((): string | null => {
    if (lines.length === 0) return null
    if (!taxCategoriesLoaded) return 'Reading this company’s GST rates from Smart Books…'
    if (taxCategories.length === 0) {
      return 'No GST rates are configured for this company in Smart Books, so nothing can be estimated here.'
    }
    if (supply === 'overseas') {
      return 'This is a supply outside India. Smart Books decides how it is taxed.'
    }
    if (supply === 'unknown') return 'Choose the place of supply and the GST estimate appears here.'
    if (missingRate) return 'Give every line a tax to see the GST estimate.'

    return null
  })()

  let tax: TaxEstimate | null = null

  if (reason === null && byRate.size > 0 && (supply === 'intra' || supply === 'inter')) {
    const bands: TaxBand[] = []
    let cgstPaise = 0
    let sgstPaise = 0
    let igstPaise = 0

    for (const [ratePc, bandTaxable] of [...byRate.entries()].sort((a, b) => a[0] - b[0])) {
      const total = HALF_UP((bandTaxable * ratePc) / 100)
      // The halves are worked out from the whole, and the second half is the
      // remainder — so CGST + SGST is always exactly the total, with no stray
      // paisa when the rate is an odd percentage.
      const half = supply === 'intra' ? HALF_UP(total / 2) : 0
      const band: TaxBand = {
        ratePc,
        taxablePaise: bandTaxable,
        cgstPaise: supply === 'intra' ? half : 0,
        sgstPaise: supply === 'intra' ? total - half : 0,
        igstPaise: supply === 'inter' ? total : 0,
      }
      cgstPaise += band.cgstPaise
      sgstPaise += band.sgstPaise
      igstPaise += band.igstPaise
      bands.push(band)
    }

    tax = { bands, cgstPaise, sgstPaise, igstPaise, totalPaise: cgstPaise + sgstPaise + igstPaise }
  }

  const beforeRounding = taxablePaise + (tax?.totalPaise ?? 0)
  // Only rounded when there is something to round to a rupee — a figure before
  // tax is not the figure the customer pays, so it is left exactly as typed.
  const rounded = tax ? Math.round(beforeRounding / 100) * 100 : beforeRounding

  return {
    subtotalPaise,
    discountPaise,
    taxablePaise,
    tax,
    taxUnavailable: reason,
    roundOffPaise: rounded - beforeRounding,
    grandTotalPaise: rounded,
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type SaleField = 'party' | 'billDate' | 'dueDate' | 'placeOfSupply' | 'lines' | 'settleAccountId'

export type SaleErrors = Partial<Record<SaleField, string>> & {
  /** Keyed by line key, so the message sits on the row it belongs to. */
  line?: Record<string, string>
}

export interface FinancialYearWindow {
  from: string | null
  to: string | null
  label: string | null
}

/**
 * Everything that must be true before this bill can be sent.
 *
 * The messages name the thing to do rather than the rule that was broken. The
 * backend checks all of it again — this is the courtesy that saves a round
 * trip, never the control.
 */
export function validate(
  draft: SaleDraft,
  fy: FinancialYearWindow,
  options: { gstRegistered: boolean; requiresSettlementAccount: boolean },
): SaleErrors {
  const errors: SaleErrors = {}
  const lineErrors: Record<string, string> = {}

  if (!draft.party) errors.party = 'Choose the customer this bill is for.'

  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.billDate)) {
    errors.billDate = 'Give the bill a date.'
  } else if (fy.from && fy.to && (draft.billDate < fy.from || draft.billDate > fy.to)) {
    errors.billDate = `That date is outside ${fy.label ?? 'the financial year you are in'}.`
  }

  if (draft.dueDate !== '' && draft.dueDate < draft.billDate) {
    errors.dueDate = 'The due date cannot be before the bill date.'
  }

  if (options.gstRegistered && draft.placeOfSupply === '') {
    errors.placeOfSupply = 'Say where this is supplied — it decides CGST/SGST or IGST.'
  }

  const lines = usableLines(draft)
  if (lines.length === 0) {
    errors.lines = 'Add at least one item.'
  }

  for (const line of lines) {
    const qty = toNumber(line.qty)
    const rate = toPaise(line.rate)
    const discount = toNumber(line.discountPc)

    if (qty <= 0) {
      lineErrors[line.key] = 'Quantity must be more than zero.'
    } else if (rate < 0) {
      lineErrors[line.key] = 'A rate cannot be negative.'
    } else if (discount < 0 || discount > 100) {
      lineErrors[line.key] = 'A discount is between 0 and 100 per cent.'
    } else if (line.itemId === null && line.description.trim() === '') {
      lineErrors[line.key] = 'A line without an item needs a description.'
    }
  }

  if (Object.keys(lineErrors).length > 0) {
    errors.line = lineErrors
    errors.lines ??= 'Some lines still need attention.'
  }

  if (draft.paidNow && options.requiresSettlementAccount && draft.settleAccountId === '') {
    errors.settleAccountId = 'Say where the money was received.'
  }

  return errors
}

export function hasErrors(errors: SaleErrors): boolean {
  return Object.keys(errors).length > 0
}

/** The first thing to fix, for the message above the action bar. */
export function firstError(errors: SaleErrors): string | null {
  const order: SaleField[] = ['party', 'billDate', 'dueDate', 'placeOfSupply', 'lines', 'settleAccountId']
  for (const field of order) {
    const message = errors[field]
    if (message) return message
  }

  return null
}

// ---------------------------------------------------------------------------
// What gets sent
// ---------------------------------------------------------------------------

/**
 * The draft as `POST v1/transactions/sale` takes it.
 *
 * NO TOTAL AND NO TAX AMOUNT LEAVES THIS FUNCTION. The lines carry what was
 * agreed — quantity, rate, discount, and which tax category Books should apply
 * — and Books works out the rest. The place of supply is a fact about the
 * document, not a computation, and is passed through for Books to use.
 */
export function toSaleRequest(draft: SaleDraft): Record<string, unknown> {
  return {
    party_account_id: draft.party?.acc_id,
    date: draft.billDate,
    due_date: draft.dueDate || undefined,
    place_of_supply: draft.placeOfSupply || undefined,
    narration: draft.note.trim() || undefined,
    terms: draft.terms.trim() || undefined,
    settled_to_account_id:
      draft.paidNow && draft.settleAccountId ? Number(draft.settleAccountId) : undefined,
    payment_mode: draft.paidNow ? draft.paymentMode : undefined,
    lines: usableLines(draft).map((line) => ({
      item_id: line.itemId,
      unit_id: line.unitId,
      description: line.description.trim() || line.label || undefined,
      hsn_sac: line.hsn || undefined,
      qty: toNumber(line.qty),
      rate: fromPaise(toPaise(line.rate)),
      discount_pc: toNumber(line.discountPc),
      tax_cat_id: line.taxCategoryId ? Number(line.taxCategoryId) : undefined,
      rate_was_changed: line.rateWasChanged,
    })),
  }
}

// ---------------------------------------------------------------------------
// Item rows, read defensively
// ---------------------------------------------------------------------------

export function itemUnitLabel(row: ItemRow): string {
  return readText(row, ['unit_name', 'uom_name', 'uom', 'unit', 'unit_symbol', 'unit_code']) ?? ''
}

export function itemHsn(row: ItemRow): string | null {
  return row.hsn_sac ?? readText(row, ['hsn_sac', 'hsn', 'sac', 'hsn_code'])
}

export function itemRate(row: ItemRow): string {
  const rate = readRate(row, ['sale_rate', 'selling_rate', 'sales_rate', 'rate', 'mrp'])
  if (rate !== null) return String(rate)

  return typeof row.mrp === 'string' && row.mrp.trim() !== '' ? row.mrp.trim() : ''
}

export function itemTaxCategoryId(row: ItemRow): string {
  const id = readId(row, ['tax_cat_id', 'tax_category_id', 'taxcat_id'])

  return id === null ? '' : String(id)
}

export function itemBarcode(row: ItemRow): string | null {
  return readText(row, ['barcode', 'ean', 'upc', 'item_barcode'])
}

/**
 * The quantity Inventory says is available, out of whatever shape it answered in.
 *
 * Returns null when no number can be read — which leaves the stock chip off the
 * screen rather than showing a zero that would read as "out of stock".
 */
export function readAvailableQty(payload: unknown): number | null {
  if (payload === null || typeof payload !== 'object') return null
  const row = payload as Record<string, unknown>
  const nested = (row.data ?? row.availability ?? row) as Record<string, unknown>
  if (nested === null || typeof nested !== 'object') return null

  const source = Array.isArray(nested) ? (nested[0] as Record<string, unknown> | undefined) : nested
  if (!source) return null

  const value = readRate(source, [
    'available_qty',
    'qty_available',
    'available',
    'availability',
    'free_qty',
    'closing_qty',
    'on_hand',
    'stock_qty',
    'balance_qty',
    'qty',
  ])

  return value
}

// ---------------------------------------------------------------------------
// Dirty tracking and the on-device draft
// ---------------------------------------------------------------------------

export function isDirty(draft: SaleDraft, baseline: SaleDraft): boolean {
  return JSON.stringify(stripKeys(draft)) !== JSON.stringify(stripKeys(baseline))
}

/** Line keys are random per render; they are not a change to the bill. */
function stripKeys(draft: SaleDraft): unknown {
  return { ...draft, lines: draft.lines.map(({ key: _key, ...rest }) => rest) }
}

const DRAFT_KEY = 'billing:sale:draft'

export function draftStorageKey(cmpId: number, fyId: number): string {
  return `${DRAFT_KEY}:${cmpId}:${fyId}`
}

export interface StoredDraft {
  savedAt: string
  draft: SaleDraft
}

/**
 * Keep the bill on this device.
 *
 * Deliberately NOT a server-side draft: there is no unposted invoice in this
 * product — `POST v1/transactions/sale` reaches Smart Books and creates the
 * voucher — so anything called "save as draft" that talked to the API would be
 * creating a real invoice. This is the browser's own copy, restored when the
 * screen is opened again, and the wording on the button says exactly that.
 */
export function storeDraft(key: string, draft: SaleDraft): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify({ savedAt: new Date().toISOString(), draft }))
    return true
  } catch {
    // A private window, or storage the browser refuses. Nothing else breaks.
    return false
  }
}

export function readStoredDraft(key: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredDraft>
    const draft = parsed.draft
    if (!draft || !Array.isArray(draft.lines)) return null

    // Line keys are not stored across sessions in any meaningful sense; give
    // them fresh ones so React never sees two rows claiming the same identity.
    return {
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
      draft: { ...emptyDraft(), ...draft, lines: draft.lines.map((line) => ({ ...emptyLine(), ...line, key: newKey() })) },
    }
  } catch {
    return null
  }
}

export function clearStoredDraft(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* storage refused; there was nothing to clear that anybody can see */
  }
}

// ---------------------------------------------------------------------------
// Customers billed lately, on this device
// ---------------------------------------------------------------------------

const RECENT_KEY = 'billing:sale:recent-customers'
const RECENT_LIMIT = 6

export function readRecentCustomers(cmpId: number): CatalogParty[] {
  try {
    const raw = window.localStorage.getItem(`${RECENT_KEY}:${cmpId}`)
    if (!raw) return []
    const parsed = JSON.parse(raw)

    return Array.isArray(parsed)
      ? parsed.filter((row): row is CatalogParty => Boolean(row) && typeof row.acc_id === 'number' && typeof row.acc_name === 'string')
      : []
  } catch {
    return []
  }
}

export function rememberCustomer(cmpId: number, party: CatalogParty): void {
  try {
    const next = [party, ...readRecentCustomers(cmpId).filter((row) => row.acc_id !== party.acc_id)].slice(0, RECENT_LIMIT)
    window.localStorage.setItem(`${RECENT_KEY}:${cmpId}`, JSON.stringify(next))
  } catch {
    /* storage refused; the list is a convenience and the screen works without it */
  }
}

/** Plain digit grouping, for a figure that already has its symbol beside it. */
export function grouped(paise: number): string {
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(fromPaise(paise))
}
