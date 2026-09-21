/**
 * Cancel, keep, save.
 *
 * Sticky rather than fixed: the shell's sidebar is 232px, 200px or none
 * depending on the width, and a fixed bar would have to be told which — sticky
 * simply stays inside the column it belongs to.
 *
 * Save is disabled while a save is in flight AND guarded by a ref in the page,
 * because a second click lands before React re-renders and a second click here
 * is a second invoice.
 */

import { AlertCircle, Check, Loader2, Save } from 'lucide-react'

export function BillActionBar({
  saving,
  savingMode,
  dirty,
  draftKeptAt,
  message,
  onCancel,
  onKeepDraft,
  onSave,
}: {
  saving: boolean
  savingMode: 'save' | 'save-new' | null
  dirty: boolean
  draftKeptAt: string | null
  message: string | null
  onCancel: () => void
  onKeepDraft: () => void
  onSave: (mode: 'save' | 'save-new') => void
}) {
  return (
    <footer className="billing-sale__actions">
      <div className="billing-sale__actions-group">
        <button type="button" className="billing-sale__btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        {message ? (
          <p className="billing-sale__actions-message" role="status">
            <AlertCircle size={14} aria-hidden /> {message}
          </p>
        ) : (
          draftKeptAt && (
            <p className="billing-sale__actions-message" style={{ color: 'var(--billing-muted)' }} role="status">
              <Check size={14} aria-hidden /> Draft kept on this device at {draftKeptAt}
            </p>
          )
        )}
      </div>

      <div className="billing-sale__actions-group">
        <button
          type="button"
          className="billing-sale__btn"
          onClick={onKeepDraft}
          disabled={saving || !dirty}
          title="Keeps this bill in this browser. Nothing is sent to Smart Books and no invoice is created."
        >
          Save as draft
        </button>
        <button
          type="button"
          className="billing-sale__btn billing-sale__btn--soft"
          onClick={() => onSave('save-new')}
          disabled={saving}
        >
          {saving && savingMode === 'save-new' ? (
            <>
              <Loader2 size={15} className="spin" aria-hidden /> Saving…
            </>
          ) : (
            'Save & new'
          )}
        </button>
        <button
          type="button"
          className="billing-sale__btn billing-sale__btn--primary"
          onClick={() => onSave('save')}
          disabled={saving}
        >
          {saving && savingMode === 'save' ? (
            <>
              <Loader2 size={15} className="spin" aria-hidden /> Saving…
            </>
          ) : (
            <>
              <Save size={15} aria-hidden /> Save
            </>
          )}
        </button>
      </div>
    </footer>
  )
}
