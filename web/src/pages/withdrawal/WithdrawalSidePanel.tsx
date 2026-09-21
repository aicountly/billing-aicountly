/**
 * The column beside the form: what is in the account, what has gone out of it
 * lately, and the three things somebody on this screen does next.
 *
 * None of it is decoration and none of it is sample data. The balance is read
 * live from Books through `v1/cash-bank`, the list is this company's own
 * recorded withdrawals, and the thirty-day figures are counted from the same
 * rows the list is drawn from. Every card fails on its own: Books being slow
 * costs the panel, never the form.
 */

import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Copy,
  Eye,
  History,
  Landmark,
  MoreVertical,
  Plus,
  RotateCcw,
  Wallet,
  Zap,
} from 'lucide-react'
import type { ItemResponse } from '../../services/api'
import type { AsyncState } from '../../hooks/useApi'
import type { CashBank, RecentBankMovement, RecentBankMovements } from '../../services/types'
import { money } from '../../ui'
import type { AccountOption } from './accounts'

export interface WithdrawalSidePanelProps {
  selectedBank: AccountOption | null
  balances: AsyncState<ItemResponse<CashBank>>
  /** The amount currently typed, for the estimate. Null when it is not a number. */
  amount: number | null
  recent: AsyncState<ItemResponse<RecentBankMovements>>
  onCopy: (row: RecentBankMovement) => void
  onRepeatLast: () => void
  onNewWithdrawal: () => void
  /**
   * Going somewhere else, through the page's unsaved-work guard.
   *
   * Every outward link on this panel goes through it rather than navigating on
   * its own, so "View the entry" cannot quietly discard a half-typed
   * withdrawal on the way.
   */
  onLeave: (path: string) => void
  /** `reports.view` — the registers live there and nowhere else in this product. */
  canOpenReports: boolean
}

export function WithdrawalSidePanel(props: WithdrawalSidePanelProps) {
  return (
    <aside className="billing-withdrawal__aside" aria-label="Account context and shortcuts">
      <AccountBalanceCard
        selectedBank={props.selectedBank}
        balances={props.balances}
        amount={props.amount}
        recent={props.recent}
        onLeave={props.onLeave}
        canOpenReports={props.canOpenReports}
      />
      <RecentWithdrawalsCard
        recent={props.recent}
        onCopy={props.onCopy}
        onNewWithdrawal={props.onNewWithdrawal}
        onLeave={props.onLeave}
        canOpenReports={props.canOpenReports}
      />
      <QuickActionsCard
        onNewWithdrawal={props.onNewWithdrawal}
        onRepeatLast={props.onRepeatLast}
        canRepeat={(props.recent.data?.data.rows?.length ?? 0) > 0}
        onLeave={props.onLeave}
        canOpenReports={props.canOpenReports}
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
  amount,
  recent,
  onLeave,
  canOpenReports,
}: {
  selectedBank: AccountOption | null
  balances: AsyncState<ItemResponse<CashBank>>
  amount: number | null
  recent: AsyncState<ItemResponse<RecentBankMovements>>
  onLeave: (path: string) => void
  canOpenReports: boolean
}) {
  const state = balances.data?.data

  return (
    <section className="billing-withdrawal-aside-card billing-withdrawal-balance-card" aria-labelledby="withdrawal-balance-title">
      <div className="billing-withdrawal-aside-card__head">
        <div className="billing-withdrawal-aside-card__heading">
          <Landmark size={17} aria-hidden />
          <h2 id="withdrawal-balance-title">Account balance</h2>
        </div>
        {canOpenReports && (
          <button
            type="button"
            className="billing-withdrawal-inline-action"
            title="Balances are Smart Books' own — open the cash and bank summary in Reports"
            onClick={() => onLeave('/reports')}
          >
            View statement <ArrowRight size={12} aria-hidden style={{ verticalAlign: '-1px' }} />
          </button>
        )}
      </div>

      {balances.loading && (
        <div aria-busy="true">
          <span className="billing-sr-only">Loading the account balance</span>
          <span className="billing-skeleton" style={{ height: 72, borderRadius: 12, display: 'block' }} />
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

      {/* The profile does not show balances. Not an error, and not a retry. */}
      {!balances.loading && !balances.error && state && !state.available && (
        <p className="billing-withdrawal-note">
          <Wallet size={14} aria-hidden />
          {state.reason ?? 'Balances are not shown with your Billing profile. You can still record the withdrawal.'}
        </p>
      )}

      {!balances.loading && !balances.error && state?.available && !selectedBank && (
        <p className="billing-withdrawal-note">
          <Landmark size={14} aria-hidden />
          Select a bank account to view its balance.
        </p>
      )}

      {!balances.loading && !balances.error && selectedBank && (
        <>
          <div className="billing-withdrawal-balance">
            <div className="billing-withdrawal-balance__who">
              <span className="billing-withdrawal-balance__mark" aria-hidden>
                <Landmark size={19} />
              </span>
              <div style={{ minWidth: 0 }}>
                <p className="billing-withdrawal-balance__name" title={selectedBank.name}>{selectedBank.name}</p>
                {selectedBank.accountNo && <p className="billing-withdrawal-balance__sub">{selectedBank.accountNo}</p>}
              </div>
            </div>

            {selectedBank.balance !== null && (
              <div className="billing-withdrawal-balance__figure">
                <div
                  className={`billing-withdrawal-balance__amount${
                    selectedBank.balance < 0 ? ' billing-withdrawal-balance__amount--negative' : ''
                  }`}
                >
                  {money(selectedBank.balance)}
                </div>
                <div className="billing-withdrawal-balance__caption">Available balance</div>
              </div>
            )}
          </div>

          {selectedBank.balance !== null && amount !== null && amount > 0 && (
            <BalancePreview available={selectedBank.balance} amount={amount} />
          )}
        </>
      )}

      <ThirtyDays recent={recent} />
    </section>
  )
}

/**
 * What the balance would be afterwards.
 *
 * Arithmetic on screen and nothing else: no call is made and nothing is written
 * until Save is pressed. It is deliberately called an estimate, because between
 * this render and the save somebody else may have banked the day's takings.
 *
 * Going below zero WARNS and never blocks. An overdraft is a real facility, and
 * only Books knows whether this account has one — refusing the entry here would
 * be this screen inventing a rule the accounts do not have.
 */
function BalancePreview({ available, amount }: { available: number; amount: number }) {
  const after = available - amount

  return (
    <div className="billing-withdrawal-preview">
      <div className="billing-withdrawal-preview__row">
        <span>Available balance</span>
        <b>{money(available)}</b>
      </div>
      <div className="billing-withdrawal-preview__row">
        <span>This withdrawal</span>
        <b>− {money(amount)}</b>
      </div>
      <div
        className={`billing-withdrawal-preview__row billing-withdrawal-preview__row--total${
          after < 0 ? ' billing-withdrawal-preview__short' : ''
        }`}
      >
        <span>Estimated balance</span>
        <b>{money(after)}</b>
      </div>

      {after < 0 && (
        <p className="billing-withdrawal-preview__warn">
          <AlertTriangle size={13} aria-hidden />
          <span>
            This is more than the balance Smart Books shows. Save it if the account has an overdraft — otherwise check
            the amount.
          </span>
        </p>
      )}
    </div>
  )
}

/** How much has gone out of this account lately, from this product's own record. */
function ThirtyDays({ recent }: { recent: AsyncState<ItemResponse<RecentBankMovements>> }) {
  const summary = recent.data?.data.summary

  if (recent.loading) {
    return (
      <div className="billing-withdrawal-stats" aria-busy="true">
        <span className="billing-sr-only">Loading recent withdrawal totals</span>
        <span className="billing-skeleton billing-skeleton--line" style={{ width: '70%' }} />
      </div>
    )
  }

  if (!summary) return null

  return (
    <div className="billing-withdrawal-stats">
      <div>
        <div className="billing-withdrawal-stats__label">Last {summary.days} days withdrawals</div>
        <div className="billing-withdrawal-stats__value">{money(summary.total)}</div>
      </div>
      <div className="billing-withdrawal-stats__count">
        <div className="billing-withdrawal-stats__value">{summary.count}</div>
        <div className="billing-withdrawal-stats__label">
          {summary.count === 1 ? 'Transaction' : 'Transactions'}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recent withdrawals
// ---------------------------------------------------------------------------

function RecentWithdrawalsCard({
  recent,
  onCopy,
  onNewWithdrawal,
  onLeave,
  canOpenReports,
}: {
  recent: AsyncState<ItemResponse<RecentBankMovements>>
  onCopy: (row: RecentBankMovement) => void
  onNewWithdrawal: () => void
  onLeave: (path: string) => void
  canOpenReports: boolean
}) {
  const data = recent.data?.data
  const rows = data?.rows ?? []

  return (
    <section className="billing-withdrawal-aside-card" aria-labelledby="withdrawal-recent-title">
      <div className="billing-withdrawal-aside-card__head">
        <div className="billing-withdrawal-aside-card__heading">
          <History size={17} aria-hidden />
          <h2 id="withdrawal-recent-title">Recent bank withdrawals</h2>
        </div>
        {canOpenReports && rows.length > 0 && (
          <button
            type="button"
            className="billing-withdrawal-inline-action"
            title="Withdrawals are contra vouchers in Smart Books — open the register in Reports"
            onClick={() => onLeave('/reports')}
          >
            View all <ArrowRight size={12} aria-hidden style={{ verticalAlign: '-1px' }} />
          </button>
        )}
      </div>

      {recent.loading && (
        <div aria-busy="true">
          <span className="billing-sr-only">Loading recent bank withdrawals</span>
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className="billing-withdrawal-skeleton-row">
              <span className="billing-skeleton" style={{ width: 40, height: 42, borderRadius: 10 }} />
              <span className="billing-skeleton billing-skeleton--line" style={{ width: '60%' }} />
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
          <span className="billing-withdrawal-empty__mark" aria-hidden>
            <Landmark size={19} />
          </span>
          <strong>No bank withdrawals yet</strong>
          <p>Recorded bank-to-cash withdrawals will appear here.</p>
          <button type="button" className="billing-button billing-button--small" onClick={onNewWithdrawal}>
            <Plus size={14} aria-hidden /> Create first withdrawal
          </button>
        </div>
      )}

      {rows.length > 0 && (
        <div className="billing-withdrawal-recent">
          {rows.map((row) => (
            <RecentRow key={row.request_id} row={row} onCopy={onCopy} onLeave={onLeave} />
          ))}
        </div>
      )}

      {data?.basis && rows.length > 0 && <p className="billing-withdrawal-footnote">{data.basis}</p>}
    </section>
  )
}

function RecentRow({
  row,
  onCopy,
  onLeave,
}: {
  row: RecentBankMovement
  onCopy: (row: RecentBankMovement) => void
  onLeave: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)

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

  const from = row.from_name ?? (row.from_id === null ? 'Bank account' : `Account ${row.from_id}`)
  const meta = [from, row.reference ?? row.voucher_no].filter(Boolean).join(' • ')
  const label = `${row.amount === null ? 'Withdrawal' : money(row.amount)} on ${dayOf(row.date)} ${monthOf(row.date)}`

  return (
    <article className="billing-withdrawal-recent__row">
      <span className="billing-withdrawal-recent__date" aria-hidden>
        <span className="billing-withdrawal-recent__day">{dayOf(row.date)}</span>
        <span className="billing-withdrawal-recent__month">{monthOf(row.date)}</span>
      </span>

      <span className="billing-withdrawal-recent__main">
        <span className="billing-withdrawal-recent__amount">{row.amount === null ? '—' : money(row.amount)}</span>
        <span className="billing-withdrawal-recent__meta" title={meta}>{meta}</span>
      </span>

      {/* The ledger it landed in. "Cash" is the fallback only when Books did not
          answer for the names — never a label invented over a real one. */}
      <span className="billing-withdrawal-recent__badge" title={row.to_name ?? undefined}>
        {row.to_name ?? 'Cash'}
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
                onLeave(`/bank-cash/${row.request_id}`)
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
              <Copy size={15} aria-hidden /> Use these accounts
            </button>
            {/* Editing and cancelling a posted contra belong to Smart Books,
                which owns the voucher. There is no Billing route that would do
                it, so there is no button here that pretends otherwise. */}
            <p className="billing-withdrawal-menu__note">
              Changing or cancelling a posted entry is done in Smart Books.
            </p>
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
  onNewWithdrawal,
  onRepeatLast,
  canRepeat,
  onLeave,
  canOpenReports,
}: {
  onNewWithdrawal: () => void
  onRepeatLast: () => void
  canRepeat: boolean
  onLeave: (path: string) => void
  canOpenReports: boolean
}) {
  return (
    <section className="billing-withdrawal-aside-card billing-withdrawal-quick" aria-labelledby="withdrawal-quick-title">
      <div className="billing-withdrawal-aside-card__head">
        <div className="billing-withdrawal-aside-card__heading">
          <Zap size={16} aria-hidden />
          <h2 id="withdrawal-quick-title">Quick actions</h2>
        </div>
      </div>

      <div className="billing-withdrawal-quick__buttons">
        <button type="button" className="billing-withdrawal-quick__button" onClick={onNewWithdrawal}>
          <Plus size={17} aria-hidden />
          <span className="billing-withdrawal-quick__label">New withdrawal</span>
        </button>

        <button
          type="button"
          className="billing-withdrawal-quick__button"
          onClick={onRepeatLast}
          disabled={!canRepeat}
          title={
            canRepeat
              ? 'Fills in the two accounts from the last withdrawal. The amount and reference stay empty.'
              : 'Nothing recorded from Billing yet'
          }
        >
          <RotateCcw size={17} aria-hidden />
          <span className="billing-withdrawal-quick__label">Repeat from last</span>
        </button>

        {canOpenReports && (
          <button
            type="button"
            className="billing-withdrawal-quick__button"
            title="The cash and bank summary is one of Smart Books' registers, read in Reports"
            onClick={() => onLeave('/reports')}
          >
            <BookOpen size={17} aria-hidden />
            <span className="billing-withdrawal-quick__label">Cash book</span>
          </button>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// The date tile
// ---------------------------------------------------------------------------

const DAY = new Intl.DateTimeFormat('en-IN', { day: '2-digit' })
const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'short' })

function dayOf(value: string): string {
  const parsed = new Date(value)

  return Number.isNaN(parsed.getTime()) ? '—' : DAY.format(parsed)
}

function monthOf(value: string): string {
  const parsed = new Date(value)

  return Number.isNaN(parsed.getTime()) ? '' : MONTH.format(parsed)
}
