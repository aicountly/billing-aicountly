/**
 * The open financial year, with its dates — read from Manage, live.
 *
 * The scope in BillingContext is three ids; the year those ids point at has a
 * START and an END, and Manage owns both. A screen that has to keep a voucher
 * date inside the year needs the dates, not the id, so it asks the same
 * endpoint the company switcher asks and keeps nothing.
 *
 * `workingDate()` is what a date field should open on: today, unless today
 * falls outside the year that is open — somebody working in FY 2026-27 in
 * April 2027 wants the year's last day offered, not a date the books will
 * refuse.
 */

import { useMemo } from 'react'
import { useApi } from './useApi'
import { useBilling } from '../context/BillingContext'
import { fetchCompanyInfo } from '../services/manage'
import type { FyOption } from '../services/manage'

export interface FinancialYearState {
  year: FyOption | null
  loading: boolean
  /** Null when Manage answered. The screen stays usable either way. */
  error: string | null
  reload: () => void
}

export function useFinancialYear(): FinancialYearState {
  const { scope } = useBilling()

  const info = useApi(
    (signal) => fetchCompanyInfo(scope!.cmp_id, signal),
    [scope?.cmp_id],
    Boolean(scope),
  )

  const year = useMemo(() => {
    if (!scope || !info.data) return null
    return info.data.fyList.find((fy) => fy.fyId === scope.fy_id) ?? null
  }, [info.data, scope])

  return { year, loading: info.loading, error: info.error, reload: info.reload }
}

/** Today, pulled inside the financial year when today falls outside it. */
export function workingDate(year: FyOption | null, today = new Date()): string {
  const iso = toIso(today)
  if (!year || !year.start || !year.end) return iso
  if (iso < year.start) return year.start
  if (iso > year.end) return year.end
  return iso
}

/** Is this date inside the year? Unknown dates read as inside — Books decides. */
export function withinYear(value: string, year: FyOption | null): boolean {
  if (!year || !year.start || !year.end || !value) return true
  return value >= year.start && value <= year.end
}

function toIso(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 10)
}
