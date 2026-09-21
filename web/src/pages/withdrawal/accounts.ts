/**
 * The cash and bank ledgers this screen offers, built from the two endpoints
 * that already answer for them.
 *
 * `v1/catalog/cash-bank` is the LIST — every cash and bank ledger in this
 * company, which is what the screen this replaces already used. `v1/cash-bank`
 * is the BALANCE, and it is the only thing that says which of them is a bank
 * and which is cash, because that classification is Books' (it reads the
 * account's group) and not something to re-derive from a ledger's name here.
 *
 * Neither is copied. Both are read live on the request that draws the screen.
 */

import type { CashBank, CatalogAccount } from '../../services/types'
import { readScalar } from '../../services/shapes'

export type AccountKind = 'bank' | 'cash'

export interface AccountOption {
  id: number
  name: string
  /** Masked, and only when Books sends an account number at all. */
  accountNo: string | null
  /** From the balance endpoint; null when this profile may not see it. */
  balance: number | null
  /** null when the balance endpoint could not say — see `pick` below. */
  kind: AccountKind | null
}

/** Books' account rows carry more than the two fields the catalog type names. */
export type CashBankRow = CatalogAccount & Record<string, unknown>

const ACCOUNT_NO_KEYS = [
  'account_no',
  'acc_no',
  'account_number',
  'bank_account_no',
  'bank_ac_no',
  'ac_no',
  'bank_acc_no',
]

/**
 * All but the last four digits, replaced.
 *
 * A counter screen is read over shoulders, and the last four are all anybody
 * needs to tell two of this company's accounts apart. Anything too short to
 * mask meaningfully is left as it is rather than turned into a row of dots.
 */
export function maskAccountNumber(raw: string | null): string | null {
  if (raw === null) return null

  const trimmed = raw.trim()
  if (trimmed.length <= 4) return trimmed === '' ? null : trimmed

  return `••••${trimmed.slice(-4)}`
}

/**
 * The catalog list, with the balance and kind folded in where they are known.
 *
 * An account the balance endpoint did not mention keeps `kind: null` rather
 * than being guessed at. That happens for a real reason: a profile with
 * `bank.view` and not `cash.view` is served the bank accounts and not the cash
 * ones, and an account nobody classified must still be offered somewhere or the
 * user cannot record anything at all.
 */
export function buildAccountOptions(
  rows: readonly CashBankRow[],
  balances: CashBank | null | undefined,
): AccountOption[] {
  const known = new Map<number, { balance: number; kind: AccountKind }>()

  if (balances?.available) {
    for (const account of balances.accounts ?? []) {
      known.set(account.account_id, { balance: account.balance, kind: account.kind })
    }
  }

  return rows.map((row) => {
    const match = known.get(row.acc_id)

    return {
      id: row.acc_id,
      name: row.acc_name,
      accountNo: maskAccountNumber(readScalar(row, ACCOUNT_NO_KEYS)),
      balance: match?.balance ?? null,
      kind: match?.kind ?? null,
    }
  })
}

/**
 * The options one side of this screen may offer.
 *
 * Bank withdrawal is bank → cash, so each dropdown shows its own kind, plus
 * anything unclassified, minus whatever the OTHER dropdown is already set to.
 * That last exclusion is what stops an account being picked on both sides;
 * Books refuses it too, but being unable to choose it beats being told off
 * after pressing Save.
 */
export function pick(
  options: readonly AccountOption[],
  kind: AccountKind,
  excludeId: string,
): AccountOption[] {
  return options.filter(
    (option) => (option.kind === kind || option.kind === null) && String(option.id) !== excludeId,
  )
}

export function findAccount(options: readonly AccountOption[], id: string): AccountOption | null {
  if (id === '') return null

  return options.find((option) => String(option.id) === id) ?? null
}
