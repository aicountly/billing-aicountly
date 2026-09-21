/**
 * The shapes the five dashboard endpoints return.
 *
 * There is no Invoice or Receivable type here with an amount on it, for the
 * same reason there is none in services/types.ts: those belong to Smart Books.
 * What is typed below is a METRIC — a figure plus everything needed to read it
 * honestly — and the panels built out of them.
 */

export type MetricStatus = 'ready' | 'loading' | 'unavailable'

/**
 * Which kind of number this is.
 *
 * Rendered as a small label on every card, because "Sales this month" and
 * "To collect" are a movement and a balance, and side by side in the same
 * typeface they invite arithmetic that means nothing.
 */
export type MetricBasis = 'period' | 'as_of' | 'window' | 'count' | 'stated'

export interface MetricComparison {
  available: boolean
  label: string
  detail?: string
  percent?: number
  direction?: 'up' | 'down'
  /** Whether this direction is welcome. A rise in overdue debt is not. */
  tone?: 'positive' | 'warning'
  previous?: number
}

export interface Metric {
  id: string
  label: string
  value: number | null
  status: MetricStatus
  basis: MetricBasis
  definition: string
  comparison: MetricComparison | null
  tone: 'neutral' | 'positive' | 'warning' | 'danger'
  /** Present only when status is 'unavailable'. Never a zero in disguise. */
  reason?: string
  detail?: string
  /**
   * The one line under the figure, written by the server.
   *
   * It carries the time basis in words — "As at 19 Sep · ₹86,500.00 overdue",
   * "01 Sep–19 Sep · including tax, before credit notes" — so a compact card
   * needs neither a separate basis chip nor a three-line definition to be read
   * correctly. Where it is absent the card falls back to `detail`, then to the
   * full `definition`, and shows the basis as a chip; that is what the other
   * four dashboards do.
   */
  summary?: string
}

export interface PeriodDescription {
  key: string
  from: string
  to: string
  label: string
  previous_from: string
  previous_to: string
  previous_label: string
  timezone: string
  today: string
}

export interface DocumentRow {
  voucher_id: number | null
  voucher_uuid: string | null
  document_no: string | null
  date: string | null
  party: string | null
  party_id: number | null
  amount: number | null
  status: string | null
}

export interface SuggestedActionShape {
  id: string
  tone: 'info' | 'warning' | 'danger'
  title: string
  reason: string
  source: Record<string, unknown>
  action: { label: string; path: string }
}

export interface TrendSeries {
  label: string
  points: Record<string, number>
}

/**
 * One clause of the counted briefing, and the screen its records are on.
 *
 * Counted, not generated: `text` is arithmetic over the same reads the cards
 * came from. The generated summary is a different shape entirely, below.
 */
export interface BriefingPoint {
  id: string
  text: string
  tone: 'info' | 'warning' | 'danger'
  count: number | null
  path: string
}

export interface BriefingPanel {
  available: boolean
  headline: string
  points: BriefingPoint[]
  /** Only present when the server could draw a like-for-like comparison. */
  movement: { text: string; tone: 'positive' | 'warning'; path: string } | null
  basis: string
  generated_at: string
}

/**
 * The generated half, from its own endpoint.
 *
 * Asked for only when a person asks for it, so the dashboard neither waits on
 * a model nor pays for one nobody wanted. `available: false` carries the reason
 * and the rest of the screen is unaffected by it.
 */
export interface AssistantBriefing {
  available: boolean
  reason: string | null
  narrative: string | null
  sources: Array<{ label: string; path: string }>
  generated_at: string | null
}

export interface OverviewDashboard {
  period: PeriodDescription
  metrics: Metric[]
  panels: {
    trend: {
      available: boolean
      series: Record<string, TrendSeries>
      unavailable: string[]
      reason: string | null
      basis: string
    }
    actions: SuggestedActionShape[]
    briefing: BriefingPanel
    recent_documents: { available: boolean; reason: string | null; rows: DocumentRow[] } | null
  }
  generated_at: string
  source: string
}

export interface UnfinishedRequest {
  request_id: number
  request_uuid: string
  kind: string
  status: string
  date: string
  party_account_id: number | null
  entered_value: number | null
  line_count: number
  last_error: string | null
  updated_at: string
}

export interface DeskCheck {
  id: string
  tone: 'info' | 'warning' | 'danger'
  title: string
  detail: string
  action: { label: string; path: string }
}

export interface BillerDashboard {
  period: PeriodDescription
  metrics: Metric[]
  panels: {
    unfinished: UnfinishedRequest[]
    checks: DeskCheck[]
    recent: { available: boolean; reason: string | null; rows: DocumentRow[] }
    can_create: boolean
    can_return: boolean
    can_take_money: boolean
  }
  generated_at: string
}

export interface AgeingBucket {
  key: string
  label: string
  tone: 'ok' | 'warning' | 'danger' | 'neutral'
  amount: number
  share: number
}

export interface QueueRow {
  account_id: number
  account_name: string
  overdue: number
  total: number
  bill_count: number
  days_overdue: number
  oldest_bill_no: string | null
  oldest_bill_due: string | null
}

export interface PromiseRow {
  promise_id: number
  account_id: number
  account_name: string | null
  bill_no: string | null
  promised_date: string
  promised_amount: number
  status: 'TENTATIVE' | 'CONFIRMED'
  /** Decided by comparing the promise with what Books says is still owed. */
  standing: 'AWAITED' | 'PAST_DUE' | 'SETTLED'
  still_outstanding: number | null
  outstanding_known: boolean
  note: string | null
  created_at: string
}

export interface ReceivablesDashboard {
  period: PeriodDescription
  metrics: Metric[]
  panels: {
    ageing:
      | { available: true; buckets: AgeingBucket[]; total: number; reconciles: boolean; basis: string }
      | { available: false; reason: string; buckets: []; total: null }
    queue: QueueRow[]
    priorities: {
      count: number
      names: string[]
      amount: number
      share: number
      total_overdue: number
      accounts: Array<{ account_id: number; account_name: string; overdue: number }>
      basis: string
    } | null
    promises: { available: boolean; reason?: string; rows: PromiseRow[]; note?: string }
    can_record_receipt: boolean
    can_remind: boolean
    can_promise: boolean
    reminder_delivery: { configured: boolean; channels: string[]; reason: string | null }
  }
  note: string | null
  generated_at: string
}

export interface ReviewFlag {
  code: string
  tone: 'warning' | 'danger'
  label: string
  detail: string
  peers: number[]
}

export interface ReviewBill {
  row_key: string
  voucher_id: number | null
  voucher_uuid: string | null
  supplier: string | null
  supplier_id: number | null
  bill_no: string | null
  bill_date: string | null
  recorded_on: string | null
  amount: number | null
  document_no: string | null
  flags: ReviewFlag[]
  peer_bills: Array<{
    voucher_id: number | null
    document_no: string | null
    bill_no: string | null
    bill_date: string | null
    amount: number | null
  }>
}

export interface PayablesDashboard {
  period: PeriodDescription
  metrics: Metric[]
  panels: {
    upcoming:
      | {
          available: true
          days: Array<{
            date: string
            amount: number
            bills: Array<{ account_id: number; account_name: string; bill_no: string | null; balance: number }>
          }>
          basis: string
        }
      | { available: false; reason: string; days: [] }
    review: {
      available: boolean
      reason?: string | null
      rows: ReviewBill[]
      examined?: number
      complete?: boolean
      basis?: string
    }
    cash_impact: { available: boolean; amount?: number; basis?: string; reason?: string }
    upload: { available: boolean; can_add: boolean; manual_path: string; reason: string | null }
    can_record_payment: boolean
    can_add_purchase: boolean
    can_debit_note: boolean
  }
  note: string | null
  generated_at: string
}

export interface ChecklistStep {
  key: string
  label: string
  checked: boolean
  checked_by: string | null
  checked_at: string | null
  outstanding: number | null
  detail: string
}

export interface DocumentException {
  command_id: number
  document: string
  state: 'PENDING' | 'FAILED'
  attempts: number
  voucher_no: string | null
  voucher_id: number | null
  request_id: number
  date: string | null
  detail: string
  last_attempt_at: string | null
}

export interface ComplianceDashboard {
  period: PeriodDescription
  business_date: string
  metrics: Metric[]
  panels: {
    movement:
      | {
          available: true
          date: string
          granularity: 'hour' | 'day'
          buckets: Array<{ label: string; in: number; out: number }>
          in_total: number
          out_total: number
          transferred: { available: boolean; amount: number; count: number; note: string }
          basis: string
        }
      | { available: false; reason: string; buckets: [] }
    checklist: { date: string; steps: ChecklistStep[]; note: string }
    documents: {
      available: boolean
      reason?: string | null
      states?: Record<string, number>
      rows: DocumentException[]
      exception_count: number
      note?: string
    }
    matching: {
      available: boolean
      unmatched_count: number | null
      suggestions: unknown[]
      reason: string
      dependency?: { owner: string; needs: string; document: string }
    }
    accounts: Array<{ account_id: number; account_name: string; balance: number; kind: 'cash' | 'bank' }>
    can_move_money: boolean
    can_take_money: boolean
    can_pay: boolean
  }
  generated_at: string
}
