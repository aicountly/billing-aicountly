/**
 * The top of the Reports screen: what this page is, and how much is on it.
 *
 * The four cards count what is actually there — the reports this profile may
 * open, the ones this person has opened, the ones they starred. None of the
 * numbers is written into the markup, which is why three of them are small on
 * a new company and grow as the company is used.
 *
 * The fourth card is not a count. It says the figures are read live, because
 * that is the one thing about this product a user most needs to believe.
 */

import { Activity, ChartColumn, Clock, FileText, Settings2, Star, TrendingUp } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { REPORT_CAPABILITIES, UNAVAILABLE_REASON } from './capabilities'

export function ReportsHeader({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <header className="reports-page__header">
      <div className="reports-page__heading">
        <div className="reports-page__title-row">
          <span className="reports-page__title-icon" aria-hidden>
            <ChartColumn size={23} />
          </span>
          <div>
            <h1>Reports</h1>
            <p>
              <span className="reports-page__strapline-long">
                Get complete insights from your business data. Every report is read live from the
                Aicountly product that owns the figures — Billing keeps no copy of its own.
              </span>
              <span className="reports-page__strapline-short">
                Read live as you open them. Nothing here is a stored copy.
              </span>
            </p>
          </div>
        </div>
      </div>

      <div className="reports-page__header-actions">
        <div className="reports-chip">
          <span className="reports-chip__icon" aria-hidden>
            <TrendingUp size={18} />
          </span>
          <div>
            <strong>Turn data into decisions</strong>
            <span>Reports • Insights • Growth</span>
          </div>
        </div>

        {/* Scheduling has no endpoint behind it. The button stays, so the idea is
            not hidden, but it is plainly switched off and says why rather than
            accepting a click and doing nothing. */}
        <button
          type="button"
          className="billing-button billing-button--small"
          disabled={!REPORT_CAPABILITIES.schedule}
          title={REPORT_CAPABILITIES.schedule ? undefined : UNAVAILABLE_REASON.schedule}
          aria-describedby={REPORT_CAPABILITIES.schedule ? undefined : 'reports-schedule-note'}
        >
          <Clock size={15} aria-hidden /> Schedule Reports
        </button>
        {!REPORT_CAPABILITIES.schedule && (
          <span id="reports-schedule-note" className="billing-sr-only">
            {UNAVAILABLE_REASON.schedule}
          </span>
        )}

        <button type="button" className="billing-button billing-button--small" onClick={onOpenSettings}>
          <Settings2 size={15} aria-hidden /> Report Settings
        </button>
      </div>
    </header>
  )
}

interface SummaryCard {
  key: string
  icon: LucideIcon
  tone: 'blue' | 'purple' | 'orange' | 'cyan'
  value: string
  isText?: boolean
  label: string
  hint: string
}

export function ReportsSummaryCards({
  available,
  recent,
  favourites,
  loading,
}: {
  available: number
  recent: number
  favourites: number
  loading: boolean
}) {
  if (loading) {
    return (
      <div className="reports-kpis" aria-busy="true">
        <span className="billing-sr-only">Counting the reports available to you</span>
        {[0, 1, 2, 3].map((slot) => (
          <span key={slot} className="billing-skeleton reports-skeleton-kpi" />
        ))}
      </div>
    )
  }

  const cards: SummaryCard[] = [
    {
      key: 'available',
      icon: FileText,
      tone: 'blue',
      value: String(available),
      label: 'Reports Available',
      hint: 'Your Billing profile can open these',
    },
    {
      key: 'recent',
      icon: Clock,
      tone: 'purple',
      value: String(recent),
      label: 'Recently Viewed',
      hint: 'Quick access',
    },
    {
      key: 'favourites',
      icon: Star,
      tone: 'orange',
      value: String(favourites),
      label: 'Favourite Reports',
      hint: 'Your shortcuts',
    },
    {
      key: 'live',
      icon: Activity,
      tone: 'cyan',
      value: 'Real-time',
      isText: true,
      label: 'Live from Aicountly',
      hint: 'Always up-to-date',
    },
  ]

  return (
    <div className="reports-kpis">
      {cards.map((card) => (
        <article key={card.key} className={`reports-kpi reports-kpi--${card.tone}`}>
          <span className="reports-kpi__icon" aria-hidden>
            <card.icon size={21} />
          </span>
          <div className="reports-kpi__body">
            <strong className={`reports-kpi__value${card.isText ? ' reports-kpi__value--text' : ''}`}>
              {card.value}
            </strong>
            <span className="reports-kpi__label">{card.label}</span>
            <small className="reports-kpi__hint">{card.hint}</small>
          </div>
        </article>
      ))}
    </div>
  )
}
