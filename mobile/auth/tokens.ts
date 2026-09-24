/**
 * Token storage for the two-token AICOUNTLY model.
 *
 * | Token        | Lifetime    | Storage             | Use                           |
 * |--------------|-------------|---------------------|--------------------------------|
 * | `auth_token` | Long-lived  | SecureStore         | Mint / refresh a `ses_key`    |
 * | `ses_key`    | ~15 minutes | Memory ONLY         | `Bearer` on product API calls |
 *
 * `ses_key` must never reach SecureStore or AsyncStorage — that rule is the
 * whole point of the split, and it is why it lives in a module variable that
 * dies with the app process. `auth_token` uses SecureStore (encrypted
 * keychain/keystore), not AsyncStorage, because it is a credential.
 */

import * as SecureStore from 'expo-secure-store'

const AUTH_TOKEN_KEY = 'auth_token'

// ---------- auth_token ----------

let authToken: string | null = null
let authTokenLoaded = false

export async function setAuthToken(token: string | null): Promise<void> {
  authToken = token || null
  authTokenLoaded = true

  try {
    if (authToken) await SecureStore.setItemAsync(AUTH_TOKEN_KEY, authToken)
    else await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY)
  } catch {
    /* ignore keychain/keystore failures */
  }
}

/**
 * Memory-cached after the first load, since SecureStore access is async and
 * every other reader here needs the value synchronously-ish (i.e. without
 * re-hitting the keychain on every call).
 */
export async function getAuthToken(): Promise<string | null> {
  if (authTokenLoaded) return authToken

  try {
    authToken = await SecureStore.getItemAsync(AUTH_TOKEN_KEY)
  } catch {
    authToken = null
  }
  authTokenLoaded = true
  return authToken
}

// ---------- ses_key (memory only, never persisted) ----------

let sesKey: string | null = null
let sesExpiry = 0

export function saveSession(key: string, expiresInSeconds: number): void {
  sesKey = key
  sesExpiry = Date.now() + expiresInSeconds * 1000
}

export function getSesKey(): string | null {
  if (sesKey && Date.now() < sesExpiry) return sesKey
  sesKey = null
  sesExpiry = 0
  return null
}

export function clearSession(): void {
  sesKey = null
  sesExpiry = 0
}

/** Full sign-out: drops the session key and the persisted auth token. */
export async function clearAllTokens(): Promise<void> {
  clearSession()
  authToken = null
  authTokenLoaded = true

  try {
    await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY)
  } catch {
    /* ignore */
  }
}
