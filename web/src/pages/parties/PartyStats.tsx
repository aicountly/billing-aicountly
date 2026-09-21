/**
 * The six figures above the list.
 *
 * None of them is a trend. Nobody in this fleet keeps a history of how many
 * customers a company had last month, so "+12% this month" could only be
 * invented — and a made-up arrow on a real dashboard is worse than no arrow,
 * because it is acted on. What each card carries underneath instead is
 * arithmetic on the same reading the number above it came from.
 *
 * A figure the server could not establish from a COMPLETE reading arrives as
 * null and is drawn as "Not available", with the reason on it. That is the
 * whole point of the card: a directory that shows the size of the first page
 * where the size of the business should be is a directory that lies quietly.
 */

import type { ReactNode } from 'react'
import { AlertTriangle, CircleDollarSign, Truck, UserRound, Users } from 'lucide-react'
import { moneyWhole } from '../../ui'
import type { PartyOverview } from '../../services/parties'

function count(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-IN')
}

function share(part: number | null, whole: number | null): string | null {
  if (part === null || whole === null || whole <= 0) return null
  return `${Math.round((part / whole) * 100)}% of all parties`
}

function StatCard({
  label,
  icon,
  tone = 'plain',
  value,
  absent,
  note,
  noteTone,
  loading,
}: {
  label: string
  icon: ReactNode
  tone?: 'plain' | 'warning' | 'danger'
  value: string
  /** The figure could not be established. Shown instead of the number, with why. */
  absent?: string | null
  note?: string | null
  noteTone?: 'plain' | 'warning' | 'danger'
  loading: boolean
}) {
  return (
    <article className="billing-parties__stat" aria-busy={loading}>
      <span
        className={`billing-parties__stat-mark${tone === 'plain' ? '' : ` billing-parties__stat-mark--${tone}`}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="billing-parties__stat-body">
        <span className="billing-parties__stat-label">{label}</span>
        {loading ? (
          <span className="billing-skeleton billing-skeleton--value" style={{ marginTop: 6, height: 22 }}>
            <span className="billing-sr-only">Loading {label}</span>
          </span>
        ) : absent ? (
          <strong className="billing-parties__stat-value billing-parties__stat-value--absent" title={absent}>
            Not available
          </strong>
        ) : (
          <strong className="billing-parties__stat-value">{value}</strong>
        )}
        {!loading && (absent ?? note) && (
          <span
            className={`billing-parties__stat-note${
              !absent && noteTone && noteTone !== 'plain' ? ` billing-parties__stat-note--${noteTone}` : ''
            }`}
          >
            {absent ?? note}
          </span>
        )}
      </div>
    </article>
  )
}

/**
 * The active ring.
 *
 * A conic gradient with a hole in it rather than a charting library: one circle
 * is not worth 40kB on a counter machine. The percentage is of the parties
 * whose status Books actually stated, and the line underneath says how many
 * that was — so a company where Books carries no status at all reads as
 * "Not stated" rather than as 100% active.
 */
function ActiveRing({ overview, loading }: { overview: PartyOverview | null; loading: boolean }) {
  const percentage = overview?.active_percentage ?? null
  const stated = overview?.status_known ?? 0

  return (
    <article className="billing-parties__stat billing-parties__stat--ring" aria-busy={loading}>
      {loading ? (
        <span className="billing-skeleton" style={{ width: 58, height: 58, borderRadius: '50%', flexShrink: 0 }} />
      ) : (
        <span
          className={`billing-parties__ring${percentage === null ? ' billing-parties__ring--absent' : ''}`}
          style={{ '--billing-ring-share': percentage ?? 0 } as React.CSSProperties}
          role="img"
          aria-label={
            percentage === null
              ? 'Active share not available'
              : `${percentage} per cent of the parties Smart Books gave a status for are active`
          }
        >
          {percentage === null ? '—' : `${percentage}%`}
        </span>
      )}
      <div className="billing-parties__stat-body">
        <span className="billing-parties__stat-label">Active parties</span>
        {loading ? (
          <span className="billing-skeleton billing-skeleton--line" style={{ marginTop: 6, width: '80%' }} />
        ) : percentage === null ? (
          <>
            <strong className="billing-parties__stat-value billing-parties__stat-value--absent">Not stated</strong>
            <span className="billing-parties__stat-note">Smart Books carries no active flag for these parties.</span>
          </>
        ) : (
          <>
            <strong className="billing-parties__stat-value">
              {(overview?.active_parties ?? 0).toLocaleString('en-IN')} of {stated.toLocaleString('en-IN')}
            </strong>
            <span className="billing-parties__stat-note">
              {overview?.inactive_parties === 0 ? 'None marked inactive' : `${overview?.inactive_parties} marked inactive`}
            </span>
          </>
        )}
      </div>
    </article>
  )
}

export function PartyStats({ overview, loading }: { overview: PartyOverview | null; loading: boolean }) {
  const partial = overview !== null && !overview.complete
  const partialReason = 'There are more parties than one reading can count, so this cannot be totalled.'

  const exposure = overview?.credit_limit_exposure ?? null
  const overLimit = overview?.parties_over_limit ?? null
  const overdue = overview?.overdue_receivables ?? null
  const receivable = overview?.total_receivable ?? null

  return (
    <section className="billing-parties__stats" aria-label="Key figures">
      <StatCard
        loading={loading}
        label="Total parties"
        icon={<Users size={18} />}
        value={count(overview?.total_parties ?? null)}
        absent={overview && overview.total_parties === null ? partialReason : null}
        note={
          overview?.gst_registered != null
            ? `${overview.gst_registered.toLocaleString('en-IN')} registered under GST`
            : null
        }
      />

      <StatCard
        loading={loading}
        label="Customers"
        icon={<UserRound size={18} />}
        value={count(overview?.customers ?? null)}
        absent={
          overview && overview.customers === null
            ? overview.may_see_customers
              ? partialReason
              : 'Your Billing profile does not include customers.'
            : null
        }
        note={share(overview?.customers ?? null, overview?.total_parties ?? null)}
      />

      <StatCard
        loading={loading}
        label="Suppliers"
        icon={<Truck size={18} />}
        value={count(overview?.suppliers ?? null)}
        absent={
          overview && overview.suppliers === null
            ? overview.may_see_suppliers
              ? partialReason
              : 'Your Billing profile does not include suppliers.'
            : null
        }
        note={share(overview?.suppliers ?? null, overview?.total_parties ?? null)}
      />

      <StatCard
        loading={loading}
        label="Credit limit set"
        icon={<AlertTriangle size={18} />}
        tone="warning"
        value={exposure === null ? '—' : moneyWhole(exposure)}
        absent={
          overview && exposure === null
            ? partial
              ? partialReason
              : 'Smart Books carries no credit limit for these parties.'
            : null
        }
        note={
          overLimit === null
            ? 'Added up across the parties that have one'
            : overLimit === 0
              ? 'Nobody is over their limit'
              : `${overLimit} over their limit`
        }
        noteTone={overLimit && overLimit > 0 ? 'danger' : 'plain'}
      />

      <StatCard
        loading={loading}
        label="Overdue from customers"
        icon={<CircleDollarSign size={18} />}
        tone="danger"
        value={overdue === null ? '—' : moneyWhole(overdue)}
        absent={
          overview && overdue === null
            ? overview.may_see_customers
              ? 'Smart Books could not be reached for what is owed.'
              : 'Your Billing profile does not show what customers owe.'
            : null
        }
        note={
          overdue !== null && receivable !== null && receivable > 0
            ? `of ${moneyWhole(receivable)} owed`
            : 'Past its due date, from Smart Books'
        }
        noteTone={overdue !== null && overdue > 0 ? 'danger' : 'plain'}
      />

      <ActiveRing overview={overview} loading={loading} />
    </section>
  )
}
