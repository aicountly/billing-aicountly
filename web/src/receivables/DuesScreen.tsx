/**
 * Money to Collect — and, from the same component, Money to Pay.
 *
 * ONE SCREEN, BOTH SIDES. `v1/receivables` and `v1/payables` return the same
 * shape from the same service, so this is deliberately not two files: a second
 * copy is a second place for the ageing rule to drift, and the side only
 * changes the wording and which actions are offered.
 *
 * EVERY FIGURE IS SMART BOOKS' OWN, read on the request that draws the page.
 * Billing keeps no receivable of its own and this screen adds none: what is
 * worked out in the browser is which rows match a filter, which bucket a row
 * falls in, and how many rows are in each — arithmetic over the rows the server
 * already sent, against the server's own `as_on` date. The money always comes
 * from the response.
 *
 * What it will not do:
 *   - print a figure the API did not send as ₹0.00;
 *   - settle a bill by changing a status in the browser. "Mark as received"
 *     here opens the receipt screen, which posts a receipt to Books and lets
 *     Books decide what is settled. There is no other honest version of it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bookmark,
  BookmarkCheck,
  Download,
  FileSpreadsheet,
  FileText,
  HandCoins,
  Info,
  MessageSquare,
  RefreshCw,
  Share2,
  Zap,
} from 'lucide-react'
import { api, ApiError } from '../services/api'
import type { Dues as DuesShape } from '../services/types'
import { useApi } from '../hooks/useApi'
import { useBilling } from '../context/BillingContext'
import { date, money, moneyWhole } from '../ui'
import { ErrorState, Unavailable } from '../dashboards/kit'
import {
  ageingSeries,
  collectionHealth,
  insights,
  matches,
  paginate,
  partyShares,
  sortRows,
  summarise,
  toCsv,
  toRows,
  toUtcDay,
  type DueRow,
  type SortKey,
} from './model'
import { useDueFilters } from './useDueFilters'
import { AgeingChart, ShareDonut, type AgeingMode } from './charts'
import { DuesCards, DuesTable, ROW_ICONS, TableSkeleton, type RowAction } from './table'
import {
  Dialog,
  DuesEmpty,
  FilterChips,
  FilterToolbar,
  Intelligence,
  KpiGrid,
  MenuButton,
  MoreFilters,
  PAYMENT_LINK_ACTION,
  Pager,
  QuickActions,
  type Comparison,
  type QuickActionSpec,
} from './panels'
import '../styles/billing-receivables.css'

/** How far back the comparison reading is taken. */
const COMPARE_DAYS = 30

function shiftDays(iso: string | null | undefined, days: number): string | null {
  const day = toUtcDay(iso)
  if (day === null) return null

  return new Date((day + days) * 86_400_000).toISOString().slice(0, 10)
}

function download(contents: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

interface ReminderTarget {
  accountId: number
  accountName: string
  rows: DueRow[]
}

export function DuesScreen({ side }: { side: 'receivable' | 'payable' }) {
  const navigate = useNavigate()
  const { scope, can } = useBilling()
  const isReceivable = side === 'receivable'
  const path = isReceivable ? 'v1/receivables' : 'v1/payables'

  const { filters, update, clear, query } = useDueFilters()
  const [ageingMode, setAgeingMode] = useState<AgeingMode>('amount')
  const [moreOpen, setMoreOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [reminder, setReminder] = useState<ReminderTarget | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [readAt, setReadAt] = useState<Date | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  // ------------------------------------------------------------------ data

  // bo_id is in the key as well as cmp_id and fy_id: switching branch changes
  // which bills Books returns, and without it the previous branch's list stayed
  // on screen under the new branch's name.
  const { data, loading, error, reload } = useApi(
    (signal) => api.one<DuesShape>(path, undefined, signal),
    [scope?.cmp_id, scope?.fy_id, scope?.bo_id, path],
    Boolean(scope),
  )

  const dues = data?.data ?? null

  /**
   * The same reading, thirty days back, for the movement on the cards.
   *
   * Deliberately a second call that nothing waits for: the page is complete
   * without it, and a comparison is not worth delaying the figure it compares.
   * It fails silently — no trend is drawn rather than a wrong one.
   */
  const earlier = shiftDays(dues?.as_on, -COMPARE_DAYS)
  const before = useApi(
    (signal) => api.one<DuesShape>(path, { as_on: earlier }, signal),
    [scope?.cmp_id, scope?.fy_id, scope?.bo_id, path, earlier],
    Boolean(scope && earlier),
  )

  const comparison: Comparison | null =
    before.data && earlier ? { total: before.data.data.total, overdue: before.data.data.overdue, asOn: earlier } : null

  useEffect(() => {
    if (data) setReadAt(new Date())
  }, [data])

  // A message that announces itself and then gets out of the way.
  useEffect(() => {
    if (!flash) return undefined
    const timer = window.setTimeout(() => setFlash(null), 4000)
    return () => window.clearTimeout(timer)
  }, [flash])

  // --------------------------------------------------------------- derived

  const rows = useMemo(() => toRows(dues), [dues])
  const summary = useMemo(() => summarise(dues, rows), [dues, rows])
  const series = useMemo(() => ageingSeries(dues, rows), [dues, rows])
  const shares = useMemo(() => partyShares(dues), [dues])
  const health = useMemo(() => collectionHealth(summary), [summary])
  const lines = useMemo(
    () => insights({ summary, rows, dues, side, formatMoney: moneyWhole }),
    [summary, rows, dues, side],
  )

  const filtered = useMemo(
    () => sortRows(rows.filter((row) => matches(row, filters)), filters.sort, filters.dir),
    [rows, filters],
  )
  const page = useMemo(() => paginate(filtered, filters.page, filters.size), [filtered, filters.page, filters.size])
  const filteredTotal = useMemo(() => filtered.reduce((sum, row) => sum + row.balance, 0), [filtered])

  // A selection that survived a filter change would act on rows nobody can see.
  const filteredKeys = useMemo(() => filtered.map((row) => row.key).join('|'), [filtered])
  useEffect(() => {
    setSelected((current) => (current.size === 0 ? current : new Set()))
  }, [filteredKeys])

  const chosen = useMemo(() => filtered.filter((row) => selected.has(row.key)), [filtered, selected])
  const chosenParties = useMemo(() => new Set(chosen.map((row) => row.accountId)), [chosen])
  const onePartyChosen = chosenParties.size === 1 ? chosen[0] : null

  // ----------------------------------------------------------- permissions

  const mayRecordMoney = can(isReceivable ? 'receipt.create' : 'payment.create')
  const mayRemind = isReceivable && can('reminder.send')
  const mayStatement = can('statement.view')
  const mayExport = can('export.data')
  const mayCreate = can(isReceivable ? 'sale.create' : 'purchase.create')

  // --------------------------------------------------------------- actions

  const openParty = useCallback(
    (row: DueRow) => {
      if (!mayStatement) {
        update({ account: row.accountId })
        return
      }
      navigate(`/parties/${row.accountId}`)
    },
    [mayStatement, navigate, update],
  )

  /**
   * Money received / money paid, on the screen that already knows how to do it.
   *
   * This navigates. It does not settle anything here, and it deliberately does
   * not carry an allocation: the receipt screen reads the open bills from Books
   * when the party is chosen, and a bill settled since this page loaded must
   * not be allocated against twice.
   */
  const recordMoney = useCallback(
    (accountId: number, accountName: string, amount: number) => {
      const params = new URLSearchParams({
        account_id: String(accountId),
        account_name: accountName,
        amount: amount.toFixed(2),
      })
      navigate(`/${isReceivable ? 'money-in' : 'money-out'}/new?${params.toString()}`)
    },
    [isReceivable, navigate],
  )

  const draftReminder = useCallback(
    (accountId: number, accountName: string) => {
      setReminder({ accountId, accountName, rows: rows.filter((row) => row.accountId === accountId) })
    },
    [rows],
  )

  const exportView = useCallback(
    (subset: DueRow[], label: string) => {
      if (subset.length === 0) {
        setFlash('There is nothing in this view to export.')
        return
      }
      const stamp = dues?.as_on ?? new Date().toISOString().slice(0, 10)
      download(toCsv(subset), `${isReceivable ? 'money-to-collect' : 'money-to-pay'}-${label}-${stamp}.csv`)
      setFlash(`${subset.length} bill${subset.length === 1 ? '' : 's'} exported.`)
    },
    [dues?.as_on, isReceivable],
  )

  const exportAgeing = useCallback(async () => {
    setExportError(null)
    try {
      const file = await api.download(`v1/reports/${isReceivable ? 'receivables' : 'payables'}_ageing/export`, {
        period: 'month',
      })
      const url = URL.createObjectURL(file.blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = file.filename
      anchor.click()
      URL.revokeObjectURL(url)
      setFlash('The ageing report was built.')
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : String(err))
    }
  }, [isReceivable])

  // ------------------------------------------------------------ saved view

  const viewKey = `billing:dues-view:${side}`
  const [savedView, setSavedView] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(viewKey)
    } catch {
      return null
    }
  })

  const saveView = useCallback(() => {
    try {
      if (savedView === query) {
        window.localStorage.removeItem(viewKey)
        setSavedView(null)
        setFlash('Saved view removed.')
      } else {
        window.localStorage.setItem(viewKey, query)
        setSavedView(query)
        setFlash('This view will open by default on this device.')
      }
    } catch {
      setFlash('This browser will not let the app remember a view.')
    }
  }, [query, savedView, viewKey])

  const share = useCallback(() => {
    const href = window.location.href
    navigator.clipboard
      ?.writeText(href)
      .then(() => setFlash('Link copied. It opens this list with these filters.'))
      .catch(() => setFlash('Could not copy the link. It is in the address bar.'))
  }, [])

  // ------------------------------------------------------------ selection

  const toggle = useCallback((key: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelected((current) => {
      const everyOne = page.rows.every((row) => current.has(row.key))
      const next = new Set(current)
      for (const row of page.rows) {
        if (everyOne) next.delete(row.key)
        else next.add(row.key)
      }
      return next
    })
  }, [page.rows])

  const sortBy = useCallback(
    (key: SortKey) => update({ sort: key, dir: filters.sort === key && filters.dir === 'desc' ? 'asc' : 'desc' }),
    [filters.dir, filters.sort, update],
  )

  // ----------------------------------------------------------- action sets

  const rowActions = useMemo<RowAction[]>(() => {
    const actions: RowAction[] = []

    if (mayRecordMoney) {
      actions.push({
        key: 'receipt',
        label: isReceivable ? 'Record money received' : 'Record money paid',
        icon: ROW_ICONS.receipt,
        onSelect: (row) => recordMoney(row.accountId, row.accountName, row.balance),
      })
    }
    if (mayRemind) {
      actions.push({
        key: 'reminder',
        label: 'Draft a reminder',
        icon: ROW_ICONS.reminder,
        onSelect: (row) => draftReminder(row.accountId, row.accountName),
      })
    }
    if (mayStatement) {
      actions.push({
        key: 'statement',
        label: 'Open the party statement',
        icon: ROW_ICONS.statement,
        onSelect: (row) => navigate(`/parties/${row.accountId}`),
      })
    }

    actions.push({
      key: 'filter',
      label: 'Show only this party',
      icon: ROW_ICONS.filter,
      separated: actions.length > 0,
      onSelect: (row) => update({ account: row.accountId }),
    })
    actions.push({
      key: 'copy',
      label: 'Copy the bill number',
      icon: ROW_ICONS.copy,
      onSelect: (row) => {
        if (!row.billNo) {
          setFlash('This bill has no number.')
          return
        }
        navigator.clipboard
          ?.writeText(row.billNo)
          .then(() => setFlash(`${row.billNo} copied.`))
          .catch(() => setFlash('Could not copy that.'))
      },
    })

    return actions
  }, [draftReminder, isReceivable, mayRecordMoney, mayRemind, mayStatement, navigate, recordMoney, update])

  /**
   * The quick actions, and the header menu, from one list.
   *
   * Each is either wired to something that exists or disabled with the reason.
   * There is no third state where a button looks live and does nothing — on a
   * collections screen that is the worst outcome available, because the user
   * believes the customer was chased and stops chasing them.
   */
  const quickActions = useMemo<QuickActionSpec[]>(() => {
    const biggest = [...(dues?.parties ?? [])].sort((a, b) => b.overdue - a.overdue)[0]
    const target =
      filters.account !== null
        ? dues?.parties.find((party) => party.account_id === filters.account) ?? null
        : biggest ?? null

    return [
      {
        key: 'receipt',
        label: isReceivable ? 'Record money received' : 'Record money paid',
        icon: <HandCoins size={15} />,
        onSelect: mayRecordMoney
          ? () => navigate(`/${isReceivable ? 'money-in' : 'money-out'}/new`)
          : undefined,
        unavailable: mayRecordMoney ? undefined : 'Your Billing profile does not record money.',
      },
      {
        key: 'reminder',
        label: target ? `Draft a reminder for ${target.account_name}` : 'Draft a reminder',
        icon: <MessageSquare size={15} />,
        onSelect:
          mayRemind && target ? () => draftReminder(target.account_id, target.account_name) : undefined,
        unavailable: !isReceivable
          ? 'Reminders are for customers, not suppliers.'
          : !mayRemind
            ? 'Your Billing profile does not send reminders.'
            : !target
              ? 'Nobody is overdue, so there is nobody to remind.'
              : undefined,
      },
      {
        key: 'statement',
        label: target ? `Statement for ${target.account_name}` : 'Party statement',
        icon: <FileText size={15} />,
        onSelect: mayStatement
          ? () => navigate(target ? `/parties/${target.account_id}` : '/parties')
          : undefined,
        unavailable: mayStatement ? undefined : 'Your Billing profile does not show statements.',
      },
      PAYMENT_LINK_ACTION,
      {
        key: 'export',
        label: 'Export this view',
        icon: <Download size={15} />,
        onSelect: () => exportView(filtered, 'view'),
      },
    ]
  }, [draftReminder, dues, exportView, filtered, filters.account, isReceivable, mayRecordMoney, mayRemind, mayStatement, navigate])

  const exportActions = useMemo<QuickActionSpec[]>(
    () => [
      {
        key: 'view',
        label: `Everything in this view (${filtered.length})`,
        icon: <FileSpreadsheet size={15} />,
        onSelect: () => exportView(filtered, 'view'),
      },
      {
        key: 'all',
        label: `Every open bill (${rows.length})`,
        icon: <FileSpreadsheet size={15} />,
        onSelect: () => exportView(rows, 'all'),
      },
      {
        key: 'ageing',
        label: 'The ageing report, built by the server',
        icon: <FileText size={15} />,
        onSelect: mayExport ? () => void exportAgeing() : undefined,
        unavailable: mayExport ? undefined : 'Your Billing profile does not export reports.',
      },
    ],
    [exportAgeing, exportView, filtered, mayExport, rows],
  )

  // ------------------------------------------------------------------ view

  const title = isReceivable ? 'Money to Collect' : 'Money to Pay'
  const firstLoad = loading && !dues
  const filtersActive = filtered.length !== rows.length || filters.q.trim() !== ''

  /**
   * The read failed and there is nothing to fall back on.
   *
   * Every figure then says "Unavailable" with the reason. It is never drawn as
   * ₹0.00: a zero and an outage look identical on a card, and one of them means
   * every customer has paid. When a PREVIOUS reading is still in hand the page
   * keeps showing it, with the error banner saying it may have moved on.
   */
  const unread = Boolean(error) && !dues
  const unreadReason = 'Smart Books could not be reached.'

  return (
    <div className="billing-dues">
      <header className="billing-dues__header">
        <div>
          <div className="billing-dues__title">
            <h1>{title}</h1>
            <button
              type="button"
              className="billing-iconbutton"
              style={{ width: 30, height: 30 }}
              aria-expanded={aboutOpen}
              aria-label={`About ${title}`}
              onClick={() => setAboutOpen((value) => !value)}
            >
              <Info size={16} aria-hidden />
            </button>
          </div>
          <p className="billing-dues__lede">
            {isReceivable
              ? 'Track your receivables, stay on top of collections and keep your cash flow healthy.'
              : 'Track what you owe, plan your payments and keep your suppliers on side.'}
          </p>
        </div>

        <div style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
          <div className="billing-dues__header-actions">
            <MenuButton label="Collection actions ⌄" ariaLabel="Collection actions" items={quickActions} />
            <MenuButton label="Export ⌄" ariaLabel="Export" items={exportActions} />
            <button
              type="button"
              className="billing-iconbutton"
              aria-pressed={savedView === query}
              aria-label={savedView === query ? 'Forget this saved view' : 'Save this view'}
              title={savedView === query ? 'Forget this saved view' : 'Save this view on this device'}
              onClick={saveView}
            >
              {savedView === query ? <BookmarkCheck size={17} aria-hidden /> : <Bookmark size={17} aria-hidden />}
            </button>
            <button
              type="button"
              className="billing-iconbutton"
              aria-label="Copy a link to this view"
              title="Copy a link to this view"
              onClick={share}
            >
              <Share2 size={17} aria-hidden />
            </button>
          </div>

          <div className="billing-dues__status" role="status">
            <span>
              {loading
                ? 'Reading…'
                : readAt
                  ? `Last read at ${new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' }).format(readAt)}`
                  : 'Not read yet'}
              {dues?.as_on && ` · as at ${date(dues.as_on)}`}
            </span>
            <button
              type="button"
              className="billing-button billing-button--quiet billing-button--small"
              onClick={reload}
              disabled={loading}
            >
              <RefreshCw size={14} className={loading ? 'spin' : undefined} aria-hidden /> Refresh
            </button>
          </div>
        </div>
      </header>

      {aboutOpen && (
        <div className="billing-dues__about">
          <p>
            Every figure here is read from Smart Books on the request that drew this page — Billing keeps no balance of
            its own, so this screen can never disagree with the accounts.
          </p>
          <p>
            Bills are aged from their <strong>own due date</strong>, not the date they were raised: a bill on 60-day
            terms raised 45 days ago is not overdue. A bill with no due date is counted separately rather than being
            filed under “not yet due”.
          </p>
          <p style={{ color: 'var(--billing-muted)' }}>{dues?.note}</p>
        </div>
      )}

      {flash && (
        <p role="status" style={{ margin: 0, color: 'var(--billing-action)', fontSize: 13, fontWeight: 650 }}>
          {flash}
        </p>
      )}

      {error && (
        <ErrorState
          message={
            dues
              ? `${error} The figures below were read earlier and may have moved on.`
              : `We could not read ${isReceivable ? 'what you are owed' : 'what you owe'}. ${error}`
          }
          onRetry={reload}
        />
      )}

      {exportError && <Unavailable title="The file was not built">{exportError}</Unavailable>}

      <KpiGrid
        summary={summary}
        loading={firstLoad}
        side={side}
        comparison={comparison}
        onFilter={update}
        unavailable={unread ? unreadReason : null}
      />

      <section className="billing-dues__analytics" aria-label="Analysis">
        <article className="billing-dues-card">
          <div className="billing-dues-card__head">
            <div>
              <h2>How old it is</h2>
              <p>Aged from each bill’s due date, on the balance still unpaid.</p>
            </div>
            <div className="billing-segmented" role="group" aria-label="Show the ageing as">
              <button
                type="button"
                className="billing-segmented__option"
                aria-pressed={ageingMode === 'amount'}
                onClick={() => setAgeingMode('amount')}
              >
                Amount
              </button>
              <button
                type="button"
                className="billing-segmented__option"
                aria-pressed={ageingMode === 'count'}
                onClick={() => setAgeingMode('count')}
              >
                Bills
              </button>
            </div>
          </div>

          <div className="billing-dues-card__body">
            {firstLoad ? (
              <span className="billing-dues-skeleton billing-dues-skeleton--chart" aria-busy="true" />
            ) : unread ? (
              <Unavailable>{unreadReason}</Unavailable>
            ) : dues && !dues.ageing_reconciles ? (
              <Unavailable title="The ageing cannot be drawn">
                The buckets do not add up to the outstanding total, so the breakdown would mislead. The figures above
                are still Smart Books’ own.
              </Unavailable>
            ) : (
              <AgeingChart
                slices={series}
                mode={ageingMode}
                selected={filters.ageing === 'all' ? null : filters.ageing}
                onPick={(key) => update({ ageing: filters.ageing === key ? 'all' : key })}
              />
            )}
          </div>
        </article>

        <article className="billing-dues-card">
          <div className="billing-dues-card__head">
            <div>
              <h2>Who owes it</h2>
              <p>
                {/* Not "by party type": nothing in this deployment classifies a
                    customer, and a label nobody can check is worse than none. */}
                The biggest {isReceivable ? 'debtors' : 'creditors'}, and everyone else together.
              </p>
            </div>
          </div>

          <div className="billing-dues-card__body">
            {firstLoad ? (
              <span className="billing-dues-skeleton billing-dues-skeleton--chart" aria-busy="true" />
            ) : unread ? (
              <Unavailable>{unreadReason}</Unavailable>
            ) : shares.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--billing-muted)', fontSize: 13 }}>
                Nothing outstanding, so there is nothing to divide up.
              </p>
            ) : (
              <ShareDonut
                shares={shares}
                total={summary.total}
                selected={filters.account}
                onPick={(accountId) => update({ account: filters.account === accountId ? null : accountId })}
              />
            )}
          </div>
        </article>

        <article className="billing-dues-card">
          <div className="billing-dues-card__head">
            <div>
              <h2>
                <Zap size={15} aria-hidden style={{ verticalAlign: '-2px', color: 'var(--billing-brand)' }} /> Quick
                actions
              </h2>
            </div>
          </div>
          <div className="billing-dues-card__body">
            <QuickActions actions={quickActions} />
          </div>
        </article>
      </section>

      <section className="billing-dues-card" aria-label="What the figures say">
        <div className="billing-dues-card__head">
          <div>
            <h2>What this adds up to</h2>
            <p>Every line below is a sum or a count of the bills on this page.</p>
          </div>
        </div>
        <div className="billing-dues-card__body">
          {unread ? (
            <Unavailable>{unreadReason}</Unavailable>
          ) : (
            <Intelligence health={health} lines={lines} loading={firstLoad} onFilter={update} />
          )}
        </div>
      </section>

      <section className="billing-dues-list" aria-label={isReceivable ? 'Open bills' : 'Bills to pay'}>
        <FilterToolbar
          filters={filters}
          parties={dues?.parties ?? []}
          onChange={update}
          moreOpen={moreOpen}
          onToggleMore={() => setMoreOpen((value) => !value)}
        />

        {moreOpen && (
          <MoreFilters filters={filters} onChange={update} onClear={clear} onClose={() => setMoreOpen(false)} />
        )}

        <FilterChips filters={filters} parties={dues?.parties ?? []} onChange={update} onClear={clear} />

        {selected.size > 0 ? (
          <div className="billing-dues-bulk">
            <span className="billing-dues-bulk__count">
              {selected.size} bill{selected.size === 1 ? '' : 's'} selected
              {chosenParties.size > 1 && ` across ${chosenParties.size} parties`}
              {' · '}
              {money(chosen.reduce((sum, row) => sum + row.balance, 0))}
            </span>

            <div className="billing-dues-bulk__actions">
              {mayRecordMoney && (
                <button
                  type="button"
                  className="billing-button billing-button--primary billing-button--small"
                  disabled={!onePartyChosen}
                  title={
                    onePartyChosen
                      ? 'Opens the receipt screen. Nothing is settled until it is posted to Smart Books.'
                      : 'Choose bills from one party only — a receipt is recorded against one party.'
                  }
                  onClick={() =>
                    onePartyChosen &&
                    recordMoney(
                      onePartyChosen.accountId,
                      onePartyChosen.accountName,
                      chosen.reduce((sum, row) => sum + row.balance, 0),
                    )
                  }
                >
                  <HandCoins size={14} aria-hidden /> {isReceivable ? 'Record money received' : 'Record money paid'}
                </button>
              )}

              {mayRemind && (
                <button
                  type="button"
                  className="billing-button billing-button--small"
                  disabled={!onePartyChosen}
                  title={onePartyChosen ? undefined : 'Choose bills from one customer only.'}
                  onClick={() => onePartyChosen && draftReminder(onePartyChosen.accountId, onePartyChosen.accountName)}
                >
                  <MessageSquare size={14} aria-hidden /> Draft a reminder
                </button>
              )}

              <button
                type="button"
                className="billing-button billing-button--small"
                onClick={() => exportView(chosen, 'selected')}
              >
                <Download size={14} aria-hidden /> Export these
              </button>

              <button
                type="button"
                className="billing-button billing-button--quiet billing-button--small"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </button>
            </div>
          </div>
        ) : (
          <div className="billing-dues-list__head">
            <h2>
              {isReceivable ? 'Open bills' : 'Bills to pay'}{' '}
              <span>{unread ? '' : `(${filtered.length.toLocaleString('en-IN')})`}</span>
              <span className="billing-dues-list__subtotal">
                {unread
                  ? 'Not read'
                  : filtersActive
                    ? `${money(filteredTotal)} in this view, of ${money(summary.total)} outstanding`
                    : `${money(summary.total)} outstanding`}
              </span>
            </h2>

            <Pager
              from={page.from}
              to={page.to}
              total={page.total}
              page={page.page}
              totalPages={page.totalPages}
              size={filters.size}
              onPage={(next) => update({ page: next })}
              onSize={(next) => update({ size: next, page: 1 })}
            />
          </div>
        )}

        {firstLoad ? (
          <TableSkeleton />
        ) : unread ? (
          <div style={{ padding: 24 }}>
            <Unavailable
              title="The bills could not be read"
              action={
                <button type="button" className="billing-button billing-button--small" onClick={reload}>
                  Try again
                </button>
              }
            >
              {unreadReason} Nothing is shown rather than an empty list, which would read as “everything is paid”.
            </Unavailable>
          </div>
        ) : page.rows.length === 0 ? (
          <DuesEmpty
            filtered={rows.length > 0}
            side={side}
            onClear={clear}
            onCreate={mayCreate ? () => navigate(isReceivable ? '/sales/new' : '/purchases/new') : undefined}
          />
        ) : (
          <>
            <DuesTable
              rows={page.rows}
              selected={selected}
              onToggle={toggle}
              onToggleAll={toggleAll}
              onOpenParty={openParty}
              actions={rowActions}
              sort={filters.sort}
              dir={filters.dir}
              onSort={sortBy}
              busy={loading && Boolean(dues)}
              selectable={mayRecordMoney || mayRemind}
            />
            <DuesCards
              rows={page.rows}
              selected={selected}
              onToggle={toggle}
              onOpenParty={openParty}
              actions={rowActions}
              selectable={mayRecordMoney || mayRemind}
            />
          </>
        )}
      </section>

      {dues && (
        <p style={{ color: 'var(--billing-muted)', fontSize: 12, margin: 0 }}>{dues.note}</p>
      )}

      {reminder && (
        <ReminderDialog
          target={reminder}
          asOn={dues?.as_on ?? ''}
          onClose={() => setReminder(null)}
          onCopied={() => setFlash('The reminder was copied.')}
        />
      )}
    </div>
  )
}

/**
 * A reminder, drafted for review and never sent from here.
 *
 * Composed from the figures already on screen. Billing has no message delivery
 * in this deployment, and a Send button that quietly did nothing would be the
 * worst outcome available: the user believes the customer was chased and stops
 * chasing them. So the honest option is the one offered — read it, copy it,
 * send it from wherever you normally reach this customer.
 */
function ReminderDialog({
  target,
  asOn,
  onClose,
  onCopied,
}: {
  target: ReminderTarget
  asOn: string
  onClose: () => void
  onCopied: () => void
}) {
  const [copied, setCopied] = useState(false)

  const overdue = target.rows.filter((row) => row.timing === 'overdue')
  const outstanding = target.rows.reduce((sum, row) => sum + row.balance, 0)
  const overdueTotal = overdue.reduce((sum, row) => sum + row.balance, 0)
  const oldest = [...overdue].sort((a, b) => b.daysOverdue - a.daysOverdue)[0]

  const message = [
    `Dear ${target.accountName},`,
    '',
    overdue.length > 0
      ? `Our records as at ${date(asOn)} show ${money(overdueTotal)} overdue on your account across ` +
        `${overdue.length} bill${overdue.length === 1 ? '' : 's'}` +
        (oldest?.billNo ? `, the oldest being ${oldest.billNo}` : '') +
        (oldest?.dueDate ? ` which fell due on ${date(oldest.dueDate)}` : '') +
        '.'
      : `Our records as at ${date(asOn)} show ${money(outstanding)} outstanding on your account.`,
    '',
    `The total outstanding on the account is ${money(outstanding)}.`,
    '',
    'We would be grateful if you could arrange payment, or let us know a date we can expect it.',
    '',
    'Thank you.',
  ].join('\n')

  return (
    <Dialog title={`Reminder for ${target.accountName}`} onClose={onClose}>
      <p style={{ marginTop: 0, color: 'var(--billing-muted)', fontSize: 13 }}>
        Read it before it goes anywhere. The figures are Smart Books’ own, as this page read them.
      </p>

      <div className="billing-field">
        <label htmlFor="dues-reminder">Message</label>
        <textarea id="dues-reminder" readOnly rows={10} value={message} style={{ minHeight: '12rem', resize: 'vertical' }} />
      </div>

      <Unavailable title="Not sent from this screen">
        Billing does not deliver messages here. Copy the draft and send it from wherever you normally reach this
        customer.
      </Unavailable>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" className="billing-button" onClick={onClose}>
          Close
        </button>
        <button
          type="button"
          className="billing-button billing-button--primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(message)
              setCopied(true)
              onCopied()
            } catch {
              // A browser that refuses the clipboard is not worth a dialog of
              // its own: the text is selectable in the box above.
              setCopied(false)
            }
          }}
        >
          {copied ? 'Copied' : 'Copy the message'}
        </button>
      </div>
    </Dialog>
  )
}
