/**
 * Purchases → New purchase.
 *
 * The screen a supplier's bill is typed into, and the only place in this
 * product that creates one. It composes the sections around it and owns the
 * three things that cannot live in any of them: the save, the checks the
 * suggestion chips run, and the guard that stops a half-typed bill being
 * thrown away by a stray click.
 *
 * WHAT IS BILLING'S AND WHAT IS NOT. Billing captures the transaction and
 * remembers the request; Smart Books posts the voucher, works out the GST and
 * owns the payable; Inventory receives the stock against the goods lines. No
 * balance, no ledger, no tax and no stock figure is stored here, and every
 * number on screen is either typed by the user, computed from what they typed,
 * or read live from the product that owns it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../services/api'
import type { CatalogItem, TransactionRequest } from '../../services/types'
import { useBilling } from '../../context/BillingContext'
import { Notice, money } from '../../ui'
import { ConfirmDialog } from './ConfirmDialog'
import { PurchaseActionBar } from './PurchaseActionBar'
import { PurchaseAttachments } from './PurchaseAttachments'
import { PurchaseContextStrip, type SaveState } from './PurchaseContextStrip'
import { PurchaseHeader } from './PurchaseHeader'
import { PurchaseHelperDrawer } from './PurchaseHelperDrawer'
import { PurchaseImpactPanel } from './PurchaseImpactPanel'
import { PurchaseItemsSection } from './PurchaseItemsSection'
import { PurchasePaymentControls } from './PurchasePaymentControls'
import { PurchaseSummary } from './PurchaseSummary'
import { ScanImportPanel } from './ScanImportPanel'
import { SupplierBillDetails } from './SupplierBillDetails'
import { Drawer } from '../../shell/Drawer'
import { resolveGstMode } from './gst'
import { isLineStarted, purchaseTotals, todayInTimezone } from './model'
import { toPurchasePayload } from './payload'
import { usePurchaseForm, type FinancialYear } from './usePurchaseForm'
import { usePurchaseMasters } from './usePurchaseMasters'
import { useStockHints } from './useStockHints'
import { useSupplierInsight } from './useSupplierInsight'
import type { Suggestion } from './PurchaseSuggestionBar'
import '../../styles/purchase-workspace.css'

export default function NewPurchasePage() {
  const navigate = useNavigate()
  const { can, scope, session } = useBilling()
  const pageRef = useRef<HTMLDivElement | null>(null)

  const mayCreate = can('purchase.create')
  const mayDiscount = can('discount.override')
  const mayReadRegister = can('debit_note.create')

  const gstRegistered = session?.settings.gst_registered ?? true
  const maintainsStock = session?.settings.maintains_stock ?? true
  const today = todayInTimezone(session?.settings.timezone)

  const masters = usePurchaseMasters()

  const financialYear = useMemo<FinancialYear | null>(() => {
    const fy = masters.company?.fyList.find((entry) => entry.fyId === scope?.fy_id)
    return fy && fy.start && fy.end ? { start: fy.start, end: fy.end, label: fy.label } : null
  }, [masters.company, scope?.fy_id])

  const form = usePurchaseForm({
    today,
    financialYear,
    requireTaxCategory: gstRegistered,
    taxCategoriesUsable: masters.taxRates.length > 0,
  })

  const insight = useSupplierInsight(form.form.supplier?.id ?? null)

  const gstMode = useMemo(
    () =>
      resolveGstMode({
        gstRegistered,
        companyGstin: masters.company?.gstin,
        supplierGstin: form.form.supplier?.gstin,
        supplierChosen: Boolean(form.form.supplier),
      }),
    [gstRegistered, masters.company?.gstin, form.form.supplier],
  )

  const totals = useMemo(
    () => purchaseTotals(form.form.lines, masters.taxRateById, gstMode.treatment),
    [form.form.lines, masters.taxRateById, gstMode.treatment],
  )

  // ------------------------------------------------------ live stock hints

  const goodsItemIds = useMemo(
    () =>
      form.form.purchaseType === 'goods'
        ? form.form.lines.filter(isLineStarted).map((line) => line.itemId).filter((id): id is number => id !== null)
        : [],
    [form.form.lines, form.form.purchaseType],
  )

  const warehouseId = form.form.warehouseId === '' ? null : Number(form.form.warehouseId)
  const stockFor = useStockHints(
    goodsItemIds,
    warehouseId,
    maintainsStock && form.form.purchaseType === 'goods',
  )

  const warehouseName =
    masters.warehouses.find((entry) => String(entry.id) === form.form.warehouseId)?.name ?? null

  /**
   * The obvious warehouse, chosen for them.
   *
   * Inventory's default, or the only one there is. A business with one godown
   * should never have to say which godown, and this is filled in as a DEFAULT
   * rather than an edit, so it does not arm the discard warning.
   */
  const applyDefault = form.applyDefault
  useEffect(() => {
    if (form.form.warehouseId !== '' || masters.warehouses.length === 0) return
    const preferred = masters.warehouses.find((entry) => entry.isDefault) ?? (masters.warehouses.length === 1 ? masters.warehouses[0] : null)
    if (preferred) applyDefault({ warehouseId: String(preferred.id) })
  }, [masters.warehouses, form.form.warehouseId, applyDefault])

  const branchLabel = useMemo(() => {
    if (!scope || scope.bo_id === 0) return 'All branches'
    const branch = masters.company?.branches.find((entry) => entry.boId === scope.bo_id)
    return branch ? `${branch.name}${branch.isHeadOffice ? ' (head office)' : ''}` : `Branch ${scope.bo_id}`
  }, [masters.company, scope])

  const settleAccountName =
    masters.cashBank.find((account) => String(account.acc_id) === form.form.settleAccountId)?.acc_name ?? null

  // ------------------------------------------------------------------ save

  const [saving, setSaving] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('unsaved')
  const [error, setError] = useState<string | null>(null)
  const [retryId, setRetryId] = useState<number | null>(null)
  const [blocked, setBlocked] = useState<string | null>(null)

  const [helperOpen, setHelperOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [suggestionResult, setSuggestionResult] = useState<string | null>(null)

  /** Put the caret on the first thing holding the save up. */
  const focusFirstProblem = useCallback(() => {
    // Two frames: the first lets the render that turned the error borders on
    // commit, the second finds what it marked.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const node = pageRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
        if (!node) return
        node.scrollIntoView({ block: 'center', behavior: 'smooth' })
        node.focus({ preventScroll: true })
      }),
    )
  }, [])

  const save = useCallback(
    async (andNew: boolean) => {
      if (saving || !mayCreate) return

      if (!form.attemptSave()) {
        setBlocked('Some details are still needed — they are marked below.')
        focusFirstProblem()
        return
      }

      setBlocked(null)
      setSaving(true)
      setSaveState('saving')
      setError(null)
      setRetryId(null)

      try {
        const response = await api.post<TransactionRequest>(
          'v1/transactions/purchase',
          toPurchasePayload(form.form),
        )

        setSaveState('saved')
        // The form is only cleared once the bill is safely with Books. A failed
        // save must never cost somebody the twenty lines they just typed.
        form.markClean()

        if (andNew) {
          form.reset()
          setSaveState('unsaved')
          setSuggestionResult(null)
        } else {
          navigate(`/purchases/${response.data.request_id}`)
        }
      } catch (caught) {
        setSaveState('unsaved')

        if (caught instanceof ApiError) {
          setError(caught.message)

          const requestId = caught.details.request_id
          // The backend says explicitly whether pressing the same button again
          // could work: "Books was unreachable" is retryable on the SAME
          // request row, and therefore on the same idempotency key.
          if (caught.retryable && typeof requestId === 'number') setRetryId(requestId)
        } else {
          setError('Something went wrong before this reached Smart Books. Nothing has been saved.')
        }
      } finally {
        setSaving(false)
      }
    },
    [saving, mayCreate, form, navigate, focusFirstProblem],
  )

  async function retry() {
    if (retryId === null || saving) return

    setSaving(true)
    setSaveState('saving')
    setError(null)

    try {
      const response = await api.post<TransactionRequest>(`v1/transactions/${retryId}/retry`, {})
      setSaveState('saved')
      form.markClean()
      navigate(`/purchases/${response.data.request_id}`)
    } catch (caught) {
      setSaveState('unsaved')
      setError(caught instanceof ApiError ? caught.message : 'That retry did not get through either.')
    } finally {
      setSaving(false)
    }
  }

  // --------------------------------------------------------------- shortcuts

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        void save(false)
        return
      }
      // event.code rather than event.key: Option+A on a Mac types "å", and
      // matching the physical key lets preventDefault stop it being inserted.
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyA') {
        event.preventDefault()
        form.addLine()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [save, form])

  // ------------------------------------------------------------- navigation

  function leave() {
    // Going "back" from a screen opened directly by URL has nowhere to go, so
    // the purchases list is the honest destination.
    if (window.history.length > 1) navigate(-1)
    else navigate('/purchases')
  }

  function requestLeave() {
    if (form.dirty) setConfirmDiscard(true)
    else leave()
  }

  // ------------------------------------------------------------ suggestions

  /** Picked from a list: take it and get out of the way. */
  const addFromPicker = useCallback(
    (item: CatalogItem) => {
      form.applyItem(item)
      setHelperOpen(false)
    },
    [form],
  )

  /**
   * Scanned: take it and stay open.
   *
   * A delivery is unpacked one barcode after another. Closing the panel on the
   * first one would mean reopening it for every item in the box, which is the
   * opposite of what a scanner is for.
   */
  const addFromScan = useCallback((item: CatalogItem) => form.applyItem(item), [form])

  const suggestions = useMemo<Suggestion[]>(() => {
    const started = form.form.lines.filter(isLineStarted)
    const missingRate = started.filter((line) => line.taxCatId === '').length

    return [
      {
        key: 'gst',
        label: 'Auto-detect GST treatment',
        title: 'Works out CGST/SGST or IGST from the two GSTINs, and checks every line has a rate.',
        onRun: () =>
          setSuggestionResult(
            missingRate > 0 && gstMode.treatment !== 'no_gst'
              ? `${gstMode.reason} ${missingRate} line${missingRate === 1 ? '' : 's'} still need a GST rate.`
              : gstMode.reason,
          ),
      },
      {
        key: 'items',
        label: 'Suggest recently purchased items',
        disabled: masters.favourites.length === 0,
        title:
          masters.favourites.length === 0
            ? 'Nothing on record yet — this fills up as you put items on documents.'
            : 'Opens the items you put on documents most, resolved through Inventory.',
        onRun: () => setHelperOpen(true),
      },
      {
        key: 'duplicate',
        label: 'Check duplicate bill',
        disabled: !form.form.supplier || !mayReadRegister || totals.grandTotal <= 0,
        title: !mayReadRegister
          ? 'Reading the purchase register needs the debit-note permission, which your profile does not have.'
          : !form.form.supplier
            ? 'Choose the supplier first.'
            : totals.grandTotal <= 0
              ? 'Add the lines first — this checks the date and the value.'
              : 'Looks for a bill of this value from this supplier already on Smart Books’ register.',
        onRun: () => {
          // Books' register does not carry the SUPPLIER's own invoice number,
          // so a check on that number is not possible here and is not faked.
          // What the register does carry is the date and the value, which is
          // what a duplicate actually looks like.
          const tolerance = Math.max(1, totals.grandTotal * 0.001)
          const matches = insight.documents.filter(
            (document) => document.amount !== null && Math.abs(document.amount - totals.grandTotal) <= tolerance,
          )
          const sameDay = matches.filter((document) => document.date === form.form.purchaseDate)

          if (matches.length === 0) {
            setSuggestionResult(
              `No bill of ${money(totals.grandTotal)} from this supplier on the register. Smart Books does not expose the supplier’s own invoice number, so this checks the date and the value.`,
            )
            return
          }

          const hit = sameDay[0] ?? matches[0]
          setSuggestionResult(
            `Possible duplicate: ${hit.document_no ?? 'a bill'} of ${money(hit.amount ?? 0)} dated ${hit.date ?? 'an unknown date'} is already on the register for this supplier. Check before saving.`,
          )
        },
      },
    ]
  }, [form.form.lines, form.form.supplier, form.form.purchaseDate, gstMode, masters.favourites.length, mayReadRegister, totals.grandTotal, insight.documents])

  // ----------------------------------------------------------------- render

  return (
    <div className="purchase-page" ref={pageRef}>
      <PurchaseHeader onBack={requestLeave} />

      {!mayCreate && (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="warning" title="You cannot record a purchase">
            Your Billing profile does not include “Record a purchase”. Ask the owner of this company to add it.
          </Notice>
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 16 }}>
          <Notice
            tone="danger"
            title="Could not save this purchase"
            onDismiss={() => setError(null)}
            action={
              retryId !== null ? (
                <button type="button" className="purchase-btn" onClick={() => void retry()} disabled={saving}>
                  Retry
                </button>
              ) : undefined
            }
          >
            {error} Nothing you have typed has been lost.
          </Notice>
        </div>
      )}

      <PurchaseContextStrip
        saveState={saveState}
        hasSupplier={Boolean(form.form.supplier)}
        insight={insight}
        gstMode={gstMode}
        warehouseLabel={form.form.purchaseType === 'services' ? 'Not used' : warehouseName}
        onOpenHelper={() => setHelperOpen(true)}
      />

      <div className="purchase-layout">
        <main className="purchase-column">
          <SupplierBillDetails
            form={form.form}
            errors={form.errors}
            showErrors={form.showErrors}
            masters={masters}
            gstMode={gstMode}
            insight={insight}
            branchLabel={branchLabel}
            onSupplier={form.setSupplier}
            onPurchaseDate={form.setPurchaseDate}
            onPaymentTerms={form.setPaymentTerms}
            onDueDate={form.setDueDate}
            onPatch={form.patch}
          />

          <PurchaseItemsSection
            form={form.form}
            errors={form.errors}
            showErrors={form.showErrors}
            uoms={masters.uoms}
            taxRates={masters.taxRates}
            taxRateById={masters.taxRateById}
            taxRatesFailed={masters.taxRatesFailed}
            mayDiscount={mayDiscount}
            stockFor={stockFor}
            suggestions={suggestions}
            suggestionResult={suggestionResult}
            onOpenScan={() => setScanOpen(true)}
            onPatchLine={form.patchLine}
            onApplyItem={form.applyItem}
            onAddLine={form.addLine}
            onRemoveLine={form.removeLine}
            onReloadTaxRates={masters.reloadTaxRates}
          />

          <div className="purchase-secondary">
            <PurchasePaymentControls
              form={form.form}
              errors={form.errors}
              showErrors={form.showErrors}
              cashBank={masters.cashBank}
              cashBankFailed={masters.cashBankFailed}
              onPatch={form.patch}
            />
            <PurchaseAttachments />
          </div>
        </main>

        <aside className="purchase-aside" aria-label="Totals and impact">
          <PurchaseSummary totals={totals} gstMode={gstMode} taxRatesUnpriced={masters.taxRatesUnpriced} />
          <PurchaseImpactPanel
            form={form.form}
            warehouseName={warehouseName}
            grandTotal={totals.grandTotal}
            settleAccountName={settleAccountName}
          />
        </aside>
      </div>

      <PurchaseActionBar
        saving={saving}
        mayCreate={mayCreate}
        blocked={form.showErrors && form.hasErrors ? blocked : null}
        onCancel={requestLeave}
        onSaveAndNew={() => void save(true)}
        onSave={() => void save(false)}
      />

      <PurchaseHelperDrawer
        open={helperOpen}
        onClose={() => setHelperOpen(false)}
        form={form.form}
        totals={totals}
        gstMode={gstMode}
        insight={insight}
        financialYear={financialYear}
        warehouseName={warehouseName}
        favourites={masters.favourites}
        onAddItem={addFromPicker}
      />

      <Drawer open={scanOpen} onClose={() => setScanOpen(false)} title="Scan or import" side="right">
        <ScanImportPanel onFound={addFromScan} />
      </Drawer>

      <ConfirmDialog
        open={confirmDiscard}
        title="Discard this purchase?"
        confirmLabel="Discard it"
        onConfirm={() => {
          setConfirmDiscard(false)
          form.markClean()
          leave()
        }}
        onCancel={() => setConfirmDiscard(false)}
      >
        Your unsaved changes will be lost.
      </ConfirmDialog>
    </div>
  )
}
