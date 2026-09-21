/**
 * Report settings — the ones this screen genuinely keeps.
 *
 * Which period a report opens on, whether each row says where its figures come
 * from, and the two shortcut lists. All of it is this browser's preference for
 * this company: no endpoint is called, nothing is shared with anyone else on
 * the account, and none of it changes what any report says.
 *
 * It says so on the panel, because a settings screen that does not tell you
 * where a setting lives is a settings screen people expect to follow them to
 * the next machine.
 */

import { Drawer } from '../../shell/Drawer'
import { PERIOD_OPTIONS } from '../../dashboards/DashboardLayout'
import type { PreferencesApi } from './preferences'

export function ReportSettingsDrawer({
  open,
  onClose,
  prefs,
}: {
  open: boolean
  onClose: () => void
  prefs: PreferencesApi
}) {
  return (
    <Drawer open={open} onClose={onClose} title="Report settings">
      <div className="reports-settings">
        <div className="reports-settings__group">
          <strong>
            <label htmlFor="reports-default-period">Period a report opens on</label>
          </strong>
          <select
            id="reports-default-period"
            className="reports-filter"
            value={prefs.defaultPeriod}
            onChange={(event) => prefs.setDefaultPeriod(event.target.value)}
          >
            {PERIOD_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="reports-settings__hint">
            You can still change the period on the report itself.
          </p>
        </div>

        <div className="reports-settings__group">
          <strong>Data source</strong>
          <label className="reports-settings__toggle">
            <input
              type="checkbox"
              checked={prefs.showSources}
              onChange={(event) => prefs.setShowSources(event.target.checked)}
            />
            <span>Show which product each report reads from</span>
          </label>
          <p className="reports-settings__hint">
            Billing stores no report data. Every figure is read from Smart Books or Inventory as the
            report is drawn.
          </p>
        </div>

        <div className="reports-settings__group">
          <strong>Your shortcuts</strong>
          <button
            type="button"
            className="billing-button billing-button--small"
            disabled={prefs.recent.length === 0}
            onClick={prefs.clearRecent}
          >
            Clear recently viewed ({prefs.recent.length})
          </button>
          <button
            type="button"
            className="billing-button billing-button--small"
            disabled={prefs.favourites.length === 0}
            onClick={prefs.clearFavourites}
          >
            Clear favourites ({prefs.favourites.length})
          </button>
          <p className="reports-settings__hint">
            These are kept in this browser, for this company only — a list of report names and when
            you opened them, never anything a report said.
          </p>
        </div>
      </div>
    </Drawer>
  )
}
