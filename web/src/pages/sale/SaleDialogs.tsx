/**
 * The four things the bill screen opens over itself.
 *
 * A preview of what is about to be sent, the terms that go on the bill, the
 * keyboard shortcuts, and the one question worth interrupting somebody for —
 * "you have typed a bill, are you sure?".
 */

import { useEffect, useState } from 'react'
import { api, ApiError } from '../../services/api'
import type { BillingSettings } from '../../services/types'
import { date as formatDate, money } from '../../ui'
import { Dialog } from './SaleFields'
import {
  fromPaise,
  grouped,
  lineAmounts,
  stateName,
  usableLines,
  type SaleDraft,
  type SaleTotals,
  type SupplyKind,
  type TaxCategory,
} from './saleForm'

/**
 * The bill as it stands, before anything has been sent.
 *
 * It says what it is at the bottom, and that line prints with it: this is not a
 * tax invoice and has no number, because Smart Books has not issued one yet.
 */
export function BillPreviewDialog({
  draft,
  totals,
  supply,
  taxCategories,
  companyName,
  companyAddress,
  companyGstin,
  autoPrint = false,
  onClose,
}: {
  draft: SaleDraft
  totals: SaleTotals
  supply: SupplyKind
  taxCategories: TaxCategory[]
  companyName: string
  companyAddress: string[]
  companyGstin: string
  /** Print went straight here, so print as soon as it is on screen. */
  autoPrint?: boolean
  onClose: () => void
}) {
  const lines = usableLines(draft)

  useEffect(() => {
    if (!autoPrint) return undefined
    // One frame, so the dialog is painted before the print stylesheet is
    // applied to it — printing a half-rendered panel is a blank page.
    const frame = requestAnimationFrame(() => window.print())
    return () => cancelAnimationFrame(frame)
  }, [autoPrint])

  return (
    <Dialog
      title="Bill preview"
      subtitle="How this bill reads right now. Nothing has been sent to Smart Books."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="billing-sale__btn" onClick={() => window.print()}>
            Print this preview
          </button>
          <button type="button" className="billing-sale__btn billing-sale__btn--soft" onClick={onClose}>
            Back to the bill
          </button>
        </>
      }
    >
      <div className="billing-sale-preview__head">
        <div>
          <p className="billing-sale-preview__company">{companyName || 'This company'}</p>
          {companyAddress.length > 0 && <p className="billing-sale-preview__lines">{companyAddress.join(', ')}</p>}
          {companyGstin && <p className="billing-sale-preview__lines">GSTIN {companyGstin}</p>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <p className="billing-sale-preview__lines">
            Bill date <strong>{formatDate(draft.billDate)}</strong>
          </p>
          {draft.dueDate && (
            <p className="billing-sale-preview__lines">
              Due <strong>{formatDate(draft.dueDate)}</strong>
            </p>
          )}
          {draft.placeOfSupply && (
            <p className="billing-sale-preview__lines">
              Place of supply <strong>{stateName(draft.placeOfSupply)}</strong>
            </p>
          )}
        </div>
      </div>

      <div className="billing-sale-preview__to">
        <strong>Bill to</strong>
        <div>{draft.party?.acc_name ?? 'No customer chosen yet'}</div>
        {draft.party?.gstin && <div style={{ color: 'var(--billing-muted)' }}>GSTIN {draft.party.gstin}</div>}
      </div>

      <table className="billing-sale-preview__table">
        <thead>
          <tr>
            <th>#</th>
            <th>Item</th>
            <th className="billing-sale-preview__num">Qty</th>
            <th className="billing-sale-preview__num">Rate</th>
            <th>Tax</th>
            <th className="billing-sale-preview__num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={line.key}>
              <td>{index + 1}</td>
              <td>
                {line.label || line.description || '—'}
                {line.label && line.description && line.description !== line.label && (
                  <div style={{ color: 'var(--billing-muted)', fontSize: 11 }}>{line.description}</div>
                )}
                {line.hsn && <div style={{ color: 'var(--billing-muted)', fontSize: 11 }}>HSN {line.hsn}</div>}
              </td>
              <td className="billing-sale-preview__num">
                {line.qty || '0'} {line.unitLabel}
              </td>
              <td className="billing-sale-preview__num">{line.rate || '0'}</td>
              <td>{taxCategories.find((row) => String(row.id) === line.taxCategoryId)?.name ?? '—'}</td>
              <td className="billing-sale-preview__num">{grouped(lineAmounts(line).taxablePaise)}</td>
            </tr>
          ))}
          {lines.length === 0 && (
            <tr>
              <td colSpan={6} style={{ color: 'var(--billing-muted)' }}>
                No items on this bill yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="billing-sale-preview__totals">
        <div className="billing-sale-summary__row">
          <span>Taxable value</span>
          <strong>{grouped(totals.taxablePaise)}</strong>
        </div>
        {totals.tax && supply === 'intra' && (
          <>
            <div className="billing-sale-summary__row">
              <span>CGST (estimate)</span>
              <strong>{grouped(totals.tax.cgstPaise)}</strong>
            </div>
            <div className="billing-sale-summary__row">
              <span>SGST (estimate)</span>
              <strong>{grouped(totals.tax.sgstPaise)}</strong>
            </div>
          </>
        )}
        {totals.tax && supply === 'inter' && (
          <div className="billing-sale-summary__row">
            <span>IGST (estimate)</span>
            <strong>{grouped(totals.tax.igstPaise)}</strong>
          </div>
        )}
        <div className="billing-sale-summary__row">
          <span>{totals.tax ? 'Grand total (estimate)' : 'Total before tax'}</span>
          <strong>{money(fromPaise(totals.grandTotalPaise))}</strong>
        </div>
      </div>

      {draft.note.trim() !== '' && (
        <p className="billing-sale-preview__lines" style={{ marginTop: 14 }}>
          <strong>Note:</strong> {draft.note}
        </p>
      )}
      {draft.terms.trim() !== '' && (
        <p className="billing-sale-preview__lines" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
          <strong>Terms:</strong> {draft.terms}
        </p>
      )}

      <p className="billing-sale-preview__caveat">
        This is a preview, not a tax invoice. It has no bill number because Smart Books assigns one when the bill is
        saved, and the GST shown is this screen&rsquo;s estimate from the tax categories on the lines — the figures on
        the invoice are Smart Books&rsquo;.
      </p>
    </Dialog>
  )
}

/**
 * The terms on this bill, and this company's default.
 *
 * The default is one of the few things Billing genuinely owns
 * (`billing_settings.default_sale_terms`), so it is edited here and saved
 * through `PUT v1/settings` — only by somebody who may manage settings. The
 * copy on THIS bill is just text on this bill.
 */
export function TermsDialog({
  value,
  defaultTerms,
  maySaveDefault,
  onApply,
  onClose,
  onSavedDefault,
}: {
  value: string
  defaultTerms: string
  maySaveDefault: boolean
  onApply: (terms: string) => void
  onClose: () => void
  onSavedDefault: (terms: string) => void
}) {
  const [text, setText] = useState(value || defaultTerms)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function saveDefault() {
    setSaving(true)
    setError(null)
    try {
      await api.put<BillingSettings>('v1/settings', { default_sale_terms: text.trim() || null })
      onSavedDefault(text.trim())
      setSaved(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      title="Terms &amp; conditions"
      subtitle="What prints under the items. The default is kept per company."
      onClose={onClose}
      footer={
        <>
          {maySaveDefault && (
            <button type="button" className="billing-sale__btn" onClick={saveDefault} disabled={saving}>
              {saving ? 'Saving…' : saved ? 'Saved as default' : 'Save as default'}
            </button>
          )}
          <button
            type="button"
            className="billing-sale__btn"
            onClick={() => {
              onApply('')
              onClose()
            }}
          >
            Remove from this bill
          </button>
          <button
            type="button"
            className="billing-sale__btn billing-sale__btn--primary"
            onClick={() => {
              onApply(text.trim())
              onClose()
            }}
          >
            Use on this bill
          </button>
        </>
      }
    >
      <textarea
        className="billing-sale__textarea"
        style={{ minHeight: '11rem' }}
        value={text}
        placeholder="Goods once sold will not be taken back. Interest at 18% per annum on overdue bills…"
        onChange={(event) => setText(event.target.value)}
        aria-label="Terms and conditions"
      />
      {error && (
        <p className="billing-sale__error" role="alert">
          {error}
        </p>
      )}
      <p className="billing-sale__hint" style={{ marginTop: 10 }}>
        {maySaveDefault
          ? 'Saving the default changes it for everyone billing in this company.'
          : 'Only somebody who can manage settings may change the company default.'}
      </p>
    </Dialog>
  )
}

const SHORTCUTS: ReadonlyArray<{ keys: string; what: string }> = [
  { keys: 'Enter', what: 'Move on — pick what is highlighted, or step to the next field' },
  { keys: 'Alt + N', what: 'Add another item line' },
  { keys: 'Alt + S', what: 'Scan: jump to the item box on the first empty line' },
  { keys: 'Alt + C', what: 'Back to the customer box' },
  { keys: 'Ctrl / ⌘ + Enter', what: 'Save this bill' },
  { keys: 'Ctrl / ⌘ + K', what: 'The search at the top of the page' },
  { keys: 'Esc', what: 'Close whatever is open' },
]

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" subtitle="Billing without reaching for the mouse." narrow onClose={onClose}>
      <dl className="billing-sale-shortcuts">
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.keys} className="billing-sale-shortcuts__row">
            <dd style={{ margin: 0 }}>{shortcut.what}</dd>
            <dt>
              <kbd>{shortcut.keys}</kbd>
            </dt>
          </div>
        ))}
      </dl>
      <p className="billing-sale__hint" style={{ marginTop: 12 }}>
        A barcode reader is a keyboard: scan into the item box and the code is looked up in Inventory on Enter.
      </p>
    </Dialog>
  )
}

export function DiscardDialog({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  return (
    <Dialog
      title="Discard unsaved bill?"
      subtitle="You have unsaved changes."
      narrow
      onClose={onKeep}
      footer={
        <>
          <button type="button" className="billing-sale__btn" onClick={onKeep}>
            Keep editing
          </button>
          <button type="button" className="billing-sale__btn billing-sale__btn--primary" onClick={onDiscard}>
            Discard
          </button>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 13 }}>
        Nothing on this bill has reached Smart Books. Leaving now throws away what you have typed — unless you keep it
        on this device with <strong>Save as draft</strong> first.
      </p>
    </Dialog>
  )
}
