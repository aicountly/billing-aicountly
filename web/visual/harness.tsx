/**
 * A photo booth for the dashboards and the dues screens. Development only.
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
 *   /visual.html?screen=receivables&state=empty
 *   /visual.html?screen=receivables&state=error
 *   /visual.html?screen=receivables&as=biller     (no receipt or reminder rights)
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
import { DuesScreen } from '../src/receivables/DuesScreen'
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

const SCREENS: Record<string, { path: string; element: React.ReactNode }> = {
  overview: { path: '/dashboard/overview', element: <Overview /> },
  biller: { path: '/dashboard/biller', element: <BillerDesk /> },
  receivables: { path: '/dashboard/receivables', element: <Receivables /> },
  payables: { path: '/dashboard/payables', element: <Payables /> },
  'cash-compliance': { path: '/dashboard/cash-compliance', element: <CashCompliance /> },

  // The bill-by-bill screens. `/receivables` is the one the menu points at.
  dues: { path: '/receivables', element: <DuesScreen side="receivable" /> },
  'dues-payable': { path: '/payables', element: <DuesScreen side="payable" /> },
}

const DUES = /v1\/(receivables|payables)(\?|$)/

/** The fixture behind each endpoint the screens call. A function gets the URL. */
const RESPONSES: Array<[RegExp, unknown | ((url: string) => unknown)]> = [
  [/v1\/session/, asBiller ? fixtures.billerSession : fixtures.ownerSession],
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
  [/v1\/manage\/companies/, { data: [{ cmp_id: 1, cmp_name: 'Sharma Enterprises' }], meta: { total: 1 } }],
  [/v1\/manage\/companyinfo/, {
    cmp_id: 1,
    cmp_name: 'Sharma Enterprises',
    fy_list: [{ fy_id: 4, fy_name: 'FY 2026–27' }],
    branch_list: [{ bo_id: 1, bo_name: 'Main Branch', is_head_office: true }],
  }],
]

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

const routes = (
  <Routes>
    <Route element={<AppShell />}>
      <Route path={realRouter ? window.location.pathname : target.path} element={target.element} />
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
          <MemoryRouter initialEntries={[target.path]}>{routes}</MemoryRouter>
        )}
      </BillingProvider>
    </AuthProvider>
  </StrictMode>,
)
