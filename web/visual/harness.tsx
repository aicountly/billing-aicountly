/**
 * A photo booth for the five dashboards. Development only.
 *
 * It mounts the REAL page components inside the REAL shell, with the real
 * hooks, the real loading states and the real router. The only thing replaced
 * is the network: `window.fetch` answers the dashboard endpoints from the
 * fixtures next door, so the screens can be photographed at four widths
 * without inventing records in anybody's company.
 *
 * It is a separate HTML entry point. `vite build` takes index.html only, so
 * none of this reaches the deployed bundle.
 *
 *   /visual.html?screen=overview&as=owner
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '../src/auth/AuthProvider'
import { BillingProvider } from '../src/context/BillingContext'
import { AppShell } from '../src/shell/AppShell'
import Overview from '../src/dashboards/Overview'
import BillerDesk from '../src/dashboards/BillerDesk'
import Receivables from '../src/dashboards/Receivables'
import Payables from '../src/dashboards/Payables'
import CashCompliance from '../src/dashboards/CashCompliance'
import { MoneyScreen } from '../src/pages/money/MoneyScreen'
import ExpensePage from '../src/pages/expense/ExpensePage'
import SalesBillPage from '../src/pages/sale/SalesBillPage'
import CreditNotePage from '../src/pages/credit-note/CreditNotePage'
import BankWithdrawalPage from '../src/pages/withdrawal/BankWithdrawalPage'
import { saveSession, setAuthToken } from '../src/auth/tokens'
import { setScope } from '../src/services/api'
import * as fixtures from './fixtures'
import '../src/index.css'
import '../src/App.css'

const params = new URLSearchParams(window.location.search)
const screen = params.get('screen') ?? 'overview'
const asBiller = params.get('as') === 'biller'

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
 * Endpoints to answer with an EMPTY list, as `?empty=paid-from`.
 *
 * The other half of the same idea. "The company has no cash ledgers yet" and
 * "Books did not answer" are different states with different words on screen,
 * and a booth that can only refuse can photograph one of them.
 */
const emptied = new Set((params.get('empty') ?? '').split(',').filter(Boolean))

const FAILABLE: Array<[string, RegExp]> = [
  ['recent', /v1\/expenses\/recent/],
  ['categories', /v1\/catalog\/expense-accounts/],
  ['paid-from', /v1\/catalog\/cash-bank/],
  // The withdrawal screen's two side panels, each of which has to be able to
  // fail without taking the form down with it.
  ['recent-withdrawals', /v1\/cash-bank\/recent/],
  ['balance', /v1\/cash-bank\?/],
  ['parties', /v1\/catalog\/parties/],
  ['capabilities', /v1\/expenses\/capabilities/],
  ['tax', /v1\/catalog\/tax-categories/],
  ['stock', /v1\/catalog\/stock/],
  ['open-bills', /v1\/open-bills/],
  ['bills', /v1\/original-documents(\?|$)/],
  ['bill-lines', /v1\/original-documents\/\d+/],
  ['warehouses', /v1\/catalog\/warehouses/],
  ['trend', /v1\/credit-notes\/trend/],
  ['issue', /v1\/transactions\/credit_note/],
]

const SCREENS: Record<string, { path: string; element: React.ReactNode }> = {
  overview: { path: '/dashboard/overview', element: <Overview /> },
  biller: { path: '/dashboard/biller', element: <BillerDesk /> },
  receivables: { path: '/dashboard/receivables', element: <Receivables /> },
  payables: { path: '/dashboard/payables', element: <Payables /> },
  'cash-compliance': { path: '/dashboard/cash-compliance', element: <CashCompliance /> },
  'money-out': { path: '/money-out/new', element: <MoneyScreen direction="out" /> },
  'money-in': { path: '/money-in/new', element: <MoneyScreen direction="in" /> },
  expense: { path: '/more/expense', element: <ExpensePage /> },
  sale: { path: '/sales/new', element: <SalesBillPage /> },
  'credit-note': { path: '/more/credit-note', element: <CreditNotePage /> },
  'bank-withdrawal': { path: '/bank-cash/withdrawal', element: <BankWithdrawalPage /> },
}

/** The fixture behind each endpoint the screens call. */
const RESPONSES: Array<[RegExp, unknown]> = [
  [/v1\/session/, asBiller ? fixtures.billerSession : fixtures.ownerSession],
  [/v1\/dashboards\/overview/, fixtures.overview],
  [/v1\/dashboards\/biller/, fixtures.biller],
  [/v1\/dashboards\/receivables/, fixtures.receivables],
  [/v1\/dashboards\/payables/, fixtures.payables],
  [/v1\/dashboards\/cash-compliance/, fixtures.compliance],
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
  [/v1\/open-bills/, fixtures.openBills],
  [/v1\/original-documents\/\d+/, fixtures.originalDocument],
  [/v1\/original-documents/, fixtures.originalDocuments],
  [/v1\/credit-notes\/trend/, fixtures.creditNoteTrend],
  [/v1\/catalog\/warehouses/, fixtures.warehouses],
  [/v1\/transactions\/credit_note/, fixtures.savedCreditNote],
  [/v1\/catalog\/expense-accounts/, fixtures.expenseAccounts],
  [/v1\/catalog\/tax-categories/, fixtures.taxCategories],
  [/v1\/expenses\/recent/, fixtures.recentExpenses],
  [/v1\/transactions\/expense/, fixtures.savedExpense],
  [/v1\/expenses\/capabilities/, fixtures.expenseCapabilities],
  [/v1\/transactions\/bank_withdrawal/, fixtures.savedWithdrawal],
  // One entry, shared: this list is matched in order and a second
  // cash-bank pattern below would never be reached.
  [/v1\/catalog\/cash-bank/, fixtures.cashBankAccounts],
  // The three cash-bank patterns match different paths and cannot shadow each
  // other — `catalog/` above, `/recent` here, and the balances only with their
  // query string — but they are kept longest-first so that stays obvious.
  [/v1\/cash-bank\/recent/, fixtures.recentWithdrawals],
  [/v1\/cash-bank\?/, fixtures.cashBankBalances],
  [/v1\/manage\/companies/, { data: [{ cmp_id: 1, cmp_name: 'Sharma Enterprises' }], meta: { total: 1 } }],
  [/v1\/manage\/companyinfo/, {
    cmp_id: 1,
    cmp_name: 'Sharma Enterprises',
    gstin: '27AAACS1234F1Z5',
    ro_address: 'Unit 4, Sai Industrial Estate\nAndheri East, Mumbai, Maharashtra\n400093',
    fy_list: [{ fy_id: 4, fy_name: 'FY 2026-27', fy_start: '2026-04-01', fy_end: '2027-03-31' }],
    branch_list: [{ bo_id: 1, bo_name: 'Main Branch', is_head_office: true }],
  }],
]

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

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

  for (const [key, pattern] of FAILABLE) {
    if (emptied.has(key) && pattern.test(url)) {
      return new Response(JSON.stringify({ data: [], meta: { total: 0, limit: 0, offset: 0 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (failing.has(key) && pattern.test(url)) {
      return new Response(JSON.stringify({ error: { code: 'upstream_unavailable', message: 'Not answering, by request.' } }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  // Item search really searches, so a line can be added by hand in the booth
  // and "no matches" is reachable. One list for both screens: the credit note
  // credits what a bill sold, so the two booths have to agree about items.
  if (/v1\/catalog\/items\/search/.test(url)) {
    const term = (new URL(url, window.location.origin).searchParams.get('q') ?? '').toLowerCase()
    const rows = everyItem().filter(
      (row) => (row.item_name ?? '').toLowerCase().includes(term) || (row.item_sku ?? '').toLowerCase().includes(term),
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
      (row) => (row.barcode ?? '').toLowerCase() === code || (row.item_sku ?? '').toLowerCase() === code,
    )
    return new Response(JSON.stringify(item ? { data: item } : { error: { code: 'not_found', message: 'No such code.' } }), {
      status: item ? 200 : 404,
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
      const body = Array.isArray(payload) || !(payload as { data?: unknown }).data
        ? { data: payload }
        : payload
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <BillingProvider>
        <MemoryRouter initialEntries={[target.path]}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path={target.path} element={target.element} />
            </Route>
          </Routes>
        </MemoryRouter>
      </BillingProvider>
    </AuthProvider>
  </StrictMode>,
)
