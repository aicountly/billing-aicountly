/**
 * Bank deposit — the counter's takings, into the bank.
 *
 * WHAT IT IS UNDERNEATH. A contra voucher in Smart Books: the chosen bank
 * account is debited and the chosen cash account credited. None of those three
 * words appear on screen, and none of that arithmetic happens here — Books is
 * sent "this much, from this account, into that one" and decides the rest. This
 * file posts through the same TransactionService route every other entry in the
 * product uses, on the same idempotency key, so pressing Save twice cannot bank
 * the day's takings twice.
 *
 * WHAT IT READS, AND HOW OFTEN. Four calls on load and not one per row:
 *
 *   v1/catalog/cash-bank      the ledgers to choose between        (Books, live)
 *   v1/cash-bank              their balances, if this profile may   (Books, live)
 *   v1/cash-bank/movements    the last few deposits                 (Books, live)
 *   v1/manage/companyinfo     the financial year's own dates        (Manage, live)
 *
 * Nothing is stored here and nothing is cached across a company switch: every
 * figure on this screen was read on the request that drew it.
 *
 * WHAT THE RIGHT-HAND RAIL IS FOR. Everything on it answers a question somebody
 * asks while typing — "have I already banked this?", "is there that much in the
 * till?", "what did I bank last week?" — at the moment they ask it, rather than
 * after they have saved and gone looking.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  Info,
  Landmark,
  Lightbulb,
  Loader2,
  RotateCcw,
  X,
} from 'lucide-react'
import { api, ApiError } from '../../services/api'
import type {
  CashBank,
  CashBankAccount,
  DepositCapabilities,
  DepositSummary,
  RecentDeposit,
  RecentDeposits,
  StoredBill,
  TransactionRequest,
} from '../../services/types'
import { useApi } from '../../hooks/useApi'
import { useBilling } from '../../context/BillingContext'
import { fetchCompanyInfo } from '../../services/manage'
import { accountsFor, buildAccountOptions, type AccountOption } from '../../services/cashBankAccounts'
import { AccountSelect } from '../../components/AccountSelect'
import { ConfirmDialog, useNavigationGuard } from '../../components/NavigationGuard'
import { SlipUploader } from './SlipUploader'
import { date as formatDate, money, Notice, ToastStack, useToasts } from '../../ui'
import '../../styles/billing-bank-deposit.css'

type DepositType = 'cash' | 'cheque'
type FieldKey = 'amount' | 'date' | 'from' | 'to' | 'chequeNo' | 'chequeDate'

interface FormState {
  amount: string
  entryDate: string
  depositType: DepositType
  chequeNo: string
  chequeDate: string
  fromId: string
  toId: string
  reference: string
  notes: string
}

/** Four fits the card without the rail growing past the form beside it. */
const RECENT_LIMIT = 4

const NOTES_LIMIT = 500
const REFERENCE_LIMIT = 120
const TIP_KEY = 'billing:tip:bank-deposit'

function emptyForm(today: string): FormState {
  return {
    amount: '',
    entryDate: today,
    depositType: 'cash',
    chequeNo: '',
    chequeDate: '',
    fromId: '',
    toId: '',
    reference: '',
    notes: '',
  }
}

export default function BankDepositPage() {
  const { toasts, push: toast, dismiss: dismissToast } = useToasts()
  const { scope, can } = useBilling()
  const [params] = useSearchParams()
  const resumeId = params.get('draft')

  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const [form, setForm] = useState<FormState>(() => emptyForm(today))
  /** What the form looked like when it was last in step with the server. */
  const [baseline, setBaseline] = useState<FormState>(() => emptyForm(today))
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({})
  const [draftId, setDraftId] = useState<number | null>(null)
  const [busy, setBusy] = useState<null | 'post' | 'draft'>(null)
  const [failure, setFailure] = useState<{ message: string; retryId: number | null } | null>(null)
  const [tipDismissed, setTipDismissed] = useState(() => readTipDismissed())
  const [resetAsked, setResetAsked] = useState(false)
  /**
   * The slip, once the document service has taken it.
   *
   * Not part of the form draft, and deliberately: it is already on the server
   * by the time it is here, so it is not "unsaved" and does not belong in what
   * the discard prompt is asking about.
   */
  const [slip, setSlip] = useState<StoredBill | null>(null)

  // A ref as well as the state: two clicks inside one render pass would both
  // see `busy === null` and both post.
  const inFlight = useRef(false)

  const amountRef = useRef<HTMLInputElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  const fromRef = useRef<HTMLInputElement>(null)
  const toRef = useRef<HTMLInputElement>(null)
  const chequeRef = useRef<HTMLInputElement>(null)

  const maySeeBalances = can('cash.view') || can('bank.view')
  const mayRecord = can('contra.create')

  // ---------------------------------------------------------------- reading

  const accountsQuery = useApi(
    (signal) => api.list<CashBankAccount>('v1/catalog/cash-bank', undefined, signal),
    [scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    Boolean(scope) && mayRecord,
  )

  const balancesQuery = useApi(
    (signal) => api.one<CashBank>('v1/cash-bank', undefined, signal),
    [scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    Boolean(scope) && mayRecord && maySeeBalances,
  )

  const recentQuery = useApi(
    (signal) => api.one<RecentDeposits>('v1/bank-deposits/recent', { limit: RECENT_LIMIT }, signal),
    [scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    Boolean(scope) && mayRecord,
  )

  /**
   * Whether a slip can be kept at all in this deployment.
   *
   * Configuration, not data — the same switch the expense screen reads for a
   * bill, so "can this product hold a document" has one answer here.
   */
  const capabilitiesQuery = useApi(
    (signal) => api.one<DepositCapabilities>('v1/bank-deposits/capabilities', undefined, signal),
    [scope?.cmp_id],
    Boolean(scope) && mayRecord,
  )

  /**
   * What has gone into the chosen bank this month, from what Billing recorded.
   *
   * Asked for only once a bank is chosen, because before that there is nothing
   * to summarise, and it is context beside Books' balance rather than a figure
   * anybody should add to it.
   */
  const bankTotalQuery = useApi(
    (signal) =>
      api.one<DepositSummary>('v1/bank-deposits/summary', { bank_account_id: Number(form.toId) }, signal),
    [scope?.cmp_id, scope?.fy_id, scope?.bo_id, form.toId],
    Boolean(scope) && mayRecord && form.toId !== '',
  )

  // Manage owns the year's dates. They are read rather than assumed because
  // "this financial year" is a different span in a company that runs April to
  // March and one that does not, and a date outside it is refused downstream.
  const companyQuery = useApi(
    (signal) => fetchCompanyInfo(scope!.cmp_id, signal),
    [scope?.cmp_id],
    Boolean(scope) && mayRecord,
  )

  const financialYear = useMemo(
    () => (companyQuery.data?.fyList ?? []).find((fy) => fy.fyId === scope?.fy_id) ?? null,
    [companyQuery.data, scope?.fy_id],
  )

  // ------------------------------------------------------- accounts to pick

  // The same builder the withdrawal screen uses, so the pair cannot disagree
  // about which of a company's ledgers is a bank.
  const accounts = useMemo<AccountOption[]>(
    () => buildAccountOptions(accountsQuery.data?.data ?? [], balancesQuery.data?.data.accounts ?? null),
    [accountsQuery.data, balancesQuery.data],
  )

  // Money leaves a cash-like account and lands in a bank one. Where Books has
  // not said which is which, nothing is hidden — a picker that silently drops
  // the account somebody wants is worse than a longer one.
  const sources = useMemo(() => accountsFor(accounts, 'cash', form.toId), [accounts, form.toId])
  const destinations = useMemo(() => accountsFor(accounts, 'bank', form.fromId), [accounts, form.fromId])

  const fromAccount = accounts.find((account) => String(account.id) === form.fromId) ?? null
  const toAccount = accounts.find((account) => String(account.id) === form.toId) ?? null

  // -------------------------------------------------------- resuming a draft

  const resumeQuery = useApi(
    (signal) => api.one<TransactionRequest>(`v1/transactions/${resumeId}`, undefined, signal),
    [resumeId, scope?.cmp_id],
    Boolean(scope && resumeId && mayRecord),
  )

  useEffect(() => {
    const request = resumeQuery.data?.data
    if (!request || request.kind !== 'bank_deposit' || request.status !== 'DRAFT') return

    const payload = (typeof request.payload === 'string' ? {} : request.payload) as Record<string, unknown>
    const restored: FormState = {
      amount: payload.amount !== undefined && payload.amount !== null ? String(payload.amount) : '',
      entryDate: String(payload.vch_date ?? request.transaction_date ?? today).slice(0, 10),
      depositType: payload.payment_mode === 'cheque' ? 'cheque' : 'cash',
      chequeNo: payload.payment_mode === 'cheque' ? String(payload.instrument_no ?? '') : '',
      chequeDate: payload.payment_mode === 'cheque' ? String(payload.instrument_date ?? '') : '',
      fromId: payload.from_account_id ? String(payload.from_account_id) : '',
      toId: payload.to_account_id ? String(payload.to_account_id) : '',
      reference: String(payload.reference_no ?? ''),
      notes: String(payload.narration ?? ''),
    }

    setForm(restored)
    setBaseline(restored)
    setDraftId(request.request_id)
  }, [resumeQuery.data, today])

  // --------------------------------------------------------- what is unsaved

  const dirty = useMemo(() => !sameForm(form, baseline), [form, baseline])
  const guard = useNavigationGuard(dirty && mayRecord)

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    if (key in FIELD_OF) {
      const field = FIELD_OF[key as keyof typeof FIELD_OF]
      setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))
    }
    setFailure(null)
  }

  // -------------------------------------------------------------- validation

  const amountValue = parseAmount(form.amount)

  const validate = useCallback((): Partial<Record<FieldKey, string>> => {
    const next: Partial<Record<FieldKey, string>> = {}
    const amount = parseAmount(form.amount)

    if (form.amount.trim() === '') next.amount = 'Enter how much is being deposited.'
    else if (amount === null) next.amount = 'Enter an amount in rupees, like 15000 or 15000.50.'
    else if (amount <= 0) next.amount = 'The amount has to be more than zero.'
    else if (!/^\d*(\.\d{0,2})?$/.test(form.amount.trim())) next.amount = 'Use at most two decimal places.'

    if (!form.entryDate) {
      next.date = 'Choose the date of the deposit.'
    } else if (Number.isNaN(Date.parse(form.entryDate))) {
      next.date = 'That is not a date.'
    } else if (financialYear?.start && financialYear.start > form.entryDate) {
      next.date = `${financialYear.label} starts on ${formatDate(financialYear.start)}. Pick a date inside it, or switch year above.`
    } else if (financialYear?.end && financialYear.end < form.entryDate) {
      next.date = `${financialYear.label} ends on ${formatDate(financialYear.end)}. Pick a date inside it, or switch year above.`
    }

    if (!form.fromId) next.from = 'Choose the account the cash came from.'
    if (!form.toId) next.to = 'Choose the bank account it went into.'
    if (form.fromId && form.fromId === form.toId) {
      next.to = 'Source and destination accounts cannot be the same.'
    }

    if (form.depositType === 'cheque') {
      if (!form.chequeNo.trim()) next.chequeNo = 'Enter the cheque number.'
      if (form.chequeDate && Number.isNaN(Date.parse(form.chequeDate))) next.chequeDate = 'That is not a date.'
    }

    return next
  }, [form, financialYear])

  const focusOrder: Array<[FieldKey, React.RefObject<HTMLInputElement | null>]> = [
    ['amount', amountRef],
    ['date', dateRef],
    ['chequeNo', chequeRef],
    ['from', fromRef],
    ['to', toRef],
  ]

  function focusFirstInvalid(found: Partial<Record<FieldKey, string>>) {
    for (const [field, ref] of focusOrder) {
      if (found[field]) {
        ref.current?.focus()
        ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        return
      }
    }
  }

  // ------------------------------------------------------------- the warnings

  const overdrawn = useMemo(() => {
    const balance = fromAccount?.balance
    if (fromAccount === null || balance === null || balance === undefined || amountValue === null) return null
    return amountValue > balance ? { name: fromAccount.name, balance } : null
  }, [fromAccount, amountValue])

  /**
   * "Haven't I already banked this?"
   *
   * Answered from the five deposits already on screen — no extra request, and
   * certainly no scan of the ledger. It is a question, never a block: banking
   * the same amount from the same till twice in a day is unusual, not wrong.
   */
  const possibleDuplicate = useMemo<RecentDeposit | null>(() => {
    if (amountValue === null || !form.fromId || !form.toId) return null
    const rows = recentQuery.data?.data.rows ?? []

    return (
      rows.find(
        (row) =>
          row.date === form.entryDate &&
          row.amount !== null &&
          Math.abs(row.amount - amountValue) < 0.005 &&
          String(row.cash_account_id ?? '') === form.fromId &&
          String(row.bank_account_id ?? '') === form.toId &&
          row.request_id !== draftId,
      ) ?? null
    )
  }, [amountValue, form.entryDate, form.fromId, form.toId, recentQuery.data, draftId])

  // ------------------------------------------------------------------ saving

  const body = useCallback(
    () => ({
      amount: parseAmount(form.amount) ?? 0,
      from_account_id: Number(form.fromId),
      to_account_id: Number(form.toId),
      date: form.entryDate,
      payment_mode: form.depositType,
      instrument_no: form.depositType === 'cheque' ? form.chequeNo.trim() : undefined,
      instrument_date: form.depositType === 'cheque' && form.chequeDate ? form.chequeDate : undefined,
      reference_no: form.reference.trim() || undefined,
      notes: form.notes.trim() || undefined,
      // The reference the document service gave back, never the file.
      attachment_ref: slip?.reference,
    }),
    [form, slip],
  )

  const save = useCallback(
    async (intent: 'post' | 'draft') => {
      if (inFlight.current) return

      const found = validate()
      setErrors(found)
      if (Object.keys(found).length > 0) {
        focusFirstInvalid(found)
        return
      }

      inFlight.current = true
      setBusy(intent)
      setFailure(null)

      try {
        const payload = body()

        // An existing draft is edited and then posted, so the entry keeps ONE
        // request row — and therefore one idempotency key — from the first
        // keystroke to the voucher.
        if (draftId !== null) {
          await api.put<TransactionRequest>(`v1/transactions/${draftId}/draft`, payload)
        }

        if (intent === 'draft') {
          if (draftId === null) {
            const created = await api.post<TransactionRequest>('v1/transactions/bank_deposit/draft', payload)
            setDraftId(created.data.request_id)
          }
          setBaseline(form)
          toast({
            tone: 'info',
            title: 'Saved as a draft.',
            detail: 'It is on the server, not in this browser — finish it from Settings → Entries not saved yet.',
          })
          return
        }

        const posted =
          draftId !== null
            ? await api.post<TransactionRequest>(`v1/transactions/${draftId}/retry`, {})
            : await api.post<TransactionRequest>('v1/transactions/bank_deposit', payload)

        // Cleared before leaving, so the guard does not ask about a form that
        // has just been banked.
        setBaseline(form)
        toast({
          tone: 'success',
          title: 'Bank deposit recorded successfully.',
          detail: posted.data.books_voucher_no
            ? `Smart Books entry ${posted.data.books_voucher_no}.`
            : 'Recorded in Smart Books.',
        })
        guard.leave(`/bank-cash/${posted.data.request_id}`)
      } catch (error) {
        applyFailure(error, setErrors, setFailure, focusFirstInvalid)
      } finally {
        inFlight.current = false
        setBusy(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [validate, body, draftId, form, toast, guard],
  )

  /** Retry a save that never reached Books, on the key the first attempt used. */
  async function retry(requestId: number) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy('post')
    try {
      const posted = await api.post<TransactionRequest>(`v1/transactions/${requestId}/retry`, {})
      setBaseline(form)
      toast({ tone: 'success', title: 'Bank deposit recorded successfully.' })
      guard.leave(`/bank-cash/${posted.data.request_id}`)
    } catch (error) {
      applyFailure(error, setErrors, setFailure, focusFirstInvalid)
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }

  function reset() {
    const blank = emptyForm(defaultDate(today, financialYear?.start, financialYear?.end))
    setForm(blank)
    setBaseline(blank)
    setErrors({})
    setFailure(null)
    setResetAsked(false)
    // The slip is already on the document service. Clearing the form detaches
    // it from this entry; it does not delete anything, and saying so is the
    // dialog's job rather than a silent surprise.
    setSlip(null)
    amountRef.current?.focus()
  }

  // ------------------------------------------------------------- the defaults

  // Today, unless today is not in the year being worked in — a company opened
  // on last year's books should not be handed a date it will refuse.
  useEffect(() => {
    if (!financialYear || dirty || draftId !== null) return
    const wanted = defaultDate(today, financialYear.start, financialYear.end)
    if (wanted === form.entryDate) return
    setForm((current) => ({ ...current, entryDate: wanted }))
    setBaseline((current) => ({ ...current, entryDate: wanted }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [financialYear, today])

  // ---------------------------------------------------------------- shortcuts

  useEffect(() => {
    if (!mayRecord) return undefined

    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.code === 'KeyS') {
        event.preventDefault()
        void save('post')
        return
      }
      // `code`, not `key`: Alt+A produces "å" on a Mac and nothing useful on a
      // keyboard laid out for another language.
      if (!event.altKey || event.metaKey || event.ctrlKey) return
      const target =
        event.code === 'KeyA' ? amountRef : event.code === 'KeyF' ? fromRef : event.code === 'KeyB' ? toRef : null
      if (!target) return
      event.preventDefault()
      target.current?.focus()
      target.current?.select?.()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [save, mayRecord])

  // ------------------------------------------------------------------ refused

  if (!scope) {
    return (
      <Notice tone="info" title="Choose a company">
        Pick the company and financial year to work in, at the top of the page.
      </Notice>
    )
  }

  if (!mayRecord) {
    return (
      <Notice tone="info" title="Not part of your Billing profile">
        You don’t have permission to record bank deposits. Whoever manages profiles for this company can add it.
      </Notice>
    )
  }

  const recent = recentQuery.data?.data
  const bankTotal = bankTotalQuery.data?.data ?? null
  const accountsFailed = accountsQuery.error !== null
  const saving = busy !== null

  return (
    <div className="billing-deposit-page">
      <nav className="billing-deposit-breadcrumb" aria-label="Breadcrumb">
        <Link to="/bank-cash">Money</Link>
        <ChevronRight size={14} aria-hidden />
        <Link to="/bank-cash">Bank deposit</Link>
        <ChevronRight size={14} aria-hidden />
        <span aria-current="page">{draftId === null ? 'New' : 'Draft'}</span>
      </nav>

      <div className="billing-deposit-layout">
        <main className="billing-deposit-main">
          <section className="billing-deposit-hero">
            <div className="billing-deposit-hero__left">
              <span className="billing-deposit-hero__icon" aria-hidden="true">
                <Landmark size={22} />
              </span>
              <div>
                <h1>Bank deposit</h1>
                <p>Record cash or other receipts deposited into your bank account</p>
              </div>
            </div>
            <p className="billing-deposit-flow" aria-label="Money received, then deposited to bank">
              <span>Received money</span>
              <ArrowRight size={14} aria-hidden />
              <span>Deposited to bank</span>
            </p>
          </section>

          {failure && (
            <Notice
              tone="danger"
              title="Could not record this deposit"
              onDismiss={() => setFailure(null)}
              action={
                failure.retryId !== null ? (
                  <button
                    type="button"
                    className="billing-button billing-button--small"
                    disabled={saving}
                    onClick={() => void retry(failure.retryId as number)}
                  >
                    Try again
                  </button>
                ) : undefined
              }
            >
              {failure.message}
            </Notice>
          )}

          {accountsFailed && (
            <Notice
              tone="warning"
              title="Your accounts could not be read"
              action={
                <button type="button" className="billing-button billing-button--small" onClick={accountsQuery.reload}>
                  Try again
                </button>
              }
            >
              {accountsQuery.error}
            </Notice>
          )}

          <form
            className="billing-deposit-card"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void save('post')
            }}
          >
            {/* ---------------------------------------------------- section 1 */}
            <section className="billing-deposit-section">
              <header className="billing-deposit-section__head">
                <span className="billing-deposit-step" aria-hidden="true">1</span>
                <div>
                  <h2>Deposit details</h2>
                  <p>Enter the basic information for this bank deposit</p>
                </div>
                <span className={`billing-deposit-state billing-deposit-state--${draftId === null ? 'new' : 'draft'}`}>
                  {draftId === null ? 'Not saved' : 'Draft'}
                </span>
              </header>

              <div className="billing-deposit-grid billing-deposit-grid--top">
                <div className="billing-deposit-field">
                  <label className="billing-deposit-label" htmlFor="billing-deposit-amount">
                    Deposit amount
                    <span className="billing-deposit-required" aria-hidden="true"> *</span>
                    <span className="billing-sr-only"> (required)</span>
                  </label>
                  <div className={`billing-deposit-money${errors.amount ? ' is-invalid' : ''}`}>
                    <span className="billing-deposit-money__prefix" aria-hidden="true">₹</span>
                    <input
                      id="billing-deposit-amount"
                      ref={amountRef}
                      className="billing-deposit-money__input"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      autoFocus
                      placeholder="0.00"
                      value={form.amount}
                      aria-invalid={errors.amount ? true : undefined}
                      aria-describedby={errors.amount ? 'billing-deposit-amount-error' : 'billing-deposit-amount-hint'}
                      // Sanitised, not reformatted: inserting grouping commas
                      // while somebody is typing moves the caret out from under
                      // their finger.
                      onChange={(event) => set('amount', sanitiseAmount(event.target.value))}
                    />
                  </div>
                  {errors.amount ? (
                    <p className="billing-deposit-field__error" id="billing-deposit-amount-error">{errors.amount}</p>
                  ) : (
                    <p className="billing-deposit-field__hint" id="billing-deposit-amount-hint">
                      {amountValue !== null && amountValue > 0 ? money(amountValue) : 'Rupees and paise'}
                    </p>
                  )}
                </div>

                <div className="billing-deposit-field">
                  <label className="billing-deposit-label" htmlFor="billing-deposit-date">
                    Date
                    <span className="billing-deposit-required" aria-hidden="true"> *</span>
                    <span className="billing-sr-only"> (required)</span>
                  </label>
                  <input
                    id="billing-deposit-date"
                    ref={dateRef}
                    className={`billing-deposit-input${errors.date ? ' is-invalid' : ''}`}
                    type="date"
                    value={form.entryDate}
                    min={financialYear?.start || undefined}
                    max={financialYear?.end || undefined}
                    aria-invalid={errors.date ? true : undefined}
                    aria-describedby={errors.date ? 'billing-deposit-date-error' : 'billing-deposit-date-hint'}
                    onChange={(event) => set('entryDate', event.target.value)}
                  />
                  {errors.date ? (
                    <p className="billing-deposit-field__error" id="billing-deposit-date-error">{errors.date}</p>
                  ) : (
                    <p className="billing-deposit-field__hint" id="billing-deposit-date-hint">
                      {form.entryDate ? formatDate(form.entryDate) : 'Pick a date'}
                      {financialYear ? ` · ${financialYear.label}` : ''}
                    </p>
                  )}
                </div>

                <fieldset className="billing-deposit-field billing-deposit-field--type">
                  <legend className="billing-deposit-label">Deposit type</legend>
                  <div className="billing-deposit-segmented">
                    {(['cash', 'cheque'] as const).map((option) => (
                      <label key={option} className={`billing-deposit-segmented__item${form.depositType === option ? ' is-active' : ''}`}>
                        <input
                          type="radio"
                          name="billing-deposit-deposit-type"
                          value={option}
                          checked={form.depositType === option}
                          onChange={() => set('depositType', option)}
                        />
                        <span className="billing-deposit-segmented__dot" aria-hidden="true" />
                        {option === 'cash' ? 'Cash deposit' : 'Cheque deposit'}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>

              {form.depositType === 'cheque' && (
                <div className="billing-deposit-grid billing-deposit-grid--2">
                  <div className="billing-deposit-field">
                    <label className="billing-deposit-label" htmlFor="billing-deposit-cheque-no">
                      Cheque number
                      <span className="billing-deposit-required" aria-hidden="true"> *</span>
                      <span className="billing-sr-only"> (required)</span>
                    </label>
                    <input
                      id="billing-deposit-cheque-no"
                      ref={chequeRef}
                      className={`billing-deposit-input${errors.chequeNo ? ' is-invalid' : ''}`}
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={20}
                      placeholder="e.g. 004217"
                      value={form.chequeNo}
                      aria-invalid={errors.chequeNo ? true : undefined}
                      aria-describedby={errors.chequeNo ? 'billing-deposit-cheque-no-error' : 'billing-deposit-cheque-no-hint'}
                      onChange={(event) => set('chequeNo', event.target.value)}
                    />
                    {errors.chequeNo ? (
                      <p className="billing-deposit-field__error" id="billing-deposit-cheque-no-error">{errors.chequeNo}</p>
                    ) : (
                      <p className="billing-deposit-field__hint" id="billing-deposit-cheque-no-hint">
                        Without it the credit cannot be matched to the slip later.
                      </p>
                    )}
                  </div>

                  <div className="billing-deposit-field">
                    <label className="billing-deposit-label" htmlFor="billing-deposit-cheque-date">Cheque date</label>
                    <input
                      id="billing-deposit-cheque-date"
                      className={`billing-deposit-input${errors.chequeDate ? ' is-invalid' : ''}`}
                      type="date"
                      value={form.chequeDate}
                      aria-invalid={errors.chequeDate ? true : undefined}
                      aria-describedby={errors.chequeDate ? 'billing-deposit-cheque-date-error' : undefined}
                      onChange={(event) => set('chequeDate', event.target.value)}
                    />
                    {errors.chequeDate && (
                      <p className="billing-deposit-field__error" id="billing-deposit-cheque-date-error">{errors.chequeDate}</p>
                    )}
                  </div>
                </div>
              )}

              <div className="billing-deposit-grid billing-deposit-grid--2">
                <AccountSelect
                  id="billing-deposit-from"
                  label="Cash taken from"
                  required
                  placeholder="Choose ledger / account"
                  accounts={sources}
                  value={form.fromId ? Number(form.fromId) : null}
                  onChange={(id: number | null) => set('fromId', id === null ? '' : String(id))}
                  loading={accountsQuery.loading}
                  error={errors.from}
                  inputRef={fromRef}
                  emptyText={accountsFailed ? 'Accounts could not be read.' : 'No cash accounts in Smart Books yet.'}
                />

                <AccountSelect
                  id="billing-deposit-to"
                  label="Paid into bank"
                  required
                  placeholder="Choose bank account"
                  accounts={destinations}
                  value={form.toId ? Number(form.toId) : null}
                  onChange={(id: number | null) => set('toId', id === null ? '' : String(id))}
                  loading={accountsQuery.loading}
                  error={errors.to}
                  inputRef={toRef}
                  emptyText={accountsFailed ? 'Accounts could not be read.' : 'No bank accounts in Smart Books yet.'}
                />
              </div>

              <div className="billing-deposit-alerts" aria-live="polite">
                {overdrawn && (
                  <p className="billing-deposit-alert billing-deposit-alert--warning">
                    <AlertTriangle size={15} aria-hidden />
                    <span>
                      This is more than the {money(overdrawn.balance)} Smart Books currently shows in{' '}
                      {overdrawn.name}. Save it anyway if the till says otherwise — Smart Books decides whether it stands.
                    </span>
                  </p>
                )}
                {possibleDuplicate && (
                  <p className="billing-deposit-alert billing-deposit-alert--info">
                    <Info size={15} aria-hidden />
                    <span>
                      <strong>Possibly already recorded.</strong> A deposit of {money(possibleDuplicate.amount ?? 0)} from{' '}
                      {possibleDuplicate.cash_account_name ?? 'the same account'} into{' '}
                      {possibleDuplicate.bank_account_name ?? 'the same bank'} was already recorded on{' '}
                      {formatDate(possibleDuplicate.date)}
                      {possibleDuplicate.voucher_no ? ` as ${possibleDuplicate.voucher_no}` : ''}. Check before saving a second one.
                    </span>
                  </p>
                )}
              </div>

              <div className="billing-deposit-grid billing-deposit-grid--2">
                <div className="billing-deposit-field">
                  <label className="billing-deposit-label" htmlFor="billing-deposit-reference">Reference</label>
                  <input
                    id="billing-deposit-reference"
                    className="billing-deposit-input"
                    type="text"
                    autoComplete="off"
                    maxLength={REFERENCE_LIMIT}
                    placeholder="Slip number, UTR, cheque number, narration…"
                    value={form.reference}
                    aria-describedby="billing-deposit-reference-hint"
                    onChange={(event) => set('reference', event.target.value)}
                  />
                  <p className="billing-deposit-field__hint" id="billing-deposit-reference-hint">
                    Optional. It travels to Smart Books as this entry’s reference.
                  </p>
                </div>
              </div>
            </section>

            {/* ---------------------------------------------------- section 2 */}
            <section className="billing-deposit-section">
              <header className="billing-deposit-section__head">
                <span className="billing-deposit-step" aria-hidden="true">2</span>
                <div>
                  <h2>Attachments</h2>
                  <p>The stamped counterfoil, or a photo of it (optional)</p>
                </div>
              </header>

              <SlipUploader
                value={slip}
                onChange={(next) => {
                  setSlip(next)
                  setFailure(null)
                }}
                storage={capabilitiesQuery.data?.data.slip_storage ?? null}
                loading={capabilitiesQuery.loading}
              />
            </section>

            {/* ---------------------------------------------------- section 3 */}
            <section className="billing-deposit-section">
              <header className="billing-deposit-section__head">
                <span className="billing-deposit-step" aria-hidden="true">3</span>
                <div>
                  <h2>Additional notes</h2>
                  <p>Anything the person reading this entry later should know</p>
                </div>
              </header>

              <div className="billing-deposit-field">
                <label className="billing-sr-only" htmlFor="billing-deposit-notes">Notes about this deposit</label>
                <textarea
                  id="billing-deposit-notes"
                  className="billing-deposit-textarea"
                  rows={3}
                  maxLength={NOTES_LIMIT}
                  placeholder="Add any remarks about this deposit (optional)…"
                  value={form.notes}
                  aria-describedby="billing-deposit-notes-count"
                  onChange={(event) => set('notes', event.target.value)}
                />
                <p className="billing-deposit-counter" id="billing-deposit-notes-count">
                  {form.notes.length} / {NOTES_LIMIT}
                </p>
              </div>
            </section>

            <footer className="billing-deposit-footer">
              <button
                type="button"
                className="billing-button billing-button--quiet"
                disabled={saving}
                onClick={() => (dirty ? setResetAsked(true) : reset())}
              >
                <RotateCcw size={15} aria-hidden /> Reset
              </button>

              <div className="billing-deposit-footer__right">
                <button type="button" className="billing-button" disabled={saving} onClick={() => void save('draft')}>
                  {busy === 'draft' ? <Loader2 size={15} className="spin" aria-hidden /> : null}
                  {busy === 'draft' ? 'Saving…' : draftId === null ? 'Save as draft' : 'Update draft'}
                </button>
                <button type="submit" className="billing-button billing-button--primary" disabled={saving}>
                  {busy === 'post' ? <Loader2 size={16} className="spin" aria-hidden /> : <Check size={16} aria-hidden />}
                  {busy === 'post' ? 'Recording…' : 'Save deposit'}
                </button>
              </div>
            </footer>
          </form>

          <p className="billing-deposit-basis">
            Saving records a contra entry in Smart Books — your bank account debited, your cash account credited. Billing
            keeps the reference and nothing else. <kbd>Ctrl</kbd>+<kbd>S</kbd> saves.
          </p>
        </main>

        {/* -------------------------------------------------------- the rail */}
        <aside className="billing-deposit-rail" aria-label="This deposit, and recent ones">
          <section className="billing-deposit-side">
            <header className="billing-deposit-side__head">
              <h2>Deposit summary</h2>
            </header>

            <div className="billing-deposit-total">
              <span className="billing-deposit-total__icon" aria-hidden="true">
                <Landmark size={20} />
              </span>
              <span>
                <span className="billing-deposit-total__label">Deposit amount</span>
                <strong className="billing-deposit-total__value num">{money(amountValue ?? 0)}</strong>
              </span>
            </div>

            <dl className="billing-deposit-summary">
              <div>
                <dt>Date</dt>
                <dd>{form.entryDate ? formatDate(form.entryDate) : 'Not set'}</dd>
              </div>
              <div>
                <dt>Deposit type</dt>
                <dd>{form.depositType === 'cash' ? 'Cash deposit' : 'Cheque deposit'}</dd>
              </div>
              <div>
                <dt>Cash taken from</dt>
                <dd>{fromAccount?.name ?? <span className="billing-deposit-summary__empty">Not selected</span>}</dd>
              </div>
              <div>
                <dt>Paid into bank</dt>
                <dd>{toAccount?.name ?? <span className="billing-deposit-summary__empty">Not selected</span>}</dd>
              </div>
              <div>
                <dt>Reference</dt>
                <dd>{form.reference.trim() || <span className="billing-deposit-summary__empty">—</span>}</dd>
              </div>
              {form.depositType === 'cheque' && (
                <div>
                  <dt>Cheque</dt>
                  <dd>{form.chequeNo.trim() || <span className="billing-deposit-summary__empty">—</span>}</dd>
                </div>
              )}
              {slip && (
                <div>
                  <dt>Slip</dt>
                  <dd>{slip.filename ?? 'Attached'}</dd>
                </div>
              )}
            </dl>

            {fromAccount?.balance !== null && fromAccount?.balance !== undefined && (
              <p className="billing-deposit-side__note">
                {fromAccount.name} holds {money(fromAccount.balance)} in Smart Books right now.
              </p>
            )}

            {/* Context beside Books' balance, not a figure to add to it — which
                is why the endpoint's own basis line travels with it. */}
            {bankTotal && bankTotal.count > 0 && toAccount && (
              <p className="billing-deposit-side__note">
                {money(bankTotal.total)} banked into {toAccount.name} in the last {bankTotal.days} days, over{' '}
                {bankTotal.count} {bankTotal.count === 1 ? 'deposit' : 'deposits'}. {bankTotal.basis}
              </p>
            )}
          </section>

          <section className="billing-deposit-side">
            <header className="billing-deposit-side__head">
              <h2>Recent deposits</h2>
              <Link to="/bank-cash" className="billing-deposit-side__link">View all</Link>
            </header>

            {recentQuery.loading && (
              <div className="billing-skeleton-rows" aria-busy="true">
                <span className="billing-sr-only">Loading recent deposits</span>
                <span className="billing-skeleton billing-skeleton--line" />
                <span className="billing-skeleton billing-skeleton--line" />
                <span className="billing-skeleton billing-skeleton--line" />
              </div>
            )}

            {!recentQuery.loading && recentQuery.error && (
              <div className="billing-deposit-retry">
                <p>{recentQuery.error}</p>
                <button type="button" className="billing-button billing-button--small" onClick={recentQuery.reload}>
                  Try again
                </button>
              </div>
            )}

            {!recentQuery.loading && !recentQuery.error && (recent?.rows.length ?? 0) === 0 && (
              <p className="billing-deposit-side__empty">No recent bank deposits.</p>
            )}

            {!recentQuery.loading && !recentQuery.error && (recent?.rows.length ?? 0) > 0 && (
              <ul className="billing-deposit-recent">
                {(recent?.rows ?? []).map((row) => (
                  <li key={row.request_id}>
                    <Link to={`/bank-cash/${row.request_id}`} className="billing-deposit-recent__row">
                      <span className="billing-deposit-recent__icon" aria-hidden="true">
                        <Landmark size={15} />
                      </span>
                      <span className="billing-deposit-recent__body">
                        <span className="billing-deposit-recent__top">
                          <strong className="num">{row.amount === null ? '—' : money(row.amount)}</strong>
                          <span className="billing-badge billing-badge--info">
                            {row.payment_mode === 'cheque' ? 'Cheque deposit' : 'Cash deposit'}
                          </span>
                        </span>
                        {/* The name is Books', read live. When Books did not
                            answer it is absent rather than guessed, and the
                            line under the list says why. */}
                        <span className="billing-deposit-recent__meta">
                          {row.bank_account_name ?? row.voucher_no ?? 'Bank account'}
                        </span>
                      </span>
                      <span className="billing-deposit-recent__date">{formatDate(row.date)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {recent && recent.rows.length > 0 && !recent.names_available && (
              <p className="billing-deposit-side__note">
                Smart Books did not answer, so the account names are missing. The amounts and dates are this
                product's own record and stand.
              </p>
            )}

            {recent && <p className="billing-deposit-side__note">{recent.basis}</p>}
          </section>

          {!tipDismissed && (
            <aside className="billing-deposit-tip">
              <span className="billing-deposit-tip__icon" aria-hidden="true">
                <Lightbulb size={16} />
              </span>
              <div>
                <strong>Quick tip</strong>
                <p>Put the slip or UTR number in Reference — it is what the bank statement is matched on later.</p>
              </div>
              <button type="button" className="billing-deposit-tip__close" aria-label="Hide this tip" onClick={dismissTip}>
                <X size={14} aria-hidden />
              </button>
            </aside>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={guard.pending !== null}
        title="Discard unsaved bank deposit?"
        confirmLabel="Discard and leave"
        onConfirm={guard.discard}
        onCancel={guard.keepEditing}
      >
        <p>
          What you have typed has not been recorded in Smart Books. Save it as a draft first if you want to come back
          to it.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={resetAsked}
        title="Clear this deposit?"
        confirmLabel="Clear the form"
        cancelLabel="Keep it"
        onConfirm={reset}
        onCancel={() => setResetAsked(false)}
      >
        <p>
          Everything typed here goes back to blank{slip ? ', and the slip is detached from this entry' : ''}. Nothing
          already recorded in Smart Books is touched.
        </p>
      </ConfirmDialog>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  )

  function dismissTip() {
    setTipDismissed(true)
    try {
      window.localStorage.setItem(TIP_KEY, '1')
    } catch {
      /* a private window; the tip simply comes back next time */
    }
  }
}

// ---------------------------------------------------------------------------
// Plain functions
// ---------------------------------------------------------------------------

const FIELD_OF = {
  amount: 'amount',
  entryDate: 'date',
  fromId: 'from',
  toId: 'to',
  chequeNo: 'chequeNo',
  chequeDate: 'chequeDate',
} as const

function sameForm(a: FormState, b: FormState): boolean {
  return (
    a.amount === b.amount &&
    a.entryDate === b.entryDate &&
    a.depositType === b.depositType &&
    a.chequeNo === b.chequeNo &&
    a.chequeDate === b.chequeDate &&
    a.fromId === b.fromId &&
    a.toId === b.toId &&
    a.reference === b.reference &&
    a.notes === b.notes
  )
}

/**
 * Keep the keystrokes that could become an amount, drop the rest.
 *
 * Not a formatter. Grouping the digits as they are typed moves the caret, and a
 * biller entering 150000 with a customer waiting should not have to chase it.
 */
function sanitiseAmount(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const [whole, ...rest] = cleaned.split('.')
  if (rest.length === 0) return whole
  return `${whole}.${rest.join('').slice(0, 2)}`
}

function parseAmount(raw: string): number | null {
  const text = raw.trim()
  if (text === '') return null
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

/** Today, unless the year being worked in has already ended. */
function defaultDate(today: string, start?: string, end?: string): string {
  if (start && today < start) return start
  if (end && today > end) return end
  return today
}

function readTipDismissed(): boolean {
  try {
    return window.localStorage.getItem(TIP_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Turn a failed save into something the person in front of the screen can act on.
 *
 * The server's own message is preferred wherever it has one, because it is the
 * side that knows why: Books refusing a closed period says so better than any
 * sentence written here could. What this adds is WHICH FIELD, so the message
 * lands under the box that has to change.
 */
function applyFailure(
  error: unknown,
  setErrors: (update: (current: Partial<Record<FieldKey, string>>) => Partial<Record<FieldKey, string>>) => void,
  setFailure: (failure: { message: string; retryId: number | null } | null) => void,
  focusFirstInvalid: (found: Partial<Record<FieldKey, string>>) => void,
): void {
  if (!(error instanceof ApiError)) {
    setFailure({
      message: navigator.onLine
        ? 'Something went wrong before the request was sent. Nothing has been recorded — please try again.'
        : 'This device is offline. Nothing has been recorded; the deposit can be saved once you are back on the network.',
      retryId: null,
    })
    return
  }

  const field = SERVER_FIELDS[String(error.details.field ?? '')]
  if (field) {
    setErrors((current) => ({ ...current, [field]: error.message }))
    focusFirstInvalid({ [field]: error.message })
  }

  const requestId = typeof error.details.request_id === 'number' ? error.details.request_id : null

  setFailure({
    message: field ? error.message : messageFor(error),
    retryId: error.retryable ? requestId : null,
  })
}

const SERVER_FIELDS: Record<string, FieldKey | undefined> = {
  amount: 'amount',
  date: 'date',
  vch_date: 'date',
  from_account_id: 'from',
  to_account_id: 'to',
  instrument_no: 'chequeNo',
  instrument_date: 'chequeDate',
}

function messageFor(error: ApiError): string {
  switch (error.status) {
    case 0:
      return 'The request did not reach the server. Nothing has been recorded — check the connection and try again.'
    case 400:
      return 'Pick a company and financial year at the top of the page, then save again.'
    case 401:
      return 'Your session has ended. Sign in again and the deposit can be saved.'
    case 403:
      return 'You don’t have permission to record bank deposits.'
    case 404:
      return 'One of the accounts no longer exists in Smart Books. Choose it again from the list.'
    case 409:
      // Books refused it for a reason of its own, and that reason is worth more
      // than anything this file could invent.
      return error.message
    case 422:
      return error.message
    case 502:
    case 503:
      return 'Smart Books could not be reached. Nothing has been recorded and no duplicate exists — try again.'
    default:
      return error.message || 'Unable to record this bank deposit. Please review the information and try again.'
  }
}
