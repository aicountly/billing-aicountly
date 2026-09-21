/**
 * The right-hand rail: intelligence, shortcuts, and the custom-report idea.
 *
 * THE RULE THIS FILE KEEPS. Every control here either does a real thing or
 * says, on itself, that it cannot yet. Nothing invents an answer, nothing
 * pretends a file was built, and nothing accepts a click and quietly drops it.
 *
 *   * "Ask AI about my data" opens AI Pulse — the product already in this
 *     user's AICOUNTLY launcher — through the same single-sign-on jump the
 *     launcher grid uses. No figures are sent anywhere by this screen, and no
 *     insight is generated here.
 *   * "Set Default Reports" opens the preferences this screen genuinely keeps.
 *   * "Report Permissions" goes to Billing profiles, which is where `reports.view`
 *     and `export.data` are actually granted — and only for someone holding
 *     `access.manage`, because that is what the endpoint behind it requires.
 *   * Scheduling, the report builder and export history have no endpoint. They
 *     are drawn switched off, with the reason on them.
 */

import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  CalendarClock,
  FileText,
  History,
  LayoutGrid,
  Lock,
  ShieldCheck,
  Sparkles,
  Star,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { getAppById, launchApp } from '../../services/appLauncher'
import { REPORT_CAPABILITIES, UNAVAILABLE_REASON } from './capabilities'

const AI_APP_ID = 'buddy'

export function ReportsSideRail({
  canManageAccess,
  onOpenSettings,
}: {
  canManageAccess: boolean
  onOpenSettings: () => void
}) {
  return (
    <aside className="reports-side" aria-label="Report tools">
      <SmartReportsCard />
      <QuickActions canManageAccess={canManageAccess} onOpenSettings={onOpenSettings} />
      <CustomReportCta />
    </aside>
  )
}

function SmartReportsCard() {
  const aiApp = getAppById(AI_APP_ID)
  const enabled = REPORT_CAPABILITIES.askAi && Boolean(aiApp)

  return (
    <section className="reports-panel reports-smart" aria-labelledby="reports-smart-heading">
      <div className="reports-smart__art" aria-hidden>
        <span className="reports-smart__doc">
          <FileText size={26} />
        </span>
        <Sparkles size={26} className="reports-smart__spark" />
      </div>

      <h3 id="reports-smart-heading">Smarter Reports. Faster Decisions.</h3>
      <p>
        Analyse, compare and understand your reports faster with intelligent insights.
        {enabled && ' Opens AI Pulse, your AICOUNTLY insights app.'}
      </p>

      <button
        type="button"
        className="billing-button billing-button--primary"
        style={{ width: '100%' }}
        disabled={!enabled}
        title={enabled ? 'Opens AI Pulse in a new tab' : UNAVAILABLE_REASON.askAi}
        onClick={() => {
          if (!enabled) return
          launchApp(aiApp, { newTab: true })
        }}
      >
        Ask AI about my data <ArrowRight size={15} aria-hidden />
      </button>

      {!enabled && (
        <p style={{ margin: '8px 0 0' }}>{UNAVAILABLE_REASON.askAi}</p>
      )}
    </section>
  )
}

interface QuickAction {
  key: string
  label: string
  icon: LucideIcon
  available: boolean
  note?: string
  onSelect?: () => void
}

function QuickActions({
  canManageAccess,
  onOpenSettings,
}: {
  canManageAccess: boolean
  onOpenSettings: () => void
}) {
  const navigate = useNavigate()

  const actions: QuickAction[] = [
    {
      key: 'builder',
      label: 'Custom Report Builder',
      icon: LayoutGrid,
      available: REPORT_CAPABILITIES.builder,
      note: UNAVAILABLE_REASON.builder,
    },
    {
      key: 'schedule',
      label: 'Schedule a Report',
      icon: CalendarClock,
      available: REPORT_CAPABILITIES.schedule,
      note: UNAVAILABLE_REASON.schedule,
    },
    {
      key: 'history',
      label: 'Export History',
      icon: History,
      available: REPORT_CAPABILITIES.exportHistory,
      note: UNAVAILABLE_REASON.exportHistory,
    },
    {
      key: 'defaults',
      label: 'Set Default Reports',
      icon: Star,
      available: true,
      onSelect: onOpenSettings,
    },
  ]

  // Hidden rather than disabled: this one is not missing from the deployment,
  // it is not this person's to do, and the endpoint behind it says so too.
  if (canManageAccess) {
    actions.push({
      key: 'permissions',
      label: 'Report Permissions',
      icon: ShieldCheck,
      available: true,
      onSelect: () => navigate('/more/profiles'),
    })
  }

  return (
    <section className="reports-panel reports-quick" aria-labelledby="reports-quick-heading">
      <h3 id="reports-quick-heading">Quick Actions</h3>

      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          className="reports-quick-action"
          disabled={!action.available}
          title={action.available ? undefined : action.note}
          onClick={action.onSelect}
        >
          <span className="reports-quick-action__mark" aria-hidden>
            {action.available ? <action.icon size={15} /> : <Lock size={14} />}
          </span>
          <span className="reports-quick-action__text">
            <span>{action.label}</span>
            {!action.available && <span className="reports-quick-action__note">Not available yet</span>}
          </span>
        </button>
      ))}
    </section>
  )
}

function CustomReportCta() {
  const enabled = REPORT_CAPABILITIES.builder

  return (
    <section className="reports-panel reports-custom" aria-labelledby="reports-custom-heading">
      <h3 id="reports-custom-heading">Need a custom report?</h3>
      <p>
        Create your own view with filters, columns and charts.
        {!enabled && ' This is not available in Billing yet.'}
      </p>
      <button
        type="button"
        className="billing-button reports-button--custom"
        style={{ width: '100%' }}
        disabled={!enabled}
        title={enabled ? undefined : UNAVAILABLE_REASON.builder}
      >
        + Build Custom Report
      </button>
    </section>
  )
}
