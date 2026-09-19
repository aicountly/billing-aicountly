/**
 * What is already true about the supplier on the screen.
 *
 * Both figures are read live from Books through endpoints this product already
 * has: the outstanding balance and open bills from the payables report, and the
 * count of bills already on the register from the original-documents read the
 * debit-note screen uses.
 *
 * NOTHING IS SYNTHESISED. A user whose Billing profile cannot see payables gets
 * a supplier card that says the figure is not theirs to see, not a zero; a
 * Books that cannot be reached gets a card that says so, not a blank that reads
 * as "nothing owed". The difference matters when the number is money.
 */

import { useEffect, useState } from 'react'
import { api, ApiError } from '../../services/api'
import type { Dues } from '../../services/types'
import { useBilling } from '../../context/BillingContext'

interface OriginalDocument {
  voucher_id: number | null
  document_no: string | null
  date: string | null
  amount: number | null
}

export interface SupplierInsight {
  loading: boolean
  /** Outstanding payable to this supplier, or null when it could not be read. */
  outstanding: number | null
  overdue: number | null
  openBills: number | null
  /** Bills already on Books' purchase register for this supplier, last 12 months. */
  recentPurchases: number | null
  /** The supplier's recent bills, for the duplicate check. Empty when unavailable. */
  documents: OriginalDocument[]
  /** Set when there is nothing to show and the user deserves to know why. */
  unavailable: string | null
}

const EMPTY: SupplierInsight = {
  loading: false,
  outstanding: null,
  overdue: null,
  openBills: null,
  recentPurchases: null,
  documents: [],
  unavailable: null,
}

export function useSupplierInsight(supplierId: number | null): SupplierInsight {
  const { scope, can } = useBilling()
  const [state, setState] = useState<SupplierInsight>(EMPTY)

  const maySeePayables = can('payable.view')
  // The register read behind "recent purchases" is the debit-note screen's
  // endpoint and carries its permission. Without it we simply do not ask.
  const mayReadRegister = can('debit_note.create')
  const cmpId = scope?.cmp_id
  const fyId = scope?.fy_id

  useEffect(() => {
    if (!supplierId || !scope) {
      setState(EMPTY)
      return undefined
    }

    if (!maySeePayables && !mayReadRegister) {
      setState({ ...EMPTY, unavailable: 'Your Billing profile does not include supplier balances.' })
      return undefined
    }

    const controller = new AbortController()
    let cancelled = false
    setState({ ...EMPTY, loading: true })

    const payables = maySeePayables
      ? api
          .one<Dues>('v1/payables', { account_id: supplierId }, controller.signal)
          .then((response) => response.data)
          .catch((error: unknown) => {
            if (error instanceof ApiError && error.status === 403) return null
            throw error
          })
      : Promise.resolve(null)

    const register = mayReadRegister
      ? api
          .one<{ documents: OriginalDocument[] }>(
            'v1/original-documents',
            { party_account_id: supplierId, kind: 'purchase' },
            controller.signal,
          )
          .then((response) => response.data.documents ?? [])
          .catch(() => {
            // A register that will not answer costs this one hint and nothing
            // else. The bill can still be entered and saved.
            return [] as OriginalDocument[]
          })
      : Promise.resolve([] as OriginalDocument[])

    Promise.all([payables, register])
      .then(([dues, documents]) => {
        if (cancelled || controller.signal.aborted) return

        const forSupplier = dues?.parties?.find((party) => party.account_id === supplierId) ?? null

        setState({
          loading: false,
          outstanding: dues ? dues.total : null,
          overdue: dues ? dues.overdue : null,
          openBills: forSupplier ? forSupplier.bill_count : dues ? dues.bills.length : null,
          recentPurchases: mayReadRegister ? documents.length : null,
          documents: documents.slice(0, 25),
          unavailable:
            dues === null && documents.length === 0
              ? maySeePayables
                ? 'Could not reach Smart Books for this supplier just now.'
                : 'Your Billing profile does not include supplier balances.'
              : null,
        })
      })
      .catch((error: unknown) => {
        if (cancelled || controller.signal.aborted) return
        setState({
          ...EMPTY,
          unavailable:
            error instanceof ApiError
              ? 'Could not reach Smart Books for this supplier just now.'
              : 'Could not read this supplier’s history.',
        })
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [supplierId, cmpId, fyId, maySeePayables, mayReadRegister, scope])

  return state
}
