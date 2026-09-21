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
import ExpensePage from '../src/pages/expense/ExpensePage'
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
]

const SCREENS: Record<string, { path: string; element: React.ReactNode }> = {
  overview: { path: '/dashboard/overview', element: <Overview /> },
  biller: { path: '/dashboard/biller', element: <BillerDesk /> },
  receivables: { path: '/dashboard/receivables', element: <Receivables /> },
  payables: { path: '/dashboard/payables', element: <Payables /> },
  'cash-compliance': { path: '/dashboard/cash-compliance', element: <CashCompliance /> },
  expense: { path: '/more/expense', element: <ExpensePage /> },
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
  [/v1\/catalog\/expense-accounts/, fixtures.expenseAccounts],
  [/v1\/catalog\/cash-bank/, fixtures.cashBankAccounts],
  [/v1\/catalog\/tax-categories/, fixtures.taxCategories],
  [/v1\/expenses\/recent/, fixtures.recentExpenses],
  [/v1\/transactions\/expense/, fixtures.savedExpense],
  [/v1\/expenses\/capabilities/, fixtures.expenseCapabilities],
  // Order matters: the recent list is a longer path than the balances, and the
  // balance pattern would otherwise swallow it.
  [/v1\/cash-bank\/recent/, fixtures.recentWithdrawals],
  [/v1\/cash-bank\?/, fixtures.cashBankBalances],
  [/v1\/transactions\/bank_withdrawal/, fixtures.savedWithdrawal],
  [/v1\/manage\/companies/, { data: [{ cmp_id: 1, cmp_name: 'Sharma Enterprises' }], meta: { total: 1 } }],
  [/v1\/manage\/companyinfo/, {
    cmp_id: 1,
    cmp_name: 'Sharma Enterprises',
    fy_list: [{ fy_id: 4, fy_name: 'FY 2026-27', fy_start: '2026-04-01', fy_end: '2027-03-31' }],
    branch_list: [{ bo_id: 1, bo_name: 'Main Branch', is_head_office: true }],
  }],
]

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

  // Party search really searches, so the empty state is reachable here too.
  if (/v1\/catalog\/parties/.test(url)) {
    const term = (new URL(url, window.location.origin).searchParams.get('q') ?? '').toLowerCase()
    const rows = fixtures.suppliers.filter((row) => row.acc_name.toLowerCase().includes(term))
    return new Response(JSON.stringify({ data: rows, meta: { total: rows.length, limit: 20, offset: 0 } }), {
      status: 200,
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
