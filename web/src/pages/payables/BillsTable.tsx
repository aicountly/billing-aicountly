/**
 * The bills themselves.
 *
 * Sorting and paging happen on the server, over the whole outstanding set, so
 * page two of "largest first" is the second-largest twenty-five and not the
 * largest twenty-five of an arbitrary page. Every header that can be ordered by
 * is a real button carrying aria-sort, so the order is announced rather than
 * only drawn.
 */

import { useCallback, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Banknote,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Eye,
  FileText,
  MoreHorizontal,
  Users,
} from 'lucide-react'
import { date, money, moneyPlain } from '../../ui'
import { DaysCell, PartPaidBadge, Skeleton, StatusBadge, avatarColour, initials, useDismiss } from './parts'
import { PAGE_SIZES, type PayablesQuery } from './query'
import type { PayableBill, PayablesPagination, PayablesWorkspace } from '../../services/types'

interface Column {
  key: string
  label: string
  sort?: string
  numeric?: boolean
}

const COLUMNS: Column[] = [
  { key: 'bill_no', label: 'Bill no.', sort: 'bill_no' },
  { key: 'bill_date', label: 'Date', sort: 'bill_date' },
  { key: 'supplier', label: 'Supplier', sort: 'supplier' },
  { key: 'reference', label: 'Reference', sort: 'reference' },
  { key: 'due_date', label: 'Due date', sort: 'due_date' },
  { key: 'days', label: 'Days', sort: 'days' },
  { key: 'amount', label: 'Amount (₹)', sort: 'amount', numeric: true },
  { key: 'status', label: 'Status', sort: 'status' },
]

export function PayablesTable({
  workspace,
  query,
  patch,
  loading,
  canRecordPayment,
  canViewStatement,
  selected,
  onToggle,
  onToggleAll,
  onOpenBill,
  onRecordPayment,
  onOpenSupplier,
}: {
  workspace: PayablesWorkspace | null
  query: PayablesQuery
  patch: (changes: Partial<PayablesQuery>) => void
  loading: boolean
  canRecordPayment: boolean
  canViewStatement: boolean
  selected: Set<string>
  onToggle: (bill: PayableBill) => void
  onToggleAll: (bills: PayableBill[], select: boolean) => void
  onOpenBill: (bill: PayableBill) => void
  onRecordPayment: (bill: PayableBill) => void
  onOpenSupplier: (bill: PayableBill) => void
}) {
  const bills = workspace?.bills ?? []
  const allOnPageSelected = bills.length > 0 && bills.every((bill) => selected.has(bill.row_key))

  function order(column: Column) {
    if (!column.sort) return
    const same = query.sort_by === column.sort
    patch({ sort_by: column.sort, sort_dir: same && query.sort_dir === 'asc' ? 'desc' : 'asc' })
  }

  return (
    <>
      <div className="mtp-table-scroll">
        <table className="mtp-table">
          <thead>
            <tr>
              <th scope="col" style={{ width: 40 }}>
                <span>
                  <input
                    type="checkbox"
                    className="mtp-tick"
                    checked={allOnPageSelected}
                    disabled={bills.length === 0}
                    onChange={(event) => onToggleAll(bills, event.target.checked)}
                    aria-label={allOnPageSelected ? 'Clear the bills selected on this page' : 'Select every bill on this page'}
                  />
                </span>
              </th>
              {COLUMNS.map((column) => {
                const active = query.sort_by === column.sort
                const Arrow = !active ? ChevronsUpDown : query.sort_dir === 'asc' ? ArrowUp : ArrowDown

                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={column.numeric ? 'mtp-num' : undefined}
                    aria-sort={active ? (query.sort_dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <button
                      type="button"
                      className={`mtp-sort${active ? ' mtp-sort--active' : ''}`}
                      onClick={() => order(column)}
                      title={`Sort by ${column.label.toLowerCase()}`}
                    >
                      {column.label}
                      <span className="mtp-sort__icon" aria-hidden="true"><Arrow size={13} /></span>
                    </button>
                  </th>
                )
              })}
              <th scope="col" className="mtp-num" style={{ width: 96 }}>
                <span className="billing-sr-only">Actions</span>
              </th>
            </tr>
          </thead>

          <tbody>
            {loading && bills.length === 0
              ? Array.from({ length: 6 }, (_, index) => (
                  <tr key={`skeleton-${index}`} aria-hidden="true">
                    {Array.from({ length: COLUMNS.length + 2 }, (__, cell) => (
                      <td key={cell}><Skeleton /></td>
                    ))}
                  </tr>
                ))
              : bills.map((bill) => (
                  <Row
                    key={bill.row_key}
                    bill={bill}
                    selected={selected.has(bill.row_key)}
                    canRecordPayment={canRecordPayment}
                    canViewStatement={canViewStatement}
                    onToggle={() => onToggle(bill)}
                    onOpen={() => onOpenBill(bill)}
                    onRecordPayment={() => onRecordPayment(bill)}
                    onOpenSupplier={() => onOpenSupplier(bill)}
                  />
                ))}
          </tbody>
        </table>
      </div>

      {workspace && (
        <Footer
          pagination={workspace.pagination}
          filteredAmount={workspace.filtered.amount}
          pageSize={query.page_size}
          onPage={(page) => patch({ page })}
          onPageSize={(size) => patch({ page_size: size })}
        />
      )}
    </>
  )
}

function Row({
  bill,
  selected,
  canRecordPayment,
  canViewStatement,
  onToggle,
  onOpen,
  onRecordPayment,
  onOpenSupplier,
}: {
  bill: PayableBill
  selected: boolean
  canRecordPayment: boolean
  canViewStatement: boolean
  onToggle: () => void
  onOpen: () => void
  onRecordPayment: () => void
  onOpenSupplier: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const close = useCallback(() => setMenuOpen(false), [])
  const menu = useDismiss<HTMLDivElement>(menuOpen, close)
  const label = bill.bill_no ?? bill.document_no ?? 'this bill'

  return (
    <tr data-selected={selected}>
      <td>
        <input
          type="checkbox"
          className="mtp-tick"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${label} from ${bill.account_name}`}
        />
      </td>

      <td>
        <button type="button" className="mtp-billno" onClick={onOpen}>
          {bill.bill_no ?? <span style={{ color: 'var(--billing-muted)', fontWeight: 400 }}>not recorded</span>}
        </button>
      </td>

      <td style={{ whiteSpace: 'nowrap' }}>{date(bill.bill_date)}</td>

      <td>
        <span className="mtp-party">
          <span className="mtp-party__avatar" style={{ background: avatarColour(bill.account_id, bill.account_name) }} aria-hidden="true">
            {initials(bill.account_name)}
          </span>
          <span className="mtp-party__text">
            {canViewStatement ? (
              <button type="button" className="mtp-party__name" onClick={onOpenSupplier} title={`Open ${bill.account_name}'s statement`}>
                {bill.account_name}
              </button>
            ) : (
              <span className="mtp-party__name" title={bill.account_name}>{bill.account_name}</span>
            )}
            {bill.category && <span className="mtp-party__sub">{bill.category}</span>}
          </span>
        </span>
      </td>

      <td style={{ color: bill.reference ? undefined : 'var(--billing-muted)' }}>{bill.reference ?? '—'}</td>

      <td style={{ whiteSpace: 'nowrap' }}>{date(bill.due_date)}</td>

      <td><DaysCell status={bill.status} daysOverdue={bill.days_overdue} daysToDue={bill.days_to_due} /></td>

      <td className="mtp-num">
        <strong>{moneyPlain(bill.balance)}</strong>
        {bill.partially_paid && bill.bill_amount !== null && (
          <span style={{ display: 'block', color: 'var(--billing-muted)', fontSize: 10.5 }}>
            of {moneyPlain(bill.bill_amount)}
          </span>
        )}
      </td>

      <td>
        <span style={{ display: 'inline-flex', gap: 5, flexWrap: 'wrap' }}>
          <StatusBadge status={bill.status} />
          {bill.partially_paid && <PartPaidBadge />}
        </span>
      </td>

      <td>
        <div className="mtp-rowactions" ref={menu}>
          <button type="button" className="mtp-iconbutton" onClick={onOpen} aria-label={`View ${label}`} title="View bill">
            <Eye size={15} aria-hidden />
          </button>
          <button
            type="button"
            className="mtp-iconbutton"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={`More actions for ${label}`}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <MoreHorizontal size={15} aria-hidden />
          </button>

          {menuOpen && (
            <div className="mtp-menu" role="menu" style={{ textAlign: 'left' }}>
              <button type="button" className="mtp-menu__item" role="menuitem" onClick={() => { close(); onOpen() }}>
                <FileText size={15} aria-hidden /> Bill details
              </button>
              {canRecordPayment && (
                <button type="button" className="mtp-menu__item" role="menuitem" onClick={() => { close(); onRecordPayment() }}>
                  <Banknote size={15} aria-hidden /> Record a payment
                </button>
              )}
              {canViewStatement && (
                <button type="button" className="mtp-menu__item" role="menuitem" onClick={() => { close(); onOpenSupplier() }}>
                  <Users size={15} aria-hidden /> Supplier statement
                </button>
              )}
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

/**
 * Which rows these are, and how to reach the rest.
 *
 * The page numbers are a window around the current one: a company with two
 * hundred pages does not need two hundred buttons, and first/last are there for
 * the two jumps people actually make.
 */
function Footer({
  pagination,
  filteredAmount,
  pageSize,
  onPage,
  onPageSize,
}: {
  pagination: PayablesPagination
  filteredAmount: number
  pageSize: number
  onPage: (page: number) => void
  onPageSize: (size: number) => void
}) {
  const { page, pages, total, from, to } = pagination
  const first = Math.max(1, Math.min(page - 2, pages - 4))
  const window = Array.from({ length: Math.min(5, pages) }, (_, index) => first + index).filter((n) => n >= 1 && n <= pages)

  return (
    <div className="mtp-tablefoot">
      <span>
        {total === 0
          ? 'No bills to show'
          : `Showing ${from.toLocaleString('en-IN')}–${to.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')} bill${total === 1 ? '' : 's'} · ${money(filteredAmount)}`}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>Rows</span>
          <select
            className="mtp-pagesize"
            value={pageSize}
            onChange={(event) => onPageSize(Number(event.target.value))}
            aria-label="Rows per page"
          >
            {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>

        {pages > 1 && (
          <nav className="mtp-pager" aria-label="Pages of bills">
            <button type="button" onClick={() => onPage(1)} disabled={page === 1} aria-label="First page">
              <ChevronsLeft size={14} aria-hidden />
            </button>
            <button type="button" onClick={() => onPage(page - 1)} disabled={page === 1} aria-label="Previous page">
              <ChevronLeft size={14} aria-hidden />
            </button>
            {window.map((number) => (
              <button
                key={number}
                type="button"
                onClick={() => onPage(number)}
                aria-current={number === page ? 'page' : undefined}
                aria-label={`Page ${number}`}
              >
                {number}
              </button>
            ))}
            <button type="button" onClick={() => onPage(page + 1)} disabled={page === pages} aria-label="Next page">
              <ChevronRight size={14} aria-hidden />
            </button>
            <button type="button" onClick={() => onPage(pages)} disabled={page === pages} aria-label="Last page">
              <ChevronsRight size={14} aria-hidden />
            </button>
          </nav>
        )}
      </div>
    </div>
  )
}
