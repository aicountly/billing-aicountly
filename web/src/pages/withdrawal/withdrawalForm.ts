/**
 * The bank withdrawal draft, and the rules about it that are not React's
 * business.
 *
 * Kept apart from the components for the same reason the expense form's rules
 * are: the validation can be read — and changed — without scrolling through
 * markup, and the shape that becomes the API body is written down in one place
 * next to the rules that let it be sent.
 */

import { parseAmount } from '../../utils/amount'

export { groupAmount, parseAmount } from '../../utils/amount'

export interface WithdrawalDraft {
  /** As typed, grouping and all. Parsed once, on the way out. */
  amount: string
  date: string
  /** The BANK ledger the cash is taken out of. */
  bankAccountId: string
  /** The CASH ledger it lands in. */
  cashAccountId: string
  /** Cheque number, UTR, withdrawal slip — whatever names this at the branch. */
  reference: string
  note: string
}

export type WithdrawalField = keyof WithdrawalDraft

export type WithdrawalErrors = Partial<Record<WithdrawalField, string>>

/** The longest note this screen accepts. Books takes the narration as free text. */
export const NOTE_LIMIT = 500

/** Above this an amount is almost certainly a typing slip, not a withdrawal. */
const IMPLAUSIBLE = 1e13

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function emptyDraft(date = today()): WithdrawalDraft {
  return {
    amount: '',
    date,
    bankAccountId: '',
    cashAccountId: '',
    reference: '',
    note: '',
  }
}

/**
 * What the next entry starts from after "Save & New".
 *
 * The transaction goes; the context a person is sitting in stays. The two
 * accounts and the date are what they already told us, and asking again for
 * every withdrawal in a morning's stack is the reason that button exists.
 *
 * The amount and the reference NEVER carry over. Re-using a cheque number is
 * how one withdrawal becomes two entries against the same instrument, and an
 * amount that is already filled in is an amount somebody saves without reading.
 */
export function nextEntryDraft(previous: WithdrawalDraft): WithdrawalDraft {
  return {
    ...emptyDraft(previous.date),
    bankAccountId: previous.bankAccountId,
    cashAccountId: previous.cashAccountId,
  }
}

/**
 * What "repeat the last one" is allowed to fill in.
 *
 * The same rule as above and for the same reason: the two ledgers are a habit
 * worth repeating, the amount and the cheque number are a duplicate waiting to
 * happen.
 */
export function repeatDraft(
  previous: WithdrawalDraft,
  accounts: { bankAccountId: string; cashAccountId: string },
): WithdrawalDraft {
  return { ...previous, ...accounts, amount: '', reference: '' }
}

/** True once there is anything in the form worth warning somebody about losing. */
export function isDirty(draft: WithdrawalDraft, baseline: WithdrawalDraft): boolean {
  return (
    draft.amount.trim() !== baseline.amount.trim() ||
    draft.date !== baseline.date ||
    draft.bankAccountId !== baseline.bankAccountId ||
    draft.cashAccountId !== baseline.cashAccountId ||
    draft.reference.trim() !== baseline.reference.trim() ||
    draft.note.trim() !== baseline.note.trim()
  )
}

export interface FinancialYearWindow {
  from: string | null
  to: string | null
  label: string | null
}

/**
 * Everything that must be true before this can be sent.
 *
 * The messages name the thing to do, not the rule that was broken. The backend
 * checks all of it again — TransactionService refuses a zero amount, a missing
 * account and the two accounts being the same — so this is the courtesy that
 * saves a round trip, never the control.
 *
 * NOT checked here: whether the bank can afford it. A withdrawal that takes an
 * account below zero is a real thing — an overdraft facility is exactly that —
 * and Books is the only thing that knows whether this one has one. The screen
 * warns beside the balance and lets the person decide.
 */
export function validate(draft: WithdrawalDraft, fy: FinancialYearWindow): WithdrawalErrors {
  const errors: WithdrawalErrors = {}

  const amount = parseAmount(draft.amount)
  if (amount === null || amount <= 0) {
    errors.amount = 'Enter an amount greater than zero.'
  } else if (amount > IMPLAUSIBLE) {
    errors.amount = 'That amount looks wrong. Check it before saving.'
  }

  if (!draft.date) {
    errors.date = 'Select the withdrawal date.'
  } else if (fy.from && fy.to && (draft.date < fy.from || draft.date > fy.to)) {
    errors.date = `That date is outside ${fy.label ?? 'the selected financial year'}. Change the date, or switch the year at the top of the page.`
  }

  if (!draft.bankAccountId) errors.bankAccountId = 'Select the bank account the cash was taken from.'
  if (!draft.cashAccountId) errors.cashAccountId = 'Select the cash account the money went into.'

  // This screen is bank → cash. Moving money between two banks is a transfer
  // and has its own screen; the same account on both sides is not a movement
  // at all, and Books refuses it too.
  if (draft.bankAccountId && draft.bankAccountId === draft.cashAccountId) {
    errors.cashAccountId = 'The money has to move between two different accounts.'
  }

  if (draft.note.length > NOTE_LIMIT) errors.note = `Keep the note to ${NOTE_LIMIT} characters.`

  return errors
}

/** The order the fields are read in, which is the order they are focused in. */
const FIELD_ORDER: WithdrawalField[] = ['amount', 'date', 'bankAccountId', 'cashAccountId', 'reference', 'note']

export function firstError(errors: WithdrawalErrors): WithdrawalField | null {
  return FIELD_ORDER.find((field) => errors[field] !== undefined) ?? null
}

/**
 * The body `POST v1/transactions/bank_withdrawal` expects.
 *
 * Every key here is one TransactionService already reads — this is the same
 * call the screen it replaces made, with the narration the old form had no box
 * for. The company, branch and year are NOT set here: the API client puts the
 * current scope on every call, which is the only way a form that was open while
 * somebody switched company cannot post into the old one.
 *
 * Numbers go as numbers. Nothing formatted for a human ever reaches the API.
 */
export function toWithdrawalRequest(draft: WithdrawalDraft): Record<string, unknown> {
  return {
    amount: parseAmount(draft.amount) ?? 0,
    from_account_id: Number(draft.bankAccountId),
    to_account_id: Number(draft.cashAccountId),
    date: draft.date,
    instrument_no: draft.reference.trim() || undefined,
    narration: draft.note.trim() || undefined,
  }
}

/**
 * The backend's field name, turned back into the box it came from.
 *
 * TransactionService answers a refusal with `details.field` — `amount`,
 * `from_account_id`, `to_account_id`. Putting the message under the right
 * control beats a banner saying something went wrong somewhere on this form.
 */
export function fieldFromApi(field: unknown): WithdrawalField | null {
  switch (field) {
    case 'amount':
      return 'amount'
    case 'date':
    case 'vch_date':
      return 'date'
    case 'from_account_id':
      return 'bankAccountId'
    case 'to_account_id':
      return 'cashAccountId'
    case 'instrument_no':
    case 'reference_no':
      return 'reference'
    case 'narration':
      return 'note'
    default:
      return null
  }
}
