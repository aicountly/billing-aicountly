/**
 * The top of the bill screen: where you are, what you are making, and the two
 * things worth knowing before you start typing.
 *
 * The strip is deliberately small. It states how the screen is meant to be
 * used — search, scan or type — and who works out the tax, and then gets out of
 * the way: this is a workspace somebody spends their day in, not a landing page.
 */

import { Keyboard, Sparkles, Zap } from 'lucide-react'
import { Link } from 'react-router-dom'

export function SalesBillHeader({
  status,
  statusHint,
  draftKept,
  onShowShortcuts,
}: {
  status: string
  statusHint: string
  draftKept: boolean
  onShowShortcuts: () => void
}) {
  return (
    <>
      <nav className="billing-sale__crumbs" aria-label="Breadcrumb">
        <Link to="/sales">Sales</Link>
        <span className="billing-sale__crumb-sep" aria-hidden>
          ›
        </span>
        <span className="billing-sale__crumb-current" aria-current="page">
          New bill
        </span>
      </nav>

      <div className="billing-sale__head">
        <div className="billing-sale__headings">
          <div className="billing-sale__title">
            <h1>Create Sales Bill</h1>
            <span
              className={draftKept ? 'billing-sale__pill billing-sale__pill--kept' : 'billing-sale__pill'}
              title={statusHint}
            >
              {status}
            </span>
          </div>
          <p className="billing-sale__subtitle">
            Search or scan to add items, and Smart Books issues the invoice with its GST.
          </p>
        </div>

        <div className="billing-sale__strip">
          <div className="billing-sale__strip-item">
            <span className="billing-sale__strip-icon" aria-hidden>
              <Zap size={16} />
            </span>
            <div>
              <strong>Fast billing</strong>
              <span>Search, scan or type to add items</span>
            </div>
          </div>

          <span className="billing-sale__strip-divider" aria-hidden />

          <div className="billing-sale__strip-item">
            <span className="billing-sale__strip-icon" aria-hidden>
              <Sparkles size={16} />
            </span>
            <div>
              <strong>Smart Books</strong>
              <span>Works out the GST on this bill</span>
            </div>
          </div>

          <span className="billing-sale__strip-divider" aria-hidden />

          <button type="button" className="billing-sale__strip-shortcuts" onClick={onShowShortcuts}>
            <Keyboard size={14} aria-hidden /> Shortcuts
          </button>
        </div>
      </div>
    </>
  )
}
