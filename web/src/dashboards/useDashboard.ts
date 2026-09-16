/**
 * Loading one dashboard, with the period it is showing.
 *
 * The query key carries EVERY dimension the answer depends on — company,
 * branch, financial year and the date window — so changing any of them starts a
 * new request and aborts the old one. Without that last part a user who
 * switches company while a slow read is in flight gets the previous company's
 * figures painted over the new company's screen, which is the worst failure
 * this kind of screen has: it is wrong, it looks right, and nothing on it says
 * which company it belongs to.
 */

import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../services/api'
import { useBilling } from '../context/BillingContext'
import type { PeriodKey } from './DashboardLayout'

export interface DashboardState<T> {
  data: T | null
  loading: boolean
  error: string | null
  /** True when the failure is worth offering a Retry for rather than a fix. */
  retryable: boolean
  period: PeriodKey
  setPeriod: (key: PeriodKey) => void
  reload: () => void
}

export function useDashboard<T>(path: string, initialPeriod: PeriodKey = 'month', extra?: Record<string, string | undefined>): DashboardState<T> {
  const { scope } = useBilling()
  const [period, setPeriod] = useState<PeriodKey>(initialPeriod)
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryable, setRetryable] = useState(false)
  const [token, setToken] = useState(0)

  const reload = useCallback(() => setToken((value) => value + 1), [])
  const extraKey = JSON.stringify(extra ?? {})

  useEffect(() => {
    if (!scope) {
      setLoading(false)
      return undefined
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    api
      .one<T>(path, { period, ...extra }, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return
        setData(response.data)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        // The previous scope's figures must not stay on screen under the new
        // scope's heading.
        setData(null)
        if (err instanceof ApiError) {
          setError(err.message)
          setRetryable(err.retryable)
        } else {
          setError(err instanceof Error ? err.message : String(err))
          setRetryable(true)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, period, extraKey, scope?.cmp_id, scope?.fy_id, scope?.bo_id, token])

  return { data, loading, error, retryable, period, setPeriod, reload }
}
