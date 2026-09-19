/**
 * One category tile.
 *
 * It is a link, not a button with an onClick: middle-click, Ctrl-click and
 * "open in new tab" all work for free, Enter activates it natively, and the
 * browser draws the URL in the status bar before the user commits — which a
 * div with a click handler cannot do.
 */

import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import type { SettingsCategory } from '../../config/settingsCatalog'

export function SettingsCategoryCard({ category }: { category: SettingsCategory }) {
  const Icon = category.icon

  return (
    <Link to={category.path} className="billing-settings__card">
      <span className={`billing-settings__icon billing-settings__icon--${category.accent}`} aria-hidden>
        <Icon size={24} strokeWidth={1.9} />
      </span>

      <span className="billing-settings__card-copy">
        <strong>{category.title}</strong>
        <small>{category.description}</small>
      </span>

      <ChevronRight size={20} aria-hidden className="billing-settings__chevron" />
    </Link>
  )
}
