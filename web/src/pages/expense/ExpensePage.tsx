/**
 * Purchases → Expense.
 *
 * An expense is the smallest thing this product records and the one somebody
 * records twenty of in a sitting, so the screen is built around that: the
 * amount has the cursor, the four things that must be true are the four fields
 * at the top, and Save and add another keeps the date and the account it came
 * out of rather than asking again.
 *
 * WHAT IS OURS AND WHAT IS NOT. Every list here is read live — expense heads
 * and cash/bank accounts from Books through `v1/catalog/*`, parties as you
 * type, tax categories as Books has them configured, the financial year from
 * Manage. Billing stores none of them. Saving is the same call the screen this
 * replaced used, `POST v1/transactions/expense`, with the fields that request
 * already accepted and the old form did not offer: the party, the bill number,
 * the tax category and where the bill is kept.
 *
 * NOTHING ON THIS SCREEN IS INVENTED. The quick-category cards are matched
 * against this company's own heads and hidden when they match nothing; the
 * recent list is what this product recorded, and says so; the bill reader is
 * off with a reason unless a document service is configured for the
 * deployment. There is no demo data behind any of it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertCircle, Check, Keyboard, Receipt, Sparkles } from 'lucide-react'
import { api, ApiError, type ItemResponse } from '../../services/api'
import type {
  CatalogAccount,
  ExpenseCapabilities,
  RecentExpense,
  RecentExpenses,
  TransactionRequest,
} from '../../services/types'
import { useApi } from '../../hooks/useApi'
import { useBilling } from '../../context/BillingContext'
import { fetchCompanyInfo } from '../../services/manage'
import { Button, currencySymbol, date as formatDate, money, Notice } from '../../ui'
import { ExpenseFormCard, type SaveMode } from './ExpenseFormCard'
import { ExpenseHelperPanel } from './ExpenseHelperPanel'
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog'
import {
  emptyDraft,
  firstError,
  parseAmount,
  isDirty,
  nextEntryDraft,
  today,
  toExpenseRequest,
  validate,
  type ExpenseDraft,
  type ExpenseField,
  type FinancialYearWindow,
} from './expenseForm'
import '../../styles/billing-expense.css'

/** Where the money came from last time, remembered per company, in this browser only. */
const PAID_FROM_KEY = 'billing:expense:paid-from'

interface BillProposal {
  fields: {
    amount: number | null
    bill_no: string | null
    bill_date: string | null
    supplier_name: string | null
    supplier_gstin: string | null
    tax_amount: number | null
    currency: string | null
  }
  confidence: Record<string, string>
  read: number
}

export default function ExpensePage() {
  const navigate = useNavigate()
  const { scope, can } = useBilling()
  const mayRecord = can('expense.create')

  const [draft, setDraft] = useState<ExpenseDraft>(() => emptyDraft())
  const [baseline, setBaseline] = useState<ExpenseDraft>(() => emptyDraft())
  const [showErrors, setShowErrors] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryId, setRetryId] = useState<number | null>(null)
  const [saved, setSaved] = useState<TransactionRequest | null>(null)
  const [saveAndNew, setSaveAndNew] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [scopeChanged, setScopeChanged] = useState(false)
  const [aiFilled, setAiFilled] = useState<ReadonlySet<ExpenseField>>(() => new Set())
  const [proposal, setProposal] = useState<BillProposal | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  // A second click on Save while the first is in flight would be a second
  // voucher. The state disables the button; this closes the gap between the
  // click and React getting round to the re-render.
  const inFlight = useRef(false)
  const billInput = useRef<HTMLInputElement>(null)
  const fieldRefs = {
    amount: useRef<HTMLInputElement>(null),
    category: useRef<HTMLSelectElement>(null),
    paidFrom: useRef<HTMLSelectElement>(null),
    vendor: useRef<HTMLInputElement>(null),
  }

  const enabled = Boolean(scope) && mayRecord
  const scopeKey = `${scope?.cmp_id ?? 0}:${scope?.fy_id ?? 0}:${scope?.bo_id ?? 0}`

  // ------------------------------------------------------------ live lists

  const categories = useApi(
    (signal) => api.list<CatalogAccount>('v1/catalog/expense-accounts', undefined, signal),
    [scopeKey],
    enabled,
  )
  const paidFrom = useApi(
    (signal) => api.list<CatalogAccount>('v1/catalog/cash-bank', undefined, signal),
    [scopeKey],
    enabled,
  )
  const taxCategories = useApi(
    (signal) => api.list<Record<string, unknown>>('v1/catalog/tax-categories', undefined, signal),
    [scopeKey],
    enabled,
  )
  const recent = useApi(
    (signal) => api.one<RecentExpenses>('v1/expenses/recent', { limit: 5 }, signal),
    [scopeKey],
    enabled,
  )
  const capabilities = useApi(
    (signal) => api.one<ExpenseCapabilities>('v1/expenses/capabilities', undefined, signal),
    [scope?.cmp_id],
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

  const errors = useMemo(() => validate(draft, fyWindow), [draft, fyWindow])

  /**
   * "Haven't I already entered this one?"
   *
   * Checked against the recent list that is on screen anyway — no extra call,
   * and no claim to be more than it is: it can only see what this product
   * recorded lately, and the wording says so. It warns and never blocks,
   * because two identical cab fares on one day are a real thing that happens.
   */
  const possibleDuplicate = useMemo(() => {
    const amount = parseAmount(draft.amount)
    if (amount === null || amount <= 0 || !draft.categoryId) return null

    return (
      (recent.data?.data.rows ?? []).find(
        (row) =>
          row.date === draft.date &&
          row.category_id !== null &&
          String(row.category_id) === draft.categoryId &&
          row.amount !== null &&
          Math.abs(row.amount - amount) < 0.01,
      ) ?? null
    )
  }, [draft.amount, draft.categoryId, draft.date, recent.data])

  // ------------------------------------------------------------- the draft

  const patch = useCallback((changes: Partial<ExpenseDraft>) => {
    setDraft((current) => ({ ...current, ...changes }))
    // A field the reader filled stops being one the moment a person touches it.
    setAiFilled((current) => {
      const touched = Object.keys(changes) as ExpenseField[]
      if (!touched.some((field) => current.has(field))) return current
      const next = new Set(current)
      for (const field of touched) next.delete(field)
      return next
    })
  }, [])

  /**
   * Switching company, branch or year mid-entry.
   *
   * The ids in this form belong to the company that was open when they were
   * picked. Keeping them and saving would post this expense to a head in
   * another company's chart of accounts, so they go; what is company-neutral —
   * the amount, the date, the bill number, the note — stays, because throwing
   * away typing nobody asked to throw away is its own bug.
   */
  const previousScope = useRef(scopeKey)
  useEffect(() => {
    if (previousScope.current === scopeKey) return
    previousScope.current = scopeKey

    setDraft((current) => {
      const stale = current.categoryId !== '' || current.paidFromId !== '' || current.vendor !== null
      if (!stale) return current
      setScopeChanged(true)
      return { ...current, categoryId: '', paidFromId: '', vendor: null, taxCategoryId: '' }
    })
    setSaved(null)
    setError(null)
    setRetryId(null)
  }, [scopeKey])

  /** The account the last expense came out of, offered again. Local to this browser. */
  useEffect(() => {
    if (!scope || draft.paidFromId !== '') return
    const rows = paidFrom.data?.data
    if (!rows || rows.length === 0) return

    let remembered: string | null = null
    try {
      remembered = window.localStorage.getItem(`${PAID_FROM_KEY}:${scope.cmp_id}`)
    } catch {
      remembered = null
    }
    if (remembered && rows.some((row) => String(row.acc_id) === remembered)) {
      setDraft((current) => (current.paidFromId === '' ? { ...current, paidFromId: remembered } : current))
    }
    // Only when the list arrives, and only into an empty field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paidFrom.data, scope?.cmp_id])

  const dirty = isDirty(draft, baseline)

  /** The browser's own warning, for a tab closed with an expense half typed. */
  useEffect(() => {
    if (!dirty) return undefined

    function warn(event: BeforeUnloadEvent) {
      event.preventDefault()
    }

    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

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
          categoryId: fieldRefs.category,
          paidFromId: fieldRefs.paidFrom,
        }[firstBad as 'amount' | 'categoryId' | 'paidFromId']
        focus?.current?.focus()
        return
      }

      inFlight.current = true
      setSaving(true)
      setError(null)
      setRetryId(null)
      setSaved(null)

      try {
        const response = await api.post<TransactionRequest>('v1/transactions/expense', toExpenseRequest(draft))

        try {
          if (scope) window.localStorage.setItem(`${PAID_FROM_KEY}:${scope.cmp_id}`, draft.paidFromId)
        } catch {
          /* storage refused; the next entry simply starts empty */
        }

        setSaved(response.data)
        setShowErrors(false)
        setAiFilled(new Set())
        setProposal(null)
        recent.reload()

        if (mode === 'save-view') {
          navigate(`/more/expense/${response.data.request_id}`)
          return
        }

        const next = mode === 'save-new' ? nextEntryDraft(draft) : emptyDraft(today())
        setDraft(next)
        setBaseline(next)
        window.setTimeout(() => fieldRefs.amount.current?.focus(), 0)
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message)
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
        setSaving(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, fyWindow, navigate, recent, scope],
  )

  async function retry() {
    if (retryId === null || inFlight.current) return

    inFlight.current = true
    setSaving(true)
    setError(null)
    try {
      const response = await api.post<TransactionRequest>(`v1/transactions/${retryId}/retry`, {})
      setSaved(response.data)
      setRetryId(null)
      const next = emptyDraft(today())
      setDraft(next)
      setBaseline(next)
      recent.reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  function reset() {
    if (dirty && !window.confirm('Clear everything typed into this expense?')) return
    const next = emptyDraft(today())
    setDraft(next)
    setBaseline(next)
    setShowErrors(false)
    setError(null)
    setSaved(null)
    setAiFilled(new Set())
    setProposal(null)
    fieldRefs.amount.current?.focus()
  }

  function cancel() {
    if (dirty && !window.confirm('Leave this expense without saving it?')) return
    navigate(-1)
  }

  function duplicate(row: RecentExpense) {
    patch({
      amount: row.amount === null ? '' : String(row.amount),
      categoryId: row.category_id === null ? '' : String(row.category_id),
      paidFromId: row.paid_from_id === null ? '' : String(row.paid_from_id),
      note: row.note ?? '',
      reference: '',
      date: today(),
    })
    setSaved(null)
    fieldRefs.amount.current?.focus()
  }

  // ------------------------------------------------------------ bill reader

  async function readBill(file: File) {
    setAiBusy(true)
    setAiError(null)
    setProposal(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const response: ItemResponse<BillProposal> = await api.upload<BillProposal>('v1/expenses/read-bill', form)
      if (response.data.read === 0) {
        setAiError('Nothing could be read from that bill. The details can still be typed in.')
        return
      }
      setProposal(response.data)
    } catch (err) {
      setAiError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setAiBusy(false)
    }
  }

  /** Only what can be set without guessing. A supplier NAME is not a party id. */
  function applyProposal() {
    if (!proposal) return
    const changes: Partial<ExpenseDraft> = {}
    const filled = new Set<ExpenseField>()

    if (proposal.fields.amount !== null && proposal.fields.amount > 0) {
      changes.amount = String(proposal.fields.amount)
      filled.add('amount')
    }
    if (proposal.fields.bill_date) {
      changes.date = proposal.fields.bill_date
      filled.add('date')
    }
    if (proposal.fields.bill_no) {
      changes.reference = proposal.fields.bill_no
      filled.add('reference')
    }

    setDraft((current) => ({ ...current, ...changes }))
    setAiFilled(filled)
    setProposal(null)
  }

  // ------------------------------------------------------------- shortcuts

  // The handler is bound once. `save` is rebuilt on most renders, and a
  // document listener that is torn down and re-added with it is work done on
  // every keystroke in a form somebody types into all day.
  const latest = useRef({ save, saveAndNew })
  latest.current = { save, saveAndNew }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        void latest.current.save(latest.current.saveAndNew ? 'save-new' : 'save')
        return
      }
      if (!event.altKey || event.ctrlKey || event.metaKey) return

      const target = {
        e: fieldRefs.category,
        p: fieldRefs.paidFrom,
        v: fieldRefs.vendor,
      }[event.key.toLowerCase()]

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
      <div className="billing-expense">
        <Notice tone="info" title="Recording an expense is not part of your profile">
          Ask whoever manages Billing profiles for this company to add it.
        </Notice>
      </div>
    )
  }

  const capability = capabilities.data?.data ?? null

  return (
    <div className="billing-expense">
      <nav className="billing-expense__crumbs" aria-label="Breadcrumb">
        <Link to="/purchases">Purchases</Link>
        <span className="billing-expense__crumb-sep" aria-hidden>›</span>
        <span>Expense</span>
        <span className="billing-expense__crumb-sep" aria-hidden>›</span>
        <span className="billing-expense__crumb-current" aria-current="page">New</span>
      </nav>

      <header className="billing-expense__head">
        <div className="billing-expense__title">
          <span className="billing-expense__mark" aria-hidden>
            <Receipt size={22} />
          </span>
          <div>
            <h1>Record an Expense</h1>
            <p>Track your business expenses, keep bills organised and stay tax compliant.</p>
          </div>
        </div>

        <button
          type="button"
          className="billing-button billing-button--small"
          onClick={() => setShortcutsOpen(true)}
          aria-haspopup="dialog"
        >
          <Keyboard size={15} aria-hidden /> Keyboard Shortcuts
        </button>
      </header>

      <div style={{ display: 'grid', gap: 12, marginBottom: 14 }}>
        {scopeChanged && (
          <Notice tone="warning" title="The company, branch or year changed" onDismiss={() => setScopeChanged(false)}>
            The category, payment account and vendor were cleared, because they belonged to the company that was open
            before. Everything else you typed is still here.
          </Notice>
        )}

        {saved && (
          <Notice tone="success" title="Expense recorded successfully." onDismiss={() => setSaved(null)}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Check size={14} aria-hidden />
              {saved.books_voucher_no
                ? `Smart Books has it as ${saved.books_voucher_no}.`
                : 'It has gone to Smart Books.'}
              <Link to={`/more/expense/${saved.request_id}`}>View the entry</Link>
            </span>
          </Notice>
        )}

        {error && (
          <Notice
            tone="danger"
            title="Could not save this expense"
            onDismiss={() => setError(null)}
            action={
              retryId !== null ? (
                <Button tone="primary" disabled={saving} onClick={() => void retry()}>
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
          <Notice tone="warning" title="Possible duplicate expense">
            {money(possibleDuplicate.amount ?? 0)} under the same head is already recorded on{' '}
            {formatDate(possibleDuplicate.date)}
            {possibleDuplicate.note ? ` — “${possibleDuplicate.note}”` : ''}. Saving this will record a second one.{' '}
            <Link to={`/more/expense/${possibleDuplicate.request_id}`}>Look at the first</Link>
          </Notice>
        )}

        {aiError && (
          <Notice tone="warning" title="That bill could not be read" onDismiss={() => setAiError(null)}>
            {aiError}
          </Notice>
        )}

        {proposal && (
          <BillProposalReview
            proposal={proposal}
            onApply={applyProposal}
            onDiscard={() => setProposal(null)}
          />
        )}
      </div>

      <div className="billing-expense__layout">
        <main className="billing-expense__main">
          <ExpenseFormCard
            draft={draft}
            onChange={patch}
            errors={errors}
            showErrors={showErrors}
            currency={currencySymbol()}
            categories={categories}
            paidFrom={paidFrom}
            taxCategories={taxCategories}
            billStorage={capability?.bill_storage ?? null}
            aiFilled={aiFilled}
            saving={saving}
            saveAndNew={saveAndNew}
            onSaveAndNewChange={setSaveAndNew}
            onSave={(mode) => void save(mode)}
            onReset={reset}
            onCancel={cancel}
            fieldRefs={fieldRefs}
          />
        </main>

        <ExpenseHelperPanel
          categories={categories}
          selectedCategoryId={draft.categoryId}
          onPickCategory={(accountId) => {
            patch({ categoryId: String(accountId) })
            fieldRefs.amount.current?.focus()
          }}
          onOpenCategoryList={() => fieldRefs.category.current?.focus()}
          extraction={capability?.bill_extraction ?? null}
          extractionBusy={aiBusy}
          onReadBill={() => billInput.current?.click()}
          recent={recent}
          onDuplicate={duplicate}
          canViewReports={can('reports.view')}
        />
      </div>

      {/* The reader's file picker. Hidden, never a drop target: this deployment
          has nowhere to keep a bill, so a file is read and forgotten, and a
          drop zone would promise otherwise. */}
      <input
        ref={billInput}
        type="file"
        accept={(capability?.bill_storage.accepts ?? ['application/pdf', 'image/jpeg', 'image/png']).join(',')}
        className="billing-sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void readBill(file)
        }}
      />

      {shortcutsOpen && <KeyboardShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </div>
  )
}

/**
 * What the reader thinks is on the bill, before any of it is used.
 *
 * Shown rather than applied, because a total read off a photo is a proposal and
 * the person signing the accounts is the one who decides. The supplier and the
 * tax are displayed but never filled in — matching a name to a ledger is a
 * choice with consequences, so it stays a person's.
 */
function BillProposalReview({
  proposal,
  onApply,
  onDiscard,
}: {
  proposal: BillProposal
  onApply: () => void
  onDiscard: () => void
}) {
  const applied: Array<[string, string]> = []
  if (proposal.fields.amount !== null) applied.push(['Amount', money(proposal.fields.amount)])
  if (proposal.fields.bill_date) applied.push(['Bill date', proposal.fields.bill_date])
  if (proposal.fields.bill_no) applied.push(['Bill number', proposal.fields.bill_no])

  const checkYourself: Array<[string, string]> = []
  if (proposal.fields.supplier_name) checkYourself.push(['Supplier', proposal.fields.supplier_name])
  if (proposal.fields.supplier_gstin) checkYourself.push(['GSTIN', proposal.fields.supplier_gstin])
  if (proposal.fields.tax_amount !== null) checkYourself.push(['Tax on the bill', money(proposal.fields.tax_amount)])

  return (
    <Notice
      tone="info"
      title={`${proposal.read} ${proposal.read === 1 ? 'detail' : 'details'} read from that bill`}
      action={
        <span style={{ display: 'inline-flex', gap: 8 }}>
          <Button onClick={onDiscard}>Discard</Button>
          <Button tone="primary" onClick={onApply}>
            <Sparkles size={14} aria-hidden /> Apply
          </Button>
        </span>
      }
    >
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px', margin: '4px 0 0' }}>
        {applied.map(([label, value]) => (
          <div key={label} style={{ display: 'contents' }}>
            <dt style={{ color: 'var(--billing-muted)' }}>{label}</dt>
            <dd style={{ margin: 0, fontWeight: 600 }}>{value}</dd>
          </div>
        ))}
      </dl>

      {checkYourself.length > 0 && (
        <p style={{ margin: '8px 0 0', display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '0.82rem' }}>
          <AlertCircle size={14} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            Also read, and left for you to set:{' '}
            {checkYourself.map(([label, value]) => `${label} ${value}`).join(' · ')}. Pick the vendor yourself so the
            expense lands on the right ledger.
          </span>
        </p>
      )}
    </Notice>
  )
}
