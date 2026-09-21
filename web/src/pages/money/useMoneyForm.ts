/**
 * The money entry form's state, validation and save.
 *
 * Split out of the markup because this is the part that has to be right: it
 * decides what goes to Books. The request body it builds is the SAME one this
 * screen has always sent — `party_account_id`, `amount`, `date`,
 * `cash_bank_account_id`, `payment_mode`, `instrument_no`, `allocations` — with
 * `narration` added, which the backend already stored for every other kind and
 * this screen simply never sent.
 *
 * Nothing about the quick-add chips reaches the API. They move money between
 * "applied to a bill" and "on account", which is a real difference Books acts
 * on, and that is all they do.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../../services/api'
import type { CatalogParty, TransactionRequest } from '../../services/types'
import { findMode, sanitiseAmount, toPaise, type Direction, type PurposeKey } from './money'

export interface OpenBill {
  bill_no: string | null
  bill_date: string | null
  due_date: string | null
  balance: number
  voucher_id: number | null
  voucher_uuid: string | null
}

export interface PickedParty {
  id: number
  name: string
  gstin?: string | null
}

export type FieldName = 'party' | 'amount' | 'entryDate' | 'accountId' | 'mode' | 'allocations'

export interface MoneyFormValues {
  party: PickedParty | null
  amount: string
  entryDate: string
  accountId: string
  mode: string
  reference: string
  narration: string
  purpose: PurposeKey | null
}

export const NARRATION_LIMIT = 500

export function billKey(bill: OpenBill): string {
  return String(bill.voucher_id ?? bill.bill_no)
}

export function useMoneyForm({
  direction,
  bills,
  today,
  onSaved,
  onFailed,
}: {
  direction: Direction
  bills: OpenBill[]
  /** The company's today, once the server has told us what it is. */
  today: string
  onSaved: (result: { requestId: number; amount: number; partyName: string; savedAndNew: boolean }) => void
  onFailed: (message: string) => void
}) {
  const isOut = direction === 'out'

  const [values, setValues] = useState<MoneyFormValues>(() => ({
    party: null,
    amount: '',
    entryDate: today,
    accountId: '',
    mode: 'cash',
    reference: '',
    narration: '',
    purpose: null,
  }))

  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [allocations, setAllocations] = useState<Record<string, string>>({})
  const [autoAllocate, setAutoAllocate] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [retryId, setRetryId] = useState<number | null>(null)
  const [dateTouched, setDateTouched] = useState(false)

  // A second Save while the first is still in the air would be a second
  // payment. The ref, not the state flag, is what guards it: two clicks in the
  // same tick both read the old state.
  const inFlight = useRef(false)

  const set = useCallback(<K extends keyof MoneyFormValues>(field: K, value: MoneyFormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }))
  }, [])

  /** An error goes as soon as the user starts fixing what it is about. */
  const clearError = useCallback((field: FieldName) => {
    setErrors((current) => {
      if (!(field in current)) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }, [])

  const setAmount = useCallback(
    (raw: string) => {
      set('amount', sanitiseAmount(raw))
      clearError('amount')
    },
    [set, clearError],
  )

  const pickParty = useCallback(
    (party: CatalogParty) => {
      set('party', { id: party.acc_id, name: party.acc_name, gstin: party.gstin })
      clearError('party')
    },
    [set, clearError],
  )

  const clearParty = useCallback(() => {
    set('party', null)
    setAllocations({})
  }, [set])

  const setEntryDate = useCallback(
    (value: string) => {
      setDateTouched(true)
      set('entryDate', value)
      clearError('entryDate')
    },
    [set, clearError],
  )

  /**
   * Adopt the company's today once the server has said what it is.
   *
   * Only while the user has not touched the field, and only when it still holds
   * whatever we guessed from the browser. A shop open at 9pm in Kolkata is
   * still open when a UTC clock has started tomorrow, and an entry dated a day
   * out lands in the wrong day's cash.
   */
  const adoptBusinessDate = useCallback(
    (businessToday: string) => {
      if (dateTouched || !businessToday) return
      setValues((current) => (current.entryDate === businessToday ? current : { ...current, entryDate: businessToday }))
    },
    [dateTouched],
  )

  // -------------------------------------------------------------------------
  // Allocation
  // -------------------------------------------------------------------------

  /** Oldest bill first, until the money runs out — what most people do by hand. */
  const allocateAutomatically = useCallback(
    (totalPaise: number): Record<string, string> => {
      let left = totalPaise
      const next: Record<string, string> = {}
      for (const bill of [...bills].sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))) {
        if (left <= 0) break
        const applied = Math.min(left, toPaise(bill.balance))
        next[billKey(bill)] = (applied / 100).toFixed(2)
        left -= applied
      }
      return next
    },
    [bills],
  )

  const amountPaise = toPaise(values.amount)

  const effectiveAllocations = useMemo(
    () => (autoAllocate ? allocateAutomatically(amountPaise) : allocations),
    [autoAllocate, allocateAutomatically, amountPaise, allocations],
  )

  const allocatedPaise = useMemo(
    () => Object.values(effectiveAllocations).reduce((sum, value) => sum + toPaise(value), 0),
    [effectiveAllocations],
  )

  const setAllocation = useCallback(
    (key: string, value: string) => {
      setAllocations((current) => ({ ...current, [key]: sanitiseAmount(value) }))
      clearError('allocations')
    },
    [clearError],
  )

  /**
   * What a quick-add chip does.
   *
   * `go-to-expense` is handled by the caller, which owns the router and the
   * unsaved-changes question. Everything else is a change to how this entry is
   * applied, which is this hook's business.
   */
  const applyPurpose = useCallback(
    (key: PurposeKey, effect: string) => {
      set('purpose', key)
      if (effect === 'allocate-oldest' || effect === 'allocate-all') {
        setAutoAllocate(true)
        setAllocations({})
      } else if (effect === 'on-account') {
        setAutoAllocate(false)
        setAllocations({})
      }
      clearError('allocations')
    },
    [set, clearError],
  )

  const clearPurpose = useCallback(() => set('purpose', null), [set])

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  function validate(): Partial<Record<FieldName, string>> {
    const found: Partial<Record<FieldName, string>> = {}

    if (!values.party) {
      found.party = isOut ? 'Select a supplier or party.' : 'Select a customer or party.'
    }
    if (amountPaise <= 0) {
      found.amount = 'Enter a valid amount greater than zero.'
    }
    if (!values.entryDate) {
      found.entryDate = 'Choose the date this money moved.'
    }
    if (!values.accountId) {
      found.accountId = isOut
        ? 'Select the account the money was paid from.'
        : 'Select the account the money was received into.'
    }
    if (!values.mode) {
      found.mode = 'Select a payment mode.'
    }
    // The backend refuses this too. Catching it here means the user is told
    // beside the number that is wrong rather than in a banner at the top.
    if (amountPaise > 0 && allocatedPaise > amountPaise) {
      found.allocations = 'You have applied more than the amount of this entry.'
    }

    return found
  }

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------

  const reset = useCallback(
    (keepDate: string) => {
      setValues({
        party: null,
        amount: '',
        entryDate: keepDate,
        // The account and the mode are the same for a run of entries far more
        // often than not, so they survive a Save & New.
        accountId: '',
        mode: 'cash',
        reference: '',
        narration: '',
        purpose: null,
      })
      setAllocations({})
      setAutoAllocate(true)
      setErrors({})
      setSaveError(null)
      setRetryId(null)
    },
    [],
  )

  async function save(saveAndNew: boolean) {
    if (inFlight.current) return

    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) {
      setSaveError(null)
      return
    }

    const party = values.party!
    const amount = amountPaise / 100

    inFlight.current = true
    setSaving(true)
    setSaveError(null)
    setRetryId(null)

    try {
      const response = await api.post<TransactionRequest>(`v1/transactions/${isOut ? 'payment' : 'receipt'}`, {
        party_account_id: party.id,
        amount,
        date: values.entryDate,
        cash_bank_account_id: Number(values.accountId),
        payment_mode: values.mode,
        instrument_no: values.reference.trim() || undefined,
        narration: values.narration.trim() || undefined,
        allocations: Object.entries(effectiveAllocations)
          .filter(([, value]) => toPaise(value) > 0)
          .map(([key, value]) => {
            const bill = bills.find((candidate) => billKey(candidate) === key)
            return { voucher_id: bill?.voucher_id, bill_no: bill?.bill_no, amount: toPaise(value) / 100 }
          }),
      })

      const keepDate = values.entryDate
      if (saveAndNew) reset(keepDate)

      onSaved({
        requestId: response.data.request_id,
        amount,
        partyName: party.name,
        savedAndNew: saveAndNew,
      })
    } catch (err) {
      // Everything the user typed stays exactly where it is. Re-keying a
      // payment because the network blinked is how the same payment gets
      // entered twice.
      if (err instanceof ApiError) {
        setSaveError(err.message)
        const id = err.details.request_id
        if (err.retryable && typeof id === 'number') setRetryId(id)
        // A field the backend named gets the message put against it.
        const field = err.details.field
        if (typeof field === 'string') {
          const mapped: Record<string, FieldName> = {
            party_account_id: 'party',
            amount: 'amount',
            date: 'entryDate',
            vch_date: 'entryDate',
            cash_bank_account_id: 'accountId',
            payment_mode: 'mode',
            allocations: 'allocations',
          }
          if (mapped[field]) setErrors((current) => ({ ...current, [mapped[field]]: err.message }))
        }
        onFailed(err.message)
      } else {
        const message = 'Unable to save this entry. Please try again.'
        setSaveError(message)
        onFailed(message)
      }
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  /** Re-send a request that never reached Books, on its original key. */
  async function retry() {
    if (retryId === null || inFlight.current) return

    inFlight.current = true
    setSaving(true)
    try {
      const response = await api.post<TransactionRequest>(`v1/transactions/${retryId}/retry`, {})
      onSaved({
        requestId: response.data.request_id,
        amount: amountPaise / 100,
        partyName: values.party?.name ?? '',
        savedAndNew: false,
      })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Unable to save this entry. Please try again.'
      setSaveError(message)
      onFailed(message)
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  /** Anything typed that would be lost by leaving. */
  const dirty =
    values.party !== null ||
    values.amount.trim() !== '' ||
    values.reference.trim() !== '' ||
    values.narration.trim() !== ''

  return {
    values,
    set,
    setAmount,
    setEntryDate,
    pickParty,
    clearParty,
    adoptBusinessDate,
    errors,
    clearError,
    amountPaise,
    allocations: effectiveAllocations,
    allocatedPaise,
    setAllocation,
    autoAllocate,
    setAutoAllocate,
    applyPurpose,
    clearPurpose,
    mode: findMode(values.mode),
    saving,
    saveError,
    setSaveError,
    retryId,
    retry,
    save,
    reset,
    dirty,
  }
}
