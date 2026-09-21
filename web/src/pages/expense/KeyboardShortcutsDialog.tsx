/**
 * What the keys do, for the person entering the fiftieth bill of the morning.
 *
 * Escape closes it and focus goes back to the button that opened it, so a
 * keyboard user is not dropped at the top of the document — the same contract
 * the shell's own popovers keep.
 */

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

const SHORTCUTS: Array<{ keys: string[]; what: string }> = [
  { keys: ['Ctrl', 'Enter'], what: 'Save this expense' },
  { keys: ['Alt', 'E'], what: 'Jump to the expense category' },
  { keys: ['Alt', 'P'], what: 'Jump to Paid From' },
  { keys: ['Alt', 'V'], what: 'Jump to the vendor search' },
  { keys: ['Tab'], what: 'Move through the form in order' },
  { keys: ['Esc'], what: 'Close a dropdown or this box' },
]

export function KeyboardShortcutsDialog({ onClose }: { onClose: () => void }) {
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
      className="billing-expense-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="billing-expense-dialog" role="dialog" aria-modal="true" aria-labelledby="expense-shortcuts-title">
        <div className="billing-expense-dialog__head">
          <h2 id="expense-shortcuts-title">Keyboard shortcuts</h2>
          <button ref={close} type="button" className="billing-expense-tip__close" aria-label="Close" onClick={onClose}>
            <X size={17} aria-hidden />
          </button>
        </div>

        <dl className="billing-expense-keys">
          {SHORTCUTS.map((shortcut) => (
            <div className="billing-expense-keys__row" key={shortcut.what}>
              <dt>{shortcut.what}</dt>
              <dd>
                {shortcut.keys.map((key) => (
                  <span key={key}>
                    <kbd className="billing-expense-kbd">{key}</kbd>{' '}
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>

        <p className="billing-expense-footnote">
          On a Mac, Command stands in for Ctrl and Option for Alt.
        </p>
      </div>
    </div>
  )
}
