/**
 * The money screens' vocabulary, and the arithmetic they are allowed to do.
 *
 * TWO THINGS ARE DELIBERATE HERE.
 *
 * The payment modes are the values this product has always sent — `cash`,
 * `upi`, `bank_transfer`, `cheque`, `card`. The labels around them have been
 * rewritten for the people reading them ("Bank transfer (NEFT / RTGS / IMPS)"),
 * but the value on the wire is unchanged. Inventing `neft` and `rtgs` as new
 * modes would make this screen send Books something no other screen in the
 * fleet sends, for a distinction Books is not storing separately anyway.
 *
 * And money is counted in PAISE, as integers. 0.1 + 0.2 is not 0.3 in a double,
 * and an allocation screen that adds up rupees as floats will eventually tell
 * somebody they have over-applied a payment by one paisa and refuse to save it.
 */

import type { MoneyPartyContext } from '../../services/types'

export type Direction = 'in' | 'out'

// ---------------------------------------------------------------------------
// Payment modes
// ---------------------------------------------------------------------------

export interface PaymentMode {
  /** What goes to the API. Do not change these without changing the backend. */
  value: string
  label: string
  /** What the reference is called for this mode, in the user's words. */
  referenceLabel: string
  referencePlaceholder: string
  /**
   * Whether an entry in this mode is worth having a reference on.
   *
   * It is a nudge, never a rule: the backend does not require one and neither
   * does this screen, because a shopkeeper who has not got the UTR to hand
   * still needs to record that the money left.
   */
  expectsReference: boolean
}

export const PAYMENT_MODES: PaymentMode[] = [
  {
    value: 'cash',
    label: 'Cash',
    referenceLabel: 'voucher note',
    referencePlaceholder: 'Voucher or slip note',
    expectsReference: false,
  },
  {
    value: 'upi',
    label: 'UPI',
    referenceLabel: 'UPI reference',
    referencePlaceholder: 'UPI / UTR reference',
    expectsReference: true,
  },
  {
    value: 'bank_transfer',
    label: 'Bank transfer (NEFT / RTGS / IMPS)',
    referenceLabel: 'UTR',
    referencePlaceholder: 'UTR / transaction reference',
    expectsReference: true,
  },
  {
    value: 'cheque',
    label: 'Cheque',
    referenceLabel: 'cheque number',
    referencePlaceholder: 'Cheque number',
    expectsReference: true,
  },
  {
    value: 'card',
    label: 'Card',
    referenceLabel: 'approval code',
    referencePlaceholder: 'Card / approval reference',
    expectsReference: false,
  },
]

export function findMode(value: string): PaymentMode | undefined {
  return PAYMENT_MODES.find((mode) => mode.value === value)
}

/** A mode that came back from the API, named for a human. Unknown ones read as-is. */
export function modeLabel(value: string | null): string | null {
  if (!value) return null
  const known = findMode(value)
  if (known) return known.value === 'bank_transfer' ? 'Bank transfer' : known.label
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

// ---------------------------------------------------------------------------
// Quick-add purposes
// ---------------------------------------------------------------------------

export type PurposeKey = 'bills' | 'expense' | 'advance' | 'settlement' | 'other'

/**
 * What the chips under the narration actually do.
 *
 * NOTHING HERE IS SENT TO THE API. There is no "purpose" field on a payment in
 * Books and Billing does not invent one, so a chip that merely recorded a word
 * would be a control that looks like it classifies an entry and does not. Each
 * one instead changes something real on this screen — how the money is applied
 * to open bills, or which screen you should be on — and that is the whole of
 * its effect.
 */
export interface Purpose {
  key: PurposeKey
  label: string
  hint: string
  effect: 'allocate-oldest' | 'on-account' | 'allocate-all' | 'go-to-expense' | 'clear'
}

export function purposesFor(direction: Direction): Purpose[] {
  const against = direction === 'out' ? 'bills' : 'invoices'

  const shared: Purpose[] = [
    {
      key: 'bills',
      label: direction === 'out' ? 'Invoice payment' : 'Against invoices',
      hint: `Applied to open ${against}, oldest first.`,
      effect: 'allocate-oldest',
    },
    {
      key: 'advance',
      label: direction === 'out' ? 'Advance payment' : 'Advance received',
      hint: `Left on account rather than applied to any ${direction === 'out' ? 'bill' : 'invoice'}.`,
      effect: 'on-account',
    },
    {
      key: 'settlement',
      label: 'Settlement',
      hint: `Applied across every open ${against} this covers.`,
      effect: 'allocate-all',
    },
    { key: 'other', label: 'Other', hint: 'No change to how this is applied.', effect: 'clear' },
  ]

  if (direction === 'in') return shared

  // An expense is a different document in Books — it needs the account it is
  // spent ON, which this form has no field for. So the chip goes to the screen
  // that does, instead of pretending this one can record it.
  return [
    shared[0],
    {
      key: 'expense',
      label: 'Expense payment',
      hint: 'Recorded on the expense screen, which asks what it was spent on.',
      effect: 'go-to-expense',
    },
    ...shared.slice(1),
  ]
}

// ---------------------------------------------------------------------------
// Money, in paise
// ---------------------------------------------------------------------------

/** Rupees as typed → whole paise. Anything unreadable is 0. */
export function toPaise(value: string | number | null | undefined): number {
  const amount = typeof value === 'string' ? Number.parseFloat(value) : (value ?? 0)
  if (!Number.isFinite(amount)) return 0
  return Math.round(amount * 100)
}

export function fromPaise(paise: number): number {
  return paise / 100
}

/**
 * What the user is allowed to have in the amount box while they are typing.
 *
 * Applied on every keystroke, so it must never reorder or reformat what is
 * already there — inserting a thousands separator mid-entry moves the caret and
 * the next digit lands in the wrong place. It only removes what cannot belong.
 */
export function sanitiseAmount(raw: string): string {
  let cleaned = raw.replace(/[^\d.]/g, '')

  const firstDot = cleaned.indexOf('.')
  if (firstDot !== -1) {
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
    const [whole, decimals = ''] = cleaned.split('.')
    cleaned = `${whole}.${decimals.slice(0, 2)}`
  }

  return cleaned
}

/** Today, in the browser's own day. Replaced by the company's day once known. */
export function localToday(): string {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

/** "28 days", "1 day", "today" — the tail of a sentence, not a sentence. */
export function daysAgoWords(days: number): string {
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

/** Initials for an avatar, from a name we actually have. Never from a uuid. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** True when the party context is trustworthy enough to put a sentence on screen. */
export function partyContextIsUsable(context: MoneyPartyContext | null): boolean {
  return context !== null && context.available && context.complete
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

/**
 * The windows the summary offers.
 *
 * Exactly the keys the backend's `Period::resolve` understands, and no more.
 * A "Financial year" option is not offered because Period has no fiscal-year
 * window — it would silently resolve to the default month and show a figure
 * under a label that is not what it is.
 */
export const MONEY_PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'year', label: 'This year' },
] as const

export type MoneyPeriodKey = (typeof MONEY_PERIODS)[number]['key']
