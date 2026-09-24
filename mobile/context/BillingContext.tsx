/**
 * Company scope, session and permissions for the whole app.
 *
 * React Native port of web/src/context/BillingContext.tsx. The scope is three
 * ids — company, branch, financial year — belonging to Manage; this provider
 * holds only what it needs to make calls and to remember the user's last
 * choice between visits.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react'
import { api, setScope, type CompanyScope } from '../services/api'
import type { BillingSession } from '../services/types'

interface BillingContextValue {
  scope: CompanyScope | null
  setCompanyScope: (scope: CompanyScope) => void
  session: BillingSession | null
  /** Has this user got that permission? Owners hold everything. */
  can: (permission: string) => boolean
  loading: boolean
  error: string | null
  reload: () => void
}

const BillingContextObject = createContext<BillingContextValue | null>(null)

const SCOPE_KEY = 'billing:scope'

async function readStoredScope(): Promise<CompanyScope | null> {
  try {
    const raw = await AsyncStorage.getItem(SCOPE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CompanyScope>
    if (!parsed.cmp_id || !parsed.fy_id) return null
    return { cmp_id: Number(parsed.cmp_id), fy_id: Number(parsed.fy_id), bo_id: Number(parsed.bo_id ?? 0) }
  } catch {
    // Storage the device refuses. The app still works; the user just picks
    // their company again.
    return null
  }
}

export function BillingProvider({ children }: { children: ReactNode }): JSX.Element {
  const [scope, setScopeState] = useState<CompanyScope | null>(null)
  const [session, setSession] = useState<BillingSession | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  // AsyncStorage is async (unlike web's localStorage), so the last-chosen
  // scope can only be read after mount, in an effect, rather than seeded into
  // useState's initializer.
  useEffect(() => {
    let cancelled = false
    readStoredScope().then((stored) => {
      if (!cancelled && stored) setScopeState(stored)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // The API module reads the scope on every call, so it is registered as soon
  // as it changes rather than being threaded through each request.
  useEffect(() => {
    setScope(scope)
  }, [scope])

  const setCompanyScope = useCallback((next: CompanyScope) => {
    setScopeState(next)
    // Fire-and-forget: AsyncStorage.setItem is async, so a failed write is
    // caught on the returned promise rather than with a sync try/catch.
    AsyncStorage.setItem(SCOPE_KEY, JSON.stringify(next)).catch(() => {
      /* storage refused; the choice still applies for this visit */
    })
  }, [])

  useEffect(() => {
    if (!scope) {
      setSession(null)
      return
    }

    let cancelled = false
    const controller = new AbortController()

    setLoading(true)
    setError(null)

    api
      .one<BillingSession>('v1/session', undefined, controller.signal)
      .then((response) => {
        if (!cancelled) setSession(response.data)
      })
      .catch((err: Error) => {
        if (cancelled || controller.signal.aborted) return
        setError(err.message)
        setSession(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [scope, reloadToken])

  const can = useCallback(
    (permission: string) => {
      if (!session) return false
      if (session.is_owner) return true
      return session.permissions.includes(permission)
    },
    [session],
  )

  const value = useMemo<BillingContextValue>(
    () => ({
      scope,
      setCompanyScope,
      session,
      can,
      loading,
      error,
      reload: () => setReloadToken((n) => n + 1),
    }),
    [scope, setCompanyScope, session, can, loading, error],
  )

  return <BillingContextObject.Provider value={value}>{children}</BillingContextObject.Provider>
}

export function useBilling(): BillingContextValue {
  const value = useContext(BillingContextObject)
  if (!value) throw new Error('useBilling must be used inside BillingProvider')
  return value
}
