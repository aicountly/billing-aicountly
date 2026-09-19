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
import MoneyToPay from '../src/pages/payables/MoneyToPay'
import CashCompliance from '../src/dashboards/CashCompliance'
import { saveSession, setAuthToken } from '../src/auth/tokens'
import { setScope } from '../src/services/api'
import * as fixtures from './fixtures'
import '../src/index.css'
import '../src/App.css'

const params = new URLSearchParams(window.location.search)
const screen = params.get('screen') ?? 'overview'
const asBiller = params.get('as') === 'biller'
/**
 * Which answer the fixtures give: the normal one, nothing at all, a failure, or
 * a slow one so the skeletons can be photographed.
 *
 *   /visual.html?screen=money-to-pay&state=empty
 */
const state = params.get('state') ?? 'ready'

const SCREENS: Record<string, { path: string; element: React.ReactNode }> = {
  overview: { path: '/dashboard/overview', element: <Overview /> },
  biller: { path: '/dashboard/biller', element: <BillerDesk /> },
  receivables: { path: '/dashboard/receivables', element: <Receivables /> },
  payables: { path: '/dashboard/payables', element: <Payables /> },
  'cash-compliance': { path: '/dashboard/cash-compliance', element: <CashCompliance /> },
  'money-to-pay': { path: '/payables', element: <MoneyToPay /> },
}

/** The fixture behind each endpoint the screens call. */
const RESPONSES: Array<[RegExp, unknown]> = [
  [/v1\/session/, asBiller ? fixtures.billerSession : fixtures.ownerSession],
  [/v1\/dashboards\/overview/, fixtures.overview],
  [/v1\/dashboards\/biller/, fixtures.biller],
  [/v1\/dashboards\/receivables/, fixtures.receivables],
  [/v1\/dashboards\/payables/, fixtures.payables],
  // Before the workspace pattern: /v1\/payables/ matches this URL too.
  [/v1\/payables\/comparison/, fixtures.payablesComparison],
  [/v1\/payables/, state === 'empty' ? fixtures.payablesNothingOwed : fixtures.payablesWorkspace],
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
  [/v1\/manage\/companies/, { data: [{ cmp_id: 1, cmp_name: 'Sharma Enterprises' }], meta: { total: 1 } }],
  [/v1\/manage\/companyinfo/, {
    cmp_id: 1,
    cmp_name: 'Sharma Enterprises',
    fy_list: [{ fy_id: 4, fy_name: 'FY 2026–27' }],
    branch_list: [{ bo_id: 1, bo_name: 'Main Branch', is_head_office: true }],
  }],
]

const originalFetch = window.fetch.bind(window)

/**
 * Every URL the screen asked for, in order.
 *
 * The harness answers fetch itself, so nothing reaches the network and a
 * browser automating this page cannot see what the screen asked for. Checking
 * that a filter, a sort or a debounced search actually reaches the API — rather
 * than only changing a chip's colour — needs somewhere to look, and this is it.
 */
const calls: string[] = []
;(window as unknown as { harnessCalls: string[] }).harnessCalls = calls

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  calls.push(url)

  if (state === 'slow' && url.includes('v1/payables')) {
    await new Promise((resolve) => setTimeout(resolve, 60_000))
  }

  if (state === 'error' && url.includes('v1/payables') && !url.includes('comparison')) {
    return new Response(
      JSON.stringify({
        error: {
          code: 'books_unavailable',
          message: 'Could not reach Smart Books to work out money to pay. Please retry.',
        },
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )
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
