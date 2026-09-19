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

/** Where a bill sits against the company's today. The server decides, once. */
export type PayableStatus = 'overdue' | 'due_today' | 'due_soon' | 'upcoming' | 'no_due_date'

export type AgeBucket = 'current' | '1_30' | '31_60' | '61_90' | '90_plus' | 'no_due_date'

/** One outstanding supplier bill, as Books described it and Billing aged it. */
export interface PayableBill {
  row_key: string
  account_id: number
  account_name: string
  bill_no: string | null
  /** The supplier's own reference — a PO number, usually. Never the bill number again. */
  reference: string | null
  document_no: string | null
  bill_date: string | null
  due_date: string | null
  balance: number
  /** What the bill was for, when Books states it. Null means no part payment can be claimed. */
  bill_amount: number | null
  paid_amount: number | null
  partially_paid: boolean
  days_overdue: number
  /** Days still to run. Null on an overdue or undated bill — never a negative. */
  days_to_due: number | null
  status: PayableStatus
  age_bucket: AgeBucket
  category: string | null
  voucher_id: number | null
  voucher_uuid: string | null
}

export interface PayablesSummary {
  total: number
  bill_count: number
  supplier_count: number
  overdue: number
  overdue_count: number
  due_today: number
  due_today_count: number
  due_this_week: number
  due_this_week_count: number
  due_soon_days: number
}

export interface AgeingBucketRow {
  key: AgeBucket
  label: string
  tone: 'ok' | 'warning' | 'danger' | 'neutral'
  amount: number
  count: number
  share: number
}

export interface PayablesUpcoming {
  days: number
  from: string
  to: string
  count: number
  amount: number
  rows: PayableBill[]
}

/**
 * What the money is owed for — or an honest statement that Books does not say.
 *
 * `available: false` is a real answer and the screen prints the reason. It is
 * never filled in by splitting the total by supplier and calling that a
 * category.
 */
export interface PayableCategories {
  available: boolean
  reason: string | null
  total: number
  rows: Array<{ key: string; label: string; amount: number; count: number; share: number }>
}

export interface PayablesPagination {
  page: number
  page_size: number
  total: number
  pages: number
  from: number
  to: number
}

/** Everything the Money to Pay screen draws, from one reading of Books. */
export interface PayablesWorkspace {
  title: string
  as_on: string
  source: string
  summary: PayablesSummary
  ageing_reconciles: boolean
  ageing_buckets: AgeingBucketRow[]
  parties: DueParty[]
  upcoming: PayablesUpcoming
  categories: PayableCategories
  calendar: Array<{ date: string; amount: number; count: number; overdue: boolean }>
  bills: PayableBill[]
  pagination: PayablesPagination
  filtered: { count: number; amount: number; is_filtered: boolean }
  /**
   * What this DEPLOYMENT can do, which the browser cannot know.
   *
   * What the USER may do is not here: that is in the session, and the screen
   * gates on `can()` like every other screen does.
   */
  import: { available: boolean; manual_path: string; reason: string | null }
  note: string
}

/** What was owed a month ago, so the headline card can show a real change. */
export interface PayablesComparison {
  available: boolean
  reason: string | null
  as_on: string
  label: string
  total: number | null
  basis?: string
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
