/**
 * A photo booth for the dashboards, the debit note editor and the dues
 * screens. Development only.
 *
 * It mounts the REAL page components inside the REAL shell, with the real
 * hooks, the real loading states and the real router. The only thing replaced
 * is the network: `window.fetch` answers the endpoints from the fixtures next
 * door, so the screens can be photographed at four widths without inventing
 * records in anybody's company.
 *
 * It is a separate HTML entry point. `vite build` takes index.html only, so
 * none of this reaches the deployed bundle.
 *
 *   /visual.html?screen=overview&as=owner
 *   /visual.html?screen=debit-note
 *   /visual.html?screen=bank-withdrawal&fail=balance
 *   /visual.html?screen=dues&state=empty|error|slow
 *   /visual.html?screen=dues&as=biller            (no receipt or reminder rights)
 *   /visual.html?screen=items&at=stock_status%3Dlow
 *   /visual.html?screen=dues&router=browser       (the real router and the real
 *                                                  back button, for the filters
 *                                                  that live in the address bar)
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '../src/auth/AuthProvider'
import { BillingProvider } from '../src/context/BillingContext'
import { AppShell } from '../src/shell/AppShell'
import Overview from '../src/dashboards/Overview'
import BillerDesk from '../src/dashboards/BillerDesk'
import Receivables from '../src/dashboards/Receivables'
import Payables from '../src/dashboards/Payables'
import CashCompliance from '../src/dashboards/CashCompliance'
import DebitNote from '../src/pages/DebitNote'
import { DuesScreen } from '../src/receivables/DuesScreen'
import { MoneyScreen } from '../src/pages/money/MoneyScreen'
import MoneyReceived from '../src/pages/money-received'
import ExpensePage from '../src/pages/expense/ExpensePage'
import ItemsPage from '../src/pages/items/ItemsPage'
import BankWithdrawalPage from '../src/pages/bank-withdrawal/BankWithdrawalPage'
import SalesBillPage from '../src/pages/sale/SalesBillPage'
import CreditNotePage from '../src/pages/credit-note/CreditNotePage'
import SettingsHome from '../src/pages/settings/SettingsHome'
import SettingsCategory from '../src/pages/settings/SettingsCategory'
import { saveSession, setAuthToken } from '../src/auth/tokens'
import { setScope } from '../src/services/api'
import * as fixtures from './fixtures'
import '../src/index.css'
import '../src/App.css'

const params = new URLSearchParams(window.location.search)
const screen = params.get('screen') ?? 'overview'
const asBiller = params.get('as') === 'biller'
const state = params.get('state') ?? 'normal'
// `?router=browser` swaps the memory router for the real one, so the filter
// round trip through the address bar — and the back button with it — can be
// exercised as it behaves in the app. The screenshots keep the memory router,
// which lets the sidebar highlight the route each screen really sits on.
const realRouter = params.get('router') === 'browser'

/**
 * `?docs=on` answers the capability endpoint as a deployment with a document
 * service configured.
 *
 * The expense screen has two honest shapes — a drop zone when a bill file can
 * be kept, a reference field when it cannot — and both have to be looked at.
 * The flag changes nothing but the capability response, which is exactly what
 * configuring the service would change.
 */
const documentsConfigured = params.get('docs') === 'on'

/**
 * Endpoints to answer with a 503, as `?fail=recent,categories`.
 *
 * Photographing what a screen does when one of its panels cannot load is the
 * other half of what this booth is for: the expense form has to stay usable
 * when the recent list does not arrive, and that is only checkable if the
 * booth can refuse to answer.
 */
const failing = new Set((params.get('fail') ?? '').split(',').filter(Boolean))

/**
 * The screen's OWN query string, as `?at=stock_status%3Dlow`.
 *
 * Screens that keep their state in the address bar — the Items workspace does —
 * cannot be photographed in their filtered, sorted or paged states without it,
 * because the booth mounts them in a MemoryRouter and the browser's query
 * string never reaches the app's router.
 */
const at = params.get('at') ?? ''

const FAILABLE: Array<[string, RegExp]> = [
  ['recent', /v1\/expenses\/recent/],
  ['categories', /v1\/catalog\/expense-accounts/],
  ['paid-from', /v1\/catalog\/cash-bank/],
  ['parties', /v1\/catalog\/parties/],
  ['capabilities', /v1\/expenses\/capabilities/],
  // The overview's two halves, so "the dashboard is down" and "only the
  // written summary is down" can both be photographed.
  ['briefing', /v1\/dashboards\/overview\/briefing/],
  ['overview', /v1\/dashboards\/overview(\?|$)/],
  ['items', /v1\/catalog\/items(\?|$)/],
  ['stats', /v1\/catalog\/items\/stats/],
  ['groups', /v1\/catalog\/item-groups/],
  ['tax', /v1\/catalog\/tax-categories/],
  ['stock', /v1\/catalog\/stock/],
  ['open-bills', /v1\/open-bills/],
  ['dues', /v1\/receivables/],
  ['money-recent', /v1\/money\/recent/],
  ['bills', /v1\/original-documents(\?|$)/],
  ['bill-lines', /v1\/original-documents\/\d+/],
  ['warehouses', /v1\/catalog\/warehouses/],
  ['trend', /v1\/credit-notes\/trend/],
  ['issue', /v1\/transactions\/credit_note/],
  // The withdrawal screen's two sidebar panels and its balance, each of which
  // has to be able to fail without taking the form down with it.
  ['balance', /\/v1\/cash-bank(\?|$)/],
  ['withdrawals', /v1\/bank-withdrawals\/recent/],
  ['withdrawal-summary', /v1\/bank-withdrawals\/summary/],
]

const SCREENS: Record<string, { path: string; element: React.ReactNode }> = {
  overview: { path: '/dashboard/overview', element: <Overview /> },
  biller: { path: '/dashboard/biller', element: <BillerDesk /> },
  receivables: { path: '/dashboard/receivables', element: <Receivables /> },
  payables: { path: '/dashboard/payables', element: <Payables /> },
  'cash-compliance': { path: '/dashboard/cash-compliance', element: <CashCompliance /> },
  'debit-note': { path: '/more/debit-note', element: <DebitNote /> },

  // The bill-by-bill screens. `/receivables` is the one the menu points at.
  dues: { path: '/receivables', element: <DuesScreen side="receivable" /> },
  'dues-payable': { path: '/payables', element: <DuesScreen side="payable" /> },
  'money-out': { path: '/money-out/new', element: <MoneyScreen direction="out" /> },
  'money-in': { path: '/money-in/new', element: <MoneyReceived /> },
  'money-in-form': { path: '/money-in/new', element: <MoneyScreen direction="in" /> },
  expense: { path: '/more/expense', element: <ExpensePage /> },
  items: { path: '/items', element: <ItemsPage /> },
  sale: { path: '/sales/new', element: <SalesBillPage /> },
  'credit-note': { path: '/more/credit-note', element: <CreditNotePage /> },
  'bank-withdrawal': { path: '/bank-cash/withdrawal', element: <BankWithdrawalPage /> },
  settings: { path: '/settings', element: <SettingsHome /> },
}

/** The settings hub's detail pages: /visual.html?screen=settings&category=taxes */
const SETTINGS_CATEGORY = params.get('category')

const DUES = /v1\/(receivables|payables)(\?|$)/

/** The fixture behind each endpoint the screens call. A function gets the URL. */
const RESPONSES: Array<[RegExp, unknown | ((url: string) => unknown)]> = [
  [/v1\/session/, asBiller ? fixtures.billerSession : fixtures.ownerSession],
  // Before the dashboard itself: `v1/dashboards/overview` matches the briefing
  // URL too, and the first pattern in this list wins.
  [/v1\/dashboards\/overview\/briefing/, {
    data: {
      available: false,
      reason: 'No briefing model is configured for this deployment, so there is nothing to write the summary. '
        + 'The counted briefing above is unaffected.',
      narrative: null,
      sources: [],
      generated_at: null,
    },
  }],
  [/v1\/dashboards\/overview/, fixtures.overview],
  [/v1\/dashboards\/biller/, fixtures.biller],
  [/v1\/dashboards\/receivables/, fixtures.receivables],
  [/v1\/dashboards\/payables/, fixtures.payables],
  [/v1\/dashboards\/cash-compliance/, fixtures.compliance],

  [
    DUES,
    (url: string) => {
      if (state === 'empty') return fixtures.duesEmpty
      // The dues screen takes a second reading at an earlier date for the
      // movement on the cards. Answering both from one fixture would show a
      // flat 0% and never exercise the comparison at all.
      if (url.includes('as_on=')) return fixtures.receivableDuesEarlier
      return url.includes('v1/payables') ? fixtures.payableDues : fixtures.receivableDues
    },
  ],

  [/v1\/insights/, [
    { kind: 'overdue_receivable', tone: 'warning', message: '₹74,500.00 is overdue from customers.', action: { label: 'See who', path: '/dashboard/receivables' } },
    { kind: 'payable_due', tone: 'info', message: '₹48,000.00 is due to suppliers this week.', action: { label: 'See the list', path: '/dashboard/payables' } },
  ]],
  [/v1\/catalog\/items\/favourites/, [
    { item_id: 1, item_name: 'A4 Copy Paper', item_sku: 'A4-500', unit_id: 1, hsn_sac: '4802', mrp: '320' },
    { item_id: 2, item_name: 'Blue Ball Pen', item_sku: 'PEN-BL', unit_id: 1, hsn_sac: '9608', mrp: '12' },
    { item_id: 3, item_name: 'Stapler', item_sku: 'STP-01', unit_id: 1, hsn_sac: '8472', mrp: '450' },
  ]],
  [/v1\/transactions\/(payment|receipt)/, fixtures.savedPayment],
  [/v1\/transactions\/sale/, fixtures.savedSale],
  [/v1\/money\/party-context/, fixtures.moneyPartyContext],
  [/v1\/money\/recent/, fixtures.moneyRecent],
  [/v1\/receivables/, fixtures.customerDues],
  [/v1\/original-documents\/\d+/, fixtures.originalDocument],
  [/v1\/credit-notes\/trend/, fixtures.creditNoteTrend],
  [/v1\/catalog\/warehouses/, fixtures.warehouses],
  [/v1\/transactions\/credit_note/, fixtures.savedCreditNote],
  [/v1\/catalog\/expense-accounts/, fixtures.expenseAccounts],
  [/v1\/catalog\/tax-categories/, fixtures.taxCategories],
  [/v1\/catalog\/items\/stats/, fixtures.catalogItemStats],
  [/v1\/catalog\/item-groups/, fixtures.catalogItemGroups],
  [/v1\/expenses\/recent/, fixtures.recentExpenses],
  [/v1\/transactions\/expense/, fixtures.savedExpense],
  [/v1\/expenses\/capabilities/, documentsConfigured ? fixtures.expenseCapabilitiesConfigured : fixtures.expenseCapabilities],
  // One entry, shared: this list is matched in order and a second
  // cash-bank pattern below would never be reached.
  [/v1\/catalog\/cash-bank/, fixtures.cashBankAccounts],
  // The BALANCES are a different endpoint, and its pattern is anchored so it
  // cannot swallow the catalog URL above.
  [/\/v1\/cash-bank(\?|$)/, fixtures.cashBankBalances],
  [/v1\/bank-withdrawals\/recent/, fixtures.recentWithdrawals],
  [/v1\/bank-withdrawals\/summary/, fixtures.withdrawalSummary],
  [/v1\/transactions\/bank_withdrawal/, fixtures.savedWithdrawal],
  [/v1\/manage\/companies/, { data: [{ cmp_id: 1, cmp_name: 'Sharma Enterprises' }], meta: { total: 1 } }],
  // Two branches and two years on purpose: switching one mid-entry is a case
  // the expense form has to handle (it clears the ids that belonged to the
  // company that was open), and it is only checkable if there is something to
  // switch to. Real dates on both years, because the debit note editor bounds
  // its date field with them and refuses a date outside the scoped year.
  [/v1\/manage\/companyinfo/, {
    cmp_id: 1,
    cmp_name: 'Sharma Enterprises',
    gstin: '27AAACS1234F1Z5',
    ro_address: 'Unit 4, Sai Industrial Estate\nAndheri East, Mumbai, Maharashtra\n400093',
    fy_list: [
      { fy_id: 4, fy_name: 'FY 2026-27', fy_start: '2026-04-01', fy_end: '2027-03-31' },
      { fy_id: 3, fy_name: 'FY 2025-26', fy_start: '2025-04-01', fy_end: '2026-03-31' },
    ],
    branch_list: [
      { bo_id: 1, bo_name: 'Main Branch', is_head_office: true },
      { bo_id: 2, bo_name: 'Warehouse', is_head_office: false },
    ],
  }],
  [/v1\/profiles/, fixtures.profiles],
  [/v1\/reminders/, fixtures.reminderRules],
]

/**
 * The bill upload goes over XMLHttpRequest, not fetch — that is the only way
 * the browser will say how much of the file has gone — so the booth has to
 * stand in for it separately to photograph an attached bill.
 */
class HarnessUpload extends XMLHttpRequest {
  private stubbed = false

  override open(method: string, url: string | URL, async = true, user?: string | null, password?: string | null): void {
    this.stubbed = /v1\/expenses\/bill/.test(String(url))
    if (this.stubbed) return

    super.open(method, url, async, user, password)
  }

  override setRequestHeader(name: string, value: string): void {
    if (this.stubbed) return
    super.setRequestHeader(name, value)
  }

  override send(body?: Document | XMLHttpRequestBodyInit | null): void {
    if (!this.stubbed) {
      super.send(body)
      return
    }

    const file = body instanceof FormData ? body.get('file') : null
    const stored =
      file instanceof File
        ? { ...fixtures.storedBill, filename: file.name, size: file.size, content_type: file.type }
        : fixtures.storedBill

    Object.defineProperty(this, 'status', { value: 200, configurable: true })
    Object.defineProperty(this, 'responseText', { value: JSON.stringify({ data: stored }), configurable: true })

    // A couple of frames of progress, so the uploading state is reachable.
    let sent = 0
    const total = stored.size ?? 1
    const tick = window.setInterval(() => {
      sent = Math.min(total, sent + total / 4)
      this.upload.dispatchEvent(
        Object.assign(new ProgressEvent('progress', { lengthComputable: true, loaded: sent, total }), {}),
      )
      if (sent >= total) {
        window.clearInterval(tick)
        this.dispatchEvent(new ProgressEvent('load'))
      }
    }, 120)
  }
}

window.XMLHttpRequest = HarnessUpload

/**
 * Every item the booth knows, across both screens' fixtures.
 *
 * The two lists carry different fields — one has barcodes, the other does not
 * — so they are read loosely here rather than being forced into one shape the
 * real Inventory payload does not have either.
 */
type LooseItem = Record<string, string | number | null | undefined>
const everyItem = (): LooseItem[] => [...fixtures.catalogItems, ...fixtures.saleItems] as unknown as LooseItem[]

const originalFetch = window.fetch.bind(window)

function json(payload: unknown, status = 200): Response {
  const body = Array.isArray(payload) || !(payload as { data?: unknown }).data ? { data: payload } : payload

  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

  // The error state is the whole point of having one: the screen has to keep
  // its shell and say what failed, rather than going blank.
  if (state === 'error' && DUES.test(url)) {
    return json(
      { error: { code: 'books_unavailable', message: 'Could not reach Smart Books to work out money to collect. Please retry.' } },
      503,
    )
  }

  for (const [key, pattern] of FAILABLE) {
    if (failing.has(key) && pattern.test(url)) {
      return new Response(JSON.stringify({ error: { code: 'upstream_unavailable', message: 'Not answering, by request.' } }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  /**
   * The item list really filters, sorts and pages.
   *
   * Which is the only way the tabs, the search box, the sort arrows, the pager
   * and BOTH empty states can be photographed — a fixture that answers the same
   * ten rows to every request proves the table draws and nothing else.
   */
  if (/v1\/catalog\/items(\?|$)/.test(url)) {
    const params = new URL(url, window.location.origin).searchParams
    const term = (params.get('q') ?? '').toLowerCase()
    const type = params.get('type')
    const status = params.get('status')
    const stockStatus = params.get('stock_status')
    const groupId = params.get('group_id')
    const sort = params.get('sort')
    const descending = params.get('order') === 'desc'
    const limit = Number(params.get('limit') ?? 25)
    const offset = Number(params.get('offset') ?? 0)

    let rows = fixtures.catalogItems.filter((item) => {
      if (term && ![item.item_name, item.item_sku, item.hsn_sac].some((field) => (field ?? '').toLowerCase().includes(term))) return false
      if (type && item.type !== type) return false
      if (status === 'active' && item.is_active === false) return false
      if (status === 'inactive' && item.is_active !== false) return false
      if (stockStatus && item.stock.state !== stockStatus) return false
      if (groupId && String(item.group?.id ?? '') !== groupId) return false
      return true
    })

    if (sort) {
      const value = (item: (typeof rows)[number]): string | number => {
        if (sort === 'sku') return item.item_sku ?? ''
        if (sort === 'hsn_sac') return item.hsn_sac ?? ''
        if (sort === 'rate') return item.rate ?? 0
        if (sort === 'stock') return item.stock.available ?? 0
        if (sort === 'status') return item.is_active === false ? 0 : 1
        return item.item_name
      }
      rows = [...rows].sort((a, b) => {
        const left = value(a)
        const right = value(b)
        const comparison = typeof left === 'string' && typeof right === 'string' ? left.localeCompare(right) : Number(left) - Number(right)
        return descending ? -comparison : comparison
      })
    }

    const total = rows.length
    const page = rows.slice(offset, offset + limit)

    return new Response(
      JSON.stringify({
        data: page,
        meta: {
          total,
          limit,
          offset,
          source: 'inventory',
          upstream: { filters_ignored: [], sort_applied: sort ? true : null },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Item search really searches, so a line can be added by hand in the booth
  // and "no matches" is reachable. One list for both screens: the credit note
  // credits what a bill sold, so the two booths have to agree about items.
  if (/v1\/catalog\/items\/search/.test(url)) {
    const term = (new URL(url, window.location.origin).searchParams.get('q') ?? '').toLowerCase()
    const rows = everyItem().filter(
      (row) => String(row.item_name ?? '').toLowerCase().includes(term) || String(row.item_sku ?? '').toLowerCase().includes(term),
    )
    return new Response(JSON.stringify({ data: rows, meta: { total: rows.length, limit: 20, offset: 0 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Scan: a real barcode where the fixture carries one, an SKU otherwise —
  // the credit note booth scans by SKU. Anything else 404s, which is the path
  // the bill screen falls back to the ordinary search on.
  if (/v1\/catalog\/items\/barcode\//.test(url)) {
    const code = decodeURIComponent(url.split('/barcode/')[1]?.split('?')[0] ?? '').toLowerCase()
    const item = everyItem().find(
      (row) => String(row.barcode ?? '').toLowerCase() === code || String(row.item_sku ?? '').toLowerCase() === code,
    )
    return new Response(JSON.stringify(item ? { data: item } : { error: { code: 'not_found', message: 'No such code.' } }), {
      status: item ? 200 : 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // The money endpoints answer for the direction they were asked about: the
  // receipt booth must not be shown a supplier's payments, and the payment
  // booth must not be shown a customer's receipts.
  if (/v1\/money\/recent/.test(url)) {
    const direction = new URL(url, window.location.origin).searchParams.get('direction') ?? 'out'
    return new Response(JSON.stringify({ data: direction === 'in' ? fixtures.moneyRecentIn : fixtures.moneyRecent }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Open bills — branched on the ACCOUNT, not the side alone. `side=payable`
  // is asked by both the payment screen (any supplier) and the debit note
  // (this booth's one supplier, 9012), and only the account tells them apart;
  // `side=receivable` is the money-received screen's, unambiguously.
  if (/v1\/open-bills/.test(url)) {
    const params = new URL(url, window.location.origin).searchParams
    const side = params.get('side') ?? 'payable'
    const accountId = params.get('account_id')
    const body =
      side === 'receivable'
        ? fixtures.openBillsIn
        : accountId === '9012'
          ? fixtures.debitNoteOpenBills
          : fixtures.openBills
    return new Response(JSON.stringify({ data: body }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Party search really searches, so the empty state is reachable here too.
  if (/v1\/catalog\/parties/.test(url)) {
    const term = (new URL(url, window.location.origin).searchParams.get('q') ?? '').toLowerCase()
    const side = new URL(url, window.location.origin).searchParams.get('side') ?? 'customer'
    const pool = side === 'supplier' ? fixtures.suppliers : fixtures.customers
    const rows = pool.filter((row) => row.acc_name.toLowerCase().includes(term))
    return new Response(JSON.stringify({ data: rows, meta: { total: rows.length, limit: 20, offset: 0 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (/v1\/catalog\/stock/.test(url)) {
    const itemId = Number(new URL(url, window.location.origin).searchParams.get('item_id') ?? 0)
    return new Response(JSON.stringify({ data: fixtures.availability[itemId] ?? {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Bills a note can be raised against, branched on `kind` — the credit note
  // and the debit note both call the bare path, and only the query string
  // says which supplier's or customer's documents belong in the answer.
  // (Excludes the `/\d+` sub-route, which stays a plain RESPONSES entry.)
  if (/v1\/original-documents(\?|$)/.test(url)) {
    const kind = new URL(url, window.location.origin).searchParams.get('kind')
    const body = kind === 'purchase' ? fixtures.debitNoteDocuments : fixtures.originalDocuments
    return new Response(JSON.stringify({ data: body }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // One item by id, as the biller desk and the global search link into the bill.
  const byId = /v1\/catalog\/items\/(\d+)/.exec(url)
  if (byId) {
    const hit = everyItem().find((row) => row.item_id === Number(byId[1]))
    return new Response(JSON.stringify(hit ? { data: hit } : { error: { code: 'not_found', message: 'No such item.' } }), {
      status: hit ? 200 : 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  for (const [pattern, payload] of RESPONSES) {
    if (pattern.test(url)) {
      const resolved = typeof payload === 'function' ? (payload as (url: string) => unknown)(url) : payload
      // A deliberate pause, so the skeletons can be photographed too.
      if (state === 'slow') await new Promise((resume) => window.setTimeout(resume, 4000))

      return json(resolved)
    }
  }

  // Anything the harness has no fixture for answers empty rather than hanging,
  // so a screen that calls something unexpected still renders its empty state.
  if (url.includes('/api/')) {
    return new Response(JSON.stringify({ data: [], meta: { total: 0, limit: 0, offset: 0 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return originalFetch(input, init)
}

// A portal token and a session key, both already in storage, so AuthProvider
// settles on "authenticated" without a single call to my.aicountly.com. The
// real provider runs — this only spares it the round trip.
setAuthToken('visual-harness-token')
saveSession('visual-harness-key', 3600)
setScope({ cmp_id: 1, fy_id: 4, bo_id: 0 })
try {
  window.localStorage.setItem('billing:scope', JSON.stringify({ cmp_id: 1, fy_id: 4, bo_id: 0 }))
} catch {
  /* a private window; setScope above is enough for the harness */
}

const target = SCREENS[screen] ?? SCREENS.overview
const isSettings = screen === 'settings'

const entry = isSettings
  ? (SETTINGS_CATEGORY ? `/settings/${SETTINGS_CATEGORY}` : '/settings')
  : at === '' ? target.path : `${target.path}?${at}`

/*
 * Settings is the one area with more than one screen and links between them —
 * twelve cards, a rail and a breadcrumb, all navigating. Both of its routes
 * are mounted whichever one the harness opens on, because a card that
 * navigated to a route the harness had not registered would photograph as a
 * blank page. Every other screen stays on the single-route shape above it.
 */
const routes = (
  <Routes>
    <Route element={<AppShell />}>
      {isSettings ? (
        <>
          <Route path="/settings" element={<SettingsHome />} />
          <Route path="/settings/:categoryId" element={<SettingsCategory />} />
        </>
      ) : (
        <Route path={realRouter ? window.location.pathname : target.path} element={target.element} />
      )}
    </Route>
  </Routes>
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <BillingProvider>
        {realRouter ? (
          <BrowserRouter>{routes}</BrowserRouter>
        ) : (
          <MemoryRouter initialEntries={[entry]}>{routes}</MemoryRouter>
        )}
      </BillingProvider>
    </AuthProvider>
  </StrictMode>,
)
