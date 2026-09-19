/**
 * The settings that actually change something.
 *
 * WHAT IS EDITABLE HERE AND WHY IT IS SO FEW. Billing owns its business mode,
 * its timezone, its document defaults, its profiles and its schedules — and
 * nothing else. The company, the branches, the financial year, the items, the
 * ledgers and the tax rates belong to Manage, Inventory and Smart Books, and
 * they are READ here rather than copied into a form this product would then
 * have to keep in step. See docs/ARCHITECTURE.md.
 *
 * So each panel below does one of three honest things:
 *
 *   - edits a real Billing column, behind an explicit Save;
 *   - shows what another product holds, read live, and offers to open it;
 *   - says a capability does not exist, and offers nothing.
 *
 * Nothing auto-saves. Several of these switches change what everybody in the
 * company sees, and a stray click on a toggle is not consent for that.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Check, ExternalLink, TriangleAlert } from 'lucide-react'
import { api, ApiError } from '../../services/api'
import { fetchCompanyInfo } from '../../services/manage'
import type { CompanyInfo } from '../../services/manage'
import type { BillingSettings, CashBankAccount, DueBill, ReminderRule } from '../../services/types'
import { getAppById, launchApp } from '../../services/appLauncher'
import { useApi } from '../../hooks/useApi'
import { useBilling } from '../../context/BillingContext'
import { SettingsDialog } from '../../components/settings/SettingsDialog'
import { date, money, Notice } from '../../ui'

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

/**
 * PUT the changed fields, then reload the session.
 *
 * The reload is not optional: several of these fields decide what the SERVER
 * puts in the menu, and leaving the old menu on screen after changing them is
 * how a user concludes the setting did not save.
 */
function useSettingsSaver() {
  const { reload } = useBilling()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function save(patch: Record<string, unknown>): Promise<boolean> {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await api.put('v1/settings', patch)
      reload()
      setSaved(true)
      return true
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That could not be saved. Please try again.')
      return false
    } finally {
      setSaving(false)
    }
  }

  return { save, saving, error, saved, clear: () => { setError(null); setSaved(false) } }
}

/**
 * Form state that starts from the session and RESETS when the session changes.
 *
 * Without the reset these panels open dirty: the first render happens before
 * `v1/session` has answered, so the form is seeded with the defaults, the real
 * values arrive a moment later, and every field then differs from a "current"
 * the user never touched. It also does the right thing after a save — the
 * saver reloads the session, and the form settles on what was actually stored
 * rather than on what was typed.
 */
function useSyncedForm<T>(initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [form, setForm] = useState<T>(initial)
  useEffect(() => setForm(initial), [initial])

  return [form, setForm]
}

function SaveBar({
  dirty,
  saving,
  saved,
  error,
  onSave,
  onReset,
  disabled = false,
}: {
  dirty: boolean
  saving: boolean
  saved: boolean
  error: string | null
  onSave: () => void
  onReset: () => void
  disabled?: boolean
}) {
  return (
    <>
      {error && (
        <div style={{ marginTop: 12 }}>
          <Notice tone="danger" title="Could not save">{error}</Notice>
        </div>
      )}

      <div className="billing-settings__save">
        <span
          className={`billing-settings__save-note${dirty ? ' billing-settings__save-note--dirty' : ''}`}
          role="status"
        >
          {saving
            ? 'Saving…'
            : dirty
              ? 'Unsaved changes'
              : saved
                ? 'Saved.'
                : disabled
                  ? 'Changing this is not part of your Billing profile.'
                  : ''}
        </span>

        <button type="button" className="billing-button" onClick={onReset} disabled={!dirty || saving}>
          Cancel
        </button>
        <button
          type="button"
          className="billing-button billing-button--primary"
          onClick={onSave}
          disabled={!dirty || saving || disabled}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </>
  )
}

function Choice({
  label,
  pressed,
  onClick,
  disabled,
}: {
  label: string
  pressed: boolean
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className="billing-settings__choice"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="billing-settings__section">
      <h2>{title}</h2>
      {hint && <p>{hint}</p>}
      {children}
    </section>
  )
}

/**
 * What to call another product on this page.
 *
 * The launcher catalogue is copied verbatim from manage-aicountly and must not
 * be edited here, but "Manage Account" is the name of a tile in an app grid,
 * not of the product that owns your company. These are the names this screen
 * uses in a sentence.
 */
const APP_NAMES: Record<string, string> = {
  manage: 'Aicountly Manage',
  books: 'Smart Books',
}

export function appDisplayName(appId: string): string | null {
  const app = getAppById(appId)
  if (!app) return null

  return APP_NAMES[appId] ?? app.name
}

function OpenApp({ appId, label }: { appId: string; label?: string }) {
  const app = getAppById(appId)
  if (!app) return null

  return (
    <button type="button" className="billing-button billing-button--small" onClick={() => launchApp(app, { newTab: true })}>
      {label ?? `Open ${appDisplayName(appId)}`}
      <ExternalLink size={13} aria-hidden />
    </button>
  )
}

/** A yes/no question over one Billing column. */
function SwitchPanel({
  title,
  hint,
  question,
  field,
  yes = 'Yes',
  no = 'No',
}: {
  title: string
  hint?: ReactNode
  question: string
  field: keyof BillingSettings
  yes?: string
  no?: string
}) {
  const { session, can } = useBilling()
  const saver = useSettingsSaver()
  const current = Boolean(session?.settings?.[field])
  const [value, setValue] = useSyncedForm<boolean>(current)
  const mayEdit = can('settings.manage')
  const dirty = value !== current

  return (
    <Section title={title} hint={hint}>
      <div className="billing-settings__form">
        <div>
          <div style={{ fontWeight: 650, fontSize: 13, marginBottom: 8 }}>{question}</div>
          <div className="billing-settings__choices" role="group" aria-label={question}>
            <Choice label={yes} pressed={value} onClick={() => setValue(true)} disabled={!mayEdit} />
            <Choice label={no} pressed={!value} onClick={() => setValue(false)} disabled={!mayEdit} />
          </div>
        </div>
      </div>

      <SaveBar
        dirty={dirty}
        saving={saver.saving}
        saved={saver.saved}
        error={saver.error}
        disabled={!mayEdit}
        onReset={() => { setValue(current); saver.clear() }}
        onSave={() => void saver.save({ [field]: value })}
      />
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Company & Business
// ---------------------------------------------------------------------------

const BUSINESS_TYPES = [
  { value: 'retail', label: 'A shop' },
  { value: 'wholesale', label: 'Wholesale or distribution' },
  { value: 'trading', label: 'Trading' },
  { value: 'service', label: 'Services' },
  { value: 'other', label: 'Something else' },
]

function CompanyFromManage() {
  const { scope } = useBilling()
  const info = useApi<CompanyInfo>(
    (signal) => fetchCompanyInfo(scope!.cmp_id, signal),
    [scope?.cmp_id],
    Boolean(scope),
  )

  return (
    <Section
      title="Your company, as Aicountly Manage holds it"
      hint="Read on this request, never copied. Correct it once in Manage and every AICOUNTLY app follows — Billing keeps only the company, branch and year ids."
    >
      {info.loading && (
        <div className="billing-skeleton-rows" aria-busy="true" style={{ marginTop: 12 }}>
          <span className="billing-sr-only">Reading your company from Aicountly Manage</span>
          <span className="billing-skeleton billing-skeleton--line" />
          <span className="billing-skeleton billing-skeleton--line" />
        </div>
      )}

      {!info.loading && info.error && (
        <div style={{ marginTop: 12 }}>
          <Notice
            tone="warning"
            title="Aicountly Manage did not answer"
            action={<button type="button" className="billing-button billing-button--small" onClick={info.reload}>Try again</button>}
          >
            Your company details could not be read just now. Everything else on this page still works.
          </Notice>
        </div>
      )}

      {!info.loading && info.data && (
        <dl className="billing-settings__facts">
          <dt>Company</dt>
          <dd>{info.data.name || 'Not set in Manage'}</dd>

          <dt>Registered office</dt>
          <dd>
            {info.data.addressLines.length > 0
              ? info.data.addressLines.join(', ')
              : 'No address on file. Documents printed from this company carry none.'}
          </dd>

          <dt>GSTIN</dt>
          <dd>{info.data.gstin || 'Not recorded'}</dd>

          <dt>Branches</dt>
          <dd>
            {info.data.branches.length > 0
              ? info.data.branches.map((branch) => branch.name).join(', ')
              : 'Only the head office'}
          </dd>

          <dt>Financial years</dt>
          <dd>
            {info.data.fyList.length > 0
              ? info.data.fyList.map((fy) => fy.label).join(', ')
              : 'None open'}
          </dd>
        </dl>
      )}

      <div style={{ marginTop: 14 }}>
        <OpenApp appId="manage" label="Edit in Aicountly Manage" />
      </div>
    </Section>
  )
}

function BusinessDefaults() {
  const { session, can } = useBilling()
  const saver = useSettingsSaver()
  const settings = session?.settings ?? null
  const mayEdit = can('settings.manage')

  const initial = useMemo(
    () => ({
      business_type: settings?.business_type ?? 'retail',
      needs_purchase: settings?.needs_purchase ?? true,
      needs_payables: settings?.needs_payables ?? true,
      maintains_stock: settings?.maintains_stock ?? true,
      needs_bank_cash: settings?.needs_bank_cash ?? true,
    }),
    [settings],
  )
  const [form, setForm] = useSyncedForm(initial)
  const dirty = (Object.keys(initial) as Array<keyof typeof initial>).some((key) => form[key] !== initial[key])

  return (
    <Section
      title="Business defaults"
      hint="These decide what appears in the menu for everybody in this company. They create no account, no item and no entry, and nothing is irreversible."
    >
      <div className="billing-settings__form">
        <div>
          <div style={{ fontWeight: 650, fontSize: 13, marginBottom: 8 }}>What sort of business is this?</div>
          <div className="billing-settings__choices" role="group" aria-label="Business type">
            {BUSINESS_TYPES.map((option) => (
              <Choice
                key={option.value}
                label={option.label}
                pressed={form.business_type === option.value}
                disabled={!mayEdit}
                onClick={() => setForm({ ...form, business_type: option.value })}
              />
            ))}
          </div>
        </div>

        {([
          ['needs_purchase', 'Record purchases here?'],
          ['needs_payables', 'Track what you owe suppliers?'],
          ['maintains_stock', 'Keep stock here?'],
          ['needs_bank_cash', 'Track cash and bank here?'],
        ] as const).map(([key, question]) => (
          <div key={key}>
            <div style={{ fontWeight: 650, fontSize: 13, marginBottom: 8 }}>{question}</div>
            <div className="billing-settings__choices" role="group" aria-label={question}>
              <Choice label="Yes" pressed={form[key] === true} disabled={!mayEdit} onClick={() => setForm({ ...form, [key]: true })} />
              <Choice label="No" pressed={form[key] === false} disabled={!mayEdit} onClick={() => setForm({ ...form, [key]: false })} />
            </div>
          </div>
        ))}
      </div>

      <SaveBar
        dirty={dirty}
        saving={saver.saving}
        saved={saver.saved}
        error={saver.error}
        disabled={!mayEdit}
        onReset={() => { setForm(initial); saver.clear() }}
        onSave={() => void saver.save(form)}
      />
    </Section>
  )
}

export function CompanyPanels() {
  return (
    <>
      <CompanyFromManage />
      <BusinessDefaults />
    </>
  )
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export function DocumentPanels() {
  const { session, can } = useBilling()
  const saver = useSettingsSaver()
  const settings = session?.settings ?? null
  const mayEdit = can('settings.manage')

  const initial = useMemo(
    () => ({
      default_sale_terms: settings?.default_sale_terms ?? '',
      default_payment_terms: settings?.default_payment_terms ?? '',
    }),
    [settings],
  )
  const [form, setForm] = useSyncedForm(initial)
  const dirty = form.default_sale_terms !== initial.default_sale_terms || form.default_payment_terms !== initial.default_payment_terms

  return (
    <>
      <Section
        title="What every bill starts with"
        hint="The two lines Billing owns. The number on the document, its layout and its print template come from Smart Books, which creates the voucher."
      >
        <div className="billing-settings__form">
          <div className="billing-field">
            <label htmlFor="set-sale-terms">Terms and conditions</label>
            <textarea
              id="set-sale-terms"
              rows={3}
              disabled={!mayEdit}
              value={form.default_sale_terms}
              placeholder="Goods once sold will not be taken back."
              onChange={(event) => setForm({ ...form, default_sale_terms: event.target.value })}
            />
            <span className="billing-field__hint">Printed on a new bill unless it is changed on that bill.</span>
          </div>

          <div className="billing-field">
            <label htmlFor="set-payment-terms">Payment terms</label>
            <input
              id="set-payment-terms"
              type="text"
              disabled={!mayEdit}
              value={form.default_payment_terms}
              placeholder="Payment within 30 days"
              onChange={(event) => setForm({ ...form, default_payment_terms: event.target.value })}
            />
            <span className="billing-field__hint">How long a customer normally gets to pay.</span>
          </div>
        </div>

        <SaveBar
          dirty={dirty}
          saving={saver.saving}
          saved={saver.saved}
          error={saver.error}
          disabled={!mayEdit}
          onReset={() => { setForm(initial); saver.clear() }}
          onSave={() => void saver.save({
            default_sale_terms: form.default_sale_terms.trim() || null,
            default_payment_terms: form.default_payment_terms.trim() || null,
          })}
        />
      </Section>

      <Section
        title="Numbering, templates and print"
        hint="Billing sends no document number and no layout. Smart Books numbers the voucher and prints it, so paper raised here and paper raised there are the same document."
      >
        <div style={{ marginTop: 12 }}>
          <OpenApp appId="books" label="Open Smart Books" />
        </div>
      </Section>
    </>
  )
}

// ---------------------------------------------------------------------------
// Taxes
// ---------------------------------------------------------------------------

export function TaxPanels() {
  const { scope, can, session } = useBilling()

  const categories = useApi(
    (signal) => api.get<{ data?: unknown[] }>('v1/catalog/tax-categories', undefined, signal),
    [scope?.cmp_id],
    Boolean(scope),
  )
  const count = Array.isArray(categories.data?.data) ? categories.data.data.length : null

  return (
    <>
      <SwitchPanel
        title="GST registration"
        field="gst_registered"
        question="Is this business registered for GST?"
        hint="It decides what the bill screens ask for. The GSTIN itself is the company master and lives in Aicountly Manage."
      />

      <Section
        title="Rates, categories and rounding"
        hint="Smart Books computes the tax on every bill from its own tax categories. Billing sends no tax figure at all, which is why there is nothing to set here."
      >
        <p style={{ margin: '12px 0 0', fontSize: 13 }} role="status">
          {categories.loading
            ? 'Asking Smart Books…'
            : categories.error
              ? 'Smart Books did not answer, so the tax categories could not be counted.'
              : count === null
                ? 'Smart Books answered in a shape this screen does not read; open it to see the categories.'
                : `${count} tax ${count === 1 ? 'category' : 'categories'} available to this company.`}
        </p>
        <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <OpenApp appId="books" label="Manage tax categories" />
          {categories.error && (
            <button type="button" className="billing-button billing-button--small" onClick={categories.reload}>
              Try again
            </button>
          )}
        </div>
      </Section>

      <Section
        title="e-Invoice and e-Way Bill"
        hint="Generated per document, from the bill itself, once it has reached Smart Books. Books talks to the government portal, holds the credentials and keeps the IRN."
      >
        <p style={{ margin: '12px 0 0', fontSize: 13 }}>
          {can('einvoice.generate') || can('eway.generate') ? (
            <>
              Your Billing profile may generate{' '}
              {[can('einvoice.generate') ? 'an e-Invoice' : null, can('eway.generate') ? 'an e-Way Bill' : null]
                .filter(Boolean)
                .join(' and ')}
              . Open any saved bill and the buttons are on it.
            </>
          ) : (
            'Generating an e-Invoice or an e-Way Bill is not part of your Billing profile.'
          )}
        </p>
        {session?.settings.gst_registered === false && (
          <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--billing-muted)' }}>
            This business is marked as not registered for GST, so neither applies.
          </p>
        )}
      </Section>
    </>
  )
}

// ---------------------------------------------------------------------------
// Payment & banking
// ---------------------------------------------------------------------------

export function PaymentPanels() {
  const { scope, can, session } = useBilling()
  const mayRead = can('bank.view') || can('cash.view') || can('contra.create')
  const uses = session?.settings.needs_bank_cash !== false

  const accounts = useApi(
    (signal) => api.list<CashBankAccount>('v1/catalog/cash-bank', undefined, signal),
    [scope?.cmp_id],
    Boolean(scope) && mayRead && uses,
  )
  const rows = accounts.data?.data ?? []

  return (
    <>
      <SwitchPanel
        title="Cash and bank"
        field="needs_bank_cash"
        question="Track cash and bank in Billing?"
        hint="Turning this off hides the money screens for everybody in this company. It deletes nothing — the accounts stay in Smart Books."
      />

      {uses && (
        <Section
          title="Accounts money can land in"
          hint="Ledgers in Smart Books, read live. Billing holds no bank account, no IFSC and no balance of its own."
        >
          {!mayRead && (
            <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--billing-muted)' }}>
              Your Billing profile does not show cash or bank balances.
            </p>
          )}

          {mayRead && accounts.loading && (
            <div className="billing-skeleton-rows" aria-busy="true" style={{ marginTop: 12 }}>
              <span className="billing-sr-only">Reading your accounts from Smart Books</span>
              <span className="billing-skeleton billing-skeleton--line" />
            </div>
          )}

          {mayRead && !accounts.loading && accounts.error && (
            <div style={{ marginTop: 12 }}>
              <Notice
                tone="warning"
                title="Smart Books did not answer"
                action={<button type="button" className="billing-button billing-button--small" onClick={accounts.reload}>Try again</button>}
              >
                The account list could not be read just now.
              </Notice>
            </div>
          )}

          {mayRead && !accounts.loading && !accounts.error && (
            <p style={{ margin: '12px 0 0', fontSize: 13 }}>
              {rows.length === 0
                ? 'No cash or bank account exists in Smart Books yet. Money cannot be recorded until one does.'
                : `${rows.length} available: ${rows.slice(0, 6).map((row) => row.acc_name).join(', ')}${rows.length > 6 ? '…' : ''}`}
            </p>
          )}

          <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <OpenApp appId="books" label="Add or edit an account" />
            {can('bank.view') && (
              <Link className="billing-button billing-button--small" to="/bank-cash">
                See balances
              </Link>
            )}
          </div>
        </Section>
      )}

      <Section
        title="Collecting payments"
        hint="Billing records money that has already moved — a receipt is an accounting voucher in Smart Books, not an instruction to a bank."
      >
        <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--billing-muted)' }}>
          No payment gateway, payment link or settlement account is wired to this deployment, so there is nothing to
          connect here yet. When one is, it arrives beside the existing payment methods rather than replacing them.
        </p>
      </Section>
    </>
  )
}

// ---------------------------------------------------------------------------
// General preferences
// ---------------------------------------------------------------------------

/** The browser's own zone list where it has one, and a short list where it does not. */
function timezoneOptions(current: string): string[] {
  const fallback = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC']
  const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
  let list = fallback

  try {
    const zones = typeof supported === 'function' ? supported('timeZone') : null
    if (Array.isArray(zones) && zones.length > 0) list = zones
  } catch {
    // An engine that knows the method but not this key. The short list stands.
  }

  return list.includes(current) || current === '' ? list : [current, ...list]
}

export function PreferencePanels() {
  const { session, can } = useBilling()
  const saver = useSettingsSaver()
  const mayEdit = can('settings.manage')
  const current = session?.settings.timezone ?? 'Asia/Kolkata'
  const [zone, setZone] = useSyncedForm(current)
  const zones = useMemo(() => timezoneOptions(current), [current])

  return (
    <>
      <Section
        title="Time zone"
        hint="Whose day “today” means. A shop trading at 9pm in Kolkata is not on tomorrow because a UTC server is — every dashboard, day close and due date is worked out in this zone."
      >
        <div className="billing-settings__form">
          <div className="billing-field">
            <label htmlFor="set-timezone">Business time zone</label>
            <select
              id="set-timezone"
              value={zone}
              disabled={!mayEdit}
              onChange={(event) => setZone(event.target.value)}
            >
              {zones.map((option) => (
                <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <span className="billing-field__hint">
              It is now {new Intl.DateTimeFormat('en-IN', { timeStyle: 'short', dateStyle: 'medium', timeZone: safeZone(zone) }).format(new Date())} there.
            </span>
          </div>
        </div>

        <SaveBar
          dirty={zone !== current}
          saving={saver.saving}
          saved={saver.saved}
          error={saver.error}
          disabled={!mayEdit}
          onReset={() => { setZone(current); saver.clear() }}
          onSave={() => void saver.save({ timezone: zone })}
        />
      </Section>

      <Section
        title="Where you land"
        hint="Decided on the server from your Billing profile, so this app can never offer a screen its own API would refuse."
      >
        <dl className="billing-settings__facts">
          <dt>Your landing screen</dt>
          <dd>{session?.landing ?? 'Not decided yet'}</dd>
          <dt>Screens you may open</dt>
          <dd>{(session?.dashboards ?? []).map((entry) => entry.label).join(', ') || 'None'}</dd>
        </dl>
      </Section>

      <Section
        title="Dates, numbers and language"
        hint="Amounts are grouped the Indian way (1,23,456.78) and carry the currency of the document they came from, everywhere in the app."
      >
        <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--billing-muted)' }}>
          None of that is configurable in this release, and there is no second language yet. It is written here rather
          than offered as a setting that would not save.
        </p>
      </Section>
    </>
  )
}

/** Never hand an unvalidated zone to Intl — a bad one throws and blanks the page. */
function safeZone(zone: string): string | undefined {
  try {
    new Intl.DateTimeFormat('en-IN', { timeZone: zone })
    return zone
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export function ItemPanels() {
  return (
    <>
      <SwitchPanel
        title="Stock"
        field="maintains_stock"
        question="Keep stock in Billing?"
        hint="Turning this off hides the item and stock screens for this company. Inventory is untouched either way — nothing is deleted there."
      />

      <Section
        title="Items, units, categories and HSN"
        hint="An item belongs to Aicountly Inventory. Billing reads it on the request that draws it and stores no copy, so an item corrected there is corrected here on the next keystroke."
      >
        <div style={{ marginTop: 12 }}>
          <OpenApp appId="inventory" label="Open Inventory" />
        </div>
      </Section>
    </>
  )
}

// ---------------------------------------------------------------------------
// Automation
// ---------------------------------------------------------------------------

const CHANNELS = [
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'sms', label: 'SMS' },
]

export function AutomationPanels() {
  const { scope, can } = useBilling()
  const mayManage = can('recurring.manage')

  const rules = useApi(
    (signal) => api.get<{ data: ReminderRule[] }>('v1/reminders', undefined, signal),
    [scope?.cmp_id],
    Boolean(scope) && mayManage,
  )

  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ rule_name: '', offset_days: '3', channel: 'email', minimum_amount: '0' })
  const [candidatesFor, setCandidatesFor] = useState<ReminderRule | null>(null)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      await api.post('v1/reminders', {
        rule_name: form.rule_name.trim(),
        // The column is relative to the due date: negative is before it,
        // positive after. The form asks the question the shopkeeper asks.
        offset_days: Number(form.offset_days || 0),
        repeat_days: 0,
        max_reminders: 3,
        channel: form.channel,
        minimum_amount: Number(form.minimum_amount || 0),
      })
      setAdding(false)
      setForm({ rule_name: '', offset_days: '3', channel: 'email', minimum_amount: '0' })
      rules.reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That rule could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  if (!mayManage) {
    return (
      <Section title="Automation">
        <div style={{ marginTop: 12 }}>
          <Notice tone="info">Recurring bills and payment reminders are not part of your Billing profile.</Notice>
        </div>
      </Section>
    )
  }

  const rows = rules.data?.data ?? []

  return (
    <>
      <Section
        title="Payment reminders"
        hint="A rule decides when an overdue bill gets chased. Before anything is sent, what is still outstanding is read from Smart Books — a reminder chasing a bill paid last week is worse than no reminder."
      >
        {rules.loading && (
          <div className="billing-skeleton-rows" aria-busy="true" style={{ marginTop: 12 }}>
            <span className="billing-sr-only">Reading your reminder rules</span>
            <span className="billing-skeleton billing-skeleton--line" />
          </div>
        )}

        {!rules.loading && rules.error && (
          <div style={{ marginTop: 12 }}>
            <Notice
              tone="warning"
              title="Could not read your reminder rules"
              action={<button type="button" className="billing-button billing-button--small" onClick={rules.reload}>Try again</button>}
            >
              {rules.error}
            </Notice>
          </div>
        )}

        {!rules.loading && !rules.error && (
          <div className="billing-settings__rows">
            {rows.length === 0 && (
              <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--billing-muted)' }}>
                No rule yet, so nothing decides when a customer is chased.
              </p>
            )}

            {rows.map((rule) => (
              <div key={rule.rule_id} className="billing-settings__row">
                <span style={{ minWidth: 0 }}>
                  <strong>{rule.rule_name}</strong>
                  <p>
                    {rule.offset_days === 0
                      ? 'On the due date'
                      : rule.offset_days < 0
                        ? `${Math.abs(rule.offset_days)} days before the due date`
                        : `${rule.offset_days} days after the due date`}
                    {' · '}
                    {CHANNELS.find((channel) => channel.value === rule.channel)?.label ?? rule.channel}
                    {Number(rule.minimum_amount) > 0 ? ` · nothing under ${money(rule.minimum_amount)}` : ''}
                    {rule.max_reminders > 0 ? ` · at most ${rule.max_reminders}` : ''}
                  </p>
                </span>
                <span className="billing-settings__row-end">
                  <span className={`billing-settings__tag ${rule.is_active ? 'billing-settings__tag--ok' : 'billing-settings__tag--planned'}`}>
                    {rule.is_active ? 'Active' : 'Paused'}
                  </span>
                  {can('reminder.send') && (
                    <button
                      type="button"
                      className="billing-button billing-button--small"
                      onClick={() => setCandidatesFor(rule)}
                    >
                      Who it chases today
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div style={{ marginTop: 12 }}>
            <Notice tone="danger" title="Could not save" onDismiss={() => setError(null)}>{error}</Notice>
          </div>
        )}

        {adding ? (
          <div className="billing-settings__form">
            <div className="billing-field">
              <label htmlFor="rem-name">What to call this rule</label>
              <input
                id="rem-name"
                value={form.rule_name}
                placeholder="Chase three days late"
                onChange={(event) => setForm({ ...form, rule_name: event.target.value })}
              />
            </div>
            <div className="billing-field">
              <label htmlFor="rem-offset">Days after the due date</label>
              <input
                id="rem-offset"
                type="number"
                inputMode="numeric"
                value={form.offset_days}
                onChange={(event) => setForm({ ...form, offset_days: event.target.value })}
              />
              <span className="billing-field__hint">A negative number chases before the bill is due.</span>
            </div>
            <div className="billing-field">
              <label htmlFor="rem-channel">How</label>
              <select id="rem-channel" value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value })}>
                {CHANNELS.map((channel) => (
                  <option key={channel.value} value={channel.value}>{channel.label}</option>
                ))}
              </select>
              <span className="billing-field__hint">
                Nothing is sent automatically — no messaging channel is wired to this deployment. The rule decides who
                appears on your chase list.
              </span>
            </div>
            <div className="billing-field">
              <label htmlFor="rem-min">Smallest amount worth chasing</label>
              <input
                id="rem-min"
                inputMode="decimal"
                value={form.minimum_amount}
                onChange={(event) => setForm({ ...form, minimum_amount: event.target.value })}
              />
            </div>

            <div className="billing-settings__save">
              <span className="billing-settings__save-note" role="status">{busy ? 'Saving…' : ''}</span>
              <button type="button" className="billing-button" onClick={() => { setAdding(false); setError(null) }} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="billing-button billing-button--primary"
                disabled={busy || form.rule_name.trim() === ''}
                onClick={() => void create()}
              >
                {busy ? 'Saving…' : 'Add reminder rule'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 14 }}>
            <button type="button" className="billing-button billing-button--small" onClick={() => setAdding(true)}>
              Add a reminder rule
            </button>
          </div>
        )}
      </Section>

      <Section
        title="Recurring bills"
        hint="A rule that raises a real invoice in Smart Books when its date comes round. Billing never makes an invoice of its own and pushes it later."
      >
        <div style={{ marginTop: 12 }}>
          <Link className="billing-button billing-button--small" to="/more/recurring">Open recurring bills</Link>
        </div>
      </Section>

      {candidatesFor && <CandidatesDialog rule={candidatesFor} onClose={() => setCandidatesFor(null)} />}
    </>
  )
}

/** Who a rule would chase, worked out from Books' current outstanding. */
function CandidatesDialog({ rule, onClose }: { rule: ReminderRule; onClose: () => void }) {
  const { scope } = useBilling()
  const result = useApi(
    (signal) =>
      api.one<{ candidates: Array<DueBill & { reminders_sent: number }>; note: string }>(
        `v1/reminders/${rule.rule_id}/candidates`,
        undefined,
        signal,
      ),
    [rule.rule_id, scope?.cmp_id],
    Boolean(scope),
  )

  const candidates = result.data?.data.candidates ?? []

  return (
    <SettingsDialog
      title={rule.rule_name}
      description="Who this rule would chase today."
      onClose={onClose}
      actions={
        <button type="button" className="billing-button billing-button--primary" onClick={onClose}>Close</button>
      }
    >
      {result.loading && <p style={{ marginTop: 14, color: 'var(--billing-muted)', fontSize: 13 }}>Asking Smart Books…</p>}

      {!result.loading && result.error && (
        <div style={{ marginTop: 14 }}>
          <Notice tone="warning" title="Could not work that out">{result.error}</Notice>
        </div>
      )}

      {!result.loading && !result.error && (
        <>
          <p style={{ marginTop: 14, fontSize: 13 }}>
            {candidates.length === 0
              ? 'Nobody. Nothing outstanding matches this rule right now.'
              : `${candidates.length} ${candidates.length === 1 ? 'bill' : 'bills'}.`}
          </p>
          {candidates.length > 0 && (
            <ul style={{ margin: '10px 0 0', paddingLeft: '1.1rem', fontSize: 13, lineHeight: 1.7 }}>
              {candidates.slice(0, 10).map((bill, index) => (
                <li key={`${bill.voucher_uuid ?? bill.bill_no ?? index}`}>
                  {bill.account_name} — {money(bill.balance)}
                  {bill.due_date ? `, due ${date(bill.due_date)}` : ''}
                </li>
              ))}
            </ul>
          )}
          <p style={{ margin: '12px 0 0', color: 'var(--billing-muted)', fontSize: 12, lineHeight: 1.5 }}>
            {result.data?.data.note}
          </p>
        </>
      )}
    </SettingsDialog>
  )
}

// ---------------------------------------------------------------------------
// Integrations
// ---------------------------------------------------------------------------

type ProbeState = 'checking' | 'connected' | 'issue' | 'skipped'

function StatusTag({ state, detail }: { state: ProbeState; detail?: string | null }) {
  const label =
    state === 'checking' ? 'Checking…'
      : state === 'connected' ? 'Connected'
      : state === 'issue' ? 'Issue detected'
      : 'Not checked'

  const tone =
    state === 'connected' ? 'billing-settings__tag--ok'
      : state === 'issue' ? 'billing-settings__tag--danger'
      : 'billing-settings__tag--planned'

  return (
    <span className="billing-settings__row-end">
      <span className={`billing-settings__tag ${tone}`} title={detail ?? undefined}>
        {state === 'connected' && <Check size={12} aria-hidden />}
        {state === 'issue' && <TriangleAlert size={12} aria-hidden />}
        {label}
      </span>
    </span>
  )
}

/**
 * Real reachability, or nothing.
 *
 * Each row below is a live call to the product it names, made when this page
 * opens. A row is "Connected" because a request to that product answered on
 * this page load — never because it is configured, and never as decoration.
 * Anything with no probe says so rather than borrowing a green tick.
 */
export function IntegrationPanels() {
  const { scope, can, session } = useBilling()
  const usesStock = session?.settings.maintains_stock !== false

  const manage = useApi<CompanyInfo>(
    (signal) => fetchCompanyInfo(scope!.cmp_id, signal),
    [scope?.cmp_id],
    Boolean(scope),
  )

  const books = useApi(
    (signal) => api.get<{ data?: unknown[] }>('v1/catalog/tax-categories', undefined, signal),
    [scope?.cmp_id],
    Boolean(scope),
  )

  const inventory = useApi(
    (signal) => api.get<{ data?: unknown[] }>('v1/catalog/items', { limit: 1 }, signal),
    [scope?.cmp_id],
    Boolean(scope) && usesStock && can('sale.view'),
  )

  function stateOf(probe: { loading: boolean; error: string | null; data: unknown }, enabled = true): ProbeState {
    if (!enabled) return 'skipped'
    if (probe.loading) return 'checking'
    if (probe.error) return 'issue'
    return probe.data === null ? 'skipped' : 'connected'
  }

  const live = [
    {
      key: 'books',
      app: 'books',
      label: 'Smart Books',
      detail: 'Creates every voucher Billing raises, and answers every figure it shows.',
      state: stateOf(books),
      error: books.error,
      retry: books.reload,
    },
    {
      key: 'manage',
      app: 'manage',
      label: 'Aicountly Manage',
      detail: 'Owns the company, its branches and its financial years.',
      state: stateOf(manage),
      error: manage.error,
      retry: manage.reload,
    },
    {
      key: 'inventory',
      app: 'inventory',
      label: 'Inventory',
      detail: usesStock
        ? 'Items, stock and cost, read live.'
        : 'This business does not keep stock in Billing, so Inventory is not called.',
      state: stateOf(inventory, usesStock && can('sale.view')),
      error: inventory.error,
      retry: inventory.reload,
    },
  ]

  return (
    <>
      <Section
        title="The products Billing reads from"
        hint="Checked on this page load by calling each one. A tick means it answered just now, not that somebody once ticked a box."
      >
        <div className="billing-settings__rows">
          {live.map((row) => (
            <div key={row.key} className="billing-settings__row">
              <span style={{ minWidth: 0 }}>
                <strong>{row.label}</strong>
                <p>{row.state === 'issue' && row.error ? row.error : row.detail}</p>
              </span>
              <span className="billing-settings__row-end">
                <StatusTag state={row.state} detail={row.error} />
                {row.state === 'issue' && (
                  <button type="button" className="billing-button billing-button--small" onClick={row.retry}>
                    Try again
                  </button>
                )}
                <OpenApp appId={row.app} label="Open" />
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="e-Invoice and e-Way Bill"
        hint="Smart Books talks to the government portal and holds the credentials. Billing asks it per document, so there is no separate connection to make here."
      >
        <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--billing-muted)' }}>
          The live status of a particular document is on that document, because that is the only place it means
          anything.
        </p>
      </Section>

      <Section
        title="Not connected to anything"
        hint="Stated rather than drawn as a switch, so nothing here looks like it is one configuration step away from working."
      >
        <div className="billing-settings__rows">
          {[
            ['Email, WhatsApp and SMS', 'No messaging channel is wired to this deployment, so Billing cannot send a document or a reminder.'],
            ['Payment gateway', 'Billing records money that has already moved. It holds no gateway, payment link or settlement state.'],
            ['API access and webhooks', 'Billing publishes no public API key and fires no webhook of its own.'],
          ].map(([label, detail]) => (
            <div key={label} className="billing-settings__row billing-settings__row--planned">
              <span style={{ minWidth: 0 }}>
                <strong>{label}</strong>
                <p>{detail}</p>
              </span>
              <span className="billing-settings__row-end">
                <span className="billing-settings__tag billing-settings__tag--planned">Not available</span>
              </span>
            </div>
          ))}
        </div>
      </Section>
    </>
  )
}

/**
 * Integrations is the one category whose panels above ARE the full list — each
 * child is either a product with a live status or a stated absence — so the
 * generic "everything in this category" list underneath would say all of it a
 * second time.
 */
export function panelsCoverEverything(categoryId: string): boolean {
  return categoryId === 'integrations'
}

// ---------------------------------------------------------------------------
// Advanced
// ---------------------------------------------------------------------------

const MODES: Array<{ value: BillingSettings['business_mode']; label: string; detail: string }> = [
  { value: 'micro', label: 'Micro', detail: 'Bills and receipts only. No purchases, no bank.' },
  { value: 'trader', label: 'Trader', detail: 'Buying and selling, with stock and dues.' },
  { value: 'retail', label: 'Retail', detail: 'A counter shop.' },
  { value: 'service', label: 'Service', detail: 'Services, usually without stock.' },
  { value: 'owner', label: 'Owner', detail: 'Everything this product offers.' },
]

export function AdvancedPanels() {
  const { session, can } = useBilling()
  const saver = useSettingsSaver()
  const rerun = useSettingsSaver()
  const mayEdit = can('settings.manage')
  const current = session?.settings.business_mode ?? 'trader'
  const [mode, setMode] = useSyncedForm<BillingSettings['business_mode']>(current)
  const [confirming, setConfirming] = useState(false)

  return (
    <>
      <Section
        title="Business mode"
        hint="The shape of the whole app for this company. It is here rather than on the first page because changing it changes what every person in this company sees on their next screen."
      >
        <div className="billing-settings__form">
          <div className="billing-settings__choices" role="group" aria-label="Business mode">
            {MODES.map((option) => (
              <Choice
                key={option.value}
                label={option.label}
                pressed={mode === option.value}
                disabled={!mayEdit}
                onClick={() => setMode(option.value)}
              />
            ))}
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--billing-muted)' }}>
            {MODES.find((option) => option.value === mode)?.detail}
          </p>
        </div>

        <SaveBar
          dirty={mode !== current}
          saving={saver.saving}
          saved={saver.saved}
          error={saver.error}
          disabled={!mayEdit}
          onReset={() => { setMode(current); saver.clear() }}
          onSave={() => void saver.save({ business_mode: mode })}
        />
      </Section>

      <Section
        title="Run the setup questions again"
        hint="The five questions an owner answers the first time. They create no account, no item and no entry — they only decide what is on the menu."
      >
        <div style={{ marginTop: 14 }}>
          <button
            type="button"
            className="billing-button"
            disabled={!mayEdit || rerun.saving}
            style={{ borderColor: 'var(--billing-warning)', color: 'var(--billing-warning)' }}
            onClick={() => setConfirming(true)}
          >
            Ask the setup questions again
          </button>
        </div>

        {rerun.error && (
          <div style={{ marginTop: 12 }}>
            <Notice tone="danger" title="Could not do that">{rerun.error}</Notice>
          </div>
        )}
      </Section>

      <Section
        title="Custom fields, approvals and developer options"
        hint="None of these exist in Billing. An extra field on a bill would have to exist in Smart Books first, and this product has no developer console, API key or feature flag."
      >
        <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--billing-muted)' }}>
          Listed here so the absence is visible, rather than left as a menu entry that opens an empty page.
        </p>
      </Section>

      {confirming && (
        <SettingsDialog
          title="Ask the setup questions again?"
          description="The next time an owner opens Billing, the five setup questions appear before the dashboard — for everybody in this company, not only for you."
          onClose={() => setConfirming(false)}
          actions={
            <>
              <button type="button" className="billing-button" onClick={() => setConfirming(false)}>
                Leave it as it is
              </button>
              <button
                type="button"
                className="billing-button"
                disabled={rerun.saving}
                style={{ background: 'var(--billing-warning-bg)', borderColor: 'var(--billing-warning)', color: 'var(--billing-warning)' }}
                onClick={async () => {
                  const done = await rerun.save({ onboarding_done: false })
                  if (done) setConfirming(false)
                }}
              >
                {rerun.saving ? 'Working…' : 'Yes, ask them again'}
              </button>
            </>
          }
        >
          <p style={{ margin: '14px 0 0', fontSize: 13, lineHeight: 1.6 }}>
            Nothing is deleted and no entry is touched. The answers decide which screens appear, and every one of them
            can be changed here afterwards.
          </p>
        </SettingsDialog>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------

/** The interactive block for a category, where it has one. */
export function panelsFor(categoryId: string): ReactNode {
  switch (categoryId) {
    case 'company': return <CompanyPanels />
    case 'documents': return <DocumentPanels />
    case 'taxes': return <TaxPanels />
    case 'payments': return <PaymentPanels />
    case 'preferences': return <PreferencePanels />
    case 'items': return <ItemPanels />
    case 'automation': return <AutomationPanels />
    case 'integrations': return <IntegrationPanels />
    case 'advanced': return <AdvancedPanels />
    default: return null
  }
}
