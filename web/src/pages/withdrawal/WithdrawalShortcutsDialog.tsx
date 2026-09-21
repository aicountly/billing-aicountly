/**
 * What the keys do, for the person recording the day's fourth withdrawal.
 *
 * Escape closes it and focus goes back to the button that opened it, so a
 * keyboard user is not dropped at the top of the document — the same contract
 * the shell's own popovers and the expense screen's dialog keep.
 */

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

const SHORTCUTS: Array<{ keys: string[]; what: string }> = [
  { keys: ['Ctrl', 'S'], what: 'Save this withdrawal' },
  { keys: ['Ctrl', 'Enter'], what: 'Save this withdrawal' },
  { keys: ['Ctrl', 'Shift', 'S'], what: 'Save it and start another' },
  { keys: ['Alt', 'B'], what: 'Jump to the bank account' },
  { keys: ['Alt', 'C'], what: 'Jump to the cash account' },
  { keys: ['Tab'], what: 'Move through the form in order' },
  { keys: ['Esc'], what: 'Close a menu or this box' },
]

export function WithdrawalShortcutsDialog({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    close.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="billing-withdrawal-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="billing-withdrawal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="withdrawal-shortcuts-title"
      >
        <div className="billing-withdrawal-dialog__head">
          <h2 id="withdrawal-shortcuts-title">Keyboard shortcuts</h2>
          <button ref={close} type="button" className="billing-withdrawal-dialog__close" aria-label="Close" onClick={onClose}>
            <X size={17} aria-hidden />
          </button>
        </div>

        <dl className="billing-withdrawal-keys">
          {SHORTCUTS.map((shortcut) => (
            <div className="billing-withdrawal-keys__row" key={shortcut.keys.join('+')}>
              <dt>{shortcut.what}</dt>
              <dd>
                {shortcut.keys.map((key) => (
                  <span key={key}>
                    <kbd className="billing-withdrawal-kbd">{key}</kbd>{' '}
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>

        <p className="billing-withdrawal-footnote">On a Mac, Command stands in for Ctrl and Option for Alt.</p>
      </div>
    </div>
  )
}
