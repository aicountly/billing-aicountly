/**
 * The right-hand column: when to raise one of these, the four things worth
 * doing from here, and the note's own remarks.
 *
 * Two of the quick actions do something. The other two name a service this
 * deployment has not got, and say so on the button rather than looking live
 * and doing nothing.
 */

import { Check, Link2, Paperclip, Scale, Sparkles } from 'lucide-react'
import type { Capability } from '../../services/types'
import { DnAsideCard } from './parts'

const WHEN_TO_USE = [
  'Goods went back to the supplier',
  'The supplier billed the wrong price',
  'A discount was agreed after the bill',
  'Short delivery or damaged goods',
  'A post-purchase charge you are claiming back',
]

export function HelpCard() {
  return (
    <DnAsideCard title="When to use a debit note?" className="dn-help">
      <ul>
        {WHEN_TO_USE.map((line) => (
          <li key={line}>
            <Check size={14} aria-hidden />
            {line}
          </li>
        ))}
      </ul>
    </DnAsideCard>
  )
}

export function QuickActionsCard({
  attachments,
  extraction,
  onLinkBill,
  onViewImpact,
  canLinkBill,
}: {
  attachments: Capability
  extraction: Capability
  onLinkBill: () => void
  onViewImpact: () => void
  canLinkBill: boolean
}) {
  const actions = [
    {
      key: 'upload',
      label: 'Upload supporting document',
      hint: attachments.available
        ? 'Attach the return challan, photos or supplier correspondence.'
        : attachments.reason ?? 'No storage service is configured for this deployment.',
      icon: <Paperclip size={15} />,
      mark: '',
      disabled: !attachments.available,
      onClick: () => undefined,
    },
    {
      key: 'link',
      label: 'Link to a purchase bill',
      hint: canLinkBill
        ? 'Match this note to the bill it relates to.'
        : 'Choose the supplier first, then their bills can be listed.',
      icon: <Link2 size={15} />,
      mark: ' dn-quick__mark--doc',
      disabled: !canLinkBill,
      onClick: onLinkBill,
    },
    {
      key: 'ai',
      label: 'Use AI to fill the items',
      hint: extraction.available
        ? 'Upload a PDF or photo and let it read the lines.'
        : extraction.reason ?? 'No document-extraction service is configured for this deployment.',
      icon: <Sparkles size={15} />,
      mark: ' dn-quick__mark--ai',
      disabled: !extraction.available,
      onClick: () => undefined,
    },
    {
      key: 'impact',
      label: 'View accounting impact',
      hint: 'What this does to the supplier’s account.',
      icon: <Scale size={15} />,
      mark: '',
      disabled: false,
      onClick: onViewImpact,
    },
  ]

  return (
    <DnAsideCard title="Quick actions">
      <div className="dn-quicklist">
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            className="dn-quick"
            disabled={action.disabled}
            title={action.disabled ? action.hint : undefined}
            onClick={action.onClick}
          >
            <span className={`dn-quick__mark${action.mark}`} aria-hidden>{action.icon}</span>
            <span>
              <strong>{action.label}</strong>
              <small>{action.hint}</small>
            </span>
          </button>
        ))}
      </div>
    </DnAsideCard>
  )
}

export function NotesCard({
  notes,
  onNotes,
  attachments,
  disabled,
}: {
  notes: string
  onNotes: (value: string) => void
  attachments: Capability
  disabled: boolean
}) {
  return (
    <DnAsideCard title="Notes">
      <div style={{ display: 'grid', gap: 5 }}>
        <label className="dn-field__label" htmlFor="dn-remarks">Internal remarks (optional)</label>
        <textarea
          id="dn-remarks"
          className="dn-control"
          value={notes}
          placeholder="Add any additional notes…"
          maxLength={480}
          aria-describedby="dn-remarks-hint"
          disabled={disabled}
          onChange={(event) => onNotes(event.target.value)}
        />
        <span className="dn-field__hint" id="dn-remarks-hint">
          Kept with the note in Smart Books, and printed on it.
        </span>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <span className="dn-field__label">Attachments</span>
        <div className="dn-drop" role="note">
          <Paperclip size={16} aria-hidden style={{ justifySelf: 'center', color: 'var(--billing-muted)' }} />
          <strong>Attachments are not available here</strong>
          <small>
            {attachments.reason ?? 'No storage service is configured for this deployment.'}
          </small>
        </div>
      </div>
    </DnAsideCard>
  )
}
