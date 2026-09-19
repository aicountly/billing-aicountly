/**
 * A value that lags behind the one typed into it.
 *
 * The search box on the Items screen is wired straight to the API, and every
 * keystroke without this is one request Inventory has to answer and one answer
 * that may land after the next. The delay is long enough that "ballpoint"
 * costs one call rather than nine, and short enough that it still feels like
 * the list is following the typing.
 */

import { useEffect, useState } from 'react'

export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])

  return settled
}
