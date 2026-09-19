/**
 * Links into Aicountly Inventory, which owns every item master.
 *
 * Billing does not create, edit, import or deactivate an item. There is no
 * billing_items table to write to and adding one would be a second place for
 * the same product to exist under two names — so the buttons that look like
 * they edit a catalogue here do not: they open the catalogue in the product
 * that owns it.
 *
 * The jump needs no portal round trip. `auth_token` is written to a cookie on
 * `.aicountly.com` (see auth/sharedAuthCookie.ts), so a sibling product opened
 * at a path reads the same session and stays on that path. Off the shared
 * domain — local development — Inventory signs the user in and lands them on
 * its own home instead, which is a longer way round rather than a dead button.
 *
 * The company, branch and financial year travel as the fleet's own three
 * parameters, and `returnUrl` brings the user back to the exact Items view
 * they left, filters and page included, because that state lives in the URL.
 *
 * ONE PLACE TO CHANGE. The paths below are Inventory's, not ours. If that
 * product moves a screen, this map is the single line that follows it.
 */

import type { CompanyScope } from './api'
import { getAppById, resolveAppOrigin } from './appLauncher'

const INVENTORY_APP_ID = 'inventory'

export const INVENTORY_PATHS = {
  items: '/items',
  newItem: '/items/new',
  importItems: '/items/import',
  itemGroups: '/item-groups',
  item: (itemId: number) => `/items/${itemId}`,
  editItem: (itemId: number) => `/items/${itemId}/edit`,
  stock: (itemId: number) => `/items/${itemId}/stock`,
} as const

/** The Inventory origin for this environment, or null if the catalog lacks it. */
export function inventoryOrigin(): string | null {
  const app = getAppById(INVENTORY_APP_ID)
  return app ? resolveAppOrigin(app) : null
}

/**
 * An absolute URL into Inventory, carrying the open company scope and the way
 * back. Null when Inventory is not in this deployment's app catalog, which is
 * how the caller knows to leave the button out rather than draw a dead one.
 */
export function inventoryUrl(path: string, scope: CompanyScope | null, returnTo?: string): string | null {
  const origin = inventoryOrigin()
  if (!origin) return null

  const url = new URL(path, origin)
  if (scope) {
    url.searchParams.set('cmp_id', String(scope.cmp_id))
    url.searchParams.set('fy_id', String(scope.fy_id))
    url.searchParams.set('bo_id', String(scope.bo_id))
  }
  if (returnTo) {
    url.searchParams.set('returnUrl', new URL(returnTo, window.location.origin).toString())
  }

  return url.toString()
}

/** Where a user should come back to: this screen, with its filters intact. */
export function currentReturnUrl(): string {
  return `${window.location.pathname}${window.location.search}`
}
