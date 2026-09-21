/**
 * The panels around the list: the five figures, the filters, the actions and
 * the sentences the figures support.
 *
 * Two rules run through all of them, and they are the same two the dashboards
 * were built on.
 *
 *  1. A figure that could not be read says so. It is never rendered as ₹0.00,
 *     because a zero and an outage look identical and one means "all paid".
 *  2. Nothing is asserted that the data does not carry. Every sentence in the
 *     intelligence panel is a sum or a count of the rows on this page, and the
 *     health label states the two percentages it was derived from.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Info,
  Link2,
  Receipt,
  Search,
  Wallet,
  X,
} from 'lucide-react'
import { compactMoney, money, moneyWhole } from '../ui'
import {
  AGEING_BUCKETS,
  activeFilterCount,
  ageingDefinition,
  STATUS_WORDS,
  type CollectionHealth,
  type DueFilters,
  type DuePartyInput,
  type DueSummary,
  type Insight,
  type StatusFilter,
} from './model'
import { PAGE_SIZES } from './model'

// ---------------------------------------------------------------------------
// The five figures
// ---------------------------------------------------------------------------

export interface Comparison {
  /** The same reading, taken as at an earlier date. Null while it is in flight. */
  total: number
  overdue: number
  asOn: string
}

interface KpiProps {
  summary: DueSummary
  loading: boolean
  side: 'receivable' | 'payable'
  comparison: Comparison | null
  onFilter: (patch: Partial<DueFilters>) => void
  /** Why nothing could be read. Set, every card says so instead of showing \u20b90. */
  unavailable?: string | null
}

function trend(now: number, before: number): { label: string; direction: 'up' | 'down' } | null {
  if (before <= 0) return null
  const change = ((now - before) / before) * 100
  if (Math.abs(change) < 0.05) return null

  return { label: `${Math.abs(change).toFixed(1)}%`, direction: change > 0 ? 'up' : 'down' }
}

function KpiCard({
  variant,
  label,
  value,
  meta,
  mark,
  loading,
  onOpen,
  title,
  unavailable,
}: {
  variant: string
  label: string
  value: ReactNode
  meta: ReactNode
  mark: ReactNode
  loading: boolean
  onOpen?: () => void
  title?: string
  unavailable?: string | null
}) {
  const body = (
    <>
      <span className="billing-dues-kpi__mark" aria-hidden="true">
        {mark}
      </span>
      <span className="billing-dues-kpi__body">
        <span className="billing-dues-kpi__label">{label}</span>
        {loading ? (
          <>
            <span className="billing-dues-skeleton billing-dues-skeleton--kpi">
              <span className="billing-sr-only">Reading {label}</span>
            </span>
            <span className="billing-dues-skeleton billing-dues-skeleton--meta" />
          </>
        ) : unavailable ? (
          <>
            {/* Never \u20b90.00 here. A zero and an outage look identical on a card,
                and one of them means every customer has paid. */}
            <span className="billing-dues-kpi__value billing-dues-kpi__value--unavailable">Unavailable</span>
            <span className="billing-dues-kpi__meta">{unavailable}</span>
          </>
        ) : (
          <>
            <span className="billing-dues-kpi__value">{value}</span>
            <span className="billing-dues-kpi__meta">{meta}</span>
          </>
        )}
      </span>
    </>
  )

  return (
    <article className={`billing-dues-kpi billing-dues-kpi--${variant}`} aria-busy={loading}>
      {onOpen && !loading ? (
        <button type="button" className="billing-dues-kpi__inner" onClick={onOpen} title={title}>
          {body}
        </button>
      ) : (
        <div className="billing-dues-kpi__inner" title={title}>
          {body}
        </div>
      )}
    </article>
  )
}

export function KpiGrid({ summary, loading, side, comparison, onFilter, unavailable = null }: KpiProps) {
  const noun = side === 'receivable' ? 'customers' : 'suppliers'
  const totalTrend = comparison && !unavailable ? trend(summary.total, comparison.total) : null
  const overdueTrend = comparison && !unavailable ? trend(summary.overdue, comparison.overdue) : null

  return (
    <section className="billing-dues__kpis" aria-label="Key figures">
      <KpiCard
        variant="total"
        label={side === 'receivable' ? 'Total receivables' : 'Total payables'}
        value={moneyWhole(summary.total)}
        mark={<Wallet size={19} />}
        loading={loading}
        unavailable={unavailable}
        title={`${money(summary.total)} — every unpaid bill, at the balance still owed on it.`}
        meta={
          totalTrend && comparison ? (
            <>
              {totalTrend.direction === 'up' ? (
                <ArrowUpRight size={12} aria-hidden style={{ verticalAlign: '-1px' }} />
              ) : (
                <ArrowDownRight size={12} aria-hidden style={{ verticalAlign: '-1px' }} />
              )}{' '}
              {totalTrend.label} {totalTrend.direction === 'up' ? 'more' : 'less'} than{' '}
              {compactMoney(comparison.total)} thirty days ago
            </>
          ) : (
            `${summary.billCount} bill${summary.billCount === 1 ? '' : 's'} across ${summary.partyCount} ${noun}`
          )
        }
      />

      <KpiCard
        variant="overdue"
        label="Overdue"
        value={moneyWhole(summary.overdue)}
        mark={<AlertTriangle size={19} />}
        loading={loading}
        unavailable={unavailable}
        title={`${money(summary.overdue)} — the part whose due date has already passed. Select to filter the list.`}
        onOpen={unavailable ? undefined : () => onFilter({ status: 'overdue' })}
        meta={
          <>
            {summary.overdueShare}% of the total · {summary.overdueCount} bill{summary.overdueCount === 1 ? '' : 's'}
            {overdueTrend && (
              <>
                <br />
                <span className={`billing-dues-kpi__meta--${overdueTrend.direction}`}>
                  {overdueTrend.direction === 'up' ? (
                    <ArrowUpRight size={12} aria-hidden style={{ verticalAlign: '-1px' }} />
                  ) : (
                    <ArrowDownRight size={12} aria-hidden style={{ verticalAlign: '-1px' }} />
                  )}{' '}
                  {overdueTrend.label} {overdueTrend.direction === 'up' ? 'more' : 'less'} than thirty days ago
                </span>
              </>
            )}
          </>
        }
      />

      <KpiCard
        variant="today"
        label="Due today"
        value={moneyWhole(summary.dueToday)}
        mark={<CalendarDays size={19} />}
        loading={loading}
        unavailable={unavailable}
        title={`${money(summary.dueToday)} — bills whose due date is today. Select to filter the list.`}
        onOpen={unavailable ? undefined : () => onFilter({ status: 'due_today' })}
        meta={`${summary.dueTodayCount} bill${summary.dueTodayCount === 1 ? '' : 's'}`}
      />

      <KpiCard
        variant="week"
        label="Due within seven days"
        value={moneyWhole(summary.dueThisWeek)}
        mark={<CalendarClock size={19} />}
        loading={loading}
        unavailable={unavailable}
        title={`${money(summary.dueThisWeek)} — falling due from today up to seven days out. Nothing overdue is counted here.`}
        onOpen={unavailable ? undefined : () => onFilter({ status: 'due_soon' })}
        meta={`${summary.dueThisWeekCount} bill${summary.dueThisWeekCount === 1 ? '' : 's'}`}
      />

      <KpiCard
        variant="count"
        label="Open bills"
        value={summary.billCount.toLocaleString('en-IN')}
        mark={<Receipt size={19} />}
        loading={loading}
        unavailable={unavailable}
        title="Every bill with something still owed on it. Select to clear the filters."
        onOpen={unavailable ? undefined : () => onFilter({ status: 'all', ageing: 'all', account: null, q: '' })}
        meta={`across ${summary.partyCount} ${noun}`}
      />
    </section>
  )
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Every standing' },
  { value: 'not_yet_due', label: 'Not yet due' },
  { value: 'due_today', label: 'Due today' },
  { value: 'due_soon', label: 'Due soon' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'part_paid', label: 'Part paid' },
  { value: 'no_due_date', label: 'No due date' },
]

export function FilterToolbar({
  filters,
  parties,
  onChange,
  moreOpen,
  onToggleMore,
}: {
  filters: DueFilters
  parties: DuePartyInput[]
  onChange: (patch: Partial<DueFilters>) => void
  moreOpen: boolean
  onToggleMore: () => void
}) {
  // The search box is local and pushed to the URL after a pause: a history
  // entry per keystroke makes the back button useless.
  const [term, setTerm] = useState(filters.q)
  const committed = useRef(filters.q)

  useEffect(() => {
    if (filters.q !== committed.current) {
      committed.current = filters.q
      setTerm(filters.q)
    }
  }, [filters.q])

  useEffect(() => {
    if (term === committed.current) return undefined
    const timer = window.setTimeout(() => {
      committed.current = term
      onChange({ q: term })
    }, 300)

    return () => window.clearTimeout(timer)
  }, [term, onChange])

  const more = activeFilterCount({ ...filters, q: '', account: null, status: 'all', ageing: 'all' })

  return (
    <div className="billing-dues-toolbar">
      <div className="billing-dues-search">
        <Search size={15} className="billing-dues-search__icon" aria-hidden />
        <label className="billing-sr-only" htmlFor="dues-search">
          Search these bills
        </label>
        <input
          id="dues-search"
          type="search"
          value={term}
          placeholder="Search by party or bill number…"
          onChange={(event) => setTerm(event.target.value)}
        />
      </div>

      <div>
        <label className="billing-sr-only" htmlFor="dues-party">
          Party
        </label>
        <select
          id="dues-party"
          value={filters.account ?? ''}
          onChange={(event) => onChange({ account: event.target.value ? Number(event.target.value) : null })}
        >
          <option value="">Every party</option>
          {parties.map((party) => (
            <option key={party.account_id} value={party.account_id}>
              {party.account_name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="billing-sr-only" htmlFor="dues-status">
          Standing
        </label>
        <select
          id="dues-status"
          value={filters.status}
          onChange={(event) => onChange({ status: event.target.value as StatusFilter })}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="billing-sr-only" htmlFor="dues-ageing">
          Age
        </label>
        <select
          id="dues-ageing"
          value={filters.ageing}
          onChange={(event) => onChange({ ageing: event.target.value as DueFilters['ageing'] })}
        >
          <option value="all">Every age</option>
          {AGEING_BUCKETS.map((bucket) => (
            <option key={bucket.key} value={bucket.key}>
              {bucket.label}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        className="billing-button billing-button--small"
        aria-expanded={moreOpen}
        onClick={onToggleMore}
      >
        More filters{more > 0 ? ` (${more})` : ''}
      </button>
    </div>
  )
}

export function MoreFilters({
  filters,
  onChange,
  onClear,
  onClose,
}: {
  filters: DueFilters
  onChange: (patch: Partial<DueFilters>) => void
  onClear: () => void
  onClose: () => void
}) {
  const number = (raw: string) => (raw.trim() === '' ? null : Number(raw))

  return (
    <div className="billing-dues-more">
      <div className="billing-dues-field">
        <label htmlFor="dues-min">Outstanding from</label>
        <input
          id="dues-min"
          inputMode="decimal"
          value={filters.minAmount ?? ''}
          placeholder="₹"
          onChange={(event) => onChange({ minAmount: number(event.target.value) })}
        />
      </div>

      <div className="billing-dues-field">
        <label htmlFor="dues-max">Outstanding up to</label>
        <input
          id="dues-max"
          inputMode="decimal"
          value={filters.maxAmount ?? ''}
          placeholder="₹"
          onChange={(event) => onChange({ maxAmount: number(event.target.value) })}
        />
      </div>

      <div className="billing-dues-field">
        <label htmlFor="dues-from">Due on or after</label>
        <input
          id="dues-from"
          type="date"
          value={filters.dueFrom ?? ''}
          onChange={(event) => onChange({ dueFrom: event.target.value || null })}
        />
      </div>

      <div className="billing-dues-field">
        <label htmlFor="dues-to">Due on or before</label>
        <input
          id="dues-to"
          type="date"
          value={filters.dueTo ?? ''}
          onChange={(event) => onChange({ dueTo: event.target.value || null })}
        />
      </div>

      <div className="billing-dues-field">
        <label htmlFor="dues-late">Late by at least (days)</label>
        <input
          id="dues-late"
          inputMode="numeric"
          value={filters.minDaysOverdue ?? ''}
          placeholder="0"
          onChange={(event) => onChange({ minDaysOverdue: number(event.target.value) })}
        />
      </div>

      <div className="billing-dues-more__foot">
        <button type="button" className="billing-button billing-button--small" onClick={onClear}>
          Clear all
        </button>
        <button type="button" className="billing-button billing-button--soft billing-button--small" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}

/** One chip per active filter, each removable on its own. */
export function FilterChips({
  filters,
  parties,
  onChange,
  onClear,
}: {
  filters: DueFilters
  parties: DuePartyInput[]
  onChange: (patch: Partial<DueFilters>) => void
  onClear: () => void
}) {
  const chips: Array<{ key: string; label: string; clear: Partial<DueFilters> }> = []

  if (filters.q.trim() !== '') chips.push({ key: 'q', label: `“${filters.q.trim()}”`, clear: { q: '' } })
  if (filters.account !== null) {
    const party = parties.find((candidate) => candidate.account_id === filters.account)
    chips.push({ key: 'party', label: party?.account_name ?? `Party ${filters.account}`, clear: { account: null } })
  }
  if (filters.status !== 'all') {
    const label = filters.status === 'part_paid' ? 'Part paid' : STATUS_WORDS[filters.status]
    chips.push({ key: 'status', label, clear: { status: 'all' } })
  }
  if (filters.ageing !== 'all') {
    chips.push({ key: 'ageing', label: ageingDefinition(filters.ageing).label, clear: { ageing: 'all' } })
  }
  if (filters.minAmount !== null) {
    chips.push({ key: 'min', label: `from ${money(filters.minAmount)}`, clear: { minAmount: null } })
  }
  if (filters.maxAmount !== null) {
    chips.push({ key: 'max', label: `up to ${money(filters.maxAmount)}`, clear: { maxAmount: null } })
  }
  if (filters.dueFrom !== null) chips.push({ key: 'from', label: `due from ${filters.dueFrom}`, clear: { dueFrom: null } })
  if (filters.dueTo !== null) chips.push({ key: 'to', label: `due to ${filters.dueTo}`, clear: { dueTo: null } })
  if (filters.minDaysOverdue !== null) {
    chips.push({ key: 'late', label: `${filters.minDaysOverdue}+ days late`, clear: { minDaysOverdue: null } })
  }

  if (chips.length === 0) return null

  return (
    <div className="billing-dues-chips">
      {chips.map((chip) => (
        <span key={chip.key} className="billing-dues-chip">
          {chip.label}
          <button type="button" aria-label={`Remove the filter ${chip.label}`} onClick={() => onChange(chip.clear)}>
            <X size={13} aria-hidden />
          </button>
        </span>
      ))}
      <button type="button" className="billing-button billing-button--quiet billing-button--small" onClick={onClear}>
        Clear all
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Quick actions
// ---------------------------------------------------------------------------

export interface QuickActionSpec {
  key: string
  label: string
  icon: ReactNode
  onSelect?: () => void
  /** Why this one cannot be used. Shown as the title, and it disables the row. */
  unavailable?: string
}

export function QuickActions({ actions }: { actions: QuickActionSpec[] }) {
  return (
    <div className="billing-dues-actions">
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          className="billing-dues-action"
          disabled={Boolean(action.unavailable) || !action.onSelect}
          title={action.unavailable}
          onClick={action.onSelect}
        >
          <span className="billing-dues-action__mark" aria-hidden="true">
            {action.icon}
          </span>
          <span className="billing-dues-action__label">{action.label}</span>
        </button>
      ))}
    </div>
  )
}

/** The payment-link row, which is an integration point rather than a feature. */
export const PAYMENT_LINK_ACTION: QuickActionSpec = {
  key: 'payment-link',
  label: 'Share a payment link',
  icon: <Link2 size={15} />,
  unavailable:
    'No payment-link service is connected to this deployment. Nothing here can create one, so the button does not pretend to.',
}

// ---------------------------------------------------------------------------
// Collection intelligence
// ---------------------------------------------------------------------------

const HEALTH_ICONS = {
  healthy: CheckCircle2,
  watch: AlertTriangle,
  attention: AlertCircle,
} as const

export function Intelligence({
  health,
  lines,
  loading,
  onFilter,
}: {
  health: CollectionHealth | null
  lines: Insight[]
  loading: boolean
  onFilter: (patch: Partial<DueFilters>) => void
}) {
  if (loading) {
    return (
      <div className="billing-skeleton-rows" aria-busy="true">
        <span className="billing-sr-only">Reading</span>
        <span className="billing-skeleton billing-skeleton--line" />
        <span className="billing-skeleton billing-skeleton--line" />
        <span className="billing-skeleton billing-skeleton--line" />
      </div>
    )
  }

  const HealthIcon = health ? HEALTH_ICONS[health.level] : null

  return (
    <div>
      {health && HealthIcon && (
        <div className={`billing-dues-health billing-dues-health--${health.level}`}>
          <HealthIcon size={18} aria-hidden />
          <span>
            <span className="billing-dues-health__label">{health.label}</span>
            <br />
            <span className="billing-dues-health__because">{health.because}</span>
          </span>
        </div>
      )}

      {lines.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--billing-muted)', fontSize: 13 }}>
          Nothing stands out. Every bill is within its terms.
        </p>
      ) : (
        <ul className="billing-dues-insights">
          {lines.map((line) => {
            const Icon = line.tone === 'danger' ? AlertCircle : line.tone === 'warning' ? AlertTriangle : Info

            return (
              <li key={line.id}>
                {line.filter ? (
                  <button
                    type="button"
                    className={`billing-dues-insight billing-dues-insight--${line.tone}`}
                    onClick={() => onFilter(line.filter as Partial<DueFilters>)}
                  >
                    <Icon size={15} className="billing-dues-insight__mark" aria-hidden />
                    <span>{line.text}</span>
                  </button>
                ) : (
                  <div className={`billing-dues-insight billing-dues-insight--${line.tone}`}>
                    <Icon size={15} className="billing-dues-insight__mark" aria-hidden />
                    <span>{line.text}</span>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty and paging
// ---------------------------------------------------------------------------

export function DuesEmpty({
  filtered,
  side,
  onClear,
  onCreate,
}: {
  filtered: boolean
  side: 'receivable' | 'payable'
  onClear: () => void
  onCreate?: () => void
}) {
  if (filtered) {
    return (
      <div className="billing-dues-empty">
        <span className="billing-dues-empty__mark" aria-hidden="true">
          <Search size={22} />
        </span>
        <span className="billing-dues-empty__title">Nothing matches these filters</span>
        <p>Every bill is still there — this view is just narrowed past all of them.</p>
        <button type="button" className="billing-button billing-button--soft billing-button--small" onClick={onClear}>
          Clear the filters
        </button>
      </div>
    )
  }

  return (
    <div className="billing-dues-empty">
      <span className="billing-dues-empty__mark" aria-hidden="true">
        <CheckCircle2 size={24} />
      </span>
      <span className="billing-dues-empty__title">
        {side === 'receivable' ? 'Nothing to collect right now' : 'Nothing to pay right now'}
      </span>
      <p>
        {side === 'receivable'
          ? 'Bills with a balance still owed will appear here as soon as one is raised.'
          : 'Supplier bills with a balance still owed will appear here as soon as one is recorded.'}
      </p>
      {onCreate && (
        <button type="button" className="billing-button billing-button--soft billing-button--small" onClick={onCreate}>
          {side === 'receivable' ? 'Make a bill' : 'Record a purchase'}
        </button>
      )}
    </div>
  )
}

export function Pager({
  from,
  to,
  total,
  page,
  totalPages,
  size,
  onPage,
  onSize,
}: {
  from: number
  to: number
  total: number
  page: number
  totalPages: number
  size: number
  onPage: (page: number) => void
  onSize: (size: number) => void
}) {
  return (
    <div className="billing-dues-pager">
      <label htmlFor="dues-size" style={{ whiteSpace: 'nowrap' }}>
        Show
      </label>
      <select id="dues-size" value={size} onChange={(event) => onSize(Number(event.target.value))}>
        {PAGE_SIZES.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <span style={{ whiteSpace: 'nowrap' }} role="status">
        {total === 0 ? 'No bills' : `${from}–${to} of ${total}`}
      </span>
      <button
        type="button"
        className="billing-dues-pager__button"
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
      >
        ‹
      </button>
      <button
        type="button"
        className="billing-dues-pager__button"
        onClick={() => onPage(page + 1)}
        disabled={page >= totalPages}
        aria-label="Next page"
      >
        ›
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// A modal that keeps the keyboard inside it
// ---------------------------------------------------------------------------

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    panel.current?.focus()

    return () => opener?.focus?.()
  }, [])

  return (
    <>
      <div className="billing-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onClose()
            return
          }
          if (event.key !== 'Tab') return

          // Tab cycles within the dialog. Without this the focus ring walks out
          // into the page behind it, which for a screen-reader user means the
          // dialog silently stops being where they are.
          const focusable = panel.current?.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
          )
          if (!focusable || focusable.length === 0) return

          const first = focusable[0]
          const last = focusable[focusable.length - 1]

          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }}
        style={{
          position: 'fixed',
          zIndex: 80,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(92vw, 34rem)',
          maxHeight: '86vh',
          overflowY: 'auto',
          padding: 22,
          background: 'var(--billing-surface)',
          border: '1px solid var(--billing-border)',
          borderRadius: 'var(--billing-radius)',
          boxShadow: 'var(--billing-shadow-lg)',
        }}
      >
        <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>{title}</h2>
        {children}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// A header dropdown
// ---------------------------------------------------------------------------

/**
 * Closes on Escape, on a click outside and on choosing something, and hands
 * focus back to its trigger — the same contract as the shell's own popover, so
 * the header of this screen behaves like the header above it.
 */
export function MenuButton({
  label,
  ariaLabel,
  items,
}: {
  label: ReactNode
  ariaLabel: string
  items: QuickActionSpec[]
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return undefined

    function onPointerDown(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (items.length === 0) return null

  return (
    <div style={{ position: 'relative' }} ref={box}>
      <button
        type="button"
        ref={trigger}
        className="billing-button billing-button--small"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>

      {open && (
        <div className="billing-menu" role="menu">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className="billing-menu__item"
              disabled={Boolean(item.unavailable) || !item.onSelect}
              title={item.unavailable}
              style={item.unavailable ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
              onClick={() => {
                setOpen(false)
                item.onSelect?.()
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
