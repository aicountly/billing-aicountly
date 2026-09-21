/**
 * The sentences in the Smart Suggestions panel, and where each one comes from.
 *
 * NOT called "AI Suggestions", and there is no model behind it. Every line this
 * returns is a plain consequence of data already on the screen — the open bills
 * Books listed for this party, the party's last payment Books returned, and the
 * numbers the user has typed into the form. It calls nothing, and it cannot
 * produce a sentence about data it was not given.
 *
 * That is the point. A panel like this is read as fact by someone about to move
 * money, so the rule here is the same one the dashboards follow: if the figure
 * behind a sentence could not be established, the sentence is not written.
 * `partyContextIsUsable` is what enforces it for the history line — a "last
 * paid 28 days ago" drawn from a register page that could not be proved
 * complete would really mean "the oldest of the rows we happened to get", and
 * that is worse than saying nothing.
 */

import { daysAgoWords, fromPaise, partyContextIsUsable, type Direction, type PaymentMode } from './money'
import { money } from '../../ui'
import type { MoneyPartyContext } from '../../services/types'

export type HintTone = 'info' | 'warning' | 'history'

/** Where a hint's button takes you. Never a URL the hint made up. */
export type HintAction = 'allocate' | 'history' | 'reference'

export interface MoneyHint {
  id: string
  tone: HintTone
  message: string
  action?: { label: string; kind: HintAction }
}

export interface HintContext {
  direction: Direction
  party: { id: number; name: string } | null
  /** Open bills, as Books answered for this party. */
  billsLoading: boolean
  billsFailed: boolean
  openBillCount: number
  openBillTotalPaise: number
  /** What the user has typed, in paise. */
  amountPaise: number
  allocatedPaise: number
  partyContext: MoneyPartyContext | null
  partyContextLoading: boolean
  mode: PaymentMode | undefined
  reference: string
}

const MAX_HINTS = 4

export function buildMoneyHints(context: HintContext): MoneyHint[] {
  if (!context.party) return []

  const hints: MoneyHint[] = []
  const isOut = context.direction === 'out'
  const them = isOut ? 'supplier' : 'customer'
  const paperwork = isOut ? 'bill' : 'invoice'

  // 1. What is outstanding, straight from the open-bills read.
  if (!context.billsLoading && !context.billsFailed) {
    if (context.openBillCount > 0) {
      hints.push({
        id: 'open-bills',
        tone: 'info',
        message:
          `${context.openBillCount} open ${paperwork}${context.openBillCount === 1 ? '' : 's'} ` +
          `from this ${them}, ${money(fromPaise(context.openBillTotalPaise))} outstanding.`,
        action: { label: isOut ? 'View & pay' : 'View & apply', kind: 'allocate' },
      })
    } else {
      hints.push({
        id: 'nothing-open',
        tone: 'info',
        message: `Nothing outstanding for this ${them} — this will sit on account.`,
      })
    }
  }

  // 2. When we last moved money with them. Withheld unless provable.
  if (!context.partyContextLoading && partyContextIsUsable(context.partyContext)) {
    const last = context.partyContext!.last
    if (last?.days_ago !== null && last?.days_ago !== undefined) {
      const verb = isOut ? 'Last payment to this supplier was' : 'Last receipt from this customer was'
      const amount = last.amount === null ? null : money(last.amount)
      hints.push({
        id: 'last-payment',
        tone: 'history',
        message: amount
          ? `${verb} ${daysAgoWords(last.days_ago)} — ${amount}.`
          : `${verb} ${daysAgoWords(last.days_ago)}.`,
        action: { label: 'View history', kind: 'history' },
      })
    } else if (context.partyContext!.entries_in_window === 0) {
      hints.push({
        id: 'no-recent',
        tone: 'history',
        message:
          `No ${isOut ? 'payment to' : 'receipt from'} this ${them} in the last ` +
          `${context.partyContext!.looked_back_days} days.`,
        action: { label: 'View history', kind: 'history' },
      })
    }
  }

  // 3. What this entry will do to the balance, from the numbers on the form.
  const unallocated = context.amountPaise - context.allocatedPaise
  if (context.amountPaise > 0 && context.openBillCount > 0 && unallocated > 0) {
    hints.push({
      id: 'on-account',
      tone: 'warning',
      message:
        `${money(fromPaise(unallocated))} of this ${isOut ? 'payment' : 'receipt'} is not applied to any ` +
        `${paperwork} and will sit on account.`,
      action: { label: isOut ? 'Apply to bills' : 'Apply to invoices', kind: 'allocate' },
    })
  }

  // 4. A reference the mode expects and the form has not got.
  if (context.mode?.expectsReference && context.reference.trim() === '' && context.amountPaise > 0) {
    hints.push({
      id: 'reference',
      tone: 'warning',
      message: `Add the ${context.mode.referenceLabel} so this can be matched against the bank later.`,
      action: { label: 'Add reference', kind: 'reference' },
    })
  }

  return hints.slice(0, MAX_HINTS)
}
