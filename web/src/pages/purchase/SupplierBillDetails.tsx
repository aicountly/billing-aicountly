/**
 * Who the bill is from, and what is written at the top of it.
 *
 * Every control here maps onto a field `POST /v1/transactions/purchase`
 * already accepts — supplier, date, the supplier's own invoice number and
 * date, payment terms, due date, and the warehouse the goods land in. Place of
 * supply is the one exception and is shown as a DERIVED value rather than a
 * control, because Smart Books decides it from the GSTINs and Billing has
 * nowhere to send an override.
 */

import { useMemo } from 'react'
import { ExternalLink, Search } from 'lucide-react'
import { api } from '../../services/api'
import type { CatalogParty } from '../../services/types'
import { Combo } from '../../components/Combo'
import { money } from '../../ui'
import { DerivedValue, Field } from './PurchaseFields'
import { stateFromGstin, type GstMode } from './gst'
import { PAYMENT_TERMS, type PurchaseForm, type PurchaseSupplier, type PurchaseType } from './model'
import type { PurchaseErrors } from './usePurchaseForm'
import type { PurchaseMasters } from './usePurchaseMasters'
import type { SupplierInsight } from './useSupplierInsight'

const PURCHASE_TYPES: Array<{ value: PurchaseType; label: string; hint: string }> = [
  {
    value: 'goods',
    label: 'Goods (Inventory)',
    hint: 'Lines carry an item, and Inventory receives the stock.',
  },
  {
    value: 'services',
    label: 'Services (no stock)',
    hint: 'Lines are described in words. Nothing moves in Inventory.',
  },
]

export function SupplierBillDetails({
  form,
  errors,
  showErrors,
  masters,
  gstMode,
  insight,
  branchLabel,
  onSupplier,
  onPurchaseDate,
  onPaymentTerms,
  onDueDate,
  onPatch,
}: {
  form: PurchaseForm
  errors: PurchaseErrors
  showErrors: boolean
  masters: PurchaseMasters
  gstMode: GstMode
  insight: SupplierInsight
  branchLabel: string
  onSupplier: (supplier: PurchaseSupplier | null) => void
  onPurchaseDate: (value: string) => void
  onPaymentTerms: (value: string) => void
  onDueDate: (value: string) => void
  onPatch: (partial: Partial<PurchaseForm>) => void
}) {
  const searchSuppliers = useMemo(
    () => async (term: string, signal: AbortSignal) => {
      const response = await api.list<CatalogParty>('v1/catalog/parties', { q: term, side: 'supplier' }, signal)
      return response.data
    },
    [],
  )

  const supplierState = stateFromGstin(form.supplier?.gstin)
  const warehouse = masters.warehouses.find((entry) => String(entry.id) === form.warehouseId) ?? null

  return (
    <section className="purchase-card" aria-labelledby="purchase-supplier-heading">
      <div className="purchase-card__head">
        <span className="purchase-card__mark" aria-hidden>
          <Search size={17} />
        </span>
        <div>
          <h2 id="purchase-supplier-heading">Supplier &amp; Bill Details</h2>
          <p>Enter supplier and invoice details</p>
        </div>
      </div>

      <div className="purchase-grid purchase-grid--4">
        <Field
          label="Supplier"
          required
          error={showErrors ? errors.supplier : undefined}
          hint={
            form.supplier ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {form.supplier.gstin ? `GSTIN ${form.supplier.gstin}` : 'No GSTIN on this account'}
                {supplierState && <>· {supplierState.label}</>}
                <a
                  href={`/parties/${form.supplier.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open this supplier’s statement in a new tab"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
                >
                  Statement
                  <ExternalLink size={11} aria-hidden />
                </a>
              </span>
            ) : (
              'Searches Smart Books as you type.'
            )
          }
        >
          <Combo<CatalogParty>
            label="Supplier"
            placeholder="Type a supplier name..."
            selected={form.supplier?.name ?? null}
            invalid={showErrors && Boolean(errors.supplier)}
            autoFocus
            search={searchSuppliers}
            keyOf={(party) => party.acc_id}
            onClear={form.supplier ? () => onSupplier(null) : undefined}
            emptyAction={<span>Suppliers are Smart Books’ accounts. Add one there and it appears here.</span>}
            renderOption={(party) => {
              const state = stateFromGstin(party.gstin)
              return {
                name: party.acc_name,
                meta: [party.gstin ?? 'No GSTIN', state ? state.label : null],
              }
            }}
            onPick={(party) =>
              onSupplier({ id: party.acc_id, name: party.acc_name, gstin: party.gstin ?? null })
            }
          />
        </Field>

        <Field
          label="Purchase Date"
          htmlFor="purchase-date"
          required
          error={showErrors ? errors.purchaseDate : undefined}
          hint="The date this bill is recorded on."
        >
          <input
            id="purchase-date"
            type="date"
            className={`purchase-input${showErrors && errors.purchaseDate ? ' is-invalid' : ''}`}
            aria-invalid={showErrors && Boolean(errors.purchaseDate)}
            value={form.purchaseDate}
            onChange={(event) => onPurchaseDate(event.target.value)}
          />
        </Field>

        <Field
          label="Supplier Invoice No."
          htmlFor="purchase-supplier-invoice"
          hint="As printed on the supplier’s bill."
        >
          <input
            id="purchase-supplier-invoice"
            type="text"
            className="purchase-input"
            placeholder="e.g. INV-001"
            value={form.supplierInvoiceNo}
            onChange={(event) => onPatch({ supplierInvoiceNo: event.target.value })}
          />
        </Field>

        <Field label="Supplier Bill Date" htmlFor="purchase-supplier-invoice-date" hint="Only if it differs from above.">
          <input
            id="purchase-supplier-invoice-date"
            type="date"
            className="purchase-input"
            value={form.supplierInvoiceDate}
            onChange={(event) => onPatch({ supplierInvoiceDate: event.target.value })}
          />
        </Field>

        <Field
          label="Purchase Type"
          htmlFor="purchase-type"
          hint={PURCHASE_TYPES.find((entry) => entry.value === form.purchaseType)?.hint}
        >
          <select
            id="purchase-type"
            className="purchase-select"
            value={form.purchaseType}
            onChange={(event) => onPatch({ purchaseType: event.target.value as PurchaseType })}
          >
            {PURCHASE_TYPES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Warehouse / Branch"
          htmlFor="purchase-warehouse"
          required={form.purchaseType === 'goods'}
          error={showErrors ? errors.warehouse : undefined}
          hint={
            masters.warehousesFailed ? (
              <button
                type="button"
                className="purchase-chip"
                onClick={masters.reloadWarehouses}
                style={{ marginTop: 2 }}
              >
                Couldn’t load warehouses. Retry
              </button>
            ) : form.purchaseType === 'services' ? (
              'A services purchase moves no stock.'
            ) : (
              `Goods received here · ${branchLabel}`
            )
          }
        >
          <select
            id="purchase-warehouse"
            className={`purchase-select${showErrors && errors.warehouse ? ' is-invalid' : ''}`}
            aria-invalid={showErrors && Boolean(errors.warehouse)}
            value={form.warehouseId}
            disabled={form.purchaseType === 'services' || masters.warehousesLoading}
            onChange={(event) => onPatch({ warehouseId: event.target.value })}
          >
            <option value="">
              {masters.warehousesLoading
                ? 'Loading warehouses…'
                : masters.warehouses.length === 0
                  ? 'No warehouses in Inventory'
                  : 'Choose a warehouse'}
            </option>
            {masters.warehouses.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Payment Terms" htmlFor="purchase-terms" hint="Sets the due date below.">
          <select
            id="purchase-terms"
            className="purchase-select"
            value={form.paymentTerms}
            onChange={(event) => onPaymentTerms(event.target.value)}
          >
            {PAYMENT_TERMS.map((term) => (
              <option key={term.value} value={term.value}>
                {term.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Due Date"
          htmlFor="purchase-due-date"
          hint={form.paidNow ? 'Not used — this purchase is paid now.' : 'Changing this sets the terms to Custom.'}
        >
          <input
            id="purchase-due-date"
            type="date"
            className="purchase-input"
            value={form.dueDate}
            min={form.purchaseDate || undefined}
            onChange={(event) => onDueDate(event.target.value)}
          />
        </Field>

        {/*
          The two values this screen WORKS OUT rather than asks for. They are
          shown as readings, not controls, because the Billing API takes
          neither: Smart Books derives the place of supply and the split from
          the GSTINs when it posts the voucher. A dropdown here would be a
          promise that an override was saved.
        */}
        <Field
          label="Place of Supply (State)"
          className="purchase-field--wide"
          hint={
            gstMode.placeOfSupply
              ? 'From your company GSTIN. Smart Books settles the final treatment.'
              : 'Add your company GSTIN in Aicountly Manage to show this.'
          }
        >
          <DerivedValue value={gstMode.placeOfSupply?.label ?? null} empty="Not known" />
        </Field>

        <Field label="GST Treatment" className="purchase-field--wide" hint={gstMode.reason}>
          <DerivedValue value={gstMode.splitLabel} empty="Not known" />
        </Field>
      </div>

      {/* The one figure worth surfacing beside the supplier, and only when it
          is a real reading rather than a blank. */}
      {form.supplier && insight.outstanding !== null && insight.outstanding > 0 && (
        <p className="purchase-field__hint" style={{ marginTop: 12 }}>
          {form.supplier.name} is already owed <strong>{money(insight.outstanding)}</strong>
          {insight.overdue !== null && insight.overdue > 0 ? `, of which ${money(insight.overdue)} is overdue` : ''}.
          Read from Smart Books just now.
        </p>
      )}

      {warehouse && form.purchaseType === 'goods' && (
        <span className="billing-sr-only">Goods will be received into {warehouse.name}.</span>
      )}
    </section>
  )
}
