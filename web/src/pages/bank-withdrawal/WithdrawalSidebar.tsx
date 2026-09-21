/**
 * The column beside the form: the balance, what was withdrawn lately, and the
 * three things somebody does next.
 *
 * None of it is decoration and none of it is invented. The balance is Books',
 * read on this request through `v1/cash-bank`; the list is what THIS product
 * recorded and says so in a line under itself; the estimate is arithmetic on
 * the two and is never written anywhere. Every card fails on its own — Books
 * being slow costs the panel, never the form.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowRight,
  BookOpen,
  Copy,
  Eye,
  Landmark,
  MoreVertical,
  Plus,
  RefreshCw,
  RotateCcw,
  Wallet,
  Zap,
} from 'lucide-react'
import type { ItemResponse } from '../../services/api'
import type { AsyncState } from '../../hooks/useApi'
import type { CashBank, RecentWithdrawal, RecentWithdrawals, WithdrawalSummary } from '../../services/types'
import { money } from '../../ui'
import type { AccountOption } from './withdrawalForm'

export interface WithdrawalSidebarProps {
  selectedBank: AccountOption | null
  balances: AsyncState<ItemResponse<CashBank>>
  /** The amount typed so far, for the estimate. Zero when nothing is typed. */
  amount: number
  summary: AsyncState<ItemResponse<WithdrawalSummary>>
  recent: AsyncState<ItemResponse<RecentWithdrawals>>
  recentExpanded: boolean
  onToggleRecent: () => void
  onCopy: (row: RecentWithdrawal) => void
  onNew: () => void
  onRepeat: () => void
  canRepeat: boolean
  canViewReports: boolean
  /** Leaving this screen goes through the page, which asks about unsaved work first. */
  onNavigate: (path: string) => void
}

export function WithdrawalSidebar(props: WithdrawalSidebarProps) {
  return (
    <aside className="billing-withdrawal__aside" aria-label="Account context and shortcuts">
      <AccountBalanceCard
        selectedBank={props.selectedBank}
        balances={props.balances}
        summary={props.summary}
        amount={props.amount}
        canViewReports={props.canViewReports}
        onNavigate={props.onNavigate}
      />
      <RecentWithdrawalsCard
        recent={props.recent}
        expanded={props.recentExpanded}
        onToggle={props.onToggleRecent}
        onCopy={props.onCopy}
        onNew={props.onNew}
        onNavigate={props.onNavigate}
      />
      <QuickActionsCard
        onNew={props.onNew}
        onRepeat={props.onRepeat}
        canRepeat={props.canRepeat}
        onNavigate={props.onNavigate}
      />
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Account balance
// ---------------------------------------------------------------------------

function AccountBalanceCard({
  selectedBank,
  balances,
  summary,
  amount,
  canViewReports,
  onNavigate,
}: {
  selectedBank: AccountOption | null
  balances: AsyncState<ItemResponse<CashBank>>
  summary: AsyncState<ItemResponse<WithdrawalSummary>>
  amount: number
  canViewReports: boolean
  onNavigate: (path: string) => void
}) {
  const data = balances.data?.data
  const withheld = data !== undefined && data.available === false

  return (
    <section className="billing-withdrawal-aside-card billing-withdrawal-balance" aria-labelledby="withdrawal-balance-title">
      <div className="billing-withdrawal-aside-card__head">
        <h2 id="withdrawal-balance-title">
          <span className="billing-withdrawal-aside-card__mark" aria-hidden><Landmark size={15} /></span>
          Account balance
        </h2>
        {canViewReports && !withheld && (
          <button
            type="button"
            className="billing-withdrawal-link"
            title="Cash and bank summary, read from Smart Books in Reports"
            onClick={() => onNavigate('/reports')}
          >
            View statement <ArrowRight size={13} aria-hidden />
          </button>
        )}
      </div>

      {balances.loading && (
        <div className="billing-withdrawal-balance__box" aria-busy="true">
          <span className="billing-sr-only">Reading the balance from Smart Books</span>
          <span className="billing-skeleton billing-skeleton--line" style={{ width: '55%' }} />
          <span className="billing-skeleton billing-skeleton--value" style={{ marginTop: 10 }} />
        </div>
      )}

      {!balances.loading && balances.error && (
        <div className="billing-withdrawal-retry">
          <span>Balance is temporarily unavailable.</span>
          <button type="button" className="billing-button billing-button--small" onClick={balances.reload}>
            Retry
          </button>
        </div>
      )}

      {/* The profile does not show balances. Not an error, and not a blank card. */}
      {!balances.loading && !balances.error && withheld && (
        <p className="billing-withdrawal-note">{data?.reason ?? 'Balances are not shown with your Billing profile.'}</p>
      )}

      {!balances.loading && !balances.error && !withheld && !selectedBank && (
        <p className="billing-withdrawal-note">Select a bank account to view its balance.</p>
      )}

      {!balances.loading && !balances.error && !withheld && selectedBank && (
        <>
          <div className="billing-withdrawal-balance__box">
            <div className="billing-withdrawal-balance__identity">
              <span className="billing-withdrawal-balance__tile" aria-hidden><Landmark size={18} /></span>
              <span className="billing-withdrawal-balance__names">
                <span className="billing-withdrawal-balance__bank" title={selectedBank.name}>
                  {selectedBank.name}
                </span>
                {selectedBank.maskedNumber && (
                  <span className="billing-withdrawal-balance__number">{selectedBank.maskedNumber}</span>
                )}
              </span>
            </div>

            <div className="billing-withdrawal-balance__figure">
              {selectedBank.balance === null ? (
                <>
                  <span className="billing-withdrawal-balance__amount billing-withdrawal-balance__amount--quiet">—</span>
                  <span className="billing-withdrawal-balance__caption">No balance for this ledger</span>
                </>
              ) : (
                <>
                  <span className="billing-withdrawal-balance__amount">{money(selectedBank.balance)}</span>
                  <span className="billing-withdrawal-balance__caption">Available balance</span>
                </>
              )}
            </div>
          </div>

          {/* Arithmetic on two numbers already on screen. Nothing is written
              anywhere until the withdrawal is saved. */}
          {selectedBank.balance !== null && amount > 0 && (
            <dl className="billing-withdrawal-estimate">
              <div>
                <dt>Available balance</dt>
                <dd>{money(selectedBank.balance)}</dd>
              </div>
              <div>
                <dt>Withdrawal</dt>
                <dd className="billing-withdrawal-estimate__out">− {money(amount)}</dd>
              </div>
              <div className="billing-withdrawal-estimate__total">
                <dt>Estimated balance</dt>
                <dd className={selectedBank.balance - amount < 0 ? 'billing-withdrawal-estimate__short' : undefined}>
                  {money(selectedBank.balance - amount)}
                </dd>
              </div>
            </dl>
          )}

          <WithdrawalStats summary={summary} />
        </>
      )}
    </section>
  )
}

/** What this product took out of the chosen account lately. Context, not a ledger. */
function WithdrawalStats({ summary }: { summary: AsyncState<ItemResponse<WithdrawalSummary>> }) {
  const data = summary.data?.data

  if (summary.loading) {
    return (
      <div className="billing-withdrawal-stats" aria-busy="true">
        <span className="billing-sr-only">Reading recent withdrawals for this account</span>
        <span className="billing-skeleton billing-skeleton--line" style={{ width: '60%' }} />
      </div>
    )
  }

  if (summary.error) {
    return (
      <div className="billing-withdrawal-retry">
        <span>Recent activity for this account could not be read.</span>
        <button type="button" className="billing-button billing-button--small" onClick={summary.reload}>
          <RefreshCw size={13} aria-hidden /> Retry
        </button>
      </div>
    )
  }

  if (!data) return null

  return (
    <>
      <div className="billing-withdrawal-stats">
        <div>
          <span className="billing-withdrawal-stats__label">Last {data.days} days withdrawals</span>
          <span className="billing-withdrawal-stats__value">{money(data.total)}</span>
        </div>
        <div className="billing-withdrawal-stats__count">
          <span className="billing-withdrawal-stats__value">{data.count}</span>
          <span className="billing-withdrawal-stats__label">
            {data.count === 1 ? 'Transaction' : 'Transactions'}
          </span>
        </div>
      </div>
      <p className="billing-withdrawal-footnote">{data.basis}</p>
    </>
  )
}

// ---------------------------------------------------------------------------
// Recent withdrawals
// ---------------------------------------------------------------------------

function RecentWithdrawalsCard({
  recent,
  expanded,
  onToggle,
  onCopy,
  onNew,
  onNavigate,
}: {
  recent: AsyncState<ItemResponse<RecentWithdrawals>>
  expanded: boolean
  onToggle: () => void
  onCopy: (row: RecentWithdrawal) => void
  onNew: () => void
  onNavigate: (path: string) => void
}) {
  const data = recent.data?.data
  const rows = data?.rows ?? []

  return (
    <section className="billing-withdrawal-aside-card" aria-labelledby="withdrawal-recent-title">
      <div className="billing-withdrawal-aside-card__head">
        <h2 id="withdrawal-recent-title">
          <span className="billing-withdrawal-aside-card__mark" aria-hidden><RotateCcw size={14} /></span>
          Recent bank withdrawals
        </h2>
        {(rows.length > 0 || expanded) && (
          <button type="button" className="billing-withdrawal-link" onClick={onToggle}>
            {expanded ? 'Show fewer' : 'View all'} <ArrowRight size={13} aria-hidden />
          </button>
        )}
      </div>

      {recent.loading && (
        <div aria-busy="true">
          <span className="billing-sr-only">Loading recent withdrawals</span>
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className="billing-withdrawal-skeleton-row">
              <span className="billing-skeleton" style={{ width: 40, height: 42, borderRadius: 9 }} />
              <span className="billing-skeleton billing-skeleton--line" style={{ width: '58%' }} />
            </div>
          ))}
        </div>
      )}

      {!recent.loading && recent.error && (
        <div className="billing-withdrawal-retry">
          <span>Recent withdrawals could not be loaded.</span>
          <button type="button" className="billing-button billing-button--small" onClick={recent.reload}>
            Retry
          </button>
        </div>
      )}

      {!recent.loading && !recent.error && rows.length === 0 && (
        <div className="billing-withdrawal-empty">
          <span className="billing-withdrawal-empty__mark" aria-hidden><Landmark size={19} /></span>
          <strong>No bank withdrawals yet</strong>
          <p>Recorded bank-to-cash withdrawals will appear here.</p>
          <button type="button" className="billing-button billing-button--soft billing-button--small" onClick={onNew}>
            <Plus size={14} aria-hidden /> Create first withdrawal
          </button>
        </div>
      )}

      {rows.length > 0 && (
        <div className="billing-withdrawal-recent">
          {rows.map((row) => (
            <RecentRow key={row.request_id} row={row} onCopy={onCopy} onNavigate={onNavigate} />
          ))}
        </div>
      )}

      {data?.basis && rows.length > 0 && <p className="billing-withdrawal-footnote">{data.basis}</p>}
      {data && rows.length > 0 && !data.names_available && (
        <p className="billing-withdrawal-footnote">
          Smart Books did not answer, so the account names are missing from these rows. The amounts are what was
          recorded.
        </p>
      )}
    </section>
  )
}

function RecentRow({
  row,
  onCopy,
  onNavigate,
}: {
  row: RecentWithdrawal
  onCopy: (row: RecentWithdrawal) => void
  onNavigate: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return undefined

    function away(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  const { day, month } = splitDate(row.date)
  const meta = [row.bank_account_name, row.reference_no].filter(Boolean).join(' • ')
  const label = `${row.amount === null ? 'Withdrawal' : money(row.amount)} on ${row.date}`

  return (
    <article className="billing-withdrawal-recent__row">
      <span className="billing-withdrawal-recent__date" aria-hidden>
        <span className="billing-withdrawal-recent__day">{day}</span>
        <span className="billing-withdrawal-recent__month">{month}</span>
      </span>

      <span className="billing-withdrawal-recent__main">
        <span className="billing-withdrawal-recent__amount">{row.amount === null ? '—' : money(row.amount)}</span>
        <span className="billing-withdrawal-recent__meta" title={meta}>
          {meta || row.voucher_no || 'Bank withdrawal'}
        </span>
      </span>

      <span className="billing-withdrawal-badge" title={row.cash_account_name ?? 'Cash'}>
        <Wallet size={11} aria-hidden />
        <span className="billing-withdrawal-badge__text">{row.cash_account_name ?? 'Cash'}</span>
      </span>

      <span className="billing-withdrawal-recent__wrap" ref={box}>
        <button
          type="button"
          className="billing-withdrawal-recent__more"
          aria-label={`More actions for ${label}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <MoreVertical size={16} aria-hidden />
        </button>

        {open && (
          <div className="billing-withdrawal-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className="billing-withdrawal-menu__item"
              onClick={() => {
                setOpen(false)
                onNavigate(`/bank-cash/${row.request_id}`)
              }}
            >
              <Eye size={15} aria-hidden /> View
            </button>
            <button
              type="button"
              role="menuitem"
              className="billing-withdrawal-menu__item"
              onClick={() => {
                setOpen(false)
                onCopy(row)
              }}
            >
              <Copy size={15} aria-hidden /> Copy accounts into this form
            </button>
            {/* Editing or cancelling a posted contra belongs to Smart Books,
                which owns the voucher. There is no Billing route that would do
                it, so there is no button here that pretends otherwise. */}
          </div>
        )}
      </span>
    </article>
  )
}

// ---------------------------------------------------------------------------
// Quick actions
// ---------------------------------------------------------------------------

function QuickActionsCard({
  onNew,
  onRepeat,
  canRepeat,
  onNavigate,
}: {
  onNew: () => void
  onRepeat: () => void
  canRepeat: boolean
  onNavigate: (path: string) => void
}) {
  return (
    <section className="billing-withdrawal-quick" aria-labelledby="withdrawal-quick-title">
      <h2 id="withdrawal-quick-title" className="billing-withdrawal-quick__title">
        <Zap size={16} aria-hidden /> Quick actions
      </h2>

      <div className="billing-withdrawal-quick__buttons">
        <QuickAction icon={<Plus size={15} />} label="New withdrawal" onClick={onNew} />
        <QuickAction
          icon={<RotateCcw size={15} />}
          label="Repeat from last"
          onClick={onRepeat}
          disabled={!canRepeat}
          title={
            canRepeat
              ? 'Fills in the bank and cash account from your last withdrawal. The amount and reference stay yours to enter.'
              : 'Nothing has been withdrawn from Billing in this company and year yet.'
          }
        />
        <QuickAction icon={<BookOpen size={15} />} label="View cash book" onClick={() => onNavigate('/bank-cash')} />
      </div>

      <p className="billing-withdrawal-quick__note">
        Repeat never copies an amount or a cheque number — those are what make two entries different.
      </p>
    </section>
  )
}

function QuickAction({
  icon,
  label,
  onClick,
  disabled = false,
  title,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <button type="button" className="billing-withdrawal-quick__button" onClick={onClick} disabled={disabled} title={title}>
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------

/** The date tile. Built from the ISO string rather than a Date, which would
    shift the day for anybody east of UTC. */
function splitDate(iso: string): { day: string; month: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return { day: '—', month: '' }

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  return { day: match[3], month: months[Number(match[2]) - 1] ?? '' }
}
