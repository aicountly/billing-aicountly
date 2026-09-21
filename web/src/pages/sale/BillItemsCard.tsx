/**
 * What is being sold.
 *
 * The working area of the screen, so it is built for a person with a customer
 * waiting: search or scan into the row, quantity defaults to 1, Enter moves on,
 * and the line total is worked out as it is typed. Rows are memoised — a
 * quantity keystroke on line 1 must not re-render line 40.
 *
 * Every item comes from Inventory and every tax category from Books. Billing
 * holds neither: the row keeps the ids and the commercial facts agreed with the
 * customer, and the name, unit, HSN and stock are read from the products that
 * own them.
 */

import { memo, useCallback, type RefObject } from 'react'
import { AlertCircle, Package, Plus, ScanLine, Trash2 } from 'lucide-react'
import { api } from '../../services/api'
import type { CatalogItem } from '../../services/types'
import { money } from '../../ui'
import { Combo } from '../../components/Combo'
import {
  fromPaise,
  grouped,
  itemBarcode,
  itemHsn,
  itemRate,
  lineAmounts,
  type ItemRow,
  type SaleLine,
  type TaxCategory,
} from './saleForm'

export interface StockReading {
  loading: boolean
  /** null when Inventory did not answer with a number — the chip stays off. */
  qty: number | null
}

export function BillItemsCard({
  lines,
  taxCategories,
  taxCategoriesLoading,
  favourites,
  stock,
  lineErrors,
  showErrors,
  mayDiscount,
  totalPaise,
  scanRef,
  onPatch,
  onPickItem,
  onScan,
  onAddLine,
  onRemoveLine,
  onScanClick,
}: {
  lines: SaleLine[]
  taxCategories: TaxCategory[]
  taxCategoriesLoading: boolean
  favourites: ItemRow[]
  stock: Record<number, StockReading>
  lineErrors: Record<string, string>
  showErrors: boolean
  mayDiscount: boolean
  /** What the lines come to, after discount and before tax. */
  totalPaise: number
  scanRef: RefObject<HTMLInputElement | null>
  onPatch: (key: string, patch: Partial<SaleLine>) => void
  onPickItem: (key: string, item: ItemRow) => void
  onScan: (key: string, code: string) => void
  onAddLine: () => void
  onRemoveLine: (key: string) => void
  onScanClick: () => void
}) {
  // Where "Scan barcode" and Alt+S send the cursor: the first line with no item
  // on it yet. Line 1 usually has one by the time anybody reaches for a scanner.
  const scanIndex = lines.findIndex((line) => line.itemId === null)

  const searchItems = useCallback(async (term: string, signal: AbortSignal) => {
    const response = await api.list<CatalogItem>('v1/catalog/items/search', { q: term, limit: 20 }, signal)
    return response.data as ItemRow[]
  }, [])

  return (
    <section className="billing-sale-card" aria-labelledby="sale-items-heading">
      <header className="billing-sale-card__head">
        <div>
          <h2 id="sale-items-heading">Items</h2>
          <p>Add items, set quantity and rate. Smart Books works out the GST.</p>
        </div>
        <div className="billing-sale-card__actions">
          <button type="button" className="billing-sale__chip" onClick={onScanClick}>
            <ScanLine size={14} aria-hidden /> Scan barcode
          </button>
          <button type="button" className="billing-sale__chip billing-sale__chip--primary" onClick={onAddLine}>
            <Plus size={14} aria-hidden /> Add line
          </button>
        </div>
      </header>

      <div className="billing-sale-items__scroll">
        <table className="billing-sale-items__table">
          <colgroup>
            <col className="billing-sale-items__col-no" />
            <col />
            <col className="billing-sale-items__col-qty" />
            <col className="billing-sale-items__col-unit" />
            <col className="billing-sale-items__col-rate" />
            {mayDiscount && <col className="billing-sale-items__col-disc" />}
            <col className="billing-sale-items__col-tax" />
            <col className="billing-sale-items__col-amount" />
            <col className="billing-sale-items__col-remove" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Item / description</th>
              <th scope="col">Qty</th>
              <th scope="col">Unit</th>
              <th scope="col">Rate (₹)</th>
              {mayDiscount && <th scope="col">Disc %</th>}
              <th scope="col">Tax</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Amount (₹)
              </th>
              <th scope="col">
                <span className="billing-sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <BillItemRow
                key={line.key}
                line={line}
                index={index}
                canRemove={lines.length > 1}
                taxCategories={taxCategories}
                taxCategoriesLoading={taxCategoriesLoading}
                favourites={favourites}
                stock={line.itemId === null ? undefined : stock[line.itemId]}
                error={showErrors ? lineErrors[line.key] : undefined}
                mayDiscount={mayDiscount}
                scanRef={index === scanIndex ? scanRef : undefined}
                searchItems={searchItems}
                onPatch={onPatch}
                onPickItem={onPickItem}
                onScan={onScan}
                onRemove={onRemoveLine}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="billing-sale-items__foot">
        <button type="button" className="billing-sale-items__add" onClick={onAddLine}>
          <Plus size={15} aria-hidden /> Add another line
        </button>
        <p className="billing-sale-items__running">
          Items total <strong>{money(fromPaise(totalPaise))}</strong>
        </p>
      </div>
    </section>
  )
}

const BillItemRow = memo(function BillItemRow({
  line,
  index,
  canRemove,
  taxCategories,
  taxCategoriesLoading,
  favourites,
  stock,
  error,
  mayDiscount,
  scanRef,
  searchItems,
  onPatch,
  onPickItem,
  onScan,
  onRemove,
}: {
  line: SaleLine
  index: number
  canRemove: boolean
  taxCategories: TaxCategory[]
  taxCategoriesLoading: boolean
  favourites: ItemRow[]
  stock: StockReading | undefined
  error: string | undefined
  mayDiscount: boolean
  scanRef: RefObject<HTMLInputElement | null> | undefined
  searchItems: (term: string, signal: AbortSignal) => Promise<ItemRow[]>
  onPatch: (key: string, patch: Partial<SaleLine>) => void
  onPickItem: (key: string, item: ItemRow) => void
  onScan: (key: string, code: string) => void
  onRemove: (key: string) => void
}) {
  const amounts = lineAmounts(line)
  const qtyNeeded = Number(line.qty || 0)

  return (
    <tr>
      <td className="billing-sale-items__index">{index + 1}</td>

      <td>
        {line.itemId === null ? (
          <Combo<ItemRow>
            portal
            label={`Item on line ${index + 1}`}
            placeholder="Search or scan item…"
            compact
            inputRef={scanRef}
            search={searchItems}
            idleOptions={favourites}
            idleHeading={favourites.length > 0 ? 'Your usual items' : undefined}
            keyOf={(item) => item.item_id}
            onPick={(item) => onPickItem(line.key, item)}
            onSubmitTerm={(code) => onScan(line.key, code)}
            renderOption={(item) => ({
              name: item.item_name,
              trailing: itemRate(item) ? money(Number(itemRate(item))) : undefined,
              meta: [
                item.item_sku ? `SKU ${item.item_sku}` : null,
                itemHsn(item) ? `HSN ${itemHsn(item)}` : null,
                itemBarcode(item) ? `Barcode ${itemBarcode(item)}` : null,
              ].filter(Boolean) as string[],
            })}
          />
        ) : (
          <div>
            <div className="billing-sale-combo__option-top">
              <span className="billing-sale-combo__option-name">{line.label}</span>
              <button
                type="button"
                className="billing-sale-combo__retry"
                onClick={() =>
                  onPatch(line.key, {
                    itemId: null,
                    label: '',
                    sku: null,
                    hsn: null,
                    unitId: null,
                    unitLabel: '',
                    rateWasChanged: false,
                  })
                }
              >
                Change
              </button>
            </div>
          </div>
        )}

        <input
          type="text"
          className="billing-sale-items__cell-control"
          style={{ marginTop: 5, minHeight: 32 }}
          value={line.description}
          placeholder={line.itemId === null ? 'or describe what is being sold' : 'Description on the bill (optional)'}
          aria-label={`Description on line ${index + 1}`}
          onChange={(event) => onPatch(line.key, { description: event.target.value })}
        />

        <div className="billing-sale-items__line-meta">
          {line.sku && <span>SKU {line.sku}</span>}
          {line.hsn && <span>HSN {line.hsn}</span>}
          {stock?.loading && <span>Checking stock…</span>}
          {stock && !stock.loading && stock.qty !== null && <StockChip available={stock.qty} needed={qtyNeeded} />}
        </div>

        {error && (
          <span className="billing-sale__error" role="alert">
            <AlertCircle size={12} aria-hidden /> {error}
          </span>
        )}
      </td>

      <td>
        <input
          type="text"
          inputMode="decimal"
          className={`billing-sale-items__cell-control billing-sale-items__cell-control--number${
            error ? ' billing-sale-items__cell-control--invalid' : ''
          }`}
          value={line.qty}
          aria-label={`Quantity on line ${index + 1}`}
          onChange={(event) => onPatch(line.key, { qty: event.target.value })}
        />
      </td>

      <td>
        <span className="billing-sale-items__unit" title={line.unitLabel ? `Unit from Inventory: ${line.unitLabel}` : undefined}>
          {line.unitLabel || '—'}
        </span>
      </td>

      <td>
        <input
          type="text"
          inputMode="decimal"
          className="billing-sale-items__cell-control billing-sale-items__cell-control--number"
          value={line.rate}
          placeholder="0.00"
          aria-label={`Rate on line ${index + 1}`}
          onChange={(event) => onPatch(line.key, { rate: event.target.value, rateWasChanged: true })}
        />
      </td>

      {mayDiscount && (
        <td>
          <input
            type="text"
            inputMode="decimal"
            className="billing-sale-items__cell-control billing-sale-items__cell-control--number"
            value={line.discountPc}
            placeholder="0"
            aria-label={`Discount per cent on line ${index + 1}`}
            onChange={(event) => onPatch(line.key, { discountPc: event.target.value })}
          />
        </td>
      )}

      <td>
        <select
          className="billing-sale-items__cell-control"
          value={line.taxCategoryId}
          disabled={taxCategoriesLoading || taxCategories.length === 0}
          aria-label={`Tax on line ${index + 1}`}
          onChange={(event) => onPatch(line.key, { taxCategoryId: event.target.value })}
        >
          <option value="">
            {taxCategoriesLoading ? 'Loading…' : taxCategories.length === 0 ? 'None set up' : 'Not set'}
          </option>
          {taxCategories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </td>

      <td>
        <span className="billing-sale-items__amount">{grouped(amounts.taxablePaise)}</span>
        {amounts.discountPaise > 0 && (
          <span className="billing-sale-items__line-meta" style={{ justifyContent: 'flex-end' }}>
            less {grouped(amounts.discountPaise)}
          </span>
        )}
      </td>

      <td>
        <button
          type="button"
          className="billing-sale-items__remove"
          onClick={() => onRemove(line.key)}
          aria-label={`Remove line ${index + 1}`}
          title={canRemove ? 'Remove this line' : 'Clear this line'}
        >
          <Trash2 size={15} aria-hidden />
        </button>
      </td>
    </tr>
  )
})

/**
 * What Inventory says is on the shelf.
 *
 * Read from Inventory, never worked out here — Billing has no stock table and
 * calculating one from bills it has sent would be a second answer to a question
 * Inventory owns. The wording is about THIS line: "only 3 left" when the line
 * asks for more than there is.
 */
function StockChip({ available, needed }: { available: number; needed: number }) {
  if (available <= 0) {
    return (
      <span className="billing-sale-items__stock billing-sale-items__stock--out">
        <Package size={11} aria-hidden /> Out of stock
      </span>
    )
  }
  if (needed > available) {
    return (
      <span className="billing-sale-items__stock billing-sale-items__stock--low">
        <Package size={11} aria-hidden /> Only {available} in stock
      </span>
    )
  }

  return (
    <span className="billing-sale-items__stock billing-sale-items__stock--in">
      <Package size={11} aria-hidden /> {available} in stock
    </span>
  )
}
