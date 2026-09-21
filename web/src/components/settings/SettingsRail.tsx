/**
 * The contextual column beside the settings grid.
 *
 * Three small panels: the six things people come here to do, how to reach a
 * human, and where to read more. Every row goes somewhere real — a quick
 * action a profile may not use is not drawn at all, and a destination this
 * deployment does not host is drawn as plainly unavailable rather than as a
 * link that goes nowhere.
 *
 * On a tablet it becomes three columns under the grid, and on a phone three
 * ordinary stacked cards. It is never a fixed rail on a narrow screen.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Banknote,
  BookOpen,
  ChevronRight,
  CirclePlay,
  ExternalLink,
  FileText,
  Headphones,
  Landmark,
  Percent,
  Sparkles,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { getAppById, launchApp } from '../../services/appLauncher'
import { settingsPath } from '../../config/settingsCatalog'
import { trackEvent } from '../../utils/analytics'
import { SettingsDialog } from './SettingsDialog'

interface QuickAction {
  key: string
  label: string
  to: string
  icon: LucideIcon
  permission?: string
}

const QUICK_ACTIONS: QuickAction[] = [
  { key: 'company', label: 'Update company profile', to: settingsPath('company'), icon: Landmark },
  { key: 'documents', label: 'Set up invoice format', to: settingsPath('documents'), icon: FileText },
  { key: 'users', label: 'Manage users', to: settingsPath('users'), icon: Users, permission: 'access.manage' },
  { key: 'payments', label: 'Connect bank account', to: settingsPath('payments'), icon: Banknote },
  { key: 'taxes', label: 'Configure GST', to: settingsPath('taxes'), icon: Percent },
  {
    key: 'automation',
    label: 'Set payment reminders',
    to: settingsPath('automation'),
    icon: Zap,
    permission: 'recurring.manage',
  },
]

export function SettingsRail({ can }: { can: (permission: string) => boolean }) {
  const [whatsNew, setWhatsNew] = useState(false)
  const actions = QUICK_ACTIONS.filter((action) => !action.permission || can(action.permission))

  return (
    <aside className="billing-settings__rail" aria-label="Settings shortcuts">
      {actions.length > 0 && (
        <section className="billing-settings__panel">
          <h3>
            <Zap size={15} aria-hidden style={{ color: 'var(--billing-action)' }} />
            Quick actions
          </h3>
          {actions.map((action) => {
            const Icon = action.icon
            return (
              <Link
                key={action.key}
                to={action.to}
                className="billing-settings__rail-link"
                onClick={() => trackEvent('billing_settings_quick_action_clicked', { action: action.key })}
              >
                <span>
                  <Icon size={15} aria-hidden style={{ color: 'var(--billing-muted)' }} />
                  {action.label}
                </span>
                <ChevronRight size={15} aria-hidden />
              </Link>
            )
          })}
        </section>
      )}

      <section className="billing-settings__support">
        <div className="billing-settings__support-mark">
          <Headphones size={22} aria-hidden />
        </div>
        <h3>Need help with settings?</h3>
        <p>Our support team is here to help you get started.</p>
        <button
          type="button"
          className="billing-button billing-button--soft"
          style={{ width: '100%', justifyContent: 'center' }}
          onClick={() => launchApp(getAppById('helpdesk'), { newTab: true })}
        >
          Contact support
          <ExternalLink size={14} aria-hidden />
        </button>
      </section>

      <section className="billing-settings__panel">
        <h3>Explore more</h3>

        <button
          type="button"
          className="billing-settings__rail-link"
          onClick={() => launchApp(getAppById('helpdesk'), { newTab: true })}
        >
          <span>
            <BookOpen size={15} aria-hidden style={{ color: 'var(--billing-muted)' }} />
            Help centre
          </span>
          <ExternalLink size={14} aria-hidden />
        </button>

        {/* Two destinations this deployment does not host. They are shown so
            the section is not a lie by omission, and disabled so they are not
            a lie by link. */}
        <span
          className="billing-settings__rail-link"
          aria-disabled="true"
          style={{ cursor: 'default', opacity: 0.55 }}
        >
          <span>
            <BookOpen size={15} aria-hidden style={{ color: 'var(--billing-muted)' }} />
            User guides
          </span>
          <small style={{ fontSize: 11 }}>Not published yet</small>
        </span>

        <span
          className="billing-settings__rail-link"
          aria-disabled="true"
          style={{ cursor: 'default', opacity: 0.55 }}
        >
          <span>
            <CirclePlay size={15} aria-hidden style={{ color: 'var(--billing-muted)' }} />
            Video tutorials
          </span>
          <small style={{ fontSize: 11 }}>Not published yet</small>
        </span>

        <button type="button" className="billing-settings__rail-link" onClick={() => setWhatsNew(true)}>
          <span>
            <Sparkles size={15} aria-hidden style={{ color: 'var(--billing-muted)' }} />
            What’s new in Settings
          </span>
          <ChevronRight size={15} aria-hidden />
        </button>
      </section>

      {whatsNew && (
        <SettingsDialog
          title="What’s new in Settings"
          description="Settings is now a hub rather than a list. Nothing that was here before has gone."
          onClose={() => setWhatsNew(false)}
          actions={
            <button type="button" className="billing-button billing-button--primary" onClick={() => setWhatsNew(false)}>
              Got it
            </button>
          }
        >
          <ul style={{ margin: '14px 0 0', paddingLeft: '1.1rem', color: 'var(--billing-muted)', fontSize: 13, lineHeight: 1.65 }}>
            <li>Twelve categories, each opening a page that explains what it controls.</li>
            <li>A search that covers every setting and every keyword — press Ctrl&nbsp;K.</li>
            <li>
              A setup checklist worked out from your actual configuration, read live from Manage, Smart Books and
              Billing. It is never a fixed number.
            </li>
            <li>
              Credit note, debit note, expense, recurring bills, unsaved entries and “who can do what” all moved into
              the category they belong to. Their old links still work.
            </li>
            <li>
              Anything another AICOUNTLY product owns — your company, your items, your ledgers — is labelled and opens
              there. Billing keeps no second copy of it.
            </li>
          </ul>
        </SettingsDialog>
      )}
    </aside>
  )
}
