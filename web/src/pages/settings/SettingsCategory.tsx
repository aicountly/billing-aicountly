/**
 * One settings category.
 *
 * The same config that draws the hub draws this page: the rail on the left is
 * every category this profile may reach, the panels in the middle are the
 * settings that actually change something, and the list underneath is
 * everything else the category covers — each row saying plainly whether it
 * lives here, in another AICOUNTLY product, or nowhere yet.
 *
 * A category id that does not exist, or one this profile may not open, is
 * answered on this page rather than by a blank screen.
 */

import { useEffect, useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronRight, ExternalLink } from 'lucide-react'
import {
  categoryVisible,
  childVisible,
  findCategory,
  visibleCategories,
  type SettingsAudience,
  type SettingsChild,
} from '../../config/settingsCatalog'
import { useBilling } from '../../context/BillingContext'
import { getAppById, launchApp } from '../../services/appLauncher'
import { Notice } from '../../ui'
import { trackEvent } from '../../utils/analytics'
import { appDisplayName, panelsCoverEverything, panelsFor } from './panels'
import '../../styles/billing-settings.css'

export default function SettingsCategory() {
  const { categoryId } = useParams<{ categoryId: string }>()
  const navigate = useNavigate()
  const { can, session } = useBilling()

  const audience = useMemo<SettingsAudience>(
    () => ({ can, settings: session?.settings ?? null }),
    [can, session?.settings],
  )

  const category = findCategory(categoryId)
  const allowed = category !== null && categoryVisible(category, audience)
  const rail = useMemo(() => visibleCategories(audience), [audience])

  useEffect(() => {
    if (allowed && category) trackEvent('billing_settings_category_opened', { category: category.id })
  }, [allowed, category])

  if (!category) {
    return (
      <div className="billing-settings">
        <Notice tone="warning" title="That settings page does not exist">
          <Link to="/settings">Go back to Settings</Link>
        </Notice>
      </div>
    )
  }

  if (!allowed) {
    return (
      <div className="billing-settings">
        <Notice tone="info" title={`${category.title} is not part of your Billing profile`}>
          Ask the owner of this company if you need it. <Link to="/settings">Back to Settings</Link>
        </Notice>
      </div>
    )
  }

  const Icon = category.icon
  const children = category.children.filter((child) => childVisible(child, audience))

  return (
    <div className="billing-settings">
      <nav className="billing-settings__crumbs" aria-label="Breadcrumb">
        <Link to="/settings">Settings</Link>
        <ChevronRight size={13} aria-hidden />
        <span aria-current="page">{category.title}</span>
      </nav>

      <header className="billing-settings__detail-head">
        <button
          type="button"
          className="billing-settings__back"
          onClick={() => navigate('/settings')}
          aria-label="Back to Settings"
        >
          <ArrowLeft size={19} aria-hidden />
        </button>

        <span className={`billing-settings__icon billing-settings__icon--${category.accent}`} aria-hidden>
          <Icon size={24} strokeWidth={1.9} />
        </span>

        <div style={{ minWidth: 0 }}>
          <h1>{category.title}</h1>
          <p>{category.description}</p>
        </div>
      </header>

      <div className="billing-settings__detail">
        <nav className="billing-settings__nav" aria-label="Settings categories">
          {rail.map((entry) => {
            const EntryIcon = entry.icon
            return (
              <Link
                key={entry.id}
                to={entry.path}
                className="billing-settings__nav-link"
                aria-current={entry.id === category.id ? 'page' : undefined}
              >
                <EntryIcon size={15} aria-hidden />
                {entry.title}
              </Link>
            )
          })}
        </nav>

        <div className="billing-settings__sections">
          {panelsFor(category.id)}

          {!panelsCoverEverything(category.id) && (
            <section className="billing-settings__section">
              <h2>Everything in {category.title}</h2>
              <p>
                What each of these controls, and where it is decided. Billing keeps no copy of anything another
                AICOUNTLY product owns.
              </p>

              <div className="billing-settings__rows">
                {children.map((child) => (
                  <ChildRow key={child.key} child={child} categoryPath={category.path} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

function ChildRow({ child, categoryPath }: { child: SettingsChild; categoryPath: string }) {
  const body = (
    <span style={{ minWidth: 0 }}>
      <strong>{child.label}</strong>
      <p>{child.description}</p>
    </span>
  )

  if (child.state === 'elsewhere') {
    const app = getAppById(child.app ?? '')
    return (
      <button
        type="button"
        className="billing-settings__row"
        onClick={() => launchApp(app, { newTab: true })}
        disabled={!app}
      >
        {body}
        <span className="billing-settings__row-end">
          <span className="billing-settings__tag billing-settings__tag--elsewhere">
            {appDisplayName(child.app ?? '') ?? 'Another app'}
          </span>
          <ExternalLink size={15} aria-hidden style={{ color: 'var(--billing-muted)' }} />
        </span>
      </button>
    )
  }

  if (child.state === 'planned') {
    return (
      <div className="billing-settings__row billing-settings__row--planned">
        {body}
        <span className="billing-settings__row-end">
          <span className="billing-settings__tag billing-settings__tag--planned">Not available</span>
        </span>
      </div>
    )
  }

  // Ready, and set on this very page: the panel above IS the control, so the
  // row states that rather than linking to the page you are already on.
  if (!child.to || child.to === categoryPath) {
    return (
      <div className="billing-settings__row">
        {body}
        <span className="billing-settings__row-end">
          <span className="billing-settings__tag billing-settings__tag--ok">On this page</span>
        </span>
      </div>
    )
  }

  return (
    <Link to={child.to} className="billing-settings__row">
      {body}
      <span className="billing-settings__row-end">
        <ChevronRight size={16} aria-hidden style={{ color: 'var(--billing-muted)' }} />
      </span>
    </Link>
  )
}
