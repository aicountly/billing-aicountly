/**
 * Bank withdrawal — taking cash out of the bank and recording it.
 *
 * In Books this is a contra voucher: cash goes up, the bank goes down. The word
 * "contra" never appears on screen, and NOTHING on this page posts a ledger
 * entry. The form gathers what the user typed and hands it to
 * `POST v1/transactions/bank_withdrawal`, which is the single path from this
 * product into Books' ledger — the same one the old form used, so a withdrawal
 * saved before this screen changed and one saved after it are the same voucher.
 *
 * What is new is the context around the form. Everything in the right-hand
 * column is read live on the request that draws it:
 *
 *   * the balance, from Books' account summary
 *   * the recent withdrawals and the period's total, from Books' bank ledger
 *
 * There is no Billing table behind any of it. Where a reading is not available
 * — no permission, Books silent, a ledger that does not say which entries are
 * contras — the card says so and the FORM KEEPS WORKING. A sidebar that cannot
 * load is not a reason a shopkeeper cannot record the cash they are holding.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  FileText,
  Info,
  Landmark,
  List,
  MoreVertical,
  Plus,
  RotateCcw,
  StickyNote,
  TrendingDown,
  Wallet,
  Zap,
} from 'lucide-react'
import { api, ApiError } from '../services/api'
import type { BankWithdrawalActivity, BankWithdrawalEntry, LedgerAccount, LedgerAccounts, TransactionRequest } from '../services/types'
import { useApi } from '../hooks/useApi'
import { useBilling } from '../context/BillingContext'
import { useFinancialYear, withinYear, workingDate } from '../hooks/useFinancialYear'
import { AccountSelect, type AccountOption } from '../components/AccountSelect'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { EmptyState, ErrorState, SkeletonRows } from '../dashboards/kit'
import { date as formatDate, money, Notice } from '../ui'
import '../styles/bank-withdrawal.css'

const NOTES_LIMIT = 500
const RECENT_LIMIT = 5
const ACTIVITY_DAYS = 30

interface FormState {
  amount: string
  entryDate: string
  bankAccountId: number | null
  cashAccountId: number | null
  reference: string
  notes: string
}

const EMPTY_FORM: FormState = {
  amount: '',
  entryDate: '',
  bankAccountId: null,
  cashAccountId: null,
  reference: '',
  notes: '',
}

/** Field names as the API reports them, mapped to the ones on this form. */
const FIELD_MAP: Record<string, keyof FormState> = {
  amount: 'amount',
  date: 'entryDate',
  vch_date: 'entryDate',
  from_account_id: 'bankAccountId',
  to_account_id: 'cashAccountId',
  instrument_no: 'reference',
  narration: 'notes',
}

export default function BankWithdrawal() {
  const navigate = useNavigate()
  const { scope, can } = useBilling()
  const mayCreate = can('contra.create')

  const financialYear = useFinancialYear()

  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [saveMode, setSaveMode] = useState<'save' | 'save-new' | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [retryId, setRetryId] = useState<number | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [duplicateAck, setDuplicateAck] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [pendingLeave, setPendingLeave] = useState<string | null>(null)
  const [openRow, setOpenRow] = useState<number | null>(null)

  const amountInput = useRef<HTMLInputElement | null>(null)

  // ------------------------------------------------------------------ data

  const ledgers = useApi(
    (signal) => api.one<LedgerAccounts>('v1/bank-cash/accounts', undefined, signal),
    [scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    Boolean(scope),
  )

  const activity = useApi(
    (signal) =>
      api.one<BankWithdrawalActivity>(
        'v1/bank-cash/withdrawals',
        { account_id: form.bankAccountId ?? undefined, days: ACTIVITY_DAYS, limit: RECENT_LIMIT },
        signal,
      ),
    [scope?.cmp_id, scope?.fy_id, scope?.bo_id, form.bankAccountId],
    Boolean(scope),
  )

  const accounts = useMemo(() => ledgers.data?.data.accounts ?? [], [ledgers.data])
  const balancesAvailable = ledgers.data?.data.balances_available ?? false
  const balancesReason = ledgers.data?.data.balances_reason ?? null

  /**
   * Bank ledgers on the left of the movement, cash ledgers on the right.
   *
   * When Books gives no accounting group there is nothing to split on, and a
   * dropdown filtered to nothing would leave a user who has accounts staring at
   * "No bank accounts available". So an empty side falls back to the whole list
   * and says why underneath.
   */
  const bankOptions = useMemo(() => pick(accounts, 'bank'), [accounts])
  const cashOptions = useMemo(() => pick(accounts, 'cash'), [accounts])
  const unclassified = accounts.length > 0 && (bankOptions.length === 0 || cashOptions.length === 0)

  const selectedBank = accounts.find((row) => row.account_id === form.bankAccountId) ?? null
  const selectedCash = accounts.find((row) => row.account_id === form.cashAccountId) ?? null

  const numericAmount = useMemo(() => {
    const parsed = Number(form.amount.replace(/,/g, ''))
    return Number.isFinite(parsed) ? parsed : 0
  }, [form.amount])

  /**
   * Has anything been TYPED that would be lost?
   *
   * The chosen accounts deliberately do not count. They are suggested again on
   * the next visit, and counting them would put a "discard your work?" dialog in
   * front of somebody who has just saved — Save & New leaves exactly that state
   * behind, and a dialog nobody needs is a dialog everybody learns to dismiss.
   */
  const dirty = useMemo(
    () => form.amount.trim() !== '' || form.reference.trim() !== '' || form.notes.trim() !== '',
    [form.amount, form.reference, form.notes],
  )

  // ------------------------------------------------------------- defaulting

  // The date opens on the working date for the year that is open, not blindly
  // on today: somebody in FY 2026-27 whose machine says April 2027 should be
  // offered a date the books will accept.
  useEffect(() => {
    if (form.entryDate !== '' || financialYear.loading) return
    setForm((previous) => ({ ...previous, entryDate: workingDate(financialYear.year) }))
  }, [financialYear.loading, financialYear.year, form.entryDate])

  // One cash account, or the one this bank's last withdrawal went into. Only
  // ever fills an EMPTY field — a suggestion that overwrites a choice is a bug
  // the user finds out about after they have saved.
  useEffect(() => {
    if (form.cashAccountId !== null || cashOptions.length === 0) return

    if (cashOptions.length === 1) {
      setForm((previous) => (previous.cashAccountId === null ? { ...previous, cashAccountId: cashOptions[0].account_id } : previous))
      return
    }

    const lastUsed = (activity.data?.data.entries ?? []).find(
      (entry) => entry.cash_account_id !== null && cashOptions.some((option) => option.account_id === entry.cash_account_id),
    )
    if (lastUsed?.cash_account_id != null) {
      const suggestion = lastUsed.cash_account_id
      setForm((previous) => (previous.cashAccountId === null ? { ...previous, cashAccountId: suggestion } : previous))
    }
  }, [cashOptions, activity.data, form.cashAccountId])

  // ------------------------------------------------------------- derivations

  const availableBalance = selectedBank?.balance ?? null
  const overdraft = selectedBank?.overdraft_limit ?? null
  const effectiveAvailable = availableBalance === null ? null : availableBalance + (overdraft ?? 0)
  const estimatedBalance = availableBalance === null ? null : availableBalance - numericAmount
  const overdrawn = effectiveAvailable !== null && numericAmount > effectiveAvailable

  const entries = activity.data?.data.entries ?? []
  const activityAvailable = activity.data?.data.available ?? false

  /**
   * A withdrawal that looks like one already in Books.
   *
   * Same bank, same day, same amount — and the same reference, or neither
   * carrying one. It never blocks the save; it asks the user to look, because
   * the person who has just typed it is the only one who can say whether the
   * shop really took ₹50,000 out twice this morning.
   */
  const duplicate = useMemo<BankWithdrawalEntry | null>(() => {
    if (!form.bankAccountId || numericAmount <= 0 || !form.entryDate) return null
    const reference = form.reference.trim().toLowerCase()

    return (
      entries.find(
        (entry) =>
          entry.bank_account_id === form.bankAccountId &&
          entry.date === form.entryDate &&
          Math.abs(entry.amount - numericAmount) < 0.005 &&
          (entry.reference ?? '').trim().toLowerCase() === reference,
      ) ?? null
    )
  }, [entries, form.bankAccountId, form.entryDate, form.reference, numericAmount])

  useEffect(() => setDuplicateAck(false), [duplicate?.voucher_id, numericAmount, form.bankAccountId, form.entryDate])

  // ------------------------------------------------------------------ edits

  const update = useCallback(<K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((previous) => ({ ...previous, [field]: value }))
    setErrors((previous) => ({ ...previous, [field]: undefined }))
    setSaveError(null)
    setSaved(null)
  }, [])

  function validate(): boolean {
    const next: Partial<Record<keyof FormState, string>> = {}

    if (form.amount.trim() === '') {
      next.amount = 'Enter the amount.'
    } else if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      next.amount = 'The amount has to be more than ₹0.'
    }

    if (!form.entryDate) {
      next.entryDate = 'Choose the date.'
    } else if (!withinYear(form.entryDate, financialYear.year)) {
      next.entryDate = `That date is outside ${financialYear.year?.label ?? 'the financial year you are in'}.`
    }

    if (form.bankAccountId === null) next.bankAccountId = 'Choose the bank the money came from.'
    if (form.cashAccountId === null) next.cashAccountId = 'Choose the cash account it went into.'
    if (form.bankAccountId !== null && form.bankAccountId === form.cashAccountId) {
      next.cashAccountId = 'The money has to move between two different accounts.'
    }
    if (form.notes.length > NOTES_LIMIT) next.notes = `Keep the note under ${NOTES_LIMIT} characters.`

    setErrors(next)

    if (Object.keys(next).length > 0) {
      // Take the user to the first thing that needs fixing rather than making
      // them hunt for the red text.
      const first = Object.keys(next)[0] as keyof FormState
      document.getElementById(fieldId(first))?.focus()
      return false
    }

    return true
  }

  async function submit(mode: 'save' | 'save-new') {
    if (saveMode !== null || !mayCreate) return
    if (!validate()) return

    if (duplicate && !duplicateAck) {
      setDuplicateAck(true)
      return
    }

    setSaveMode(mode)
    setSaveError(null)
    setRetryId(null)
    setSaved(null)

    try {
      const response = await api.post<TransactionRequest>('v1/transactions/bank_withdrawal', {
        amount: numericAmount,
        from_account_id: form.bankAccountId,
        to_account_id: form.cashAccountId,
        date: form.entryDate,
        instrument_no: form.reference.trim() || undefined,
        notes: form.notes.trim() || undefined,
      })

      const reference = response.data.books_voucher_no
      const message = reference
        ? `Bank withdrawal ${reference} saved.`
        : 'Bank withdrawal saved.'

      // The balance and the recent list are now stale by exactly this entry.
      ledgers.reload()
      activity.reload()

      if (mode === 'save-new') {
        setForm((previous) => ({ ...previous, amount: '', reference: '', notes: '' }))
        setSaved(message)
        setDuplicateAck(false)
        window.setTimeout(() => amountInput.current?.focus(), 0)
        return
      }

      navigate('/bank-cash')
    } catch (error) {
      applyApiError(error)
    } finally {
      setSaveMode(null)
    }
  }

  function applyApiError(error: unknown) {
    if (!(error instanceof ApiError)) {
      setSaveError(String(error))
      return
    }

    setSaveError(error.message)

    const field = typeof error.details.field === 'string' ? FIELD_MAP[error.details.field] : undefined
    if (field) {
      setErrors((previous) => ({ ...previous, [field]: error.message }))
      document.getElementById(fieldId(field))?.focus()
    }

    const id = error.details.request_id
    if (error.retryable && typeof id === 'number') setRetryId(id)
  }

  async function retry() {
    if (retryId === null) return
    setSaveMode('save')
    try {
      await api.post<TransactionRequest>(`v1/transactions/${retryId}/retry`, {})
      ledgers.reload()
      activity.reload()
      navigate('/bank-cash')
    } catch (error) {
      applyApiError(error)
    } finally {
      setSaveMode(null)
    }
  }

  function reset(keepContext = true) {
    setForm((previous) => ({
      ...EMPTY_FORM,
      entryDate: keepContext ? previous.entryDate : workingDate(financialYear.year),
      bankAccountId: keepContext ? previous.bankAccountId : null,
      cashAccountId: keepContext ? previous.cashAccountId : null,
    }))
    setErrors({})
    setSaveError(null)
    setSaved(null)
    setDuplicateAck(false)
  }

  /**
   * Bank and cash account only.
   *
   * Never the amount, never the cheque number: repeating those is how the same
   * ₹50,000 gets withdrawn twice on the same slip number, and no amount of
   * convenience is worth that.
   */
  function repeatFromLast() {
    const last = entries[0]
    if (!last) return

    setForm((previous) => ({
      ...previous,
      bankAccountId: last.bank_account_id,
      cashAccountId:
        last.cash_account_id !== null && cashOptions.some((option) => option.account_id === last.cash_account_id)
          ? last.cash_account_id
          : previous.cashAccountId,
      amount: '',
      reference: '',
    }))
    setErrors({})
    setSaved(null)
    window.setTimeout(() => amountInput.current?.focus(), 0)
  }

  // ------------------------------------------------------------- navigation

  /** Anything that would leave the page checks for unsaved work first. */
  const leave = useCallback(
    (path: string) => {
      if (dirty) {
        setPendingLeave(path)
        return
      }
      navigate(path)
    },
    [dirty, navigate],
  )

  useEffect(() => {
    if (!dirty) return undefined

    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  // Ctrl/Cmd+S saves, Ctrl/Cmd+Shift+S saves and starts another. Both are
  // combinations the browser's own Save would otherwise take, which is exactly
  // why they are worth taking: in a form, Save means this form. The handler is
  // held in a ref so the listener is bound once rather than on every keystroke.
  const submitRef = useRef(submit)
  submitRef.current = submit

  useEffect(() => {
    if (!mayCreate) return undefined

    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      void submitRef.current(event.shiftKey ? 'save-new' : 'save')
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mayCreate])

  // --------------------------------------------------------------- rendering

  const bankSelectOptions: AccountOption[] = bankOptions.map((row) => ({
    id: row.account_id,
    name: row.account_name,
    secondary: row.account_no,
    trailing: row.balance === null ? null : money(row.balance),
  }))

  const cashSelectOptions: AccountOption[] = cashOptions.map((row) => ({
    id: row.account_id,
    name: row.account_name,
    secondary: row.account_no,
    trailing: row.balance === null ? null : money(row.balance),
  }))

  const busy = saveMode !== null

  return (
    <div className="bank-withdrawal-page">
      <header className="billing-page-heading bank-withdrawal-header">
        <div className="bank-withdrawal-title-wrap">
          <span className="bank-withdrawal-title-icon" aria-hidden>
            <Landmark size={24} />
          </span>
          <div>
            <h1>Bank withdrawal</h1>
            <p>Withdraw cash from your bank account and record it in your books</p>
          </div>
        </div>

        <div className="bank-withdrawal-header__side">
          <nav aria-label="Breadcrumb">
            <ol className="billing-breadcrumb">
              <li><a href="/" onClick={(event) => { event.preventDefault(); leave('/') }}>Home</a></li>
              <li><a href="/money-in" onClick={(event) => { event.preventDefault(); leave('/money-in') }}>Money</a></li>
              <li aria-current="page">Bank withdrawal</li>
            </ol>
          </nav>
          <button type="button" className="billing-button billing-button--small" onClick={() => leave('/bank-cash')}>
            <List size={15} aria-hidden /> View list
          </button>
        </div>
      </header>

      {!mayCreate && (
        <Notice tone="info" title="You cannot record a withdrawal">
          Your Billing profile does not include moving money between cash and bank. You can still see what has been
          withdrawn.
        </Notice>
      )}

      {saved && (
        <Notice tone="success" onDismiss={() => setSaved(null)}>
          {saved} The balance and the list beside it have been re-read from Smart Books.
        </Notice>
      )}

      {saveError && (
        <Notice
          tone="danger"
          title="Could not save this withdrawal"
          onDismiss={() => setSaveError(null)}
          action={
            retryId !== null ? (
              <button type="button" className="billing-button billing-button--small" disabled={busy} onClick={retry}>
                Retry
              </button>
            ) : undefined
          }
        >
          {saveError}
        </Notice>
      )}

      <div className="bank-withdrawal-grid">
        <section className="billing-panel withdrawal-form-card" aria-labelledby="withdrawal-details-heading">
          <div className="billing-panel__heading">
            <div>
              <h2 id="withdrawal-details-heading">Withdrawal details</h2>
              <p>Enter the withdrawal information below.</p>
            </div>
          </div>

          <div className="withdrawal-form-grid">
            <div className="billing-field">
              <label htmlFor="withdrawal-amount">
                Amount<span className="billing-required" aria-hidden> *</span>
                <span className="billing-sr-only"> (required)</span>
              </label>
              <div className={`billing-currency-input${errors.amount ? ' billing-currency-input--invalid' : ''}`}>
                <span className="billing-currency-input__prefix" aria-hidden>₹</span>
                <input
                  id="withdrawal-amount"
                  ref={amountInput}
                  value={form.amount}
                  inputMode="decimal"
                  autoComplete="off"
                  disabled={!mayCreate}
                  aria-invalid={errors.amount ? true : undefined}
                  aria-describedby={errors.amount ? 'withdrawal-amount-error' : 'withdrawal-amount-hint'}
                  onChange={(event) => update('amount', sanitiseAmount(event.target.value))}
                  onBlur={() => setForm((previous) => ({ ...previous, amount: groupAmount(previous.amount) }))}
                />
              </div>
              {errors.amount ? (
                <p className="billing-field__error" id="withdrawal-amount-error">{errors.amount}</p>
              ) : (
                <p className="billing-field__hint" id="withdrawal-amount-hint">Enter the withdrawal amount</p>
              )}
            </div>

            <div className="billing-field">
              <label htmlFor="withdrawal-date">
                Date<span className="billing-required" aria-hidden> *</span>
                <span className="billing-sr-only"> (required)</span>
              </label>
              <div className="billing-input-with-icon">
                <CalendarDays size={15} aria-hidden />
                <input
                  id="withdrawal-date"
                  type="date"
                  value={form.entryDate}
                  min={financialYear.year?.start || undefined}
                  max={financialYear.year?.end || undefined}
                  disabled={!mayCreate}
                  aria-invalid={errors.entryDate ? true : undefined}
                  aria-describedby={errors.entryDate ? 'withdrawal-date-error' : 'withdrawal-date-hint'}
                  onChange={(event) => update('entryDate', event.target.value)}
                />
              </div>
              {errors.entryDate ? (
                <p className="billing-field__error" id="withdrawal-date-error">{errors.entryDate}</p>
              ) : (
                <p className="billing-field__hint" id="withdrawal-date-hint">
                  {financialYear.year
                    ? `Inside ${financialYear.year.label}`
                    : 'Select the withdrawal date'}
                </p>
              )}
            </div>

            <AccountSelect
              id="withdrawal-bank"
              label="Bank account (taken from)"
              required
              icon={<Building2 size={16} />}
              value={form.bankAccountId}
              onChange={(next) => update('bankAccountId', next)}
              options={bankSelectOptions}
              loading={ledgers.loading}
              error={ledgers.error}
              onRetry={ledgers.reload}
              disabled={!mayCreate}
              fieldError={errors.bankAccountId}
              emptyMessage="No bank accounts available."
              emptyAction={
                can('settings.manage') ? (
                  <a href="/bank-cash" onClick={(event) => { event.preventDefault(); leave('/bank-cash') }}>
                    Manage bank accounts
                  </a>
                ) : undefined
              }
              hint={
                selectedBank && selectedBank.balance !== null
                  ? `Available balance: ${money(selectedBank.balance)}`
                  : unclassified
                    ? 'Smart Books did not say which of these are banks, so all your cash and bank accounts are listed.'
                    : 'Money is taken out of this account'
              }
            />

            <AccountSelect
              id="withdrawal-cash"
              label="Into cash account"
              required
              icon={<Wallet size={16} />}
              value={form.cashAccountId}
              onChange={(next) => update('cashAccountId', next)}
              options={cashSelectOptions}
              loading={ledgers.loading}
              error={ledgers.error}
              onRetry={ledgers.reload}
              disabled={!mayCreate}
              fieldError={errors.cashAccountId}
              emptyMessage="No cash accounts available."
              emptyAction={
                can('settings.manage') ? (
                  <a href="/bank-cash" onClick={(event) => { event.preventDefault(); leave('/bank-cash') }}>
                    Manage cash accounts
                  </a>
                ) : undefined
              }
              hint="Record withdrawal into this cash account"
            />

            <div className="billing-field">
              <label htmlFor="withdrawal-reference">Reference / cheque details</label>
              <div className="billing-input-with-icon">
                <FileText size={15} aria-hidden />
                <input
                  id="withdrawal-reference"
                  value={form.reference}
                  maxLength={64}
                  autoComplete="off"
                  disabled={!mayCreate}
                  placeholder="e.g. Cheque no., UTR, Slip no."
                  aria-describedby="withdrawal-reference-hint"
                  onChange={(event) => update('reference', event.target.value)}
                />
              </div>
              <p className="billing-field__hint" id="withdrawal-reference-hint">
                Enter cheque number, UTR number or reference
              </p>
            </div>

            <div className="billing-field">
              <label htmlFor="withdrawal-notes">Notes (optional)</label>
              <div className="billing-input-with-icon billing-input-with-icon--top">
                <StickyNote size={15} aria-hidden />
                <textarea
                  id="withdrawal-notes"
                  value={form.notes}
                  rows={2}
                  maxLength={NOTES_LIMIT}
                  disabled={!mayCreate}
                  placeholder="Add a note…"
                  aria-invalid={errors.notes ? true : undefined}
                  aria-describedby={errors.notes ? 'withdrawal-notes-error' : 'withdrawal-notes-hint'}
                  onChange={(event) => update('notes', event.target.value)}
                />
              </div>
              {errors.notes ? (
                <p className="billing-field__error" id="withdrawal-notes-error">{errors.notes}</p>
              ) : (
                <p className="billing-field__hint" id="withdrawal-notes-hint">
                  Purpose, remarks or any additional details
                  {form.notes.length > NOTES_LIMIT - 100 && ` · ${form.notes.length}/${NOTES_LIMIT}`}
                </p>
              )}
            </div>
          </div>

          {overdrawn && (
            <p className="withdrawal-warning-strip" role="status">
              <TrendingDown size={15} aria-hidden />
              <span>
                This is more than {money(effectiveAvailable ?? 0)}
                {overdraft ? ' — the balance plus the overdraft limit' : ' — the balance Smart Books holds'}. You can
                still save it; Smart Books decides whether the account allows it.
              </span>
            </p>
          )}

          {duplicate && (
            <p className="withdrawal-warning-strip" role="status">
              <Info size={15} aria-hidden />
              <span>
                A withdrawal of {money(duplicate.amount)} from {duplicate.bank_account_name} on{' '}
                {formatDate(duplicate.date)} is already in Smart Books
                {duplicate.voucher_no ? ` (${duplicate.voucher_no})` : ''}. Check it before saving another.
              </span>
            </p>
          )}

          <p className="withdrawal-info-strip">
            <Info size={16} aria-hidden />
            <span>
              This will create a bank withdrawal entry moving money from your selected bank account to cash. Smart Books
              makes the accounting entry.
            </span>
          </p>

          <footer className="withdrawal-form-footer">
            <button
              type="button"
              className="billing-button billing-button--quiet"
              disabled={busy || !mayCreate}
              onClick={() => (dirty ? setConfirmClear(true) : reset(false))}
            >
              <RotateCcw size={15} aria-hidden /> Clear all
            </button>

            <div className="withdrawal-footer-right">
              <button
                type="button"
                className="billing-button"
                disabled={busy || !mayCreate}
                onClick={() => void submit('save-new')}
              >
                {saveMode === 'save-new' ? 'Saving…' : 'Save & New'}
              </button>
              <button
                type="button"
                className="billing-button billing-button--primary"
                disabled={busy || !mayCreate}
                onClick={() => void submit('save')}
              >
                {saveMode === 'save' ? (
                  'Saving…'
                ) : (
                  <>
                    <Check size={16} aria-hidden /> {duplicate && duplicateAck ? 'Save anyway' : 'Save withdrawal'}
                  </>
                )}
              </button>
            </div>
          </footer>
        </section>

        <aside className="withdrawal-sidebar" aria-label="Bank context">
          <BalanceCard
            account={selectedBank}
            loading={ledgers.loading}
            error={ledgers.error}
            onRetry={ledgers.reload}
            balancesAvailable={balancesAvailable}
            balancesReason={balancesReason}
            amount={numericAmount}
            estimated={estimatedBalance}
            overdraft={overdraft}
            activity={activity.data?.data ?? null}
            activityLoading={activity.loading}
            onStatement={can('statement.view') && selectedBank ? () => leave(`/parties/${selectedBank.account_id}`) : undefined}
          />

          <RecentWithdrawals
            loading={activity.loading}
            error={activity.error}
            onRetry={activity.reload}
            available={activityAvailable}
            reason={activity.data?.data.reason ?? null}
            entries={entries}
            scopedTo={selectedBank?.account_name ?? null}
            openRow={openRow}
            setOpenRow={setOpenRow}
            mayCreate={mayCreate}
            mayViewStatement={can('statement.view')}
            onViewAll={() => leave('/bank-cash')}
            onStatement={(entry) => leave(`/parties/${entry.bank_account_id}`)}
            onRepeat={(entry) => {
              setOpenRow(null)
              setForm((previous) => ({
                ...previous,
                bankAccountId: entry.bank_account_id,
                cashAccountId:
                  entry.cash_account_id !== null && cashOptions.some((option) => option.account_id === entry.cash_account_id)
                    ? entry.cash_account_id
                    : previous.cashAccountId,
                amount: '',
                reference: '',
              }))
              window.setTimeout(() => amountInput.current?.focus(), 0)
            }}
            onCreateFirst={() => amountInput.current?.focus()}
          />

          <section className="billing-panel quick-actions-card" aria-labelledby="withdrawal-quick-heading">
            <h2 className="quick-actions-title" id="withdrawal-quick-heading">
              <Zap size={16} aria-hidden /> Quick actions
            </h2>
            <div className="quick-action-buttons">
              <button type="button" className="quick-action-btn" disabled={!mayCreate} onClick={() => { reset(true); amountInput.current?.focus() }}>
                <Plus size={15} aria-hidden /> New withdrawal
              </button>
              <button
                type="button"
                className="quick-action-btn"
                disabled={!mayCreate || entries.length === 0}
                title={entries.length === 0 ? 'Nothing to repeat yet' : 'Reuse the bank and cash account only'}
                onClick={repeatFromLast}
              >
                <RotateCcw size={15} aria-hidden /> Repeat from last
              </button>
              <button
                type="button"
                className="quick-action-btn"
                onClick={() =>
                  leave(selectedCash && can('statement.view') ? `/parties/${selectedCash.account_id}` : '/bank-cash')
                }
              >
                <BookOpen size={15} aria-hidden /> View cash book
              </button>
            </div>
          </section>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="Clear this withdrawal?"
        confirmLabel="Clear it"
        cancelLabel="Keep typing"
        tone="danger"
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false)
          reset(false)
          amountInput.current?.focus()
        }}
      >
        What you have entered has not been saved. Clearing it cannot be undone.
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingLeave !== null}
        title="Discard unsaved withdrawal?"
        confirmLabel="Discard"
        cancelLabel="Stay"
        tone="danger"
        onCancel={() => setPendingLeave(null)}
        onConfirm={() => {
          const path = pendingLeave
          setPendingLeave(null)
          if (path) navigate(path)
        }}
      >
        Your entered withdrawal details have not been saved.
      </ConfirmDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function BalanceCard({
  account,
  loading,
  error,
  onRetry,
  balancesAvailable,
  balancesReason,
  amount,
  estimated,
  overdraft,
  activity,
  activityLoading,
  onStatement,
}: {
  account: LedgerAccount | null
  loading: boolean
  error: string | null
  onRetry: () => void
  balancesAvailable: boolean
  balancesReason: string | null
  amount: number
  estimated: number | null
  overdraft: number | null
  activity: BankWithdrawalActivity | null
  activityLoading: boolean
  onStatement?: () => void
}) {
  return (
    <section className="billing-panel account-balance-card" aria-labelledby="withdrawal-balance-heading">
      <div className="card-header-row">
        <h2 id="withdrawal-balance-heading">
          <Landmark size={16} aria-hidden /> Account balance
        </h2>
        {onStatement && account && (
          <button type="button" className="billing-linkbutton" onClick={onStatement}>
            View statement <ArrowRight size={13} aria-hidden />
          </button>
        )}
      </div>

      {loading && <SkeletonRows rows={3} />}

      {!loading && error && <ErrorState message="Balance is temporarily unavailable." onRetry={onRetry} />}

      {!loading && !error && !account && (
        <p className="billing-field__hint bank-balance-placeholder">Select a bank account to view its balance.</p>
      )}

      {!loading && !error && account && (
        <>
          <div className="bank-balance-main">
            <div className="bank-balance-row">
              <div className="bank-account-identification">
                <span className="bank-logo-tile" aria-hidden><Building2 size={18} /></span>
                <div>
                  <p className="bank-name">{account.account_name}</p>
                  {account.account_no && <p className="bank-number">{account.account_no}</p>}
                </div>
              </div>
              <div className="balance-value">
                {account.balance === null ? (
                  <>
                    <div className="balance-unavailable">Not shown</div>
                    <div className="balance-caption">{balancesAvailable ? 'No balance for this account' : balancesReason}</div>
                  </>
                ) : (
                  <>
                    <div className="balance-amount">{money(account.balance)}</div>
                    <div className="balance-caption">Available balance</div>
                  </>
                )}
              </div>
            </div>

            {account.balance !== null && overdraft !== null && (
              <p className="balance-overdraft">
                Overdraft limit {money(overdraft)} · Effective {money(account.balance + overdraft)}
              </p>
            )}

            {account.balance !== null && amount > 0 && estimated !== null && (
              <dl className="balance-preview">
                <div>
                  <dt>Available balance</dt>
                  <dd className="num">{money(account.balance)}</dd>
                </div>
                <div>
                  <dt>Withdrawal</dt>
                  <dd className="num">− {money(amount)}</dd>
                </div>
                <div className="balance-preview__total">
                  <dt>Estimated balance</dt>
                  <dd className={`num${estimated < 0 ? ' balance-preview__negative' : ''}`}>{money(estimated)}</dd>
                </div>
              </dl>
            )}
          </div>

          {activityLoading && <SkeletonRows rows={1} />}

          {!activityLoading && activity?.available && activity.stats && (
            <div className="withdrawal-stats">
              <div>
                <div className="stat-label">Last {activity.days ?? ACTIVITY_DAYS} days withdrawals</div>
                <div className="stat-value num">{money(activity.stats.total)}</div>
              </div>
              <div className="withdrawal-stats__count">
                <div className="stat-value num">{activity.stats.count}</div>
                <div className="stat-label">Transactions</div>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function RecentWithdrawals({
  loading,
  error,
  onRetry,
  available,
  reason,
  entries,
  scopedTo,
  openRow,
  setOpenRow,
  mayCreate,
  mayViewStatement,
  onViewAll,
  onStatement,
  onRepeat,
  onCreateFirst,
}: {
  loading: boolean
  error: string | null
  onRetry: () => void
  available: boolean
  reason: string | null
  entries: BankWithdrawalEntry[]
  scopedTo: string | null
  openRow: number | null
  setOpenRow: (value: number | null) => void
  mayCreate: boolean
  mayViewStatement: boolean
  onViewAll: () => void
  onStatement: (entry: BankWithdrawalEntry) => void
  onRepeat: (entry: BankWithdrawalEntry) => void
  onCreateFirst: () => void
}) {
  const list = useRef<HTMLUListElement | null>(null)

  // A menu that only closes by choosing something is a menu you are stuck in.
  useEffect(() => {
    if (openRow === null) return undefined

    function onPointerDown(event: MouseEvent) {
      if (list.current && !list.current.contains(event.target as Node)) setOpenRow(null)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenRow(null)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openRow, setOpenRow])

  return (
    <section className="billing-panel recent-withdrawals-card" aria-labelledby="withdrawal-recent-heading">
      <div className="card-header-row">
        <h2 id="withdrawal-recent-heading">
          <TrendingDown size={16} aria-hidden /> Recent bank withdrawals
        </h2>
        <button type="button" className="billing-linkbutton" onClick={onViewAll}>
          View all <ArrowRight size={13} aria-hidden />
        </button>
      </div>

      {scopedTo && <p className="recent-withdrawals-scope">From {scopedTo}</p>}

      {loading && <SkeletonRows rows={4} />}

      {!loading && error && <ErrorState message="Recent withdrawals could not be loaded." onRetry={onRetry} />}

      {!loading && !error && !available && (
        <p className="billing-field__hint bank-balance-placeholder">
          {reason ?? 'Recent withdrawals are not shown with your Billing profile.'}
        </p>
      )}

      {!loading && !error && available && entries.length === 0 && (
        <EmptyState
          action={
            mayCreate ? (
              <button type="button" className="billing-button billing-button--small" onClick={onCreateFirst}>
                Create first withdrawal
              </button>
            ) : undefined
          }
        >
          <strong>No bank withdrawals yet</strong>
          <br />
          Recorded bank-to-cash withdrawals will appear here.
        </EmptyState>
      )}

      {!loading && !error && available && entries.length > 0 && (
        <ul className="recent-withdrawals-list" ref={list}>
          {entries.map((entry, index) => {
            const key = entry.voucher_id ?? index
            return (
              <li key={key} className="recent-withdrawal-row">
                <span className="withdrawal-date-tile" aria-hidden>
                  <span className="withdrawal-day">{dayOf(entry.date)}</span>
                  <span className="withdrawal-month">{monthOf(entry.date)}</span>
                </span>

                <span className="withdrawal-row-main">
                  <span className="withdrawal-row-amount num">{money(entry.amount)}</span>
                  <span className="withdrawal-row-meta">
                    <span className="billing-sr-only">{formatDate(entry.date)}. </span>
                    {entry.bank_account_name}
                    {entry.reference ? ` • ${entry.reference}` : ''}
                  </span>
                </span>

                <span className="billing-badge billing-badge--info">
                  {entry.cash_account_name ?? 'Cash'}
                </span>

                <span className="recent-withdrawal-row__menu">
                  <button
                    type="button"
                    className="billing-iconbutton billing-iconbutton--tiny"
                    aria-label={`What to do with the withdrawal of ${money(entry.amount)} on ${formatDate(entry.date)}`}
                    aria-expanded={openRow === key}
                    aria-haspopup="menu"
                    onClick={() => setOpenRow(openRow === key ? null : key)}
                  >
                    <MoreVertical size={15} aria-hidden />
                  </button>
                  {openRow === key && (
                    <span className="billing-menu billing-menu--row" role="menu">
                      {mayViewStatement && (
                        <button type="button" className="billing-menu__item" role="menuitem" onClick={() => onStatement(entry)}>
                          View in statement
                        </button>
                      )}
                      {mayCreate && (
                        <button type="button" className="billing-menu__item" role="menuitem" onClick={() => onRepeat(entry)}>
                          Repeat this withdrawal
                        </button>
                      )}
                      {!mayViewStatement && !mayCreate && (
                        <span className="billing-menu__note">Nothing you can do with this entry.</span>
                      )}
                    </span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function pick(accounts: LedgerAccount[], kind: 'cash' | 'bank'): LedgerAccount[] {
  const matching = accounts.filter((row) => row.kind === kind)
  return matching.length > 0 ? matching : accounts
}

function fieldId(field: keyof FormState): string {
  const ids: Record<keyof FormState, string> = {
    amount: 'withdrawal-amount',
    entryDate: 'withdrawal-date',
    bankAccountId: 'withdrawal-bank',
    cashAccountId: 'withdrawal-cash',
    reference: 'withdrawal-reference',
    notes: 'withdrawal-notes',
  }
  return ids[field]
}

/**
 * Digits, one decimal point, at most two places after it.
 *
 * Grouping commas are dropped as the user types and put back on blur. The
 * alternative — keeping the grouped figure in the field while it is being
 * edited — means the displayed value and the value in state can disagree, and
 * the first thing that disagreement costs is somebody's amount.
 */
function sanitiseAmount(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const [whole, ...rest] = cleaned.split('.')
  if (rest.length === 0) return whole
  return `${whole}.${rest.join('').slice(0, 2)}`
}

function groupAmount(raw: string): string {
  const value = Number(raw.replace(/,/g, ''))
  if (raw.trim() === '' || !Number.isFinite(value)) return raw
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

function dayOf(value: string | null): string {
  if (!value) return '—'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat('en-IN', { day: '2-digit' }).format(parsed)
}

function monthOf(value: string | null): string {
  if (!value) return ''
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(parsed)
}
