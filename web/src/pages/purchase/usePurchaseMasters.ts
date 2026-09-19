/**
 * Everything this screen needs that belongs to another product.
 *
 * Warehouses and units come from Inventory, tax categories and cash/bank
 * accounts from Books, the financial year and the company GSTIN from Manage —
 * all through Billing's existing read-through endpoints, all on the request
 * that draws the screen. None of it is stored, and a master that cannot be
 * reached degrades that ONE control rather than the page: a screen that refuses
 * to open because a dropdown could not be filled is a screen nobody can use to
 * enter the bill in their hand.
 */

import { useMemo } from 'react'
import { api } from '../../services/api'
import { fetchCompanyInfo } from '../../services/manage'
import type { CompanyInfo } from '../../services/manage'
import type { CashBankAccount, CatalogItem } from '../../services/types'
import { useApi } from '../../hooks/useApi'
import { useBilling } from '../../context/BillingContext'
import { parseTaxRates, type TaxRate } from './gst'

export interface Warehouse {
  id: number
  name: string
  isDefault: boolean
}

export interface Uom {
  id: number
  name: string
}

type Row = Record<string, unknown>

function isRow(value: unknown): value is Row {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Rows out of whatever envelope the upstream product used.
 *
 * These are pass-throughs from two different products, and `{data: [...]}`,
 * `{data: {items: [...]}}` and a bare array have all been seen in the fleet.
 */
function rowsFrom(body: unknown): Row[] {
  if (Array.isArray(body)) return body.filter(isRow)
  if (!isRow(body)) return []

  const data = body.data
  if (Array.isArray(data)) return data.filter(isRow)
  if (isRow(data)) {
    for (const key of ['items', 'rows', 'results', 'list']) {
      const nested = data[key]
      if (Array.isArray(nested)) return nested.filter(isRow)
    }
  }
  for (const key of ['items', 'rows', 'results']) {
    const nested = body[key]
    if (Array.isArray(nested)) return nested.filter(isRow)
  }

  return []
}

function readNumber(row: Row, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key]
    if (value === null || value === undefined || value === '') continue
    const parsed = typeof value === 'number' ? value : Number(String(value).trim())
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return null
}

function readText(row: Row, keys: string[]): string {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return ''
}

function readFlag(row: Row, keys: string[]): boolean {
  for (const key of keys) {
    const value = row[key]
    if (value === true || value === 1) return true
    if (typeof value === 'string' && ['1', 'true', 'yes'].includes(value.toLowerCase())) return true
  }
  return false
}

function parseWarehouses(body: unknown): Warehouse[] {
  const out: Warehouse[] = []
  const seen = new Set<number>()

  for (const row of rowsFrom(body)) {
    // `mc_id` is what a document line carries — the backend maps our
    // `warehouse_id` onto it — so it is read first.
    const id = readNumber(row, ['mc_id', 'warehouse_id', 'wh_id', 'id'])
    if (id === null || seen.has(id)) continue
    seen.add(id)

    out.push({
      id,
      name: readText(row, ['mc_name', 'warehouse_name', 'wh_name', 'name', 'label']) || `Warehouse ${id}`,
      isDefault: readFlag(row, ['is_default', 'default', 'is_primary', 'is_main']),
    })
  }

  return out
}

function parseUoms(body: unknown): Uom[] {
  const out: Uom[] = []
  const seen = new Set<number>()

  for (const row of rowsFrom(body)) {
    const id = readNumber(row, ['unit_id', 'uom_id', 'id'])
    if (id === null || seen.has(id)) continue
    seen.add(id)

    out.push({
      id,
      name:
        readText(row, ['unit_symbol', 'uom_symbol', 'symbol', 'unit_name', 'uom_name', 'name', 'short_name']) ||
        `Unit ${id}`,
    })
  }

  return out
}

export interface PurchaseMasters {
  warehouses: Warehouse[]
  warehousesFailed: boolean
  warehousesLoading: boolean

  uoms: Uom[]
  uomById: Map<number, Uom>

  taxRates: TaxRate[]
  taxRateById: Map<number, TaxRate>
  taxRatesFailed: boolean
  taxRatesLoading: boolean
  /** True when the master answered but carried no readable percentage on any row. */
  taxRatesUnpriced: boolean

  cashBank: CashBankAccount[]
  cashBankFailed: boolean

  favourites: CatalogItem[]

  company: CompanyInfo | null
  companyLoading: boolean

  reloadTaxRates: () => void
  reloadWarehouses: () => void
}

export function usePurchaseMasters(): PurchaseMasters {
  const { scope } = useBilling()
  const cmpId = scope?.cmp_id
  const fyId = scope?.fy_id
  const boId = scope?.bo_id

  const warehouses = useApi(
    (signal) => api.get<unknown>('v1/catalog/warehouses', undefined, signal),
    [cmpId, boId],
    Boolean(scope),
  )

  const uoms = useApi(
    (signal) => api.get<unknown>('v1/catalog/uoms', undefined, signal),
    [cmpId],
    Boolean(scope),
  )

  const taxRates = useApi(
    (signal) => api.get<unknown>('v1/catalog/tax-categories', undefined, signal),
    [cmpId, fyId],
    Boolean(scope),
  )

  const cashBank = useApi(
    (signal) => api.list<CashBankAccount>('v1/catalog/cash-bank', undefined, signal),
    [cmpId],
    Boolean(scope),
  )

  const favourites = useApi(
    (signal) => api.get<{ data: CatalogItem[] }>('v1/catalog/items/favourites', undefined, signal),
    [cmpId],
    Boolean(scope),
  )

  const company = useApi(
    (signal) => (cmpId ? fetchCompanyInfo(cmpId, signal) : Promise.resolve(null)),
    [cmpId],
    Boolean(cmpId),
  )

  const parsedWarehouses = useMemo(() => parseWarehouses(warehouses.data), [warehouses.data])
  const parsedUoms = useMemo(() => parseUoms(uoms.data), [uoms.data])
  const parsedRates = useMemo(() => parseTaxRates(rowsFrom(taxRates.data)), [taxRates.data])

  const uomById = useMemo(() => new Map(parsedUoms.map((unit) => [unit.id, unit])), [parsedUoms])
  const taxRateById = useMemo(() => new Map(parsedRates.map((rate) => [rate.id, rate])), [parsedRates])

  return {
    warehouses: parsedWarehouses,
    warehousesFailed: warehouses.error !== null,
    warehousesLoading: warehouses.loading,

    uoms: parsedUoms,
    uomById,

    taxRates: parsedRates,
    taxRateById,
    taxRatesFailed: taxRates.error !== null,
    taxRatesLoading: taxRates.loading,
    taxRatesUnpriced: parsedRates.length > 0 && parsedRates.every((rate) => rate.rate === null),

    cashBank: cashBank.data?.data ?? [],
    cashBankFailed: cashBank.error !== null,

    favourites: favourites.data?.data ?? [],

    company: company.data ?? null,
    companyLoading: company.loading,

    reloadTaxRates: taxRates.reload,
    reloadWarehouses: warehouses.reload,
  }
}
