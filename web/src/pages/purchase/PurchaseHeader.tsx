/**
 * The page heading: where you came from, what this screen is, and one line of
 * reassurance that is true of the product rather than of this bill.
 */

import { ArrowLeft, Leaf } from 'lucide-react'

export function PurchaseHeader({ onBack }: { onBack: () => void }) {
  return (
    <header className="purchase-header">
      <div className="purchase-header__title">
        <button type="button" className="purchase-header__back" onClick={onBack} aria-label="Go back">
          <ArrowLeft size={17} aria-hidden />
        </button>

        <div>
          <h1>New Purchase</h1>
          <p>Capture supplier bills, GST details, items, and payment status in one place.</p>
        </div>
      </div>

      <div className="purchase-header__note">
        <Leaf size={18} aria-hidden style={{ flexShrink: 0 }} />
        <div>
          <strong>Smarter purchases for a stronger tomorrow</strong>
          <span>Smart Books posts the accounting. Inventory moves the stock.</span>
        </div>
      </div>
    </header>
  )
}
