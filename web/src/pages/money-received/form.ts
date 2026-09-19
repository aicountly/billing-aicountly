/**
 * The receipt being typed, and the arithmetic over it.
 *
 * Two things this file is careful about.
 *
 * ALLOCATION IS MONEY. Every figure here is worked out in whole paise as
 * integers and converted back once, at the edge. Adding 8,333.33 three times in
 * floating point and comparing it with 24,999.99 is how a receipt that is
 * exactly allocated reports itself as over-allocated by a hundredth of a rupee.
 *
 * SIMPLE STILL SETTLES BILLS. The screen this replaced auto-allocated a receipt
 * against the customer's oldest open bills, and Simple continues to: the tabs
 * change what the user is SHOWN, never what is posted behind their back. The
 * one tab that changes the accounting is Advance, which says so on its face.
 *
 * Nothing here decides the accounting. Billing sends what the user chose and
 * Books validates it against the bills it knows are still open.
 */

import { useCallback, useMemo, useState } from 'react'
import type { OpenBill } from './data'

export type ReceiptType = 'simple' | 'against_invoice' | 'advance' | 'refund'

/** Where the user wants to be once the receipt is saved. */
export type SaveTarget = 'stay' | 'another' | 'view'

/**
 * The payment modes the receipt API already accepts.
 *
 * The VALUES are the existing wire contract and are not renamed here — Books
 * receives `bank_transfer`, not "NEFT". The labels say NEFT, RTGS and IMPS
 * because that is what somebody at a counter is looking for, and all three are
 * the same bank transfer as far as the voucher is concerned.
 */
export const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'bank_transfer', label: 'Bank transfer (NEFT / RTGS / IMPS)' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'card', label: 'Card' },
] as const

export type PaymentMode = (typeof PAYMENT_MODES)[number]['value']

/** What the reference box is asking for, in the words of the mode chosen. */
export const REFERENCE_HINTS: Record<PaymentMode, { label: string; placeholder: string }> = {
  cash: { label: 'Reference no.', placeholder: 'Receipt or slip number' },
  upi: { label: 'UPI reference', placeholder: 'UPI / UTR reference' },
  bank_transfer: { label: 'Transaction reference', placeholder: 'UTR / transaction reference' },
  cheque: { label: 'Cheque no.', placeholder: 'Cheque number' },
  card: { label: 'Transaction reference', placeholder: 'Card / terminal reference' },
}

/**
 * A mode in the words the screen uses, whoever wrote it down.
 *
 * Books' register may answer with its own spelling for a receipt this product
 * did not create, so anything unrecognised is tidied rather than dropped.
 */
export function modeWords(mode: string | null | undefined): string {
  if (!mode) return '—'

  const known = PAYMENT_MODES.find((entry) => entry.value === mode)
  if (known) return known.value === 'bank_transfer' ? 'Bank transfer' : known.label

  return mode.replace(/_/g, ' ').replace(/^./, (first) => first.toUpperCase())
}

export interface ChosenParty {
  id: number
  name: string
  gstin?: string | null
}

export interface ReceiptFieldErrors {
  party?: string
  amount?: string
  entryDate?: string
  accountId?: string
  allocations?: string
}

/** Whole paise, as an integer. Everything monetary is compared in this unit. */
export function toPaise(value: number): number {
  return Math.round(value * 100)
}

export function fromPaise(paise: number): number {
  return paise / 100
}

/**
 * What the user typed, as a number — or null when it is not one yet.
 *
 * Grouping separators are stripped because people paste "1,20,000" out of a
 * message, and a lone "." or "12." is "still typing" rather than invalid.
 */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[\s,₹]/g, '')
  if (cleaned === '' || cleaned === '.') return null
  if (!/^\d*\.?\d*$/.test(cleaned)) return null

  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

/** Indian digit grouping, without the symbol — for showing a figure inside an input. */
export function groupAmount(value: number): string {
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

export function billKey(bill: OpenBill): string {
  return String(bill.voucher_id ?? bill.bill_no ?? '')
}

/** Oldest due date first, then oldest bill date — what most people do by hand. */
export function oldestFirst(bills: OpenBill[]): OpenBill[] {
  return [...bills].sort((a, b) => {
    const due = (a.due_date ?? a.bill_date ?? '').localeCompare(b.due_date ?? b.bill_date ?? '')
    return due !== 0 ? due : (a.bill_date ?? '').localeCompare(b.bill_date ?? '')
  })
}

/**
 * Oldest bill first until the money runs out.
 *
 * Never more than a bill's own balance and never more than the receipt, so an
 * automatic allocation cannot produce something Books will refuse.
 */
export function allocateOldestFirst(bills: OpenBill[], amountPaise: number): Record<string, string> {
  let left = Math.max(amountPaise, 0)
  const next: Record<string, string> = {}

  for (const bill of oldestFirst(bills)) {
    if (left <= 0) break
    const key = billKey(bill)
    if (key === '') continue

    const applied = Math.min(left, toPaise(bill.balance))
    if (applied <= 0) continue

    next[key] = fromPaise(applied).toFixed(2)
    left -= applied
  }

  return next
}

export interface ReceiptForm {
  party: ChosenParty | null
  setParty: (party: ChosenParty | null) => void
  amount: string
  setAmount: (amount: string) => void
  entryDate: string
  setEntryDate: (date: string) => void
  accountId: string
  setAccountId: (id: string) => void
  mode: PaymentMode
  setMode: (mode: PaymentMode) => void
  reference: string
  setReference: (reference: string) => void
  instrumentDate: string
  setInstrumentDate: (date: string) => void
  remarks: string
  setRemarks: (remarks: string) => void
  receiptType: ReceiptType
  setReceiptType: (type: ReceiptType) => void
  autoAllocate: boolean
  setAutoAllocate: (auto: boolean) => void
  manualAllocations: Record<string, string>
  setAllocation: (key: string, value: string) => void
  replaceAllocations: (allocations: Record<string, string>) => void
  reset: (keep?: { party?: boolean }) => void
}

export function useReceiptForm(today: string): ReceiptForm {
  const [party, setParty] = useState<ChosenParty | null>(null)
  const [amount, setAmount] = useState('')
  const [entryDate, setEntryDate] = useState(today)
  const [accountId, setAccountId] = useState('')
  const [mode, setMode] = useState<PaymentMode>('cash')
  const [reference, setReference] = useState('')
  const [instrumentDate, setInstrumentDate] = useState('')
  const [remarks, setRemarks] = useState('')
  const [receiptType, setReceiptType] = useState<ReceiptType>('simple')
  const [autoAllocate, setAutoAllocate] = useState(true)
  const [manualAllocations, setManualAllocations] = useState<Record<string, string>>({})

  const setAllocation = useCallback((key: string, value: string) => {
    setManualAllocations((current) => ({ ...current, [key]: value }))
  }, [])

  const reset = useCallback(
    (keep?: { party?: boolean }) => {
      if (!keep?.party) setParty(null)
      setAmount('')
      setEntryDate(today)
      setMode('cash')
      setReference('')
      setInstrumentDate('')
      setRemarks('')
      setReceiptType('simple')
      setAutoAllocate(true)
      setManualAllocations({})
      // The account is deliberately kept: the next receipt of the day almost
      // always lands in the same till or bank as the last one.
    },
    [today],
  )

  return {
    party,
    setParty,
    amount,
    setAmount,
    entryDate,
    setEntryDate,
    accountId,
    setAccountId,
    mode,
    setMode,
    reference,
    setReference,
    instrumentDate,
    setInstrumentDate,
    remarks,
    setRemarks,
    receiptType,
    setReceiptType,
    autoAllocate,
    setAutoAllocate,
    manualAllocations,
    setAllocation,
    replaceAllocations: setManualAllocations,
    reset,
  }
}

export interface ReceiptMaths {
  amountPaise: number
  allocations: Record<string, string>
  allocatedPaise: number
  unallocatedPaise: number
  overAllocated: boolean
  /** Bills whose own allocation exceeds what is outstanding on them. */
  overAllocatedBills: string[]
}

/**
 * What will actually be sent, given the tab, the bills and the amount.
 *
 * Advance allocates nothing, on purpose. Simple and Against Invoice allocate;
 * the difference between them is whether the user is shown the table.
 */
export function useReceiptMaths(form: ReceiptForm, bills: OpenBill[]): ReceiptMaths {
  const { amount, receiptType, autoAllocate, manualAllocations } = form

  return useMemo(() => {
    const amountPaise = toPaise(parseAmount(amount) ?? 0)

    const automatic = receiptType === 'advance' ? {} : allocateOldestFirst(bills, amountPaise)
    const allocations =
      receiptType === 'against_invoice' && !autoAllocate
        ? Object.fromEntries(
            Object.entries(manualAllocations).filter(([key]) => bills.some((bill) => billKey(bill) === key)),
          )
        : automatic

    let allocatedPaise = 0
    const overAllocatedBills: string[] = []

    for (const [key, value] of Object.entries(allocations)) {
      const applied = toPaise(parseAmount(value) ?? 0)
      if (applied <= 0) continue
      allocatedPaise += applied

      const bill = bills.find((row) => billKey(row) === key)
      if (bill && applied > toPaise(bill.balance)) overAllocatedBills.push(key)
    }

    return {
      amountPaise,
      allocations,
      allocatedPaise,
      unallocatedPaise: amountPaise - allocatedPaise,
      overAllocated: allocatedPaise > amountPaise,
      overAllocatedBills,
    }
  }, [amount, receiptType, autoAllocate, manualAllocations, bills])
}
