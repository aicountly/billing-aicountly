/**
 * The Reports screen's own preferences. UI state, and nothing else.
 *
 * WHAT IS KEPT HERE: which reports this person starred, which ones they opened
 * last and when, and how they like the screen set up. That is it — a list of
 * report KEYS and a timestamp.
 *
 * WHAT IS NEVER KEPT HERE: a single figure out of any report. No rows, no
 * balances, no party names, no totals. Billing owns no accounting data and this
 * file is not the place it starts owning some; a report is read from its owner
 * on the request that draws it, every time, and a "recently viewed" list that
 * remembered what the report SAID would be exactly the stored copy this product
 * does not keep.
 *
 * Kept per company. Somebody who works across two businesses does not want one
 * of them deciding what the other's shortcuts are, and a starred report on a
 * company you have left is noise.
 *
 * Storage can refuse — a private window, or a browser with site data blocked.
 * Every read and write is guarded, and the screen works without any of it.
 */

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'billing:reports:v1'

/** Enough to be useful on the landing screen without becoming a second menu. */
const RECENT_LIMIT = 8

export interface RecentEntry {
  /** The report key. The name is read from the live catalogue, never stored. */
  key: string
  /** ISO timestamp of when it was last opened. */
  at: string
}

export interface ReportPreferences {
  favourites: string[]
  recent: RecentEntry[]
  /** The period a report opens on. One of DashboardLayout's PERIOD_OPTIONS. */
  defaultPeriod: string
  /** Show the "Live from Smart Books" line under a report name. */
  showSources: boolean
  /** The shelf the explorer reopens on. */
  lastCategory: string | null
}

const EMPTY: ReportPreferences = {
  favourites: [],
  recent: [],
  defaultPeriod: 'month',
  showSources: true,
  lastCategory: null,
}

type Store = Record<string, Partial<ReportPreferences>>

function readStore(): Store {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Store
  } catch {
    return {}
  }
}

function writeStore(store: Store): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    /* storage refused; the choices still apply for this visit */
  }
}

function sanitise(raw: Partial<ReportPreferences> | undefined): ReportPreferences {
  if (!raw) return EMPTY

  const favourites = Array.isArray(raw.favourites)
    ? raw.favourites.filter((key): key is string => typeof key === 'string').slice(0, 50)
    : []

  const recent = Array.isArray(raw.recent)
    ? raw.recent
        .filter((entry): entry is RecentEntry =>
          Boolean(entry) && typeof entry === 'object' && typeof (entry as RecentEntry).key === 'string',
        )
        .map((entry) => ({ key: entry.key, at: typeof entry.at === 'string' ? entry.at : '' }))
        .slice(0, RECENT_LIMIT)
    : []

  return {
    favourites,
    recent,
    defaultPeriod: typeof raw.defaultPeriod === 'string' ? raw.defaultPeriod : EMPTY.defaultPeriod,
    showSources: typeof raw.showSources === 'boolean' ? raw.showSources : EMPTY.showSources,
    lastCategory: typeof raw.lastCategory === 'string' ? raw.lastCategory : null,
  }
}

function keyFor(cmpId: number | null | undefined): string | null {
  return cmpId ? `cmp:${cmpId}` : null
}

export function readPreferences(cmpId: number | null | undefined): ReportPreferences {
  const bucket = keyFor(cmpId)
  if (!bucket) return EMPTY
  return sanitise(readStore()[bucket])
}

function save(cmpId: number | null | undefined, next: ReportPreferences): void {
  const bucket = keyFor(cmpId)
  if (!bucket) return
  const store = readStore()
  store[bucket] = next
  writeStore(store)
}

export interface PreferencesApi extends ReportPreferences {
  isFavourite: (key: string) => boolean
  toggleFavourite: (key: string) => void
  /** Called when a report is actually opened, not when it is hovered. */
  noteOpened: (key: string) => void
  setDefaultPeriod: (period: string) => void
  setShowSources: (show: boolean) => void
  setLastCategory: (category: string | null) => void
  clearRecent: () => void
  clearFavourites: () => void
}

/**
 * The preferences for one company, as state.
 *
 * Re-reads whenever the company changes, so switching companies cannot leave
 * the previous one's shortcuts on screen.
 */
export function useReportPreferences(cmpId: number | null | undefined): PreferencesApi {
  const [prefs, setPrefs] = useState<ReportPreferences>(() => readPreferences(cmpId))

  useEffect(() => {
    setPrefs(readPreferences(cmpId))
  }, [cmpId])

  const update = useCallback(
    (change: (current: ReportPreferences) => ReportPreferences) => {
      setPrefs((current) => {
        const next = change(current)
        save(cmpId, next)
        return next
      })
    },
    [cmpId],
  )

  const isFavourite = useCallback((key: string) => prefs.favourites.includes(key), [prefs.favourites])

  const toggleFavourite = useCallback(
    (key: string) => {
      update((current) => ({
        ...current,
        favourites: current.favourites.includes(key)
          ? current.favourites.filter((entry) => entry !== key)
          : [...current.favourites, key],
      }))
    },
    [update],
  )

  const noteOpened = useCallback(
    (key: string) => {
      update((current) => ({
        ...current,
        recent: [
          { key, at: new Date().toISOString() },
          ...current.recent.filter((entry) => entry.key !== key),
        ].slice(0, RECENT_LIMIT),
      }))
    },
    [update],
  )

  const setDefaultPeriod = useCallback(
    (period: string) => update((current) => ({ ...current, defaultPeriod: period })),
    [update],
  )

  const setShowSources = useCallback(
    (show: boolean) => update((current) => ({ ...current, showSources: show })),
    [update],
  )

  const setLastCategory = useCallback(
    (category: string | null) => update((current) => ({ ...current, lastCategory: category })),
    [update],
  )

  const clearRecent = useCallback(() => update((current) => ({ ...current, recent: [] })), [update])
  const clearFavourites = useCallback(() => update((current) => ({ ...current, favourites: [] })), [update])

  return {
    ...prefs,
    isFavourite,
    toggleFavourite,
    noteOpened,
    setDefaultPeriod,
    setShowSources,
    setLastCategory,
    clearRecent,
    clearFavourites,
  }
}

/**
 * "2 hours ago", in the words somebody would use out loud.
 *
 * Anything older than a week gets the date instead: "37 days ago" is a number
 * the reader has to convert, and by then the date is the more useful thing.
 */
export function relativeTime(iso: string): string {
  if (!iso) return '—'
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return '—'

  const seconds = Math.round((Date.now() - then.getTime()) / 1000)
  if (seconds < 60) return 'just now'

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`

  const days = Math.round(hours / 24)
  if (days < 7) return days === 1 ? '1 day ago' : `${days} days ago`

  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(then)
}
