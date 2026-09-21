/**
 * Who the note is against, and what it is against.
 *
 * The supplier comes from Smart Books, the documents come from Books' purchase
 * register, and the outstanding figure beside each one comes from Books'
 * bill-by-bill. None of the three is stored here; a supplier chosen and then
 * revisited is read again.
 */

import { FileText, Hash, RotateCcw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PartyPicker } from '../../components/LivePicker'
import { ErrorState, SkeletonRows, Unavailable } from '../../dashboards/kit'
import { date as formatDate, money } from '../../ui'
import type { CatalogParty, OriginalDocument } from '../../services/types'
import { DnCard, DnField } from './parts'
import { DEBIT_REASONS, type Problems, type ReturnKind } from './model'

export interface DocumentList {
  documents: OriginalDocument[]
  /** Outstanding per voucher id, when Books' bill-by-bill could be read. */
  outstanding: Record<number, number>
  note: string | null
  loading: boolean
  error: string | null
  reload: () => void
}

export function SupplierDocumentCard({
  supplier,
  onSupplier,
  date,
  onDate,
  fy,
  reference,
  onReference,
  reason,
  onReason,
  against,
  onAgainst,
  documents,
  returnKind,
  onReturnKind,
  problems,
  disabled,
  onAddSupplier,
}: {
  supplier: { id: number; name: string; gstin?: string | null } | null
  onSupplier: (party: CatalogParty) => void
  date: string
  onDate: (value: string) => void
  fy: { start: string; end: string; label: string } | null
  reference: string
  onReference: (value: string) => void
  reason: string
  onReason: (value: string) => void
  against: OriginalDocument | null
  onAgainst: (document: OriginalDocument | null) => void
  documents: DocumentList
  returnKind: ReturnKind
  onReturnKind: (kind: ReturnKind) => void
  problems: Problems
  disabled: boolean
  onAddSupplier: () => void
}) {
  const rows = documents.documents

  return (
    <DnCard title="Supplier & Document Details" icon={<FileText size={15} />} tone="doc">
      <div className="dn-grid">
        <DnField
          label="Supplier"
          required
          error={problems.supplier}
          links={
            <>
              <button type="button" className="dn-linkbutton" onClick={onAddSupplier}>
                + Add a supplier in Smart Books
              </button>
              {supplier ? (
                <Link className="dn-linkbutton" to={`/parties/${supplier.id}`} style={{ alignSelf: 'center' }}>
                  View supplier details
                </Link>
              ) : (
                <button type="button" className="dn-linkbutton" disabled title="Choose a supplier first">
                  View supplier details
                </button>
              )}
            </>
          }
        >
          {({ id, describedBy, invalid }) => (
            <PartyPicker
              side="supplier"
              hideLabel
              required
              inputId={id}
              describedBy={describedBy}
              invalid={invalid}
              inputClassName={`dn-control${invalid ? ' dn-control--invalid' : ''}`}
              selectedLabel={supplier?.name}
              onPick={onSupplier}
            />
          )}
        </DnField>

        <DnField
          label="Debit Note No."
          hint="Smart Books numbers the note from your own series when it posts."
        >
          {({ id, describedBy }) => (
            <div className="dn-inputgroup">
              <input
                id={id}
                className="dn-control"
                value="Auto-generate"
                readOnly
                aria-describedby={describedBy}
              />
              <span className="dn-inputgroup__button" aria-hidden>
                <Hash size={14} />
              </span>
            </div>
          )}
        </DnField>

        <DnField
          label="Date"
          required
          error={problems.date}
          hint={fy ? `Inside ${fy.label}.` : undefined}
        >
          {({ id, describedBy, invalid }) => (
            <input
              id={id}
              type="date"
              className={`dn-control${invalid ? ' dn-control--invalid' : ''}`}
              value={date}
              min={fy?.start || undefined}
              max={fy?.end || undefined}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              disabled={disabled}
              onChange={(event) => onDate(event.target.value)}
            />
          )}
        </DnField>

        <DnField
          label="Against Document"
          hint={
            supplier
              ? 'The bill this note relates to, so the two can be matched later.'
              : 'Choose the supplier first and their bills will be listed here.'
          }
        >
          {({ id, describedBy }) => (
            <select
              id={id}
              data-dn="against"
              className="dn-control"
              aria-describedby={describedBy}
              disabled={disabled || !supplier || documents.loading || rows.length === 0}
              value={against?.voucher_id != null ? String(against.voucher_id) : ''}
              onChange={(event) => {
                const picked = rows.find((row) => String(row.voucher_id) === event.target.value)
                onAgainst(picked ?? null)
              }}
            >
              <option value="">
                {documents.loading ? 'Reading Smart Books…' : 'Select bill / purchase order'}
              </option>
              {rows.map((row) => (
                <option key={String(row.voucher_id ?? row.document_no)} value={String(row.voucher_id ?? '')}>
                  {[row.document_no ?? 'Bill', formatDate(row.date), row.amount === null ? null : money(row.amount)]
                    .filter(Boolean)
                    .join(' · ')}
                </option>
              ))}
            </select>
          )}
        </DnField>

        <DnField label="Reference No." hint="The supplier's own reference, or your return challan.">
          {({ id, describedBy }) => (
            <input
              id={id}
              className="dn-control"
              placeholder="Supplier's reference (optional)"
              value={reference}
              maxLength={64}
              aria-describedby={describedBy}
              disabled={disabled}
              onChange={(event) => onReference(event.target.value)}
            />
          )}
        </DnField>

        <DnField label="Reason" required error={problems.reason} hint="Shown on the note and kept with it.">
          {({ id, describedBy, invalid }) => (
            <select
              id={id}
              className={`dn-control${invalid ? ' dn-control--invalid' : ''}`}
              value={reason}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              disabled={disabled}
              onChange={(event) => onReason(event.target.value)}
            >
              <option value="">Select a reason</option>
              {DEBIT_REASONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          )}
        </DnField>
      </div>

      <DocumentState supplier={supplier} against={against} documents={documents} onAgainst={onAgainst} />

      <ReturnTypeSelector value={returnKind} onChange={onReturnKind} disabled={disabled} />
    </DnCard>
  )
}

/**
 * What is going on with the document list, in the cases where the select alone
 * cannot say it: nothing chosen and nothing to choose, something chosen, or
 * Books not answering.
 */
function DocumentState({
  supplier,
  against,
  documents,
  onAgainst,
}: {
  supplier: { id: number; name: string } | null
  against: OriginalDocument | null
  documents: DocumentList
  onAgainst: (document: OriginalDocument | null) => void
}) {
  if (!supplier) return null

  if (documents.loading) {
    return <div style={{ marginTop: 14 }}><SkeletonRows rows={2} /></div>
  }

  if (documents.error) {
    return (
      <div style={{ marginTop: 14 }}>
        <ErrorState
          message={`${documents.error} You can still raise the note without a reference, but it will be harder to match later.`}
          onRetry={documents.reload}
        />
      </div>
    )
  }

  if (against) {
    const outstanding = against.voucher_id !== null ? documents.outstanding[against.voucher_id] : undefined

    return (
      <div className="dn-chosen" style={{ marginTop: 14 }}>
        <div style={{ minWidth: 0 }}>
          <strong>{against.document_no ?? 'Bill'}</strong>
          <div className="dn-chosen__meta">
            <span>{formatDate(against.date)}</span>
            {against.amount !== null && <span>Billed {money(against.amount)}</span>}
            {outstanding !== undefined && <span>Still owed {money(outstanding)}</span>}
          </div>
        </div>
        <button type="button" className="billing-button billing-button--small" onClick={() => onAgainst(null)}>
          Choose another
        </button>
      </div>
    )
  }

  if (documents.documents.length === 0) {
    return (
      <div style={{ marginTop: 14 }}>
        <Unavailable title="No bills on record for this supplier">
          Nothing was recorded for {supplier.name} in the last year. You can raise this note without a bill —
          Smart Books decides whether it will accept one that is unlinked.
        </Unavailable>
      </div>
    )
  }

  return documents.note ? (
    <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--billing-muted)' }}>{documents.note}</p>
  ) : null
}

/**
 * THE MOST IMPORTANT CONTROL ON THIS SCREEN.
 *
 * A debit note that returns goods and one that only corrects a price are the
 * same document to the accounts and completely different to the stock. Making
 * it two labelled choices rather than a checkbox somebody might not read is the
 * whole reason this is a card of its own.
 */
export function ReturnTypeSelector({
  value,
  onChange,
  disabled,
}: {
  value: ReturnKind
  onChange: (kind: ReturnKind) => void
  disabled: boolean
}) {
  const options: Array<{ value: ReturnKind; title: string; hint: string }> = [
    {
      value: 'goods_return',
      title: 'Goods being returned',
      hint: 'The items go back to the supplier, and the stock goes with them.',
    },
    {
      value: 'value_adjustment',
      title: 'Value adjustment only',
      hint: 'The price was wrong or a discount was agreed. Nothing is returned to stock.',
    },
  ]

  return (
    <fieldset style={{ border: 0, margin: '18px 0 0', padding: 0, minWidth: 0 }}>
      <legend className="dn-field__label" style={{ padding: 0, marginBottom: 8 }}>
        <RotateCcw size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 5 }} />
        What kind of note is this?
      </legend>
      <div className="dn-returntype">
        {options.map((option) => (
          <label
            key={option.value}
            className={`dn-radio${value === option.value ? ' dn-radio--on' : ''}`}
          >
            <input
              type="radio"
              name="dn-return-kind"
              value={option.value}
              checked={value === option.value}
              disabled={disabled}
              onChange={() => onChange(option.value)}
            />
            <span>
              <strong>{option.title}</strong>
              <small>{option.hint}</small>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
