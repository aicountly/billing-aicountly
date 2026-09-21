/**
 * The lines, and the speed of entering them.
 *
 * The grid is where a purchase is actually typed, so it owns the keyboard: Enter
 * moves to the next line (creating one at the end), Add line focuses the field
 * it just created, and a line only counts as started once something is in it.
 * Blank trailing rows are never errors — leaving one ready is the whole point.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Package, Plus, ScanLine } from 'lucide-react'
import type { CatalogItem } from '../../services/types'
import { isLineStarted, type PurchaseForm, type PurchaseLine } from './model'
import type { TaxRate } from './gst'
import { PurchaseItemRow } from './PurchaseItemRow'
import { PurchaseSuggestionBar, type Suggestion } from './PurchaseSuggestionBar'
import type { PurchaseErrors } from './usePurchaseForm'
import type { StockHint } from './useStockHints'
import type { Uom } from './usePurchaseMasters'

export function PurchaseItemsSection({
  form,
  errors,
  showErrors,
  uoms,
  taxRates,
  taxRateById,
  taxRatesFailed,
  mayDiscount,
  stockFor,
  suggestions,
  suggestionResult,
  onOpenScan,
  onPatchLine,
  onApplyItem,
  onAddLine,
  onRemoveLine,
  onReloadTaxRates,
}: {
  form: PurchaseForm
  errors: PurchaseErrors
  showErrors: boolean
  uoms: Uom[]
  taxRates: TaxRate[]
  taxRateById: Map<number, TaxRate>
  taxRatesFailed: boolean
  mayDiscount: boolean
  stockFor: (itemId: number | null) => StockHint | null
  suggestions: Suggestion[]
  suggestionResult: string | null
  onOpenScan: () => void
  onPatchLine: (key: string, partial: Partial<PurchaseLine>) => void
  onApplyItem: (item: CatalogItem, key?: string) => void
  onAddLine: () => string
  onRemoveLine: (key: string) => void
  onReloadTaxRates: () => void
}) {
  const itemInputs = useRef(new Map<string, HTMLInputElement>())
  const [focusKey, setFocusKey] = useState<string | null>(null)

  // `advance` is handed to every row, and every row is memoised. Closing it
  // over `form.lines` would give it a new identity on each keystroke and
  // re-render all thirty rows for a digit typed in one of them, which is
  // exactly the cost the memo exists to avoid. The ref keeps the callback
  // stable while still seeing the current lines.
  const linesRef = useRef(form.lines)
  linesRef.current = form.lines

  const registerItemInput = useCallback((key: string, node: HTMLInputElement | null) => {
    if (node) itemInputs.current.set(key, node)
    else itemInputs.current.delete(key)
  }, [])

  // A line added this render cannot be focused until React has put it on the
  // page, so the request is queued and served here.
  useEffect(() => {
    if (!focusKey) return
    const node = itemInputs.current.get(focusKey)
    if (node) {
      node.focus()
      setFocusKey(null)
    }
  }, [focusKey, form.lines])

  const addLine = useCallback(() => {
    setFocusKey(onAddLine())
  }, [onAddLine])

  const advance = useCallback(
    (key: string) => {
      const lines = linesRef.current
      const index = lines.findIndex((line) => line.key === key)
      const next = lines[index + 1]
      if (next) {
        itemInputs.current.get(next.key)?.focus()
        return
      }
      // At the end of the last line, the next thing a person wants is another
      // line — unless the one they are on is still empty.
      const current = lines[index]
      if (current && !isLineStarted(current)) return
      setFocusKey(onAddLine())
    },
    [onAddLine],
  )

  const removable = form.lines.length > 1 || isLineStarted(form.lines[0] ?? ({} as PurchaseLine))

  return (
    <section className="purchase-card" aria-labelledby="purchase-items-heading">
      <div className="purchase-card__head purchase-card__head--split">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span className="purchase-card__mark" aria-hidden>
            <Package size={17} />
          </span>
          <div>
            <h2 id="purchase-items-heading">Items</h2>
            <p>Add items to this purchase. GST and totals are calculated automatically.</p>
          </div>
        </div>

        <div className="purchase-card__actions">
          <button type="button" className="purchase-btn" onClick={onOpenScan}>
            <ScanLine size={15} aria-hidden />
            Scan / Import
          </button>
          <button type="button" className="purchase-btn purchase-btn--outline" onClick={addLine}>
            <Plus size={15} aria-hidden />
            Add line
          </button>
        </div>
      </div>

      {showErrors && errors.items && (
        <p className="purchase-field__error" role="alert" style={{ marginBottom: 10 }}>
          {errors.items}
        </p>
      )}

      {taxRatesFailed && (
        <p className="purchase-field__hint" style={{ marginBottom: 10 }}>
          Couldn’t load GST rates from Smart Books.{' '}
          <button type="button" className="purchase-chip" onClick={onReloadTaxRates}>
            Retry
          </button>
        </p>
      )}

      <div className="purchase-table-scroll">
        <table className="purchase-table">
          <thead>
            <tr>
              <th scope="col" className="purchase-table__index">
                #
              </th>
              <th scope="col" className="purchase-col-item">
                {form.purchaseType === 'goods' ? 'Item *' : 'What was bought *'}
              </th>
              <th scope="col" className="purchase-col-desc">
                Description
              </th>
              <th scope="col" className="purchase-col-qty">
                Qty *
              </th>
              <th scope="col" className="purchase-col-unit">
                Unit
              </th>
              <th scope="col" className="purchase-col-rate">
                Rate (₹) *
              </th>
              {mayDiscount && (
                <th scope="col" className="purchase-col-disc">
                  Disc %
                </th>
              )}
              <th scope="col" className="purchase-col-gst">
                GST %
              </th>
              <th scope="col" className="purchase-col-tax is-num">
                Tax Amt (₹)
              </th>
              <th scope="col" className="purchase-col-total is-num">
                Total (₹)
              </th>
              <th scope="col" className="purchase-table__actions">
                <span className="billing-sr-only">Remove</span>
              </th>
            </tr>
          </thead>

          <tbody>
            {form.lines.map((line, index) => (
              <PurchaseItemRow
                key={line.key}
                index={index}
                line={line}
                errors={errors.lines[line.key]}
                showErrors={showErrors}
                purchaseType={form.purchaseType}
                uoms={uoms}
                taxRates={taxRates}
                taxRateById={taxRateById}
                mayDiscount={mayDiscount}
                stock={stockFor(line.itemId)}
                canRemove={removable}
                registerItemInput={registerItemInput}
                onPatch={onPatchLine}
                onApplyItem={onApplyItem}
                onRemove={onRemoveLine}
                onAdvance={advance}
              />
            ))}
          </tbody>
        </table>
      </div>

      <PurchaseSuggestionBar suggestions={suggestions} result={suggestionResult} />
    </section>
  )
}
