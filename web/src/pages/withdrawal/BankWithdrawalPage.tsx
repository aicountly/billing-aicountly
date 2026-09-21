/**
 * Money → Bank withdrawal.
 *
 * Cash drawn out of the bank and brought into the till. It is the entry a shop
 * makes on the way back from the branch, so the screen is built around that:
 * the amount has the cursor, the four things that must be true are the four
 * fields at the top, and the balance the money is coming out of is on screen
 * while the amount is being typed rather than one navigation away.
 *
 * WHAT IS OURS AND WHAT IS NOT. Every list here is read live — the cash and
 * bank ledgers from Books through `v1/catalog/cash-bank`, their balances
 * through `v1/cash-bank`, the financial year from Manage. Billing stores none
 * of them. Saving is the same call the screen this replaces used,
 * `POST v1/transactions/bank_withdrawal`, with the narration that request
 * already accepted and the old form had no box for.
 *
 * THE ACCOUNTING IS BOOKS'. A withdrawal is a contra voucher; this screen
 * neither names it that nor posts a line of it. It sends the two accounts and
 * the amount, and Books decides what is debited, what is credited and what the
 * voucher is called.
 *
 * NOTHING ON THIS SCREEN IS INVENTED. The recent list is what this product
 * recorded and says so; the thirty-day figures are counted from those same
 * rows; the balance is Books' own and is absent, with its reason, when the
 * profile may not see it. There is no demo data behind any of it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, Keyboard, Landmark, List } from 'lucide-react'
import { api, ApiError } from '../../services/api'
import type { CashBank, RecentBankMovement, RecentBankMovements, TransactionRequest } from '../../services/types'
import { useApi } from '../../hooks/useApi'
import { useBilling } from '../../context/BillingContext'
import { fetchCompanyInfo } from '../../services/manage'
import { Button, currencySymbol, date as formatDate, money, Notice } from '../../ui'
import { WithdrawalFormCard, type SaveMode } from './WithdrawalFormCard'
import { WithdrawalSidePanel } from './WithdrawalSidePanel'
import { WithdrawalShortcutsDialog } from './WithdrawalShortcutsDialog'
import { buildAccountOptions, findAccount, pick, type CashBankRow } from './accounts'
import {
  emptyDraft,
  fieldFromApi,
  firstError,
  isDirty,
  nextEntryDraft,
  parseAmount,
  repeatDraft,
  today,
  toWithdrawalRequest,
  validate,
  type FinancialYearWindow,
  type WithdrawalDraft,
  type WithdrawalErrors,
} from './withdrawalForm'
import '../../styles/billing-withdrawal.css'

export default function BankWithdrawalPage() {
  const navigate = useNavigate()
  const { scope, can } = useBilling()

  // The permission the POST behind this screen asserts. Hiding the form from
  // somebody who cannot save is a courtesy; TransactionService is the control.
  const mayRecord = can('contra.create')
  const canOpenReports = can('reports.view')

  const [draft, setDraft] = useState<WithdrawalDraft>(() => emptyDraft())
  const [baseline, setBaseline] = useState<WithdrawalDraft>(() => emptyDraft())
  const [showErrors, setShowErrors] = useState(false)
  const [apiErrors, setApiErrors] = useState<WithdrawalErrors>({})
  const [saving, setSaving] = useState<SaveMode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryId, setRetryId] = useState<number | null>(null)
  const [saved, setSaved] = useState<TransactionRequest | null>(null)
  const [scopeChanged, setScopeChanged] = useState(false)
  const [dateMoved, setDateMoved] = useState<string | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  // A second click on Save while the first is in flight would be a second
  // voucher. The state disables the button; this closes the gap between the
  // click and React getting round to the re-render.
  const inFlight = useRef(false)
  const fieldRefs = {
    amount: useRef<HTMLInputElement>(null),
    date: useRef<HTMLInputElement>(null),
    bank: useRef<HTMLSelectElement>(null),
    cash: useRef<HTMLSelectElement>(null),
  }

  const enabled = Boolean(scope) && mayRecord
  const scopeKey = `${scope?.cmp_id ?? 0}:${scope?.fy_id ?? 0}:${scope?.bo_id ?? 0}`

  // ------------------------------------------------------------ live reads

  /** Every cash and bank ledger in this company. The list, not the balances. */
  const catalog = useApi(
    (signal) => api.list<CashBankRow>('v1/catalog/cash-bank', undefined, signal),
    [scopeKey],
    enabled,
  )

  /**
   * The balances, and the only thing that says which ledger is a bank and which
   * is cash. Its failing costs the balance card and the split, never the form.
   */
  const balances = useApi(
    (signal) => api.one<CashBank>('v1/cash-bank', undefined, signal),
    [scopeKey],
    enabled,
  )

  /**
   * What was withdrawn lately, and the thirty-day figures beside the balance.
   *
   * Narrowed to the chosen bank so the summary and the balance are about the
   * same account. Four rows: this is context for the entry being typed, not a
   * register — the register is Books' and lives in Reports.
   */
  const recent = useApi(
    (signal) =>
      api.one<RecentBankMovements>(
        'v1/cash-bank/recent',
        { kind: 'bank_withdrawal', limit: 4, from_account_id: draft.bankAccountId },
        signal,
      ),
    [scopeKey, draft.bankAccountId],
    enabled,
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

  // -------------------------------------------------------------- the lists

  const options = useMemo(
    () => buildAccountOptions(catalog.data?.data ?? [], balances.data?.data),
    [catalog.data, balances.data],
  )

  const bankOptions = useMemo(() => pick(options, 'bank', draft.cashAccountId), [options, draft.cashAccountId])
  const cashOptions = useMemo(() => pick(options, 'cash', draft.bankAccountId), [options, draft.bankAccountId])
  const selectedBank = useMemo(() => findAccount(options, draft.bankAccountId), [options, draft.bankAccountId])

  const numericAmount = useMemo(() => parseAmount(draft.amount), [draft.amount])

  const errors = useMemo<WithdrawalErrors>(
    () => ({ ...validate(draft, fyWindow), ...apiErrors }),
    [draft, fyWindow, apiErrors],
  )

  /**
   * "Haven't I already entered this one?"
   *
   * Checked against the recent list that is on screen anyway — no extra call,
   * and no claim to be more than it is: it can only see what this product
   * recorded lately, and the wording says so. It warns and never blocks,
   * because two withdrawals of the same round number on one day is a real thing
   * that happens.
   */
  const possibleDuplicate = useMemo(() => {
    if (numericAmount === null || numericAmount <= 0) return null
    if (!draft.bankAccountId || !draft.cashAccountId) return null

    return (
      (recent.data?.data.rows ?? []).find(
        (row) =>
          row.date === draft.date &&
          row.from_id !== null &&
          String(row.from_id) === draft.bankAccountId &&
          row.to_id !== null &&
          String(row.to_id) === draft.cashAccountId &&
          row.amount !== null &&
          Math.abs(row.amount - numericAmount) < 0.01,
      ) ?? null
    )
  }, [numericAmount, draft.bankAccountId, draft.cashAccountId, draft.date, recent.data])

  // -------------------------------------------------------------- the draft

  const patch = useCallback((changes: Partial<WithdrawalDraft>) => {
    setDraft((current) => ({ ...current, ...changes }))
    // A field the backend complained about stops being one the moment somebody
    // changes it; leaving the message there would be arguing with the fix.
    setApiErrors((current) => {
      const touched = Object.keys(changes) as Array<keyof WithdrawalDraft>
      if (!touched.some((field) => current[field] !== undefined)) return current
      const next = { ...current }
      for (const field of touched) delete next[field]
      return next
    })
  }, [])

  /**
   * Switching company, branch or year mid-entry.
   *
   * The ids in this form belong to the company that was open when they were
   * picked. Keeping them and saving would post this withdrawal against another
   * company's ledgers, so they go; what is company-neutral — the amount, the
   * date, the reference, the note — stays, because throwing away typing nobody
   * asked to throw away is its own bug.
   */
  const previousScope = useRef(scopeKey)
  useEffect(() => {
    if (previousScope.current === scopeKey) return
    previousScope.current = scopeKey

    if (draft.bankAccountId !== '' || draft.cashAccountId !== '') {
      setDraft((current) => ({ ...current, bankAccountId: '', cashAccountId: '' }))
      setScopeChanged(true)
    }
    setSaved(null)
    setError(null)
    setRetryId(null)
    setApiErrors({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey])

  /**
   * The date this screen opens on.
   *
   * Today, unless today is outside the financial year being worked in — an
   * accountant opening last year to finish it off should not be handed a date
   * the year will refuse. In that case it opens on the nearest day the year
   * contains and says so, rather than showing a validation error on a form
   * nobody has touched yet.
   *
   * Only ever into an untouched date, and once per company and year: a date
   * somebody has typed is theirs, even when the year will refuse it.
   */
  const dateCheckedFor = useRef('')
  useEffect(() => {
    if (!fyWindow.from || !fyWindow.to) return
    if (dateCheckedFor.current === scopeKey) return
    dateCheckedFor.current = scopeKey

    const stamp = today()
    if (draft.date !== stamp) return
    if (stamp >= fyWindow.from && stamp <= fyWindow.to) return

    const moved = stamp < fyWindow.from ? fyWindow.from : fyWindow.to
    setDraft((current) => ({ ...current, date: moved }))
    setBaseline((current) => ({ ...current, date: moved }))
    setDateMoved(moved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fyWindow.from, fyWindow.to, scopeKey])

  const dirty = isDirty(draft, baseline)

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
   * Leaving this screen for another one, on purpose.
   *
   * React Router's blocker needs a data router and this app does not use one,
   * so the guard is on the links this screen owns: every one of them asks
   * first, and the browser's own dialog covers closing the tab.
   */
  const leaveFor = useCallback(
    (path: string) => {
      if (dirty && !window.confirm('Leave this withdrawal without saving it?')) return
      navigate(path)
    },
    [dirty, navigate],
  )

  // ---------------------------------------------------------------- saving

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

        // The balance this withdrawal just changed, and the list it now belongs
        // in. Both are read again rather than adjusted here: Books owns the
        // figure, and arithmetic in the browser is how a screen starts
        // disagreeing with the accounts.
        balances.reload()
        recent.reload()

        const next = mode === 'save-new' ? nextEntryDraft(draft) : emptyDraft(draft.date)
        setDraft(next)
        setBaseline(next)
        window.setTimeout(() => fieldRefs.amount.current?.focus(), 0)
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message)

          // A refusal that names a field belongs under that field, not only in
          // a banner at the top of a form somebody has to hunt through.
          const field = fieldFromApi(err.details.field)
          if (field) {
            setApiErrors({ [field]: err.message })
            setShowErrors(true)
          }

          // The backend hands back the request id when the call reached it but
          // Books did not answer: the same row can be pushed again on the same
          // idempotency key, which is why retrying cannot make a second voucher.
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
    [draft, fyWindow, balances, recent],
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

  // --------------------------------------------------------------- actions

  const clearAll = useCallback(() => {
    if (dirty && !window.confirm('Clear everything typed into this withdrawal?')) return

    const next = emptyDraft(draft.date)
    setDraft(next)
    setBaseline(next)
    setShowErrors(false)
    setApiErrors({})
    setError(null)
    setSaved(null)
    fieldRefs.amount.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, draft.date])

  /** Quick action: start a fresh one, keeping nothing but the working date. */
  const newWithdrawal = useCallback(() => {
    clearAll()
  }, [clearAll])

  /**
   * Quick action: the accounts off the last withdrawal, and nothing else.
   *
   * Never the amount and never the reference — a cheque number repeated onto a
   * second entry is one withdrawal recorded twice, which is precisely the
   * mistake this screen should not make easy.
   */
  const useAccountsFrom = useCallback(
    (row: RecentBankMovement) => {
      setDraft((current) =>
        repeatDraft(current, {
          bankAccountId: row.from_id === null ? current.bankAccountId : String(row.from_id),
          cashAccountId: row.to_id === null ? current.cashAccountId : String(row.to_id),
        }),
      )
      setSaved(null)
      setApiErrors({})
      fieldRefs.amount.current?.focus()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [],
  )

  const repeatLast = useCallback(() => {
    const last = recent.data?.data.rows?.[0]
    if (last) useAccountsFrom(last)
  }, [recent.data, useAccountsFrom])

  // ------------------------------------------------------------- shortcuts

  // The handler is bound once. `save` is rebuilt on most renders, and a
  // document listener torn down and re-added with it is work done on every
  // keystroke in a form somebody types into all day.
  const latest = useRef({ save })
  latest.current = { save }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const command = event.ctrlKey || event.metaKey

      if (command && (event.key === 's' || event.key === 'S')) {
        event.preventDefault()
        void latest.current.save(event.shiftKey ? 'save-new' : 'save')
        return
      }
      if (command && event.key === 'Enter') {
        event.preventDefault()
        void latest.current.save('save')
        return
      }
      if (!event.altKey || command) return

      const target = { b: fieldRefs.bank, c: fieldRefs.cash }[event.key.toLowerCase()]
      if (target?.current) {
        event.preventDefault()
        target.current.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return (
    <div className="billing-withdrawal">
      <header className="billing-withdrawal__head">
        <div className="billing-withdrawal__title">
          <span className="billing-withdrawal__mark" aria-hidden>
            <Landmark size={24} />
          </span>
          <div>
            <h1>Bank withdrawal</h1>
            <p>Withdraw cash from your bank account and record it in your books</p>
          </div>
        </div>

        <div className="billing-withdrawal__headside">
          <nav className="billing-withdrawal__crumbs" aria-label="Breadcrumb">
            <Link to="/">Home</Link>
            <span className="billing-withdrawal__crumb-sep" aria-hidden>›</span>
            <span>Money</span>
            <span className="billing-withdrawal__crumb-sep" aria-hidden>›</span>
            <span className="billing-withdrawal__crumb-current" aria-current="page">Bank withdrawal</span>
          </nav>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="billing-button billing-button--small"
              onClick={() => setShortcutsOpen(true)}
              aria-haspopup="dialog"
            >
              <Keyboard size={15} aria-hidden /> Shortcuts
            </button>
            <button
              type="button"
              className="billing-button billing-button--small"
              onClick={() => leaveFor('/bank-cash')}
            >
              <List size={15} aria-hidden /> View list
            </button>
          </div>
        </div>
      </header>

      <div className="billing-withdrawal__notices">
        {scopeChanged && (
          <Notice tone="warning" title="The company, branch or year changed" onDismiss={() => setScopeChanged(false)}>
            The bank and cash accounts were cleared, because they belonged to the company that was open before.
            Everything else you typed is still here.
          </Notice>
        )}

        {dateMoved && (
          <Notice tone="info" title="The date was moved into the open year" onDismiss={() => setDateMoved(null)}>
            Today is outside {fyWindow.label ?? 'the financial year you are working in'}, so this opened on{' '}
            {formatDate(dateMoved)}. Change it, or switch the year at the top of the page.
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
            title="Unable to save bank withdrawal"
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

        {possibleDuplicate && !saved && (
          <Notice tone="warning" title="Possible duplicate withdrawal">
            {money(possibleDuplicate.amount ?? 0)} between the same two accounts is already recorded on{' '}
            {formatDate(possibleDuplicate.date)}
            {possibleDuplicate.reference ? ` — ${possibleDuplicate.reference}` : ''}. Saving this will record a second
            one.{' '}
            <Link to={`/bank-cash/${possibleDuplicate.request_id}`}>Look at the first</Link>
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
            bankOptions={bankOptions}
            cashOptions={cashOptions}
            accounts={{ loading: catalog.loading, error: catalog.error, reload: catalog.reload }}
            selectedBank={selectedBank}
            saving={saving}
            dirty={dirty}
            onSave={(mode) => void save(mode)}
            onClear={clearAll}
            fieldRefs={fieldRefs}
          />
        </main>

        <WithdrawalSidePanel
          selectedBank={selectedBank}
          balances={balances}
          amount={numericAmount}
          recent={recent}
          onCopy={useAccountsFrom}
          onRepeatLast={repeatLast}
          onNewWithdrawal={newWithdrawal}
          onLeave={leaveFor}
          canOpenReports={canOpenReports}
        />
      </div>

      {shortcutsOpen && <WithdrawalShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </div>
  )
}
