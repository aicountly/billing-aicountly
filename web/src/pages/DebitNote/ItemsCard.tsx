/**
 * What is going back, line by line — or, for a value-only note, the one figure
 * that replaces the lines entirely.
 *
 * Items come from Inventory and tax categories from Smart Books, both live. No
 * tax is worked out here: the line carries the category, and Books computes the
 * GST from its own master when it posts. A second tax engine in a product for
 * people who do not want to learn accounting is the worst place for one.
 */

import { Package, Plus, Sparkles, Trash2, Warehouse as WarehouseIcon } from 'lucide-react'
import type { CatalogItem, Capability, TaxCategory, Warehouse } from '../../services/types'
import { money } from '../../ui'
import { ItemPicker } from '../../components/LivePicker'
import { Unavailable } from '../../dashboards/kit'
import { DnCard, DnField } from './parts'
import { lineAmount, type DebitNoteLine, type Problems, type ReturnKind } from './model'

export function ItemsCard({
  returnKind,
  lines,
  onPatch,
  onAdd,
  onRemove,
  onPickItem,
  adjustment,
  onAdjustment,
  taxCategories,
  warehouses,
  warehouseId,
  onWarehouse,
  mayDiscount,
  extraction,
  problems,
  disabled,
  maintainsStock,
}: {
  returnKind: ReturnKind
  lines: DebitNoteLine[]
  onPatch: (key: string, patch: Partial<DebitNoteLine>) => void
  onAdd: () => void
  onRemove: (key: string) => void
  onPickItem: (item: CatalogItem, key: string) => void
  adjustment: string
  onAdjustment: (value: string) => void
  taxCategories: TaxCategory[]
  warehouses: Warehouse[]
  warehouseId: string
  onWarehouse: (value: string) => void
  mayDiscount: boolean
  extraction: Capability
  problems: Problems
  disabled: boolean
  maintainsStock: boolean
}) {
  const valueOnly = returnKind === 'value_adjustment'

  // Only ask where the goods are going back into when they are actually going
  // back, this company keeps stock, and Inventory knows of more than one place.
  const askWarehouse = !valueOnly && maintainsStock && warehouses.length > 1

  return (
    <DnCard
      title={valueOnly ? 'Amount being adjusted' : 'Items'}
      icon={<Package size={15} />}
      action={
        valueOnly ? undefined : (
          <>
            <button
              type="button"
              className="billing-button billing-button--small"
              disabled
              title="Smart Books' register lists a bill but not the lines on it, so the items cannot be pulled through yet."
            >
              Add from invoice
            </button>
            <button
              type="button"
              className="billing-button billing-button--small"
              disabled={!extraction.available}
              title={extraction.available ? undefined : extraction.reason ?? 'Not configured for this deployment.'}
            >
              <Sparkles size={14} aria-hidden /> Scan &amp; add (AI)
            </button>
            <button
              type="button"
              className="billing-button billing-button--primary billing-button--small"
              onClick={onAdd}
              disabled={disabled}
            >
              <Plus size={14} aria-hidden /> Add item
            </button>
          </>
        )
      }
    >
      {valueOnly ? (
        <ValueOnly
          adjustment={adjustment}
          onAdjustment={onAdjustment}
          error={problems.adjustment}
          disabled={disabled}
        />
      ) : (
        <>
          {askWarehouse && (
            <div style={{ marginBottom: 14, maxWidth: '22rem' }}>
              <DnField
                label="Goods go back into"
                hint="Applied to every line. Inventory reduces the stock there once the note is posted."
              >
                {({ id, describedBy }) => (
                  <div className="dn-inputgroup">
                    <select
                      id={id}
                      className="dn-control"
                      value={warehouseId}
                      aria-describedby={describedBy}
                      disabled={disabled}
                      onChange={(event) => onWarehouse(event.target.value)}
                    >
                      <option value="">Let Inventory decide</option>
                      {warehouses.map((warehouse) => (
                        <option key={warehouse.mc_id} value={String(warehouse.mc_id)}>{warehouse.mc_name}</option>
                      ))}
                    </select>
                    <span className="dn-inputgroup__button" aria-hidden><WarehouseIcon size={14} /></span>
                  </div>
                )}
              </DnField>
            </div>
          )}

          {problems.lines && (
            <p className="dn-field__error" role="alert" style={{ marginBottom: 10 }}>{problems.lines}</p>
          )}

          <div className="dn-tablewrap">
            <table className="dn-table">
              <caption className="billing-sr-only">
                The items going back to the supplier. Every line has an item, a quantity, a rate and a tax category.
              </caption>
              <thead>
                <tr>
                  <th scope="col" style={{ width: 30 }}>#</th>
                  <th scope="col">Item / Description</th>
                  <th scope="col" style={{ width: 68 }}>HSN/SAC</th>
                  <th scope="col" className="dn-num" style={{ width: 62 }}>Qty</th>
                  <th scope="col" style={{ width: 60 }}>Unit</th>
                  <th scope="col" className="dn-num" style={{ width: 84 }}>Rate (₹)</th>
                  {mayDiscount && <th scope="col" className="dn-num" style={{ width: 64 }}>Disc %</th>}
                  <th scope="col" style={{ width: 100 }}>Tax</th>
                  <th scope="col" className="dn-num" style={{ width: 102 }}>Amount (₹)</th>
                  <th scope="col" style={{ width: 38 }}><span className="billing-sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <ItemRow
                    key={line.key}
                    line={line}
                    index={index}
                    onPatch={onPatch}
                    onRemove={onRemove}
                    onPickItem={onPickItem}
                    taxCategories={taxCategories}
                    mayDiscount={mayDiscount}
                    canRemove={lines.length > 1}
                    disabled={disabled}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <button type="button" className="dn-addrow" onClick={onAdd} disabled={disabled} style={{ marginTop: 12 }}>
            <Plus size={15} aria-hidden /> Add another item
          </button>

          <p className="dn-aihint">
            <Sparkles size={13} aria-hidden />
            {extraction.available
              ? 'Upload the supplier’s credit note or your return challan and the lines can be read from it.'
              : extraction.reason ??
                'Reading the lines off a return document needs a document-extraction service, and none is configured here.'}
          </p>
        </>
      )}
    </DnCard>
  )
}

function ItemRow({
  line,
  index,
  onPatch,
  onRemove,
  onPickItem,
  taxCategories,
  mayDiscount,
  canRemove,
  disabled,
}: {
  line: DebitNoteLine
  index: number
  onPatch: (key: string, patch: Partial<DebitNoteLine>) => void
  onRemove: (key: string) => void
  onPickItem: (item: CatalogItem, key: string) => void
  taxCategories: TaxCategory[]
  mayDiscount: boolean
  canRemove: boolean
  disabled: boolean
}) {
  const amount = lineAmount(line)

  return (
    <tr>
      <td className="dn-cell--no"><span className="dn-rowno">{index + 1}</span></td>

      <td className="dn-cell--item" data-label="Item / Description">
        <ItemPicker
          hideLabel
          inputClassName="dn-control"
          selectedLabel={line.label || null}
          onPick={(item) => onPickItem(item, line.key)}
        />
        {line.item_id !== null && (
          <input
            className="dn-control"
            style={{ marginTop: 6, minHeight: 32, fontSize: 12 }}
            value={line.description}
            placeholder="Description (optional)"
            maxLength={200}
            aria-label={`Description for line ${index + 1}`}
            disabled={disabled}
            onChange={(event) => onPatch(line.key, { description: event.target.value })}
          />
        )}
      </td>

      <td data-label="HSN/SAC">
        <input
          className="dn-control"
          value={line.hsn_sac}
          placeholder="HSN"
          maxLength={10}
          inputMode="numeric"
          aria-label={`HSN or SAC for line ${index + 1}`}
          disabled={disabled}
          onChange={(event) => onPatch(line.key, { hsn_sac: event.target.value })}
        />
      </td>

      <td className="dn-num" data-label="Qty">
        <input
          className="dn-control"
          style={{ textAlign: 'right' }}
          value={line.qty}
          inputMode="decimal"
          aria-label={`Quantity for line ${index + 1}`}
          disabled={disabled}
          onChange={(event) => onPatch(line.key, { qty: event.target.value })}
        />
      </td>

      {/* Plain text, not a disabled box: the unit is the item's, Inventory owns
          it, and nothing on this screen can change it. */}
      <td data-label="Unit">
        <span className="dn-unit" title="The unit comes from the item in Inventory.">
          {line.unit_label || '—'}
        </span>
      </td>

      <td className="dn-num" data-label="Rate (₹)">
        <input
          className="dn-control"
          style={{ textAlign: 'right' }}
          value={line.rate}
          inputMode="decimal"
          aria-label={`Rate for line ${index + 1}`}
          disabled={disabled}
          onChange={(event) => onPatch(line.key, { rate: event.target.value, rate_was_changed: true })}
        />
      </td>

      {mayDiscount && (
        <td className="dn-num" data-label="Discount %">
          <input
            className="dn-control"
            style={{ textAlign: 'right' }}
            value={line.discount_pc}
            inputMode="decimal"
            aria-label={`Discount percent for line ${index + 1}`}
            disabled={disabled}
            onChange={(event) => onPatch(line.key, { discount_pc: event.target.value })}
          />
        </td>
      )}

      <td data-label="Tax">
        <select
          className="dn-control"
          value={line.tax_cat_id}
          aria-label={`Tax category for line ${index + 1}`}
          disabled={disabled}
          onChange={(event) => onPatch(line.key, { tax_cat_id: event.target.value })}
        >
          <option value="">From item</option>
          {taxCategories.map((category) => (
            <option key={category.tax_cat_id} value={String(category.tax_cat_id)}>{category.tax_cat_name}</option>
          ))}
        </select>
      </td>

      <td className="dn-num" data-label="Amount (₹)">
        <div className="dn-amount">{money(amount)}</div>
      </td>

      <td className="dn-cell--action">
        <button
          type="button"
          className="dn-iconbtn dn-iconbtn--danger"
          onClick={() => onRemove(line.key)}
          disabled={disabled || !canRemove}
          aria-label={`Remove line ${index + 1}${line.label ? `, ${line.label}` : ''}`}
          title="Remove this line"
        >
          <Trash2 size={15} aria-hidden />
        </button>
      </td>
    </tr>
  )
}

/**
 * A value-only note has no lines to add up; the adjustment IS the amount.
 *
 * It is sent as one described line with no item id, which is what keeps
 * anything downstream from reading it as goods coming back.
 */
function ValueOnly({
  adjustment,
  onAdjustment,
  error,
  disabled,
}: {
  adjustment: string
  onAdjustment: (value: string) => void
  error?: string
  disabled: boolean
}) {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <DnField
        label="Amount to adjust"
        required
        error={error}
        hint="Before tax. Smart Books works out the GST on it."
      >
        {({ id, describedBy, invalid }) => (
          <input
            id={id}
            className={`dn-control dn-bigamount${invalid ? ' dn-control--invalid' : ''}`}
            value={adjustment}
            inputMode="decimal"
            placeholder="0.00"
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            disabled={disabled}
            onChange={(event) => onAdjustment(event.target.value)}
          />
        )}
      </DnField>

      <Unavailable title="No stock moves for this note">
        A value adjustment corrects what the bill was worth. Nothing is returned to Inventory, and no stock
        quantity changes anywhere.
      </Unavailable>
    </div>
  )
}
