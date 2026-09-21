/**
 * What is coming back, or what is being adjusted.
 *
 * The table changes shape with the mode, because the two modes are genuinely
 * different documents: goods coming back need a warehouse and a condition and
 * a value adjustment must not have either. Hiding those columns is not
 * cosmetic — a warehouse on a value-only note is the one field that could make
 * Inventory move stock nobody said came back.
 *
 * Every item in here is Inventory's. The lines proposed from the bill are
 * Books' reading of that bill. Nothing on this screen is a local catalogue.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FileText,
  Package,
  Plus,
  ScanLine,
  Search,
  Trash2,
  Wrench,
} from 'lucide-react'
import { useTypeahead } from '../../components/LivePicker'
import { api } from '../../services/api'
import type { CatalogItem, OriginalDocumentLine } from '../../services/types'
import { money, qty as formatQty } from '../../ui'
import {
  lineAmount,
  RETURN_CONDITIONS,
  type CreditLine,
  type CreditNoteErrors,
  type ReturnMode,
} from './creditNote'

export interface WarehouseOption {
  id: string
  name: string
}

export interface CreditNoteLinesProps {
  lines: CreditLine[]
  mode: ReturnMode
  errors: CreditNoteErrors
  showErrors: boolean
  warehouses: WarehouseOption[]
  warehousesLoading: boolean
  mayDiscount: boolean
  /** Lines on the bill that are not on the note yet. Empty when there is no bill. */
  remainingFromBill: OriginalDocumentLine[]
  /** True once a bill is chosen and Books gave lines for it. */
  billLinesAvailable: boolean
  /** Null until a customer and bill are chosen — the table shows why instead. */
  emptyReason: 'no-customer' | 'no-bill' | 'no-lines' | null
  /** The line just added, so the cursor lands in it rather than nowhere. */
  focusKey: string | null
  onPatchLine: (key: string, patch: Partial<CreditLine>) => void
  onRemoveLine: (key: string) => void
  onAddBlankLine: () => void
  onAddFromBill: (line: OriginalDocumentLine) => void
  onAddAllFromBill: () => void
  onScan: (code: string) => void
  scanning: boolean
  onChooseCustomer: () => void
  onChooseBill: () => void
}

export function CreditNoteLines(props: CreditNoteLinesProps) {
  const { lines, mode, errors, showErrors, mayDiscount, remainingFromBill } = props
  const goodsReturn = mode === 'GOODS_RETURN'
  const [scanOpen, setScanOpen] = useState(false)
  const [billOpen, setBillOpen] = useState(false)

  // Warehouse and condition only exist for goods coming back; the discount
  // column only for somebody allowed to give one. The backend checks that
  // again, because the column appearing is a courtesy and not a control.

  return (
    <section className="billing-cn-card" aria-labelledby="billing-cn-lines-title">
      <div className="billing-cn-card__head">
        <div>
          <h2 id="billing-cn-lines-title">{goodsReturn ? 'Items coming back' : 'What is being adjusted'}</h2>
          <p>
            {goodsReturn
              ? 'The goods on this credit note. Quantities start at what was billed.'
              : 'The value being credited. Nothing here goes back into stock.'}
          </p>
        </div>

        <div className="billing-cn-card__actions">
          {props.billLinesAvailable && remainingFromBill.length > 0 && (
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="billing-button billing-button--small"
                onClick={() => setBillOpen((open) => !open)}
                aria-expanded={billOpen}
                aria-haspopup="menu"
                title="Add a line that was on the bill"
              >
                <FileText size={14} aria-hidden /> From the bill ({remainingFromBill.length})
              </button>
              {billOpen && (
                <FromBillMenu
                  lines={remainingFromBill}
                  onPick={(line) => {
                    props.onAddFromBill(line)
                    setBillOpen(false)
                  }}
                  onPickAll={() => {
                    props.onAddAllFromBill()
                    setBillOpen(false)
                  }}
                  onClose={() => setBillOpen(false)}
                />
              )}
            </div>
          )}

          {goodsReturn && (
            <button
              type="button"
              className="billing-button billing-button--small"
              onClick={() => setScanOpen((open) => !open)}
              aria-expanded={scanOpen}
              title="Add an item by its barcode"
            >
              <ScanLine size={14} aria-hidden /> Scan
            </button>
          )}

          <button
            type="button"
            className="billing-button billing-button--primary billing-button--small"
            onClick={props.onAddBlankLine}
          >
            <Plus size={14} aria-hidden /> Add item
          </button>
        </div>
      </div>

      {scanOpen && (
        <ScanRow
          busy={props.scanning}
          onScan={(code) => props.onScan(code)}
          onClose={() => setScanOpen(false)}
        />
      )}

      {lines.length === 0 ? (
        <EmptyState
          reason={props.emptyReason}
          goodsReturn={goodsReturn}
          onChooseCustomer={props.onChooseCustomer}
          onChooseBill={props.onChooseBill}
          onAddBlankLine={props.onAddBlankLine}
        />
      ) : (
        <>
          <div className="billing-cn-table__scroll">
            <table className="billing-cn-table">
              <caption className="billing-sr-only">
                {goodsReturn ? 'Items being returned on this credit note' : 'Lines being adjusted on this credit note'}
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="billing-cn-table__index">
                    #
                  </th>
                  <th scope="col">Item</th>
                  <th scope="col">{goodsReturn ? 'SKU / batch' : 'SKU'}</th>
                  <th scope="col" className="billing-cn-table__num">
                    {goodsReturn ? 'Qty back' : 'Credit qty'}
                  </th>
                  <th scope="col" className="billing-cn-table__num">
                    Rate (₹)
                  </th>
                  {mayDiscount && (
                    <th scope="col" className="billing-cn-table__num">
                      Disc %
                    </th>
                  )}
                  <th scope="col">Tax</th>
                  {goodsReturn && <th scope="col">Warehouse</th>}
                  {goodsReturn && <th scope="col">Condition</th>}
                  <th scope="col" className="billing-cn-table__num billing-cn-table__amount">
                    Amount (₹)
                  </th>
                  <th scope="col" className="billing-cn-table__actions">
                    <span className="billing-sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <LineRow
                    key={line.key}
                    line={line}
                    index={index}
                    goodsReturn={goodsReturn}
                    mayDiscount={mayDiscount}
                    warehouses={props.warehouses}
                    warehousesLoading={props.warehousesLoading}
                    problems={showErrors ? errors.byLine[line.key] : undefined}
                    autoFocus={line.key === props.focusKey}
                    onPatch={props.onPatchLine}
                    onRemove={props.onRemoveLine}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <button type="button" className="billing-cn-addline" onClick={props.onAddBlankLine}>
            <Plus size={14} aria-hidden /> Add another item
          </button>
        </>
      )}

      {showErrors && errors.lines && (
        <p className="billing-cn-footnote" style={{ color: 'var(--billing-danger)', fontWeight: 600 }} role="alert">
          {errors.lines}
        </p>
      )}

      <p className="billing-cn-footnote">
        Amounts are before tax — Smart Books works out the GST on this note the same way it did on the bill.
        {goodsReturn && (
          <>
            {' '}
            The condition is Billing’s own note about what came back: it is kept with the credit note and sent on, and
            Inventory decides what it does with the stock.
          </>
        )}
      </p>
    </section>
  )
}

function LineRow({
  line,
  index,
  goodsReturn,
  mayDiscount,
  warehouses,
  warehousesLoading,
  problems,
  autoFocus,
  onPatch,
  onRemove,
}: {
  line: CreditLine
  index: number
  goodsReturn: boolean
  mayDiscount: boolean
  warehouses: WarehouseOption[]
  warehousesLoading: boolean
  problems: Partial<Record<'item' | 'qty' | 'rate' | 'discountPc' | 'warehouse', string>> | undefined
  autoFocus: boolean
  onPatch: (key: string, patch: Partial<CreditLine>) => void
  onRemove: (key: string) => void
}) {
  const label = line.name || line.description || `line ${index + 1}`
  const stockable = goodsReturn && line.stockable

  return (
    <tr>
      <td className="billing-cn-table__index">{index + 1}</td>

      <td>
        <ItemCell line={line} onPatch={onPatch} error={problems?.item} autoFocus={autoFocus} />
      </td>

      <td>
        {line.sku ? <strong>{line.sku}</strong> : <span className="billing-cn-table__sub">No SKU</span>}
        {stockable && (
          <input
            className="billing-cn-control"
            style={{ marginTop: 4, minHeight: 30 }}
            value={line.batchNo}
            placeholder="Batch"
            aria-label={`Batch for ${label}`}
            onChange={(event) => onPatch(line.key, { batchNo: event.target.value })}
          />
        )}
        {!stockable && line.batchNo && <span className="billing-cn-table__sub">{line.batchNo}</span>}
      </td>

      <td className="billing-cn-table__num">
        <input
          className="billing-cn-control billing-cn-table__qty num"
          value={line.qty}
          inputMode="decimal"
          aria-label={`Quantity for ${label}`}
          aria-invalid={problems?.qty ? true : undefined}
          onChange={(event) => onPatch(line.key, { qty: event.target.value })}
        />
        {line.invoiceQty !== null && (
          <span className="billing-cn-table__sub">of {formatQty(line.invoiceQty)} billed</span>
        )}
        {problems?.qty && <span className="billing-cn-table__error">{problems.qty}</span>}
      </td>

      <td className="billing-cn-table__num">
        <input
          className="billing-cn-control billing-cn-table__rate num"
          value={line.rate}
          inputMode="decimal"
          aria-label={`Rate for ${label}`}
          aria-invalid={problems?.rate ? true : undefined}
          onChange={(event) => onPatch(line.key, { rate: event.target.value, rateWasChanged: true })}
        />
        {problems?.rate && <span className="billing-cn-table__error">{problems.rate}</span>}
      </td>

      {mayDiscount && (
        <td className="billing-cn-table__num">
          <input
            className="billing-cn-control billing-cn-table__disc num"
            value={line.discountPc}
            inputMode="decimal"
            aria-label={`Discount percent for ${label}`}
            aria-invalid={problems?.discountPc ? true : undefined}
            onChange={(event) => onPatch(line.key, { discountPc: event.target.value })}
          />
          {problems?.discountPc && <span className="billing-cn-table__error">{problems.discountPc}</span>}
        </td>
      )}

      <td>
        {line.taxRate !== null ? (
          <strong>{formatQty(line.taxRate)}%</strong>
        ) : (
          <span className="billing-cn-table__sub" title="Smart Books applies the treatment this item is set up with">
            By Books
          </span>
        )}
      </td>

      {goodsReturn && (
        <td>
          {stockable ? (
            <>
              <select
                className="billing-cn-control billing-cn-table__place"
                value={line.warehouseId}
                aria-label={`Warehouse for ${label}`}
                aria-invalid={problems?.warehouse ? true : undefined}
                disabled={warehousesLoading || warehouses.length === 0}
                onChange={(event) => onPatch(line.key, { warehouseId: event.target.value })}
              >
                <option value="">
                  {warehousesLoading
                    ? 'Reading…'
                    : warehouses.length === 0
                      ? 'None set up'
                      : 'Choose…'}
                </option>
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </option>
                ))}
              </select>
              {problems?.warehouse && <span className="billing-cn-table__error">{problems.warehouse}</span>}
            </>
          ) : (
            <span className="billing-cn-table__sub">Not stock</span>
          )}
        </td>
      )}

      {goodsReturn && (
        <td>
          {stockable ? (
            <select
              className="billing-cn-control billing-cn-table__place"
              value={line.condition}
              aria-label={`Condition of ${label}`}
              onChange={(event) => onPatch(line.key, { condition: event.target.value })}
            >
              <option value="">Not said</option>
              {RETURN_CONDITIONS.map((condition) => (
                <option key={condition} value={condition}>
                  {condition}
                </option>
              ))}
            </select>
          ) : (
            <span className="billing-cn-table__sub">—</span>
          )}
        </td>
      )}

      <td className="billing-cn-table__num billing-cn-table__amount">{money(lineAmount(line))}</td>

      <td className="billing-cn-table__actions">
        <button
          type="button"
          className="billing-cn-rowbutton"
          onClick={() => onRemove(line.key)}
          aria-label={`Remove ${label} from this credit note`}
          title="Remove this line"
        >
          <Trash2 size={15} aria-hidden />
        </button>
      </td>
    </tr>
  )
}

/**
 * The item on a line: a chosen one, or the search that finds it.
 *
 * Typing without choosing is not a dead end — the text becomes the line's
 * description, which is how a delivery charge or a rounding correction gets
 * onto a note without inventing an item for it in Inventory.
 */
function ItemCell({
  line,
  onPatch,
  error,
  autoFocus,
}: {
  line: CreditLine
  onPatch: (key: string, patch: Partial<CreditLine>) => void
  error?: string
  autoFocus?: boolean
}) {
  const search = useMemo(
    () => async (term: string, signal: AbortSignal) => {
      const response = await api.list<CatalogItem>('v1/catalog/items/search', { q: term }, signal)
      return response.data
    },
    [],
  )

  const picker = useTypeahead<CatalogItem>({
    search,
    onPick: (item) =>
      onPatch(line.key, {
        itemId: item.item_id,
        name: item.item_name,
        sku: item.item_sku,
        hsnSac: item.hsn_sac,
        unitId: item.unit_id,
        description: item.item_name,
        rate: item.mrp ?? line.rate,
        stockable: true,
        rateWasChanged: false,
      }),
  })

  if (line.itemId !== null) {
    return (
      <div className="billing-cn-item">
        <span className="billing-cn-item__icon" aria-hidden>
          <Package size={15} />
        </span>
        <span className="billing-cn-item__body">
          <strong>{line.name}</strong>
          {line.unitName && <span>in {line.unitName}</span>}
        </span>
      </div>
    )
  }

  // A described line that is not an item — a charge, an adjustment, a service.
  if (line.description.trim() !== '' && picker.term === '') {
    return (
      <div className="billing-cn-item">
        <span className="billing-cn-item__icon billing-cn-item__icon--service" aria-hidden>
          <Wrench size={15} />
        </span>
        <span className="billing-cn-item__body">
          <input
            className="billing-cn-control"
            value={line.description}
            aria-label="What is being credited on this line"
            onChange={(event) => onPatch(line.key, { description: event.target.value, stockable: false })}
          />
        </span>
      </div>
    )
  }

  return (
    <div className="billing-cn-combo" ref={picker.boxRef} style={{ minWidth: 190 }}>
      <div className="billing-cn-combo__input">
        <span className="billing-cn-combo__icon" aria-hidden>
          <Search size={14} />
        </span>
        <input
          className="billing-cn-control"
          value={picker.term}
          autoFocus={autoFocus}
          placeholder="Search an item, or describe it…"
          aria-label="Item on this line"
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          onChange={(event) => {
            picker.setTerm(event.target.value)
            picker.setOpen(true)
            // Whatever is typed is the line's description until an item is
            // chosen, so a line is never lost to a dropdown nobody opened.
            onPatch(line.key, { description: event.target.value, stockable: false })
          }}
          onFocus={() => picker.setOpen(true)}
          onKeyDown={picker.onKeyDown}
        />
      </div>

      {picker.open && picker.ready && (
        <div className="billing-cn-combo__list" role="listbox" aria-label="Items">
          {picker.busy && <p className="billing-cn-combo__note">Searching…</p>}
          {picker.failed && (
            <p className="billing-cn-combo__note billing-cn-combo__note--bad">
              Could not reach Inventory. The line can still be described in words.
            </p>
          )}
          {!picker.busy && !picker.failed && picker.options.length === 0 && (
            <p className="billing-cn-combo__note">No item matches. Leave it as typed to credit it as a charge.</p>
          )}
          {picker.options.map((item, index) => (
            <button
              key={item.item_id}
              type="button"
              role="option"
              aria-selected={index === picker.highlighted}
              data-active={index === picker.highlighted}
              className="billing-cn-combo__option"
              onMouseEnter={() => picker.setHighlighted(index)}
              onClick={() => picker.choose(item)}
            >
              <span className="billing-cn-combo__line">
                <strong>{item.item_name}</strong>
                {item.mrp && <span className="billing-cn-combo__meta">{money(item.mrp)}</span>}
              </span>
              {item.item_sku && <span className="billing-cn-combo__meta">{item.item_sku}</span>}
            </button>
          ))}
        </div>
      )}

      {error && <span className="billing-cn-table__error">{error}</span>}
    </div>
  )
}

/** The lines that were on the bill and are not on the note yet. */
function FromBillMenu({
  lines,
  onPick,
  onPickAll,
  onClose,
}: {
  lines: OriginalDocumentLine[]
  onPick: (line: OriginalDocumentLine) => void
  onPickAll: () => void
  onClose: () => void
}) {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      // The trigger is the menu's own sibling, so closing on a click anywhere
      // outside the menu would fight the toggle. The parent handles that.
      if (box.current && !box.current.parentElement?.contains(event.target as Node)) onClose()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <div
      ref={box}
      className="billing-cn-combo__list"
      style={{ width: 'min(22rem, 78vw)', right: 0, left: 'auto' }}
      role="menu"
    >
      <button type="button" role="menuitem" className="billing-cn-combo__option" onClick={onPickAll}>
        <span className="billing-cn-combo__line">
          <strong>Add all {lines.length} remaining</strong>
        </span>
      </button>
      {lines.map((line) => (
        <button
          key={line.line_ref}
          type="button"
          role="menuitem"
          className="billing-cn-combo__option"
          onClick={() => onPick(line)}
        >
          <span className="billing-cn-combo__line">
            <strong>{line.item_name ?? 'Line ' + line.line_ref}</strong>
            <span className="billing-cn-combo__meta billing-cn-combo__meta--strong">
              {line.amount === null ? '—' : money(line.amount)}
            </span>
          </span>
          <span className="billing-cn-combo__line">
            <span className="billing-cn-combo__meta">
              {line.qty === null ? 'No quantity' : `${formatQty(line.qty)} billed`}
              {line.rate !== null && ` at ${money(line.rate)}`}
            </span>
            {line.sku && <span className="billing-cn-combo__meta">{line.sku}</span>}
          </span>
        </button>
      ))}
    </div>
  )
}

/** Scan to credit: the barcode goes straight to Inventory, as it does on a bill. */
function ScanRow({ busy, onScan, onClose }: { busy: boolean; onScan: (code: string) => void; onClose: () => void }) {
  const [code, setCode] = useState('')

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '12px 18px 0' }}>
      <input
        className="billing-cn-control"
        value={code}
        autoFocus
        placeholder="Scan or type a barcode…"
        aria-label="Barcode of the item coming back"
        disabled={busy}
        onChange={(event) => setCode(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && code.trim() !== '') {
            event.preventDefault()
            onScan(code.trim())
            setCode('')
          }
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
          }
        }}
      />
      <button
        type="button"
        className="billing-button"
        disabled={busy || code.trim() === ''}
        onClick={() => {
          onScan(code.trim())
          setCode('')
        }}
      >
        {busy ? 'Looking…' : 'Add'}
      </button>
      <button type="button" className="billing-button billing-button--quiet" onClick={onClose}>
        Done
      </button>
    </div>
  )
}

function EmptyState({
  reason,
  goodsReturn,
  onChooseCustomer,
  onChooseBill,
  onAddBlankLine,
}: {
  reason: 'no-customer' | 'no-bill' | 'no-lines' | null
  goodsReturn: boolean
  onChooseCustomer: () => void
  onChooseBill: () => void
  onAddBlankLine: () => void
}) {
  const copy = {
    'no-customer': {
      title: 'Start with the customer',
      body: 'Choose the customer and the bill above, and the items on that bill appear here ready to credit.',
      action: 'Choose the customer',
      onAction: onChooseCustomer,
    },
    'no-bill': {
      title: 'Choose the bill being credited',
      body: 'Pick the bill above and its items appear here, with the quantities and rates the customer was charged.',
      action: 'Choose the bill',
      onAction: onChooseBill,
    },
    'no-lines': {
      title: 'Smart Books gave no lines for that bill',
      body: 'The bill is still linked to this note. Add what is being credited yourself.',
      action: goodsReturn ? 'Add an item' : 'Add a line',
      onAction: onAddBlankLine,
    },
    empty: {
      title: goodsReturn ? 'Nothing on this note yet' : 'Nothing to adjust yet',
      body: goodsReturn
        ? 'Add the items that came back, or take them from the bill.'
        : 'Add the lines whose value is being corrected.',
      action: goodsReturn ? 'Add an item' : 'Add a line',
      onAction: onAddBlankLine,
    },
  }[reason ?? 'empty']

  return (
    <div className="billing-cn-empty">
      <span className="billing-cn-empty__icon" aria-hidden>
        <FileText size={24} />
      </span>
      <strong>{copy.title}</strong>
      <p>{copy.body}</p>
      <button type="button" className="billing-button billing-button--primary" onClick={copy.onAction}>
        {copy.action}
      </button>
    </div>
  )
}

/** Exported for the page, which decides whether a scanned item can be added. */
export function scannedItemToPatch(item: CatalogItem): Partial<CreditLine> {
  return {
    itemId: item.item_id,
    name: item.item_name,
    sku: item.item_sku,
    hsnSac: item.hsn_sac,
    unitId: item.unit_id,
    description: item.item_name,
    rate: item.mrp ?? '0',
    qty: '1',
    stockable: true,
  }
}
