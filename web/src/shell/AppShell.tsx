/**
 * The Billing shell — one shell, every screen.
 *
 * THE MENU COMES FROM THE SERVER. It depends on the Billing profile and on the
 * business mode, and both live in the backend: a menu computed in the browser
 * from a permission list the browser was handed is a menu the browser can edit.
 * The dashboard tabs come from the same place and are checked by the same list
 * the endpoints check, so a screen that is not offered is also a URL that is
 * refused.
 *
 * Below 900px the sidebar becomes a real drawer rather than disappearing. This
 * product is used on a phone behind a counter at least as often as on a desk,
 * and a phone user with no navigation has a one-screen application.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Bell, ChevronDown, LogOut, Menu, Plus, Settings, User } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { AppLauncher } from '../components/AppLauncher'
import { useBilling } from '../context/BillingContext'
import { useApi } from '../hooks/useApi'
import { api } from '../services/api'
import type { Insight, MenuEntry } from '../services/types'
import { Drawer } from './Drawer'
import { GlobalSearch } from './GlobalSearch'
import { ScopeBar } from './ScopeBar'
import '../styles/billing-dashboard.css'

const QUICK_ACTIONS = [
  { label: 'New bill', path: '/sales/new', permission: 'sale.create' },
  { label: 'Money received', path: '/money-in/new', permission: 'receipt.create' },
  { label: 'Add purchase', path: '/purchases/new', permission: 'purchase.create' },
  { label: 'Money paid', path: '/money-out/new', permission: 'payment.create' },
  { label: 'Expense', path: '/more/expense', permission: 'expense.create' },
  { label: 'Bank deposit', path: '/bank-cash/deposit', permission: 'contra.create' },
  { label: 'Bank withdrawal', path: '/bank-cash/withdrawal', permission: 'contra.create' },
  { label: 'Credit note', path: '/more/credit-note', permission: 'credit_note.create' },
] as const

export function AppShell() {
  const { session, scope } = useBilling()
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // A tap on a link inside the drawer should take you there, not leave the
  // drawer sitting over the screen you asked for.
  useEffect(() => setDrawerOpen(false), [location.pathname])

  const menu = session?.menu ?? []

  return (
    <div className="billing-app">
      <a className="billing-skip-link" href="#billing-main">Skip to content</a>

      <aside className="billing-sidebar" aria-label="Sections">
        <Brand />
        <Navigation menu={menu} />
        {session && (
          <div className="billing-sidebar__footer">
            <div style={{ fontWeight: 650, color: 'var(--billing-text)' }}>Simple billing</div>
            <div>for a stronger tomorrow.</div>
            {scope && <div style={{ marginTop: 8 }}>Made for India · Built for your business</div>}
          </div>
        )}
      </aside>

      <div className="billing-workspace">
        <header className="billing-contextbar">
          <button
            type="button"
            className="billing-iconbutton billing-drawer-trigger"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open the menu"
            aria-expanded={drawerOpen}
          >
            <Menu size={19} aria-hidden />
          </button>

          <ScopeBar />
          <GlobalSearch />
          <span className="billing-contextbar__spacer" />

          <div className="billing-contextbar__tools">
            <QuickCreate />
            <Notifications />
            <AppLauncher />
            <UserMenu />
          </div>
        </header>

        <main id="billing-main" className="billing-main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Menu">
        <Brand />
        <Navigation menu={menu} />
      </Drawer>
    </div>
  )
}

/**
 * The product mark.
 *
 * The AICOUNTLY wordmark is set in type exactly as it was before this redesign,
 * and the Billing tile is the icon already shipped in `public/apps`. Nothing
 * here redraws the logo or substitutes a generated one for it.
 */
function Brand() {
  const { session } = useBilling()

  return (
    <NavLink to={session?.landing ?? '/'} className="billing-brand">
      <img src="/apps/billing.png" alt="" className="billing-brand__mark" aria-hidden />
      <span>
        <span className="billing-brand__name">AICOUNTLY</span>
        <span className="billing-brand__product">Billing</span>
      </span>
    </NavLink>
  )
}

function Navigation({ menu }: { menu: MenuEntry[] }) {
  const location = useLocation()

  return (
    <nav aria-label="Sections" style={{ display: 'grid', gap: 2 }}>
      {menu.map((entry) => {
        const children = entry.children ?? []
        // A section expands when you are inside it. Expanding on click as well
        // would mean a section whose own page is one tap away needs two.
        const inside =
          location.pathname === entry.path ||
          children.some((child) => location.pathname.startsWith(child.path)) ||
          (entry.path !== '/' && location.pathname.startsWith(entry.path))

        return (
          <div key={entry.key}>
            <NavLink
              to={entry.path}
              end={entry.path === '/'}
              className="billing-nav__link"
              aria-current={inside ? 'page' : undefined}
            >
              {entry.label}
            </NavLink>
            {inside && children.length > 0 && (
              <div className="billing-nav__children">
                {children.map((child) => (
                  <NavLink
                    key={child.path}
                    to={child.path}
                    className="billing-nav__child"
                    aria-current={location.pathname === child.path ? 'page' : undefined}
                  >
                    {child.label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

function QuickCreate() {
  const navigate = useNavigate()
  const { can } = useBilling()
  const actions = QUICK_ACTIONS.filter((action) => can(action.permission))

  if (actions.length === 0) return null

  return (
    <Popover
      label={
        <span className="billing-button billing-button--primary billing-button--small">
          <Plus size={15} aria-hidden /> New
        </span>
      }
      ariaLabel="Create something"
      asChild
    >
      {(close) =>
        actions.map((action) => (
          <button
            key={action.path}
            type="button"
            className="billing-menu__item"
            onClick={() => {
              close()
              navigate(action.path)
            }}
          >
            {action.label}
          </button>
        ))
      }
    </Popover>
  )
}

/**
 * The bell.
 *
 * It shows the same short list the overview acts on, from the same endpoint,
 * so the count on the bell and the panel on the dashboard cannot disagree. Each
 * entry is already permission-scoped by the server: a biller's bell has nothing
 * in it about supplier dues, because the API never sent any.
 */
function Notifications() {
  const navigate = useNavigate()
  const { scope } = useBilling()

  const insights = useApi(
    (signal) => api.get<{ data: Insight[] }>('v1/insights', undefined, signal),
    [scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    Boolean(scope),
  )

  const rows = insights.data?.data ?? []

  return (
    <Popover
      label={
        <>
          <Bell size={18} aria-hidden />
          {rows.length > 0 && <span className="billing-iconbutton__dot" aria-hidden />}
        </>
      }
      ariaLabel={rows.length > 0 ? `Notifications, ${rows.length} to look at` : 'Notifications'}
    >
      {(close) => (
        <>
          <div className="billing-menu__heading">
            <strong>Worth a look</strong>
          </div>
          {insights.loading && <p className="billing-menu__note">Reading…</p>}
          {!insights.loading && rows.length === 0 && (
            <p className="billing-menu__note">Nothing needs your attention.</p>
          )}
          {rows.map((insight) => (
            <button
              key={insight.kind}
              type="button"
              className="billing-menu__item"
              onClick={() => {
                close()
                navigate(insight.action.path)
              }}
            >
              <span>
                {insight.message}
                <br />
                <span style={{ color: 'var(--billing-action)', fontSize: 12, fontWeight: 650 }}>
                  {insight.action.label}
                </span>
              </span>
            </button>
          ))}
        </>
      )}
    </Popover>
  )
}

function UserMenu() {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const { session, can } = useBilling()

  // Initials only from a real name. The portal does not always send one, and
  // the fallback is a uuid — "7" in an avatar is the first character of an
  // identifier, not a person.
  const named = session?.display_name_known === true
  const name = named ? (session?.display_name as string) : 'Your account'
  const initials = named
    ? name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? '')
        .join('')
    : ''

  return (
    <Popover label={<span className="billing-avatar">{initials || <User size={16} aria-hidden />}</span>} ariaLabel="Your account" asChild>
      {(close) => (
        <>
          <div className="billing-menu__heading">
            <strong>{name}</strong>
            <div style={{ color: 'var(--billing-muted)', fontSize: 12 }}>
              {session?.is_owner ? 'Owner of this company' : 'Billing profile'}
            </div>
          </div>
          {can('settings.manage') && (
            <button
              type="button"
              className="billing-menu__item"
              onClick={() => {
                close()
                navigate('/settings')
              }}
            >
              <Settings size={15} aria-hidden /> Settings
            </button>
          )}
          <button type="button" className="billing-menu__item" onClick={signOut}>
            <LogOut size={15} aria-hidden /> Log out
          </button>
        </>
      )}
    </Popover>
  )
}

/**
 * A small dropdown that closes on Escape, on a click outside, and on choosing
 * something — and returns focus to its trigger, so keyboard users are not
 * dropped at the top of the document.
 */
function Popover({
  label,
  ariaLabel,
  children,
  asChild = false,
}: {
  label: ReactNode
  ariaLabel: string
  children: (close: () => void) => ReactNode
  asChild?: boolean
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return undefined

    function onPointerDown(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div style={{ position: 'relative' }} ref={box}>
      <button
        type="button"
        ref={trigger}
        className={asChild ? 'billing-iconbutton' : 'billing-iconbutton'}
        style={asChild ? { width: 'auto', height: 'auto', padding: 0, border: 0 } : undefined}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        {label}
        {asChild && <ChevronDown size={14} aria-hidden style={{ marginLeft: 2, color: 'var(--billing-muted)' }} />}
      </button>
      {open && (
        <div className="billing-menu" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
