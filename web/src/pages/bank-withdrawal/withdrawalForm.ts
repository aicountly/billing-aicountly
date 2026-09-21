/**
 * The withdrawal draft, and the rules about it that are not React's business.
 *
 * Kept apart from the components so the validation can be read — and changed —
 * without scrolling through markup, and so the shape that becomes the API body
 * is written down in one place next to the rules that let it be sent.
 *
 * Nothing here decides any accounting. A withdrawal is a contra in Smart Books
 * and Books makes both sides of it; what this file knows is which four things
 * must be filled in before the request is worth sending.
 */

import { readText } from '../../services/shapes'
import type { CashBankAccount, RecentWithdrawal } from '../../services/types'

export interface WithdrawalDraft {
  /** As typed, grouping and all. Parsed once, on the way out. */
  amount: string
  date: string
  /** The bank ledger the cash is taken from. */
  bankAccountId: string
  /** The cash ledger it goes into. */
  cashAccountId: string
  reference: string
  note: string
}

export type WithdrawalField = keyof WithdrawalDraft

export type WithdrawalErrors = Partial<Record<WithdrawalField, string>>

/** The longest note this screen accepts. Books takes the narration as free text. */
export const NOTE_LIMIT = 500

/** A cheque number, a UTR or a slip number. Long enough for any of them. */
export const REFERENCE_LIMIT = 120

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export interface FinancialYearWindow {
  from: string | null
  to: string | null
  label: string | null
}

/**
 * The date a new withdrawal starts on.
 *
 * Today, unless today is outside the year that is open at the top of the page —
 * somebody working in last year's books wants that year's dates, and starting
 * them on a date the form will immediately refuse is a worse guess than the
 * nearest day inside it.
 */
export function defaultDate(fy: FinancialYearWindow, now = today()): string {
  if (fy.from && now < fy.from) return fy.from
  if (fy.to && now > fy.to) return fy.to

  return now
}

export function emptyDraft(date: string): WithdrawalDraft {
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
 * The transaction goes; the context a person is sitting in stays. Somebody
 * drawing cash for three branches on one morning has already said which bank
 * and which cash account, and being asked again for each of them is the reason
 * that button exists.
 *
 * The amount and the reference NEVER carry over. Two withdrawals with the same
 * cheque number is either a mistake or a duplicate, and neither should be one
 * click away.
 */
export function nextEntryDraft(previous: WithdrawalDraft): WithdrawalDraft {
  return {
    ...emptyDraft(previous.date),
    bankAccountId: previous.bankAccountId,
    cashAccountId: previous.cashAccountId,
  }
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

/** More than two decimal places is not money; it is a typing mistake. */
function hasExtraPaise(text: string): boolean {
  const cleaned = text.replace(/[\s,]/g, '')
  const dot = cleaned.indexOf('.')

  return dot !== -1 && cleaned.length - dot - 1 > 2
}

/**
 * Everything that must be true before this can be sent.
 *
 * The messages name the thing to do, not the rule that was broken. The backend
 * checks all of it again and Books checks it a third time — this is the
 * courtesy that saves a round trip, never the control.
 */
export function validate(draft: WithdrawalDraft, fy: FinancialYearWindow): WithdrawalErrors {
  const errors: WithdrawalErrors = {}

  const amount = parseAmount(draft.amount)
  if (draft.amount.trim() !== '' && amount === null) {
    errors.amount = 'Enter the amount in figures.'
  } else if (amount === null || amount <= 0) {
    errors.amount = 'Enter an amount greater than zero.'
  } else if (hasExtraPaise(draft.amount)) {
    errors.amount = 'Amounts go to two decimal places.'
  } else if (amount > 1e13) {
    errors.amount = 'That amount looks wrong. Check it before saving.'
  }

  if (!draft.date) {
    errors.date = 'Select the withdrawal date.'
  } else if (fy.from && fy.to && (draft.date < fy.from || draft.date > fy.to)) {
    errors.date = `That date is outside ${fy.label ?? 'the selected financial year'}. Change the date, or switch the year at the top of the page.`
  }

  if (!draft.bankAccountId) errors.bankAccountId = 'Select the bank account the cash is taken from.'

  if (!draft.cashAccountId) {
    errors.cashAccountId = 'Select the cash account the money goes into.'
  } else if (draft.cashAccountId === draft.bankAccountId) {
    // The backend refuses this too. Catching it here says what to do about it.
    errors.cashAccountId = 'The money has to move between two different accounts. Choose the cash account it went into.'
  }

  if (draft.note.length > NOTE_LIMIT) errors.note = `Keep the note to ${NOTE_LIMIT} characters.`

  return errors
}

export function firstError(errors: WithdrawalErrors): WithdrawalField | null {
  const order: WithdrawalField[] = ['amount', 'date', 'bankAccountId', 'cashAccountId', 'note']

  return order.find((field) => errors[field] !== undefined) ?? null
}

/**
 * The body `POST v1/transactions/bank_withdrawal` expects.
 *
 * Every key here is one the existing TransactionService already reads: the
 * contra payload takes `from_account_id`, `to_account_id`, `amount` and
 * `instrument_no`, and the narration comes from the same place it does for
 * every other kind. The company, branch and year are NOT set here — the API
 * client puts the current scope on every call, which is the only way a form
 * that was open while somebody switched company cannot post into the old one.
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
 * Which field a backend validation error belongs to.
 *
 * The API answers with `details.field` in its own vocabulary — the accounting
 * one. A message that arrives about `from_account_id` has to land under the
 * control the user can see, which is labelled "Bank account (taken from)".
 */
export function fieldForApiError(details: Record<string, unknown>): WithdrawalField | null {
  const field = typeof details.field === 'string' ? details.field : null

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
      return 'reference'
    case 'narration':
      return 'note'
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/** What kind of ledger this is, when Books said. Null is "Books did not say". */
export type AccountKind = 'cash' | 'bank' | null

export interface AccountOption {
  id: number
  name: string
  kind: AccountKind
  /** Books' balance for this ledger, when the profile may see it. */
  balance: number | null
  /** Masked, because the whole number has no business being on a form. */
  maskedNumber: string | null
}

/**
 * The account number as Books gave it, reduced to something safe to print.
 *
 * Nobody needs the whole number to tell two accounts apart, and a screen that
 * prints one has put it in every screenshot and support ticket that follows.
 */
export function maskAccountNumber(account: CashBankAccount): string | null {
  const raw = readText(account as unknown as Record<string, unknown>, [
    'account_no',
    'acc_no',
    'bank_account_no',
    'account_number',
    'bank_acc_no',
  ])
  if (raw === null) return null

  const digits = raw.replace(/\s/g, '')
  if (digits.length <= 4) return digits

  return `••••${digits.slice(-4)}`
}

/**
 * Which kind of ledger Books says this is, from the GROUP it put it in.
 *
 * The same rule the server applies in DuesService, and for the same reason:
 * the group is Books' own classification, so reading it is not guessing. The
 * NAME is never read — "Cash Credit A/c" is a bank — so a ledger whose group
 * Books did not send stays unclassified rather than being sorted by its label.
 */
function kindFromGroup(account: CashBankAccount): AccountKind {
  const group = (account.group_name ?? account.nature ?? '').toLowerCase()
  if (group === '') return null

  return group.includes('cash') ? 'cash' : 'bank'
}

/**
 * The ledgers Books returned, with the balance and the kind attached where they
 * are known.
 *
 * The LIST is `v1/catalog/cash-bank` — Books' cash and bank ledgers, which is
 * what may be posted to. The balance comes from `v1/cash-bank`, which is
 * permission-gated: a profile without `bank.view` gets the list and no
 * balances, and the screen still works because the balance is context, not a
 * requirement for recording what the bank already did. The kind comes from
 * there too, and falls back to the group on the ledger itself — so the two
 * lists stay sorted for somebody who may not be shown a balance at all.
 */
export function buildAccountOptions(
  accounts: CashBankAccount[],
  balances: Array<{ account_id: number; account_name: string; balance: number; kind: 'cash' | 'bank' }> | null,
): AccountOption[] {
  const known = new Map(balances?.map((row) => [row.account_id, row]) ?? [])

  return accounts.map((account) => {
    const match = known.get(account.acc_id)

    return {
      id: account.acc_id,
      name: account.acc_name,
      kind: match?.kind ?? kindFromGroup(account),
      balance: match ? match.balance : null,
      maskedNumber: maskAccountNumber(account),
    }
  })
}

/**
 * The accounts offered for one side of the withdrawal.
 *
 * When Books told us which ledgers are cash and which are bank, each side is
 * narrowed to its own — this screen moves money from a bank to cash and
 * offering the reverse would be offering a deposit. When Books told us nothing,
 * NOTHING IS HIDDEN: a guess at which ledger is a bank, made from its name,
 * would be wrong for exactly the companies that name their accounts carefully.
 */
export function accountsFor(options: AccountOption[], kind: 'cash' | 'bank', exclude: string): AccountOption[] {
  const classified = options.some((option) => option.kind !== null)

  return options.filter(
    (option) => String(option.id) !== exclude && (!classified || option.kind === null || option.kind === kind),
  )
}

/**
 * The cash account this company usually withdraws into.
 *
 * Offered into an EMPTY field only, and only from what this product recorded,
 * so it is a memory of what was done rather than a decision made for anybody.
 */
export function suggestedCashAccount(rows: RecentWithdrawal[], available: AccountOption[]): string {
  for (const row of rows) {
    if (row.cash_account_id !== null && available.some((option) => option.id === row.cash_account_id)) {
      return String(row.cash_account_id)
    }
  }

  return ''
}

/**
 * "Haven't I already entered this one?"
 *
 * Checked against the recent list that is on screen anyway — no extra call, and
 * no claim to be more than it is: it can only see what this product recorded
 * lately. It warns and never blocks, because two withdrawals of the same round
 * figure on one day is a real thing that happens.
 */
export function findPossibleDuplicate(draft: WithdrawalDraft, rows: RecentWithdrawal[]): RecentWithdrawal | null {
  const amount = parseAmount(draft.amount)
  if (amount === null || amount <= 0 || !draft.bankAccountId || !draft.cashAccountId) return null

  return (
    rows.find(
      (row) =>
        row.date === draft.date &&
        row.amount !== null &&
        Math.abs(row.amount - amount) < 0.01 &&
        String(row.bank_account_id ?? '') === draft.bankAccountId &&
        String(row.cash_account_id ?? '') === draft.cashAccountId,
    ) ?? null
  )
}
