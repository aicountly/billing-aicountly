/**
 * The two boxes this screen opens.
 *
 * Both keep the same contract the shell's popovers keep: Escape closes,
 * focus starts inside and goes back to whatever opened it, and a click on
 * the backdrop is a cancel. A credit note is one of the few things in this
 * product worth a confirmation at all — it moves money the other way and
 * cannot be quietly edited afterwards — so the confirmation shows the four
 * facts somebody would check on the paper before signing it.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { Send, X } from 'lucide-react'
import { money, qty as formatQty } from '../../ui'

function Dialog({
  titleId,
  onClose,
  children,
}: {
  titleId: string
  onClose: () => void
  children: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  const opener = useRef<Element | null>(null)

  useEffect(() => {
    opener.current = document.activeElement
    // The first control inside, so a keyboard user is not left outside the
    // box they just opened.
    box.current?.querySelector<HTMLElement>('button, [href], input, select, textarea')?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (opener.current instanceof HTMLElement) opener.current.focus()
    }
  }, [onClose])

  return (
    <div
      className="billing-cn-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="billing-cn-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={box}>
        {children}
      </div>
    </div>
  )
}

export function IssueDialog({
  customerName,
  documentNo,
  amount,
  units,
  goodsReturn,
  gstRegistered,
  warnings,
  busy,
  onConfirm,
  onClose,
}: {
  customerName: string
  documentNo: string | null
  amount: number
  units: number
  goodsReturn: boolean
  gstRegistered: boolean
  warnings: string[]
  busy: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog titleId="billing-cn-issue-title" onClose={onClose}>
      <div className="billing-cn-dialog__head">
        <div>
          <h2 id="billing-cn-issue-title">Issue this credit note?</h2>
          <p>It goes to Smart Books now and cannot be edited afterwards.</p>
        </div>
        <button type="button" className="billing-cn-dialog__close" onClick={onClose} aria-label="Close">
          <X size={17} aria-hidden />
        </button>
      </div>

      <dl className="billing-cn-dialog__facts">
        <div className="billing-cn-dialog__fact">
          <dt>Customer</dt>
          <dd>{customerName}</dd>
        </div>
        <div className="billing-cn-dialog__fact">
          <dt>Against</dt>
          <dd>{documentNo ?? 'No bill referenced'}</dd>
        </div>
        <div className="billing-cn-dialog__fact">
          <dt>Stock</dt>
          <dd>{goodsReturn ? `${formatQty(units)} units going back` : 'No stock movement'}</dd>
        </div>
        <div className="billing-cn-dialog__fact">
          <dt>GST</dt>
          <dd>{gstRegistered ? 'Worked out by Smart Books' : 'Not registered'}</dd>
        </div>
        <div className="billing-cn-dialog__fact billing-cn-dialog__fact--total">
          <dt>Credit before tax</dt>
          <dd>{money(amount)}</dd>
        </div>
      </dl>

      {warnings.length > 0 && (
        <ul style={{ margin: '0 0 16px', paddingLeft: 18, color: 'var(--billing-warning)', fontSize: 12.5 }}>
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      <div className="billing-cn-dialog__foot">
        <button type="button" className="billing-button" onClick={onClose} disabled={busy}>
          Go back
        </button>
        <button type="button" className="billing-button billing-button--primary" onClick={onConfirm} disabled={busy}>
          <Send size={14} aria-hidden /> {busy ? 'Issuing…' : 'Issue credit note'}
        </button>
      </div>
    </Dialog>
  )
}

const SHORTCUTS: ReadonlyArray<{ keys: string[]; what: string }> = [
  { keys: ['Ctrl', 'Enter'], what: 'Issue this credit note' },
  { keys: ['Ctrl', 'S'], what: 'Keep the draft on this device' },
  { keys: ['Alt', 'C'], what: 'Jump to the customer search' },
  { keys: ['Alt', 'I'], what: 'Jump to the bill search' },
  { keys: ['Alt', 'A'], what: 'Add another line' },
  { keys: ['Tab'], what: 'Move through the note in order' },
  { keys: ['Esc'], what: 'Close a dropdown or this box' },
]

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog titleId="billing-cn-keys-title" onClose={onClose}>
      <div className="billing-cn-dialog__head">
        <h2 id="billing-cn-keys-title">Keyboard shortcuts</h2>
        <button type="button" className="billing-cn-dialog__close" onClick={onClose} aria-label="Close">
          <X size={17} aria-hidden />
        </button>
      </div>

      <dl className="billing-cn-keys">
        {SHORTCUTS.map((shortcut) => (
          <div className="billing-cn-keys__row" key={shortcut.what}>
            <dt>{shortcut.what}</dt>
            <dd>
              {shortcut.keys.map((key) => (
                <kbd className="billing-cn-kbd" key={key}>
                  {key}
                </kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>

      <p style={{ margin: '14px 0 0', color: 'var(--billing-muted)', fontSize: 12.5 }}>
        On a Mac, Command stands in for Ctrl and Option for Alt.
      </p>
    </Dialog>
  )
}
