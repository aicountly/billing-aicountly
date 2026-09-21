/**
 * Everything above the list: the heading, the data-quality banner, the tabs
 * and the toolbar beside them.
 *
 * The one thing worth explaining is what Import and Add party do here, which
 * is to send you to Smart Books.
 *
 * A party is a ledger account and Smart Books owns it. Billing offering its own
 * "create customer" would be a second place for the same customer to exist,
 * under two names, with two balances — which is the exact failure this product
 * is built to avoid. So the button is real and it goes to the product that owns
 * the record, rather than being greyed out with no explanation.
 */

import { Link } from 'react-router-dom'
import {
  Download,
  ExternalLink,
  FolderTree,
  GitBranch,
  Plus,
  ScanSearch,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import { Popover } from '../../components/Popover'
import { getAppById } from '../../services/appLauncher'
import { launchApp } from '../../services/appLauncher'
import type { PartyOverview, PartyQuery } from '../../services/parties'

const BOOKS = getAppById('books')

function openBooks() {
  launchApp(BOOKS, { newTab: true })
}

export function PartiesHeading({
  onExport,
  exporting,
  mayExport,
}: {
  onExport: () => void
  exporting: boolean
  mayExport: boolean
}) {
  return (
    <div>
      <nav className="billing-parties__breadcrumb" aria-label="Where you are">
        <Link to="/">Home</Link>
        <span aria-hidden>/</span>
        <strong aria-current="page">Parties</strong>
      </nav>

      <div className="billing-parties__head">
        <div>
          <h1>Parties</h1>
          <p>Customers and suppliers, as Smart Books holds them. Billing keeps no copy.</p>
        </div>

        <div className="billing-parties__head-actions">
          <Popover
            asChild
            ariaLabel="Import parties"
            label={
              <span className="billing-button">
                <Upload size={15} aria-hidden /> Import
              </span>
            }
          >
            {(close) => (
              <>
                <div className="billing-menu__heading">
                  <strong>Importing parties</strong>
                </div>
                <p className="billing-menu__note">
                  A party is a ledger account in Smart Books, so that is where a list of them is imported. Billing reads
                  them from there and keeps no second copy.
                </p>
                <button
                  type="button"
                  className="billing-menu__item"
                  onClick={() => {
                    close()
                    openBooks()
                  }}
                >
                  <ExternalLink size={15} aria-hidden /> Open Smart Books
                </button>
              </>
            )}
          </Popover>

          {mayExport && (
            <button type="button" className="billing-button" onClick={onExport} disabled={exporting}>
              <Download size={15} aria-hidden /> {exporting ? 'Building…' : 'Export'}
            </button>
          )}

          <Popover
            asChild
            ariaLabel="Add a party"
            label={
              <span className="billing-button billing-button--primary">
                <Plus size={15} aria-hidden /> Add party
              </span>
            }
          >
            {(close) => (
              <>
                <div className="billing-menu__heading">
                  <strong>Added in Smart Books</strong>
                  <div style={{ color: 'var(--billing-muted)', fontSize: 12, marginTop: 2 }}>
                    One customer, one record, one balance.
                  </div>
                </div>
                <button
                  type="button"
                  className="billing-menu__item"
                  onClick={() => {
                    close()
                    openBooks()
                  }}
                >
                  <ExternalLink size={15} aria-hidden /> Add a customer in Smart Books
                </button>
                <button
                  type="button"
                  className="billing-menu__item"
                  onClick={() => {
                    close()
                    openBooks()
                  }}
                >
                  <ExternalLink size={15} aria-hidden /> Add a supplier in Smart Books
                </button>
                <p className="billing-menu__note">
                  They appear here the moment Books has them — there is nothing to sync.
                </p>
              </>
            )}
          </Popover>
        </div>
      </div>
    </div>
  )
}

/**
 * The data-quality banner.
 *
 * Drawn only when there is something real to say. No duplicates found, or a
 * reading too partial to compare, and it is not drawn at all — a permanent
 * "keep your data clean" strip that never changes is a strip nobody sees.
 */
export function PartyQualityBanner({
  overview,
  onReview,
  onDismiss,
}: {
  overview: PartyOverview | null
  onReview: () => void
  onDismiss: () => void
}) {
  const groups = overview?.duplicate_groups ?? null
  if (groups === null || groups === 0) return null

  return (
    <div className="billing-parties__banner">
      <span className="billing-parties__banner-mark" aria-hidden="true">
        <Sparkles size={17} />
      </span>
      <span className="billing-parties__banner-text">
        <strong>Keep your party data clean</strong>
        <span>
          {groups === 1
            ? '1 set of parties looks like the same party recorded twice.'
            : `${groups} sets of parties look like the same party recorded twice.`}
        </span>
      </span>
      <span className="billing-parties__banner-actions">
        <button type="button" className="billing-button billing-button--soft billing-button--small" onClick={onReview}>
          Review
        </button>
        <button type="button" className="billing-iconbutton" onClick={onDismiss} aria-label="Hide this for now">
          <X size={16} aria-hidden />
        </button>
      </span>
    </div>
  )
}

const TABS = [
  { key: 'all', label: 'All parties' },
  { key: 'customer', label: 'Customers' },
  { key: 'supplier', label: 'Suppliers' },
  { key: 'inactive', label: 'Inactive' },
] as const

export type PartyTabKey = (typeof TABS)[number]['key']

export function PartyTabs({
  current,
  onChange,
  overview,
}: {
  current: PartyTabKey
  onChange: (tab: PartyTabKey) => void
  overview: PartyOverview | null
}) {
  const counts: Partial<Record<PartyTabKey, number | null>> = {
    all: overview?.total_parties ?? null,
    customer: overview?.customers ?? null,
    supplier: overview?.suppliers ?? null,
    inactive: overview?.inactive_parties ?? null,
  }

  const visible = TABS.filter((tab) => {
    if (tab.key === 'customer') return overview?.may_see_customers ?? true
    if (tab.key === 'supplier') return overview?.may_see_suppliers ?? true
    return true
  })

  return (
    <div className="billing-parties__tabs" role="tablist" aria-label="Which parties">
      {visible.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          id={`party-tab-${tab.key}`}
          aria-selected={current === tab.key}
          aria-controls="party-list"
          tabIndex={current === tab.key ? 0 : -1}
          className="billing-parties__tab"
          onClick={() => onChange(tab.key)}
          onKeyDown={(event) => {
            // Left and right move between tabs, as a tab list is supposed to.
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
            event.preventDefault()
            const index = visible.findIndex((entry) => entry.key === current)
            const next = event.key === 'ArrowRight' ? index + 1 : index - 1
            const target = visible[(next + visible.length) % visible.length]
            onChange(target.key)
            document.getElementById(`party-tab-${target.key}`)?.focus()
          }}
        >
          {tab.label}
          {counts[tab.key] != null && (
            <span className="billing-parties__tab-count">{counts[tab.key]?.toLocaleString('en-IN')}</span>
          )}
        </button>
      ))}
    </div>
  )
}

/**
 * The toolbar beside the tabs.
 *
 * Party groups is a real filter over the groups Books carries, not a
 * placeholder: the list comes from the same reading the table does. Ledger
 * mapping explains the thing most people get wrong about this product — that
 * the party IS its Books ledger account — and shows the mapping rather than
 * offering to create one.
 */
export function PartyToolbar({
  overview,
  query,
  onChange,
  onDuplicates,
  onLedgerMapping,
}: {
  overview: PartyOverview | null
  query: PartyQuery
  onChange: (next: Partial<PartyQuery>) => void
  onDuplicates: () => void
  onLedgerMapping: () => void
}) {
  const groups = overview?.facets.groups ?? []
  const duplicates = overview?.duplicate_groups ?? null

  return (
    <div className="billing-parties__toolbar">
      <Popover
        asChild
        ariaLabel="Party groups"
        label={
          <span className="billing-button billing-button--small">
            <FolderTree size={15} aria-hidden /> Party groups
          </span>
        }
      >
        {(close) => (
          <>
            <div className="billing-menu__heading">
              <strong>Groups in Smart Books</strong>
            </div>
            {groups.length === 0 ? (
              <p className="billing-menu__note">
                Smart Books carries no group for these parties, so there is nothing to filter by.
              </p>
            ) : (
              <>
                <button
                  type="button"
                  className="billing-menu__item"
                  onClick={() => {
                    close()
                    onChange({ group: 'all', page: 1 })
                  }}
                >
                  Every group
                </button>
                {groups.map((group) => (
                  <button
                    key={group}
                    type="button"
                    className="billing-menu__item"
                    aria-current={query.group === group ? 'true' : undefined}
                    onClick={() => {
                      close()
                      onChange({ group, page: 1 })
                    }}
                  >
                    {group}
                  </button>
                ))}
              </>
            )}
          </>
        )}
      </Popover>

      <button type="button" className="billing-button billing-button--small" onClick={onLedgerMapping}>
        <GitBranch size={15} aria-hidden /> Ledger mapping
      </button>

      <button
        type="button"
        className="billing-button billing-button--small"
        onClick={onDuplicates}
        disabled={duplicates === 0}
        title={duplicates === 0 ? 'Nothing looks like a duplicate' : undefined}
      >
        <ScanSearch size={15} aria-hidden /> Duplicate check
        {duplicates != null && duplicates > 0 && <span className="billing-parties__count-badge">{duplicates}</span>}
      </button>
    </div>
  )
}

/**
 * What can be done to several parties at once.
 *
 * Deliberately short. Marking a party inactive or moving it to another group
 * changes the master record, and the master record belongs to Books — there is
 * no contract for writing one from here, so those are not offered rather than
 * offered and quietly doing nothing.
 */
export function PartyBulkBar({
  count,
  onClear,
  onExportSelected,
  onCopyEmails,
  mayExport,
}: {
  count: number
  onClear: () => void
  onExportSelected: () => void
  onCopyEmails: () => Promise<void>
  mayExport: boolean
}) {
  return (
    <div className="billing-parties__bulkbar" role="status">
      <strong>
        {count} {count === 1 ? 'party' : 'parties'} selected
      </strong>

      {mayExport && (
        <button type="button" className="billing-button billing-button--small" onClick={onExportSelected}>
          <Download size={15} aria-hidden /> Export selected
        </button>
      )}

      <button type="button" className="billing-button billing-button--small" onClick={() => void onCopyEmails()}>
        Copy email addresses
      </button>

      <span className="billing-parties__filters-spacer" />

      <button type="button" className="billing-button billing-button--small" onClick={onClear}>
        <X size={15} aria-hidden /> Clear selection
      </button>
    </div>
  )
}
