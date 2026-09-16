import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { LogOut, Plus } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { AppLauncher } from '../components/AppLauncher'
import { useBilling } from '../context/BillingContext'
import { CompanyPicker } from './CompanyPicker'
import { Button } from '../ui'

/**
 * The Billing shell.
 *
 * THE MENU COMES FROM THE SERVER. It depends on the Billing profile and on the
 * business mode, and both live in the backend — a menu computed in the browser
 * from a permission list the browser was handed is a menu the browser can edit.
 *
 * The layout is mobile-first because this product is used on a phone behind a
 * counter at least as often as on a desktop: a bottom bar under 48rem, a sidebar
 * above it, and a + NEW that is never more than one tap away.
 */

const QUICK_ACTIONS = [
  { label: 'Sale', path: '/sales/new', permission: 'sale.create' },
  { label: 'Money received', path: '/money-in/new', permission: 'receipt.create' },
  { label: 'Purchase', path: '/purchases/new', permission: 'purchase.create' },
  { label: 'Money paid', path: '/money-out/new', permission: 'payment.create' },
  { label: 'Expense', path: '/more/expense', permission: 'expense.create' },
  { label: 'Bank deposit', path: '/bank-cash/deposit', permission: 'contra.create' },
  { label: 'Bank withdrawal', path: '/bank-cash/withdrawal', permission: 'contra.create' },
  { label: 'Credit note', path: '/more/credit-note', permission: 'credit_note.create' },
] as const

export function AppShell() {
  const { signOut } = useAuth()
  const { session, can, scope } = useBilling()
  const navigate = useNavigate()
  const [quickOpen, setQuickOpen] = useState(false)

  const menu = session?.menu ?? []
  const actions = QUICK_ACTIONS.filter((action) => can(action.permission))

  return (
    <div style={{ display: 'flex', minHeight: '100vh', flexDirection: 'column' }}>
      <header
        style={{
          height: 'var(--header-h)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 1rem',
          gap: '1rem',
          background: 'var(--surface)',
          position: 'sticky',
          top: 0,
          zIndex: 30,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0 }}>
          <div style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
            AICOUNTLY <span style={{ color: 'var(--muted)', fontWeight: 400 }}>Billing</span>
          </div>
          <CompanyPicker />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {actions.length > 0 && (
            <div style={{ position: 'relative' }}>
              <Button tone="primary" onClick={() => setQuickOpen(!quickOpen)}>
                <Plus size={15} aria-hidden /> New
              </Button>
              {quickOpen && (
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: '100%',
                    marginTop: '0.3rem',
                    background: 'var(--surface)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: 'var(--radius-sm)',
                    boxShadow: 'var(--shadow-lg)',
                    minWidth: '13rem',
                    zIndex: 40,
                  }}
                >
                  {actions.map((action) => (
                    <button
                      key={action.path}
                      type="button"
                      onClick={() => {
                        setQuickOpen(false)
                        navigate(action.path)
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '0.55rem 0.8rem',
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <AppLauncher />
          <button
            type="button"
            onClick={signOut}
            title="Log out"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: '0.3rem' }}
          >
            <LogOut size={16} aria-hidden />
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <aside
          className="billing-sidebar"
          style={{
            width: 'var(--sidebar-w)',
            flexShrink: 0,
            borderRight: '1px solid var(--border)',
            background: 'var(--surface-2)',
            padding: '0.5rem',
            overflowY: 'auto',
          }}
        >
          {menu.map((entry) => (
            <NavLink
              key={entry.key}
              to={entry.path}
              end={entry.path === '/'}
              style={({ isActive }) => ({
                display: 'block',
                padding: '0.55rem 0.7rem',
                marginBottom: '0.15rem',
                borderRadius: 'var(--radius-sm)',
                color: isActive ? 'var(--fg)' : 'var(--muted)',
                background: isActive ? 'var(--surface)' : 'transparent',
                fontWeight: isActive ? 600 : 400,
                textDecoration: 'none',
              })}
            >
              {entry.label}
            </NavLink>
          ))}
          {session && (
            <div style={{ marginTop: '1rem', padding: '0.6rem 0.7rem', borderTop: '1px solid var(--border)', fontSize: '0.8rem', color: 'var(--muted)' }}>
              {session.display_name}
              {session.is_owner && <div>Owner</div>}
              {scope && <div className="num">Company {scope.cmp_id} · FY {scope.fy_id}</div>}
            </div>
          )}
        </aside>

        <main style={{ flex: 1, minWidth: 0, padding: '1rem', paddingBottom: '5rem' }}>
          <Outlet />
        </main>
      </div>

      {/* Bottom bar for phones. The five things a shopkeeper taps most. */}
      <nav className="billing-bottombar">
        {menu.slice(0, 5).map((entry) => (
          <NavLink
            key={entry.key}
            to={entry.path}
            end={entry.path === '/'}
            style={({ isActive }) => ({
              flex: 1,
              textAlign: 'center',
              padding: '0.6rem 0.2rem',
              fontSize: '0.75rem',
              color: isActive ? 'var(--fg)' : 'var(--muted)',
              fontWeight: isActive ? 600 : 400,
              textDecoration: 'none',
            })}
          >
            {entry.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
