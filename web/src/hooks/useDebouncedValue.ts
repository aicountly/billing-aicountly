/**
 * A value that settles before anything acts on it.
 *
 * Search boxes here are typed at, not pasted into, and a request per keystroke
 * means the answer to "ram" can land after the answer to "ramesh" and replace
 * it. Waiting for the typing to stop fixes both the traffic and the ordering.
 *
 * The delay is skipped when the value goes empty: clearing a search should feel
 * immediate, and there is no request to save in that direction anyway.
 */

import { useEffect, useState } from 'react'

export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    if (value === '' || value === null || value === undefined) {
      setSettled(value)
      return undefined
    }

    const timer = window.setTimeout(() => setSettled(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])

  return settled
}
