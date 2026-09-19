/**
 * What the Money received screen reads, and where each figure comes from.
 *
 * Every one of these is an endpoint this product already had. Nothing on this
 * screen is stored by Billing: the open bills, the customer's outstanding, the
 * receipts already recorded and the accounts money can be received into are all
 * read from the product that owns them, on the request that draws them.
 *
 *   customers        v1/catalog/parties        → Smart Books' accounts
 *   received in      v1/catalog/cash-bank      → Smart Books' cash and bank ledgers
 *   open bills       v1/open-bills             → Smart Books' bill-by-bill
 *   outstanding      v1/receivables            → Smart Books' bill-by-bill, aged here
 *   recent receipts  v1/reports/receipts       → Smart Books' receipt register
 *   saving           v1/transactions/receipt   → Books makes the voucher
 */

import { useMemo } from 'react'
import { api } from '../../services/api'
import { useApi } from '../../hooks/useApi'
import { useBilling } from '../../context/BillingContext'
import type { CashBankAccount, Dues } from '../../services/types'

/** A bill Books says is still open for this party. */
export interface OpenBill {
  bill_no: string | null
  bill_date: string | null
  due_date: string | null
  balance: number
  voucher_id: number | null
  voucher_uuid: string | null
}

/**
 * One row of Books' receipt register.
 *
 * `payment_mode`, `reference_no` and `received_in` are null whenever the
 * register does not carry them — they are shown as "—" rather than guessed at,
 * the same rule the rest of this product follows for a figure it cannot read.
 */
export interface ReceiptRow {
  voucher_id: number | null
  voucher_uuid: string | null
  document_no: string | null
  date: string | null
  party: string | null
  party_id: number | null
  amount: number | null
  status: string | null
  payment_mode?: string | null
  reference_no?: string | null
  received_in?: string | null
}

export interface ReceiptRegister {
  key: string
  label: string
  rows: ReceiptRow[]
  total: number | null
  complete: boolean
  period: { from: string; to: string }
  note: string
}

/** The cash and bank ledgers this company receives money into. */
export function useCashBankAccounts() {
  const { scope } = useBilling()

  return useApi(
    (signal) => api.list<CashBankAccount>('v1/catalog/cash-bank', undefined, signal),
    [scope?.cmp_id, scope?.bo_id],
    Boolean(scope),
  )
}

/**
 * The bills this customer has not settled.
 *
 * Read again every time the customer changes, and never cached across them:
 * allocating against a bill somebody settled this morning is exactly what a
 * stored copy would let you do.
 */
export function useOpenBills(partyId: number | null) {
  const { scope } = useBilling()

  return useApi(
    (signal) =>
      api.one<{ account_id: number; bills: OpenBill[]; source: string }>(
        'v1/open-bills',
        { account_id: partyId, side: 'receivable' },
        signal,
      ),
    [partyId, scope?.cmp_id, scope?.fy_id],
    Boolean(scope && partyId),
  )
}

/**
 * What this customer owes, and how much of it is late.
 *
 * The receivables endpoint takes an account filter, so this is the same
 * bill-by-bill reading the Money to Collect screen draws — for one party.
 * Gated on the profile permission rather than called and refused, so a counter
 * biller who may take money but may not see the ledger gets a quiet panel
 * instead of a 403 in the console.
 */
export function useCustomerDues(partyId: number | null) {
  const { scope, can } = useBilling()
  const allowed = can('receivable.view')

  const state = useApi(
    (signal) => api.one<Dues>('v1/receivables', { account_id: partyId }, signal),
    [partyId, scope?.cmp_id, scope?.fy_id, scope?.bo_id, allowed],
    Boolean(scope && partyId && allowed),
  )

  return { ...state, allowed }
}

/**
 * Receipts already recorded, from Books' own register.
 *
 * Ninety days rather than this month: the panel is there to answer "did I
 * already enter this one?", and on the 1st of a month a calendar month answers
 * that with an empty table.
 */
export function useRecentReceipts(days = 90) {
  const { scope, can } = useBilling()
  const allowed = can('reports.view')

  const window = useMemo(() => {
    const to = new Date()
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)
    return { from: isoDate(from), to: isoDate(to) }
  }, [days])

  const state = useApi(
    (signal) => api.one<ReceiptRegister>('v1/reports/receipts', { from: window.from, to: window.to }, signal),
    [window.from, window.to, scope?.cmp_id, scope?.fy_id, scope?.bo_id, allowed],
    Boolean(scope && allowed),
  )

  return { ...state, allowed, window }
}

/** `YYYY-MM-DD` in the browser's own day, which is the day the user means. */
export function isoDate(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${value.getFullYear()}-${month}-${day}`
}
