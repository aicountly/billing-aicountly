/**
 * One line of the bill.
 *
 * Kept as its own component so a keystroke in row nine re-renders row nine.
 * A purchase with thirty lines is not unusual and re-rendering the whole grid
 * on every digit is how a fast-entry screen starts dropping characters.
 */

import { memo, useCallback, useMemo } from 'react'
import { Search, Trash2 } from 'lucide-react'
import { api } from '../../services/api'
import type { CatalogItem } from '../../services/types'
import { Combobox } from '../../components/Combobox'
import { money } from '../../ui'
import { lineTotals, type PurchaseLine, type PurchaseType } from './model'
import type { TaxRate } from './gst'
import type { LineErrors } from './usePurchaseForm'
import type { StockHint } from './useStockHints'
import type { Uom } from './usePurchaseMasters'

export interface PurchaseItemRowProps {
  index: number
  line: PurchaseLine
  errors: LineErrors | undefined
  showErrors: boolean
  purchaseType: PurchaseType
  uoms: Uom[]
  taxRates: TaxRate[]
  taxRateById: Map<number, TaxRate>
  mayDiscount: boolean
  stock: StockHint | null
  canRemove: boolean
  registerItemInput: (key: string, node: HTMLInputElement | null) => void
  onPatch: (key: string, partial: Partial<PurchaseLine>) => void
  onApplyItem: (item: CatalogItem, key: string) => void
  onRemove: (key: string) => void
  onAdvance: (key: string) => void
}

function taxLabel(rate: TaxRate): string {
  if (rate.rate === null) return rate.name
  // "18%" is how the rate is spoken and written on an Indian bill; the master's
  // own name follows it when it says anything more than the number.
  const percent = `${rate.rate}%`
  return rate.name === percent || rate.name === String(rate.rate) ? percent : `${percent} · ${rate.name}`
}

function PurchaseItemRowInner({
  index,
  line,
  errors,
  showErrors,
  purchaseType,
  uoms,
  taxRates,
  taxRateById,
  mayDiscount,
  stock,
  canRemove,
  registerItemInput,
  onPatch,
  onApplyItem,
  onRemove,
  onAdvance,
}: PurchaseItemRowProps) {
  const isGoods = purchaseType === 'goods'

  const searchItems = useMemo(
    () => async (term: string, signal: AbortSignal) => {
      const response = await api.list<CatalogItem>('v1/catalog/items/search', { q: term }, signal)
      return response.data
    },
    [],
  )

  // Stable per line, so the grid's focus map is not torn down and rebuilt on
  // every keystroke.
  const itemRef = useCallback(
    (node: HTMLInputElement | null) => registerItemInput(line.key, node),
    [registerItemInput, line.key],
  )

  const totals = lineTotals(line, taxRateById)
  const show = showErrors && errors !== undefined

  /** Enter moves on. It never submits — a bill saved by a stray Enter is a bill nobody checked. */
  function onEnter(event: React.KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey) return
    event.preventDefault()
    onAdvance(line.key)
  }

  return (
    <tr>
      <td className="purchase-table__index">{index + 1}</td>

      <td>
        {isGoods ? (
          <Combobox
            dense
            portal
            ariaLabel={`Item on line ${index + 1}`}
            placeholder="Type or scan item..."
            selectedLabel={line.label || null}
            invalid={show && Boolean(errors?.item)}
            leading={<Search size={13} aria-hidden />}
            inputRef={itemRef}
            search={searchItems}
            keyOf={(item) => item.item_id}
            emptyMessage="No items found."
            renderOption={(item) => (
              <span>
                <strong style={{ display: 'block', fontSize: 13 }}>{item.item_name}</strong>
                <small style={{ color: 'var(--billing-muted)', fontSize: 11 }}>
                  {[item.item_sku, item.hsn_sac ? `HSN ${item.hsn_sac}` : null].filter(Boolean).join(' · ') ||
                    'No SKU'}
                </small>
              </span>
            )}
            onPick={(item) => onApplyItem(item, line.key)}
            onKeyDown={onEnter}
          />
        ) : (
          <input
            type="text"
            className={`purchase-input${show && errors?.item ? ' is-invalid' : ''}`}
            aria-label={`What was bought on line ${index + 1}`}
            aria-invalid={show && Boolean(errors?.item)}
            placeholder="What was bought…"
            value={line.label}
            ref={itemRef}
            onChange={(event) => onPatch(line.key, { label: event.target.value })}
            onKeyDown={onEnter}
          />
        )}

        {show && errors?.item && (
          <span className="purchase-table__meta" style={{ color: 'var(--billing-danger)' }} role="alert">
            {errors.item}
          </span>
        )}

        {!errors?.item && line.itemId !== null && (
          <>
            {stock && (
              <span className="purchase-table__meta purchase-table__meta--stock">
                In stock: {stock.qty}
                {stock.unit ? ` ${stock.unit}` : ''}
              </span>
            )}
            {!stock && line.hsnSac && <span className="purchase-table__meta">HSN {line.hsnSac}</span>}
          </>
        )}
      </td>

      <td>
        <input
          type="text"
          className="purchase-input"
          aria-label={`Description on line ${index + 1}`}
          placeholder="e.g. Blue Pen"
          value={line.description}
          onChange={(event) => onPatch(line.key, { description: event.target.value })}
          onKeyDown={onEnter}
        />
      </td>

      <td>
        <input
          type="text"
          inputMode="decimal"
          className={`purchase-input purchase-input--money${show && errors?.qty ? ' is-invalid' : ''}`}
          aria-label={`Quantity on line ${index + 1}`}
          aria-invalid={show && Boolean(errors?.qty)}
          value={line.qty}
          onChange={(event) => onPatch(line.key, { qty: event.target.value })}
          onKeyDown={onEnter}
        />
        {show && errors?.qty && (
          <span className="purchase-table__meta" style={{ color: 'var(--billing-danger)' }} role="alert">
            {errors.qty}
          </span>
        )}
      </td>

      <td>
        <select
          className="purchase-select"
          aria-label={`Unit on line ${index + 1}`}
          value={line.unitId === null ? '' : String(line.unitId)}
          disabled={!isGoods || uoms.length === 0}
          onChange={(event) =>
            onPatch(line.key, { unitId: event.target.value === '' ? null : Number(event.target.value) })
          }
        >
          <option value="">{uoms.length === 0 ? '—' : 'Unit'}</option>
          {uoms.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.name}
            </option>
          ))}
        </select>
      </td>

      <td>
        <input
          type="text"
          inputMode="decimal"
          className={`purchase-input purchase-input--money${show && errors?.rate ? ' is-invalid' : ''}`}
          aria-label={`Rate on line ${index + 1}`}
          aria-invalid={show && Boolean(errors?.rate)}
          placeholder="0.00"
          value={line.rate}
          // Only a human typing over the rate counts as an override; the
          // backend checks `rate.override` against exactly this flag.
          onChange={(event) => onPatch(line.key, { rate: event.target.value, rateWasChanged: true })}
          onKeyDown={onEnter}
        />
        {show && errors?.rate && (
          <span className="purchase-table__meta" style={{ color: 'var(--billing-danger)' }} role="alert">
            {errors.rate}
          </span>
        )}
      </td>

      {mayDiscount && (
        <td>
          <input
            type="text"
            inputMode="decimal"
            className="purchase-input purchase-input--money"
            aria-label={`Discount percent on line ${index + 1}`}
            value={line.discountPc}
            onChange={(event) => onPatch(line.key, { discountPc: event.target.value })}
            onKeyDown={onEnter}
          />
        </td>
      )}

      <td>
        <select
          className={`purchase-select${show && errors?.tax ? ' is-invalid' : ''}`}
          aria-label={`GST rate on line ${index + 1}`}
          aria-invalid={show && Boolean(errors?.tax)}
          value={line.taxCatId}
          disabled={taxRates.length === 0}
          onChange={(event) => onPatch(line.key, { taxCatId: event.target.value })}
        >
          <option value="">{taxRates.length === 0 ? '—' : 'GST'}</option>
          {taxRates.map((rate) => (
            <option key={rate.id} value={rate.id}>
              {taxLabel(rate)}
            </option>
          ))}
        </select>
        {show && errors?.tax && (
          <span className="purchase-table__meta" style={{ color: 'var(--billing-danger)' }} role="alert">
            {errors.tax}
          </span>
        )}
      </td>

      <td className="purchase-table__amount is-num">
        {totals.tax === null ? <span style={{ color: 'var(--billing-muted)' }}>—</span> : money(totals.tax)}
      </td>

      <td className="purchase-table__amount purchase-table__amount--total is-num">{money(totals.total)}</td>

      <td className="purchase-table__actions">
        <button
          type="button"
          className="purchase-iconbtn purchase-iconbtn--danger"
          onClick={() => onRemove(line.key)}
          disabled={!canRemove}
          title={canRemove ? 'Remove this line' : 'A purchase needs at least one line'}
          aria-label={`Remove line ${index + 1}`}
        >
          <Trash2 size={15} aria-hidden />
        </button>
      </td>
    </tr>
  )
}

export const PurchaseItemRow = memo(PurchaseItemRowInner)
