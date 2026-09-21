/**
 * The form, translated into the body `POST /v1/transactions/purchase` already
 * accepts.
 *
 * This is the only place the two vocabularies meet. The screen says "warehouse"
 * and "GST rate"; the API says `warehouse_id` and `tax_cat_id`, and Books
 * downstream says `mc_id` and its own tax master. Nothing here renames a field
 * the backend reads, and nothing is sent that it does not read — a key the
 * server ignores is a promise to the user that it was saved.
 */

import { isLineStarted, type PurchaseForm } from './model.ts'

export interface PurchaseLinePayload {
  item_id: number | null
  unit_id: number | null
  warehouse_id?: number
  description?: string
  qty: number
  rate: number
  discount_pc: number
  tax_cat_id?: number
  hsn_sac?: string
  rate_was_changed: boolean
}

export interface PurchasePayload {
  party_account_id: number
  date: string
  narration?: string
  reference_no?: string
  supplier_invoice_no?: string
  supplier_invoice_date?: string
  payment_terms?: string
  due_date?: string
  settled_to_account_id?: number
  lines: PurchaseLinePayload[]
}

function numeric(value: string): number {
  const parsed = Number(String(value).trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function text(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function id(value: string): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export function toPurchasePayload(form: PurchaseForm): PurchasePayload {
  if (!form.supplier) {
    throw new Error('A purchase cannot be built without a supplier.')
  }

  const warehouseId = form.purchaseType === 'goods' ? id(form.warehouseId) : undefined

  const lines: PurchaseLinePayload[] = form.lines.filter(isLineStarted).map((line) => {
    // A services purchase carries no item, so the backend files it as a service
    // line and Inventory is never asked to move anything. That is the whole
    // difference between the two purchase types, and it is the backend's own
    // rule — it keys off exactly this.
    const itemId = form.purchaseType === 'services' ? null : line.itemId

    return {
      item_id: itemId,
      unit_id: itemId === null ? null : line.unitId,
      ...(itemId !== null && warehouseId !== undefined ? { warehouse_id: warehouseId } : {}),
      // A line without an item MUST carry a description; the backend refuses it
      // otherwise, and the item's own name is the sensible fallback.
      description: text(line.description) ?? (itemId === null ? text(line.label) : undefined),
      qty: numeric(line.qty),
      rate: numeric(line.rate),
      discount_pc: numeric(line.discountPc),
      ...(id(line.taxCatId) !== undefined ? { tax_cat_id: id(line.taxCatId) } : {}),
      ...(itemId !== null && line.hsnSac ? { hsn_sac: line.hsnSac } : {}),
      rate_was_changed: line.rateWasChanged,
    }
  })

  return {
    party_account_id: form.supplier.id,
    date: form.purchaseDate,
    narration: text(form.note),
    reference_no: form.paidNow ? text(form.referenceNo) : undefined,
    supplier_invoice_no: text(form.supplierInvoiceNo),
    supplier_invoice_date: text(form.supplierInvoiceDate),
    payment_terms: text(form.paymentTerms),
    due_date: text(form.dueDate),
    settled_to_account_id: form.paidNow ? id(form.settleAccountId) : undefined,
    lines,
  }
}
