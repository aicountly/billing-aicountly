/**
 * Parties that look like the same party recorded twice.
 *
 * Only evidence anybody can check: the same GSTIN, the same phone number, the
 * same email address, or the same name once case, punctuation and "Pvt Ltd" are
 * set aside. There is no confidence score, because a person being asked to act
 * on a match can verify a GSTIN and cannot verify 87%.
 *
 * Nothing is merged from here, and there is no button that offers to. Merging
 * two ledger accounts moves every voucher posted against one of them; that is
 * Smart Books' decision and Smart Books' screen. This says which two to look
 * at, which is the part Billing can honestly do.
 */

import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { useApi } from '../../hooks/useApi'
import { useBilling } from '../../context/BillingContext'
import { Drawer } from '../../shell/Drawer'
import { money } from '../../ui'
import { EmptyState, ErrorState, SkeletonRows } from '../../dashboards/kit'
import { launchApp } from '../../services/appLauncher'
import { getAppById } from '../../services/appLauncher'
import { parties } from '../../services/parties'

export function DuplicateDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { scope, can } = useBilling()

  const result = useApi(
    (signal) => parties.duplicates(signal),
    [scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    open && Boolean(scope),
  )

  const groups = result.data?.data.groups ?? []

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="right"
      wide
      title="Duplicate check"
      footer={
        <button
          type="button"
          className="billing-button"
          style={{ flex: 1, justifyContent: 'center' }}
          onClick={() => launchApp(getAppById('books'), { newTab: true })}
        >
          <ExternalLink size={15} aria-hidden /> Fix these in Smart Books
        </button>
      }
    >
      {result.loading && <SkeletonRows rows={4} />}

      {result.error && <ErrorState message={result.error} onRetry={result.reload} />}

      {!result.loading && !result.error && groups.length === 0 && (
        <EmptyState>No two parties share a GSTIN, a phone number, an email address or a name.</EmptyState>
      )}

      {groups.map((group) => (
        <div key={group.key} className="billing-parties__dupe">
          <div>
            <strong style={{ fontSize: 13 }}>{group.reason}</strong>
            <div className="billing-parties__stat-note" style={{ marginTop: 2 }}>
              {group.members.length} parties match on this.
            </div>
          </div>

          {group.members.map((member) => (
            <div key={member.account_id} className="billing-parties__dupe-member">
              <span style={{ minWidth: 0 }}>
                <strong style={{ fontWeight: 650 }}>{member.name}</strong>
                <br />
                <span className="billing-parties__muted" style={{ fontSize: 12 }}>
                  #{member.account_id}
                  {member.gstin ? ` · ${member.gstin}` : ''}
                  {member.state ? ` · ${member.state}` : ''}
                </span>
              </span>
              <span style={{ textAlign: 'right', flexShrink: 0 }}>
                <span className="num" style={{ fontSize: 13 }}>
                  {member.outstanding === null ? '—' : money(member.outstanding)}
                </span>
                {can('statement.view') && (
                  <>
                    <br />
                    <Link to={`/parties/${member.account_id}`} onClick={onClose} style={{ fontSize: 12 }}>
                      Statement
                    </Link>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      ))}

      {result.data?.data.note && <p className="billing-parties__stat-note">{result.data.data.note}</p>}
    </Drawer>
  )
}
