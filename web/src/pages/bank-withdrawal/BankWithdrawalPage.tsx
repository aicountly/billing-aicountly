/**
 * Money → Bank withdrawal.
 *
 * Cash drawn out of a bank account and recorded in the books. In Smart Books
 * that is a contra voucher; the word never appears on screen, because the
 * person doing it went to the bank, not to an accounting system.
 *
 * WHAT IS OURS AND WHAT IS NOT. The account list is Books', read live through
 * `v1/catalog/cash-bank`. The balance beside it is Books', read live through
 * `v1/cash-bank`, where `cash.view` and `bank.view` decide what may be seen.
 * The financial year is Manage's. The ENTRY is made by Books — this screen
 * sends `POST v1/transactions/bank_withdrawal`, the same call the form it
 * replaces sent, with the fields that request already accepted: the two
 * accounts, the amount, the date, the instrument number and the narration.
 * Billing posts no ledger lines and keeps no balance of its own.
 *
 * The only thing this product knows that Books does not is what IT recorded,
 * which is where the recent list and the 30-day figure come from — both say so
 * in a line under themselves, because a short list that looks like the cash
 * book is worse than no list.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Check, Landmark, List } from 'lucide-react'
import { api, ApiError } from '../../services/api'
import type {
  CashBank,
  CashBankAccount,
  RecentWithdrawal,
  RecentWithdrawals,
  TransactionRequest,
  WithdrawalSummary,
} from '../../services/types'
import { useApi } from '../../hooks/useApi'
import { useBilling } from '../../context/BillingContext'
import { fetchCompanyInfo } from '../../services/manage'
import { Button, currencySymbol, date as formatDate, money, Notice } from '../../ui'
import { ConfirmDialog } from './ConfirmDialog'
import { WithdrawalFormCard, type SaveMode, type WithdrawalFieldRefs } from './WithdrawalFormCard'
import { WithdrawalSidebar } from './WithdrawalSidebar'
import {
  accountsFor,
  buildAccountOptions,
  defaultDate,
  emptyDraft,
  findPossibleDuplicate,
  fieldForApiError,
  firstError,
  isDirty,
  nextEntryDraft,
  parseAmount,
  suggestedCashAccount,
  today,
  toWithdrawalRequest,
  validate,
  type FinancialYearWindow,
  type WithdrawalDraft,
  type WithdrawalErrors,
} from './withdrawalForm'
import '../../styles/billing-bank-withdrawal.css'

/** Four fits the card; "View all" asks for the rest of the window. */
const RECENT_LIMIT = 4
const RECENT_LIMIT_EXPANDED = 25

export default function BankWithdrawalPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { scope, can } = useBilling()

  // The same permission the API asserts on the save, and the one the menu
  // entry was drawn from. Hiding the form is a courtesy; the refusal is the
  // backend's.
  const mayRecord = can('contra.create')

  const [draft, setDraft] = useState<WithdrawalDraft>(() => emptyDraft(today()))
  const [baseline, setBaseline] = useState<WithdrawalDraft>(() => emptyDraft(today()))
  const [dateTouched, setDateTouched] = useState(false)
  const [cashTouched, setCashTouched] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [apiErrors, setApiErrors] = useState<WithdrawalErrors>({})
  const [saving, setSaving] = useState<SaveMode | null>(null)
  const [saved, setSaved] = useState<TransactionRequest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryId, setRetryId] = useState<number | null>(null)
  const [scopeChanged, setScopeChanged] = useState(false)
  const [recentExpanded, setRecentExpanded] = useState(false)
  const [confirming, setConfirming] = useState<'clear' | null>(null)
  const [leavingTo, setLeavingTo] = useState<string | null>(null)

  // A second click on Save while the first is in flight would be a second
  // voucher. The state disables the button; this closes the gap between the
  // click and React getting round to the re-render.
  const inFlight = useRef(false)
  const fieldRefs: WithdrawalFieldRefs = {
    amount: useRef<HTMLInputElement>(null),
    date: useRef<HTMLInputElement>(null),
    bank: useRef<HTMLButtonElement>(null),
    cash: useRef<HTMLButtonElement>(null),
  }

  const enabled = Boolean(scope) && mayRecord
  const scopeKey = `${scope?.cmp_id ?? 0}:${scope?.fy_id ?? 0}:${scope?.bo_id ?? 0}`

  // ------------------------------------------------------------ live reads

  /** Books' cash and bank ledgers — what may be posted to. */
  const accounts = useApi(
    (signal) => api.list<CashBankAccount>('v1/catalog/cash-bank', undefined, signal),
    [scopeKey],
    enabled,
  )

  /**
   * Books' balances, and which of those ledgers are cash and which are bank.
   *
   * Permission-gated on the server: a profile without `bank.view` gets
   * `available: false` and a reason, and this screen still records a
   * withdrawal — knowing the balance is not a condition of writing down what
   * the bank already did.
   */
  const balances = useApi(
    (signal) => api.one<CashBank>('v1/cash-bank', undefined, signal),
    [scopeKey],
    enabled,
  )

  const recentLimit = recentExpanded ? RECENT_LIMIT_EXPANDED : RECENT_LIMIT
  const recent = useApi(
    (signal) => api.one<RecentWithdrawals>('v1/bank-withdrawals/recent', { limit: recentLimit }, signal),
    [scopeKey, recentLimit],
    enabled,
  )

  const summary = useApi(
    (signal) =>
      api.one<WithdrawalSummary>('v1/bank-withdrawals/summary', { bank_account_id: draft.bankAccountId }, signal),
    [scopeKey, draft.bankAccountId],
    enabled && draft.bankAccountId !== '',
  )

  /**
   * The year's own dates, from Manage, so a date outside it is caught here
   * rather than by Books after the round trip. Failing to read them costs the
   * check, not the screen.
   */
  const company = useApi(
    (signal) => fetchCompanyInfo(scope?.cmp_id ?? 0, signal),
    [scope?.cmp_id],
    Boolean(scope),
  )

  const fyWindow = useMemo<FinancialYearWindow>(() => {
    const fy = company.data?.fyList.find((row) => row.fyId === scope?.fy_id)

    return { from: fy?.start ?? null, to: fy?.end ?? null, label: fy?.label ?? null }
  }, [company.data, scope?.fy_id])

  // -------------------------------------------------------------- derived

  const options = useMemo(
    () => buildAccountOptions(accounts.data?.data ?? [], balances.data?.data.accounts ?? null),
    [accounts.data, balances.data],
  )

  const bankAccounts = useMemo(() => accountsFor(options, 'bank', draft.cashAccountId), [options, draft.cashAccountId])
  const cashAccounts = useMemo(() => accountsFor(options, 'cash', draft.bankAccountId), [options, draft.bankAccountId])

  const selectedBank = useMemo(
    () => options.find((option) => String(option.id) === draft.bankAccountId) ?? null,
    [options, draft.bankAccountId],
  )

  const numericAmount = useMemo(() => {
    const value = parseAmount(draft.amount)

    return value === null || value <= 0 ? 0 : value
  }, [draft.amount])

  const showBalances = balances.data?.data.available === true
  const overBalance =
    showBalances && selectedBank?.balance !== null && selectedBank !== null && numericAmount > selectedBank.balance

  const validationErrors = useMemo(() => validate(draft, fyWindow), [draft, fyWindow])
  const errors = useMemo<WithdrawalErrors>(() => ({ ...validationErrors, ...apiErrors }), [validationErrors, apiErrors])

  const recentRows = useMemo(() => recent.data?.data.rows ?? [], [recent.data])
  const possibleDuplicate = useMemo(
    () => (saved ? null : findPossibleDuplicate(draft, recentRows)),
    [draft, recentRows, saved],
  )

  const dirty = isDirty(draft, baseline)

  // ---------------------------------------------------------------- draft

  const patch = useCallback((changes: Partial<WithdrawalDraft>) => {
    setDraft((current) => ({ ...current, ...changes }))
    if ('date' in changes) setDateTouched(true)
    if ('cashAccountId' in changes) setCashTouched(true)

    // A backend complaint about a field stops applying the moment that field
    // changes; anything else it said still stands.
    setApiErrors((current) => {
      const touched = Object.keys(changes) as Array<keyof WithdrawalDraft>
      if (!touched.some((field) => current[field] !== undefined)) return current
      const next = { ...current }
      for (const field of touched) delete next[field]
      return next
    })
  }, [])

  /** The working date, once Manage has said what the open year is. */
  useEffect(() => {
    if (dateTouched) return
    const next = defaultDate(fyWindow)
    setDraft((current) => (current.date === next ? current : { ...current, date: next }))
    setBaseline((current) => (current.date === next ? current : { ...current, date: next }))
  }, [fyWindow, dateTouched])

  /**
   * Switching company, branch or year mid-entry.
   *
   * The ids in this form belong to the company that was open when they were
   * picked. Keeping them and saving would move money between two ledgers in
   * another company's books, so they go; what is company-neutral — the amount,
   * the reference, the note — stays, because throwing away typing nobody asked
   * to throw away is its own bug.
   */
  const previousScope = useRef(scopeKey)
  useEffect(() => {
    if (previousScope.current === scopeKey) return
    previousScope.current = scopeKey

    setDraft((current) => {
      const stale = current.bankAccountId !== '' || current.cashAccountId !== ''
      if (!stale) return current
      setScopeChanged(true)
      return { ...current, bankAccountId: '', cashAccountId: '' }
    })
    setCashTouched(false)
    setSaved(null)
    setError(null)
    setRetryId(null)
    setApiErrors({})
  }, [scopeKey])

  /**
   * The cash account this company usually withdraws into, offered into an
   * empty field.
   *
   * It is a memory of what was recorded, not a decision: the moment somebody
   * picks one themselves it is never overwritten, and it is only ever put into
   * a field nobody has touched.
   */
  useEffect(() => {
    if (cashTouched || draft.cashAccountId !== '' || recentRows.length === 0) return
    const suggestion = suggestedCashAccount(recentRows, cashAccounts)
    if (suggestion === '') return
    setDraft((current) => (current.cashAccountId === '' ? { ...current, cashAccountId: suggestion } : current))
    setBaseline((current) =>
      current.cashAccountId === '' ? { ...current, cashAccountId: suggestion } : current,
    )
  }, [cashTouched, draft.cashAccountId, recentRows, cashAccounts])

  /** The browser's own warning, for a tab closed with a withdrawal half typed. */
  useEffect(() => {
    if (!dirty) return undefined

    function warn(event: BeforeUnloadEvent) {
      event.preventDefault()
    }

    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  /**
   * And the same warning for a link inside the app.
   *
   * The shell's navigation is ordinary anchors, so this catches them where
   * they are: a plain left click on an internal link, while there is something
   * unsaved, asks first. Anything the browser would handle specially — a new
   * tab, a download, a modified click — is left alone.
   */
  useEffect(() => {
    if (!dirty) return undefined

    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const anchor = (event.target as HTMLElement | null)?.closest?.('a')
      if (!(anchor instanceof HTMLAnchorElement)) return
      if (anchor.target === '_blank' || anchor.hasAttribute('download')) return

      const href = anchor.getAttribute('href') ?? ''
      if (!href.startsWith('/') || href === location.pathname) return

      event.preventDefault()
      setLeavingTo(href)
    }

    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [dirty, location.pathname])

  /** Navigation this screen starts itself, held by the same guard. */
  const leave = useCallback(
    (path: string) => {
      if (dirty) {
        setLeavingTo(path)
        return
      }
      navigate(path)
    },
    [dirty, navigate],
  )

  // --------------------------------------------------------------- saving

  const save = useCallback(
    async (mode: SaveMode) => {
      if (inFlight.current) return

      const problems = validate(draft, fyWindow)
      const firstBad = firstError(problems)
      if (firstBad) {
        setShowErrors(true)
        setSaved(null)
        const focus = {
          amount: fieldRefs.amount,
          date: fieldRefs.date,
          bankAccountId: fieldRefs.bank,
          cashAccountId: fieldRefs.cash,
        }[firstBad as 'amount' | 'date' | 'bankAccountId' | 'cashAccountId']
        focus?.current?.focus()
        return
      }

      inFlight.current = true
      setSaving(mode)
      setError(null)
      setRetryId(null)
      setSaved(null)
      setApiErrors({})

      try {
        const response = await api.post<TransactionRequest>(
          'v1/transactions/bank_withdrawal',
          toWithdrawalRequest(draft),
        )

        setSaved(response.data)
        setShowErrors(false)

        // The balance moved and the list grew. Both are read from elsewhere,
        // so both are asked again rather than adjusted here.
        balances.reload()
        recent.reload()
        summary.reload()

        const next = mode === 'save-new' ? nextEntryDraft(draft) : emptyDraft(draft.date)
        setDraft(next)
        setBaseline(next)
        window.setTimeout(() => fieldRefs.amount.current?.focus(), 0)
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message)
          const field = fieldForApiError(err.details)
          if (field) {
            setApiErrors({ [field]: err.message })
            setShowErrors(true)
          }
          // The backend hands back the request id when the call reached it but
          // Books did not answer: the same row can be pushed again on the same
          // idempotency key, which is why retrying cannot make a second entry.
          const id = err.details.request_id
          if (err.retryable && typeof id === 'number') setRetryId(id)
        } else {
          setError(String(err))
        }
      } finally {
        inFlight.current = false
        setSaving(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, fyWindow, balances, recent, summary],
  )

  async function retry() {
    if (retryId === null || inFlight.current) return

    inFlight.current = true
    setSaving('save')
    setError(null)
    try {
      const response = await api.post<TransactionRequest>(`v1/transactions/${retryId}/retry`, {})
      setSaved(response.data)
      setRetryId(null)
      balances.reload()
      recent.reload()
      summary.reload()
      const next = emptyDraft(draft.date)
      setDraft(next)
      setBaseline(next)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      inFlight.current = false
      setSaving(null)
    }
  }

  const resetForm = useCallback(
    (keepAccounts: boolean) => {
      const base = emptyDraft(defaultDate(fyWindow))
      const next = keepAccounts
        ? { ...base, bankAccountId: draft.bankAccountId, cashAccountId: draft.cashAccountId }
        : base
      setDraft(next)
      setBaseline(next)
      setDateTouched(false)
      setShowErrors(false)
      setApiErrors({})
      setError(null)
      setRetryId(null)
      setSaved(null)
      window.setTimeout(() => fieldRefs.amount.current?.focus(), 0)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft.bankAccountId, draft.cashAccountId, fyWindow],
  )

  function clearAll() {
    // Nothing typed, nothing to ask about.
    if (!dirty) {
      resetForm(false)
      return
    }
    setConfirming('clear')
  }

  /** Repeat: the two accounts, and deliberately nothing else. */
  function repeatFromLast() {
    const last = recentRows.find((row) => row.bank_account_id !== null && row.cash_account_id !== null)
    if (!last) return

    patch({
      bankAccountId: String(last.bank_account_id),
      cashAccountId: String(last.cash_account_id),
    })
    setSaved(null)
    fieldRefs.amount.current?.focus()
  }

  function copyAccounts(row: RecentWithdrawal) {
    patch({
      bankAccountId: row.bank_account_id === null ? '' : String(row.bank_account_id),
      cashAccountId: row.cash_account_id === null ? '' : String(row.cash_account_id),
    })
    setSaved(null)
    fieldRefs.amount.current?.focus()
  }

  // ------------------------------------------------------------ shortcuts

  // The handler is bound once. `save` is rebuilt on most renders, and a
  // document listener torn down and re-added with it is work done on every
  // keystroke in a form somebody types into all day.
  const latest = useRef(save)
  latest.current = save

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey && !event.metaKey) return

      if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        void latest.current(event.shiftKey ? 'save-new' : 'save')
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        void latest.current('save')
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // ---------------------------------------------------------------- render

  if (!mayRecord) {
    return (
      <div className="billing-withdrawal">
        <Notice tone="info" title="Moving money between cash and bank is not part of your profile">
          Ask whoever manages Billing profiles for this company to add it.
        </Notice>
      </div>
    )
  }

  const nothingToPostTo = !accounts.loading && accounts.error === null && options.length < 2

  return (
    <div className="billing-withdrawal">
      <header className="billing-withdrawal__head">
        <div className="billing-withdrawal__title">
          <span className="billing-withdrawal__mark" aria-hidden>
            <Landmark size={23} />
          </span>
          <div>
            <h1>Bank withdrawal</h1>
            <p>Withdraw cash from your bank account and record it in your books</p>
          </div>
        </div>

        <div className="billing-withdrawal__head-right">
          <nav className="billing-withdrawal__crumbs" aria-label="Breadcrumb">
            <Link to="/">Home</Link>
            <span className="billing-withdrawal__crumb-sep" aria-hidden>›</span>
            <Link to="/money-in">Money</Link>
            <span className="billing-withdrawal__crumb-sep" aria-hidden>›</span>
            <span aria-current="page">Bank withdrawal</span>
          </nav>

          <button
            type="button"
            className="billing-button billing-button--small"
            onClick={() => leave('/bank-cash')}
            title="Bank &amp; cash: every cash and bank account with its balance"
          >
            <List size={15} aria-hidden /> View list
          </button>
        </div>
      </header>

      <div className="billing-withdrawal__notices">
        {scopeChanged && (
          <Notice tone="warning" title="The company, branch or year changed" onDismiss={() => setScopeChanged(false)}>
            The bank and cash accounts were cleared, because they belonged to the company that was open before.
            Everything else you typed is still here.
          </Notice>
        )}

        {saved && (
          <Notice tone="success" title="Bank withdrawal saved successfully." onDismiss={() => setSaved(null)}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Check size={14} aria-hidden />
              {saved.books_voucher_no
                ? `Smart Books has it as ${saved.books_voucher_no}.`
                : 'It has gone to Smart Books.'}
              <Link to={`/bank-cash/${saved.request_id}`}>View the entry</Link>
            </span>
          </Notice>
        )}

        {error && (
          <Notice
            tone="danger"
            title="Unable to save this bank withdrawal"
            onDismiss={() => setError(null)}
            action={
              retryId !== null ? (
                <Button tone="primary" disabled={saving !== null} onClick={() => void retry()}>
                  Retry
                </Button>
              ) : undefined
            }
          >
            {error}
            {retryId !== null && (
              <div style={{ marginTop: 4, fontSize: '0.8rem' }}>
                Retrying uses the same key as the first attempt, so it cannot record this twice.
              </div>
            )}
          </Notice>
        )}

        {possibleDuplicate && (
          <Notice tone="warning" title="Possible duplicate withdrawal found">
            {money(possibleDuplicate.amount ?? 0)} from the same bank into the same cash account is already recorded on{' '}
            {formatDate(possibleDuplicate.date)}
            {possibleDuplicate.reference_no ? ` (${possibleDuplicate.reference_no})` : ''}. Saving this will record a
            second one. <Link to={`/bank-cash/${possibleDuplicate.request_id}`}>Look at the first</Link>
          </Notice>
        )}

        {nothingToPostTo && (
          <Notice tone="info" title="Two accounts are needed to move money">
            A withdrawal moves money from a bank ledger into a cash ledger. Both live in Smart Books — add them there
            and they appear in these lists.
          </Notice>
        )}
      </div>

      <div className="billing-withdrawal__layout">
        <main className="billing-withdrawal__main">
          <WithdrawalFormCard
            draft={draft}
            onChange={patch}
            errors={errors}
            showErrors={showErrors}
            currency={currencySymbol()}
            bankAccounts={bankAccounts}
            cashAccounts={cashAccounts}
            accountsLoading={accounts.loading}
            accountsError={accounts.error}
            onRetryAccounts={accounts.reload}
            showBalances={showBalances}
            selectedBank={selectedBank}
            overBalance={overBalance === true}
            saving={saving}
            disabled={nothingToPostTo}
            onSave={(mode) => void save(mode)}
            onClear={clearAll}
            fieldRefs={fieldRefs}
          />

          <p className="billing-withdrawal__keys">
            <kbd>Ctrl</kbd> + <kbd>S</kbd> saves · <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>S</kbd> saves and starts
            another · <kbd>Esc</kbd> closes a list. On a Mac, Command stands in for Ctrl.
          </p>
        </main>

        <WithdrawalSidebar
          selectedBank={selectedBank}
          balances={balances}
          amount={numericAmount}
          summary={summary}
          recent={recent}
          recentExpanded={recentExpanded}
          onToggleRecent={() => setRecentExpanded((value) => !value)}
          onCopy={copyAccounts}
          onNew={() => resetForm(true)}
          onRepeat={repeatFromLast}
          canRepeat={recentRows.some((row) => row.bank_account_id !== null && row.cash_account_id !== null)}
          canViewReports={can('reports.view')}
          onNavigate={leave}
        />
      </div>

      {confirming === 'clear' && (
        <ConfirmDialog
          title="Clear this withdrawal?"
          confirmLabel="Clear it"
          cancelLabel="Keep typing"
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null)
            resetForm(false)
          }}
        >
          <p>Everything typed into this form goes, and nothing is recorded. The date stays as it is.</p>
        </ConfirmDialog>
      )}

      {leavingTo !== null && (
        <ConfirmDialog
          title="Discard unsaved withdrawal?"
          confirmLabel="Discard"
          cancelLabel="Stay"
          onCancel={() => setLeavingTo(null)}
          onConfirm={() => {
            const destination = leavingTo
            setLeavingTo(null)
            const next = emptyDraft(draft.date)
            setBaseline(next)
            setDraft(next)
            navigate(destination)
          }}
        >
          <p>Your entered withdrawal details have not been saved.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
