/**
 * What a debit note is, while it is being typed.
 *
 * Everything here is the SHAPE OF A FORM, not a record: the note itself does
 * not exist until Smart Books makes it. Amounts are worked out only far enough
 * to show the person entering them what they are agreeing to — the backend
 * recomputes all of it, and the GST is never computed here at all.
 */

import type { CapabilityKey } from '../../services/types'

export type ReturnKind = 'goods_return' | 'value_adjustment'

/**
 * Why the note is being raised.
 *
 * These five codes are Billing's existing vocabulary and are sent to Smart
 * Books verbatim, which is why the list is not extended here: a code Books has
 * no mapping for is a note that either posts to the wrong place or is refused.
 * Adding one is a change to both products, not to this file.
 */
export const DEBIT_REASONS = [
  { value: 'goods_returned', label: 'Goods sent back to the supplier' },
  { value: 'price_adjustment', label: 'Supplier billed the wrong price' },
  { value: 'shortage', label: 'Short delivery' },
  { value: 'damaged', label: 'Damaged on arrival' },
  { value: 'other', label: 'Something else' },
] as const

export interface DebitNoteLine {
  key: string
  item_id: number | null
  label: string
  description: string
  hsn_sac: string
  unit_id: number | null
  unit_label: string
  qty: string
  rate: string
  /** Set when the rate the item arrived with is edited. The backend checks the permission. */
  rate_was_changed: boolean
  discount_pc: string
  /** '' means "let Smart Books decide from the item and the supplier". */
  tax_cat_id: string
}

export interface DebitNoteTotals {
  itemsTotal: number
  discount: number
  /** What the note is worth before tax. Smart Books adds the GST when it posts. */
  taxable: number
  lines: number
}

export function emptyLine(): DebitNoteLine {
  return {
    key: Math.random().toString(36).slice(2),
    item_id: null,
    label: '',
    description: '',
    hsn_sac: '',
    unit_id: null,
    unit_label: '',
    qty: '1',
    rate: '0',
    rate_was_changed: false,
    discount_pc: '0',
    tax_cat_id: '',
  }
}

/**
 * Two decimal places, away from the float that got you here.
 *
 * `0.1 * 3` is 0.30000000000000004, and a column of those sums to a total that
 * is a paisa out and impossible to explain. Rounding at the line, then adding
 * the rounded lines, is also what makes the column on screen add up to the
 * figure beneath it.
 */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** A number out of a field somebody is still typing in. */
export function num(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * The rate to start a return line at.
 *
 * What the supplier charged, when Inventory says — and it only says to somebody
 * with `cost.view`, because the relay strips cost fields for everyone else. It
 * deliberately does NOT fall back to the selling price: this is a purchase
 * being reversed, and MRP would quietly overstate the note.
 */
export function openingRate(item: {
  purchase_rate?: string | number | null
  last_purchase_rate?: string | number | null
}): string {
  for (const candidate of [item.purchase_rate, item.last_purchase_rate]) {
    if (candidate === null || candidate === undefined || candidate === '') continue
    const parsed = Number(candidate)
    if (Number.isFinite(parsed) && parsed > 0) return String(parsed)
  }

  return '0'
}

export function lineGross(line: DebitNoteLine): number {
  return round2(num(line.qty) * num(line.rate))
}

export function lineDiscount(line: DebitNoteLine): number {
  return round2((lineGross(line) * num(line.discount_pc)) / 100)
}

export function lineAmount(line: DebitNoteLine): number {
  return round2(lineGross(line) - lineDiscount(line))
}

/** A line the user has actually started: an item, or something described. */
export function isUsable(line: DebitNoteLine): boolean {
  return line.item_id !== null || line.description.trim() !== ''
}

export function totalsOf(kind: ReturnKind, lines: DebitNoteLine[], adjustment: string): DebitNoteTotals {
  if (kind === 'value_adjustment') {
    const amount = round2(num(adjustment))
    return { itemsTotal: amount, discount: 0, taxable: amount, lines: amount > 0 ? 1 : 0 }
  }

  const usable = lines.filter(isUsable)
  const itemsTotal = round2(usable.reduce((sum, line) => sum + lineGross(line), 0))
  const discount = round2(usable.reduce((sum, line) => sum + lineDiscount(line), 0))

  return { itemsTotal, discount, taxable: round2(itemsTotal - discount), lines: usable.length }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type FieldName = 'supplier' | 'date' | 'reason' | 'lines' | 'adjustment'

export type Problems = Partial<Record<FieldName, string>>

export interface ValidationInput {
  supplierId: number | null
  date: string
  reason: string
  returnKind: ReturnKind
  lines: DebitNoteLine[]
  adjustment: string
  /** The active financial year, when Manage could be asked for its dates. */
  fy: { start: string; end: string; label: string } | null
  /** What the chosen original document is worth, when one was chosen. */
  againstAmount: number | null
}

/**
 * Everything wrong with the form, in the order the fields appear.
 *
 * None of this replaces the backend's checks — the period lock, the supplier,
 * the return quantity and the totals are all validated again on the server,
 * where they cannot be edited. This is here so the person does not press a
 * button, wait for the network, and then be told they forgot the supplier.
 */
export function validate(input: ValidationInput): Problems {
  const problems: Problems = {}

  if (input.supplierId === null) {
    problems.supplier = 'Choose the supplier this note is for.'
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    problems.date = 'Enter the date of this note.'
  } else if (input.fy && input.fy.start && input.fy.end) {
    if (input.date < input.fy.start || input.date > input.fy.end) {
      problems.date = `That date is outside ${input.fy.label}. Change the year at the top of the page, or the date here.`
    }
  }

  if (!input.reason) {
    problems.reason = 'Say why this note is being raised.'
  }

  if (input.returnKind === 'value_adjustment') {
    if (round2(num(input.adjustment)) <= 0) {
      problems.adjustment = 'Enter the amount being adjusted.'
    }
  } else {
    const usable = input.lines.filter(isUsable)
    if (usable.length === 0) {
      problems.lines = 'Add at least one item that is going back.'
    } else if (usable.some((line) => num(line.qty) <= 0)) {
      problems.lines = 'Quantity must be more than zero on every line.'
    } else if (usable.some((line) => num(line.discount_pc) < 0 || num(line.discount_pc) > 100)) {
      problems.lines = 'A discount has to be between 0% and 100%.'
    } else if (totalsOf('goods_return', input.lines, '').taxable <= 0) {
      // The rate does not default to the item's selling price: this is a
      // purchase being reversed, and what matters is what the SUPPLIER charged.
      problems.lines = 'Enter the rate the supplier billed, so the note is worth something.'
    }
  }

  return problems
}

/**
 * A note worth more than the document it is against.
 *
 * Not an error: Smart Books decides what may actually be adjusted, and a
 * supplier charge raised on top of a bill is a real thing. It is shown so a
 * ₹40,000 note against an ₹18,000 bill gets a second look before it is posted.
 */
export function overAdjusted(againstAmount: number | null, taxable: number): number | null {
  if (againstAmount === null) return null
  return taxable > againstAmount + 0.005 ? againstAmount : null
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

/**
 * A draft lives in THIS BROWSER and nowhere else.
 *
 * Billing posts to Smart Books the moment it saves, so there is no half-made
 * document on the server to come back to — see the `transaction_drafts`
 * capability, which says exactly that. Keeping the typing locally is honest and
 * useful; calling it a saved document would not be, so the screen says which
 * one it is wherever it mentions a draft.
 */
export interface DebitNoteDraft {
  savedAt: string
  supplier: { id: number; name: string } | null
  date: string
  reference: string
  reason: string
  returnKind: ReturnKind
  warehouseId: string
  lines: DebitNoteLine[]
  adjustment: string
  notes: string
  against: { voucher_id: number | null; document_no: string | null; date: string | null; amount: number | null } | null
}

export function draftKey(cmpId: number | undefined, fyId: number | undefined): string {
  return `billing:debit-note-draft:${cmpId ?? 0}:${fyId ?? 0}`
}

export function readDraft(key: string): DebitNoteDraft | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DebitNoteDraft
    return Array.isArray(parsed.lines) ? parsed : null
  } catch {
    // A private window, storage the browser refuses, or a draft written by an
    // older shape of this screen. None of them is worth an error on the way in.
    return null
  }
}

export function writeDraft(key: string, draft: DebitNoteDraft): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(draft))
    return true
  } catch {
    return false
  }
}

export function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* nothing kept, nothing to clear */
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export interface StepState {
  key: string
  title: string
  hint: string
  done: boolean
}

/**
 * The four steps, and how far the form has actually got.
 *
 * Derived from the form rather than from a wizard the user has to click
 * through: this screen is one page, and the stepper is a progress report on it.
 */
export function stepsOf(input: {
  supplierId: number | null
  reason: string
  date: string
  totals: DebitNoteTotals
  problems: Problems
  posted: boolean
}): StepState[] {
  const details = input.supplierId !== null && input.reason !== '' && input.date !== '' && !input.problems.date
  const items = input.totals.lines > 0 && input.totals.taxable > 0
  const review = details && items && Object.keys(input.problems).length === 0

  return [
    { key: 'details', title: 'Details', hint: 'Supplier & reference', done: details },
    { key: 'items', title: 'Items', hint: 'What is going back', done: items },
    { key: 'review', title: 'Review', hint: 'Totals & tax', done: review },
    { key: 'post', title: 'Post', hint: 'Save & share', done: input.posted },
  ]
}

/** The step to highlight: the first one not yet done. */
export function activeStep(steps: StepState[]): number {
  const index = steps.findIndex((step) => !step.done)
  return index === -1 ? steps.length - 1 : index
}

/** Capability keys this screen asks the server about. */
export const SCREEN_CAPABILITIES: CapabilityKey[] = [
  'document_extraction',
  'transaction_drafts',
  'transaction_attachments',
  'accounting_preview',
]
