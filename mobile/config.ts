/**
 * Build-time configuration.
 *
 * Expo inlines every EXPO_PUBLIC_* value into the bundle at build time — the
 * same mechanism as Vite's VITE_* on web — so these are public values and the
 * shipped app never reads a .env from disk.
 */

export const APP_NAME = (process.env.EXPO_PUBLIC_APP_NAME ?? 'Billing').trim() || 'Billing'

/** `local` | `sandbox` | `production` — set by the deploy workflows. */
export const APP_ENV = (process.env.EXPO_PUBLIC_APP_ENV ?? 'local').trim() || 'local'

const CONFIGURED_API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').trim()

/**
 * Base URL of this product's own PHP API.
 *
 * Unlike web there is no same-origin to fall back to on a native app, so this
 * must always be configured explicitly — an unset value is a build mistake,
 * not something to guess around.
 */
export function getApiBaseUrl(): string {
  if (CONFIGURED_API_BASE_URL) return CONFIGURED_API_BASE_URL.replace(/\/$/, '')
  throw new Error('EXPO_PUBLIC_API_BASE_URL is not set.')
}

/** Portal `authentication_jump/{key}` product key. */
export const PRODUCT_KEY = (process.env.EXPO_PUBLIC_PRODUCT_KEY ?? 'billing').trim() || 'billing'

const CONFIGURED_PORTAL_LOGIN_URL = (process.env.EXPO_PUBLIC_PORTAL_LOGIN_URL ?? '').trim()

/** Login portal — renders the sign-in form and performs the SSO jump. */
export const PORTAL_LOGIN_URL =
  (CONFIGURED_PORTAL_LOGIN_URL || 'https://sandbox.aicountly.com').replace(/\/$/, '')

/**
 * Portal auth API — always production, in both sandbox and production builds.
 * seskey and logout always answer on my.aicountly.com; only the login page
 * differs by environment (see PORTAL_LOGIN_URL).
 */
export const PORTAL_AUTH_API = 'https://my.aicountly.com'
