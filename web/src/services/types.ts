/**
 * Shapes the Billing API returns.
 *
 * There is no Invoice type here with an amount and a tax breakdown, and no
 * Receivable type with a balance — those belong to Smart Books and arrive from
 * Books-backed endpoints as the shapes Books gives them. What is typed here is
 * what Billing owns: a request, a profile, a rule.
 */

// The comparison shape is the server's `Metric::compare` output, already typed
// for the dashboards. Imported rather than restated: two declarations of one
// server shape drift, and this one decides whether a trend is drawn at all.
import type { MetricComparison } from '../dashboards/types'

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

// ---------------------------------------------------------------------------
// The original a credit or debit note is raised against
// ---------------------------------------------------------------------------

/**
 * One invoice (or supplier bill) as Books' register describes it.
 *
 * `outstanding` is the unpaid balance from Books' bill-by-bill report, matched
 * to this document on the same request. It is null when that report could not
 * be read — never zero, because "settled" and "we could not tell" are the two
 * facts this column exists to keep apart.
 */
export interface OriginalDocument {
  voucher_id: number | null
  voucher_uuid: string | null
  document_no: string | null
  date: string | null
  party: string | null
  party_id: number | null
  amount: number | null
  status: string | null
  outstanding?: number | null
}

export interface OriginalDocuments {
  party_account_id: number
  from: string
  to: string
  documents: OriginalDocument[]
  /** False when more documents exist in the range than one read could hold. */
  complete: boolean
  outstanding_available: boolean
  note: string
}

/**
 * A line that was billed on the original, as Books has it.
 *
 * The quantity DESCRIBES the invoice; it is not a permission to credit that
 * much. Books decides what may still be credited when the note is posted.
 */
export interface OriginalDocumentLine {
  line_ref: string
  item_id: number | null
  item_name: string | null
  sku: string | null
  hsn_sac: string | null
  unit_id: number | null
  unit_name: string | null
  warehouse_id: number | null
  batch_id: number | null
  batch_no: string | null
  qty: number | null
  rate: number | null
  discount_pc: number | null
  amount: number | null
  tax_cat_id: number | null
  tax_rate: number | null
  /** False for a service or described charge: creditable, but never stock. */
  stockable: boolean
}

export interface OriginalDocumentDetail extends OriginalDocument {
  available: boolean
  reason: string | null
  /** False when Books answered without lines this product could read. */
  lines_available: boolean
  lines: OriginalDocumentLine[]
  note: string
}

/** Credit notes raised this month against the window before it. */
export interface CreditNoteTrend {
  available: boolean
  reason: string | null
  label?: string
  from?: string
  to?: string
  count?: number
  value?: number | null
  previous_label?: string
  previous_count?: number | null
  series?: Array<{ label: string; count: number }>
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
  /**
   * Whatever Books calls the group this account sits in — "Bank Accounts",
   * "Cash-in-hand". Optional because the catalog relays Books' own response and
   * not every deployment spells it. Rendered only when present; never guessed
   * from the name, because "Cash Credit A/c" is a bank.
   */
  group_name?: string | null
  nature?: string | null
}

// ---------------------------------------------------------------------------
// The money screens' context
// ---------------------------------------------------------------------------

/**
 * One entry on the money screens' recent list.
 *
 * The first half — voucher, date, party, amount, status — is Books' register
 * row, read live. The second half is what Billing itself recorded when the user
 * pressed Save, and is null on an entry made in Books rather than here.
 * `recorded_here` says which is which so the table can explain an empty cell
 * instead of looking broken.
 */
export interface MoneyActivityRow {
  voucher_id: number | null
  voucher_uuid: string | null
  document_no: string | null
  date: string | null
  party: string | null
  party_id: number | null
  amount: number | null
  status: string | null
  request_id: number | null
  kind: string | null
  account_id: number | null
  account_name: string | null
  payment_mode: string | null
  reference_no: string | null
  narration: string | null
  created_by: string | null
  recorded_here: boolean
}

/**
 * What the period came to.
 *
 * Every figure is nullable and `available` may be false, because a register
 * page that cannot be proved complete must not be totalled. A null here is
 * rendered as "—", never as ₹0.
 */
export interface MoneySummary {
  available: boolean
  reason: string | null
  total: number | null
  count: number | null
  average: number | null
  largest: {
    amount: number | null
    party: string | null
    party_id: number | null
    date: string | null
    voucher_id: number | null
  } | null
  comparison: MetricComparison | null
}

export interface MoneyActivity {
  direction: 'in' | 'out'
  period: {
    key: string
    label: string
    from: string
    to: string
    previous_from: string
    previous_to: string
    previous_label: string
  }
  available: boolean
  reason: string | null
  summary: MoneySummary
  rows: MoneyActivityRow[]
  complete: boolean
  source: string
  note: string
}

/** When this party was last paid, or last paid us. Withheld when unprovable. */
export interface MoneyPartyContext {
  party_account_id: number
  direction: 'in' | 'out'
  looked_back_days: number
  from: string
  to: string
  available: boolean
  complete: boolean
  last: {
    date: string | null
    amount: number | null
    document_no: string | null
    voucher_id: number | null
    days_ago: number | null
  } | null
  entries_in_window: number | null
  source: string
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
