/**
 * The expense draft, and the rules about it that are not React's business.
 *
 * Kept apart from the components so the validation can be read — and changed —
 * without scrolling through markup, and so the shape that becomes the API body
 * is written down in one place next to the rules that let it be sent.
 */

import type { CatalogParty } from '../../services/types'

export interface ExpenseDraft {
  /** As typed, grouping and all. Parsed once, on the way out. */
  amount: string
  date: string
  categoryId: string
  paidFromId: string
  vendor: CatalogParty | null
  reference: string
  /** A Books tax category, or '' for an expense with no GST on it. */
  taxCategoryId: string
  note: string
  /** Where the bill is kept, when this deployment cannot hold the file itself. */
  billReference: string
}

export type ExpenseField = keyof ExpenseDraft

export type ExpenseErrors = Partial<Record<ExpenseField, string>>

/** The longest note this screen accepts. Books takes the narration as free text. */
export const NOTE_LIMIT = 500

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function emptyDraft(date = today()): ExpenseDraft {
  return {
    amount: '',
    date,
    categoryId: '',
    paidFromId: '',
    vendor: null,
    reference: '',
    taxCategoryId: '',
    note: '',
    billReference: '',
  }
}

/**
 * What the next entry starts from after "Save and add another".
 *
 * The transaction goes; the context a person is sitting in stays. Somebody
 * entering a stack of fuel bills has already told us the date and the account
 * they came out of, and being asked again for every one of them is the reason
 * that checkbox exists.
 */
export function nextEntryDraft(previous: ExpenseDraft): ExpenseDraft {
  return {
    ...emptyDraft(previous.date),
    categoryId: previous.categoryId,
    paidFromId: previous.paidFromId,
  }
}

/** True once there is anything in the form worth warning somebody about losing. */
export function isDirty(draft: ExpenseDraft, baseline: ExpenseDraft): boolean {
  return (
    draft.amount.trim() !== baseline.amount.trim() ||
    draft.date !== baseline.date ||
    draft.categoryId !== baseline.categoryId ||
    draft.paidFromId !== baseline.paidFromId ||
    (draft.vendor?.acc_id ?? null) !== (baseline.vendor?.acc_id ?? null) ||
    draft.reference.trim() !== baseline.reference.trim() ||
    draft.taxCategoryId !== baseline.taxCategoryId ||
    draft.note.trim() !== baseline.note.trim() ||
    draft.billReference.trim() !== baseline.billReference.trim()
  )
}

/**
 * The amount as a number, or null when it is not one.
 *
 * Grouping separators are stripped rather than rejected: the field shows
 * 1,23,456.78 after it loses focus, and a person who clicks back into it and
 * presses Save should not be told that what we wrote there is invalid.
 */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[\s,]/g, '')
  if (cleaned === '') return null

  const value = Number(cleaned)

  return Number.isFinite(value) ? value : null
}

/** Indian digit grouping while typing — the same grouping money() prints. */
export function groupAmount(value: number): string {
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

export interface FinancialYearWindow {
  from: string | null
  to: string | null
  label: string | null
}

/**
 * Everything that must be true before this can be sent.
 *
 * The messages name the thing to do, not the rule that was broken: "Select the
 * account this expense was paid from" is actionable and "cash_bank_account_id
 * is required" is not. The backend checks all of it again — this is the courtesy
 * that saves a round trip, never the control.
 */
export function validate(draft: ExpenseDraft, fy: FinancialYearWindow): ExpenseErrors {
  const errors: ExpenseErrors = {}

  const amount = parseAmount(draft.amount)
  if (amount === null || amount <= 0) {
    errors.amount = 'Enter an expense amount greater than zero.'
  } else if (amount > 1e13) {
    errors.amount = 'That amount looks wrong. Check it before saving.'
  }

  if (!draft.date) {
    errors.date = 'Select an expense date.'
  } else if (fy.from && fy.to && (draft.date < fy.from || draft.date > fy.to)) {
    errors.date = `That date is outside ${fy.label ?? 'the selected financial year'}. Change the date, or switch the year at the top of the page.`
  }

  if (!draft.categoryId) errors.categoryId = 'Select an expense category.'
  if (!draft.paidFromId) errors.paidFromId = 'Select the account used to pay this expense.'

  if (draft.note.length > NOTE_LIMIT) errors.note = `Keep the note to ${NOTE_LIMIT} characters.`

  return errors
}

export function firstError(errors: ExpenseErrors): ExpenseField | null {
  const order: ExpenseField[] = ['amount', 'date', 'categoryId', 'paidFromId', 'note']

  return order.find((field) => errors[field] !== undefined) ?? null
}

/**
 * The body `POST v1/transactions/expense` expects.
 *
 * Every key here is one the existing TransactionService already reads. The
 * company, branch and year are NOT set here — the API client puts the current
 * scope on every call, which is the only way a form that was open while
 * somebody switched company cannot post into the old one.
 */
export function toExpenseRequest(draft: ExpenseDraft): Record<string, unknown> {
  return {
    amount: parseAmount(draft.amount) ?? 0,
    expense_account_id: Number(draft.categoryId),
    cash_bank_account_id: Number(draft.paidFromId),
    date: draft.date,
    narration: draft.note.trim() || undefined,
    party_account_id: draft.vendor?.acc_id ?? undefined,
    reference_no: draft.reference.trim() || undefined,
    tax_cat_id: draft.taxCategoryId ? Number(draft.taxCategoryId) : undefined,
    attachment_ref: draft.billReference.trim() || undefined,
  }
}

/**
 * Reading a row whose key spelling we do not control.
 *
 * These moved to services/shapes.ts when the credit note screen needed the
 * same three rules for Books' warehouse and invoice-line lists. Re-exported
 * here so the form that has always imported them from this module still can.
 */
export { readId, readNumber, readText } from '../../services/shapes'
