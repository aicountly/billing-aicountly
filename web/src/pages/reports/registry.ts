/**
 * The report catalogue, as the Reports screen understands it.
 *
 * WHAT LIVES WHERE, AND WHY.
 *
 * The server owns the catalogue: which reports exist, what each one is called,
 * which shelves it sits on, which product owns its figures, and — crucially —
 * which of them this Billing profile may open at all. None of that is decided
 * here, because a catalogue assembled in the browser is a catalogue the browser
 * can edit, and `v1/reports/{key}` checks the same permission list again when
 * the report is actually run.
 *
 * This file owns only presentation: the icon for a shelf, the wording on a
 * card, the words a search should also match. Nothing in it can make a report
 * appear that the server did not send, and nothing in it is financial data.
 */

import {
  BookOpen,
  Boxes,
  ChartPie,
  Clock,
  FileText,
  IndianRupee,
  Landmark,
  Percent,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

export type ReportCategoryId =
  | 'sales'
  | 'purchases'
  | 'receivables-payables'
  | 'gst'
  | 'items-stock'
  | 'money'
  | 'registers'
  | 'management'
  | 'audit'

/** The product whose figures a report reads. Billing owns none of them. */
export type ReportSource = 'books' | 'inventory' | 'billing'

/** One entry of `GET v1/reports`. Everything but the key is describing text. */
export interface ReportSummary {
  key: string
  label: string
  description?: string
  categories?: string[]
  source?: string
  kind?: string
}

export interface DecoratedReport extends ReportSummary {
  description: string
  categories: ReportCategoryId[]
  source: ReportSource
  icon: LucideIcon
  /** Extra words a search should match — never shown, only searched. */
  keywords: string[]
}

export interface ReportCategory {
  id: ReportCategoryId
  title: string
  description: string
  icon: LucideIcon
  /** Pastel tile colour. Presentation only. */
  tone: 'green' | 'blue' | 'purple' | 'pink' | 'orange' | 'cyan'
  /**
   * Which product would have to serve this shelf for it to fill up.
   *
   * Shown only when the shelf is empty, so an empty card says why it is empty
   * instead of pretending the reports are somewhere else on the page.
   */
  servedBy: ReportSource | null
}

export const CATEGORIES: ReportCategory[] = [
  {
    id: 'sales',
    title: 'Sales Reports',
    description: 'Invoices, customers, products, trends and more',
    icon: TrendingUp,
    tone: 'green',
    servedBy: 'books',
  },
  {
    id: 'purchases',
    title: 'Purchase Reports',
    description: 'Bills, suppliers, expenses and purchase analysis',
    icon: ShoppingCart,
    tone: 'blue',
    servedBy: 'books',
  },
  {
    id: 'receivables-payables',
    title: 'Receivables & Payables',
    description: 'Outstanding balances, ageing and party analysis',
    icon: Wallet,
    tone: 'purple',
    servedBy: 'books',
  },
  {
    id: 'gst',
    title: 'GST Reports',
    description: 'GST summaries, tax analysis and statutory views',
    icon: Percent,
    tone: 'pink',
    servedBy: 'books',
  },
  {
    id: 'items-stock',
    title: 'Items & Stock Reports',
    description: 'Item movement, stock analysis and valuation',
    icon: Boxes,
    tone: 'orange',
    servedBy: 'inventory',
  },
  {
    id: 'money',
    title: 'Money Reports',
    description: 'Receipts, payments, bank, cash and expense views',
    icon: IndianRupee,
    tone: 'green',
    servedBy: 'books',
  },
  {
    id: 'registers',
    title: 'Registers',
    description: 'Accounting registers, books and transaction views',
    icon: BookOpen,
    tone: 'blue',
    servedBy: 'books',
  },
  {
    id: 'management',
    title: 'Management Reports',
    description: 'Business performance, profitability and analytical views',
    icon: ChartPie,
    tone: 'purple',
    servedBy: null,
  },
  {
    id: 'audit',
    title: 'Audit & Compliance',
    description: 'Exceptions, audit trails and reconciliation',
    icon: ShieldCheck,
    tone: 'cyan',
    servedBy: 'books',
  },
]

const CATEGORY_IDS = new Set<string>(CATEGORIES.map((category) => category.id))

export function findCategory(id: string): ReportCategory | null {
  return CATEGORIES.find((category) => category.id === id) ?? null
}

/** How each product is named to a user. They do not know the word "source". */
export const SOURCE_LABELS: Record<ReportSource, string> = {
  books: 'Smart Books',
  inventory: 'Inventory',
  billing: 'Billing',
}

/** The icon for a report, by the kind of thing it is. */
const KIND_ICONS: Record<string, LucideIcon> = {
  register: FileText,
  ageing: Clock,
  accounts: Landmark,
  exceptions: ShieldAlert,
}

/**
 * Words a search should match besides the name and the description.
 *
 * Keyed by the server's report key. A key with no entry simply has no extra
 * words — an unknown report still lists, searches and opens, which is what
 * keeps this file from being something the backend has to be kept in step with.
 */
const KEYWORDS: Record<string, string[]> = {
  sales_register: ['invoice', 'bill', 'customer', 'turnover', 'revenue', 'gst', 'tax'],
  purchase_register: ['bill', 'supplier', 'vendor', 'expense', 'inward', 'gst', 'tax'],
  credit_notes: ['return', 'sales return', 'refund', 'cn', 'customer'],
  debit_notes: ['return', 'purchase return', 'dn', 'supplier'],
  receipts: ['collection', 'money in', 'received', 'customer', 'cash', 'bank'],
  payments: ['money out', 'paid', 'supplier', 'cash', 'bank'],
  receivables_ageing: ['outstanding', 'debtors', 'overdue', 'due', 'collect', 'customer', 'balance'],
  payables_ageing: ['outstanding', 'creditors', 'overdue', 'due', 'pay', 'supplier', 'balance'],
  cash_bank_summary: ['balance', 'closing', 'account', 'cash in hand', 'bank'],
  document_exceptions: ['failed', 'pending', 'e-invoice', 'eway', 'irn', 'compliance', 'audit', 'stuck'],
}

function asCategories(values: string[] | undefined, kind: string | undefined): ReportCategoryId[] {
  const known = (values ?? []).filter((value): value is ReportCategoryId => CATEGORY_IDS.has(value))
  if (known.length > 0) return known

  // A report the server described with no shelf we recognise still needs a home,
  // or it would list in the search results and belong to no card on the page.
  if (kind === 'register') return ['registers']
  return []
}

function asSource(value: string | undefined): ReportSource {
  return value === 'inventory' || value === 'billing' ? value : 'books'
}

/** Server metadata plus the presentation this screen adds to it. */
export function decorate(report: ReportSummary): DecoratedReport {
  return {
    ...report,
    description: report.description ?? '',
    categories: asCategories(report.categories, report.kind),
    source: asSource(report.source),
    icon: KIND_ICONS[report.kind ?? ''] ?? FileText,
    keywords: KEYWORDS[report.key] ?? [],
  }
}

export function decorateAll(reports: ReportSummary[]): DecoratedReport[] {
  return reports.map(decorate)
}

/** Does this report answer that search? Name, description, shelf and keywords. */
export function matches(report: DecoratedReport, term: string): boolean {
  const needle = term.trim().toLowerCase()
  if (!needle) return true

  const haystack = [
    report.label,
    report.description,
    SOURCE_LABELS[report.source],
    ...report.categories.map((id) => findCategory(id)?.title ?? id),
    ...report.keywords,
  ]
    .join(' ')
    .toLowerCase()

  // Every word has to appear somewhere, so "customer ageing" narrows rather
  // than widening the way an any-word match would.
  return needle.split(/\s+/).every((word) => haystack.includes(word))
}

export function countByCategory(reports: DecoratedReport[], id: ReportCategoryId): number {
  return reports.filter((report) => report.categories.includes(id)).length
}

/** The modules actually represented in this catalogue — never a fixed list. */
export function sourcesIn(reports: DecoratedReport[]): ReportSource[] {
  const seen = new Set<ReportSource>()
  for (const report of reports) seen.add(report.source)
  return (['books', 'inventory', 'billing'] as ReportSource[]).filter((source) => seen.has(source))
}
