/**
 * One party, opened beside the list.
 *
 * A drawer rather than a page, because the reason people click a party in a
 * directory is to check something and carry on down the list — and a full page
 * navigation costs them their filters, their page and their place.
 *
 * The statement route at /parties/:accountId is untouched and is still where
 * the full ledger lives. This shows the short version and links to it.
 *
 * Recent activity is fetched only when the drawer opens. Loading five lines of
 * ledger for every row of a list nobody has clicked is somebody else's database
 * doing work for nothing.
 */

import { Link } from 'react-router-dom'
import { ExternalLink, FileText, ReceiptIndianRupee, ShoppingCart, Wallet } from 'lucide-react'
import { api } from '../../services/api'
import { useApi } from '../../hooks/useApi'
import { useBilling } from '../../context/BillingContext'
import { Drawer } from '../../shell/Drawer'
import { date, money } from '../../ui'
import { SkeletonRows } from '../../dashboards/kit'
import type { Party } from '../../services/parties'
import { Absent, Amount, Fact, PartyStatusBadge, PartyTypeBadge } from './PartyBits'

interface StatementResponse {
  account_id: number
  source: string
  statement: Record<string, unknown> | Array<Record<string, unknown>>
  note: string
}

/** Books' ledger arrives as a list, or as an object wrapping one. Both are read. */
function statementRows(payload: StatementResponse | undefined): Array<Record<string, unknown>> {
  const statement = payload?.statement
  if (Array.isArray(statement)) return statement
  const rows = (statement as Record<string, unknown> | undefined)?.rows
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : []
}

export function PartyDetailsDrawer({ party, onClose }: { party: Party | null; onClose: () => void }) {
  const { scope, can } = useBilling()
  const maySeeStatement = can('statement.view')

  const statement = useApi(
    (signal) =>
      api.one<StatementResponse>(`v1/parties/${party?.account_id}/statement`, undefined, signal),
    [party?.account_id, scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    Boolean(party && scope && maySeeStatement),
  )

  if (!party) return null

  const rows = statementRows(statement.data?.data).slice(-5).reverse()
  const withParty = (path: string) =>
    `${path}?party_account_id=${party.account_id}&party_name=${encodeURIComponent(party.name)}`

  return (
    <Drawer
      open
      onClose={onClose}
      side="right"
      wide
      title={
        <span style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 17, lineHeight: 1.25 }}>{party.name}</span>
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <PartyTypeBadge type={party.type} />
            <PartyStatusBadge status={party.status} />
          </span>
        </span>
      }
      footer={
        maySeeStatement ? (
          <Link
            className="billing-button billing-button--primary"
            to={`/parties/${party.account_id}`}
            style={{ flex: 1, justifyContent: 'center' }}
          >
            <FileText size={15} aria-hidden /> Full statement
          </Link>
        ) : undefined
      }
    >
      <div className="billing-parties__drawer-section">
        <h3>What they owe</h3>
        <dl className="billing-parties__facts">
          <Fact label="Outstanding">
            <Amount
              value={party.outstanding}
              tone={(party.overdue ?? 0) > 0 ? 'risk' : 'plain'}
              reason="Your Billing profile does not show what is owed"
            />
          </Fact>
          <Fact label="Overdue">
            <Amount value={party.overdue} tone={(party.overdue ?? 0) > 0 ? 'risk' : 'plain'} />
          </Fact>
          <Fact label="Credit limit">
            {party.credit_limit === null ? <Absent reason="No credit limit set in Smart Books" /> : money(party.credit_limit)}
          </Fact>
          <Fact label="Open bills">
            {party.bill_count === null ? <Absent /> : party.bill_count}
          </Fact>
        </dl>
        {party.over_credit_limit && (
          <p className="billing-parties__stat-note billing-parties__stat-note--danger" style={{ margin: 0 }}>
            This party owes more than its credit limit allows.
          </p>
        )}
      </div>

      <div className="billing-parties__drawer-section">
        <h3>Who they are</h3>
        <dl className="billing-parties__facts">
          <Fact label="GSTIN">{party.gstin ?? <Absent reason="No GSTIN recorded" />}</Fact>
          <Fact label="PAN">{party.pan ?? <Absent reason="No PAN recorded" />}</Fact>
          <Fact label="Phone">
            {party.phone ? <a href={`tel:${party.phone}`}>{party.phone}</a> : <Absent reason="No phone recorded" />}
          </Fact>
          <Fact label="Email">
            {party.email ? <a href={`mailto:${party.email}`}>{party.email}</a> : <Absent reason="No email recorded" />}
          </Fact>
          <Fact label="City">{party.city ?? <Absent />}</Fact>
          <Fact label="State">{party.state ?? <Absent />}</Fact>
          <Fact label="Group">{party.group ?? <Absent reason="Not in a group in Smart Books" />}</Fact>
          <Fact label="Last transaction">
            {party.last_transaction_at ? date(party.last_transaction_at) : <Absent reason="No transaction recorded" />}
          </Fact>
        </dl>
      </div>

      <div className="billing-parties__drawer-section">
        <h3>Do something</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {party.type === 'customer' && can('sale.create') && (
            <Link className="billing-button billing-button--small" to={withParty('/sales/new')}>
              <ReceiptIndianRupee size={15} aria-hidden /> New bill
            </Link>
          )}
          {party.type === 'supplier' && can('purchase.create') && (
            <Link className="billing-button billing-button--small" to={withParty('/purchases/new')}>
              <ShoppingCart size={15} aria-hidden /> Record a purchase
            </Link>
          )}
          {party.type === 'customer' && can('receipt.create') && (
            <Link className="billing-button billing-button--small" to={withParty('/money-in/new')}>
              <Wallet size={15} aria-hidden /> Money received
            </Link>
          )}
          {party.type === 'supplier' && can('payment.create') && (
            <Link className="billing-button billing-button--small" to={withParty('/money-out/new')}>
              <Wallet size={15} aria-hidden /> Money paid
            </Link>
          )}
        </div>
      </div>

      <div className="billing-parties__drawer-section">
        <h3>Recent activity</h3>
        {!maySeeStatement ? (
          <p className="billing-parties__stat-note" style={{ margin: 0 }}>
            Your Billing profile does not include party statements.
          </p>
        ) : statement.loading ? (
          <SkeletonRows rows={3} />
        ) : statement.error ? (
          <p className="billing-parties__stat-note" style={{ margin: 0 }}>
            Smart Books could not be reached for this ledger just now.
          </p>
        ) : rows.length === 0 ? (
          <p className="billing-parties__stat-note" style={{ margin: 0 }}>
            Nothing recorded against this party in the open financial year.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {rows.map((row, index) => {
              const amount = Number(row.debit ?? 0) || Number(row.credit ?? 0) || 0
              return (
                <li
                  key={String(row.voucher_id ?? row.id ?? index)}
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}
                >
                  <span style={{ minWidth: 0 }}>
                    <strong style={{ fontWeight: 650 }}>
                      {String(row.voucher_no ?? row.reference_no ?? row.voucher_type ?? 'Entry')}
                    </strong>
                    <br />
                    <span className="billing-parties__muted">
                      {date(String(row.date ?? row.voucher_date ?? ''))}
                    </span>
                  </span>
                  <span className="num">{amount ? money(amount) : '—'}</span>
                </li>
              )
            })}
          </ul>
        )}
        {statement.data?.data.note && (
          <p className="billing-parties__stat-note" style={{ margin: 0 }}>
            {statement.data.data.note}
          </p>
        )}
      </div>
    </Drawer>
  )
}

/**
 * How a party maps into the accounts.
 *
 * The thing most people expect here is a mapping table to fill in — which
 * ledger this customer posts to. There is not one, because in Aicountly the
 * party IS the ledger account: the id in this drawer is the `acc_id` Smart
 * Books keeps, and every bill raised here posts against it. Saying that plainly
 * is more use than an editor for a relationship that cannot be edited.
 */
export function LedgerMappingDrawer({
  open,
  onClose,
  rows,
}: {
  open: boolean
  onClose: () => void
  rows: Party[]
}) {
  return (
    <Drawer open={open} onClose={onClose} side="right" wide title="Ledger mapping">
      <p style={{ marginTop: 0, color: 'var(--billing-muted)', fontSize: 13 }}>
        A party in Billing is a ledger account in Smart Books — not a record here that points at one. There is nothing
        to map and nothing that can fall out of step; the account below is the one every bill, receipt and payment posts
        against.
      </p>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {rows.map((party) => (
          <li key={party.account_id} className="billing-parties__dupe-member">
            <span style={{ minWidth: 0 }}>
              <strong style={{ fontWeight: 650 }}>{party.name}</strong>
              <br />
              <span className="billing-parties__muted" style={{ fontSize: 12 }}>
                {party.type === 'supplier' ? 'Sundry creditor · payable' : 'Sundry debtor · receivable'}
              </span>
            </span>
            <span className="num" style={{ flexShrink: 0, fontSize: 13 }}>
              #{party.account_id}
            </span>
          </li>
        ))}
      </ul>

      <p className="billing-parties__stat-note">
        Showing the parties on this page. Open Smart Books to change how an account is classified.
        <ExternalLink size={12} aria-hidden style={{ verticalAlign: -1, marginLeft: 4 }} />
      </p>
    </Drawer>
  )
}
