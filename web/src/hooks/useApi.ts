/**
 * Fetch-on-mount with loading, error and reload, cancelled cleanly on unmount.
 *
 * The abort matters: without it, a user clicking through a list faster than the
 * network answers gets the FIRST response painted last, and the screen shows a
 * record they have already navigated away from.
 */

import { useCallback, useEffect, useState } from 'react'

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
  /**
   * The error itself, when there was one.
   *
   * `error` is the sentence to show. This is the object behind it, so a screen
   * that needs to tell "you may not see this" apart from "Books was
   * unreachable" can narrow it to ApiError and read the status, instead of
   * matching on the text of a message.
   */
  cause: Error | null
  reload: () => void
}

export function useApi<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  enabled = true,
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [cause, setCause] = useState<Error | null>(null)
  const [token, setToken] = useState(0)

  const reload = useCallback(() => setToken((n) => n + 1), [])

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }

    const controller = new AbortController()
    let cancelled = false

    setLoading(true)
    setError(null)
    setCause(null)

    fetcher(controller.signal)
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err: Error) => {
        // An abort is this component going away, not a failure to report.
        if (cancelled || controller.signal.aborted) return
        setError(err.message)
        setCause(err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, token, enabled])

  return { data, loading, error, cause, reload }
}
