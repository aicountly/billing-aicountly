/**
 * Everything the Settings hub knows about itself, in one list.
 *
 * WHY THIS IS A CONFIG AND NOT TWELVE COMPONENTS. The hub, the search, the
 * detail pages, the quick actions and the side rail all render from this array.
 * Adding a thirteenth category — or moving a child from one category to another
 * when the product grows — is an edit here, not a rewrite of a page.
 *
 * THE THREE STATES ARE THE HONEST PART, and they are the reason this file is
 * long rather than a list of titles:
 *
 *   ready      — Billing has a screen for it, behind `to`. It works today.
 *   elsewhere  — another AICOUNTLY product owns the data. The row opens that
 *                product. Billing does NOT keep a second copy of a company, a
 *                branch, a financial year, an item or a ledger, so it cannot
 *                offer a form for one. See docs/ARCHITECTURE.md.
 *   planned    — the capability does not exist in this deployment. The row says
 *                so and does nothing. It is never drawn as a switch that would
 *                pretend to save.
 *
 * Nothing here invents a permission: every `permission` is a key from
 * server-php Permissions::CATALOG, which is what the API checks too.
 */

import {
  Building2,
  ContactRound,
  FileText,
  Layers3,
  Percent,
  PlugZap,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  WalletCards,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import type { BillingSettings } from '../services/types'

/** The twelve icon-tile colours. Each one is defined in billing-settings.css. */
export type SettingsAccent =
  | 'blue' | 'green' | 'purple' | 'red' | 'amber' | 'cyan'
  | 'orange' | 'violet' | 'mint' | 'pink' | 'sky' | 'indigo'

export type SettingState = 'ready' | 'elsewhere' | 'planned'

/** A boolean on the Billing settings row that decides whether a child applies. */
type BusinessSwitch = 'gst_registered' | 'maintains_stock' | 'needs_purchase' | 'needs_payables' | 'needs_bank_cash'

export interface SettingsChild {
  key: string
  label: string
  /** One line. What this setting decides, in the user's words. */
  description: string
  state: SettingState
  /** `ready`: the route inside Billing. */
  to?: string
  /** `elsewhere`: the AICOUNTLY app id that owns it, from config/aicountlyApps.ts. */
  app?: string
  /** A Permissions::CATALOG key. Absent means everyone who reaches the page. */
  permission?: string
  /** Hidden when this business has switched the area off. */
  needs?: BusinessSwitch
  keywords?: string[]
}

export interface SettingsCategory {
  id: string
  title: string
  description: string
  icon: LucideIcon
  accent: SettingsAccent
  path: string
  permission?: string
  keywords: string[]
  children: SettingsChild[]
}

/** Where a category lives. One place builds the path so a rename cannot drift. */
export function settingsPath(id: string): string {
  return `/settings/${id}`
}

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    id: 'company',
    title: 'Company & Business',
    description: 'Business details, addresses, logo, financial year, branches',
    icon: Building2,
    accent: 'blue',
    path: settingsPath('company'),
    keywords: ['company', 'business', 'branch', 'financial year', 'fy', 'logo', 'address', 'registered office', 'gstin', 'letterhead'],
    children: [
      {
        key: 'company-profile',
        label: 'Company profile',
        description: 'Name, registered office and registration details, held in Aicountly Manage.',
        state: 'elsewhere',
        app: 'manage',
        keywords: ['name', 'registered office', 'pan', 'cin'],
      },
      {
        key: 'company-addresses',
        label: 'Business addresses',
        description: 'The address printed on your documents. One master, every product.',
        state: 'elsewhere',
        app: 'manage',
        keywords: ['address', 'letterhead', 'pincode'],
      },
      {
        key: 'company-logo',
        label: 'Logo & branding',
        description: 'The mark shown on this app and on printed documents.',
        state: 'elsewhere',
        app: 'manage',
        keywords: ['logo', 'brand', 'mark'],
      },
      {
        key: 'company-branches',
        label: 'Branches',
        description: 'Add or rename a branch. The branch picker in the header reads this list live.',
        state: 'elsewhere',
        app: 'manage',
        keywords: ['branch', 'location', 'godown', 'bo_id'],
      },
      {
        key: 'company-fy',
        label: 'Financial year',
        description: 'Open, close or correct a year. Every figure in Billing is read for the year you pick.',
        state: 'elsewhere',
        app: 'manage',
        keywords: ['financial year', 'fy', 'year end', 'period'],
      },
      {
        key: 'business-defaults',
        label: 'Business defaults',
        description: 'What this business uses Billing for — and therefore what appears in the menu.',
        state: 'ready',
        to: settingsPath('company'),
        permission: 'settings.manage',
        keywords: ['menu', 'business type', 'purchases', 'stock', 'payables', 'mode'],
      },
    ],
  },

  {
    id: 'documents',
    title: 'Invoice & Document Settings',
    description: 'Invoice formats, numbering, terms, headers, footers',
    icon: FileText,
    accent: 'green',
    path: settingsPath('documents'),
    keywords: ['invoice', 'bill', 'credit note', 'debit note', 'numbering', 'prefix', 'template', 'terms', 'pdf', 'print', 'header', 'footer', 'signature'],
    children: [
      {
        key: 'sale-terms',
        label: 'Default terms on a bill',
        description: 'The terms and conditions a new bill starts with.',
        state: 'ready',
        to: settingsPath('documents'),
        permission: 'settings.manage',
        keywords: ['terms', 'conditions', 'notes'],
      },
      {
        key: 'payment-terms',
        label: 'Default payment terms',
        description: 'How long a customer normally gets to pay.',
        state: 'ready',
        to: settingsPath('documents'),
        permission: 'settings.manage',
        keywords: ['credit days', 'due date', 'payment terms'],
      },
      {
        key: 'credit-note',
        label: 'Credit note',
        description: 'Raise a credit note against an original invoice.',
        state: 'ready',
        to: '/more/credit-note',
        permission: 'credit_note.create',
        keywords: ['credit note', 'return', 'sales return'],
      },
      {
        key: 'debit-note',
        label: 'Debit note',
        description: 'Raise a debit note against an original purchase bill.',
        state: 'ready',
        to: '/more/debit-note',
        permission: 'debit_note.create',
        needs: 'needs_purchase',
        keywords: ['debit note', 'purchase return'],
      },
      {
        key: 'numbering',
        label: 'Document numbering',
        description: 'Prefixes and series belong to the voucher type in Smart Books, which numbers every document Billing creates.',
        state: 'elsewhere',
        app: 'books',
        keywords: ['numbering', 'prefix', 'suffix', 'series', 'sequence', 'invoice number', 'reset'],
      },
      {
        key: 'print-template',
        label: 'Print template & letterhead',
        description: 'The printed layout comes from Smart Books, so paper from Billing and from Books match.',
        state: 'elsewhere',
        app: 'books',
        keywords: ['print', 'pdf', 'template', 'letterhead', 'header', 'footer', 'signature', 'qr'],
      },
      {
        key: 'document-sharing',
        label: 'Email & WhatsApp defaults',
        description: 'Sending a document straight from Billing is not available in this deployment.',
        state: 'planned',
        keywords: ['email', 'whatsapp', 'share', 'send'],
      },
    ],
  },

  {
    id: 'users',
    title: 'Users & Access',
    description: 'Manage team members, roles and permissions',
    icon: Users,
    accent: 'purple',
    path: settingsPath('users'),
    permission: 'access.manage',
    keywords: ['user', 'users', 'role', 'roles', 'permission', 'permissions', 'staff', 'team', 'profile', 'access', 'who can do what', 'biller'],
    children: [
      {
        key: 'profiles',
        label: 'Billing profiles',
        description: 'What each person may see and do inside Billing. Checked again by the API on every call.',
        state: 'ready',
        to: '/more/profiles',
        permission: 'access.manage',
        keywords: ['who can do what', 'role', 'permission', 'biller', 'cashier'],
      },
      {
        key: 'profile-members',
        label: 'People in each profile',
        description: 'Who holds which Billing profile in this company.',
        state: 'ready',
        to: '/more/profiles',
        permission: 'access.manage',
        keywords: ['members', 'staff', 'assign'],
      },
      {
        key: 'portal-users',
        label: 'Portal users & company access',
        description: 'Adding a person to the company, and removing them, is done once in Aicountly Manage.',
        state: 'elsewhere',
        app: 'manage',
        keywords: ['invite', 'user', 'add user', 'remove', 'company access'],
      },
      {
        key: 'sign-in-security',
        label: 'Sign-in & two-factor',
        description: 'Passwords, devices and two-factor sign-in are the portal account, shared by every AICOUNTLY app.',
        state: 'elsewhere',
        app: 'manage',
        keywords: ['password', 'two factor', '2fa', 'login', 'session', 'device'],
      },
      {
        key: 'access-logs',
        label: 'Access log',
        description: 'Billing records who changed what, but there is no screen to read it back yet.',
        state: 'planned',
        keywords: ['audit', 'log', 'history', 'trail'],
      },
    ],
  },

  {
    id: 'taxes',
    title: 'Taxes',
    description: 'GST, TDS, TCS and tax settings',
    icon: Percent,
    accent: 'red',
    path: settingsPath('taxes'),
    keywords: ['gst', 'tax', 'gstin', 'hsn', 'sac', 'tds', 'tcs', 'e-invoice', 'einvoice', 'irn', 'e-way', 'eway', 'rounding', 'composition', 'place of supply'],
    children: [
      {
        key: 'gst-registered',
        label: 'GST registration',
        description: 'Whether this business is registered. It decides what the bill screens ask for.',
        state: 'ready',
        to: settingsPath('taxes'),
        permission: 'settings.manage',
        keywords: ['gst', 'registered', 'unregistered', 'composition'],
      },
      {
        key: 'gstin',
        label: 'GSTIN',
        description: 'The number itself is the company master, held once in Aicountly Manage.',
        state: 'elsewhere',
        app: 'manage',
        keywords: ['gstin', 'gst number', 'registration number'],
      },
      {
        key: 'tax-rates',
        label: 'Tax rates & categories',
        description: 'Smart Books computes the tax on every bill, from its own tax categories. Billing sends no tax figure.',
        state: 'elsewhere',
        app: 'books',
        keywords: ['rate', 'slab', 'cgst', 'sgst', 'igst', 'cess', 'tax category', 'rounding', 'place of supply', 'reverse charge'],
      },
      {
        key: 'hsn',
        label: 'HSN / SAC codes',
        description: 'An item carries its own HSN or SAC in Inventory, which is where it is set.',
        state: 'elsewhere',
        app: 'inventory',
        needs: 'maintains_stock',
        keywords: ['hsn', 'sac', 'code', 'classification'],
      },
      {
        key: 'einvoice',
        label: 'e-Invoice & e-Way Bill',
        description: 'Generated per document, from the bill itself. Smart Books holds the portal credentials and the IRN.',
        state: 'ready',
        to: settingsPath('taxes'),
        permission: 'einvoice.generate',
        keywords: ['e-invoice', 'einvoice', 'irn', 'e-way', 'eway', 'nic', 'portal'],
      },
      {
        key: 'tds-tcs',
        label: 'TDS & TCS',
        description: 'Deduction and collection at source are posted in Smart Books, not from a billing screen.',
        state: 'elsewhere',
        app: 'books',
        keywords: ['tds', 'tcs', 'deduction', 'section'],
      },
    ],
  },

  {
    id: 'payments',
    title: 'Payment & Banking',
    description: 'Bank accounts, payment modes, UPI, cheque settings',
    icon: WalletCards,
    accent: 'amber',
    path: settingsPath('payments'),
    keywords: ['bank', 'cash', 'account', 'payment', 'upi', 'qr', 'cheque', 'receipt', 'deposit', 'withdrawal', 'expense', 'gateway', 'settlement'],
    children: [
      {
        key: 'bank-cash',
        label: 'Cash & bank accounts',
        description: 'The accounts you take money into and pay from, with their live balances.',
        state: 'ready',
        to: '/bank-cash',
        permission: 'bank.view',
        needs: 'needs_bank_cash',
        keywords: ['bank', 'cash', 'balance', 'account'],
      },
      {
        key: 'track-bank-cash',
        label: 'Track cash and bank here',
        description: 'Turn the money screens on or off for this business.',
        state: 'ready',
        to: settingsPath('payments'),
        permission: 'settings.manage',
        keywords: ['cash', 'bank', 'menu', 'hide'],
      },
      {
        key: 'expense',
        label: 'Record an expense',
        description: 'Post a shop expense against a cash or bank account.',
        state: 'ready',
        to: '/more/expense',
        permission: 'expense.create',
        keywords: ['expense', 'spend', 'petty cash', 'bill paid'],
      },
      {
        key: 'bank-movement',
        label: 'Deposits, withdrawals and transfers',
        description: 'Move money between cash and bank, or between two banks.',
        state: 'ready',
        to: '/bank-cash/deposit',
        permission: 'contra.create',
        needs: 'needs_bank_cash',
        keywords: ['deposit', 'withdraw', 'transfer', 'contra'],
      },
      {
        key: 'bank-master',
        label: 'Bank account details',
        description: 'Account number, IFSC and the ledger behind each account are Smart Books masters.',
        state: 'elsewhere',
        app: 'books',
        keywords: ['ifsc', 'account number', 'ledger', 'cheque', 'branch'],
      },
      {
        key: 'gateway',
        label: 'Payment gateway & collection',
        description: 'Billing records money that has already moved; it does not collect payments. No gateway is wired to this deployment.',
        state: 'planned',
        keywords: ['gateway', 'upi', 'qr', 'payment link', 'aicountly pay', 'settlement', 'collect'],
      },
    ],
  },

  {
    id: 'preferences',
    title: 'General Preferences',
    description: 'Date format, number format, notifications and more',
    icon: Settings2,
    accent: 'cyan',
    path: settingsPath('preferences'),
    keywords: ['timezone', 'time zone', 'date', 'format', 'number', 'currency', 'language', 'landing', 'draft', 'autosave', 'notification', 'shortcut'],
    children: [
      {
        key: 'timezone',
        label: 'Time zone',
        description: 'Whose day "today" means. A shop trading at 9pm is not on tomorrow because the server is.',
        state: 'ready',
        to: settingsPath('preferences'),
        permission: 'settings.manage',
        keywords: ['timezone', 'time zone', 'today', 'day close'],
      },
      {
        key: 'drafts',
        label: 'Entries not saved yet',
        description: 'Anything that did not reach Smart Books, and a retry that cannot duplicate it.',
        state: 'ready',
        to: '/more/unfinished',
        keywords: ['draft', 'unsaved', 'failed', 'retry', 'pending', 'not saved'],
      },
      {
        key: 'landing',
        label: 'Where you land',
        description: 'Decided by your Billing profile, on the server, so it cannot offer a screen the API would refuse.',
        state: 'ready',
        to: settingsPath('preferences'),
        keywords: ['landing', 'home', 'start', 'dashboard'],
      },
      {
        key: 'formats',
        label: 'Date, number and currency format',
        description: 'Indian digit grouping and the document’s own currency, everywhere. Not configurable in this release.',
        state: 'planned',
        keywords: ['date format', 'number format', 'decimal', 'currency', 'language', 'lakh', 'crore'],
      },
      {
        key: 'notifications',
        label: 'Notifications',
        description: 'The bell shows the same short list the dashboard acts on. There is nothing to tune yet.',
        state: 'planned',
        keywords: ['notification', 'bell', 'alert', 'reminder popup'],
      },
    ],
  },

  {
    id: 'items',
    title: 'Items & Inventory',
    description: 'Item defaults, categories, HSN/SAC, units',
    icon: Layers3,
    accent: 'orange',
    path: settingsPath('items'),
    keywords: ['item', 'items', 'stock', 'inventory', 'unit', 'hsn', 'sac', 'category', 'price', 'mrp', 'barcode'],
    children: [
      {
        key: 'maintains-stock',
        label: 'Keep stock here',
        description: 'Turn the item and stock screens on or off for this business.',
        state: 'ready',
        to: settingsPath('items'),
        permission: 'settings.manage',
        keywords: ['stock', 'inventory', 'menu', 'hide'],
      },
      {
        key: 'item-list',
        label: 'Items',
        description: 'The item list as Inventory holds it, read live — with stock where you are allowed to see it.',
        state: 'ready',
        to: '/items',
        permission: 'sale.view',
        needs: 'maintains_stock',
        keywords: ['item', 'search', 'stock', 'list'],
      },
      {
        key: 'item-master',
        label: 'Item masters, units and categories',
        description: 'Items belong to Inventory. Billing reads them on the request that draws them and stores none.',
        state: 'elsewhere',
        app: 'inventory',
        keywords: ['unit', 'uom', 'category', 'group', 'sku', 'barcode', 'create item', 'hsn'],
      },
      {
        key: 'item-pricing',
        label: 'Price lists & MRP',
        description: 'Rates and MRP come from the item in Inventory.',
        state: 'elsewhere',
        app: 'inventory',
        keywords: ['price', 'rate', 'mrp', 'discount', 'price list'],
      },
      {
        key: 'item-search',
        label: 'Item search behaviour',
        description: 'Search already prefers what you bill most. There is nothing to configure yet.',
        state: 'planned',
        keywords: ['search', 'favourite', 'suggest'],
      },
    ],
  },

  {
    id: 'parties',
    title: 'Parties & Contacts',
    description: 'Customer and supplier defaults, credit limits, KYC',
    icon: ContactRound,
    accent: 'violet',
    path: settingsPath('parties'),
    keywords: ['party', 'parties', 'customer', 'supplier', 'vendor', 'contact', 'credit limit', 'credit days', 'kyc', 'gstin'],
    children: [
      {
        key: 'party-list',
        label: 'Customers & suppliers',
        description: 'Every party with what they owe or are owed, read live from Smart Books.',
        state: 'ready',
        to: '/parties',
        permission: 'sale.view',
        keywords: ['customer', 'supplier', 'party', 'balance', 'statement'],
      },
      {
        key: 'party-master',
        label: 'Party masters & GSTIN',
        description: 'A customer is an account ledger in Smart Books. Created once there, used everywhere.',
        state: 'elsewhere',
        app: 'books',
        keywords: ['create customer', 'ledger', 'account', 'gstin', 'address'],
      },
      {
        key: 'contacts',
        label: 'Contact details & communication',
        description: 'Phone numbers, emails and people sit in Aicountly Contacts.',
        state: 'elsewhere',
        app: 'contacts',
        keywords: ['phone', 'email', 'contact', 'person', 'communication'],
      },
      {
        key: 'party-reminders',
        label: 'Chasing preferences',
        description: 'When and how often a customer is reminded about an overdue bill.',
        state: 'ready',
        to: settingsPath('automation'),
        permission: 'recurring.manage',
        keywords: ['reminder', 'follow up', 'chase', 'overdue'],
      },
      {
        key: 'credit-limit',
        label: 'Credit limits & KYC',
        description: 'Billing does not hold a credit limit, and blocking a sale on one is not implemented.',
        state: 'planned',
        keywords: ['credit limit', 'credit days', 'kyc', 'block', 'hold'],
      },
    ],
  },

  {
    id: 'automation',
    title: 'Automation & Workflows',
    description: 'Recurring bills, payment reminders, auto numbering',
    icon: Workflow,
    accent: 'mint',
    path: settingsPath('automation'),
    permission: 'recurring.manage',
    keywords: ['recurring', 'repeat', 'rent', 'subscription', 'reminder', 'chase', 'follow up', 'automation', 'schedule', 'rule'],
    children: [
      {
        key: 'recurring',
        label: 'Recurring bills',
        description: 'A rule that raises a real invoice in Smart Books when its date comes round.',
        state: 'ready',
        to: '/more/recurring',
        permission: 'recurring.manage',
        keywords: ['recurring', 'rent', 'monthly', 'subscription', 'repeat'],
      },
      {
        key: 'reminder-rules',
        label: 'Payment reminders',
        description: 'When to chase an overdue bill, how often, and the smallest amount worth chasing.',
        state: 'ready',
        to: settingsPath('automation'),
        permission: 'recurring.manage',
        keywords: ['reminder', 'chase', 'overdue', 'receivable', 'follow up', 'dunning'],
      },
      {
        key: 'reminder-candidates',
        label: 'Who a reminder would chase today',
        description: 'Worked out from what Books says is still outstanding right now, never from a stored balance.',
        state: 'ready',
        to: settingsPath('automation'),
        permission: 'reminder.send',
        keywords: ['candidates', 'chase list', 'today', 'overdue'],
      },
      {
        key: 'auto-send',
        label: 'Automatic sending',
        description: 'Nothing is sent without a person. Billing has no email, WhatsApp or SMS channel wired to it.',
        state: 'planned',
        keywords: ['automatic', 'send', 'email', 'whatsapp', 'sms', 'schedule send'],
      },
      {
        key: 'approval-flows',
        label: 'Approval rules',
        description: 'Maker–checker on a bill is not implemented in Billing.',
        state: 'planned',
        keywords: ['approval', 'maker checker', 'authorise', 'workflow'],
      },
    ],
  },

  {
    id: 'security',
    title: 'Data & Security',
    description: 'Backups, audit logs, session management',
    icon: ShieldCheck,
    accent: 'pink',
    path: settingsPath('security'),
    keywords: ['security', 'audit', 'log', 'backup', 'export', 'session', 'device', 'retention', 'password', 'two factor'],
    children: [
      {
        key: 'export',
        label: 'Export a report',
        description: 'Every report downloads as CSV, with the same figures on screen and in the file.',
        state: 'ready',
        to: '/reports',
        permission: 'export.data',
        keywords: ['export', 'csv', 'download', 'backup', 'data'],
      },
      {
        key: 'unfinished',
        label: 'Entries not saved yet',
        description: 'What has not reached Smart Books, why, and a retry that cannot make a second invoice.',
        state: 'ready',
        to: '/more/unfinished',
        keywords: ['failed', 'retry', 'stuck', 'not saved', 'integrity'],
      },
      {
        key: 'sessions',
        label: 'Sessions & devices',
        description: 'You are signed in with your AICOUNTLY portal account. Sessions are managed there, for every app at once.',
        state: 'elsewhere',
        app: 'manage',
        keywords: ['session', 'device', 'sign out', 'logout', 'password', 'two factor', '2fa'],
      },
      {
        key: 'audit-trail',
        label: 'Audit trail',
        description: 'Billing writes an append-only log of its own actions. A screen to read it back is not built yet.',
        state: 'planned',
        keywords: ['audit', 'trail', 'who changed', 'history'],
      },
      {
        key: 'retention',
        label: 'Data retention & deletion',
        description: 'Billing stores references, not accounts. Retention is decided where the data lives.',
        state: 'planned',
        keywords: ['retention', 'delete', 'purge', 'gdpr'],
      },
    ],
  },

  {
    id: 'integrations',
    title: 'Integrations',
    description: 'e-Invoice, e-Way, payment gateways, accounting tools',
    icon: PlugZap,
    accent: 'sky',
    path: settingsPath('integrations'),
    keywords: ['integration', 'connect', 'books', 'inventory', 'manage', 'api', 'webhook', 'e-invoice', 'e-way', 'gateway', 'email', 'whatsapp', 'sms'],
    children: [
      {
        key: 'books',
        label: 'Smart Books',
        description: 'Every voucher Billing creates is created there, and every figure is read back from it.',
        state: 'elsewhere',
        app: 'books',
        keywords: ['books', 'accounting', 'voucher', 'ledger'],
      },
      {
        key: 'inventory',
        label: 'Inventory',
        description: 'Items, stock and cost, read live on the request that needs them.',
        state: 'elsewhere',
        app: 'inventory',
        needs: 'maintains_stock',
        keywords: ['inventory', 'stock', 'item'],
      },
      {
        key: 'manage',
        label: 'Aicountly Manage',
        description: 'Company, branch and financial year. Billing keeps the three ids and nothing else.',
        state: 'elsewhere',
        app: 'manage',
        keywords: ['manage', 'company', 'branch', 'financial year'],
      },
      {
        key: 'gst-portal',
        label: 'e-Invoice & e-Way Bill portal',
        description: 'Smart Books talks to the government portal and holds the credentials. Billing only asks.',
        state: 'elsewhere',
        app: 'books',
        keywords: ['e-invoice', 'e-way', 'nic', 'irn', 'gst portal'],
      },
      {
        key: 'messaging',
        label: 'Email, WhatsApp & SMS',
        description: 'No messaging channel is wired to this deployment, so nothing can be sent from here.',
        state: 'planned',
        keywords: ['email', 'whatsapp', 'sms', 'send', 'message'],
      },
      {
        key: 'api-webhooks',
        label: 'API access & webhooks',
        description: 'Billing exposes no public API key or webhook of its own.',
        state: 'planned',
        keywords: ['api', 'webhook', 'token', 'developer', 'integration key'],
      },
    ],
  },

  {
    id: 'advanced',
    title: 'Advanced Settings',
    description: 'Custom fields, approval flows and developer options',
    icon: SlidersHorizontal,
    accent: 'indigo',
    path: settingsPath('advanced'),
    permission: 'settings.manage',
    keywords: ['advanced', 'developer', 'custom field', 'approval', 'setup', 'onboarding', 'business mode', 'reset', 'experimental'],
    children: [
      {
        key: 'business-mode',
        label: 'Business mode',
        description: 'The shape of the whole app for this company. Changing it changes what everybody here sees.',
        state: 'ready',
        to: settingsPath('advanced'),
        permission: 'settings.manage',
        keywords: ['mode', 'micro', 'trader', 'retail', 'service', 'menu'],
      },
      {
        key: 'rerun-setup',
        label: 'Run the setup questions again',
        description: 'Asks the five questions the next time an owner opens Billing. It changes no record.',
        state: 'ready',
        to: settingsPath('advanced'),
        permission: 'settings.manage',
        keywords: ['onboarding', 'setup', 'wizard', 'questions', 'reset'],
      },
      {
        key: 'custom-fields',
        label: 'Custom fields',
        description: 'Extra fields on a bill would have to exist in Smart Books first. Not implemented.',
        state: 'planned',
        keywords: ['custom field', 'extra field', 'udf'],
      },
      {
        key: 'developer',
        label: 'Developer options',
        description: 'There is no developer console, API key or feature flag in this product.',
        state: 'planned',
        keywords: ['developer', 'api key', 'flag', 'experimental', 'debug'],
      },
      {
        key: 'import-export',
        label: 'Import & export defaults',
        description: 'Reports export as CSV today. A configurable import is not implemented.',
        state: 'planned',
        keywords: ['import', 'export', 'csv', 'mapping', 'bulk'],
      },
    ],
  },
]

export function findCategory(id: string | undefined): SettingsCategory | null {
  return SETTINGS_CATEGORIES.find((category) => category.id === id) ?? null
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

export interface SettingsAudience {
  can: (permission: string) => boolean
  settings: BillingSettings | null
}

/** A child the business uses and this profile may reach. */
export function childVisible(child: SettingsChild, audience: SettingsAudience): boolean {
  if (child.permission && !audience.can(child.permission)) return false
  if (child.needs && audience.settings && audience.settings[child.needs] === false) return false

  return true
}

/**
 * A category is drawn when this profile holds its permission AND something
 * inside it is still visible. A card that opens onto nothing is a dead card.
 */
export function categoryVisible(category: SettingsCategory, audience: SettingsAudience): boolean {
  if (category.permission && !audience.can(category.permission)) return false

  return category.children.some((child) => childVisible(child, audience))
}

export function visibleCategories(audience: SettingsAudience): SettingsCategory[] {
  return SETTINGS_CATEGORIES.filter((category) => categoryVisible(category, audience))
}

export function visibleChildren(category: SettingsCategory, audience: SettingsAudience): SettingsChild[] {
  return category.children.filter((child) => childVisible(child, audience))
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SettingsHit {
  key: string
  category: SettingsCategory
  /** Absent when the category itself is the match. */
  child: SettingsChild | null
  label: string
  description: string
  /** Where Enter goes. */
  to: string
  /** `elsewhere` hits leave the app, so the row says so before it is chosen. */
  child_state: SettingState | null
  app?: string
}

/**
 * Rank one candidate against the query.
 *
 * Two kinds of match, because people search both ways. A PHRASE match is what
 * someone types when they half-know the name — "gst", "numbering" — and it is
 * ranked by which field it landed in. A TOKEN match is what someone types when
 * they are describing the thing — "invoice number", "who can do what" — where
 * no single field contains that exact string but every word is in there
 * somewhere. Without the second, "invoice number" finds the numbering row and
 * misses the category it lives in, which is the one the user recognises.
 */
function scoreOf(
  query: string,
  tokens: string[],
  fields: { title: string; keywords: string[]; description: string; context?: string },
): number {
  const title = fields.title.toLowerCase()
  const keywords = fields.keywords.map((word) => word.toLowerCase())
  const description = fields.description.toLowerCase()
  const everything = [title, ...keywords, description, fields.context ?? ''].join(' \u00b7 ').toLowerCase()

  if (title.startsWith(query)) return 100
  if (title.includes(query)) return 82
  // An exact keyword beats one that merely contains the query, so "gst" opens
  // Taxes rather than Company & Business, which only matches through "gstin".
  if (keywords.includes(query)) return 70
  if (keywords.some((word) => word.includes(query))) return 64
  if (description.includes(query)) return 40
  if (tokens.length > 1 && tokens.every((token) => everything.includes(token))) return 28

  return 0
}

/**
 * Local, synchronous search over the metadata above.
 *
 * No network call: the whole catalogue is in the bundle already, and a settings
 * search that waits on a round trip is a settings search nobody uses. Only what
 * this Billing profile may reach is searched, so a result can never be a page
 * the API would then refuse.
 */
export function searchSettings(term: string, audience: SettingsAudience, limit = 8): SettingsHit[] {
  const query = term.trim().toLowerCase().replace(/\s+/g, ' ')
  if (query.length < 2) return []

  const tokens = query.split(' ').filter((token) => token.length > 1)
  const scored: Array<{ hit: SettingsHit; score: number }> = []

  for (const category of visibleCategories(audience)) {
    const categoryScore = scoreOf(query, tokens, {
      title: category.title,
      keywords: category.keywords,
      description: category.description,
    })

    if (categoryScore > 0) {
      scored.push({
        score: categoryScore,
        hit: {
          key: category.id,
          category,
          child: null,
          label: category.title,
          description: category.description,
          to: category.path,
          child_state: null,
        },
      })
    }

    for (const child of visibleChildren(category, audience)) {
      // Minus one so that, on an equal match, the category a person can browse
      // from sorts above one row inside it.
      const score = scoreOf(query, tokens, {
        title: child.label,
        keywords: child.keywords ?? [],
        description: child.description,
        context: category.title,
      })
      if (score === 0) continue

      scored.push({
        score: score - 1,
        hit: {
          // A `ready` child with a route of its own goes there; everything else
          // opens the category page that explains it.
          key: `${category.id}:${child.key}`,
          category,
          child,
          label: child.label,
          description: child.description,
          to: child.state === 'ready' && child.to ? child.to : category.path,
          child_state: child.state,
          app: child.app,
        },
      })
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || a.hit.label.localeCompare(b.hit.label))
    .slice(0, limit)
    .map((entry) => entry.hit)
}

/** How many results the query has in total, for the "view all" line. */
export function countSettingsMatches(term: string, audience: SettingsAudience): number {
  return searchSettings(term, audience, Number.MAX_SAFE_INTEGER).length
}
