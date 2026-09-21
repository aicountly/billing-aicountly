/**
 * The directory itself.
 *
 * A table, because this is accounting data and a column of amounts that lines
 * up is the difference between reading it and re-reading it. Below 720px it
 * becomes cards instead — a nine-column table on a phone is a horizontal
 * scrollbar with a name hidden behind it.
 *
 * Columns leave in order of how rarely they are the reason somebody opened this
 * screen: credit limit at 1280, state at 1100, GSTIN and last transaction at
 * 900. Name, what is owed, the status and the actions never leave.
 */

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  Check,
  Copy,
  FileText,
  MoreVertical,
  ReceiptIndianRupee,
  ShoppingCart,
  Wallet,
} from 'lucide-react'
import { date } from '../../ui'
import { Popover } from '../../components/Popover'
import { EmptyState, ErrorState } from '../../dashboards/kit'
import type { Party, PartySort } from '../../services/parties'
import { Absent, Amount, PartyAvatar, PartyStatusBadge, PartyTypeBadge } from './PartyBits'

export interface PartyTablePermissions {
  statement: boolean
  sale: boolean
  purchase: boolean
  receipt: boolean
  payment: boolean
}

interface Sorting {
  sort: PartySort
  order: 'asc' | 'desc'
  onSort: (sort: PartySort) => void
}

/** A header cell that can be sorted, with the arrow saying which way. */
function SortableHeader({
  column,
  label,
  sorting,
  className,
  numeric = false,
}: {
  column: PartySort
  label: string
  sorting: Sorting
  className?: string
  numeric?: boolean
}) {
  const active = sorting.sort === column
  const Arrow = active ? (sorting.order === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown

  return (
    <th
      scope="col"
      className={`${className ?? ''}${numeric ? ' billing-amount' : ''}`.trim() || undefined}
      aria-sort={active ? (sorting.order === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className="billing-parties__sort"
        data-active={active ? 'true' : undefined}
        onClick={() => sorting.onSort(column)}
      >
        {label}
        <Arrow size={12} aria-hidden />
        <span className="billing-sr-only">
          {active ? `sorted ${sorting.order === 'asc' ? 'A to Z' : 'Z to A'}` : 'not sorted'}
        </span>
      </button>
    </th>
  )
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      type="button"
      className="billing-parties__copy"
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={copied ? 'Copied' : `Copy ${label}`}
      onClick={(event) => {
        event.stopPropagation()
        // Clipboard access can be refused outright (an insecure origin, a
        // locked-down browser). Saying nothing is better than an error dialog
        // over a convenience.
        navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1600)
          })
          .catch(() => undefined)
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}

/**
 * What can be done with one party.
 *
 * Only what this profile may actually do, and only what an existing screen
 * accepts: the bill editor and the money screens both read the party off the
 * URL, so these land on a form that already knows who it is for.
 */
function PartyActions({
  party,
  permissions,
  onOpen,
}: {
  party: Party
  permissions: PartyTablePermissions
  onOpen: (party: Party) => void
}) {
  const navigate = useNavigate()
  const withParty = (path: string) =>
    `${path}?party_account_id=${party.account_id}&party_name=${encodeURIComponent(party.name)}`

  return (
    <Popover
      overlay
      ariaLabel={`What to do with ${party.name}`}
      label={<MoreVertical size={16} aria-hidden />}
    >
      {(close) => (
        <>
          <button
            type="button"
            className="billing-menu__item"
            onClick={() => {
              close()
              onOpen(party)
            }}
          >
            <ChevronRight size={15} aria-hidden /> View details
          </button>

          {permissions.statement && (
            <Link className="billing-menu__item" to={`/parties/${party.account_id}`} onClick={close}>
              <FileText size={15} aria-hidden /> Statement
            </Link>
          )}

          {party.type === 'customer' && permissions.sale && (
            <button
              type="button"
              className="billing-menu__item"
              onClick={() => {
                close()
                navigate(withParty('/sales/new'))
              }}
            >
              <ReceiptIndianRupee size={15} aria-hidden /> New bill
            </button>
          )}

          {party.type === 'supplier' && permissions.purchase && (
            <button
              type="button"
              className="billing-menu__item"
              onClick={() => {
                close()
                navigate(withParty('/purchases/new'))
              }}
            >
              <ShoppingCart size={15} aria-hidden /> Record a purchase
            </button>
          )}

          {party.type === 'customer' && permissions.receipt && (
            <button
              type="button"
              className="billing-menu__item"
              onClick={() => {
                close()
                navigate(withParty('/money-in/new'))
              }}
            >
              <Wallet size={15} aria-hidden /> Money received
            </button>
          )}

          {party.type === 'supplier' && permissions.payment && (
            <button
              type="button"
              className="billing-menu__item"
              onClick={() => {
                close()
                navigate(withParty('/money-out/new'))
              }}
            >
              <Wallet size={15} aria-hidden /> Money paid
            </button>
          )}
        </>
      )}
    </Popover>
  )
}

function NameCell({ party, onOpen }: { party: Party; onOpen: (party: Party) => void }) {
  const place = [party.city, party.group].filter(Boolean).join(' · ')

  return (
    <div className="billing-parties__name">
      <PartyAvatar party={party} />
      <span className="billing-parties__name-text">
        <button type="button" onClick={() => onOpen(party)} title={party.name}>
          {party.name}
        </button>
        {place ? <small>{place}</small> : <small className="billing-parties__muted">{party.state ?? ''}</small>}
      </span>
    </div>
  )
}

/**
 * The credit-limit cell.
 *
 * "0" and "not set" are different answers and are drawn differently: a limit of
 * zero is a decision somebody made, and no limit at all is a field Books does
 * not carry. A party past its limit is marked here, because that is the cell
 * the person checking will look at.
 */
function CreditCell({ party }: { party: Party }) {
  if (party.credit_limit === null) return <Absent reason="No credit limit set in Smart Books" />

  return (
    <span className={party.over_credit_limit ? 'billing-parties__danger' : undefined}>
      <Amount value={party.credit_limit} />
      {party.over_credit_limit && (
        <>
          {' '}
          <span className="billing-sr-only">— this party owes more than its limit</span>
          <span aria-hidden title="Owes more than this limit">
            ⚠
          </span>
        </>
      )}
    </span>
  )
}

function OutstandingCell({ party }: { party: Party }) {
  const overdue = party.overdue ?? 0

  return (
    <>
      <Amount
        value={party.outstanding}
        tone={overdue > 0 || party.over_credit_limit ? 'risk' : 'plain'}
        reason="What is owed could not be read — your profile may not include it"
      />
      {overdue > 0 && party.oldest_overdue_days ? (
        <div className="billing-parties__stat-note billing-parties__stat-note--danger">
          {party.oldest_overdue_days} days overdue
        </div>
      ) : null}
    </>
  )
}

export function PartyTable({
  rows,
  loading,
  refreshing,
  error,
  onRetry,
  selected,
  onToggle,
  onToggleAll,
  onOpen,
  permissions,
  sorting,
  emptyMessage,
  emptyAction,
  view,
}: {
  rows: Party[]
  loading: boolean
  refreshing: boolean
  error: string | null
  onRetry: () => void
  selected: ReadonlySet<number>
  onToggle: (accountId: number) => void
  onToggleAll: (select: boolean) => void
  onOpen: (party: Party) => void
  permissions: PartyTablePermissions
  sorting: Sorting
  emptyMessage: string
  emptyAction?: React.ReactNode
  view: 'table' | 'cards'
}) {
  if (error) {
    return (
      <div style={{ padding: 20 }}>
        <ErrorState message={error} onRetry={onRetry} />
      </div>
    )
  }

  // Skeleton rows only on the FIRST reading. Once there is something on screen
  // it stays there and dims, so the pager does not jump out from under a finger
  // already moving toward it.
  if (loading && rows.length === 0) {
    return (
      <div className="billing-skeleton-rows" style={{ padding: 16 }} aria-busy="true">
        <span className="billing-sr-only">Loading parties</span>
        {Array.from({ length: 8 }, (_, index) => (
          <span key={index} className="billing-skeleton billing-skeleton--line" style={{ height: 34 }} />
        ))}
      </div>
    )
  }

  if (rows.length === 0) {
    return <EmptyState action={emptyAction}>{emptyMessage}</EmptyState>
  }

  const allSelected = rows.every((row) => selected.has(row.account_id))
  const someSelected = !allSelected && rows.some((row) => selected.has(row.account_id))

  if (view === 'cards') {
    return (
      <div className={`billing-parties__cards${refreshing ? ' billing-parties__stale' : ''}`}>
        {rows.map((party) => (
          <article key={party.account_id} className="billing-parties__card">
            <div className="billing-parties__card-top">
              <NameCell party={party} onOpen={onOpen} />
              <PartyActions party={party} permissions={permissions} onOpen={onOpen} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <PartyTypeBadge type={party.type} />
              <PartyStatusBadge status={party.status} />
            </div>
            <div className="billing-parties__card-figures">
              <div>
                <span>Outstanding</span>
                <strong>
                  <OutstandingCell party={party} />
                </strong>
              </div>
              <div>
                <span>GSTIN</span>
                <strong>{party.gstin ?? <Absent />}</strong>
              </div>
              <div>
                <span>Last transaction</span>
                <strong>{party.last_transaction_at ? date(party.last_transaction_at) : <Absent />}</strong>
              </div>
            </div>
          </article>
        ))}
      </div>
    )
  }

  return (
    <div className="billing-table-scroll">
      <table className={`billing-parties__table${refreshing ? ' billing-parties__stale' : ''}`}>
        <thead>
          <tr>
            <th scope="col">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(node) => {
                  if (node) node.indeterminate = someSelected
                }}
                onChange={(event) => onToggleAll(event.target.checked)}
                aria-label={allSelected ? 'Clear this page' : 'Select every party on this page'}
              />
            </th>
            <SortableHeader column="name" label="Name" sorting={sorting} />
            <th scope="col">Type</th>
            <th scope="col" className="billing-parties__col--gstin">GSTIN</th>
            <SortableHeader column="state" label="State" sorting={sorting} className="billing-parties__col--state" />
            <SortableHeader column="outstanding" label="Outstanding" sorting={sorting} numeric />
            <SortableHeader
              column="credit_limit"
              label="Credit limit"
              sorting={sorting}
              className="billing-parties__col--credit"
              numeric
            />
            <th scope="col">Status</th>
            <SortableHeader
              column="last_transaction"
              label="Last transaction"
              sorting={sorting}
              className="billing-parties__col--last"
            />
            <th scope="col">
              <span className="billing-sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((party) => (
            <tr key={party.account_id} data-selected={selected.has(party.account_id) ? 'true' : undefined}>
              <td>
                <input
                  type="checkbox"
                  checked={selected.has(party.account_id)}
                  onChange={() => onToggle(party.account_id)}
                  aria-label={`Select ${party.name}`}
                />
              </td>
              <td>
                <NameCell party={party} onOpen={onOpen} />
              </td>
              <td>
                <PartyTypeBadge type={party.type} />
              </td>
              <td className="billing-parties__col--gstin">
                {party.gstin ? (
                  <span className="billing-parties__gstin">
                    {party.gstin}
                    <CopyButton value={party.gstin} label="GSTIN" />
                  </span>
                ) : (
                  <Absent reason="No GSTIN recorded in Smart Books" />
                )}
              </td>
              <td className="billing-parties__col--state">{party.state ?? <Absent />}</td>
              <td className="billing-amount">
                <OutstandingCell party={party} />
              </td>
              <td className="billing-amount billing-parties__col--credit">
                <CreditCell party={party} />
              </td>
              <td>
                <PartyStatusBadge status={party.status} />
              </td>
              <td className="billing-parties__col--last">
                {party.last_transaction_at ? date(party.last_transaction_at) : <Absent reason="No transaction recorded" />}
              </td>
              <td>
                <PartyActions party={party} permissions={permissions} onOpen={onOpen} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
