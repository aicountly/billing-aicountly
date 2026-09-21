/**
 * The GST facts this screen can work out for itself, and nothing beyond them.
 *
 * SMART BOOKS REMAINS THE TAX AUTHORITY. What is here derives a PREVIEW — which
 * way the tax splits, and roughly how much — from two things that are already
 * live on the page: the state codes inside the two GSTINs, and the rate on the
 * tax category the user picked from Books' own master. Both are read, neither
 * is invented, and the figures are labelled as an estimate everywhere they are
 * shown because the voucher Books posts is the one that counts.
 *
 * The state table is statutory. These are the GST state codes published in the
 * Act — the first two digits of every GSTIN — not a list of anybody's data.
 */

/** GST state code → state or union territory. */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
  '99': 'Centre Jurisdiction',
}

export interface GstState {
  code: string
  name: string
  /** "Maharashtra (27)" — how a GST state is written on an Indian invoice. */
  label: string
}

/** The state a GSTIN belongs to, or null when there is no usable GSTIN. */
export function stateFromGstin(gstin: string | null | undefined): GstState | null {
  const trimmed = (gstin ?? '').trim().toUpperCase()
  if (trimmed.length < 2) return null

  const code = trimmed.slice(0, 2)
  const name = GST_STATES[code]
  if (!name) return null

  return { code, name, label: `${name} (${code})` }
}

export type GstTreatment = 'intrastate' | 'interstate' | 'no_gst' | 'unknown'

export interface GstMode {
  treatment: GstTreatment
  /** What the context strip shows. */
  label: string
  /** How the tax splits, in the words used on an invoice. */
  splitLabel: string
  /** Why, in one line, for the tooltip. */
  reason: string
  /** Where the supply lands. Null when no GSTIN told us. */
  placeOfSupply: GstState | null
  supplierState: GstState | null
  companyState: GstState | null
}

/**
 * Which way the tax splits on this bill.
 *
 * Supplier and recipient in one state is CGST + SGST; across two it is IGST.
 * Both states come from the first two digits of the respective GSTINs, which is
 * exactly where the law puts them. When either GSTIN is missing the answer is
 * "unknown" and the screen says so rather than guessing a split — a wrong guess
 * here is a wrong return, and Books would overrule it on save anyway.
 */
export function resolveGstMode(input: {
  gstRegistered: boolean
  companyGstin: string | null | undefined
  supplierGstin: string | null | undefined
  /** False before anybody has been chosen — a different sentence from "no GSTIN". */
  supplierChosen: boolean
}): GstMode {
  const companyState = stateFromGstin(input.companyGstin)
  const supplierState = stateFromGstin(input.supplierGstin)

  if (!input.gstRegistered) {
    return {
      treatment: 'no_gst',
      label: 'Not registered (No GST)',
      splitLabel: 'No GST',
      reason: 'This company is not registered under GST in its Billing settings.',
      placeOfSupply: companyState,
      supplierState,
      companyState,
    }
  }

  if (!companyState || !supplierState) {
    return {
      treatment: 'unknown',
      label: 'Regular (With GST)',
      splitLabel: 'Not known yet',
      reason: !companyState
        ? 'Add this company’s GSTIN in Aicountly Manage to see the CGST/SGST or IGST split here.'
        : !input.supplierChosen
          ? 'Choose the supplier and the CGST/SGST or IGST split appears here.'
          : 'This supplier has no GSTIN on their Books account, so the split cannot be worked out here.',
      placeOfSupply: companyState,
      supplierState,
      companyState,
    }
  }

  const sameState = companyState.code === supplierState.code

  return {
    treatment: sameState ? 'intrastate' : 'interstate',
    label: sameState ? 'Regular · CGST + SGST' : 'Regular · IGST',
    splitLabel: sameState ? 'CGST + SGST (within state)' : 'IGST (across states)',
    reason: sameState
      ? `Supplier and your company are both in ${companyState.name}, so the tax splits into CGST and SGST.`
      : `Supplier is in ${supplierState.name} and your company in ${companyState.name}, so the tax is IGST.`,
    placeOfSupply: companyState,
    supplierState,
    companyState,
  }
}

// ---------------------------------------------------------------------------
// Tax categories — Books' master, read as it comes
// ---------------------------------------------------------------------------

export interface TaxRate {
  /** `tax_cat_id`, the value the backend stores on the line. */
  id: number
  name: string
  /** Total GST percentage, or null when the master did not state one. */
  rate: number | null
}

function firstNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key]
    if (value === null || value === undefined || value === '') continue
    const parsed = typeof value === 'number' ? value : Number(String(value).trim())
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function firstText(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number') return String(value)
  }
  return ''
}

/**
 * One row of Books' tax-category master, however this deployment spells it.
 *
 * Books is the master and its field names have moved over the years, so every
 * spelling seen in the fleet is read rather than one being assumed. When no
 * rate can be read the rate is null — and a null rate means this screen shows
 * no tax estimate at all, rather than the 18% that would be wrong for half the
 * country's goods.
 */
export function parseTaxRate(row: unknown): TaxRate | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null
  const record = row as Record<string, unknown>

  const id = firstNumber(record, ['tax_cat_id', 'taxcat_id', 'id', 'tax_category_id'])
  if (id === null || id <= 0) return null

  const name = firstText(record, ['tax_cat_name', 'name', 'tax_category', 'label', 'description'])

  let rate = firstNumber(record, [
    'rate',
    'tax_rate',
    'gst_rate',
    'total_rate',
    'percentage',
    'tax_percent',
    'rate_pc',
  ])

  // A master that names the rate but does not carry it as a column — "GST 18%",
  // "IGST 12" — is common enough to be worth reading the name for.
  if (rate === null && name) {
    const match = /(\d+(?:\.\d+)?)\s*%/.exec(name) ?? /\b(\d+(?:\.\d+)?)\b/.exec(name)
    if (match) {
      const parsed = Number(match[1])
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) rate = parsed
    }
  }

  // Some masters hold the halves rather than the total.
  if (rate === null) {
    const central = firstNumber(record, ['cgst_rate', 'cgst'])
    const state = firstNumber(record, ['sgst_rate', 'sgst', 'utgst_rate'])
    if (central !== null && state !== null) rate = central + state
  }

  if (rate !== null && (rate < 0 || rate > 100)) rate = null

  return {
    id,
    name: name || (rate !== null ? `${rate}%` : `Tax category ${id}`),
    rate,
  }
}

/** The master as a usable list, worst rows dropped, sorted by rate. */
export function parseTaxRates(rows: unknown): TaxRate[] {
  if (!Array.isArray(rows)) return []

  const out: TaxRate[] = []
  const seen = new Set<number>()

  for (const row of rows) {
    const parsed = parseTaxRate(row)
    if (!parsed || seen.has(parsed.id)) continue
    seen.add(parsed.id)
    out.push(parsed)
  }

  return out.sort((a, b) => (a.rate ?? 999) - (b.rate ?? 999) || a.name.localeCompare(b.name))
}
