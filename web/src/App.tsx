import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import { BillingProvider, useBilling } from './context/BillingContext'
import { AppShell } from './shell/AppShell'
import SignIn from './pages/SignIn'
import Onboarding from './pages/Onboarding'
import SaleEditor from './pages/SaleEditor'
import { PartyStatement } from './pages/Dues'
import { BankCash } from './pages/MoneyMovement'
import { Parties } from './pages/parties'
import {
  BankCashOverview,
  Profiles,
  Recurring,
  TransactionDetail,
  Unfinished,
} from './pages/Misc'
import { Notice } from './ui'
import { initAnalytics, trackPageView } from './utils/analytics'
import './App.css'

/**
 * The five dashboards are split out of the main bundle.
 *
 * Each one pulls in the chart and panel code, and nobody opens all five: a
 * biller opens exactly one and a counter machine is usually the slowest device
 * in the building. Reports is split for the same reason.
 */
const Overview = lazy(() => import('./dashboards/Overview'))
const BillerDesk = lazy(() => import('./dashboards/BillerDesk'))
const Receivables = lazy(() => import('./dashboards/Receivables'))
const Payables = lazy(() => import('./dashboards/Payables'))
const CashCompliance = lazy(() => import('./dashboards/CashCompliance'))
const Reports = lazy(() => import('./pages/Reports'))

/**
 * Money paid and money received, split for the same reason.
 *
 * The screen is a form, a period summary, a party's history and a recent list,
 * and only one of the two directions is ever open. Left in the main bundle it
 * costs every screen in the app, including the counter machine that never
 * opens it.
 */
const MoneyScreen = lazy(() =>
  import('./pages/money/MoneyScreen').then((module) => ({ default: module.MoneyScreen })),
)

/**
 * Money received has its own screen: the receipt workspace.
 *
 * It carries its own stylesheet, its allocation table and its insight column,
 * and it is reached by navigation rather than on first paint — so it is split
 * out for the same reason the rest of these are.
 */
const MoneyReceived = lazy(() => import('./pages/money-received'))

/**
 * The expense screen carries its own stylesheet and helper panel, and most
 * sessions never open it. Split for the same reason the dashboards are.
 */
const ExpensePage = lazy(() => import('./pages/expense/ExpensePage'))

/** The bank-withdrawal screen, for the same reason: its own stylesheet, its own panel. */
const BankWithdrawalPage = lazy(() => import('./pages/bank-withdrawal/BankWithdrawalPage'))

/**
 * The Items workspace, split for the same reason.
 *
 * It carries its own stylesheet, a table, a filter popover and a detail panel,
 * and a counter biller who never leaves the till should not pay for any of it
 * on the screen they do use.
 */
const ItemsPage = lazy(() => import('./pages/items/ItemsPage'))

/**
 * The bill screen carries its own stylesheet too. It is split for the same
 * reason — it is reached by navigation rather than on first paint, and the
 * chunk is fetched once and then cached on the machine that opens it all day.
 */
const SalesBillPage = lazy(() => import('./pages/sale/SalesBillPage'))

/**
 * The credit note screen, split for the same reason again: its own
 * stylesheet, its own table and its own readings of the bill being credited,
 * and a counter that only makes bills never opens it.
 */
const CreditNotePage = lazy(() => import('./pages/credit-note/CreditNotePage'))

/**
 * Money to Collect and Money to Pay, split for the same reason: the screen
 * carries its own charts and filter machinery, and a counter biller who only
 * ever makes bills should not pay for them on first load.
 */
const Dues = lazy(() => import('./receivables/DuesScreen').then((module) => ({ default: module.DuesScreen })))

initAnalytics()

function PageViews() {
  const location = useLocation()
  useEffect(() => {
    trackPageView(location.pathname, document.title)
  }, [location.pathname])

  return null
}

/**
 * Nothing renders until a company is chosen — and, the first time, until the
 * five setup questions are answered.
 */
function RequireScope({ children }: { children: React.ReactNode }) {
  const { scope, session, loading, error } = useBilling()

  if (!scope) {
    return (
      <Notice tone="info" title="Choose a company">
        Pick the company and financial year to work in, at the top of the page.
      </Notice>
    )
  }
  if (loading && !session) return <p style={{ color: 'var(--muted)' }}>Opening…</p>
  if (error) return <Notice tone="danger" title="Could not open that company">{error}</Notice>

  return <>{children}</>
}

/**
 * Where "/" goes.
 *
 * The server decides, from the same list the dashboard endpoints check: an
 * owner lands on the business overview, a counter biller on the biller desk.
 * Neither is special-cased here, and a profile that loses a permission starts
 * somewhere else on its next sign-in without anything in the browser changing.
 */
function Landing() {
  const { session, scope, loading } = useBilling()

  if (!scope) {
    return (
      <Notice tone="info" title="Choose a company">
        Pick the company and financial year to work in, at the top of the page.
      </Notice>
    )
  }
  if (loading || !session) return <p style={{ color: 'var(--muted)' }}>Opening…</p>

  return <Navigate to={session.landing} replace />
}

function Loading() {
  return (
    <div className="billing-skeleton-rows" aria-busy="true" style={{ marginTop: '2rem' }}>
      <span className="billing-sr-only">Loading this screen</span>
      <span className="billing-skeleton billing-skeleton--panel" />
    </div>
  )
}

function Gate() {
  const { scope, session, loading } = useBilling()

  // First use of a company: ask the five questions before drawing a menu that
  // may be wrong for this business.
  if (scope && session && !session.settings.onboarding_done && session.is_owner) {
    return <Onboarding />
  }
  if (scope && loading && !session) {
    return <p style={{ color: 'var(--muted)', padding: '2rem' }}>Opening…</p>
  }

  return <Shell />
}

function Shell() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Landing />} />

        {/* The five dashboards. Each endpoint behind them checks the same
            permission list that decided whether the tab was drawn, so a URL
            typed by hand is refused exactly as the tab was withheld. */}
        <Route
          path="dashboard"
          element={
            <Suspense fallback={<Loading />}>
              <RequireScope><Landing /></RequireScope>
            </Suspense>
          }
        />
        <Route path="dashboard/overview" element={<Suspense fallback={<Loading />}><RequireScope><Overview /></RequireScope></Suspense>} />
        <Route path="dashboard/biller" element={<Suspense fallback={<Loading />}><RequireScope><BillerDesk /></RequireScope></Suspense>} />
        <Route path="dashboard/receivables" element={<Suspense fallback={<Loading />}><RequireScope><Receivables /></RequireScope></Suspense>} />
        <Route path="dashboard/payables" element={<Suspense fallback={<Loading />}><RequireScope><Payables /></RequireScope></Suspense>} />
        <Route path="dashboard/cash-compliance" element={<Suspense fallback={<Loading />}><RequireScope><CashCompliance /></RequireScope></Suspense>} />

        {/* Sales has its own screen. Purchases and the two notes keep the
            shared editor below, which still handles all three. */}
        <Route path="sales">
          <Route index element={<Suspense fallback={<Loading />}><RequireScope><SalesBillPage /></RequireScope></Suspense>} />
          <Route path="new" element={<Suspense fallback={<Loading />}><RequireScope><SalesBillPage /></RequireScope></Suspense>} />
          <Route path=":id" element={<RequireScope><TransactionDetail /></RequireScope>} />
        </Route>

        <Route path="purchases">
          <Route index element={<RequireScope><SaleEditor kind="purchase" /></RequireScope>} />
          <Route path="new" element={<RequireScope><SaleEditor kind="purchase" /></RequireScope>} />
          <Route path=":id" element={<RequireScope><TransactionDetail /></RequireScope>} />
        </Route>

        {/* Money received is the receipt workspace; money paid is the shared
            money screen, in its "out" direction. Both post the same way they
            always did — MoneyScreen still serves direction="in" if this route
            is ever pointed back at it. */}
        <Route path="money-in">
          <Route index element={<Suspense fallback={<Loading />}><RequireScope><MoneyReceived /></RequireScope></Suspense>} />
          <Route path="new" element={<Suspense fallback={<Loading />}><RequireScope><MoneyReceived /></RequireScope></Suspense>} />
          <Route path=":id" element={<RequireScope><TransactionDetail /></RequireScope>} />
        </Route>

        <Route path="money-out">
          <Route index element={<Suspense fallback={<Loading />}><RequireScope><MoneyScreen direction="out" /></RequireScope></Suspense>} />
          <Route path="new" element={<Suspense fallback={<Loading />}><RequireScope><MoneyScreen direction="out" /></RequireScope></Suspense>} />
          <Route path=":id" element={<RequireScope><TransactionDetail /></RequireScope>} />
        </Route>

        <Route path="bank-cash">
          <Route index element={<RequireScope><BankCashOverview /></RequireScope>} />
          <Route path="deposit" element={<RequireScope><BankCash kind="bank_deposit" /></RequireScope>} />
          <Route
            path="withdrawal"
            element={
              <Suspense fallback={<Loading />}>
                <RequireScope><BankWithdrawalPage /></RequireScope>
              </Suspense>
            }
          />
          <Route path="transfer" element={<RequireScope><BankCash kind="bank_transfer" /></RequireScope>} />
          {/* A saved deposit, withdrawal or transfer, by its request id. The three
              names above are static and so still win over this. */}
          <Route path=":id" element={<RequireScope><TransactionDetail /></RequireScope>} />
        </Route>

        {/* The bill-by-bill lists. The dashboards summarise them and link here. */}
        <Route path="receivables" element={<Suspense fallback={<Loading />}><RequireScope><Dues side="receivable" /></RequireScope></Suspense>} />
        <Route path="payables" element={<Suspense fallback={<Loading />}><RequireScope><Dues side="payable" /></RequireScope></Suspense>} />

        <Route path="parties">
          <Route index element={<RequireScope><Parties /></RequireScope>} />
          <Route path=":accountId" element={<RequireScope><PartyStatement /></RequireScope>} />
        </Route>

        <Route
          path="items"
          element={<Suspense fallback={<Loading />}><RequireScope><ItemsPage /></RequireScope></Suspense>}
        />
        <Route path="reports" element={<Suspense fallback={<Loading />}><RequireScope><Reports /></RequireScope></Suspense>} />

        <Route path="more">
          <Route index element={<RequireScope><More /></RequireScope>} />
          <Route path="expense">
            <Route
              index
              element={<Suspense fallback={<Loading />}><RequireScope><ExpensePage /></RequireScope></Suspense>}
            />
            <Route path=":id" element={<RequireScope><TransactionDetail /></RequireScope>} />
          </Route>
          <Route
            path="credit-note"
            element={
              <Suspense fallback={<Loading />}>
                <RequireScope><CreditNotePage /></RequireScope>
              </Suspense>
            }
          />
          <Route path="debit-note" element={<RequireScope><SaleEditor kind="debit_note" /></RequireScope>} />
          <Route path="recurring" element={<RequireScope><Recurring /></RequireScope>} />
          <Route path="unfinished" element={<RequireScope><Unfinished /></RequireScope>} />
          <Route path="profiles" element={<RequireScope><Profiles /></RequireScope>} />
        </Route>

        {/* The portal callback lands here once AuthProvider has consumed the token. */}
        <Route path="auth/callback" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Notice tone="warning">That page does not exist.</Notice>} />
      </Route>
    </Routes>
  )
}

function More() {
  const { can } = useBilling()
  const entries = [
    { path: '/more/credit-note', label: 'Credit note', permission: 'credit_note.create' },
    { path: '/more/debit-note', label: 'Debit note', permission: 'debit_note.create' },
    { path: '/more/expense', label: 'Record an expense', permission: 'expense.create' },
    { path: '/more/recurring', label: 'Recurring bills', permission: 'recurring.manage' },
    { path: '/more/unfinished', label: 'Entries not saved yet', permission: null },
    { path: '/more/profiles', label: 'Who can do what', permission: 'access.manage' },
  ]

  return (
    <div style={{ display: 'grid', gap: '0.5rem', maxWidth: '28rem' }}>
      <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.3rem' }}>Settings</h1>
      {entries
        .filter((entry) => entry.permission === null || can(entry.permission))
        .map((entry) => (
          <a
            key={entry.path}
            href={entry.path}
            style={{
              display: 'block',
              padding: '0.85rem 1rem',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              textDecoration: 'none',
              color: 'var(--fg)',
            }}
          >
            {entry.label}
          </a>
        ))}
    </div>
  )
}

export default function App() {
  const { status } = useAuth()

  if (status === 'signed-out') return <SignIn />

  if (status !== 'authenticated') {
    return (
      <main className="screen">
        <div className="panel">
          <p className="message">Signing you in…</p>
        </div>
      </main>
    )
  }

  return (
    <BillingProvider>
      <BrowserRouter>
        <PageViews />
        <Gate />
      </BrowserRouter>
    </BillingProvider>
  )
}
