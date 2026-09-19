/**
 * A value that settles before it is acted on.
 *
 * The search box asks the server, and the server asks Smart Books. Firing that
 * on every keystroke means a person typing "Amazon" starts six readings of
 * somebody else's ledger and paints whichever answers last — which is not
 * necessarily the one for what they finished typing.
 */

import { useEffect, useState } from 'react'

export function useDebounced<T>(value: T, delay = 350): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])

  return settled
}
