/**
 * The eight cards above the expense-head dropdown.
 *
 * THEY CARRY NO IDS. Each card is a label, an icon and a few words that name
 * the same head in most charts of accounts; it is matched against the company's
 * OWN expense heads, read live from Books, as the screen draws. A card that
 * matches nothing is not shown — inventing an account id for "Rent" in a
 * company that has no rent ledger would post an expense to nothing.
 *
 * A company whose heads are named in its own way (or in another language) is
 * not left with an empty panel either: whatever the words do not match is
 * topped up from the head of that company's own list, so the shortcut is
 * always the user's accounts and never ours.
 */

import {
  Building2,
  Home,
  Megaphone,
  MoreHorizontal,
  Plane,
  Receipt,
  UserRound,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { CatalogAccount } from '../../services/types'

interface QuickCategoryCard {
  key: string
  label: string
  Icon: LucideIcon
  /** Lower-case fragments that identify this head in a chart of accounts. */
  match: string[]
}

export interface ResolvedQuickCategory {
  key: string
  label: string
  Icon: LucideIcon
  accountId: number
  /** The company's own name for the head, which may differ from the card label. */
  accountName: string
}

const CARDS: QuickCategoryCard[] = [
  { key: 'office', label: 'Office Supplies', Icon: Building2, match: ['office', 'stationery', 'printing', 'supplies'] },
  { key: 'travel', label: 'Travel & Conveyance', Icon: Plane, match: ['travel', 'conveyance', 'transport', 'fuel', 'petrol'] },
  { key: 'rent', label: 'Rent', Icon: Home, match: ['rent', 'lease'] },
  { key: 'utilities', label: 'Utilities', Icon: Zap, match: ['utilit', 'electric', 'power', 'water', 'internet', 'telephone', 'mobile'] },
  { key: 'professional', label: 'Professional Fees', Icon: UserRound, match: ['professional', 'legal', 'audit', 'consult', 'fees'] },
  { key: 'marketing', label: 'Marketing', Icon: Megaphone, match: ['marketing', 'advertis', 'promotion', 'publicity'] },
  { key: 'repairs', label: 'Repairs & Maintenance', Icon: Wrench, match: ['repair', 'maintenance', 'amc'] },
  { key: 'other', label: 'Other Expense', Icon: MoreHorizontal, match: ['other', 'miscellaneous', 'misc', 'general', 'sundry'] },
]

/** How many cards the panel draws at most — two rows of four. */
const SLOTS = 8

/**
 * The cards this company can actually use, in the card order above.
 *
 * @param accounts the expense heads Books returned for this company
 */
export function resolveQuickCategories(accounts: CatalogAccount[]): ResolvedQuickCategory[] {
  const taken = new Set<number>()
  const resolved: ResolvedQuickCategory[] = []

  for (const card of CARDS) {
    const account = accounts.find(
      (row) =>
        !taken.has(row.acc_id) &&
        card.match.some((fragment) => (row.acc_name ?? '').toLowerCase().includes(fragment)),
    )
    if (!account) continue

    taken.add(account.acc_id)
    resolved.push({ key: card.key, label: card.label, Icon: card.Icon, accountId: account.acc_id, accountName: account.acc_name })
  }

  // Top up from the company's own list, so a chart of accounts that names
  // nothing the way we guessed still gets shortcuts — its own ones.
  for (const account of accounts) {
    if (resolved.length >= SLOTS) break
    if (taken.has(account.acc_id)) continue

    taken.add(account.acc_id)
    resolved.push({
      key: `account-${account.acc_id}`,
      label: account.acc_name,
      Icon: Receipt,
      accountId: account.acc_id,
      accountName: account.acc_name,
    })
  }

  return resolved.slice(0, SLOTS)
}
