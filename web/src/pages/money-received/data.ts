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
import type { CashBankAccount, Dues, MoneyActivity } from '../../services/types'

/** A bill Books says is still open for this party. */
export interface OpenBill {
  bill_no: string | null
  bill_date: string | null
  due_date: string | null
  balance: number
  voucher_id: number | null
  voucher_uuid: string | null
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
 * Receipts already recorded.
 *
 * `v1/money/recent` is the money screens' own endpoint, and it answers the one
 * question this panel exists for better than the receipt register alone can:
 * the register is Books', so it knows the date, the party and the amount, and
 * the MODE, the REFERENCE and WHICH ACCOUNT are Billing's, from the request row
 * written when somebody pressed Save. It joins the two on the voucher id — so a
 * receipt entered in Books shows with those cells empty rather than not showing.
 *
 * It is gated on `receipt.create`, which is the permission this whole screen
 * already needs, so nobody who may record a receipt is refused the list of them.
 *
 * Ninety days rather than this month: the panel answers "did I already enter
 * this one?", and on the 1st of a month a calendar month answers that with an
 * empty table.
 */
export function useRecentReceipts(days = 90, limit = 50) {
  const { scope } = useBilling()

  const window = useMemo(() => {
    const to = new Date()
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000)
    return { from: isoDate(from), to: isoDate(to) }
  }, [days])

  const state = useApi(
    (signal) =>
      api.one<MoneyActivity>(
        'v1/money/recent',
        { direction: 'in', from: window.from, to: window.to, limit },
        signal,
      ),
    [window.from, window.to, limit, scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    Boolean(scope),
  )

  return { ...state, window }
}

/** `YYYY-MM-DD` in the browser's own day, which is the day the user means. */
export function isoDate(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${value.getFullYear()}-${month}-${day}`
}
