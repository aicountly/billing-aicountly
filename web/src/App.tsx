import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import { BillingProvider, useBilling } from './context/BillingContext'
import { AppShell } from './shell/AppShell'
import SignIn from './pages/SignIn'
import Home from './pages/Home'
import Onboarding from './pages/Onboarding'
import SaleEditor from './pages/SaleEditor'
import { DuesScreen, PartyStatement } from './pages/Dues'
import { BankCash, MoneyScreen } from './pages/MoneyMovement'
import {
  BankCashOverview,
  Expense,
  Profiles,
  Recurring,
  TransactionDetail,
  Unfinished,
} from './pages/Misc'
import { Notice } from './ui'
import { initAnalytics, trackPageView } from './utils/analytics'
import './App.css'

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
        <Route index element={<RequireScope><Home /></RequireScope>} />

        <Route path="sales">
          <Route index element={<RequireScope><SaleEditor /></RequireScope>} />
          <Route path="new" element={<RequireScope><SaleEditor /></RequireScope>} />
          <Route path=":id" element={<RequireScope><TransactionDetail /></RequireScope>} />
        </Route>

        <Route path="purchases">
          <Route index element={<RequireScope><SaleEditor kind="purchase" /></RequireScope>} />
          <Route path="new" element={<RequireScope><SaleEditor kind="purchase" /></RequireScope>} />
          <Route path=":id" element={<RequireScope><TransactionDetail /></RequireScope>} />
        </Route>

        <Route path="money-in">
          <Route index element={<RequireScope><MoneyScreen direction="in" /></RequireScope>} />
          <Route path="new" element={<RequireScope><MoneyScreen direction="in" /></RequireScope>} />
          <Route path=":id" element={<RequireScope><TransactionDetail /></RequireScope>} />
        </Route>

        <Route path="money-out">
          <Route index element={<RequireScope><MoneyScreen direction="out" /></RequireScope>} />
          <Route path="new" element={<RequireScope><MoneyScreen direction="out" /></RequireScope>} />
          <Route path=":id" element={<RequireScope><TransactionDetail /></RequireScope>} />
        </Route>

        <Route path="bank-cash">
          <Route index element={<RequireScope><BankCashOverview /></RequireScope>} />
          <Route path="deposit" element={<RequireScope><BankCash kind="bank_deposit" /></RequireScope>} />
          <Route path="withdrawal" element={<RequireScope><BankCash kind="bank_withdrawal" /></RequireScope>} />
          <Route path="transfer" element={<RequireScope><BankCash kind="bank_transfer" /></RequireScope>} />
        </Route>

        <Route path="receivables" element={<RequireScope><DuesScreen side="receivable" /></RequireScope>} />
        <Route path="payables" element={<RequireScope><DuesScreen side="payable" /></RequireScope>} />
        <Route path="parties/:accountId" element={<RequireScope><PartyStatement /></RequireScope>} />

        <Route path="more">
          <Route index element={<RequireScope><More /></RequireScope>} />
          <Route path="expense" element={<RequireScope><Expense /></RequireScope>} />
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
    { path: '/more/expense', label: 'Record an expense', permission: 'expense.create' },
    { path: '/more/recurring', label: 'Recurring bills', permission: 'recurring.manage' },
    { path: '/more/unfinished', label: 'Entries not saved yet', permission: null },
    { path: '/more/profiles', label: 'Who can do what', permission: 'access.manage' },
  ]

  return (
    <div style={{ display: 'grid', gap: '0.5rem', maxWidth: '28rem' }}>
      <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.3rem' }}>More</h1>
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
