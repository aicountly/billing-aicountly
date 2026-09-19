/**
 * Parties — the directory of customers and suppliers.
 *
 * Every row, every figure and every count on this screen was read from Smart
 * Books on the request that drew it. Billing holds no party table, no balance
 * and no cached copy; there is nothing here to go stale and nothing to sync.
 *
 * The screen state lives in the URL. "The customers in Karnataka who owe
 * something" is therefore a link somebody can send to their accountant, and
 * coming back from a statement returns to the list as it was rather than to
 * page one of everything. It replaces rather than pushes: a list screen that
 * needs eleven presses of Back to leave is a list screen people stop using.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Info, RefreshCw } from 'lucide-react'
import { ApiError } from '../../services/api'
import { useApi } from '../../hooks/useApi'
import { useDebounced } from '../../hooks/useDebounced'
import { useBilling } from '../../context/BillingContext'
import { Notice } from '../../ui'
import {
  applyTab,
  activeFilterCount,
  parties as partiesApi,
  readPartyQuery,
  tabOf,
  writePartyQuery,
  type Party,
  type PartyQuery,
} from '../../services/parties'
import { PartyStats } from './PartyStats'
import { PartyTable, type PartyTablePermissions } from './PartyTable'
import { PartyFilterBar, PartyFilterDrawer } from './PartyFilters'
import { PartiesHeading, PartyBulkBar, PartyQualityBanner, PartyTabs, PartyToolbar } from './PartyChrome'
import { PartyPagination } from './PartyPagination'
import { LedgerMappingDrawer, PartyDetailsDrawer } from './PartyDetails'
import { DuplicateDrawer } from './PartyDuplicates'
import '../../styles/billing-parties.css'

/** Below this the table becomes cards, whatever the view toggle says. */
const CARD_WIDTH = 720

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width: ${CARD_WIDTH}px)`).matches,
  )

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${CARD_WIDTH}px)`)
    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return narrow
}

/** The rows on screen, as a file, without asking the server for them again. */
function csvOf(rows: Party[]): string {
  const headers = [
    'Name', 'Type', 'GSTIN', 'Phone', 'Email', 'City', 'State', 'Group',
    'Outstanding', 'Overdue', 'Credit limit', 'Status', 'Last transaction',
  ]

  // A leading =, +, - or @ makes Excel treat a customer's name as a formula.
  const cell = (value: unknown): string => {
    if (value === null || value === undefined) return ''
    const text = String(value)
    const safe = '=+-@'.includes(text[0] ?? '') ? `'${text}` : text
    return `"${safe.replace(/"/g, '""')}"`
  }

  const lines = rows.map((row) =>
    [
      row.name,
      row.type === 'supplier' ? 'Supplier' : 'Customer',
      row.gstin,
      row.phone,
      row.email,
      row.city,
      row.state,
      row.group,
      row.outstanding,
      row.overdue,
      row.credit_limit,
      row.status,
      row.last_transaction_at,
    ]
      .map(cell)
      .join(','),
  )

  return [headers.join(','), ...lines].join('\r\n')
}

function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function Parties() {
  const { scope, can } = useBilling()
  const [params, setParams] = useSearchParams()
  const narrow = useIsNarrow()

  const query = useMemo(() => readPartyQuery(params), [params])

  const [searchInput, setSearchInput] = useState(query.search)
  const settledSearch = useDebounced(searchInput, 400)

  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set())
  const [open, setOpen] = useState<Party | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [duplicatesOpen, setDuplicatesOpen] = useState(false)
  const [mappingOpen, setMappingOpen] = useState(false)
  const [bannerHidden, setBannerHidden] = useState(false)
  const [view, setView] = useState<'table' | 'cards'>('table')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const update = useCallback(
    (next: Partial<PartyQuery>) => {
      setParams((previous) => writePartyQuery({ ...readPartyQuery(previous), ...next }), { replace: true })
    },
    [setParams],
  )

  // The box runs ahead of the query while somebody types; the query catches up
  // once they stop, and only then is anybody's ledger read.
  useEffect(() => {
    if (settledSearch === query.search) return
    update({ search: settledSearch, page: 1 })
  }, [settledSearch, query.search, update])

  // …and the box follows the URL when the URL changes for another reason,
  // such as Back, or a link somebody was sent.
  useEffect(() => {
    setSearchInput((current) => (current === query.search ? current : query.search))
  }, [query.search])

  const list = useApi(
    (signal) => partiesApi.list(query, signal),
    [
      scope?.cmp_id,
      scope?.fy_id,
      scope?.bo_id,
      query.side,
      query.search,
      query.status,
      query.state,
      query.group,
      query.city,
      query.balance,
      query.credit,
      query.gst,
      query.activity,
      query.sort,
      query.order,
      query.page,
      query.pageSize,
    ],
    Boolean(scope),
  )

  const overview = useApi(
    (signal) => partiesApi.overview(signal),
    [scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    Boolean(scope),
  )

  const rows = list.data?.data ?? []
  const meta = list.data?.meta
  const stats = overview.data?.data ?? null

  // A tick means "this party", not "the fourth row" — so a change of page or
  // filter clears it rather than carrying it onto rows nobody looked at.
  const signature = JSON.stringify(query)
  const lastSignature = useRef(signature)
  useEffect(() => {
    if (lastSignature.current === signature) return
    lastSignature.current = signature
    setSelected(new Set())
  }, [signature])

  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.account_id)), [rows, selected])

  const permissions: PartyTablePermissions = {
    statement: can('statement.view'),
    sale: can('sale.create'),
    purchase: can('purchase.create'),
    receipt: can('receipt.create'),
    payment: can('payment.create'),
  }

  const filtered = activeFilterCount(query) > 0 || query.search.trim() !== '' || query.status !== 'all' || query.side !== 'all'

  async function exportList() {
    if (exporting) return
    setExporting(true)
    setExportError(null)
    try {
      const { blob, filename } = await partiesApi.exportCsv(query)
      saveFile(blob, filename)
    } catch (error) {
      setExportError(error instanceof ApiError ? error.message : String(error))
    } finally {
      setExporting(false)
    }
  }

  function exportSelected() {
    saveFile(new Blob([`﻿${csvOf(selectedRows)}`], { type: 'text/csv;charset=utf-8' }), 'parties-selected.csv')
  }

  async function copyEmails(): Promise<number> {
    const addresses = selectedRows.map((row) => row.email).filter((email): email is string => Boolean(email))
    if (addresses.length > 0) {
      await navigator.clipboard?.writeText(addresses.join(', ')).catch(() => undefined)
    }
    return addresses.length
  }

  return (
    <div className="billing-parties">
      <PartiesHeading onExport={exportList} exporting={exporting} mayExport={can('export.data')} />

      {exportError && (
        <Notice tone="danger" title="That file could not be built" onDismiss={() => setExportError(null)}>
          {exportError}
        </Notice>
      )}

      {!bannerHidden && (
        <PartyQualityBanner
          overview={stats}
          onReview={() => setDuplicatesOpen(true)}
          onDismiss={() => setBannerHidden(true)}
        />
      )}

      <PartyStats overview={stats} loading={overview.loading && !overview.data} />

      {(stats?.insights.length ?? 0) > 0 && (
        <p className="billing-parties__insight" style={{ margin: 0 }}>
          <Info size={15} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            {stats?.insights.map((insight) => (
              <span key={insight.kind} style={{ display: 'block' }}>
                {insight.message}
              </span>
            ))}
          </span>
        </p>
      )}

      <div className="billing-parties__nav">
        <PartyTabs current={tabOf(query)} onChange={(tab) => update(applyTab(query, tab))} overview={stats} />
        <PartyToolbar
          overview={stats}
          query={query}
          onChange={update}
          onDuplicates={() => setDuplicatesOpen(true)}
          onLedgerMapping={() => setMappingOpen(true)}
        />
      </div>

      <section className="billing-parties__panel" id="party-list" role="tabpanel" aria-labelledby={`party-tab-${tabOf(query)}`}>
        {selected.size > 0 ? (
          <PartyBulkBar
            count={selected.size}
            onClear={() => setSelected(new Set())}
            onExportSelected={exportSelected}
            onCopyEmails={copyEmails}
            mayExport={can('export.data')}
          />
        ) : null}

        <PartyFilterBar
          query={query}
          search={searchInput}
          onSearch={setSearchInput}
          onChange={update}
          overview={stats}
          view={view}
          onView={setView}
          onOpenMore={() => setFiltersOpen(true)}
        />

        {list.loading && rows.length > 0 && (
          <p className="billing-parties__refreshing" style={{ padding: '8px 14px 0', margin: 0 }} role="status">
            <RefreshCw size={13} aria-hidden className="spin" /> Reading Smart Books…
          </p>
        )}

        <PartyTable
          rows={rows}
          loading={list.loading}
          refreshing={list.loading && rows.length > 0}
          error={list.error}
          onRetry={list.reload}
          selected={selected}
          onToggle={(accountId) =>
            setSelected((current) => {
              const next = new Set(current)
              if (next.has(accountId)) next.delete(accountId)
              else next.add(accountId)
              return next
            })
          }
          onToggleAll={(select) =>
            setSelected(select ? new Set(rows.map((row) => row.account_id)) : new Set())
          }
          onOpen={setOpen}
          permissions={permissions}
          sorting={{
            sort: query.sort,
            order: query.order,
            onSort: (sort) =>
              update({
                sort,
                order: query.sort === sort && query.order === 'asc' ? 'desc' : 'asc',
                page: 1,
              }),
          }}
          view={narrow ? 'cards' : view}
          emptyMessage={
            filtered
              ? 'No parties match what you have asked for.'
              : 'No parties are available for this company in Smart Books.'
          }
          emptyAction={
            filtered ? (
              <button
                type="button"
                className="billing-button billing-button--small"
                onClick={() => {
                  setSearchInput('')
                  setParams(new URLSearchParams(), { replace: true })
                }}
              >
                Clear the filters
              </button>
            ) : undefined
          }
        />

        {rows.length > 0 && (
          <PartyPagination
            page={query.page}
            pageSize={query.pageSize}
            rowCount={rows.length}
            total={meta?.total ?? rows.length}
            totalKnown={meta?.total_known ?? false}
            onPage={(page) => update({ page })}
            onPageSize={(pageSize) => update({ pageSize, page: 1 })}
            busy={list.loading}
          />
        )}
      </section>

      {meta?.note && (
        <p className="billing-parties__stat-note" style={{ margin: 0 }}>
          {meta.note}
          {meta.complete === false && ' There are more parties than one reading can compare, so the totals above are left blank rather than guessed.'}
        </p>
      )}

      <PartyFilterDrawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        query={query}
        onApply={update}
        overview={stats}
      />
      <DuplicateDrawer open={duplicatesOpen} onClose={() => setDuplicatesOpen(false)} />
      <LedgerMappingDrawer open={mappingOpen} onClose={() => setMappingOpen(false)} rows={rows} />
      <PartyDetailsDrawer party={open} onClose={() => setOpen(null)} />
    </div>
  )
}

export default Parties
