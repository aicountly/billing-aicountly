/**
 * Sales → Credit note.
 *
 * Crediting a customer is the entry people get wrong most often and can undo
 * least easily, so this screen is built around the four decisions behind it:
 * WHO is being credited, against WHICH bill, WHY, and whether goods actually
 * came back. Everything else follows from those — the bill proposes the lines,
 * the reason proposes the mode, and the mode decides whether Inventory hears
 * about this note at all.
 *
 * WHAT IS OURS AND WHAT IS NOT. The customer list, their bills, the lines on
 * the bill, what is still unpaid on it, the items, the warehouses and the
 * count of notes raised this month are all read live — from Smart Books and
 * Inventory, through this product's own read-through endpoints, on the request
 * that draws them. Billing stores none of it. Issuing is the same call the
 * screen this replaced used, `POST v1/transactions/credit_note`, with the
 * fields that request already accepted and the old form did not offer: the
 * warehouse, the batch, the tax category, which line of the original is being
 * credited, and what state the goods came back in.
 *
 * NOTHING ON THIS SCREEN IS INVENTED. There is no credit note number before
 * Books allots one, no GST figure Billing worked out for itself, and no
 * accounting entry with an amount this product cannot stand behind. Where a
 * reading is unavailable the card says so; it never renders as a zero.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  BadgeIndianRupee,
  Check,
  FileText,
  Keyboard,
  Percent,
  ReceiptText,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { api, ApiError } from '../../services/api'
import type {
  CatalogItem,
  CatalogParty,
  CreditNoteTrend,
  OriginalDocument,
  OriginalDocumentDetail,
  OriginalDocumentLine,
  OriginalDocuments,
  TransactionRequest,
} from '../../services/types'
import { readId, readText } from '../../services/shapes'
import { useApi } from '../../hooks/useApi'
import { useBilling } from '../../context/BillingContext'
import { fetchCompanyInfo } from '../../services/manage'
import { Button, date as formatDate, money, Notice, qty as formatQty, ToastStack, useToasts } from '../../ui'
import { CreditNoteDetails } from './CreditNoteDetails'
import { CreditNoteLines, scannedItemToPatch, type WarehouseOption } from './CreditNoteLines'
import { CreditNoteSummary } from './CreditNoteSummary'
import { IssueDialog, ShortcutsDialog } from './dialogs'
import {
  CREDIT_REASONS,
  clearDraft,
  emptyDraft,
  emptyLine,
  firstError,
  hasErrors,
  isDirty,
  lineFromInvoice,
  readDraft,
  saveDraft,
  stockByWarehouse,
  taxRatesOnLines,
  toCreditNoteRequest,
  today,
  totals as computeTotals,
  validate,
  warnings as computeWarnings,
  type CreditLine,
  type CreditNoteDraft,
  type FinancialYearWindow,
  type ReturnMode,
} from './creditNote'
import '../../styles/billing-credit-note.css'

export default function CreditNotePage() {
  const navigate = useNavigate()
  const { scope, session, can } = useBilling()
  const mayRaise = can('credit_note.create')
  const mayDiscount = can('discount.override')
  const gstRegistered = session?.settings.gst_registered ?? false

  const [draft, setDraft] = useState<CreditNoteDraft>(() => emptyDraft())
  const [showErrors, setShowErrors] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryId, setRetryId] = useState<number | null>(null)
  const [issued, setIssued] = useState<TransactionRequest | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [restored, setRestored] = useState<string | null>(null)
  const [scopeChanged, setScopeChanged] = useState(false)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const { toasts, push, dismiss } = useToasts()

  // A second click on Issue while the first is in flight would be a second
  // note. The button is disabled; this closes the gap between the click and
  // React getting round to the re-render.
  const inFlight = useRef(false)
  /** Set once somebody picks the mode themselves, so a reason stops proposing one. */
  const modeChosen = useRef(false)
  /** The bill whose lines are already on the note, so the fill runs once. */
  const filledFrom = useRef<number | null>(null)

  const customerRef = useRef<HTMLInputElement>(null)
  const invoiceRef = useRef<HTMLInputElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  const reasonRef = useRef<HTMLSelectElement>(null)

  const enabled = Boolean(scope) && mayRaise
  const scopeKey = `${scope?.cmp_id ?? 0}:${scope?.fy_id ?? 0}:${scope?.bo_id ?? 0}`

  // ------------------------------------------------------------ live lists

  /** This customer's bills, read from Books the moment one is chosen. */
  const documents = useApi(
    (signal) =>
      api.one<OriginalDocuments>(
        'v1/original-documents',
        { party_account_id: draft.customer?.acc_id, kind: 'sale' },
        signal,
      ),
    [draft.customer?.acc_id, scopeKey],
    enabled && draft.customer !== null,
  )

  /** The chosen bill, with the lines that were billed on it. */
  const invoiceLines = useApi(
    (signal) => api.one<OriginalDocumentDetail>(`v1/original-documents/${draft.invoice?.voucher_id}`, undefined, signal),
    [draft.invoice?.voucher_id, scopeKey],
    enabled && Boolean(draft.invoice?.voucher_id),
  )

  const warehouses = useApi(
    (signal) => api.list<Record<string, unknown>>('v1/catalog/warehouses', undefined, signal),
    [scope?.cmp_id],
    enabled,
  )

  /** How many notes this month. Lazy: the screen works without the card. */
  const trend = useApi(
    (signal) => api.one<CreditNoteTrend>('v1/credit-notes/trend', undefined, signal),
    [scopeKey],
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

  const warehouseOptions = useMemo<WarehouseOption[]>(() => {
    return (warehouses.data?.data ?? [])
      .map((row) => {
        const id = readId(row, ['mc_id', 'warehouse_id', 'wh_id', 'id'])
        const name = readText(row, ['mc_name', 'warehouse_name', 'wh_name', 'name', 'location_name'])

        return id === null ? null : { id: String(id), name: name ?? `Warehouse ${id}` }
      })
      .filter((option): option is WarehouseOption => option !== null)
  }, [warehouses.data])

  const warehouseName = useCallback(
    (id: string) => warehouseOptions.find((option) => option.id === id)?.name ?? `Warehouse ${id}`,
    [warehouseOptions],
  )

  /** One warehouse set up means there is nothing to ask. */
  const onlyWarehouse = warehouseOptions.length === 1 ? warehouseOptions[0].id : ''

  // ------------------------------------------------------------- the draft

  const patch = useCallback((changes: Partial<CreditNoteDraft>) => {
    setDraft((current) => ({ ...current, ...changes }))
  }, [])

  const patchLine = useCallback((key: string, changes: Partial<CreditLine>) => {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.key === key ? { ...line, ...changes } : line)),
    }))
  }, [])

  const removeLine = useCallback((key: string) => {
    setDraft((current) => ({ ...current, lines: current.lines.filter((line) => line.key !== key) }))
  }, [])

  const addBlankLine = useCallback(() => {
    const line = { ...emptyLine(), warehouseId: onlyWarehouse }
    setDraft((current) => ({ ...current, lines: [...current.lines, line] }))
    setFocusKey(line.key)
  }, [onlyWarehouse])

  const addFromBill = useCallback(
    (line: OriginalDocumentLine) => {
      setDraft((current) => ({ ...current, lines: [...current.lines, lineFromInvoice(line, onlyWarehouse)] }))
    },
    [onlyWarehouse],
  )

  /**
   * The bill's own lines, proposed as soon as Books hands them over.
   *
   * Once per bill: a person who deleted a line does not want it back on the
   * next render, and `filledFrom` is what keeps this from being that bug.
   */
  useEffect(() => {
    const detail = invoiceLines.data?.data
    if (!detail || !detail.lines_available) return
    if (filledFrom.current === detail.voucher_id) return

    filledFrom.current = detail.voucher_id
    setDraft((current) => ({
      ...current,
      lines: detail.lines.map((line) => lineFromInvoice(line, onlyWarehouse)),
    }))
  }, [invoiceLines.data, onlyWarehouse])

  const pickCustomer = useCallback((customer: CatalogParty | null) => {
    // The bill and its lines belong to the customer that was chosen before.
    filledFrom.current = null
    setDraft((current) => ({ ...current, customer, invoice: null, lines: [] }))
    setIssued(null)
  }, [])

  const pickInvoice = useCallback((invoice: OriginalDocument | null) => {
    filledFrom.current = null
    setDraft((current) => ({ ...current, invoice, lines: [] }))
    setIssued(null)
  }, [])

  const pickReason = useCallback((reasonCode: string) => {
    const proposed = CREDIT_REASONS.find((option) => option.value === reasonCode)?.mode
    setDraft((current) => ({
      ...current,
      reasonCode,
      // A proposal, and only while nobody has said otherwise themselves.
      mode: !modeChosen.current && proposed ? proposed : current.mode,
    }))
  }, [])

  const pickMode = useCallback((mode: ReturnMode) => {
    modeChosen.current = true
    setDraft((current) => ({ ...current, mode }))
  }, [])

  /**
   * Switching company, branch or year mid-entry.
   *
   * The ids in this note belong to the company that was open when they were
   * picked. Keeping them and issuing would credit a customer in another
   * company's ledger, so they go; the date and the remarks are
   * company-neutral and stay, because throwing away typing nobody asked to
   * throw away is its own bug.
   */
  const previousScope = useRef(scopeKey)
  useEffect(() => {
    if (previousScope.current === scopeKey) return
    previousScope.current = scopeKey
    filledFrom.current = null

    setDraft((current) => {
      if (!current.customer && !current.invoice && current.lines.length === 0) return current
      setScopeChanged(true)
      return { ...current, customer: null, invoice: null, lines: [] }
    })
    setIssued(null)
    setError(null)
    setRetryId(null)
  }, [scopeKey])

  /** A note explicitly kept on this device, offered back on the next visit. */
  useEffect(() => {
    if (!scope || !mayRaise) return
    const stored = readDraft(scope.cmp_id, scope.fy_id)
    if (!stored || !isDirty(stored.draft)) return

    setDraft(stored.draft)
    modeChosen.current = true
    filledFrom.current = stored.draft.invoice?.voucher_id ?? null
    setRestored(stored.savedAt)
    // Only on the way in, and only for the company that is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope?.cmp_id, scope?.fy_id, mayRaise])

  const dirty = isDirty(draft)

  /** The browser's own warning, for a tab closed with a note half typed. */
  useEffect(() => {
    if (!dirty || issued) return undefined

    function warn(event: BeforeUnloadEvent) {
      event.preventDefault()
    }

    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, issued])

  // ------------------------------------------------------------ the totals

  const amounts = useMemo(() => computeTotals(draft), [draft])
  const stock = useMemo(() => stockByWarehouse(draft), [draft])
  const taxRates = useMemo(() => taxRatesOnLines(draft), [draft])
  const riskNotes = useMemo(() => computeWarnings(draft, amounts), [draft, amounts])

  const errors = useMemo(
    () =>
      validate(draft, {
        fy: fyWindow,
        warehousesAvailable: warehouseOptions.length > 0,
        invoiceListUnavailable: documents.error !== null,
        mayDiscount,
      }),
    [draft, fyWindow, warehouseOptions.length, documents.error, mayDiscount],
  )

  const remainingFromBill = useMemo(() => {
    const detail = invoiceLines.data?.data
    if (!detail?.lines_available) return []
    const used = new Set(draft.lines.map((line) => line.invoiceLineRef).filter(Boolean))

    return detail.lines.filter((line) => !used.has(line.line_ref))
  }, [invoiceLines.data, draft.lines])

  // ---------------------------------------------------------------- saving

  function keepDraft() {
    if (!scope) return
    const ok = saveDraft(scope.cmp_id, scope.fy_id, draft)
    push(
      ok
        ? { tone: 'success', title: 'Draft kept on this device', detail: 'It is here when you come back, until you issue it.' }
        : { tone: 'danger', title: 'This browser would not keep the draft', detail: 'Issue the note now, or write the details down.' },
    )
  }

  function askToIssue() {
    if (hasErrors(errors)) {
      setShowErrors(true)
      const first = firstError(errors)
      const focus = {
        customer: customerRef,
        invoice: invoiceRef,
        date: dateRef,
        reasonCode: reasonRef,
      }[first as 'customer' | 'invoice' | 'date' | 'reasonCode']
      if (focus?.current) {
        focus.current.focus()
      } else if (first === 'lines') {
        document.getElementById('billing-cn-lines-title')?.scrollIntoView({ block: 'center' })
      }
      return
    }

    setConfirmOpen(true)
  }

  async function issue() {
    if (inFlight.current) return

    inFlight.current = true
    setIssuing(true)
    setError(null)
    setRetryId(null)

    try {
      const response = await api.post<TransactionRequest>(
        'v1/transactions/credit_note',
        toCreditNoteRequest(draft),
      )

      if (scope) clearDraft(scope.cmp_id, scope.fy_id)
      setIssued(response.data)
      setConfirmOpen(false)
      setShowErrors(false)
      setRestored(null)
      push({
        tone: 'success',
        title: response.data.books_voucher_no
          ? `Credit note ${response.data.books_voucher_no} issued`
          : 'Credit note issued',
        detail: `${money(amounts.taxable)} before tax, credited to ${draft.customer?.acc_name ?? 'the customer'}.`,
      })

      const next = emptyDraft(draft.date)
      setDraft(next)
      modeChosen.current = false
      filledFrom.current = null
      trend.reload()
      window.scrollTo({ top: 0 })
    } catch (err) {
      setConfirmOpen(false)
      if (err instanceof ApiError) {
        setError(err.message)
        // The backend hands back the request id when the call reached it but
        // Books did not answer: the same row can be pushed again on the same
        // idempotency key, which is why retrying cannot make a second note.
        const id = err.details.request_id
        if (err.retryable && typeof id === 'number') setRetryId(id)
      } else {
        setError(String(err))
      }
      push({ tone: 'danger', title: 'The credit note was not issued', detail: 'Nothing has been credited. What you typed is still here.' })
    } finally {
      inFlight.current = false
      setIssuing(false)
    }
  }

  async function retry() {
    if (retryId === null || inFlight.current) return

    inFlight.current = true
    setIssuing(true)
    setError(null)
    try {
      const response = await api.post<TransactionRequest>(`v1/transactions/${retryId}/retry`, {})
      if (scope) clearDraft(scope.cmp_id, scope.fy_id)
      setIssued(response.data)
      setRetryId(null)
      const next = emptyDraft(today())
      setDraft(next)
      modeChosen.current = false
      filledFrom.current = null
      trend.reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      inFlight.current = false
      setIssuing(false)
    }
  }

  /** Scan to credit: the barcode goes straight to Inventory, as it does on a bill. */
  async function scan(code: string) {
    if (code === '') return
    setScanning(true)
    try {
      let item: CatalogItem | null = null
      try {
        const found = await api.one<CatalogItem>(`v1/catalog/items/barcode/${encodeURIComponent(code)}`)
        item = found.data
      } catch {
        const search = await api.list<CatalogItem>('v1/catalog/items/search', { q: code, limit: 1 })
        item = search.data[0] ?? null
      }

      if (!item) {
        push({ tone: 'danger', title: 'No item with that code', detail: `Inventory has nothing for “${code}”.` })
        return
      }

      const line: CreditLine = { ...emptyLine(), warehouseId: onlyWarehouse, ...scannedItemToPatch(item) }
      setDraft((current) => ({ ...current, lines: [...current.lines, line] }))
    } catch (err) {
      push({
        tone: 'danger',
        title: 'Could not reach Inventory',
        detail: err instanceof ApiError ? err.message : 'Try again in a moment.',
      })
    } finally {
      setScanning(false)
    }
  }

  function cancel() {
    if (dirty && !window.confirm('Leave this credit note without issuing it?')) return
    navigate(-1)
  }

  function startAnother() {
    setIssued(null)
    setDraft(emptyDraft(today()))
    modeChosen.current = false
    filledFrom.current = null
    customerRef.current?.focus()
  }

  // ------------------------------------------------------------- shortcuts

  // The handler is bound once. The callbacks are rebuilt on most renders, and
  // a document listener torn down and re-added with them is work done on
  // every keystroke in a form somebody types into all day.
  const latest = useRef({ askToIssue, keepDraft, addBlankLine })
  latest.current = { askToIssue, keepDraft, addBlankLine }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        latest.current.askToIssue()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        latest.current.keepDraft()
        return
      }
      if (!event.altKey || event.ctrlKey || event.metaKey) return

      if (event.key.toLowerCase() === 'a') {
        event.preventDefault()
        latest.current.addBlankLine()
        return
      }

      const target = { c: customerRef, i: invoiceRef }[event.key.toLowerCase()]
      if (target?.current) {
        event.preventDefault()
        target.current.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // ---------------------------------------------------------------- render

  if (!mayRaise) {
    return (
      <div className="billing-cn">
        <Notice tone="info" title="Raising a credit note is not part of your profile">
          Ask whoever manages Billing profiles for this company to add it.
        </Notice>
      </div>
    )
  }

  const detail = invoiceLines.data?.data ?? null
  const emptyReason = !draft.customer
    ? ('no-customer' as const)
    : !draft.invoice
      ? ('no-bill' as const)
      : detail && !detail.lines_available
        ? ('no-lines' as const)
        : null

  return (
    <div className="billing-cn">
      <nav className="billing-cn__crumbs" aria-label="Breadcrumb">
        <Link to="/sales">Sales</Link>
        <span className="billing-cn__crumb-sep" aria-hidden>
          ›
        </span>
        <span className="billing-cn__crumb-current" aria-current="page">
          Credit note
        </span>
      </nav>

      <header className="billing-cn__head">
        <div className="billing-cn__title">
          <span className="billing-cn__mark" aria-hidden>
            <ReceiptText size={22} />
          </span>
          <div>
            <h1>Credit note</h1>
            <p>
              Credit a customer — because goods came back, or because the bill was wrong. Smart Books works out the
              accounting and the tax, and Inventory takes back anything that returned to stock.
            </p>
          </div>
        </div>

        <div className="billing-cn__chips">
          <span className="billing-cn-chip billing-cn-chip--muted">
            {issued ? 'Issued' : 'Draft'}
          </span>
          {issued?.books_voucher_no && (
            <span className="billing-cn-chip">
              <Check size={13} aria-hidden /> {issued.books_voucher_no}
            </span>
          )}
          <span className={`billing-cn-chip ${gstRegistered ? 'billing-cn-chip--good' : 'billing-cn-chip--muted'}`}>
            {gstRegistered ? 'GST registered' : 'Not GST registered'}
          </span>
          <span className="billing-cn-chip billing-cn-chip--info">
            <Sparkles size={13} aria-hidden /> Posted by Smart Books
          </span>
          <button
            type="button"
            className="billing-button billing-button--small"
            onClick={() => setShortcutsOpen(true)}
            aria-haspopup="dialog"
          >
            <Keyboard size={15} aria-hidden /> Shortcuts
          </button>
        </div>
      </header>

      <section className="billing-cn__insights" aria-label="This credit note at a glance">
        <Insight
          tone="blue"
          icon={<FileText size={18} />}
          label="Against bill"
          value={draft.invoice?.document_no ?? 'Not chosen yet'}
          quiet={!draft.invoice}
          note={
            draft.invoice
              ? `${formatDate(draft.invoice.date)}${
                  draft.invoice.amount !== null ? ` · ${money(draft.invoice.amount)}` : ''
                }`
              : 'Pick the bill being credited'
          }
        />
        <Insight
          tone="violet"
          icon={draft.mode === 'GOODS_RETURN' ? <RotateCcw size={18} /> : <Percent size={18} />}
          label="This note"
          value={draft.mode === 'GOODS_RETURN' ? 'Goods return' : 'Value adjustment'}
          note={
            amounts.lineCount === 0
              ? 'Nothing on it yet'
              : `${amounts.lineCount} ${amounts.lineCount === 1 ? 'line' : 'lines'}${
                  draft.mode === 'GOODS_RETURN' ? ` · ${formatQty(amounts.units)} units back` : ''
                }`
          }
        />
        <Insight
          tone="green"
          icon={<Percent size={18} />}
          label="GST impact"
          value={gstRegistered ? 'By Smart Books' : 'Not applicable'}
          quiet={!gstRegistered}
          note={
            gstRegistered
              ? taxRates.length > 0
                ? `${taxRates.map((rate) => `${formatQty(rate)}%`).join(', ')} on this note`
                : 'The same treatment as the bill'
              : 'This company is not registered'
          }
        />
        <Insight
          tone="teal"
          icon={<BadgeIndianRupee size={18} />}
          label="Total credit"
          value={money(amounts.taxable)}
          note="Before tax"
        />
        <TrendCard state={trend.data?.data ?? null} loading={trend.loading} />
      </section>

      <div className="billing-cn__messages">
        {scopeChanged && (
          <Notice tone="warning" title="The company, branch or year changed" onDismiss={() => setScopeChanged(false)}>
            The customer, the bill and its lines were cleared, because they belonged to the company that was open
            before. The date and your remarks are still here.
          </Notice>
        )}

        {restored && (
          <Notice
            tone="info"
            title="Picked up where you left off"
            onDismiss={() => setRestored(null)}
            action={
              <Button
                onClick={() => {
                  if (scope) clearDraft(scope.cmp_id, scope.fy_id)
                  setDraft(emptyDraft(today()))
                  modeChosen.current = false
                  filledFrom.current = null
                  setRestored(null)
                }}
              >
                Start fresh
              </Button>
            }
          >
            This draft was kept on this device{restored ? ` on ${formatDate(restored.slice(0, 10))}` : ''}. It has not
            gone to Smart Books and nothing has been credited yet.
          </Notice>
        )}

        {issued && (
          <Notice tone="success" title="Credit note issued" onDismiss={() => setIssued(null)}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Check size={14} aria-hidden />
              {issued.books_voucher_no
                ? `Smart Books has it as ${issued.books_voucher_no}.`
                : 'It has gone to Smart Books.'}
              <Link to={`/sales/${issued.request_id}`}>View the credit note</Link>
              {issued.party_account_id !== null && (
                <Link to={`/parties/${issued.party_account_id}`}>Customer ledger</Link>
              )}
              <Button onClick={startAnother}>Create another</Button>
            </span>
          </Notice>
        )}

        {error && (
          <Notice
            tone="danger"
            title="Could not issue this credit note"
            onDismiss={() => setError(null)}
            action={
              retryId !== null ? (
                <Button tone="primary" disabled={issuing} onClick={() => void retry()}>
                  Retry
                </Button>
              ) : undefined
            }
          >
            {error}
            {retryId !== null && (
              <div style={{ marginTop: 4, fontSize: '0.8rem' }}>
                Retrying uses the same key as the first attempt, so it cannot credit this twice.
              </div>
            )}
          </Notice>
        )}

        {documents.error && draft.customer && (
          <Notice tone="warning" title="Could not list this customer’s bills">
            {documents.error} You can still raise the note without a reference, but it will be harder to match later.
          </Notice>
        )}

        {detail && !detail.lines_available && (
          <Notice tone="info" title="Smart Books gave no lines for that bill">
            {detail.note} The note is still linked to {detail.document_no ?? 'it'}.
          </Notice>
        )}
      </div>

      <div className="billing-cn__layout">
        <main className="billing-cn__main">
          <CreditNoteDetails
            draft={draft}
            errors={errors}
            showErrors={showErrors}
            documents={documents.data?.data.documents ?? []}
            documentsLoading={documents.loading}
            documentsFailed={documents.error !== null}
            outstandingAvailable={documents.data?.data.outstanding_available ?? false}
            fyLabel={fyWindow.label}
            onPatch={patch}
            onPickCustomer={pickCustomer}
            onPickInvoice={pickInvoice}
            onPickReason={pickReason}
            onPickMode={pickMode}
            refs={{ customer: customerRef, invoice: invoiceRef, date: dateRef, reason: reasonRef }}
          />

          {invoiceLines.loading ? (
            <div className="billing-cn-card" aria-busy="true">
              <div className="billing-cn-card__head">
                <div>
                  <h2>Reading the bill…</h2>
                  <p>Smart Books is being asked what was on it.</p>
                </div>
              </div>
              <div className="billing-skeleton-rows" style={{ padding: 18 }}>
                <span className="billing-sr-only">Loading the lines on this bill</span>
                <span className="billing-skeleton billing-skeleton--line" />
                <span className="billing-skeleton billing-skeleton--line" />
                <span className="billing-skeleton billing-skeleton--line" />
              </div>
            </div>
          ) : (
            <CreditNoteLines
              lines={draft.lines}
              mode={draft.mode}
              errors={errors}
              showErrors={showErrors}
              warehouses={warehouseOptions}
              warehousesLoading={warehouses.loading}
              mayDiscount={mayDiscount}
              remainingFromBill={remainingFromBill}
              billLinesAvailable={detail?.lines_available ?? false}
              emptyReason={emptyReason}
              focusKey={focusKey}
              onPatchLine={patchLine}
              onRemoveLine={removeLine}
              onAddBlankLine={addBlankLine}
              onAddFromBill={addFromBill}
              onAddAllFromBill={() => remainingFromBill.forEach(addFromBill)}
              onScan={(code) => void scan(code)}
              scanning={scanning}
              onChooseCustomer={() => customerRef.current?.focus()}
              onChooseBill={() => invoiceRef.current?.focus()}
            />
          )}
        </main>

        <aside className="billing-cn__rail" aria-label="What this credit note comes to">
          <CreditNoteSummary
            totals={amounts}
            mode={draft.mode}
            customer={draft.customer}
            invoice={draft.invoice}
            stock={stock}
            warehouseName={warehouseName}
            gstRegistered={gstRegistered}
            taxRates={taxRates}
            warnings={riskNotes}
          />
        </aside>
      </div>

      <div className="billing-cn__actions">
        <p className="billing-cn__actions-note">
          {amounts.lineCount === 0
            ? 'Nothing on this note yet.'
            : `${amounts.lineCount} ${amounts.lineCount === 1 ? 'line' : 'lines'} · ${money(
                amounts.taxable,
              )} before tax`}
        </p>
        <button type="button" className="billing-button" onClick={cancel} disabled={issuing}>
          Cancel
        </button>
        <button
          type="button"
          className="billing-button"
          onClick={keepDraft}
          disabled={issuing || !dirty}
          title="Kept in this browser until the note is issued"
        >
          <Save size={14} aria-hidden /> Save draft
        </button>
        <button
          type="button"
          className="billing-button billing-button--primary"
          onClick={askToIssue}
          disabled={issuing}
        >
          <Send size={14} aria-hidden /> {issuing ? 'Issuing…' : 'Issue credit note'}
        </button>
      </div>

      {confirmOpen && (
        <IssueDialog
          customerName={draft.customer?.acc_name ?? 'the customer'}
          documentNo={draft.invoice?.document_no ?? null}
          amount={amounts.taxable}
          units={amounts.units}
          goodsReturn={draft.mode === 'GOODS_RETURN'}
          gstRegistered={gstRegistered}
          warnings={riskNotes}
          busy={issuing}
          onConfirm={() => void issue()}
          onClose={() => setConfirmOpen(false)}
        />
      )}

      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}

function Insight({
  tone,
  icon,
  label,
  value,
  note,
  quiet,
}: {
  tone: 'blue' | 'violet' | 'green' | 'teal'
  icon: React.ReactNode
  label: string
  value: string
  note?: string
  quiet?: boolean
}) {
  return (
    <article className="billing-cn-insight">
      <span className={`billing-cn-insight__icon billing-cn-insight__icon--${tone}`} aria-hidden>
        {icon}
      </span>
      <span className="billing-cn-insight__body">
        <span className="billing-cn-insight__label">{label}</span>
        <span
          className={`billing-cn-insight__value${quiet ? ' billing-cn-insight__value--quiet' : ''}`}
          title={value}
        >
          {value}
        </span>
        {note && <span className="billing-cn-insight__note">{note}</span>}
      </span>
    </article>
  )
}

/**
 * Credit notes raised this month.
 *
 * Books' own register, counted live. The card is simply absent when that
 * count cannot be proved — a returns figure that is believable and short is
 * worse than no figure, because somebody would act on it.
 */
function TrendCard({ state, loading }: { state: CreditNoteTrend | null; loading: boolean }) {
  if (loading) {
    return (
      <article className="billing-cn-insight" aria-busy="true">
        <span className="billing-cn-insight__body">
          <span className="billing-cn-insight__label">Credit notes this month</span>
          <span className="billing-skeleton billing-skeleton--line" style={{ width: '60%' }} />
        </span>
      </article>
    )
  }

  if (!state?.available || state.count === undefined) return null

  const previous = state.previous_count ?? null
  const delta = previous === null || previous === 0 ? null : Math.round(((state.count - previous) / previous) * 100)
  const series = state.series ?? []
  const peak = Math.max(1, ...series.map((bucket) => bucket.count))

  return (
    <article className="billing-cn-insight">
      <span className="billing-cn-insight__body">
        <span className="billing-cn-insight__label">Credit notes this month</span>
        <span className="billing-cn-insight__value">
          {state.count} {state.count === 1 ? 'note' : 'notes'}
        </span>
        {/* The comparison window is the same number of days immediately
            before, which is a date range too long for this card — so it is
            named in the tooltip and described in words on the face. */}
        <span className="billing-cn-insight__note" title={state.previous_label ?? undefined}>
          {delta === null ? (
            previous === null ? (
              `${state.label ?? 'This month'} so far`
            ) : (
              'None in the window before'
            )
          ) : (
            <>
              <span
                className={`billing-cn-insight__delta billing-cn-insight__delta--${delta > 0 ? 'up' : 'down'}`}
              >
                {delta > 0 ? <TrendingUp size={11} aria-hidden /> : <TrendingDown size={11} aria-hidden />}{' '}
                {Math.abs(delta)}%
              </span>{' '}
              vs the window before
            </>
          )}
        </span>
      </span>

      {series.length > 0 && (
        <span className="billing-cn-spark" aria-hidden>
          {series.map((bucket) => (
            <span key={bucket.label} style={{ height: `${Math.round((bucket.count / peak) * 40) + 4}px` }} />
          ))}
        </span>
      )}
    </article>
  )
}
