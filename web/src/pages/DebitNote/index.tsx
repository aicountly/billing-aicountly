/**
 * Purchases → Debit note.
 *
 * Charging a supplier back, on one page. What this screen is responsible for is
 * gathering what the person knows and handing it to Smart Books; what it is
 * careful NOT to do is decide anything Books or Inventory owns:
 *
 *  - no tax is calculated here, only the category is chosen;
 *  - no ledger is named, because which ones move depends on settings Billing
 *    cannot see;
 *  - no document number is generated, because Books numbers its own series;
 *  - and a value-only note never carries an item id, which is what stops
 *    anything downstream reading it as stock coming back.
 *
 * Posting goes through the same transaction-request row and idempotency key as
 * every other document in this product, so a second press of the button — or a
 * retry after the network dropped — cannot make a second note.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Keyboard, Loader2, Save, Upload } from 'lucide-react'
import { api, ApiError } from '../../services/api'
import { useApi } from '../../hooks/useApi'
import { useBilling } from '../../context/BillingContext'
import { fetchCompanyInfo } from '../../services/manage'
import { getAppById } from '../../services/appLauncher'
import { launchApp } from '../../services/appLauncher'
import { capability } from '../../services/types'
import type {
  CatalogItem,
  CatalogParty,
  OpenBill,
  OriginalDocument,
  TaxCategory,
  TransactionRequest,
  Warehouse,
} from '../../services/types'
import { Notice, money } from '../../ui'
import { DnMenu, DnStepper } from './parts'
import { SupplierDocumentCard, type DocumentList } from './SupplierDocumentCard'
import { ItemsCard } from './ItemsCard'
import { AccountingImpactCard, SummaryCard } from './SummaryCards'
import { HelpCard, NotesCard, QuickActionsCard } from './Sidebar'
import { DebitNoteSuccess } from './Success'
import {
  activeStep,
  clearDraft,
  draftKey,
  emptyLine,
  openingRate,
  overAdjusted,
  readDraft,
  stepsOf,
  totalsOf,
  validate,
  writeDraft,
  type DebitNoteLine,
  type ReturnKind,
} from './model'
import '../../styles/debit-note.css'

export default function DebitNotePage() {
  const navigate = useNavigate()
  const { can, scope, session } = useBilling()

  const mayPost = can('debit_note.create')
  const mayDiscount = can('discount.override')
  const maintainsStock = session?.settings.maintains_stock ?? true

  const extraction = capability(session, 'document_extraction')
  const attachments = capability(session, 'transaction_attachments')
  const drafts = capability(session, 'transaction_drafts')
  const accountingPreview = capability(session, 'accounting_preview')

  // ------------------------------------------------------------------ state

  const [supplier, setSupplier] = useState<{ id: number; name: string; gstin?: string | null } | null>(null)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [reference, setReference] = useState('')
  const [reason, setReason] = useState('')
  const [returnKind, setReturnKind] = useState<ReturnKind>('goods_return')
  const [warehouseId, setWarehouseId] = useState('')
  const [lines, setLines] = useState<DebitNoteLine[]>(() => [emptyLine()])
  const [adjustment, setAdjustment] = useState('')
  const [notes, setNotes] = useState('')
  const [against, setAgainst] = useState<OriginalDocument | null>(null)

  const [saving, setSaving] = useState(false)
  const [showProblems, setShowProblems] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryId, setRetryId] = useState<number | null>(null)
  const [posted, setPosted] = useState<TransactionRequest | null>(null)
  const [postedTotal, setPostedTotal] = useState(0)
  const [draftNote, setDraftNote] = useState<string | null>(null)
  const [restorable, setRestorable] = useState<ReturnType<typeof readDraft>>(null)

  const pageRef = useRef<HTMLDivElement>(null)
  const impactRef = useRef<HTMLDivElement>(null)
  // Guards the post against a double press that beats the disabled attribute.
  const inFlight = useRef(false)

  const storageKey = draftKey(scope?.cmp_id, scope?.fy_id)

  // ------------------------------------------------------------------- data

  /**
   * The bills this note could be against. Books owns the original, so this is a
   * live read and it only happens once a supplier is chosen.
   */
  const originals = useApi(
    (signal) =>
      api.one<{ documents: OriginalDocument[]; note: string }>(
        'v1/original-documents',
        { party_account_id: supplier?.id, kind: 'purchase' },
        signal,
      ),
    [supplier?.id, scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    Boolean(scope && supplier && mayPost),
  )

  /**
   * What is still owed on each of those bills.
   *
   * A convenience on top of the list, and gated on the permission the endpoint
   * itself asserts — somebody who may raise a note but not record a payment
   * simply does not see the outstanding column.
   */
  const openBills = useApi(
    (signal) =>
      api.one<{ bills: OpenBill[] }>('v1/open-bills', { account_id: supplier?.id, side: 'payable' }, signal),
    [supplier?.id, scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    Boolean(scope && supplier && can('payment.create')),
  )

  const taxCategories = useApi(
    (signal) => api.list<TaxCategory>('v1/catalog/tax-categories', undefined, signal),
    [scope?.cmp_id, scope?.fy_id],
    Boolean(scope && mayPost),
  )

  const warehouses = useApi(
    (signal) => api.list<Warehouse>('v1/catalog/warehouses', undefined, signal),
    [scope?.cmp_id],
    Boolean(scope && maintainsStock && mayPost),
  )

  /**
   * The financial year's dates, from Manage, so a date outside it is caught
   * here instead of by Books after a round trip. Manage owns the year; this
   * reads it and keeps nothing.
   */
  const [fy, setFy] = useState<{ start: string; end: string; label: string } | null>(null)

  useEffect(() => {
    if (!scope) return undefined
    const controller = new AbortController()

    fetchCompanyInfo(scope.cmp_id, controller.signal)
      .then((info) => {
        if (controller.signal.aborted) return
        const match = info.fyList.find((year) => year.fyId === scope.fy_id)
        setFy(match ? { start: match.start, end: match.end, label: match.label } : null)
      })
      .catch(() => {
        // The dates are a courtesy; Books validates the period either way.
        if (!controller.signal.aborted) setFy(null)
      })

    return () => controller.abort()
  }, [scope])

  // ---------------------------------------------------------------- derived

  const outstanding = useMemo(() => {
    const map: Record<number, number> = {}
    for (const bill of openBills.data?.data.bills ?? []) {
      if (bill.voucher_id !== null) map[bill.voucher_id] = bill.balance
    }
    return map
  }, [openBills.data])

  const documents: DocumentList = {
    documents: originals.data?.data.documents ?? [],
    outstanding,
    note: originals.data?.data.note ?? null,
    loading: originals.loading,
    error: originals.error,
    reload: originals.reload,
  }

  const totals = useMemo(() => totalsOf(returnKind, lines, adjustment), [returnKind, lines, adjustment])

  const problems = useMemo(
    () =>
      validate({
        supplierId: supplier?.id ?? null,
        date,
        reason,
        returnKind,
        lines,
        adjustment,
        fy,
        againstAmount: against?.amount ?? null,
      }),
    [supplier, date, reason, returnKind, lines, adjustment, fy, against],
  )

  const shown = showProblems ? problems : {}
  const steps = useMemo(
    () =>
      stepsOf({
        supplierId: supplier?.id ?? null,
        reason,
        date,
        totals,
        problems,
        posted: posted !== null,
      }),
    [supplier, reason, date, totals, problems, posted],
  )

  // ----------------------------------------------------------------- drafts

  // Offered, never applied behind the user's back: somebody who opened this
  // screen to type a new note should get an empty one.
  useEffect(() => {
    if (!scope) return
    const found = readDraft(storageKey)
    if (found) setRestorable(found)
  }, [scope, storageKey])

  const restore = useCallback(() => {
    if (!restorable) return
    setSupplier(restorable.supplier)
    setDate(restorable.date)
    setReference(restorable.reference)
    setReason(restorable.reason)
    setReturnKind(restorable.returnKind)
    setWarehouseId(restorable.warehouseId)
    setLines(restorable.lines.length > 0 ? restorable.lines : [emptyLine()])
    setAdjustment(restorable.adjustment)
    setNotes(restorable.notes)
    setAgainst(
      restorable.against
        ? {
            voucher_id: restorable.against.voucher_id,
            voucher_uuid: null,
            document_no: restorable.against.document_no,
            date: restorable.against.date,
            party: null,
            party_id: restorable.supplier?.id ?? null,
            amount: restorable.against.amount,
            status: null,
          }
        : null,
    )
    setRestorable(null)
    setDraftNote('Your draft is back. Nothing has been sent to Smart Books.')
  }, [restorable])

  const saveDraft = useCallback(() => {
    const ok = writeDraft(storageKey, {
      savedAt: new Date().toISOString(),
      supplier,
      date,
      reference,
      reason,
      returnKind,
      warehouseId,
      lines,
      adjustment,
      notes,
      against: against
        ? {
            voucher_id: against.voucher_id,
            document_no: against.document_no,
            date: against.date,
            amount: against.amount,
          }
        : null,
    })

    setDraftNote(
      ok
        ? 'Draft kept in this browser. It is not on the server and nobody else can see it — posting is what sends it to Smart Books.'
        : 'This browser would not store the draft, so nothing was kept.',
    )
  }, [storageKey, supplier, date, reference, reason, returnKind, warehouseId, lines, adjustment, notes, against])

  // ------------------------------------------------------------------ lines

  const patchLine = useCallback((key: string, patch: Partial<DebitNoteLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }, [])

  const addLine = useCallback(() => {
    setLines((current) => [...current, emptyLine()])
  }, [])

  const removeLine = useCallback((key: string) => {
    setLines((current) => (current.length > 1 ? current.filter((line) => line.key !== key) : [emptyLine()]))
  }, [])

  /**
   * An item chosen from Inventory.
   *
   * The name, the HSN, the unit and the rate all come from the product that
   * owns them. The rate is what the item was last BOUGHT for where Inventory
   * says so, and zero otherwise — never the selling price, which would
   * overstate a purchase being reversed.
   */
  const pickItem = useCallback((item: CatalogItem, key: string) => {
    patchLine(key, {
      item_id: item.item_id,
      label: item.item_name,
      description: item.item_name,
      hsn_sac: item.hsn_sac ?? '',
      unit_id: item.unit_id,
      unit_label: item.unit_name ?? '',
      rate: openingRate(item),
      rate_was_changed: false,
    })
  }, [patchLine])

  // ------------------------------------------------------------------- post

  const reset = useCallback(() => {
    setSupplier(null)
    setDate(new Date().toISOString().slice(0, 10))
    setReference('')
    setReason('')
    setReturnKind('goods_return')
    setWarehouseId('')
    setLines([emptyLine()])
    setAdjustment('')
    setNotes('')
    setAgainst(null)
    setShowProblems(false)
    setError(null)
    setRetryId(null)
    setPosted(null)
    setDraftNote(null)
  }, [])

  const post = useCallback(
    async (andAnother: boolean) => {
      if (inFlight.current || !supplier) {
        setShowProblems(true)
        return
      }
      if (Object.keys(problems).length > 0) {
        setShowProblems(true)
        setError('Some details are still needed. They are marked below.')
        return
      }

      const valueOnly = returnKind === 'value_adjustment'

      // A value-only note carries one described line and NO item id, so nothing
      // downstream can read it as goods coming back. This is the single most
      // important line in this file.
      const payloadLines = valueOnly
        ? [
            {
              item_id: null,
              unit_id: null,
              description:
                notes.trim() || `Adjustment against ${against?.document_no ?? 'the supplier bill'}`,
              qty: 1,
              rate: Number(adjustment || 0),
              discount_pc: 0,
              rate_was_changed: false,
            },
          ]
        : lines
            .filter((line) => line.item_id !== null || line.description.trim() !== '')
            .map((line) => ({
              item_id: line.item_id,
              unit_id: line.unit_id,
              description: line.description.trim() || undefined,
              hsn_sac: line.hsn_sac.trim() || undefined,
              tax_cat_id: line.tax_cat_id ? Number(line.tax_cat_id) : undefined,
              // Only a physical return tells Inventory where the goods land.
              warehouse_id: warehouseId ? Number(warehouseId) : undefined,
              qty: Number(line.qty || 0),
              rate: Number(line.rate || 0),
              discount_pc: mayDiscount ? Number(line.discount_pc || 0) : 0,
              rate_was_changed: line.rate_was_changed,
            }))

      inFlight.current = true
      setSaving(true)
      setError(null)
      setRetryId(null)

      try {
        const response = await api.post<TransactionRequest>('v1/transactions/debit_note', {
          party_account_id: supplier.id,
          date,
          narration: notes.trim() || undefined,
          reference_no: reference.trim() || undefined,
          against_voucher_id: against?.voucher_id ?? undefined,
          against_voucher_no: against?.document_no ?? undefined,
          reason_code: reason,
          value_adjustment_only: valueOnly,
          lines: payloadLines,
        })

        clearDraft(storageKey)
        setRestorable(null)
        setDraftNote(null)

        if (andAnother) {
          const keptSupplier = supplier
          reset()
          setSupplier(keptSupplier)
          setDraftNote(
            `${response.data.books_voucher_no ?? 'The debit note'} is posted. Here is a fresh one for the same supplier.`,
          )
        } else {
          setPostedTotal(totals.taxable)
          setPosted(response.data)
        }
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message)
          const id = err.details.request_id
          // Books was unreachable rather than refusing: the request row exists,
          // so retrying drives the SAME idempotency key instead of making a
          // second note.
          if (err.retryable && typeof id === 'number') setRetryId(id)
        } else {
          setError(String(err))
        }
      } finally {
        inFlight.current = false
        setSaving(false)
      }
    },
    [
      supplier, problems, returnKind, lines, adjustment, notes, against, date, reference, reason,
      warehouseId, mayDiscount, storageKey, totals.taxable, reset,
    ],
  )

  const retry = useCallback(async () => {
    if (retryId === null || inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setError(null)

    try {
      const response = await api.post<TransactionRequest>(`v1/transactions/${retryId}/retry`, {})
      clearDraft(storageKey)
      setPostedTotal(totals.taxable)
      setPosted(response.data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }, [retryId, storageKey, totals.taxable])

  // -------------------------------------------------------------- shortcuts

  useEffect(() => {
    if (posted) return undefined

    function onKeyDown(event: KeyboardEvent) {
      const meta = event.ctrlKey || event.metaKey

      if (meta && event.key === 'Enter') {
        event.preventDefault()
        void post(false)
        return
      }
      if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault()
        saveDraft()
        return
      }
      if (event.altKey && event.key.toLowerCase() === 'i' && returnKind === 'goods_return') {
        event.preventDefault()
        addLine()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [posted, post, saveDraft, addLine, returnKind])

  // ----------------------------------------------------------------- focus

  const focusAgainst = useCallback(() => {
    const select = pageRef.current?.querySelector<HTMLSelectElement>('[data-dn="against"]')
    select?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    select?.focus()
  }, [])

  const showImpact = useCallback(() => {
    impactRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [])

  const addSupplierInBooks = useCallback(() => {
    // A supplier is a ledger account in Smart Books. Billing does not offer a
    // second place to create one; it sends you to the product that owns it.
    launchApp(getAppById('books'))
  }, [])

  // ----------------------------------------------------------------- render

  if (!mayPost) {
    return (
      <Notice tone="warning" title="You cannot raise a debit note">
        Your Billing profile does not include making debit notes. Whoever looks after access for this company can
        change that under Settings.
      </Notice>
    )
  }

  return (
    <div className="dn-page" ref={pageRef}>
      <nav className="dn-breadcrumb" aria-label="Breadcrumb">
        <a href="/purchases">Purchases</a>
        <span aria-hidden>›</span>
        <strong aria-current="page">Debit note</strong>
      </nav>

      <header className="dn-head">
        <div className="dn-head__title">
          <span className="dn-head__icon" aria-hidden><FileText size={22} /></span>
          <div>
            <h1>{posted ? 'Debit note posted' : 'Create debit note'}</h1>
            <p>
              Charge a supplier back — because goods went back, or because the bill was wrong. Smart Books works
              out the accounting and the tax.
            </p>
          </div>
        </div>

        {!posted && (
          <div className="dn-head__actions">
            <ShortcutsMenu />
            <button
              type="button"
              className="billing-button billing-button--small"
              disabled
              title={extraction.reason ?? 'No document-extraction service is configured for this deployment.'}
            >
              <Upload size={14} aria-hidden /> Import
            </button>
            <button
              type="button"
              className="billing-button billing-button--small"
              onClick={saveDraft}
              disabled={saving}
              title={drafts.reason ?? undefined}
            >
              <Save size={14} aria-hidden /> Save as draft
            </button>
            <button
              type="button"
              className="billing-button billing-button--primary billing-button--small"
              onClick={() => void post(false)}
              disabled={saving}
            >
              {saving ? (
                <>
                  <Loader2 size={14} aria-hidden className="spin" /> Posting…
                </>
              ) : (
                'Save & post'
              )}
            </button>
            <DnMenu label="" ariaLabel="More ways to save">
              {(close) => (
                <button
                  type="button"
                  className="billing-menu__item"
                  onClick={() => {
                    close()
                    void post(true)
                  }}
                >
                  Save, post &amp; start another
                </button>
              )}
            </DnMenu>
          </div>
        )}
      </header>

      <DnStepper steps={steps} active={activeStep(steps)} />

      {error && (
        <Notice
          tone="danger"
          title="Could not post this note"
          onDismiss={() => setError(null)}
          action={
            retryId !== null ? (
              <button type="button" className="billing-button billing-button--small" onClick={() => void retry()} disabled={saving}>
                Try again
              </button>
            ) : undefined
          }
        >
          {error}
          {retryId !== null && ' Nothing has been recorded twice — the retry uses the same reference.'}
        </Notice>
      )}

      {restorable && !posted && (
        <Notice
          tone="info"
          title="There is an unfinished debit note in this browser"
          onDismiss={() => {
            clearDraft(storageKey)
            setRestorable(null)
          }}
          action={
            <button type="button" className="billing-button billing-button--small" onClick={restore}>
              Bring it back
            </button>
          }
        >
          Kept on this device when you last pressed Save as draft. Dismissing this throws it away.
        </Notice>
      )}

      {draftNote && (
        <Notice tone="success" onDismiss={() => setDraftNote(null)}>{draftNote}</Notice>
      )}

      {posted ? (
        <DebitNoteSuccess
          request={posted}
          supplierName={supplier?.name ?? 'the supplier'}
          total={postedTotal}
          onAnother={reset}
        />
      ) : (
        <>
          <div className="dn-layout">
            <div className="dn-main">
              <SupplierDocumentCard
                supplier={supplier}
                onSupplier={(party: CatalogParty) => {
                  setSupplier({ id: party.acc_id, name: party.acc_name, gstin: party.gstin })
                  setAgainst(null)
                }}
                date={date}
                onDate={setDate}
                fy={fy}
                reference={reference}
                onReference={setReference}
                reason={reason}
                onReason={setReason}
                against={against}
                onAgainst={setAgainst}
                documents={documents}
                returnKind={returnKind}
                onReturnKind={setReturnKind}
                problems={shown}
                disabled={saving}
                onAddSupplier={addSupplierInBooks}
              />

              <ItemsCard
                returnKind={returnKind}
                lines={lines}
                onPatch={patchLine}
                onAdd={addLine}
                onRemove={removeLine}
                onPickItem={pickItem}
                adjustment={adjustment}
                onAdjustment={setAdjustment}
                taxCategories={taxCategories.data?.data ?? []}
                warehouses={warehouses.data?.data ?? []}
                warehouseId={warehouseId}
                onWarehouse={setWarehouseId}
                mayDiscount={mayDiscount}
                extraction={extraction}
                problems={shown}
                disabled={saving}
                maintainsStock={maintainsStock}
              />

              <div className="dn-bottom">
                <SummaryCard
                  totals={totals}
                  returnKind={returnKind}
                  overAdjustedAgainst={overAdjusted(against?.amount ?? null, totals.taxable)}
                />
                <div ref={impactRef}>
                  <AccountingImpactCard
                    capability={accountingPreview}
                    returnKind={returnKind}
                    taxable={totals.taxable}
                  />
                </div>
              </div>
            </div>

            <aside className="dn-aside" aria-label="Help and notes">
              <HelpCard />
              <QuickActionsCard
                attachments={attachments}
                extraction={extraction}
                onLinkBill={focusAgainst}
                onViewImpact={showImpact}
                canLinkBill={supplier !== null && documents.documents.length > 0}
              />
              <NotesCard notes={notes} onNotes={setNotes} attachments={attachments} disabled={saving} />
            </aside>
          </div>

          <div className="dn-actionbar">
            <div className="dn-actionbar__total">
              <span>Total before tax · Smart Books adds the GST</span>
              <strong>{money(totals.taxable)}</strong>
            </div>
            <div className="dn-actionbar__buttons">
              <button type="button" className="billing-button" onClick={() => navigate(-1)} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="billing-button" onClick={saveDraft} disabled={saving}>
                Save as draft
              </button>
              <button
                type="button"
                className="billing-button billing-button--primary"
                onClick={() => void post(false)}
                disabled={saving}
              >
                {saving ? (
                  <>
                    <Loader2 size={15} aria-hidden className="spin" /> Posting…
                  </>
                ) : (
                  'Save & post'
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function ShortcutsMenu() {
  const shortcuts: Array<[string, string]> = [
    ['Save & post', 'Ctrl / ⌘ + Enter'],
    ['Save as draft', 'Ctrl / ⌘ + S'],
    ['Add another item', 'Alt + I'],
    ['Close a menu', 'Esc'],
  ]

  return (
    <DnMenu label={<><Keyboard size={14} aria-hidden /> Shortcuts</>} ariaLabel="Keyboard shortcuts">
      {() => (
        <>
          <div className="billing-menu__heading"><strong>Keyboard shortcuts</strong></div>
          <dl className="dn-shortcuts" style={{ padding: '4px 10px 8px' }}>
            {shortcuts.map(([label, keys]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd style={{ margin: 0 }}><kbd className="dn-kbd">{keys}</kbd></dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </DnMenu>
  )
}
