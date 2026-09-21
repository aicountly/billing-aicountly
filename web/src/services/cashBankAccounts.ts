/**
 * A cash or bank ledger, as the two contra screens need to show it.
 *
 * Shared because Bank withdrawal and Bank deposit are the same choice made in
 * opposite directions, and two copies of "which of these is a bank" is how the
 * pair start disagreeing about one company's chart of accounts. It began on the
 * withdrawal screen; the deposit screen is the second user, which is when this
 * product moves a thing out of one screen's folder.
 *
 * Pure functions over what the API returned. Nothing here fetches and nothing
 * here is stored.
 */

import type { CashBankAccount } from './types'
import { readText } from './shapes'

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
 * The accounts offered for one side of a contra.
 *
 * When Books told us which ledgers are cash and which are bank, each side is
 * narrowed to its own — a deposit runs cash into a bank and a withdrawal runs
 * it back, so offering the wrong list is offering the other entry. When Books
 * told us nothing, NOTHING IS HIDDEN: a guess at which ledger is a bank, made
 * from its name, would be wrong for exactly the companies that name their
 * accounts carefully.
 */
export function accountsFor(options: AccountOption[], kind: 'cash' | 'bank', exclude: string): AccountOption[] {
  const classified = options.some((option) => option.kind !== null)

  return options.filter(
    (option) => String(option.id) !== exclude && (!classified || option.kind === null || option.kind === kind),
  )
}
