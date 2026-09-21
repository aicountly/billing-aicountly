/**
 * Fixtures for the visual harness. NOT shipped and NOT production data.
 *
 * These exist so the real dashboard components can be photographed at four
 * widths without inventing records in anybody's company. Nothing here is
 * written to a database and none of it is reachable from the built app: the
 * harness is a separate HTML entry point that `vite build` does not include.
 */

import type {
  BillerDashboard,
  ComplianceDashboard,
  OverviewDashboard,
  PayablesDashboard,
  ReceivablesDashboard,
} from '../src/dashboards/types'
import type { BillingSession } from '../src/services/types'

const PERIOD = {
  key: 'month',
  from: '2026-09-01',
  to: '2026-09-16',
  label: 'September 2026',
  previous_from: '2026-08-16',
  previous_to: '2026-08-31',
  previous_label: 'the previous 16 days',
  timezone: 'Asia/Kolkata',
  today: '2026-09-16',
}

export const ownerSession: BillingSession = {
  uuid: 'demo-owner',
  display_name: 'Rohit Gupta',
  display_name_known: true,
  is_owner: true,
  context: { cmp_id: 1, fy_id: 4, bo_id: 0 },
  permissions: [],
  settings: {
    cmp_id: 1,
    timezone: 'Asia/Kolkata',
    business_mode: 'trader',
    business_type: 'trading',
    gst_registered: true,
    maintains_stock: true,
    needs_purchase: true,
    needs_payables: true,
    needs_bank_cash: true,
    default_sale_terms: null,
    default_payment_terms: null,
    onboarding_done: true,
  },
  menu: [
    { key: 'dashboard', label: 'Dashboard', path: '/dashboard/overview', children: [] },
    {
      key: 'sales',
      label: 'Sales',
      path: '/sales',
      children: [
        { label: 'New bill', path: '/sales/new' },
        { label: 'Credit note', path: '/more/credit-note' },
      ],
    },
    {
      key: 'purchases',
      label: 'Purchases',
      path: '/purchases',
      children: [
        { label: 'New purchase', path: '/purchases/new' },
        { label: 'Debit note', path: '/more/debit-note' },
        { label: 'Expense', path: '/more/expense' },
      ],
    },
    { key: 'money', label: 'Money', path: '/money-in', children: [] },
    { key: 'receivables', label: 'Money to Collect', path: '/receivables', children: [] },
    { key: 'payables', label: 'Money to Pay', path: '/payables', children: [] },
    { key: 'parties', label: 'Parties', path: '/parties', children: [] },
    { key: 'items', label: 'Items', path: '/items', children: [] },
    { key: 'reports', label: 'Reports', path: '/reports', children: [] },
    { key: 'more', label: 'Settings', path: '/more', children: [] },
  ],
  dashboards: [
    { key: 'overview', label: 'Overview', path: '/dashboard/overview' },
    { key: 'biller', label: 'Biller Desk', path: '/dashboard/biller' },
    { key: 'receivables', label: 'Receivables', path: '/dashboard/receivables' },
    { key: 'payables', label: 'Payables', path: '/dashboard/payables' },
    { key: 'cash-compliance', label: 'Cash & Compliance', path: '/dashboard/cash-compliance' },
  ],
  landing: '/dashboard/overview',
}

/** A counter biller: one dashboard, no cost, no bank, no supplier dues. */
export const billerSession: BillingSession = {
  ...ownerSession,
  uuid: 'demo-biller',
  display_name: 'Priya Nair',
  is_owner: false,
  permissions: ['biller.desk', 'sale.view', 'sale.create', 'receipt.create', 'einvoice.generate'],
  menu: [
    { key: 'dashboard', label: 'Dashboard', path: '/dashboard/biller', children: [] },
    { key: 'sales', label: 'Sales', path: '/sales', children: [{ label: 'New bill', path: '/sales/new' }] },
    { key: 'money', label: 'Money', path: '/money-in', children: [] },
    { key: 'parties', label: 'Parties', path: '/parties', children: [] },
    { key: 'more', label: 'Settings', path: '/more', children: [] },
  ],
  dashboards: [{ key: 'biller', label: 'Biller Desk', path: '/dashboard/biller' }],
  landing: '/dashboard/biller',
}

function dailySeries(base: number, days: number, seed: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (let day = 1; day <= days; day++) {
    const wobble = Math.sin((day + seed) * 1.1) * 0.42 + Math.cos((day + seed) * 0.6) * 0.22
    out[`2026-09-${String(day).padStart(2, '0')}`] = Math.round(base * (1 + wobble))
  }
  return out
}

export const overview: OverviewDashboard = {
  period: PERIOD,
  metrics: [
    {
      id: 'sales',
      label: 'Sales this month',
      value: 842500,
      status: 'ready',
      basis: 'period',
      definition: 'Invoices dated 2026-09-01 to 2026-09-16, at their full value including tax.',
      comparison: { available: true, percent: 12, direction: 'up', label: '+12.0% vs the previous 16 days', tone: 'positive', previous: 752000 },
      tone: 'neutral',
    },
    {
      id: 'to_collect',
      label: 'To collect',
      value: 218000,
      status: 'ready',
      basis: 'as_of',
      definition: 'What customers still owe as at 2026-09-16, bill by bill, after every receipt allocated to date.',
      comparison: null,
      tone: 'warning',
      detail: '₹74,500.00 of it is overdue',
    },
    {
      id: 'to_pay',
      label: 'To pay',
      value: 136000,
      status: 'ready',
      basis: 'as_of',
      definition: 'What is still owed to suppliers as at 2026-09-16, bill by bill.',
      comparison: null,
      tone: 'warning',
      detail: '₹18,500.00 of it is overdue',
    },
    {
      id: 'cash_bank',
      label: 'Cash & bank',
      value: 324500,
      status: 'ready',
      basis: 'as_of',
      definition: "The closing balance of the cash and bank ledgers in Smart Books as at 2026-09-16.",
      comparison: null,
      tone: 'neutral',
      detail: '2 account(s)',
    },
  ],
  panels: {
    trend: {
      available: true,
      series: {
        sales: { label: 'Sales', points: dailySeries(58000, 16, 0) },
        collections: { label: 'Collections', points: dailySeries(41000, 16, 4) },
      },
      unavailable: [],
      reason: null,
      basis: 'Invoices and receipts by their document date, in Asia/Kolkata.',
    },
    actions: [
      {
        id: 'overdue_receivables',
        tone: 'danger',
        title: '3 customers overdue, ₹74,500.00 in total',
        reason: 'The oldest is 34 days past its due date.',
        source: { kind: 'receivable_bills', count: 3 },
        action: { label: 'Review', path: '/dashboard/receivables' },
      },
      {
        id: 'supplier_bills_due',
        tone: 'warning',
        title: '₹48,000.00 due to suppliers within seven days',
        reason: 'Across 2 supplier accounts.',
        source: { kind: 'payable_bills', count: 2 },
        action: { label: 'Review', path: '/dashboard/payables' },
      },
      {
        id: 'statutory_failed',
        tone: 'warning',
        title: '1 statutory document did not complete',
        reason: 'An e-Invoice or e-Way Bill was requested and has not come back generated.',
        source: { kind: 'billing_integration_commands', count: 1 },
        action: { label: 'Review', path: '/dashboard/cash-compliance' },
      },
    ],
    recent_documents: {
      available: true,
      reason: null,
      rows: [
        { voucher_id: 284, voucher_uuid: 'v-284', document_no: 'INV-0284', date: '2026-09-25', party: 'ABC Traders', party_id: 1, amount: 48000, status: 'PAID' },
        { voucher_id: 283, voucher_uuid: 'v-283', document_no: 'INV-0283', date: '2026-09-22', party: 'Kumar & Sons', party_id: 2, amount: 125000, status: 'UNPAID' },
        { voucher_id: 282, voucher_uuid: 'v-282', document_no: 'INV-0282', date: '2026-09-19', party: 'Wellcare Distributors', party_id: 3, amount: 76500, status: 'PAID' },
        { voucher_id: 281, voucher_uuid: 'v-281', document_no: 'INV-0281', date: '2026-09-16', party: 'Modern Retail', party_id: 4, amount: 52000, status: 'PARTIALLY_PAID' },
        { voucher_id: 280, voucher_uuid: 'v-280', document_no: 'INV-0280', date: '2026-09-12', party: 'Gupta Stationery', party_id: 5, amount: 21000, status: null },
      ],
    },
  },
  generated_at: '2026-09-16T09:12:00Z',
  source: 'Read from Smart Books as this page loaded. Billing stores none of these figures.',
}

export const biller: BillerDashboard = {
  period: { ...PERIOD, key: 'today', from: '2026-09-16', to: '2026-09-16', label: 'Today' },
  metrics: [
    { id: 'my_invoices_today', label: 'My bills today', value: 24, status: 'ready', basis: 'count', definition: 'Bills you raised through Billing today that Smart Books accepted.', comparison: null, tone: 'neutral' },
    { id: 'my_billed_value', label: 'My billed value today', value: 68400, status: 'ready', basis: 'period', definition: 'The value Smart Books gave your own bills dated 2026-09-16, including tax.', comparison: null, tone: 'neutral' },
    { id: 'my_drafts', label: 'Bills to finish', value: 3, status: 'ready', basis: 'count', definition: 'Bills you started here that Smart Books has not accepted yet.', comparison: null, tone: 'warning' },
    { id: 'my_document_checks', label: 'Checks to clear', value: 2, status: 'ready', basis: 'count', definition: 'Things Billing can tell are missing on your own unfinished bills.', comparison: null, tone: 'warning' },
  ],
  panels: {
    unfinished: [
      { request_id: 1032, request_uuid: 'r-1032', kind: 'sale', status: 'FAILED', date: '2026-09-16', party_account_id: 11, entered_value: 12480, line_count: 4, last_error: 'Smart Books refused: place of supply is missing on the customer.', updated_at: '2026-09-16T07:40:00Z' },
      { request_id: 1031, request_uuid: 'r-1031', kind: 'sale', status: 'PENDING', date: '2026-09-15', party_account_id: 12, entered_value: 5760, line_count: 2, last_error: null, updated_at: '2026-09-15T16:02:00Z' },
      { request_id: 1028, request_uuid: 'r-1028', kind: 'sale', status: 'PENDING', date: '2026-09-14', party_account_id: 13, entered_value: 18900, line_count: 7, last_error: null, updated_at: '2026-09-14T11:20:00Z' },
    ],
    checks: [
      { id: 'no_party_1029', tone: 'danger', title: 'A bill has no customer on it', detail: 'Started 2026-09-16. It cannot be issued until a customer is chosen.', action: { label: 'Open', path: '/more/unfinished' } },
      { id: 'statutory_88', tone: 'warning', title: 'e-Invoice did not generate', detail: 'The IRP rejected it: the buyer GSTIN is not active.', action: { label: 'Open bill', path: '/sales/1030' } },
    ],
    recent: {
      available: true,
      reason: null,
      rows: [
        { voucher_id: 1068, voucher_uuid: 'v-1068', document_no: 'INV-1068', date: '2026-09-16', party: 'Shree Traders', party_id: 11, amount: 12480, status: 'PAID' },
        { voucher_id: 1067, voucher_uuid: 'v-1067', document_no: 'INV-1067', date: '2026-09-16', party: 'Kumar Stationery', party_id: 12, amount: 5760, status: 'PARTIALLY_PAID' },
        { voucher_id: 1066, voucher_uuid: 'v-1066', document_no: 'INV-1066', date: '2026-09-15', party: 'Mehta General Stores', party_id: 14, amount: 8320, status: 'UNPAID' },
        { voucher_id: 1065, voucher_uuid: 'v-1065', document_no: 'INV-1065', date: '2026-09-15', party: 'Patel & Co.', party_id: 13, amount: 18900, status: 'PAID' },
        { voucher_id: 1064, voucher_uuid: 'v-1064', document_no: 'INV-1064', date: '2026-09-14', party: 'Gupta Electronics', party_id: 15, amount: 4250, status: 'UNPAID' },
      ],
    },
    can_create: true,
    can_return: false,
    can_take_money: true,
  },
  generated_at: '2026-09-16T09:12:00Z',
}

export const receivables: ReceivablesDashboard = {
  period: PERIOD,
  metrics: [
    { id: 'outstanding', label: 'Outstanding', value: 218000, status: 'ready', basis: 'as_of', definition: 'What customers still owe as at 2026-09-16, after every receipt allocated to date.', comparison: null, tone: 'neutral', detail: '12 bill(s) across 8 customer(s)' },
    { id: 'overdue', label: 'Overdue', value: 74500, status: 'ready', basis: 'as_of', definition: 'The part of the outstanding whose due date has already passed.', comparison: null, tone: 'danger' },
    { id: 'due_soon', label: 'Due in seven days', value: 52000, status: 'ready', basis: 'window', definition: 'Bills falling due from 2026-09-16 up to and including 2026-09-23.', comparison: null, tone: 'neutral' },
    { id: 'collected', label: 'Collected this month', value: 624500, status: 'ready', basis: 'period', definition: 'Receipts dated 2026-09-01 to 2026-09-16. Money in during the period — it is not revenue.', comparison: { available: true, percent: 12, direction: 'up', label: '+12.0% vs the previous 16 days', tone: 'positive', previous: 557000 }, tone: 'positive' },
  ],
  panels: {
    ageing: {
      available: true,
      total: 218000,
      reconciles: true,
      basis: "Aged by each bill's due date against 2026-09-16, on the balance still unpaid.",
      buckets: [
        { key: 'current', label: 'Not yet due', tone: 'ok', amount: 143500, share: 65.8 },
        { key: '1_30', label: '1–30 days overdue', tone: 'warning', amount: 46000, share: 21.1 },
        { key: '31_60', label: '31–60 days overdue', tone: 'warning', amount: 18500, share: 8.5 },
        { key: '61_90', label: '61–90 days overdue', tone: 'danger', amount: 6200, share: 2.8 },
        { key: '90_plus', label: 'Over 90 days overdue', tone: 'danger', amount: 3800, share: 1.7 },
      ],
    },
    queue: [
      { account_id: 21, account_name: 'Verma Services', overdue: 24000, total: 31000, bill_count: 3, days_overdue: 34, oldest_bill_no: 'INV-0215', oldest_bill_due: '2026-08-13' },
      { account_id: 22, account_name: 'Mehta Traders', overdue: 28500, total: 28500, bill_count: 1, days_overdue: 18, oldest_bill_no: 'INV-0241', oldest_bill_due: '2026-08-29' },
      { account_id: 23, account_name: 'Kapoor Stores', overdue: 22000, total: 26400, bill_count: 2, days_overdue: 27, oldest_bill_no: 'INV-0198', oldest_bill_due: '2026-08-20' },
    ],
    priorities: {
      count: 3,
      names: ['Mehta Traders', 'Verma Services', 'Kapoor Stores'],
      amount: 74500,
      share: 100,
      total_overdue: 74500,
      accounts: [
        { account_id: 22, account_name: 'Mehta Traders', overdue: 28500 },
        { account_id: 21, account_name: 'Verma Services', overdue: 24000 },
        { account_id: 23, account_name: 'Kapoor Stores', overdue: 22000 },
      ],
      basis: 'Counted from the bill-by-bill outstanding Smart Books returned for this page. Not a prediction — add the three figures up and they make the amount shown.',
    },
    promises: {
      available: true,
      note: 'What a customer said they would pay. Shown next to what Smart Books says is still outstanding, never instead of it — a promise is not a receipt.',
      rows: [
        { promise_id: 1, account_id: 21, account_name: 'Verma Services', bill_no: 'INV-0215', promised_date: '2026-09-10', promised_amount: 24000, status: 'CONFIRMED', standing: 'PAST_DUE', still_outstanding: 24000, outstanding_known: true, note: null, created_at: '2026-09-02T10:00:00Z' },
        { promise_id: 2, account_id: 22, account_name: 'Mehta Traders', bill_no: 'INV-0241', promised_date: '2026-09-15', promised_amount: 28500, status: 'CONFIRMED', standing: 'PAST_DUE', still_outstanding: 28500, outstanding_known: true, note: 'Said the cheque was posted.', created_at: '2026-09-05T10:00:00Z' },
        { promise_id: 3, account_id: 23, account_name: 'Kapoor Stores', bill_no: null, promised_date: '2026-09-20', promised_amount: 22000, status: 'TENTATIVE', standing: 'AWAITED', still_outstanding: 26400, outstanding_known: true, note: null, created_at: '2026-09-09T10:00:00Z' },
        { promise_id: 4, account_id: 24, account_name: 'Agarwal Agencies', bill_no: null, promised_date: '2026-09-25', promised_amount: 18000, status: 'TENTATIVE', standing: 'SETTLED', still_outstanding: 0, outstanding_known: true, note: null, created_at: '2026-09-11T10:00:00Z' },
      ],
    },
    can_record_receipt: true,
    can_remind: true,
    can_promise: true,
    reminder_delivery: {
      configured: false,
      channels: [],
      reason: 'No message delivery service is configured for this deployment, so a reminder cannot be sent from here yet. You can still review the drafted message and copy it.',
    },
  },
  note: 'Read from Smart Books just now. Billing keeps no balance of its own, so this never disagrees with the accounts.',
  generated_at: '2026-09-16T09:12:00Z',
}

export const payables: PayablesDashboard = {
  period: PERIOD,
  metrics: [
    { id: 'to_pay', label: 'To pay', value: 136000, status: 'ready', basis: 'as_of', definition: 'What is still owed to suppliers as at 2026-09-16.', comparison: null, tone: 'neutral', detail: '9 bill(s) across 5 supplier(s)' },
    { id: 'due_soon', label: 'Due in seven days', value: 48000, status: 'ready', basis: 'window', definition: 'Supplier bills falling due from 2026-09-16 up to and including 2026-09-23.', comparison: null, tone: 'neutral' },
    { id: 'overdue', label: 'Overdue', value: 18500, status: 'ready', basis: 'as_of', definition: 'The part of what you owe that is already past its due date.', comparison: null, tone: 'danger' },
    { id: 'to_review', label: 'Bills needing a look', value: 3, status: 'ready', basis: 'count', definition: 'Purchase bills recorded in the last 45 days where Billing found something odd.', comparison: null, tone: 'warning' },
  ],
  panels: {
    upcoming: {
      available: true,
      basis: 'Bills due from 2026-09-16 to 2026-09-23, at the balance still unpaid.',
      days: [
        { date: '2026-09-16', amount: 12000, bills: [{ account_id: 31, account_name: 'Gupta Traders', bill_no: 'GT-4410', balance: 12000 }] },
        { date: '2026-09-18', amount: 18000, bills: [{ account_id: 32, account_name: 'Shree Balaji Electronics', bill_no: 'SBE-5561', balance: 18000 }] },
        { date: '2026-09-20', amount: 18000, bills: [{ account_id: 33, account_name: 'National Hardware Co.', bill_no: 'NH-2210', balance: 18000 }] },
      ],
    },
    review: {
      available: true,
      reason: null,
      examined: 24,
      complete: true,
      basis: 'Purchase bills recorded between 2026-08-02 and 2026-09-16, read from Smart Books just now.',
      rows: [
        {
          row_key: 'bill-0', voucher_id: 4501, voucher_uuid: 'p-1', supplier: 'Mahalaxmi Distributors', supplier_id: 601,
          bill_no: 'MD-7812', bill_date: '2026-09-09', recorded_on: '2026-09-10', amount: 24000, document_no: 'PUR/0001',
          flags: [{ code: 'duplicate_number', tone: 'warning', label: 'Possible duplicate', detail: 'Another bill from this supplier carries the same bill number.', peers: [1] }],
          peer_bills: [{ voucher_id: 4502, document_no: 'PUR/0002', bill_no: 'MD/7812', bill_date: '2026-09-09', amount: 23800 }],
        },
        {
          row_key: 'bill-1', voucher_id: 4503, voucher_uuid: 'p-3', supplier: 'R.K. Industries', supplier_id: 602,
          bill_no: 'RKI-4490', bill_date: null, recorded_on: '2026-09-12', amount: 32500, document_no: 'PUR/0003',
          flags: [{ code: 'missing_bill_date', tone: 'warning', label: 'Missing bill date', detail: "The supplier's own invoice date is not recorded.", peers: [] }],
          peer_bills: [],
        },
        {
          row_key: 'bill-2', voucher_id: 4505, voucher_uuid: 'p-5', supplier: 'Shree Stationers', supplier_id: 603,
          bill_no: null, bill_date: '2026-09-12', recorded_on: '2026-09-13', amount: 11800, document_no: 'PUR/0005',
          flags: [{ code: 'missing_bill_no', tone: 'warning', label: 'Missing bill number', detail: "The supplier's own invoice number is not recorded.", peers: [] }],
          peer_bills: [],
        },
      ],
    },
    cash_impact: { available: true, amount: 48000, basis: 'Supplier bills falling due between 2026-09-16 and 2026-09-23. What you plan to pay, not what has been paid.' },
    upload: {
      available: false,
      can_add: true,
      manual_path: '/purchases/new',
      reason: 'Reading a bill from a PDF or photo needs a document-extraction service, and none is configured for this deployment. Entering the bill by hand records exactly the same thing.',
    },
    can_record_payment: true,
    can_add_purchase: true,
    can_debit_note: true,
  },
  note: 'Read from Smart Books just now.',
  generated_at: '2026-09-16T09:12:00Z',
}

export const compliance: ComplianceDashboard = {
  period: { ...PERIOD, key: 'today', from: '2026-09-16', to: '2026-09-16', label: 'Today' },
  business_date: '2026-09-16',
  metrics: [
    { id: 'cash', label: 'Cash', value: 42500, status: 'ready', basis: 'as_of', definition: 'The closing balance of the cash ledgers in Smart Books as at 2026-09-16.', comparison: null, tone: 'neutral' },
    { id: 'bank', label: 'Bank', value: 282000, status: 'ready', basis: 'as_of', definition: 'The closing balance of the bank ledgers in Smart Books as at 2026-09-16.', comparison: null, tone: 'neutral' },
    { id: 'unmatched', label: 'Unmatched bank entries', value: null, status: 'unavailable', basis: 'count', definition: 'Lines on the bank statement that have not been matched to an entry in the accounts.', comparison: null, tone: 'neutral', reason: 'Matching needs a bank statement, and no bank feed is configured for this deployment.' },
    { id: 'document_exceptions', label: 'Document exceptions', value: 3, status: 'ready', basis: 'count', definition: 'e-Invoice and e-Way Bill requests raised from Billing that have not come back generated.', comparison: null, tone: 'warning' },
  ],
  panels: {
    movement: {
      available: true,
      date: '2026-09-16',
      granularity: 'hour',
      buckets: [
        { label: '09:00', in: 86000, out: 42000 },
        { label: '11:00', in: 14000, out: 9000 },
        { label: '13:00', in: 58000, out: 41000 },
        { label: '15:00', in: 31000, out: 18000 },
        { label: '17:00', in: 72000, out: 44000 },
        { label: '19:00', in: 16000, out: 11000 },
      ],
      in_total: 277000,
      out_total: 165000,
      transferred: { available: true, amount: 40000, count: 1, note: 'Moved between your own cash and bank accounts. Counted here and in neither the money-in nor the money-out figure, because it is neither.' },
      basis: 'Receipts as money in and payments as money out, dated 2026-09-16. Transfers between your own accounts are excluded from both.',
    },
    checklist: {
      date: '2026-09-16',
      note: 'Ticking these records that you looked. It closes no period and posts no entry — Smart Books owns the accounting period, and Billing does not lock it.',
      steps: [
        { key: 'receipts_reviewed', label: 'Receipts reviewed', checked: true, checked_by: 'Rohit Gupta', checked_at: '2026-09-16T12:10:00Z', outstanding: null, detail: 'Marked as looked at.' },
        { key: 'payments_reviewed', label: 'Payments reviewed', checked: true, checked_by: 'Rohit Gupta', checked_at: '2026-09-16T12:11:00Z', outstanding: null, detail: 'Marked as looked at.' },
        { key: 'bank_entries_matched', label: 'Bank entries matched', checked: false, checked_by: null, checked_at: null, outstanding: null, detail: 'Matching needs a bank statement, and no bank feed is configured for this deployment.' },
        { key: 'documents_reviewed', label: 'Document exceptions reviewed', checked: false, checked_by: null, checked_at: null, outstanding: 3, detail: '3 still need attention.' },
      ],
    },
    documents: {
      available: true,
      reason: null,
      states: { GENERATED: 41, PENDING: 1, FAILED: 2 },
      exception_count: 3,
      note: 'These are the e-Invoice and e-Way Bill requests raised from Billing. A sale that never needed one is not listed and is not an exception.',
      rows: [
        { command_id: 91, document: 'e-Invoice', state: 'FAILED', attempts: 2, voucher_no: 'INV-0267', voucher_id: 267, request_id: 1010, date: '2026-09-15', detail: 'The IRP rejected it: the buyer GSTIN is not active.', last_attempt_at: '2026-09-15T18:00:00Z' },
        { command_id: 92, document: 'e-Way Bill', state: 'PENDING', attempts: 1, voucher_no: 'INV-0271', voucher_id: 271, request_id: 1014, date: '2026-09-16', detail: 'Smart Books has not confirmed it yet. Check its status before asking again.', last_attempt_at: '2026-09-16T08:30:00Z' },
        { command_id: 93, document: 'e-Invoice', state: 'FAILED', attempts: 3, voucher_no: 'INV-0272', voucher_id: 272, request_id: 1015, date: '2026-09-16', detail: 'The IRP did not answer within the time allowed.', last_attempt_at: '2026-09-16T08:45:00Z' },
      ],
    },
    matching: {
      available: false,
      unmatched_count: null,
      suggestions: [],
      reason: 'Matching needs a bank statement, and no bank feed or statement import is configured for this deployment. Smart Books owns bank reconciliation; Billing would read it, not perform it.',
      dependency: { owner: 'Smart Books', needs: 'A bank-reconciliation read API.', document: 'docs/BILLING_API_DEPENDENCIES.md' },
    },
    accounts: [
      { account_id: 101, account_name: 'Cash in hand', balance: 42500, kind: 'cash' },
      { account_id: 102, account_name: 'HDFC Bank · 4471', balance: 282000, kind: 'bank' },
    ],
    can_move_money: true,
    can_take_money: true,
    can_pay: true,
  },
  generated_at: '2026-09-16T09:12:00Z',
}

// ---------------------------------------------------------------------------
// Money paid / money received
// ---------------------------------------------------------------------------

export const openBills = {
  account_id: 601,
  source: 'books',
  bills: [
    { bill_no: 'AP-9021', bill_date: '2026-08-12', due_date: '2026-09-11', balance: 11800, voucher_id: 4504, voucher_uuid: 'vch-p4' },
    { bill_no: 'AP-9044', bill_date: '2026-08-28', due_date: '2026-09-27', balance: 26500, voucher_id: 4508, voucher_uuid: 'vch-p8' },
    { bill_no: 'AP-9070', bill_date: '2026-09-09', due_date: '2026-10-09', balance: 9400, voucher_id: 4512, voucher_uuid: 'vch-p12' },
  ],
}

export const moneyPartyContext = {
  party_account_id: 601,
  direction: 'out',
  looked_back_days: 180,
  from: '2026-03-23',
  to: '2026-09-19',
  available: true,
  complete: true,
  entries_in_window: 6,
  last: { date: '2026-08-22', amount: 18000, document_no: 'PAY/0044', voucher_id: 4290, days_ago: 28 },
  source: 'books',
}

export const moneyRecent = {
  direction: 'out',
  period: {
    key: 'month',
    label: 'September 2026',
    from: '2026-09-01',
    to: '2026-09-19',
    previous_from: '2026-08-13',
    previous_to: '2026-08-31',
    previous_label: 'the previous 19 days',
  },
  available: true,
  reason: null,
  complete: true,
  source: 'books',
  note: 'Read from Smart Books as this screen opened. Billing keeps no copy.',
  summary: {
    available: true,
    reason: null,
    total: 124500,
    count: 8,
    average: 15562.5,
    largest: { amount: 48000, party: 'Mahalaxmi Distributors', party_id: 602, date: '2026-09-12', voucher_id: 4305 },
    comparison: {
      available: true,
      percent: 12.4,
      direction: 'up',
      label: '+12.4% vs the previous 19 days',
      tone: 'warning',
      previous: 110800,
    },
  },
  rows: [
    {
      voucher_id: 4310, voucher_uuid: 'vch-p10', document_no: 'PAY/0051', date: '2026-09-19',
      party: 'Office Rent', party_id: 701, amount: 50000, status: null,
      request_id: 221, kind: 'expense', account_id: 102, account_name: 'HDFC Bank · 4471',
      payment_mode: 'bank_transfer', reference_no: 'UTR123456789', narration: 'September rent',
      created_by: 'demo-owner', recorded_here: true,
    },
    {
      voucher_id: 4309, voucher_uuid: 'vch-p9', document_no: 'PAY/0050', date: '2026-09-18',
      party: 'Shree Stationers', party_id: 601, amount: 25000, status: null,
      request_id: 219, kind: 'payment', account_id: 102, account_name: 'HDFC Bank · 4471',
      payment_mode: 'upi', reference_no: '8901234567', narration: 'Material payment against AP-9021 and part of AP-9044',
      created_by: 'someone-else', recorded_here: true,
    },
    {
      voucher_id: 4308, voucher_uuid: 'vch-p8', document_no: 'PAY/0049', date: '2026-09-17',
      party: 'Electricity Board', party_id: 702, amount: 12450, status: null,
      request_id: null, kind: null, account_id: null, account_name: null,
      payment_mode: null, reference_no: null, narration: null,
      created_by: null, recorded_here: false,
    },
    {
      voucher_id: 4307, voucher_uuid: 'vch-p7', document_no: 'PAY/0048', date: '2026-09-15',
      party: 'R.K. Industries', party_id: 603, amount: 18000, status: null,
      request_id: 214, kind: 'payment', account_id: 103, account_name: 'ICICI Current · 9082',
      payment_mode: 'cheque', reference_no: '245678', narration: 'Against bill no. 456',
      created_by: 'demo-owner', recorded_here: true,
    },
    {
      voucher_id: 4305, voucher_uuid: 'vch-p5', document_no: 'PAY/0047', date: '2026-09-12',
      party: 'Mahalaxmi Distributors', party_id: 602, amount: 48000, status: null,
      request_id: 208, kind: 'payment', account_id: 101, account_name: 'Cash in hand',
      payment_mode: 'cash', reference_no: null, narration: null,
      created_by: 'demo-owner', recorded_here: true,
    },
  ],
}

/** What the API answers when the harness "saves" an entry. */
export const savedPayment = {
  request_id: 999,
  request_uuid: 'demo-request',
  kind: 'payment',
  status: 'POSTED',
  party_account_id: 601,
  transaction_date: '2026-09-19',
  payload: {},
  books_voucher_id: 4399,
  books_voucher_uuid: 'vch-p99',
  books_voucher_no: 'PAY/0052',
  last_error: null,
  created_at: '2026-09-19T10:00:00Z',
}

// ---------------------------------------------------------------------------
// Purchases → Expense
// ---------------------------------------------------------------------------

/** Expense heads, as Books' account list returns them. */
export const expenseAccounts = [
  { acc_id: 810, acc_name: 'Office Supplies' },
  { acc_id: 811, acc_name: 'Travel & Conveyance' },
  { acc_id: 812, acc_name: 'Rent' },
  { acc_id: 813, acc_name: 'Electricity & Utilities' },
  { acc_id: 814, acc_name: 'Professional Fees' },
  { acc_id: 815, acc_name: 'Marketing & Advertising' },
  { acc_id: 816, acc_name: 'Repairs & Maintenance' },
  { acc_id: 817, acc_name: 'Printing & Stationery' },
  { acc_id: 818, acc_name: 'Staff Welfare' },
  { acc_id: 819, acc_name: 'Other Expenses' },
]

// One list for both money screens and the expense screen: the harness matches
// RESPONSES in order, so a second entry for v1/catalog/cash-bank would never
// be reached. `group_name` is what the money screens show under "Paid from".
export const cashBankAccounts = [
  { acc_id: 101, acc_name: 'Cash in hand', group_name: 'Cash-in-hand' },
  { acc_id: 102, acc_name: 'HDFC Bank · 4471', group_name: 'Bank Accounts' },
  { acc_id: 103, acc_name: 'ICICI Current · 9082', group_name: 'Bank Accounts' },
]

export const taxCategories = [
  // The rate is what Books returns alongside the name. The bill screen reads it
  // to draw its GST estimate and leaves the estimate out when it is absent, so
  // both halves of that are reachable in the booth.
  { tax_cat_id: 1, tax_cat_name: 'GST 18%', tax_rate: 18 },
  { tax_cat_id: 2, tax_cat_name: 'GST 12%', tax_rate: 12 },
  { tax_cat_id: 3, tax_cat_name: 'GST 5%', tax_rate: 5 },
  { tax_cat_id: 4, tax_cat_name: 'Exempt', tax_rate: 0 },
]

/** Customers, as Books' account list describes them. 27 = Maharashtra, 03 = Punjab. */
/** Items, as Inventory describes them. */
export const saleItems = [
  {
    item_id: 301,
    item_name: 'Premium Copier Paper A4 · 75 GSM',
    item_sku: 'PW-001',
    unit_id: 1,
    unit_name: 'Ream',
    hsn_sac: '4802',
    barcode: '8901234567890',
    mrp: '320',
    sale_rate: 285,
    tax_cat_id: 1,
  },
  {
    item_id: 302,
    item_name: 'Gel Pen · Blue (Box of 20)',
    item_sku: 'PEN-BL-20',
    unit_id: 2,
    unit_name: 'Box',
    hsn_sac: '9608',
    barcode: '8901234567906',
    mrp: '240',
    sale_rate: 210,
    tax_cat_id: 1,
  },
  {
    item_id: 303,
    item_name: 'Heavy Duty Stapler',
    item_sku: 'STP-01',
    unit_id: 3,
    unit_name: 'Nos',
    hsn_sac: '8472',
    barcode: '8901234567913',
    mrp: '520',
    sale_rate: 450,
    tax_cat_id: 2,
  },
  {
    item_id: 304,
    item_name: 'Annual Maintenance — Printers',
    item_sku: 'AMC-PRN',
    unit_id: 3,
    unit_name: 'Nos',
    hsn_sac: '998719',
    mrp: '12000',
    sale_rate: 12000,
    tax_cat_id: 1,
  },
]

/** What Inventory says is on the shelf, by item id. */
export const availability: Record<number, { item_id: number; available_qty: number }> = {
  301: { item_id: 301, available_qty: 42 },
  302: { item_id: 302, available_qty: 4 },
  303: { item_id: 303, available_qty: 0 },
  304: { item_id: 304, available_qty: 0 },
}

/** What `POST v1/transactions/sale` hands back. */
export const savedSale = {
  request_id: 4410,
  request_uuid: '8b1f2c60-1f7f-4d3d-9f1b-2f9a3d1c77aa',
  kind: 'sale',
  status: 'POSTED',
  party_account_id: 501,
  transaction_date: '2026-09-21',
  payload: {},
  books_voucher_id: 55231,
  books_voucher_uuid: '0a2a9a1e-77aa-4f11-9d20-3c1b8a7d4410',
  books_voucher_no: 'AIC-1025',
  last_error: null,
  created_at: '2026-09-21T09:15:00Z',
}

export const expenseCapabilities = {
  bill_storage: {
    available: false,
    reason: 'No document service here, so the file itself cannot be kept — record where the bill is.',
    accepts: ['application/pdf', 'image/jpeg', 'image/png'],
    max_bytes: 10485760,
  },
  bill_extraction: {
    available: false,
    reason:
      'Needs a document-extraction service, and none is configured for this deployment. Typing the details records exactly the same expense.',
  },
}

export const recentExpenses = {
  rows: [
    {
      request_id: 9104, date: '2026-09-15', amount: 2450, note: 'Office stationery', reference_no: 'INV-2291',
      category_id: 810, category_name: 'Office Supplies', paid_from_id: 101, paid_from_name: 'Cash in hand',
      party_account_id: null, voucher_id: 55201, voucher_no: 'PAY/0091',
    },
    {
      request_id: 9103, date: '2026-09-14', amount: 1320, note: 'Client meeting — cab', reference_no: null,
      category_id: 811, category_name: 'Travel & Conveyance', paid_from_id: 101, paid_from_name: 'Cash in hand',
      party_account_id: null, voucher_id: 55188, voucher_no: 'PAY/0090',
    },
    {
      request_id: 9102, date: '2026-09-12', amount: 999, note: 'Internet bill', reference_no: 'ACT-88213',
      category_id: 813, category_name: 'Electricity & Utilities', paid_from_id: 102, paid_from_name: 'HDFC Bank · 4471',
      party_account_id: 604, voucher_id: 55140, voucher_no: 'PAY/0088',
    },
    {
      request_id: 9101, date: '2026-09-10', amount: 4000, note: 'Accounting software subscription', reference_no: 'SUB-5512',
      category_id: 814, category_name: 'Professional Fees', paid_from_id: 102, paid_from_name: 'HDFC Bank · 4471',
      party_account_id: 605, voucher_id: 55102, voucher_no: 'PAY/0085',
    },
  ],
  names_available: true,
  basis:
    "Expenses recorded from Billing in this company and year. Expenses entered directly in Smart Books are in Books' own register.",
}

export const suppliers = [
  { acc_id: 601, acc_name: 'Shree Stationers', gstin: '29ABCDE1234F1Z5' },
  { acc_id: 602, acc_name: 'Mahalaxmi Distributors', gstin: null },
  { acc_id: 603, acc_name: 'R.K. Industries', gstin: '29AAECR9876M1Z4' },
  { acc_id: 604, acc_name: 'Airtel Broadband', gstin: '29AAACB2894G1ZX' },
  { acc_id: 605, acc_name: 'Nandi & Associates', gstin: null },
]

/** What the API returns when the harness "saves" an expense. */
export const savedExpense = {
  request_id: 9105,
  request_uuid: '8f2c1a10-0000-4000-8000-000000009105',
  kind: 'expense',
  status: 'POSTED',
  party_account_id: null,
  transaction_date: '2026-09-19',
  payload: {},
  books_voucher_id: 55260,
  books_voucher_uuid: 'v-55260',
  books_voucher_no: 'PAY/0092',
  last_error: null,
  created_at: '2026-09-19T06:10:00Z',
}

// ---------------------------------------------------------------------------
// The Items workspace
// ---------------------------------------------------------------------------

/**
 * A catalogue with every shape the screen has to survive in it.
 *
 * Deliberately awkward: an item with no SKU, one with a name longer than the
 * column, an amount in lakhs, a service with no stock, an item running low,
 * one out of stock, one withdrawn, and one Inventory said nothing useful about
 * at all. Photographing a screen where every row is tidy proves nothing.
 */
export const catalogItems = [
  row(1, 'Ballpoint Pens', {
    description: 'Smooth writing | Blue',
    sku: 'PEN-001',
    hsn: '960810',
    type: 'stock',
    group: [3, 'Stationery'],
    rate: 12,
    stock: [1250, 100],
  }),
  row(2, 'A4 Notebook', {
    description: '200 Pages | Single Line',
    sku: 'NB-002',
    hsn: '482020',
    type: 'stock',
    group: [3, 'Stationery'],
    rate: 45,
    stock: [320, 60],
  }),
  row(3, 'Laptop — Dell Inspiron 15 3520 with 16GB RAM and 512GB NVMe storage', {
    description: '15.6" | 16GB | 512GB SSD',
    sku: 'LAP-001',
    hsn: '847130',
    type: 'stock',
    group: [4, 'Computers'],
    rate: 52000,
    stock: [15, 5],
  }),
  row(4, 'Installation Service', {
    description: 'On-site installation',
    sku: 'SERV-001',
    hsn: '998719',
    type: 'service',
    group: [7, 'Services'],
    rate: 1500,
  }),
  row(5, 'Office Chair', {
    description: 'Ergonomic | Adjustable',
    sku: 'CHR-001',
    hsn: '940130',
    type: 'stock',
    group: [5, 'Furniture'],
    rate: 3800,
    stock: [8, 10],
  }),
  row(6, 'Annual AMC', {
    description: 'Comprehensive support',
    sku: 'AMC-001',
    hsn: '998719',
    type: 'service',
    group: [7, 'Services'],
    rate: 5000,
  }),
  row(7, 'Whiteboard Marker', {
    description: null,
    sku: null,
    hsn: '960910',
    type: 'stock',
    group: [3, 'Stationery'],
    rate: 25,
    stock: [0, 24],
  }),
  row(8, 'Industrial Air Compressor', {
    description: '7.5 HP | Two stage',
    sku: 'ACP-220',
    hsn: '841430',
    type: 'stock',
    group: [6, 'Machinery'],
    rate: 248500,
    stock: [2, 1],
  }),
  row(9, 'Legacy Fax Rolls', {
    description: 'Withdrawn from sale',
    sku: 'FAX-010',
    hsn: '481140',
    type: 'stock',
    group: [3, 'Stationery'],
    rate: 90,
    stock: [40, 10],
    active: false,
  }),
  // Inventory answered, but said nothing about what this is or how many there
  // are. The row still has to draw — as "—" and "Unavailable", never as 0.
  row(10, 'Imported Gift Set', { description: null, sku: 'GFT-001', hsn: null, type: null, group: null, rate: null }),

  // The three the credit note screen resolves by search and by scan. THE IDS
  // MATTER: originalDocument's bill lines are items 401 and 402, and a booth
  // where the bill being credited names an item the search cannot find is a
  // booth that cannot photograph the line picker. One catalogue, because two
  // would be two answers to "what does this company sell".
  row(401, 'Wireless Mouse', { description: 'Wireless | Black', sku: 'M221-BLK', hsn: '8471', type: 'stock', group: [4, 'Computers'], rate: 850, stock: [64, 20] }),
  row(402, 'USB-C Cable 1M', { description: '1 metre | Braided', sku: 'CB11-1M', hsn: '8544', type: 'stock', group: [4, 'Computers'], rate: 450, stock: [210, 50] }),
  row(403, 'Laptop Stand', { description: 'Aluminium | Adjustable', sku: 'LS-ALU', hsn: '8473', type: 'stock', group: [4, 'Computers'], rate: 1299, stock: [18, 6] }),
]

/** One fixture row in the shape the API's normaliser produces. */
function row(
  id: number,
  name: string,
  options: {
    description?: string | null
    sku?: string | null
    hsn?: string | null
    type?: 'stock' | 'service' | null
    group?: [number, string] | null
    rate?: number | null
    /** [available, reorder level] — omitted entirely means "Inventory did not say". */
    stock?: [number, number]
    active?: boolean
  },
) {
  const isService = options.type === 'service'
  const available = options.stock?.[0]
  const threshold = options.stock?.[1] ?? null

  let state: 'in' | 'low' | 'out' | 'none' | 'unknown' = 'unknown'
  if (isService) state = 'none'
  else if (available === undefined) state = 'unknown'
  else if (available <= 0) state = 'out'
  else if (threshold !== null && available <= threshold) state = 'low'
  else state = 'in'

  return {
    item_id: id,
    item_name: name,
    item_sku: options.sku ?? null,
    hsn_sac: options.hsn ?? null,
    unit_id: 1,
    mrp: options.rate === null || options.rate === undefined ? null : String(options.rate),
    description: options.description ?? null,
    barcode: null,
    type: options.type === undefined ? 'stock' : options.type,
    group: options.group ? { id: options.group[0], name: options.group[1] } : null,
    unit_name: isService ? null : 'Nos',
    rate: options.rate ?? null,
    currency: 'INR',
    is_active: options.active ?? (options.type === null ? null : true),
    image_url: null,
    stock: { available: isService ? null : (available ?? null), threshold: isService ? null : threshold, state },
    source: 'inventory',
  }
}

export const catalogItemStats = {
  total: { value: 1248, available: true, reason: null },
  stock: { value: 892, available: true, reason: null },
  services: { value: 356, available: true, reason: null },
  low_stock: { value: 24, available: true, reason: null },
  inactive: { value: 62, available: true, reason: null },
}

export const catalogItemGroups = [
  { group_id: 4, group_name: 'Computers' },
  { group_id: 5, group_name: 'Furniture' },
  { group_id: 6, group_name: 'Machinery' },
  { group_id: 7, group_name: 'Services' },
  { group_id: 3, group_name: 'Stationery' },
]

// ---------------------------------------------------------------------------
// Sales → Credit note
// ---------------------------------------------------------------------------

/** Customers, for the credit note's party search. */
export const customers = [
  // The credit note screen's parties.
  { acc_id: 701, acc_name: 'Vaibhav Traders', gstin: '29AACCV1234K1Z9' },
  { acc_id: 702, acc_name: 'Sunrise Electronics', gstin: '29AASCS4411P1ZQ' },
  { acc_id: 703, acc_name: 'Deepak General Store', gstin: null },
  { acc_id: 704, acc_name: 'Kaveri Retail LLP', gstin: '29AAKKR7788D1ZB' },
  // The bill screen's, which cover the three cases its GST readout has to
  // tell apart: registered in this company's own state, registered in
  // another, and no GSTIN at all.
  { acc_id: 501, acc_name: 'Deshmukh Retail LLP', gstin: '27AABCD1234E1Z9' },
  { acc_id: 502, acc_name: 'Ludhiana Cycle Works', gstin: '03AACFL5567P1ZB' },
  { acc_id: 503, acc_name: 'Cash Sales — Counter', gstin: null },
  { acc_id: 504, acc_name: 'Deshpande & Sons', gstin: '27AAGFD8890Q1ZK' },
  { acc_id: 505, acc_name: 'Walk-in Customers', gstin: null },
]

/** This customer's bills, as `v1/original-documents` returns them. */
export const originalDocuments = {
  party_account_id: 701,
  from: '2025-09-21',
  to: '2026-09-21',
  documents: [
    {
      voucher_id: 55201,
      voucher_uuid: 'v-55201',
      document_no: 'INV-2026-0912-087',
      date: '2026-09-12',
      party: 'Vaibhav Traders',
      party_id: 701,
      amount: 8500,
      status: 'PARTIALLY_PAID',
      outstanding: 7260,
    },
    {
      voucher_id: 55188,
      voucher_uuid: 'v-55188',
      document_no: 'INV-2026-0829-071',
      date: '2026-08-29',
      party: 'Vaibhav Traders',
      party_id: 701,
      amount: 14250,
      status: 'PAID',
      outstanding: 0,
    },
    {
      voucher_id: 55150,
      voucher_uuid: 'v-55150',
      document_no: 'INV-2026-0804-055',
      date: '2026-08-04',
      party: 'Vaibhav Traders',
      party_id: 701,
      amount: 3120,
      status: 'UNPAID',
      outstanding: 3120,
    },
  ],
  complete: true,
  outstanding_available: true,
  source: 'books',
  note: 'Read from Smart Books just now.',
}

/** One bill with the lines that were billed on it. */
export const originalDocument = {
  voucher_id: 55201,
  voucher_uuid: 'v-55201',
  document_no: 'INV-2026-0912-087',
  date: '2026-09-12',
  party: 'Vaibhav Traders',
  party_id: 701,
  amount: 8500,
  status: 'PARTIALLY_PAID',
  available: true,
  reason: null,
  lines_available: true,
  lines: [
    {
      line_ref: '1',
      item_id: 401,
      item_name: 'Wireless Mouse',
      sku: 'M221-BLK',
      hsn_sac: '8471',
      unit_id: 1,
      unit_name: 'Nos',
      warehouse_id: 3,
      batch_id: null,
      batch_no: 'BATCH-A1',
      qty: 5,
      rate: 850,
      discount_pc: 0,
      amount: 4250,
      tax_cat_id: 4,
      tax_rate: 18,
      stockable: true,
    },
    {
      line_ref: '2',
      item_id: 402,
      item_name: 'USB-C Cable 1M',
      sku: 'CB11-1M',
      hsn_sac: '8544',
      unit_id: 1,
      unit_name: 'Nos',
      warehouse_id: 3,
      batch_id: null,
      batch_no: 'BATCH-B3',
      qty: 6,
      rate: 450,
      discount_pc: 5,
      amount: 2565,
      tax_cat_id: 4,
      tax_rate: 18,
      stockable: true,
    },
    {
      line_ref: '3',
      item_id: null,
      item_name: 'Installation at site',
      sku: null,
      hsn_sac: '9987',
      unit_id: null,
      unit_name: null,
      warehouse_id: null,
      batch_id: null,
      batch_no: null,
      qty: 1,
      rate: 1200,
      discount_pc: 0,
      amount: 1200,
      tax_cat_id: 4,
      tax_rate: 18,
      stockable: false,
    },
  ],
  note: 'Read from Smart Books just now. Smart Books decides what may still be credited when the note is posted.',
}

export const warehouses = [
  { mc_id: 3, mc_name: 'Main Warehouse' },
  { mc_id: 4, mc_name: 'Delhi Warehouse' },
  { mc_id: 5, mc_name: 'Counter Stock' },
]

export const creditNoteTrend = {
  available: true,
  reason: null,
  label: 'September 2026',
  from: '2026-09-01',
  to: '2026-09-21',
  count: 3,
  value: 18240,
  previous_label: '11 Aug 2026 – 31 Aug 2026',
  previous_count: 2,
  series: [
    { label: '1–8', count: 1 },
    { label: '9–16', count: 0 },
    { label: '17–24', count: 2 },
    { label: '25+', count: 0 },
  ],
  source: 'books',
}

/** What the API returns when the harness "issues" a credit note. */
export const savedCreditNote = {
  request_id: 9210,
  request_uuid: '8f2c1a10-0000-4000-8000-000000009210',
  kind: 'credit_note',
  status: 'POSTED',
  party_account_id: 701,
  transaction_date: '2026-09-21',
  payload: {},
  books_voucher_id: 55311,
  books_voucher_uuid: 'v-55311',
  books_voucher_no: 'CN/0014',
  last_error: null,
  created_at: '2026-09-21T06:10:00Z',
}
