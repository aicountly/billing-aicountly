/**
 * Shapes the Billing API returns.
 *
 * Ported from web/src/services/types.ts — only the slice this app needs so
 * far. Domain objects that belong to later screens (IntegrationCommand,
 * TransactionRequest, and everything below them) are not here yet.
 */

export interface MenuEntry {
  key: string
  label: string
  path: string
  /** Sub-entries the server decided this user may reach. Already permission-filtered. */
  children?: Array<{ label: string; path: string }>
}

/**
 * Something this DEPLOYMENT can or cannot do, and why.
 *
 * Not a permission: a permission says what this user may do, a capability says
 * whether the contract behind a feature exists at all. The reason is the
 * server's wording, printed as-is, so one missing service does not get
 * described four different ways on four screens.
 */
export interface Capability {
  available: boolean
  reason: string | null
}

export type CapabilityKey =
  | 'document_extraction'
  | 'transaction_drafts'
  | 'transaction_attachments'
  | 'accounting_preview'

/** A dashboard this profile may open. The API checks the same list. */
export interface DashboardEntry {
  key: string
  label: string
  path: string
}

export interface BillingSettings {
  cmp_id: number
  timezone: string
  business_mode: 'micro' | 'trader' | 'service' | 'retail' | 'owner'
  business_type: string | null
  gst_registered: boolean
  maintains_stock: boolean
  needs_purchase: boolean
  needs_payables: boolean
  needs_bank_cash: boolean
  default_sale_terms: string | null
  default_payment_terms: string | null
  onboarding_done: boolean
}

export interface BillingSession {
  uuid: string
  display_name: string
  /** False when the portal gave no name and display_name is the uuid standing in. */
  display_name_known: boolean
  is_owner: boolean
  context: { cmp_id: number; fy_id: number; bo_id: number }
  permissions: string[]
  settings: BillingSettings
  /** Computed on the server from the permissions and the business mode. */
  menu: MenuEntry[]
  /**
   * The dashboards this profile may open, in order, and where it starts.
   *
   * Both come from the server for the same reason the menu does: a tab bar
   * built on-device out of a permission list the device was handed is a tab
   * bar the device can edit. The endpoints check the same list, so a tab that
   * is absent here is also a URL that returns 403.
   */
  dashboards: DashboardEntry[]
  landing: string
  /**
   * Optional because an older API does not send it. A screen that cannot read a
   * capability must treat it as absent rather than as present, which is what
   * `capability()` below does.
   */
  capabilities?: Partial<Record<CapabilityKey, Capability>>
}

/**
 * What the server said about a capability, or a safe absence.
 *
 * The fallback is deliberately "not available": a feature drawn as working
 * because the flag could not be read is the failure this whole mechanism
 * exists to prevent.
 */
export function capability(session: BillingSession | null, key: CapabilityKey): Capability {
  return session?.capabilities?.[key] ?? { available: false, reason: null }
}
