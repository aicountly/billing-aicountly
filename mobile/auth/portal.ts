/**
 * AICOUNTLY portal SSO — the login half of the app.
 *
 * Flow:
 *
 *   1. User taps "Sign in" (there is no automatic silent bounce on mobile —
 *      see AuthProvider.tsx)
 *   2. → in-app browser opens
 *      {PORTAL_LOGIN_URL}/login/authentication_jump/{PRODUCT_KEY}?returnUrl=…
 *   3. ← portal redirects to our own scheme with ?auth_token=…
 *   4. POST {PORTAL_AUTH_API}/api/seskey (Bearer auth_token) → ses_key
 *
 * Unlike web, native apps are not subject to CORS, so there is no same-origin
 * relay: every portal call goes straight to PORTAL_AUTH_API. There is also no
 * shared-cookie cross-product SSO on mobile (no equivalent of web's
 * sharedAuthCookie.ts) — sign-in is always explicit and per-app.
 */

import * as WebBrowser from 'expo-web-browser'
import * as Linking from 'expo-linking'
import { makeRedirectUri } from 'expo-auth-session'

import { PORTAL_AUTH_API, PORTAL_LOGIN_URL, PRODUCT_KEY } from '../config'
import { clearAllTokens, clearSession, getAuthToken, getSesKey, saveSession } from './tokens'

const SESKEY_TIMEOUT_MS = 15_000

export class AuthError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'AuthError'
    this.status = status
  }
}

async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SESKEY_TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new AuthError('Session request timed out — please retry.', 0)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

interface SesKeyResponse {
  ses_key?: string
  sesKey?: string
  token?: string
  access_token?: string
  expires_in?: number
  expiresIn?: number
}

async function requestSesKey(): Promise<string> {
  const authToken = await getAuthToken()
  if (!authToken) {
    throw new AuthError('No auth token — sign in again.', 401)
  }

  const res = await fetchWithTimeout(`${PORTAL_AUTH_API}/api/seskey`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new AuthError(body || `HTTP ${res.status}`, res.status)
  }

  const data = (await res.json()) as SesKeyResponse
  const key = data.ses_key ?? data.sesKey ?? data.token ?? data.access_token
  if (!key) {
    throw new AuthError('The auth service returned no session key.', 200)
  }

  saveSession(key, data.expires_in ?? data.expiresIn ?? 900)
  return key
}

let mintInFlight: Promise<string> | null = null

/**
 * The current ses_key, minting one from the auth_token if there is none.
 *
 * `force` discards the stored key first — used after a 401, since a key can
 * be revoked server-side before its local expiry.
 *
 * Concurrent callers share one in-flight mint so a burst of API calls on a
 * cold session doesn't mint a handful of keys and keep only the last.
 */
export async function ensureSesKey(force = false): Promise<string> {
  if (force) {
    clearSession()
  } else {
    const existing = getSesKey()
    if (existing) return existing
  }

  if (!mintInFlight) {
    mintInFlight = requestSesKey().finally(() => {
      mintInFlight = null
    })
  }
  return mintInFlight
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

export type PortalSignInResult = { authToken: string } | { error: string } | { cancelled: true }

/**
 * TODO(portal-verify): the AICOUNTLY portal's `returnUrl` handling has not
 * been confirmed to accept a custom URL scheme (`aicountlybilling://auth/callback`)
 * rather than an https URL. Verify with whoever runs my.aicountly.com /
 * sandbox.aicountly.com before relying on this in production — if the portal
 * rejects non-https returnUrls, this redirect needs a different strategy
 * (e.g. an https intermediary page with Associated Domains / App Links that
 * then hands off into the app).
 */
export async function signInWithPortal(): Promise<PortalSignInResult> {
  const redirectUri = makeRedirectUri({ scheme: 'aicountlybilling', path: 'auth/callback' })
  const jumpUrl = `${PORTAL_LOGIN_URL}/login/authentication_jump/${PRODUCT_KEY}?returnUrl=${encodeURIComponent(redirectUri)}`

  const result = await WebBrowser.openAuthSessionAsync(jumpUrl, redirectUri)

  if (result.type !== 'success') {
    return { cancelled: true }
  }

  const { queryParams } = Linking.parse(result.url)
  const authToken = queryParams?.auth_token
  const authError = queryParams?.auth_error

  if (typeof authToken === 'string' && authToken) {
    return { authToken }
  }
  if (typeof authError === 'string' && authError) {
    return { error: authError }
  }
  // A short code, like `authError` above — AuthProvider maps both through the
  // same PORTAL_ERROR_MESSAGES table, so this must not be prose itself (it
  // would otherwise get wrapped a second time as "The portal reported an
  // error (<this sentence>).").
  return { error: 'no_token' }
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

/**
 * Sign out. Local tokens are cleared first so nothing can be replayed if the
 * network call fails. Unlike web there is no portal page to navigate to
 * afterward — there is no shared browser session on mobile to clear — so this
 * just returns once local state is gone.
 */
export async function performLogout(): Promise<void> {
  const authToken = await getAuthToken()

  await clearAllTokens()

  if (authToken) {
    // Fire-and-forget: the portal invalidates the token server-side, but
    // sign-out must not wait on it.
    fetch(`${PORTAL_AUTH_API}/api/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
    }).catch(() => {
      /* local session is already gone; nothing else depends on this */
    })
  }
}
