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
import type { BankWithdrawalActivity, BillingSession, LedgerAccounts } from '../src/services/types'

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
    { key: 'purchases', label: 'Purchases', path: '/purchases', children: [] },
    {
      key: 'money',
      label: 'Money',
      path: '/money-in',
      children: [
        { label: 'Money received', path: '/money-in/new' },
        { label: 'Money paid', path: '/money-out/new' },
        { label: 'Bank deposit', path: '/bank-cash/deposit' },
        { label: 'Bank withdrawal', path: '/bank-cash/withdrawal' },
      ],
    },
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
          row_key: 'bill-2', voucher_id: 4505, voucher_uuid: 'p-5', supplier: 'Aarti Plastics', supplier_id: 603,
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
      { account_id: 9001, account_name: 'Cash in hand', balance: 42500, kind: 'cash' },
      { account_id: 9002, account_name: 'HDFC Current', balance: 282000, kind: 'bank' },
    ],
    can_move_money: true,
    can_take_money: true,
    can_pay: true,
  },
  generated_at: '2026-09-16T09:12:00Z',
}

// ---------------------------------------------------------------------------
// Bank withdrawal
// ---------------------------------------------------------------------------

export const bankCashAccounts: LedgerAccounts = {
  accounts: [
    { account_id: 9001, account_name: 'Cash In Hand', account_no: null, kind: 'cash', group: 'Cash-in-hand', balance: 42500, overdraft_limit: null },
    { account_id: 9005, account_name: 'Petty Cash', account_no: null, kind: 'cash', group: 'Cash-in-hand', balance: 6200, overdraft_limit: null },
    { account_id: 9002, account_name: 'HDFC Bank', account_no: '502000123456', kind: 'bank', group: 'Bank Accounts', balance: 1248500, overdraft_limit: null },
    { account_id: 9003, account_name: 'ICICI Bank', account_no: '123456789012', kind: 'bank', group: 'Bank Accounts', balance: 386400, overdraft_limit: null },
    { account_id: 9004, account_name: 'Axis Bank', account_no: '998877665544', kind: 'bank', group: 'Bank Accounts', balance: 91250, overdraft_limit: null },
  ],
  balances_available: true,
  balances_reason: null,
  may_see_cash: true,
  may_see_bank: true,
  source: 'books',
  note: 'Accounts and balances come from Smart Books as this screen loads. Billing keeps no copy of either.',
}

export const bankWithdrawals: BankWithdrawalActivity = {
  available: true,
  reason: null,
  from: '2026-08-21',
  to: '2026-09-19',
  days: 30,
  account_id: null,
  entries: [
    { voucher_id: 7101, voucher_uuid: 'vch-w1', voucher_no: 'CON/0041', date: '2026-09-18', amount: 25000, bank_account_id: 9002, bank_account_name: 'HDFC Bank', cash_account_id: 9001, cash_account_name: 'Cash In Hand', reference: 'CHQ002341', narration: null },
    { voucher_id: 7102, voucher_uuid: 'vch-w2', voucher_no: 'CON/0039', date: '2026-09-16', amount: 10000, bank_account_id: 9003, bank_account_name: 'ICICI Bank', cash_account_id: 9001, cash_account_name: 'Cash In Hand', reference: 'UTR987654321', narration: null },
    { voucher_id: 7103, voucher_uuid: 'vch-w3', voucher_no: 'CON/0034', date: '2026-09-12', amount: 50000, bank_account_id: 9002, bank_account_name: 'HDFC Bank', cash_account_id: 9001, cash_account_name: 'Cash In Hand', reference: 'CHQ002333', narration: 'Cash for branch expenses' },
    { voucher_id: 7104, voucher_uuid: 'vch-w4', voucher_no: 'CON/0028', date: '2026-09-05', amount: 15000, bank_account_id: 9004, bank_account_name: 'Axis Bank', cash_account_id: 9005, cash_account_name: 'Petty Cash', reference: 'Slip No. 4456', narration: null },
  ],
  stats: { total: 235000, count: 12 },
  scanned: [
    { account_id: 9002, account_name: 'HDFC Bank' },
    { account_id: 9003, account_name: 'ICICI Bank' },
    { account_id: 9004, account_name: 'Axis Bank' },
  ],
  omitted_accounts: 0,
  complete: true,
  source: 'books',
  note: 'Read from Smart Books just now. Billing keeps no list of its own.',
}
