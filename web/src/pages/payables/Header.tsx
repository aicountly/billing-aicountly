/**
 * The page header: what this screen is, and the three things you start here.
 *
 * "New bill / expense" is a split button — one click for the common case, the
 * rest behind the chevron — and every entry in it is an existing route with an
 * existing form behind it. Nothing here re-implements a purchase entry screen.
 *
 * "Import bills" is honest about what this deployment can do. There is no
 * document-extraction service configured, so rather than a button that appears
 * to work, it says what is missing and offers the manual path, which records
 * exactly the same bill.
 */

import { useCallback, useState } from 'react'
import { CalendarRange, ChevronDown, FileUp, Plus, Wallet } from 'lucide-react'
import { useDismiss } from './parts'

export interface HeaderPermissions {
  add_purchase: boolean
  add_expense: boolean
  debit_note: boolean
}

export function PayablesHeader({
  can,
  onCalendar,
  onImport,
  onCreate,
}: {
  can: HeaderPermissions
  onCalendar: () => void
  onImport: () => void
  onCreate: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const menu = useDismiss<HTMLDivElement>(open, close)

  const entries = [
    { label: 'New purchase bill', path: '/purchases/new', allowed: can.add_purchase },
    { label: 'New expense', path: '/more/expense', allowed: can.add_expense },
    { label: 'Debit note', path: '/more/debit-note', allowed: can.debit_note },
  ].filter((entry) => entry.allowed)

  const primary = entries[0]

  return (
    <header className="mtp-header">
      <div className="mtp-header__title">
        <span className="mtp-header__mark" aria-hidden="true"><Wallet size={23} /></span>
        <div>
          <h1>Money to pay</h1>
          <p>Track and manage your purchase bills, expenses and payments to suppliers.</p>
        </div>
      </div>

      <div className="mtp-header__actions">
        <button type="button" className="billing-button" onClick={onCalendar}>
          <CalendarRange size={15} aria-hidden /> View calendar
        </button>

        <button type="button" className="billing-button" onClick={onImport}>
          <FileUp size={15} aria-hidden /> Import bills
        </button>

        {primary && (
          <div className="mtp-split" ref={menu}>
            <button type="button" className="billing-button billing-button--primary" onClick={() => onCreate(primary.path)}>
              <Plus size={15} aria-hidden /> {entries.length === 1 ? primary.label : 'New bill / expense'}
            </button>
            {entries.length > 1 && (
              <>
                <button
                  type="button"
                  className="billing-button billing-button--primary mtp-split__toggle"
                  aria-label="Other things you can record"
                  aria-expanded={open}
                  aria-haspopup="menu"
                  onClick={() => setOpen((value) => !value)}
                >
                  <ChevronDown size={15} aria-hidden />
                </button>
                {open && (
                  <div className="mtp-menu" role="menu">
                    {entries.map((entry) => (
                      <button
                        key={entry.path}
                        type="button"
                        className="mtp-menu__item"
                        role="menuitem"
                        onClick={() => { close(); onCreate(entry.path) }}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </header>
  )
}
