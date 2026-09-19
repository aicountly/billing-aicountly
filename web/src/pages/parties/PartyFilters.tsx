/**
 * The filter bar, and the drawer behind "More filters".
 *
 * Four controls stay on the bar because they are the ones a small business
 * reaches for every day — search, which half of the directory, active or not,
 * and where they are. The rest live in the drawer: a toolbar with eleven
 * dropdowns on it is a toolbar nobody reads.
 *
 * Every option offered here is one the server can genuinely apply. The State
 * and Group pickers are built from what Books actually returned, so a filter
 * can never offer a value that matches nothing — and when the reading was
 * partial they offer nothing at all rather than half the list, because a
 * picker missing half its entries looks complete.
 */

import { useEffect, useState } from 'react'
import { LayoutGrid, List, Search, SlidersHorizontal, X } from 'lucide-react'
import { Drawer } from '../../shell/Drawer'
import {
  activeFilterCount,
  type PartyOverview,
  type PartyQuery,
  type PartySort,
} from '../../services/parties'

const SORTS: Array<{ value: `${PartySort}:${'asc' | 'desc'}`; label: string }> = [
  { value: 'name:asc', label: 'Name (A–Z)' },
  { value: 'name:desc', label: 'Name (Z–A)' },
  { value: 'outstanding:desc', label: 'Most outstanding' },
  { value: 'overdue:desc', label: 'Most overdue' },
  { value: 'credit_limit:desc', label: 'Highest credit limit' },
  { value: 'last_transaction:desc', label: 'Recently active' },
  { value: 'last_transaction:asc', label: 'Least recently active' },
]

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="billing-parties__filter-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

export function PartyFilterBar({
  query,
  search,
  onSearch,
  onChange,
  overview,
  view,
  onView,
  onOpenMore,
}: {
  query: PartyQuery
  /** The raw box contents, which run ahead of the query while somebody types. */
  search: string
  onSearch: (value: string) => void
  onChange: (next: Partial<PartyQuery>) => void
  overview: PartyOverview | null
  view: 'table' | 'cards'
  onView: (view: 'table' | 'cards') => void
  onOpenMore: () => void
}) {
  const extra = activeFilterCount(query)
  const states = overview?.facets.states ?? []
  const groups = overview?.facets.groups ?? []

  return (
    <div className="billing-parties__filters">
      <div className="billing-search">
        <Search size={15} className="billing-search__icon" aria-hidden />
        <label className="billing-sr-only" htmlFor="party-search">
          Search parties by name, GSTIN, phone, email or city
        </label>
        <input
          id="party-search"
          className="billing-search__input"
          type="search"
          placeholder="Search by name, GSTIN, phone, email or city…"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </div>

      <Field label="Party type">
        <select
          className="billing-parties__select"
          value={query.side}
          onChange={(event) => onChange({ side: event.target.value as PartyQuery['side'], page: 1 })}
        >
          <option value="all">All</option>
          {(overview?.may_see_customers ?? true) && <option value="customer">Customers</option>}
          {(overview?.may_see_suppliers ?? true) && <option value="supplier">Suppliers</option>}
        </select>
      </Field>

      <Field label="Status">
        <select
          className="billing-parties__select"
          value={query.status}
          onChange={(event) => onChange({ status: event.target.value as PartyQuery['status'], page: 1 })}
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </Field>

      <Field label="State">
        <select
          className="billing-parties__select"
          value={query.state}
          disabled={states.length === 0}
          onChange={(event) => onChange({ state: event.target.value, page: 1 })}
        >
          <option value="all">{states.length === 0 ? 'Not available' : 'All'}</option>
          {states.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Group">
        <select
          className="billing-parties__select"
          value={query.group}
          disabled={groups.length === 0}
          onChange={(event) => onChange({ group: event.target.value, page: 1 })}
        >
          <option value="all">{groups.length === 0 ? 'Not available' : 'All'}</option>
          {groups.map((group) => (
            <option key={group} value={group}>
              {group}
            </option>
          ))}
        </select>
      </Field>

      {/* Forces the wrap where it reads best rather than wherever the widths
          happen to land: the four pickers finish one line, and the controls
          that act on the whole list start the next. */}
      <span className="billing-parties__filters-break" aria-hidden />

      <button type="button" className="billing-button" onClick={onOpenMore}>
        <SlidersHorizontal size={15} aria-hidden /> More filters
        {extra > 0 && <span className="billing-parties__count-badge">{extra}</span>}
      </button>

      <div className="billing-parties__filters-end">
      <div className="billing-parties__viewtoggle" role="group" aria-label="How to show the list">
        <button type="button" aria-pressed={view === 'table'} aria-label="Table" onClick={() => onView('table')}>
          <List size={16} aria-hidden />
        </button>
        <button type="button" aria-pressed={view === 'cards'} aria-label="Cards" onClick={() => onView('cards')}>
          <LayoutGrid size={16} aria-hidden />
        </button>
      </div>

      <Field label="Sort">
        <select
          className="billing-parties__select"
          value={`${query.sort}:${query.order}`}
          onChange={(event) => {
            const [sort, order] = event.target.value.split(':')
            onChange({ sort: sort as PartySort, order: order as 'asc' | 'desc', page: 1 })
          }}
        >
          {SORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      </div>
    </div>
  )
}

/**
 * The rest of the filters.
 *
 * Held as a draft and applied on Apply rather than on every change: each one
 * costs a reading of somebody else's ledger, and half of these are usually
 * changed together.
 */
export function PartyFilterDrawer({
  open,
  onClose,
  query,
  onApply,
  overview,
}: {
  open: boolean
  onClose: () => void
  query: PartyQuery
  onApply: (next: Partial<PartyQuery>) => void
  overview: PartyOverview | null
}) {
  const [draft, setDraft] = useState(query)

  // Reopening after a change elsewhere should show what is actually on.
  useEffect(() => {
    if (open) setDraft(query)
  }, [open, query])

  const cities = overview?.facets.cities ?? []

  function apply() {
    onApply({
      balance: draft.balance,
      credit: draft.credit,
      gst: draft.gst,
      activity: draft.activity,
      city: draft.city,
      state: draft.state,
      group: draft.group,
      page: 1,
    })
    onClose()
  }

  function reset() {
    setDraft({
      ...draft,
      balance: 'any',
      credit: 'any',
      gst: 'any',
      activity: 'any',
      city: '',
      state: 'all',
      group: 'all',
    })
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="right"
      wide
      title="More filters"
      footer={
        <>
          <button type="button" className="billing-button billing-button--primary" onClick={apply} style={{ flex: 1 }}>
            Apply
          </button>
          <button type="button" className="billing-button" onClick={reset}>
            <X size={15} aria-hidden /> Reset
          </button>
        </>
      }
    >
      <div className="billing-parties__drawer-section">
        <h3>What they owe</h3>
        <Field label="Balance">
          <select
            className="billing-parties__select"
            style={{ maxWidth: 'none' }}
            value={draft.balance}
            onChange={(event) => setDraft({ ...draft, balance: event.target.value as PartyQuery['balance'] })}
          >
            <option value="any">Any</option>
            <option value="outstanding">Has an open balance</option>
            <option value="overdue">Has something overdue</option>
            <option value="settled">Nothing outstanding</option>
          </select>
        </Field>

        <Field label="Credit limit">
          <select
            className="billing-parties__select"
            style={{ maxWidth: 'none' }}
            value={draft.credit}
            onChange={(event) => setDraft({ ...draft, credit: event.target.value as PartyQuery['credit'] })}
          >
            <option value="any">Any</option>
            <option value="within">Within their limit</option>
            <option value="over">Over their limit</option>
            <option value="none">No limit set</option>
          </select>
        </Field>
      </div>

      <div className="billing-parties__drawer-section">
        <h3>Registration and activity</h3>
        <Field label="GST">
          <select
            className="billing-parties__select"
            style={{ maxWidth: 'none' }}
            value={draft.gst}
            onChange={(event) => setDraft({ ...draft, gst: event.target.value as PartyQuery['gst'] })}
          >
            <option value="any">Any</option>
            <option value="registered">Registered</option>
            <option value="unregistered">Not registered</option>
          </select>
        </Field>

        <Field label="Last transaction">
          <select
            className="billing-parties__select"
            style={{ maxWidth: 'none' }}
            value={draft.activity}
            onChange={(event) => setDraft({ ...draft, activity: event.target.value as PartyQuery['activity'] })}
          >
            <option value="any">Any time</option>
            <option value="last_7">In the last 7 days</option>
            <option value="last_30">In the last 30 days</option>
            <option value="last_90">In the last 90 days</option>
            <option value="none">Never</option>
          </select>
        </Field>
      </div>

      <div className="billing-parties__drawer-section">
        <h3>Where they are</h3>
        <Field label="State">
          <select
            className="billing-parties__select"
            style={{ maxWidth: 'none' }}
            value={draft.state}
            disabled={(overview?.facets.states ?? []).length === 0}
            onChange={(event) => setDraft({ ...draft, state: event.target.value })}
          >
            <option value="all">All</option>
            {(overview?.facets.states ?? []).map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
        </Field>

        <Field label="City">
          <input
            className="billing-parties__select"
            style={{ maxWidth: 'none' }}
            type="search"
            list="party-cities"
            placeholder="Any"
            value={draft.city}
            onChange={(event) => setDraft({ ...draft, city: event.target.value })}
          />
        </Field>
        <datalist id="party-cities">
          {cities.map((city) => (
            <option key={city} value={city} />
          ))}
        </datalist>

        <Field label="Group">
          <select
            className="billing-parties__select"
            style={{ maxWidth: 'none' }}
            value={draft.group}
            disabled={(overview?.facets.groups ?? []).length === 0}
            onChange={(event) => setDraft({ ...draft, group: event.target.value })}
          >
            <option value="all">All</option>
            {(overview?.facets.groups ?? []).map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {overview && !overview.complete && (
        <p className="billing-parties__stat-note">
          There are more parties than one reading can compare, so the State and Group lists are not offered. Narrowing
          with the search box first will bring them back.
        </p>
      )}
    </Drawer>
  )
}
