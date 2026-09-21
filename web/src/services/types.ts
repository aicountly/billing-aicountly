/**
 * Shapes the Billing API returns.
 *
 * There is no Invoice type here with an amount and a tax breakdown, and no
 * Receivable type with a balance — those belong to Smart Books and arrive from
 * Books-backed endpoints as the shapes Books gives them. What is typed here is
 * what Billing owns: a request, a profile, a rule.
 */

export interface MenuEntry {
  key: string
  label: string
  path: string
  /** Sub-entries the server decided this user may reach. Already permission-filtered. */
  children?: Array<{ label: string; path: string }>
}

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
   * built in the browser out of a permission list the browser was handed is a
   * tab bar the browser can edit. The endpoints check the same list, so a tab
   * that is absent here is also a URL that returns 403.
   */
  dashboards: DashboardEntry[]
  landing: string
}

export interface IntegrationCommand {
  command_id: number
  target_service: string
  command_type: string
  status: 'PENDING' | 'POSTING' | 'COMPLETED' | 'FAILED' | 'BLOCKED'
  attempts: number
  last_error: string | null
  external_reference: Record<string, unknown> | string | null
  last_attempt_at: string | null
  completed_at: string | null
}

/** What the user asked Billing to create in Books, and how it went. */
export interface TransactionRequest {
  request_id: number
  request_uuid: string
  kind: string
  status: 'PENDING' | 'POSTING' | 'POSTED' | 'FAILED' | 'CANCELLED'
  party_account_id: number | null
  transaction_date: string
  payload: Record<string, unknown> | string
  books_voucher_id: number | null
  books_voucher_uuid: string | null
  books_voucher_no: string | null
  last_error: string | null
  created_at: string
  commands?: IntegrationCommand[]
}

export interface DueBill {
  account_id: number
  account_name: string
  bill_no: string | null
  bill_date: string | null
  due_date: string | null
  balance: number
  days_overdue: number
  voucher_id: number | null
  voucher_uuid: string | null
}

export interface DueParty {
  account_id: number
  account_name: string
  total: number
  overdue: number
  bill_count: number
  oldest_overdue_days: number
}

/** Receivables or payables, composed from Books' bill-by-bill on this request. */
export interface Dues {
  title: string
  as_on: string
  source: string
  total: number
  overdue: number
  due_today: number
  due_this_week: number
  ageing: {
    current: number
    '1_30': number
    '31_60': number
    '61_90': number
    '90_plus': number
    /** Bills Books returned without a due date. Its own bucket so the bar still adds up. */
    no_due_date: number
  }
  /** The server checked the buckets sum to the total. False means do not draw the breakdown. */
  ageing_reconciles: boolean
  parties: DueParty[]
  bills: DueBill[]
  note: string
}

export interface CashBank {
  available: boolean
  reason?: string
  cash?: number | null
  bank?: number | null
  accounts?: Array<{ account_id: number; account_name: string; balance: number; kind: 'cash' | 'bank' }>
  source?: string
}

export interface Insight {
  kind: string
  tone: 'info' | 'warning' | 'danger'
  message: string
  action: { label: string; path: string }
}

export interface BillingProfile {
  profile_id: number
  profile_code: string
  profile_name: string
  description: string | null
  template_key: string
  permissions: string[] | string
  is_system: boolean
  is_active: boolean
  member_count?: string
}

export interface ProfileMember {
  assignment_id: number
  user_uuid: string
  created_by: string | null
  created_at: string
}

export interface RecurringRule {
  rule_id: number
  rule_name: string
  customer_account_id: number
  frequency: string
  interval_days: number | null
  day_of_month: number | null
  start_date: string
  end_date: string | null
  next_run_date: string
  template_lines: unknown
  narration: string | null
  status: 'ACTIVE' | 'PAUSED' | 'ENDED'
  auto_post: boolean
  last_run_at: string | null
  runs?: Array<{
    run_id: number
    due_date: string
    status: string
    books_voucher_no: string | null
    last_error: string | null
    ran_at: string | null
  }>
}

export interface ReminderRule {
  rule_id: number
  rule_name: string
  offset_days: number
  repeat_days: number
  max_reminders: number
  channel: string
  message_template: string | null
  minimum_amount: string
  is_active: boolean
}

export interface StatutoryStatus {
  voucher_id: number
  e_invoice: Record<string, unknown> | null
  e_way_bill: Record<string, unknown> | null
  reachable: boolean
  source: string
}

/** An item as Inventory describes it. Rendered, never stored. */
export interface CatalogItem {
  item_id: number
  item_name: string
  item_sku: string | null
  unit_id: number | null
  hsn_sac: string | null
  mrp: string | null
  use_count?: number
}

/** A party as Books describes it (its account ledger). Rendered, never stored. */
export interface CatalogParty {
  acc_id: number
  acc_name: string
  gstin?: string | null
}

export interface CashBankAccount {
  acc_id: number
  acc_name: string
}

/**
 * An expense this product recorded, as `v1/expenses/recent` describes it.
 *
 * The names are resolved live from Books on that request; `null` means Books
 * did not answer, not that the account is missing.
 */
export interface RecentExpense {
  request_id: number
  date: string
  amount: number | null
  note: string | null
  reference_no: string | null
  category_id: number | null
  category_name: string | null
  paid_from_id: number | null
  paid_from_name: string | null
  party_account_id: number | null
  voucher_id: number | null
  voucher_no: string | null
}

export interface RecentExpenses {
  rows: RecentExpense[]
  /** False when Books did not answer: the amounts still stand, the chips do not. */
  names_available: boolean
  basis: string
}

/** One thing a deployment either can or cannot do, with the reason when it cannot. */
export interface DocumentCapability {
  available: boolean
  reason: string | null
  accepts?: string[]
  max_bytes?: number
}

/** Whether a bill file can be kept here, and whether it can be read automatically. */
export interface ExpenseCapabilities {
  bill_storage: DocumentCapability
  bill_extraction: DocumentCapability
}

/** An expense head or a cash/bank account, as Books' account list describes it. */
export interface CatalogAccount {
  acc_id: number
  acc_name: string
}

/**
 * A bill file the document service has taken, as `POST v1/expenses/bill`
 * describes it.
 *
 * `reference` is the part that matters: it is what travels to Books on the
 * voucher as `attachment_ref`. The rest is for the person looking at the form —
 * `url` is present only when the document service hands one back, and there is
 * no link to the stored bill when it does not.
 */
export interface StoredBill {
  reference: string
  filename: string | null
  size: number | null
  content_type: string | null
  url: string | null
}
