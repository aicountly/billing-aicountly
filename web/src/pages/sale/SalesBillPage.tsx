/**
 * Sales → New bill.
 *
 * The screen this product exists for: a shopkeeper with a customer in front of
 * them, making a bill. Everything is arranged around that — the customer box
 * has the cursor, an item is one search or one scan away, the total moves as
 * you type, and Save is one key.
 *
 * WHAT IS OURS AND WHAT IS NOT. Customers are ledger accounts in Smart Books,
 * items are records in Inventory, tax categories are Books' configuration, the
 * financial year is Manage's, and the invoice — its number, its GST, its
 * accounting — is made by Books when this is saved. Billing keeps the request
 * and the voucher reference Books hands back. Nothing on this screen is a local
 * copy of any of it, and there is no demo data anywhere behind it.
 *
 * TWO THINGS THIS SCREEN DELIBERATELY DOES NOT DO. It does not compute the tax
 * that goes on the invoice — the summary's GST block is a labelled estimate
 * from Books' own rates and is never sent anywhere. And "Save as draft" does
 * not call the API: there is no unposted invoice in this product, so a draft
 * that talked to the server would be a real invoice. It keeps the bill in this
 * browser and says so.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Check } from 'lucide-react'
import { api, ApiError } from '../../services/api'
import type { CashBankAccount, CatalogItem, CatalogParty, TransactionRequest } from '../../services/types'
import { useApi } from '../../hooks/useApi'
import { useBilling } from '../../context/BillingContext'
import { fetchCompanyInfo } from '../../services/manage'
import { AICOUNTLY_APPS } from '../../config/aicountlyApps'
import { launchApp } from '../../services/appLauncher'
import { Button, Notice } from '../../ui'
import { SalesBillHeader } from './SalesBillHeader'
import { CustomerBillCard, type CustomerStanding } from './CustomerBillCard'
import { BillItemsCard, type StockReading } from './BillItemsCard'
import { PaymentNotesCard } from './PaymentNotesCard'
import { BillSummaryPanel } from './BillSummaryPanel'
import { BillActionBar } from './BillActionBar'
import { BillPreviewDialog, DiscardDialog, ShortcutsDialog, TermsDialog } from './SaleDialogs'
import {
  clearStoredDraft,
  draftStorageKey,
  emptyDraft,
  emptyLine,
  firstError,
  hasErrors,
  isDirty,
  itemHsn,
  itemRate,
  itemTaxCategoryId,
  itemUnitLabel,
  newKey,
  parseTaxCategories,
  readAvailableQty,
  readStoredDraft,
  rememberCustomer,
  readRecentCustomers,
  stateCodeFromGstin,
  storeDraft,
  summarise,
  supplyKind,
  toSaleRequest,
  usableLines,
  validate,
  type FinancialYearWindow,
  type ItemRow,
  type SaleDraft,
  type SaleLine,
} from './saleForm'
import '../../styles/billing-sale.css'

type Dialog = 'preview' | 'terms' | 'shortcuts' | 'discard' | null

export default function SalesBillPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { scope, session, can } = useBilling()

  const maySell = can('sale.create')
  const mayDiscount = can('discount.override')
  const mayReadDues = can('receipt.create')
  const maySettings = can('settings.manage')

  const cmpId = scope?.cmp_id ?? 0
  const scopeKey = `${scope?.cmp_id ?? 0}:${scope?.fy_id ?? 0}:${scope?.bo_id ?? 0}`
  const enabled = Boolean(scope) && maySell
  const storageKey = draftStorageKey(scope?.cmp_id ?? 0, scope?.fy_id ?? 0)

  // ------------------------------------------------------------ live lists

  const taxCategoryList = useApi(
    (signal) => api.list<Record<string, unknown>>('v1/catalog/tax-categories', undefined, signal),
    [scopeKey],
    enabled,
  )
  const cashBank = useApi(
    (signal) => api.list<CashBankAccount>('v1/catalog/cash-bank', undefined, signal),
    [scopeKey],
    enabled,
  )
  const favourites = useApi(
    (signal) => api.get<{ data: CatalogItem[] }>('v1/catalog/items/favourites', undefined, signal),
    [scopeKey],
    enabled,
  )
  const company = useApi((signal) => fetchCompanyInfo(cmpId, signal), [cmpId], Boolean(scope))

  const taxCategories = useMemo(
    () => parseTaxCategories(taxCategoryList.data?.data ?? []),
    [taxCategoryList.data],
  )
  const favouriteItems = useMemo(() => (favourites.data?.data ?? []) as ItemRow[], [favourites.data])
  const cashBankAccounts = useMemo(() => cashBank.data?.data ?? [], [cashBank.data])

  const companyGstin = company.data?.gstin ?? ''
  const companyStateCode = stateCodeFromGstin(companyGstin)
  const gstRegistered = session?.settings.gst_registered ?? true

  const fyWindow = useMemo<FinancialYearWindow>(() => {
    const fy = company.data?.fyList.find((row) => row.fyId === scope?.fy_id)
    return { from: fy?.start ?? null, to: fy?.end ?? null, label: fy?.label ?? null }
  }, [company.data, scope?.fy_id])

  // ---------------------------------------------------------------- state

  const [draft, setDraft] = useState<SaleDraft>(() => emptyDraft())
  const [baseline, setBaseline] = useState<SaleDraft>(() => emptyDraft())
  const [placeTouched, setPlaceTouched] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savingMode, setSavingMode] = useState<'save' | 'save-new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryId, setRetryId] = useState<number | null>(null)
  const [saved, setSaved] = useState<TransactionRequest | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [autoPrint, setAutoPrint] = useState(false)
  const [draftKeptAt, setDraftKeptAt] = useState<string | null>(null)
  const [restored, setRestored] = useState<string | null>(null)
  const [scopeChanged, setScopeChanged] = useState(false)
  const [stock, setStock] = useState<Record<number, StockReading>>({})
  const [recent, setRecent] = useState<CatalogParty[]>([])

  // A second click on Save lands before React re-renders, and a second click
  // here is a second invoice. The ref closes that gap; the disabled button is
  // what the user sees.
  const inFlight = useRef(false)
  const customerRef = useRef<HTMLInputElement>(null)
  const billDateRef = useRef<HTMLInputElement>(null)
  const scanRef = useRef<HTMLInputElement>(null)

  const dirty = isDirty(draft, baseline)

  /**
   * The bill as it stands right now, for the two places that need it outside
   * the render: leaving the screen, and switching company.
   */
  const latest = useRef({ dirty, draft, storageKey })
  latest.current = { dirty, draft, storageKey }
  const errors = useMemo(
    () =>
      validate(draft, fyWindow, {
        gstRegistered,
        requiresSettlementAccount: cashBankAccounts.length > 0,
      }),
    [draft, fyWindow, gstRegistered, cashBankAccounts.length],
  )

  const supply = supplyKind(companyStateCode, draft.placeOfSupply)
  const totals = useMemo(
    () => summarise(draft, taxCategories, supply, !taxCategoryList.loading),
    [draft, taxCategories, supply, taxCategoryList.loading],
  )

  // ---------------------------------------------------------------- patching

  const patch = useCallback((changes: Partial<SaleDraft>) => {
    if ('placeOfSupply' in changes) setPlaceTouched(true)
    setDraft((current) => {
      const next = { ...current, ...changes }
      // The place of supply follows the customer unless somebody has said
      // otherwise: retyping it on every bill is exactly the small tax this
      // screen exists to remove.
      if ('party' in changes && !('placeOfSupply' in changes)) {
        const derived = stateCodeFromGstin(changes.party?.gstin)
        if (derived) next.placeOfSupply = derived
      }
      return next
    })
  }, [])

  const patchLine = useCallback((key: string, changes: Partial<SaleLine>) => {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.key === key ? { ...line, ...changes } : line)),
    }))
  }, [])

  const addLine = useCallback(() => {
    setDraft((current) => ({ ...current, lines: [...current.lines, emptyLine()] }))
  }, [])

  const removeLine = useCallback((key: string) => {
    setDraft((current) => ({
      ...current,
      lines: current.lines.length > 1 ? current.lines.filter((line) => line.key !== key) : [emptyLine()],
    }))
  }, [])

  /**
   * Put the cursor where a scanner can type.
   *
   * The item box only exists on a line that has no item yet, so if every line
   * is filled one is added first — and the focus waits a frame for it to be on
   * screen, because a ref cannot point at a row React has not drawn.
   */
  const focusScan = useCallback(() => {
    setDraft((current) =>
      current.lines.some((line) => line.itemId === null) ? current : { ...current, lines: [...current.lines, emptyLine()] },
    )
    requestAnimationFrame(() => scanRef.current?.focus())
  }, [])

  /** Ask Inventory what is on the shelf. Never worked out here. */
  const readStock = useCallback((itemId: number) => {
    setStock((current) => ({ ...current, [itemId]: { loading: true, qty: current[itemId]?.qty ?? null } }))
    api
      .one<Record<string, unknown>>('v1/catalog/stock', { item_id: itemId })
      .then((response) => {
        setStock((current) => ({ ...current, [itemId]: { loading: false, qty: readAvailableQty(response) } }))
      })
      .catch(() => {
        // Inventory did not answer. No chip is better than a chip that says
        // nought, which reads as "out of stock".
        setStock((current) => ({ ...current, [itemId]: { loading: false, qty: null } }))
      })
  }, [])

  const applyItem = useCallback(
    (key: string, item: ItemRow) => {
      const rate = itemRate(item)
      patchLine(key, {
        itemId: item.item_id,
        label: item.item_name,
        sku: item.item_sku ?? null,
        hsn: itemHsn(item),
        unitId: item.unit_id ?? null,
        unitLabel: itemUnitLabel(item),
        description: '',
        rate,
        // The rate came from Inventory, so it has not been "changed" — the
        // backend refuses an edited rate from a profile without rate.override.
        rateWasChanged: false,
        taxCategoryId: itemTaxCategoryId(item) || '',
      })
      readStock(item.item_id)
      // Always leave a blank line ready, so the next item needs no extra tap.
      setDraft((current) =>
        current.lines.some((line) => line.itemId === null && line.description.trim() === '')
          ? current
          : { ...current, lines: [...current.lines, emptyLine()] },
      )
    },
    [patchLine, readStock],
  )

  /**
   * A barcode, or a term typed into the item box with nothing highlighted.
   *
   * Inventory owns the barcode index, so it is asked; a code it does not know
   * falls back to the ordinary search rather than silently doing nothing.
   */
  const scanInto = useCallback(
    (key: string, code: string) => {
      api
        .one<CatalogItem>(`v1/catalog/items/barcode/${encodeURIComponent(code)}`)
        .then((response) => response.data as ItemRow)
        .catch(() =>
          api
            .list<CatalogItem>('v1/catalog/items/search', { q: code, limit: 1 })
            .then((response) => (response.data[0] as ItemRow | undefined) ?? null),
        )
        .then((item) => {
          if (item) applyItem(key, item)
          else setError(`Nothing in Inventory matches “${code}”.`)
        })
        .catch(() => setError('Could not reach Inventory to look that code up.'))
    },
    [applyItem],
  )

  // --------------------------------------------------- what the party owes

  const openBills = useApi(
    (signal) =>
      api.one<{ bills: Array<{ balance: number; due_date: string | null }> }>(
        'v1/open-bills',
        { account_id: draft.party?.acc_id, side: 'receivable' },
        signal,
      ),
    [draft.party?.acc_id, scopeKey],
    Boolean(scope) && mayReadDues && draft.party !== null,
  )

  const standing = useMemo<CustomerStanding | null>(() => {
    if (!draft.party || !mayReadDues) return null
    const bills = openBills.data?.data.bills ?? []

    return {
      loading: openBills.loading,
      failed: openBills.error !== null,
      outstanding: openBills.data ? bills.reduce((sum, bill) => sum + bill.balance, 0) : null,
      billCount: bills.length,
      oldestDue: bills.map((bill) => bill.due_date).filter(Boolean).sort()[0] ?? null,
    }
  }, [draft.party, mayReadDues, openBills.data, openBills.loading, openBills.error])

  // --------------------------------------------------------- opening state

  /** Customers billed from this device, offered before anything is typed. */
  useEffect(() => {
    setRecent(cmpId > 0 ? readRecentCustomers(cmpId) : [])
  }, [cmpId])

  /**
   * Opening the screen, and changing company underneath it.
   *
   * One effect, because the two cannot be told apart from inside the other and
   * running both produces a bill that is half one company's and half another's.
   *
   * What the biller desk (or the global search) handed over wins: a party id, an
   * item id or a barcode. The party arrives as an id and a name — the id is a
   * request rather than a fact, and Books validates it on save; an item id or a
   * code is resolved through Inventory rather than trusted from the URL. With
   * nothing carried, the draft this browser was keeping is offered back.
   *
   * On a switch, every id on the form belonged to the company that was open
   * when it was picked, so they go. What was typed does not: the dates, the
   * note and the terms are company-neutral, and throwing away typing nobody
   * asked to throw away is its own bug.
   */
  const seeded = useRef('')
  const seededStorageKey = useRef(storageKey)
  useEffect(() => {
    if (!scope || !maySell) return
    if (seeded.current === scopeKey) return

    const switched = seeded.current !== ''
    const previousKey = seededStorageKey.current
    seeded.current = scopeKey
    seededStorageKey.current = storageKey

    setStock({})
    setSaved(null)
    setError(null)
    setRetryId(null)
    setRestored(null)
    setDraftKeptAt(null)

    if (switched) {
      // Keep the bill that was on screen under the company it belonged to, so
      // switching back finds it where it was left.
      if (latest.current.dirty) storeDraft(previousKey, latest.current.draft)

      const carried = readStoredDraft(storageKey)
      if (carried) {
        setDraft(carried.draft)
        setBaseline(carried.draft)
        setPlaceTouched(carried.draft.placeOfSupply !== '')
        setRestored(carried.savedAt)
        return
      }

      setDraft((current) => {
        const stale = current.party !== null || current.lines.some((line) => line.itemId !== null)
        if (!stale && current.settleAccountId === '') return current
        setScopeChanged(true)
        return {
          ...current,
          party: null,
          settleAccountId: '',
          placeOfSupply: '',
          lines: current.lines.map((line) => ({ ...emptyLine(), key: newKey(), description: line.description })),
        }
      })
      setPlaceTouched(false)
      return
    }

    const partyId = Number(params.get('party_account_id') ?? '')
    const partyName = params.get('party_name')
    const itemId = params.get('item_id')
    const scan = params.get('scan')

    if (!(partyId > 0 || itemId || scan)) {
      const stored = readStoredDraft(storageKey)
      if (stored) {
        setDraft(stored.draft)
        setBaseline(stored.draft)
        setPlaceTouched(stored.draft.placeOfSupply !== '')
        setRestored(stored.savedAt)
        return
      }
    }

    const opening = emptyDraft()
    if (partyId > 0) opening.party = { acc_id: partyId, acc_name: partyName ?? `Account ${partyId}` }
    setDraft(opening)
    setBaseline(opening)

    if (itemId) {
      api
        .one<CatalogItem>(`v1/catalog/items/${itemId}`)
        .then((response) => applyItem(opening.lines[0].key, response.data as ItemRow))
        .catch(() => {
          // The desk's suggestion could not be resolved. The screen is still
          // perfectly usable, so this is not worth an error dialog.
        })
    } else if (scan) {
      scanInto(opening.lines[0].key, scan)
    }
  }, [scope, scopeKey, maySell, params, storageKey, applyItem, scanInto])

  /** The company's own state, as the opening place of supply. */
  useEffect(() => {
    if (!companyStateCode || placeTouched) return
    setDraft((current) => (current.placeOfSupply === '' ? { ...current, placeOfSupply: companyStateCode } : current))
  }, [companyStateCode, placeTouched])

  /** This company's default sales terms, offered on a new bill. */
  useEffect(() => {
    const terms = session?.settings.default_sale_terms
    if (!terms) return
    setDraft((current) => (current.terms === '' ? { ...current, terms } : current))
    setBaseline((current) => (current.terms === '' ? { ...current, terms } : current))
  }, [session?.settings.default_sale_terms])

  /** The first cash or bank ledger, once "paid now" is ticked. */
  useEffect(() => {
    if (!draft.paidNow || draft.settleAccountId !== '' || cashBankAccounts.length === 0) return
    setDraft((current) =>
      current.settleAccountId === '' ? { ...current, settleAccountId: String(cashBankAccounts[0].acc_id) } : current,
    )
  }, [draft.paidNow, draft.settleAccountId, cashBankAccounts])

  // --------------------------------------------------- keeping what is typed

  const keepDraft = useCallback(
    (announce: boolean) => {
      if (!storeDraft(storageKey, draft)) return false
      if (announce) {
        setDraftKeptAt(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }))
        setRestored(null)
      }
      return true
    },
    [draft, storageKey],
  )

  /** A refresh or a closed tab is the browser's own warning; nothing is lost. */
  useEffect(() => {
    if (!dirty) return undefined
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  /**
   * Leaving the screen keeps the bill on this device.
   *
   * There is nowhere on the server to put an unfinished bill, so the browser
   * keeps it and the screen offers it back on the way in. It is better than a
   * modal in the way of somebody who meant to look something up.
   */
  useEffect(
    () => () => {
      if (latest.current.dirty) storeDraft(latest.current.storageKey, latest.current.draft)
    },
    [],
  )

  // ---------------------------------------------------------------- saving

  const save = useCallback(
    async (mode: 'save' | 'save-new') => {
      if (inFlight.current) return
      setShowErrors(true)

      const problems = validate(draft, fyWindow, {
        gstRegistered,
        requiresSettlementAccount: cashBankAccounts.length > 0,
      })
      if (hasErrors(problems)) {
        if (problems.party) customerRef.current?.focus()
        else if (problems.billDate || problems.dueDate) billDateRef.current?.focus()
        return
      }

      inFlight.current = true
      setSaving(true)
      setSavingMode(mode)
      setError(null)
      setRetryId(null)
      setSaved(null)

      try {
        const response = await api.post<TransactionRequest>('v1/transactions/sale', toSaleRequest(draft))

        if (draft.party && cmpId > 0) {
          rememberCustomer(cmpId, draft.party)
          setRecent(readRecentCustomers(cmpId))
        }
        clearStoredDraft(storageKey)
        setDraftKeptAt(null)
        // The bill is in Books now, so it is not an unsaved draft any more.
        // Said here rather than left to the re-render, because Save navigates
        // away and the unmount below would otherwise write it straight back —
        // and the next bill would open on a "picked up where you left off" for
        // an invoice that already exists.
        latest.current = { dirty: false, draft, storageKey }

        if (mode === 'save-new') {
          // Only AFTER a confirmed save. What the counter keeps doing all day —
          // the date, where the money goes, the terms — is kept; who it is for
          // and what is on it is not.
          const next: SaleDraft = {
            ...emptyDraft(),
            billDate: draft.billDate,
            placeOfSupply: companyStateCode || '',
            paidNow: draft.paidNow,
            paymentMode: draft.paymentMode,
            settleAccountId: draft.settleAccountId,
            terms: draft.terms,
          }
          setDraft(next)
          setBaseline(next)
          setPlaceTouched(false)
          setShowErrors(false)
          setStock({})
          setSaved(response.data)
          favourites.reload()
          customerRef.current?.focus()
        } else {
          setBaseline(draft)
          navigate(`/sales/${response.data.request_id}`)
        }
      } catch (err) {
        // Nothing is reset: what was typed is still on screen, which is the
        // whole point of not clearing the form before the answer arrives.
        if (err instanceof ApiError) {
          setError(err.message)
          const id = err.details.request_id
          if (err.retryable && typeof id === 'number') setRetryId(id)
        } else {
          setError(String(err))
        }
      } finally {
        inFlight.current = false
        setSaving(false)
        setSavingMode(null)
      }
    },
    [draft, fyWindow, gstRegistered, cashBankAccounts.length, cmpId, storageKey, companyStateCode, favourites, navigate],
  )

  async function retry() {
    if (retryId === null || inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setError(null)
    try {
      const response = await api.post<TransactionRequest>(`v1/transactions/${retryId}/retry`, {})
      navigate(`/sales/${response.data.request_id}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  // ------------------------------------------------------------- shortcuts

  const shortcutState = useRef({ save, addLine, focusScan })
  shortcutState.current = { save, addLine, focusScan }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        void shortcutState.current.save('save')
        return
      }
      if (!event.altKey || event.ctrlKey || event.metaKey) return

      const key = event.key.toLowerCase()
      if (key === 'n') {
        event.preventDefault()
        shortcutState.current.addLine()
        return
      }
      if (key === 'c') {
        event.preventDefault()
        customerRef.current?.focus()
        return
      }
      if (key === 's') {
        event.preventDefault()
        shortcutState.current.focusScan()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  /**
   * Enter moves on.
   *
   * Only from a plain text or date box, and only when nothing has already
   * handled it — the type-ahead stops the event when Enter picked an option,
   * and a textarea needs its newline.
   */
  function onFormKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.shiftKey) return
    const target = event.target as HTMLElement
    if (!(target instanceof HTMLInputElement)) return
    if (!['text', 'date', 'number', 'search'].includes(target.type)) return

    event.preventDefault()
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('input, select, textarea, button'),
    ).filter((element) => !element.hasAttribute('disabled') && element.tabIndex !== -1)
    const next = focusable[focusable.indexOf(target) + 1]
    next?.focus()
    if (next instanceof HTMLInputElement) next.select()
  }

  // ---------------------------------------------------------------- render

  if (!maySell) {
    return (
      <div className="billing-sale">
        <Notice tone="warning" title="You cannot make a bill with your Billing profile">
          Ask the owner of this company to give your profile the permission to create sales.
        </Notice>
      </div>
    )
  }

  if (!scope) {
    return (
      <div className="billing-sale">
        <Notice tone="info" title="Choose a company">
          Pick the company and financial year to bill in, at the top of the page.
        </Notice>
      </div>
    )
  }

  const lineCount = usableLines(draft).length
  const message = showErrors ? firstError(errors) : null

  return (
    <div className="billing-sale">
      <SalesBillHeader
        status={draftKeptAt ? 'Draft kept' : 'Draft'}
        statusHint={
          draftKeptAt
            ? 'Kept in this browser. Nothing has been sent to Smart Books.'
            : 'Nothing is sent to Smart Books until you press Save.'
        }
        draftKept={Boolean(draftKeptAt)}
        onShowShortcuts={() => setDialog('shortcuts')}
      />

      <div className="billing-sale__notices">
      {restored && (
        <div className="billing-sale__notice">
          <Notice
            tone="info"
            title="Picked up where you left off"
            action={
              <Button
                onClick={() => {
                  clearStoredDraft(storageKey)
                  const fresh = emptyDraft()
                  setDraft(fresh)
                  setBaseline(fresh)
                  setPlaceTouched(false)
                  setRestored(null)
                  customerRef.current?.focus()
                }}
              >
                Start a fresh bill
              </Button>
            }
            onDismiss={() => setRestored(null)}
          >
            This bill was kept in this browser{restored ? ` on ${new Date(restored).toLocaleString('en-IN')}` : ''}. It
            never reached Smart Books.
          </Notice>
        </div>
      )}

      {scopeChanged && (
        <div className="billing-sale__notice">
          <Notice tone="warning" title="You changed company, branch or year" onDismiss={() => setScopeChanged(false)}>
            The customer and the items belonged to the company that was open before, so they have been cleared. What you
            typed is still here.
          </Notice>
        </div>
      )}

      {saved && (
        <div className="billing-sale__notice">
          <Notice
            tone="success"
            title={
              saved.books_voucher_no
                ? `Bill ${saved.books_voucher_no} saved in Smart Books`
                : 'Bill saved in Smart Books'
            }
            action={<Link to={`/sales/${saved.request_id}`} className="billing-sale__chip">Open it</Link>}
            onDismiss={() => setSaved(null)}
          >
            <Check size={13} aria-hidden /> Ready for the next one — the customer box has the cursor.
          </Notice>
        </div>
      )}

      {error && (
        <div className="billing-sale__notice">
          <Notice
            tone="danger"
            title="Could not save this bill"
            action={retryId !== null ? <Button onClick={retry} disabled={saving}>Retry</Button> : undefined}
            onDismiss={() => setError(null)}
          >
            {error}
          </Notice>
        </div>
      )}

      {company.error && (
        <div className="billing-sale__notice">
          <Notice tone="warning" title="Could not read this company from Manage">
            The financial-year check and the company&rsquo;s own state are unavailable, so Smart Books will decide both
            when the bill is saved.
          </Notice>
        </div>
      )}
      </div>

      <form className="billing-sale__layout" noValidate onKeyDown={onFormKeyDown} onSubmit={(event) => event.preventDefault()}>
        <div className="billing-sale__main">
          <CustomerBillCard
            draft={draft}
            onChange={patch}
            errors={errors}
            showErrors={showErrors}
            recentCustomers={recent}
            standing={standing}
            companyStateCode={companyStateCode}
            companyGstin={companyGstin}
            gstRegistered={gstRegistered}
            customerRef={customerRef}
            billDateRef={billDateRef}
            onOpenBooks={() => launchApp(AICOUNTLY_APPS.find((app) => app.id === 'books') ?? null, { newTab: true })}
          />

          <BillItemsCard
            lines={draft.lines}
            taxCategories={taxCategories}
            taxCategoriesLoading={taxCategoryList.loading}
            favourites={favouriteItems}
            stock={stock}
            lineErrors={errors.line ?? {}}
            showErrors={showErrors}
            mayDiscount={mayDiscount}
            totalPaise={totals.taxablePaise}
            scanRef={scanRef}
            onPatch={patchLine}
            onPickItem={applyItem}
            onScan={scanInto}
            onAddLine={addLine}
            onRemoveLine={removeLine}
            onScanClick={focusScan}
          />

          <PaymentNotesCard
            draft={draft}
            onChange={patch}
            errors={errors}
            showErrors={showErrors}
            accounts={cashBankAccounts}
            accountsLoading={cashBank.loading}
            accountsFailed={cashBank.error !== null}
            hasTerms={Boolean(session?.settings.default_sale_terms)}
            onEditTerms={() => setDialog('terms')}
          />
        </div>

        <BillSummaryPanel
          totals={totals}
          supply={supply}
          placeOfSupply={draft.placeOfSupply}
          canPreview={lineCount > 0}
          onPreview={() => {
            setAutoPrint(false)
            setDialog('preview')
          }}
          onPrint={() => {
            setAutoPrint(true)
            setDialog('preview')
          }}
        />
      </form>

      <BillActionBar
        saving={saving}
        savingMode={savingMode}
        dirty={dirty}
        draftKeptAt={draftKeptAt}
        message={message}
        onCancel={() => (dirty ? setDialog('discard') : navigate(-1))}
        onKeepDraft={() => keepDraft(true)}
        onSave={save}
      />

      {dialog === 'preview' && (
        <BillPreviewDialog
          draft={draft}
          totals={totals}
          supply={supply}
          taxCategories={taxCategories}
          companyName={company.data?.name ?? ''}
          companyAddress={company.data?.addressLines ?? []}
          companyGstin={companyGstin}
          autoPrint={autoPrint}
          onClose={() => {
            setAutoPrint(false)
            setDialog(null)
          }}
        />
      )}

      {dialog === 'terms' && (
        <TermsDialog
          value={draft.terms}
          defaultTerms={session?.settings.default_sale_terms ?? ''}
          maySaveDefault={maySettings}
          onApply={(terms) => patch({ terms })}
          onSavedDefault={(terms) => patch({ terms })}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}

      {dialog === 'discard' && (
        <DiscardDialog
          onKeep={() => setDialog(null)}
          onDiscard={() => {
            clearStoredDraft(storageKey)
            const fresh = emptyDraft()
            setDraft(fresh)
            setBaseline(fresh)
            setDialog(null)
            navigate(-1)
          }}
        />
      )}
    </div>
  )
}
