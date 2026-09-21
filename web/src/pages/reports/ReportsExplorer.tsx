/**
 * Finding a report: search, two filters, and nine shelves.
 *
 * Every report shown here came from `GET v1/reports`, which returns only what
 * this Billing profile may open. Nothing is added to that list on the way to
 * the screen, so a shelf with nothing on it is a shelf this deployment does not
 * serve — and it says so, rather than being drawn as a card that does nothing
 * when it is pressed.
 *
 * The search runs over the list already in memory. It is a catalogue of ten or
 * so entries, not a dataset: going back to the server for each keystroke would
 * be slower, noisier and no more correct.
 */

import type { RefObject } from 'react'
import { ChevronLeft, ChevronRight, Radio, Search, X } from 'lucide-react'
import {
  CATEGORIES,
  SOURCE_LABELS,
  countByCategory,
  findCategory,
  matches,
  type DecoratedReport,
  type ReportCategoryId,
  type ReportSource,
} from './registry'
import { FavouriteButton, ReportOverflowMenu, type OverflowAction } from './ReportActions'

export interface ExplorerFilters {
  term: string
  category: ReportCategoryId | 'all'
  source: ReportSource | 'all'
  browseAll: boolean
}

export interface ReportItemHandlers {
  onOpen: (key: string) => void
  onCopyLink: (key: string) => void
  onExport: ((key: string) => void) | null
  exportLabel: string
  isFavourite: (key: string) => boolean
  toggleFavourite: (key: string) => void
  showSources: boolean
}

/** The reports left after the search box and the two filters have had their say. */
export function filterReports(reports: DecoratedReport[], filters: ExplorerFilters): DecoratedReport[] {
  return reports.filter((report) => {
    if (filters.category !== 'all' && !report.categories.includes(filters.category)) return false
    if (filters.source !== 'all' && report.source !== filters.source) return false
    return matches(report, filters.term)
  })
}

export function isFiltered(filters: ExplorerFilters): boolean {
  return filters.term.trim() !== '' || filters.category !== 'all' || filters.source !== 'all'
}

export function ReportsExplorer({
  reports,
  loading,
  filters,
  sources,
  searchRef,
  onFiltersChange,
  onClear,
  handlers,
}: {
  reports: DecoratedReport[]
  loading: boolean
  filters: ExplorerFilters
  sources: ReportSource[]
  searchRef: RefObject<HTMLInputElement | null>
  onFiltersChange: (next: Partial<ExplorerFilters>) => void
  onClear: () => void
  handlers: ReportItemHandlers
}) {
  const showingList = isFiltered(filters) || filters.browseAll
  const results = filterReports(reports, filters)
  const openCategory = filters.category === 'all' ? null : findCategory(filters.category)

  return (
    <section className="reports-panel" aria-labelledby="reports-explorer-heading">
      <h2 id="reports-explorer-heading" className="billing-sr-only">
        Find a report
      </h2>

      <div className="reports-toolbar">
        <div className="reports-search">
          <Search size={16} className="reports-search__icon" aria-hidden />
          <input
            ref={searchRef}
            id="reports-search-input"
            type="search"
            value={filters.term}
            placeholder="Search reports e.g. sales, GST, receivables..."
            aria-label="Search reports"
            aria-describedby="reports-search-hint"
            onChange={(event) => onFiltersChange({ term: event.target.value })}
          />
          <span className="reports-search__shortcut" aria-hidden>
            {shortcutHint()}
          </span>
          <span id="reports-search-hint" className="billing-sr-only">
            Press {shortcutHint()} from anywhere on this page to search reports.
          </span>
        </div>

        <select
          className="reports-filter"
          aria-label="Filter by category"
          value={filters.category}
          onChange={(event) =>
            onFiltersChange({ category: event.target.value as ReportCategoryId | 'all', browseAll: false })
          }
        >
          <option value="all">All Categories</option>
          {CATEGORIES.map((category) => (
            <option key={category.id} value={category.id}>
              {category.title}
            </option>
          ))}
        </select>

        <select
          className="reports-filter"
          aria-label="Filter by module"
          value={filters.source}
          onChange={(event) => onFiltersChange({ source: event.target.value as ReportSource | 'all' })}
        >
          <option value="all">All Modules</option>
          {sources.map((source) => (
            <option key={source} value={source}>
              {SOURCE_LABELS[source]}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="billing-button billing-button--small"
          onClick={onClear}
          disabled={!showingList}
        >
          Clear
        </button>
      </div>

      {loading ? (
        <>
          <div className="reports-section-heading">
            <h2>Report Categories</h2>
          </div>
          <div className="reports-skeleton-grid" aria-busy="true">
            <span className="billing-sr-only">Loading the report catalogue</span>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((slot) => (
              <span key={slot} className="billing-skeleton reports-skeleton-card" />
            ))}
          </div>
        </>
      ) : showingList ? (
        <ResultList
          results={results}
          filters={filters}
          openCategory={openCategory}
          onClear={onClear}
          handlers={handlers}
        />
      ) : (
        <>
          <div className="reports-section-heading">
            <div>
              <h2>Report Categories</h2>
              <p>Nine shelves. The count on each is what your profile can open today.</p>
            </div>
          </div>

          <div className="reports-category-grid">
            {CATEGORIES.map((category) => {
              const count = countByCategory(reports, category.id)
              const empty = count === 0

              return (
                <button
                  key={category.id}
                  type="button"
                  className={`reports-category-card${empty ? ' reports-category-card--empty' : ''}`}
                  disabled={empty}
                  aria-pressed={filters.category === category.id}
                  title={empty ? emptyReason(category.servedBy) : undefined}
                  onClick={() => onFiltersChange({ category: category.id, browseAll: false })}
                >
                  <span className={`reports-category-card__icon reports-tone-${category.tone}`} aria-hidden>
                    <category.icon size={19} />
                  </span>

                  <span className="reports-category-card__content">
                    <span className="reports-category-card__title-row">
                      <strong>{category.title}</strong>
                      <span className="reports-count">{count}</span>
                    </span>
                    <span className="reports-category-card__desc">
                      {empty ? emptyReason(category.servedBy) : category.description}
                    </span>
                  </span>

                  {!empty && (
                    <ChevronRight size={18} className="reports-category-card__arrow" aria-hidden />
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

function ResultList({
  results,
  filters,
  openCategory,
  onClear,
  handlers,
}: {
  results: DecoratedReport[]
  filters: ExplorerFilters
  openCategory: ReturnType<typeof findCategory>
  onClear: () => void
  handlers: ReportItemHandlers
}) {
  const heading = openCategory ? openCategory.title : filters.term.trim() ? 'Matching reports' : 'All reports'

  return (
    <>
      <div className="reports-section-heading">
        <div>
          <h2>{heading}</h2>
          <p>
            {results.length === 1 ? '1 report' : `${results.length} reports`}
            {openCategory ? ` · ${openCategory.description}` : ''}
          </p>
        </div>
        <button type="button" className="reports-link-button" onClick={onClear}>
          <ChevronLeft size={14} aria-hidden /> All categories
        </button>
      </div>

      {results.length === 0 ? (
        <div className="reports-empty">
          <span className="reports-empty__title">No reports found</span>
          <p>Try another keyword or clear your filters.</p>
          <span className="reports-empty__actions">
            <button type="button" className="billing-button billing-button--small" onClick={onClear}>
              <X size={14} aria-hidden /> Clear filters
            </button>
          </span>
        </div>
      ) : (
        <ul className="reports-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {results.map((report) => (
            <li key={report.key} className="reports-list-item">
              <span className="reports-list-item__icon" aria-hidden>
                <report.icon size={17} />
              </span>

              <div className="reports-list-item__body">
                <strong>{report.label}</strong>
                {report.description && <p>{report.description}</p>}
                <div className="reports-meta">
                  {report.categories.map((id) => {
                    const category = findCategory(id)
                    if (!category) return null
                    return (
                      <span key={id} className={`reports-tag reports-tag--${category.tone}`}>
                        {category.title}
                      </span>
                    )
                  })}
                  {handlers.showSources && (
                    <span className="reports-source">
                      <Radio size={11} aria-hidden /> Live from {SOURCE_LABELS[report.source]}
                    </span>
                  )}
                </div>
              </div>

              <div className="reports-row-actions">
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
                <ReportOverflowMenu
                  label={report.label}
                  actions={overflowActions(report, handlers)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

export function overflowActions(report: DecoratedReport, handlers: ReportItemHandlers): OverflowAction[] {
  const actions: OverflowAction[] = [
    { key: 'open', label: 'Open report', icon: 'open', onSelect: () => handlers.onOpen(report.key) },
    {
      key: 'favourite',
      label: handlers.isFavourite(report.key) ? 'Remove from favourites' : 'Add to favourites',
      icon: 'star',
      onSelect: () => handlers.toggleFavourite(report.key),
    },
    { key: 'link', label: 'Copy link', icon: 'link', onSelect: () => handlers.onCopyLink(report.key) },
  ]

  // Export only when the profile holds `export.data` AND the period it would
  // cover is named on the menu item. An export of a period the user was never
  // shown is the mistake this product's own export rules exist to prevent.
  const exportReport = handlers.onExport
  if (exportReport) {
    actions.push({
      key: 'export',
      label: `Export CSV · ${handlers.exportLabel}`,
      icon: 'export',
      onSelect: () => exportReport(report.key),
    })
  }

  return actions
}

function emptyReason(servedBy: ReportSource | null): string {
  if (servedBy === 'inventory') return 'Served by Aicountly Inventory. Not offered in Billing yet.'
  if (servedBy === 'books') return 'Served by Smart Books. Not offered in Billing yet.'
  return 'Not available in this deployment yet.'
}

/** Cmd on a Mac, Ctrl everywhere else. Guessing wrong teaches the wrong key. */
export function shortcutHint(): string {
  if (typeof navigator === 'undefined') return 'Ctrl + /'
  const mac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '')
  return mac ? 'Cmd + /' : 'Ctrl + /'
}
