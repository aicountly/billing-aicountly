/**
 * Settings — the control centre.
 *
 * It renders INSIDE the existing shell. The sidebar, the company/branch/year
 * pickers, the global search, + New, the bell, the launcher and the profile
 * menu are all the shell's and are untouched here; this page draws no second
 * header and no second logo.
 *
 * Everything on it comes from config/settingsCatalog.ts, filtered by what this
 * Billing profile may reach. A thirteenth category is a line in that file.
 */

import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, CircleHelp } from 'lucide-react'
import { SettingsCategoryCard } from '../../components/settings/SettingsCategoryCard'
import { SettingsHero } from '../../components/settings/SettingsHero'
import { SettingsRail } from '../../components/settings/SettingsRail'
import { SettingsSearch } from '../../components/settings/SettingsSearch'
import { SettingsSetupCard } from '../../components/settings/SettingsSetupCard'
import { visibleCategories, type SettingsAudience } from '../../config/settingsCatalog'
import { useBilling } from '../../context/BillingContext'
import { getAppById, launchApp } from '../../services/appLauncher'
import { Notice } from '../../ui'
import { trackEvent } from '../../utils/analytics'
import '../../styles/billing-settings.css'

export default function SettingsHome() {
  const navigate = useNavigate()
  const location = useLocation()
  const { can, session } = useBilling()

  const audience = useMemo<SettingsAudience>(
    () => ({ can, settings: session?.settings ?? null }),
    [can, session?.settings],
  )
  const categories = useMemo(() => visibleCategories(audience), [audience])

  useEffect(() => {
    trackEvent('billing_settings_opened', { categories: categories.length })
    // Once per visit, not once per re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Back, without walking out of the app. React Router marks the entry the
   * browser opened on as `default`; on that one there is nothing of ours to go
   * back to, so this goes to wherever this profile starts instead.
   */
  function goBack() {
    if (location.key === 'default') {
      navigate(session?.landing ?? '/')
    } else {
      navigate(-1)
    }
  }

  return (
    <div className="billing-settings">
      <header className="billing-settings__header">
        <div className="billing-settings__heading">
          <button type="button" className="billing-settings__back" onClick={goBack} aria-label="Go back">
            <ArrowLeft size={19} aria-hidden />
          </button>
          <div>
            <h1>Settings</h1>
            <p>Manage your business, customise preferences and keep your billing running smoothly.</p>
          </div>
        </div>

        <div className="billing-settings__header-actions">
          <SettingsSearch audience={audience} />
          <button
            type="button"
            className="billing-button billing-button--soft"
            onClick={() => launchApp(getAppById('helpdesk'), { newTab: true })}
          >
            <CircleHelp size={16} aria-hidden />
            Need help?
          </button>
        </div>
      </header>

      <div className="billing-settings__layout">
        <main className="billing-settings__main">
          <SettingsHero />

          {categories.length === 0 ? (
            <Notice tone="info" title="Nothing to change here">
              Your Billing profile does not include any settings. Ask the owner of this company if you need access.
            </Notice>
          ) : (
            <section className="billing-settings__grid" aria-label="Settings categories">
              {categories.map((category) => (
                <SettingsCategoryCard key={category.id} category={category} />
              ))}
            </section>
          )}

          <SettingsSetupCard />
        </main>

        <SettingsRail can={can} />
      </div>
    </div>
  )
}
