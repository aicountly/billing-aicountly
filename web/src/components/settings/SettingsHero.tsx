/**
 * The banner across the top of the Settings hub.
 *
 * The illustration is three CSS surfaces and a tick — no image asset, nothing
 * to download and nothing to go blurry on a 2x screen. It is decorative, so it
 * is hidden from assistive technology and from narrow screens entirely.
 */

import { Check } from 'lucide-react'

export function SettingsHero() {
  return (
    <section className="billing-settings__hero" aria-labelledby="billing-settings-hero-title">
      <div className="billing-settings__hero-copy">
        <h2 id="billing-settings-hero-title">Make Aicountly Billing work the way you do</h2>
        <p>Customise your business setup, documents, taxes, users and more.</p>
      </div>

      <div className="billing-settings__hero-art" aria-hidden>
        <div className="billing-settings__hero-doc">
          <span>Your Business</span>
          <strong>Your Rules</strong>
        </div>
        <div className="billing-settings__hero-check">
          <Check size={22} strokeWidth={3} />
        </div>
      </div>

      <p className="billing-settings__hero-quote">
        <span>“Simple settings.</span>
        <strong>Powerful business control.”</strong>
      </p>
    </section>
  )
}
