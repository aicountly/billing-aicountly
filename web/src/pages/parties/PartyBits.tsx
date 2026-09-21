/**
 * The small pieces the directory is built from.
 *
 * One rule runs through all of them: a figure Books did not supply renders as
 * "—" with a reason a screen reader can hear, never as ₹ 0.00. A shopkeeper
 * cannot tell a customer who owes nothing from a balance nobody could read,
 * and only one of those is safe to act on.
 */

import type { ReactNode } from 'react'
import { Building2 } from 'lucide-react'
import { money } from '../../ui'
import { initialsOf, looksLikeOrganisation, type Party, type PartySide, type PartyStatus } from '../../services/parties'

/** A value that was not readable. The title says why, for anyone hovering. */
export function Absent({ reason = 'Smart Books did not supply this' }: { reason?: string }) {
  return (
    <span className="billing-parties__muted" title={reason}>
      —<span className="billing-sr-only"> {reason}</span>
    </span>
  )
}

/**
 * An amount, or an honest blank.
 *
 * `tone="risk"` is reserved for money that is actually a problem — overdue, or
 * past a credit limit. Painting every outstanding balance red teaches people to
 * stop seeing red, which costs exactly the rows that needed it.
 */
export function Amount({
  value,
  tone = 'plain',
  reason,
}: {
  value: number | null | undefined
  tone?: 'plain' | 'risk'
  reason?: string
}) {
  if (value === null || value === undefined) return <Absent reason={reason} />

  return <span className={tone === 'risk' ? 'billing-parties__danger' : undefined}>{money(value)}</span>
}

export function PartyAvatar({ party }: { party: Party }) {
  const supplier = party.type === 'supplier'

  return (
    <span
      className={`billing-parties__avatar${supplier ? ' billing-parties__avatar--supplier' : ''}`}
      aria-hidden="true"
    >
      {looksLikeOrganisation(party.name) ? <Building2 size={15} /> : initialsOf(party.name)}
    </span>
  )
}

export function PartyTypeBadge({ type }: { type: PartySide }) {
  return (
    <span className={`billing-parties__pill billing-parties__pill--${type}`}>
      {type === 'supplier' ? 'Supplier' : 'Customer'}
    </span>
  )
}

/**
 * Active, inactive, or an admission that Books did not say.
 *
 * The third case is not cosmetic. Treating silence as "Active" is how an
 * Inactive tab comes back permanently empty while looking as though it worked.
 */
export function PartyStatusBadge({ status }: { status: PartyStatus | null }) {
  if (status === null) {
    return (
      <span className="billing-parties__pill billing-parties__pill--unknown" title="Smart Books did not state a status">
        Not stated
      </span>
    )
  }

  return (
    <span className={`billing-parties__pill billing-parties__pill--${status}`}>
      {status === 'active' ? 'Active' : 'Inactive'}
    </span>
  )
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="billing-parties__fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
