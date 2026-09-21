/**
 * The bill-by-bill list: a ledger on a desk, cards on a phone.
 *
 * Both are drawn from the SAME page of the SAME rows — the phone is not a
 * reduced dataset, only a different arrangement of it, so a figure cannot
 * differ between the two. A ten-column table squeezed onto a 390px screen is a
 * table nobody reads, and a phone behind a counter is where half of this
 * product is used.
 *
 * A figure the API did not send prints as "not known", never as ₹0.00. The two
 * look identical and one of them means the customer has paid.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  Filter,
  HandCoins,
  MessageSquare,
  MoreHorizontal,
} from 'lucide-react'
import { date, money } from '../ui'
import { Badge } from '../dashboards/kit'
import type { BadgeTone } from '../dashboards/kit'
import { ageingDefinition, STATUS_WORDS, type DueRow, type SortDirection, type SortKey } from './model'

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

const TIMING_TONES: Record<DueRow['timing'], BadgeTone> = {
  not_yet_due: 'success',
  due_today: 'warning',
  due_soon: 'info',
  overdue: 'danger',
  no_due_date: 'neutral',
}

/**
 * Where the bill stands, in a word.
 *
 * Part paid is a second badge rather than a replacement for the first: a bill
 * that is half settled and ninety days late is still ninety days late, and one
 * pill that could only say "Partially paid" would hide the half that decides
 * whether anyone rings the customer today.
 */
export function StatusPill({ row }: { row: DueRow }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
      <Badge tone={TIMING_TONES[row.timing]}>{STATUS_WORDS[row.timing]}</Badge>
      {row.partPaid && <Badge tone="info">Part paid</Badge>}
    </span>
  )
}

/** Days late, days to run, or neither — each said in words as well as colour. */
export function DaysCell({ row }: { row: DueRow }) {
  if (row.timing === 'no_due_date') {
    return <span className="billing-dues-days--none">—</span>
  }
  if (row.daysOverdue > 0) {
    return (
      <span className="billing-dues-days--late">
        {row.daysOverdue} {row.daysOverdue === 1 ? 'day' : 'days'} late
      </span>
    )
  }
  if (row.timing === 'due_today') {
    return <span className="billing-dues-days--today">Today</span>
  }

  return (
    <span className="billing-dues-days--safe">
      in {row.daysUntilDue} {row.daysUntilDue === 1 ? 'day' : 'days'}
    </span>
  )
}

/** An amount, or an honest blank where Books sent no figure. */
function Amount({ value, strong = false }: { value: number | null; strong?: boolean }) {
  if (value === null) {
    return (
      <span className="billing-dues-unknown" title="Smart Books did not send an invoice value for this bill.">
        not known
      </span>
    )
  }

  return <span className={strong ? 'billing-dues-strong' : undefined}>{money(value)}</span>
}

// ---------------------------------------------------------------------------
// Row actions
// ---------------------------------------------------------------------------

export interface RowAction {
  key: string
  label: string
  icon: ReactNode
  onSelect: (row: DueRow) => void
  /** A separator is drawn above this entry. */
  separated?: boolean
}

function RowMenu({ row, actions }: { row: DueRow; actions: RowAction[] }) {
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

  if (actions.length === 0) return null

  return (
    <div className="billing-dues-rowmenu" ref={box}>
      <button
        type="button"
        ref={trigger}
        className="billing-dues-rowmenu__trigger"
        aria-label={`Actions for ${row.billNo ?? 'this bill'} of ${row.accountName}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={17} aria-hidden />
      </button>

      {open && (
        <div className="billing-dues-rowmenu__list" role="menu">
          {actions.map((action) => (
            <div key={action.key}>
              {action.separated && <div className="billing-dues-rowmenu__sep" role="separator" />}
              <button
                type="button"
                role="menuitem"
                className="billing-dues-rowmenu__item"
                onClick={() => {
                  setOpen(false)
                  action.onSelect(row)
                }}
              >
                {action.icon}
                {action.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** The icons the screen hands to its row actions, kept in one place. */
export const ROW_ICONS = {
  receipt: <HandCoins size={15} aria-hidden />,
  reminder: <MessageSquare size={15} aria-hidden />,
  statement: <FileText size={15} aria-hidden />,
  filter: <Filter size={15} aria-hidden />,
  copy: <Copy size={15} aria-hidden />,
} as const

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

interface ListProps {
  rows: DueRow[]
  selected: ReadonlySet<string>
  onToggle: (key: string) => void
  onToggleAll: () => void
  onOpenParty: (row: DueRow) => void
  actions: RowAction[]
  sort: SortKey
  dir: SortDirection
  onSort: (key: SortKey) => void
  /** True while a fresh page is in flight, so the rows can dim without vanishing. */
  busy?: boolean
  selectable: boolean
}

function SortHeader({
  label,
  column,
  sort,
  dir,
  onSort,
  numeric = false,
}: {
  label: string
  column: SortKey
  sort: SortKey
  dir: SortDirection
  onSort: (key: SortKey) => void
  numeric?: boolean
}) {
  const active = sort === column
  const Icon = dir === 'asc' ? ArrowUp : ArrowDown

  return (
    <th
      scope="col"
      className={numeric ? 'billing-dues-num' : undefined}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button type="button" className="billing-dues-sort" onClick={() => onSort(column)}>
        {label}
        {active && <Icon size={12} aria-hidden />}
      </button>
    </th>
  )
}

export function DuesTable({
  rows,
  selected,
  onToggle,
  onToggleAll,
  onOpenParty,
  actions,
  sort,
  dir,
  onSort,
  busy = false,
  selectable,
}: ListProps) {
  const allOnPage = rows.length > 0 && rows.every((row) => selected.has(row.key))

  return (
    <div className="billing-dues-scroll">
      <table className="billing-dues-table" style={busy ? { opacity: 0.55 } : undefined}>
        <thead>
          <tr>
            {selectable && (
              <th scope="col" style={{ width: 40 }}>
                <input
                  type="checkbox"
                  checked={allOnPage}
                  onChange={onToggleAll}
                  aria-label={allOnPage ? 'Clear the selection on this page' : 'Select every bill on this page'}
                />
              </th>
            )}
            <th scope="col">Bill</th>
            <SortHeader label="Dated" column="bill_date" sort={sort} dir={dir} onSort={onSort} />
            <SortHeader label="Party" column="account_name" sort={sort} dir={dir} onSort={onSort} />
            <SortHeader label="Due" column="due_date" sort={sort} dir={dir} onSort={onSort} />
            <SortHeader label="Standing" column="days_overdue" sort={sort} dir={dir} onSort={onSort} />
            <th scope="col" className="billing-dues-num">Bill amount</th>
            <th scope="col" className="billing-dues-num">Received</th>
            <SortHeader label="Outstanding" column="balance" sort={sort} dir={dir} onSort={onSort} numeric />
            <th scope="col">Status</th>
            <th scope="col" style={{ width: 48 }}>
              <span className="billing-sr-only">Actions</span>
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr key={row.key} data-selected={selected.has(row.key) ? 'true' : undefined}>
              {selectable && (
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(row.key)}
                    onChange={() => onToggle(row.key)}
                    aria-label={`Select ${row.billNo ?? 'the bill'} of ${row.accountName}, ${money(row.balance)} outstanding`}
                  />
                </td>
              )}

              <td>
                <span style={{ fontWeight: 650 }}>{row.billNo ?? '—'}</span>
              </td>

              <td>{date(row.billDate)}</td>

              <td>
                <div className="billing-dues-party">
                  <button
                    type="button"
                    className="billing-dues-sort billing-dues-party__name"
                    style={{ color: 'var(--billing-action)' }}
                    onClick={() => onOpenParty(row)}
                  >
                    {row.accountName}
                  </button>
                  <span className="billing-dues-party__meta">{ageingDefinition(row.bucket).label}</span>
                </div>
              </td>

              <td>{date(row.dueDate)}</td>
              <td><DaysCell row={row} /></td>
              <td className="billing-dues-num"><Amount value={row.billAmount} /></td>
              <td className="billing-dues-num"><Amount value={row.received} /></td>
              <td className="billing-dues-num"><Amount value={row.balance} strong /></td>
              <td><StatusPill row={row} /></td>
              <td>
                <RowMenu row={row} actions={actions} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The same rows, as cards
// ---------------------------------------------------------------------------

export function DuesCards({
  rows,
  selected,
  onToggle,
  onOpenParty,
  actions,
  selectable,
}: Pick<ListProps, 'rows' | 'selected' | 'onToggle' | 'onOpenParty' | 'actions' | 'selectable'>) {
  const [open, setOpen] = useState<string | null>(null)

  return (
    <div className="billing-dues-cards">
      {rows.map((row) => {
        const expanded = open === row.key

        return (
          <article key={row.key} className="billing-dues-mcard" data-selected={selected.has(row.key) ? 'true' : undefined}>
            <div className="billing-dues-mcard__top">
              {selectable && (
                <input
                  type="checkbox"
                  checked={selected.has(row.key)}
                  onChange={() => onToggle(row.key)}
                  aria-label={`Select ${row.billNo ?? 'the bill'} of ${row.accountName}`}
                  style={{ marginTop: 3 }}
                />
              )}

              <div className="billing-dues-mcard__body">
                <div className="billing-dues-mcard__row">
                  <span style={{ fontWeight: 700 }}>{row.billNo ?? 'No bill number'}</span>
                  <span className="billing-dues-mcard__amount">{money(row.balance)}</span>
                </div>

                <button
                  type="button"
                  className="billing-dues-sort billing-dues-mcard__party"
                  style={{ color: 'var(--billing-action)' }}
                  onClick={() => onOpenParty(row)}
                >
                  {row.accountName}
                </button>

                <div className="billing-dues-mcard__meta">
                  <StatusPill row={row} />
                  <span>Due {date(row.dueDate)}</span>
                  <DaysCell row={row} />
                </div>
              </div>

              <RowMenu row={row} actions={actions} />
            </div>

            {expanded && (
              <div className="billing-dues-mcard__more">
                <dl>
                  <dt>Dated</dt>
                  <dd>{date(row.billDate)}</dd>
                  <dt>Bill amount</dt>
                  <dd><Amount value={row.billAmount} /></dd>
                  <dt>Received</dt>
                  <dd><Amount value={row.received} /></dd>
                  <dt>Age</dt>
                  <dd>{ageingDefinition(row.bucket).label}</dd>
                </dl>
              </div>
            )}

            <button
              type="button"
              className="billing-dues-mcard__toggle"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? null : row.key)}
            >
              {expanded ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
              {expanded ? 'Less' : 'More detail'}
            </button>
          </article>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// While it loads
// ---------------------------------------------------------------------------

/**
 * Skeleton rows in the shape the table will have.
 *
 * The same column count and the same row height, so nothing moves under a
 * finger already travelling toward a button when the response lands.
 */
export function TableSkeleton({ rows = 6, columns = 11 }: { rows?: number; columns?: number }) {
  return (
    <div className="billing-dues-scroll" aria-busy="true">
      <span className="billing-sr-only">Reading the bills</span>
      <table className="billing-dues-table">
        <tbody>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row}>
              {Array.from({ length: columns }, (_, column) => (
                <td key={column}>
                  <span
                    className="billing-dues-skeleton billing-dues-skeleton--cell"
                    style={{ width: column === 3 ? '80%' : column === 0 ? '18px' : '62%' }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
