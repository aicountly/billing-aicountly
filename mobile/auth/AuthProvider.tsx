import React, { createContext, useContext, useEffect, useRef, useState } from 'react'

import { AuthError, ensureSesKey, performLogout, signInWithPortal } from './portal'
import { clearAllTokens, getAuthToken, setAuthToken } from './tokens'

/**
 * Unlike web, `loading` never precedes a full-page redirect — sign-in on
 * mobile is an explicit, user-initiated action (see `signIn` below), so this
 * only covers "starting up" and "mid sign-in/out".
 */
export type AuthStatus = 'loading' | 'authenticated' | 'signed-out'

interface AuthState {
  status: AuthStatus
  /** Why the user is looking at the signed-out screen, when it was not a plain sign-out. */
  message: string | null
}

interface AuthContextValue extends AuthState {
  signIn: () => void
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

const PORTAL_ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'The portal declined the sign-in request.',
  no_token: 'The portal did not return an auth token.',
}

function describePortalError(code: string): string {
  return PORTAL_ERROR_MESSAGES[code] ?? `The portal reported an error (${code}).`
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [state, setState] = useState<AuthState>({ status: 'loading', message: null })

  // Guards the boot effect against a double-fire (e.g. React StrictMode),
  // which would otherwise race two ensureSesKey() mints against each other.
  const booted = useRef(false)

  useEffect(() => {
    if (booted.current) return
    booted.current = true

    async function boot() {
      const authToken = await getAuthToken()
      if (!authToken) {
        // No silent portal bounce here — mobile always waits for an explicit
        // tap on "Sign in" (see signIn below).
        setState({ status: 'signed-out', message: null })
        return
      }

      try {
        await ensureSesKey()
        setState({ status: 'authenticated', message: null })
      } catch (err) {
        // 401 means the stored auth_token is spent. Anything else — the
        // portal being down, a timeout — must not silently discard a good
        // token, so it is reported instead of cleared.
        if (err instanceof AuthError && err.status === 401) {
          await clearAllTokens()
          setState({ status: 'signed-out', message: 'Your session has expired.' })
          return
        }
        setState({
          status: 'signed-out',
          message: err instanceof Error ? err.message : 'Could not reach the sign-in service.',
        })
      }
    }

    void boot()
  }, [])

  const value: AuthContextValue = {
    ...state,
    signIn: () => {
      setState({ status: 'loading', message: null })
      void (async () => {
        const result = await signInWithPortal()

        if ('authToken' in result) {
          await setAuthToken(result.authToken)
          try {
            await ensureSesKey()
            setState({ status: 'authenticated', message: null })
          } catch (err) {
            setState({
              status: 'signed-out',
              message: err instanceof Error ? err.message : 'Could not reach the sign-in service.',
            })
          }
          return
        }

        if ('error' in result) {
          setState({ status: 'signed-out', message: describePortalError(result.error) })
          return
        }

        setState({ status: 'signed-out', message: null })
      })()
    },
    signOut: () => {
      setState({ status: 'loading', message: null })
      void (async () => {
        await performLogout()
        setState({ status: 'signed-out', message: null })
      })()
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
