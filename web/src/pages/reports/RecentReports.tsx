/**
 * What this person opened last, and what they starred.
 *
 * Both lists are report KEYS and, for the recent one, a timestamp. The name,
 * the shelf and the owning product on every row are read from the live
 * catalogue on this render — so a report that was renamed shows its new name,
 * and a report this profile has since lost access to simply is not listed,
 * because it is no longer in the catalogue the server sent.
 *
 * Nothing a report SAID is remembered. Not a row, not a total, not a party.
 */

import { ArrowRight, Radio } from 'lucide-react'
import { relativeTime, type RecentEntry } from './preferences'
import { findCategory, SOURCE_LABELS, type DecoratedReport } from './registry'
import { FavouriteButton, ReportOverflowMenu } from './ReportActions'
import { overflowActions, type ReportItemHandlers } from './ReportsExplorer'

export type RecentTab = 'recent' | 'favourites'

export function RecentReports({
  reports,
  recent,
  favourites,
  tab,
  loading,
  onTabChange,
  onViewAll,
  handlers,
}: {
  reports: DecoratedReport[]
  recent: RecentEntry[]
  favourites: string[]
  tab: RecentTab
  loading: boolean
  onTabChange: (tab: RecentTab) => void
  onViewAll: () => void
  handlers: ReportItemHandlers
}) {
  const byKey = new Map(reports.map((report) => [report.key, report]))

  // A key with nothing behind it in the catalogue is dropped rather than drawn
  // as a row that cannot be opened.
  const rows: Array<{ report: DecoratedReport; at: string | null }> =
    tab === 'recent'
      ? recent
          .map((entry) => ({ report: byKey.get(entry.key), at: entry.at }))
          .filter((row): row is { report: DecoratedReport; at: string } => Boolean(row.report))
      : favourites
          .map((key) => ({ report: byKey.get(key), at: null }))
          .filter((row): row is { report: DecoratedReport; at: null } => Boolean(row.report))

  return (
    <section className="reports-panel" aria-labelledby="reports-recent-heading">
      <div className="reports-section-heading" style={{ marginTop: 2 }}>
        <div>
          <h2 id="reports-recent-heading">{tab === 'recent' ? 'Recent Reports' : 'Favourite Reports'}</h2>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div className="billing-segmented" role="group" aria-label="Which list to show">
            <button
              type="button"
              className="billing-segmented__option"
              aria-pressed={tab === 'recent'}
              onClick={() => onTabChange('recent')}
            >
              Recent
            </button>
            <button
              type="button"
              className="billing-segmented__option"
              aria-pressed={tab === 'favourites'}
              onClick={() => onTabChange('favourites')}
            >
              Favourites
            </button>
          </div>

          <button type="button" className="reports-link-button" onClick={onViewAll}>
            View All <ArrowRight size={14} aria-hidden />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="billing-skeleton-rows" aria-busy="true">
          <span className="billing-sr-only">Loading your reports</span>
          {[0, 1, 2, 3].map((slot) => (
            <span key={slot} className="billing-skeleton reports-skeleton-row" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyList tab={tab} onViewAll={onViewAll} />
      ) : (
        <div className="reports-table-wrapper">
          <table className="reports-table">
            <caption className="billing-sr-only">
              {tab === 'recent'
                ? 'Reports you opened recently, most recent first'
                : 'Reports you have starred'}
            </caption>
            <thead>
              <tr>
                <th scope="col">Report Name</th>
                <th scope="col">Category</th>
                <th scope="col">{tab === 'recent' ? 'Last Viewed' : 'Source'}</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ report, at }) => {
                const category = findCategory(report.categories[0] ?? '')

                return (
                  <tr key={report.key}>
                    <td data-label="Report">
                      <span className="reports-name">
                        <report.icon size={15} className="reports-name__icon" aria-hidden />
                        <span className="reports-name__text">{report.label}</span>
                      </span>
                      {handlers.showSources && (
                        <span className="reports-source" style={{ marginTop: 4 }}>
                          <Radio size={11} aria-hidden /> Live from {SOURCE_LABELS[report.source]}
                        </span>
                      )}
                    </td>

                    <td data-label="Category">
                      {category ? (
                        <span className={`reports-tag reports-tag--${category.tone}`}>{category.title}</span>
                      ) : (
                        '—'
                      )}
                    </td>

                    <td data-label={tab === 'recent' ? 'Last viewed' : 'Source'}>
                      {tab === 'recent' ? relativeTime(at ?? '') : SOURCE_LABELS[report.source]}
                    </td>

                    <td data-label="Actions">
                      <span className="reports-row-actions">
                        <button
                          type="button"
                          className="reports-open-btn"
                          onClick={() => handlers.onOpen(report.key)}
                        >
                          Open
                        </button>
                        <FavouriteButton
                          on={handlers.isFavourite(report.key)}
                          label={report.label}
                          onToggle={() => handlers.toggleFavourite(report.key)}
                        />
                        <ReportOverflowMenu label={report.label} actions={overflowActions(report, handlers)} />
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function EmptyList({ tab, onViewAll }: { tab: RecentTab; onViewAll: () => void }) {
  return (
    <div className="reports-empty">
      <span className="reports-empty__title">
        {tab === 'recent' ? 'No reports opened yet' : 'No favourite reports yet'}
      </span>
      <p>
        {tab === 'recent'
          ? 'Reports you open will appear here for quick access.'
          : 'Star the reports you use often and they will be one click away.'}
      </p>
      <span className="reports-empty__actions">
        <button type="button" className="billing-button billing-button--small" onClick={onViewAll}>
          Browse all reports
        </button>
      </span>
    </div>
  )
}
