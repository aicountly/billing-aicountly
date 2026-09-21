/**
 * Where to send somebody when the thing they want is Inventory's to do.
 *
 * Billing has no item master and is never going to have one, so "Add item",
 * "Import" and "Manage groups" are not features to be built here — they are
 * doors. This module is those doors, in one place, so the deep paths are not
 * scattered through the screens.
 *
 * Three things ride along, and all three matter:
 *
 *   cmp_id / fy_id / bo_id  the company, year and branch the user is working
 *                           in. Without them Inventory opens on whatever it
 *                           last had, which is how somebody adds an item to
 *                           the wrong company.
 *   return_url              where to come back to. Inventory is free to ignore
 *                           it; the link opens in a new tab as well, so the
 *                           half-finished bill behind it is still there either
 *                           way.
 *
 * Sign-in is not handled here and does not need to be: `auth_token` is a
 * cookie on `.aicountly.com` (see auth/sharedAuthCookie.ts), so a user who is
 * signed in to Billing is already signed in to Inventory and lands on the path
 * below rather than on a login form.
 */

import { getAppById, resolveAppOrigin } from './appLauncher'
import type { CompanyScope } from './api'

/** Inventory's own screens, as this product links to them. */
export const INVENTORY_PATHS = {
  items: '/items',
  newItem: '/items/new',
  editItem: (itemId: number) => `/items/${itemId}`,
  importItems: '/items/import',
  itemGroups: '/item-groups',
} as const

/**
 * A URL into Inventory, or null when the catalog has no Inventory entry.
 *
 * Null rather than a guessed hostname: a button that goes somewhere wrong is
 * worse than a button that is not drawn, and the screens check for null and
 * leave the action out.
 */
export function inventoryUrl(path: string, scope: CompanyScope | null, returnPath?: string): string | null {
  const app = getAppById('inventory')
  if (!app) return null

  const url = new URL(path, resolveAppOrigin(app))

  if (scope) {
    url.searchParams.set('cmp_id', String(scope.cmp_id))
    url.searchParams.set('fy_id', String(scope.fy_id))
    url.searchParams.set('bo_id', String(scope.bo_id))
  }
  if (returnPath) {
    url.searchParams.set('return_url', `${window.location.origin}${returnPath}`)
  }

  return url.toString()
}
