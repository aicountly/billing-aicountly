/**
 * Reports — the discovery screen.
 *
 * This is the front of the reporting product: what exists, what you opened
 * last, what you starred, and a way to find the rest. It is the only screen in
 * Billing that reads NOTHING but metadata — the catalogue of reports this
 * profile may open, and this browser's own shortcuts. Not one figure out of a
 * report is fetched here, because nobody has asked for a report yet.
 *
 * Opening one navigates to `/reports/:reportKey`, where the report is read from
 * its owner and drawn. That split is the point: discovery is cheap and instant,
 * and the expensive live read happens when — and only when — it was asked for.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../services/api'
import { useApi } from '../../hooks/useApi'
import { useBilling } from '../../context/BillingContext'
import { Notice } from '../../ui'
import { PERIOD_OPTIONS } from '../../dashboards/DashboardLayout'
import { ReportsHeader, ReportsSummaryCards } from './ReportsHeader'
import { ReportsExplorer, type ExplorerFilters, type ReportItemHandlers } from './ReportsExplorer'
import { RecentReports, type RecentTab } from './RecentReports'
import { ReportsSideRail } from './ReportsSideRail'
import { ReportSettingsDrawer } from './ReportSettingsDrawer'
import { useReportPreferences, readPreferences } from './preferences'
import {
  CATEGORIES,
  countByCategory,
  decorateAll,
  sourcesIn,
  type ReportCategoryId,
  type ReportSummary,
} from './registry'
import '../../styles/reports.css'

interface CatalogueResponse {
  reports: ReportSummary[]
  note: string
}

interface PageNotice {
  tone: 'info' | 'success' | 'warning' | 'danger'
  title: string
  text: string
}

/**
 * The company, branch and year this screen belongs to.
 *
 * It is the component's key, so switching any of the three throws the screen
 * away and builds a new one. Nothing from the previous company — not a
 * catalogue, not a filter, not a shortcut list — can survive that, which is a
 * stronger guarantee than remembering to clear each piece of state by hand.
 */
export default function Reports() {
  const { scope } = useBilling()
  const key = scope ? `${scope.cmp_id}:${scope.fy_id}:${scope.bo_id}` : 'none'

  return <ReportsLanding key={key} />
}

function ReportsLanding() {
  const navigate = useNavigate()
  const { scope, can } = useBilling()
  const prefs = useReportPreferences(scope?.cmp_id)

  const searchRef = useRef<HTMLInputElement | null>(null)
  const [notice, setNotice] = useState<PageNotice | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tab, setTab] = useState<RecentTab>('recent')

  const [filters, setFilters] = useState<ExplorerFilters>(() => {
    const stored = readPreferences(scope?.cmp_id).lastCategory
    const known = CATEGORIES.some((category) => category.id === stored)
    return {
      term: '',
      category: known ? (stored as ReportCategoryId) : 'all',
      source: 'all',
      browseAll: false,
    }
  })

  // The catalogue. Metadata only, and permission-filtered by the server: what
  // comes back is exactly what this profile may open.
  const list = useApi(
    (signal) => api.one<CatalogueResponse>('v1/reports', undefined, signal),
    [scope?.cmp_id, scope?.fy_id],
    Boolean(scope),
  )

  const reports = useMemo(() => decorateAll(list.data?.data.reports ?? []), [list.data])
  const sources = useMemo(() => sourcesIn(reports), [reports])

  // A shelf remembered from last time that this profile can no longer fill
  // would open on an empty list and look like a fault. Fall back to all.
  useEffect(() => {
    if (list.loading || filters.category === 'all') return
    if (countByCategory(reports, filters.category) === 0) {
      setFilters((current) => ({ ...current, category: 'all' }))
      prefs.setLastCategory(null)
    }
  }, [list.loading, reports, filters.category, prefs])

  // Ctrl + / (Cmd + / on a Mac) puts the cursor in the report search from
  // anywhere on the page. It is claimed only while this screen is mounted.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '/' || !(event.ctrlKey || event.metaKey) || event.altKey) return
      event.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const changeFilters = useCallback(
    (next: Partial<ExplorerFilters>) => {
      // The preference is written outside the state updater on purpose: an
      // updater must be pure, and React is free to run it more than once.
      if (next.category !== undefined) {
        prefs.setLastCategory(next.category === 'all' ? null : next.category)
      }
      setFilters((current) => ({ ...current, ...next }))
    },
    [prefs],
  )

  const clearFilters = useCallback(() => {
    setFilters({ term: '', category: 'all', source: 'all', browseAll: false })
    prefs.setLastCategory(null)
  }, [prefs])

  const openReport = useCallback(
    (reportKey: string) => {
      // The visit is recorded by the report screen itself, once it is actually
      // open. Recording it here would list reports that were never drawn.
      navigate(`/reports/${reportKey}`)
    },
    [navigate],
  )

  const copyLink = useCallback(async (reportKey: string) => {
    const url = `${window.location.origin}/reports/${reportKey}`
    try {
      await navigator.clipboard.writeText(url)
      setNotice({ tone: 'success', title: 'Link copied', text: url })
    } catch {
      // Clipboard access can be refused outright. Showing the link is still
      // useful: it can be copied out of the message by hand.
      setNotice({ tone: 'warning', title: 'Could not copy the link', text: url })
    }
  }, [])

  const periodLabel =
    PERIOD_OPTIONS.find((option) => option.key === prefs.defaultPeriod)?.label ?? 'This month'

  const exportReport = useCallback(
    async (reportKey: string) => {
      try {
        const { blob, filename } = await api.download(`v1/reports/${reportKey}/export`, {
          period: prefs.defaultPeriod,
        })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = filename
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        URL.revokeObjectURL(url)
        setNotice({ tone: 'success', title: 'File ready', text: `${filename} was downloaded.` })
      } catch (error) {
        setNotice({
          tone: 'danger',
          title: 'The file was not built',
          text:
            error instanceof ApiError
              ? error.message
              : 'The export could not be produced. Please try again.',
        })
      }
    },
    [prefs.defaultPeriod],
  )

  const handlers: ReportItemHandlers = {
    onOpen: openReport,
    onCopyLink: (reportKey) => void copyLink(reportKey),
    onExport: can('export.data') ? (reportKey) => void exportReport(reportKey) : null,
    exportLabel: periodLabel,
    isFavourite: prefs.isFavourite,
    toggleFavourite: prefs.toggleFavourite,
    showSources: prefs.showSources,
  }

  const forbidden = list.cause instanceof ApiError && list.cause.status === 403

  return (
    <div className="reports-page">
      <ReportsHeader onOpenSettings={() => setSettingsOpen(true)} />

      {notice && (
        <div style={{ marginBottom: 14 }}>
          <Notice tone={notice.tone} title={notice.title} onDismiss={() => setNotice(null)}>
            {notice.text}
          </Notice>
        </div>
      )}

      {list.error ? (
        <CatalogueError forbidden={forbidden} onRetry={list.reload} />
      ) : (
        <>
          <ReportsSummaryCards
            available={reports.length}
            recent={prefs.recent.length}
            favourites={prefs.favourites.length}
            loading={list.loading}
          />

          <div className="reports-layout">
            <div className="reports-main">
              <ReportsExplorer
                reports={reports}
                loading={list.loading}
                filters={filters}
                sources={sources}
                searchRef={searchRef}
                onFiltersChange={changeFilters}
                onClear={clearFilters}
                handlers={handlers}
              />

              <RecentReports
                reports={reports}
                recent={prefs.recent}
                favourites={prefs.favourites}
                tab={tab}
                loading={list.loading}
                onTabChange={setTab}
                onViewAll={() => changeFilters({ term: '', category: 'all', source: 'all', browseAll: true })}
                handlers={handlers}
              />

              {!list.loading && reports.length === 0 && (
                <Notice tone="info" title="No reports yet">
                  Your Billing profile does not include any reports. Someone with access management can
                  add them to your profile.
                </Notice>
              )}
            </div>

            <ReportsSideRail
              canManageAccess={can('access.manage')}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </div>
        </>
      )}

      <ReportSettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} prefs={prefs} />
    </div>
  )
}

/**
 * A failure the user can act on.
 *
 * Never the message the server sent verbatim: that can name an endpoint, a
 * table or a driver, none of which is the reader's business or problem.
 */
function CatalogueError({ forbidden, onRetry }: { forbidden: boolean; onRetry: () => void }) {
  if (forbidden) {
    return (
      <Notice tone="warning" title="You don't have access to reports">
        Your Billing profile does not include reporting. Ask someone who manages access to add it.
      </Notice>
    )
  }

  return (
    <div className="billing-error-state" role="alert">
      <strong>Reports couldn't be loaded</strong>
      <span>We couldn't retrieve report information right now.</span>
      <button type="button" className="billing-button billing-button--small" onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}
