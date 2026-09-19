/**
 * The catalogue as a table.
 *
 * Semantic <table> markup, because this is tabular data and a grid of divs
 * takes a screen-reader user's column headers away from them. The sort is
 * server-side: sorting a page of 25 in the browser sorts the page, not the
 * catalogue, which is the bug that looks like a feature until page two.
 *
 * Every row action that would CHANGE an item opens Aicountly Inventory. Billing
 * has no item master to write to, so an Edit button that saved something here
 * would be saving it nowhere.
 */

import { ArrowDown, ArrowUp, ChevronsUpDown, Copy, ExternalLink, MoreHorizontal, Pencil } from 'lucide-react'
import { Popover } from '../../components/Popover'
import { money } from '../../ui'
import type { CatalogItem, CatalogItemView } from '../../services/types'
import { ItemThumb, StatusPill, StockCell, TypeBadge } from './parts'
import type { ItemSort } from './useItemsQuery'

export interface ItemRowLinks {
  edit: string | null
  view: string | null
  stock: string | null
}

const COLUMNS: Array<{ key: string; label: string; sort?: ItemSort; numeric?: boolean }> = [
  { key: 'item', label: 'Item', sort: 'name' },
  { key: 'sku', label: 'SKU', sort: 'sku' },
  { key: 'hsn', label: 'HSN/SAC', sort: 'hsn_sac' },
  { key: 'type', label: 'Type' },
  { key: 'group', label: 'Group' },
  { key: 'rate', label: 'Rate', sort: 'rate', numeric: true },
  { key: 'stock', label: 'Stock', sort: 'stock' },
  { key: 'status', label: 'Status', sort: 'status' },
]

export function ItemsTable({
  rows,
  view,
  sort,
  order,
  onSort,
  selected,
  onSelect,
  onSelectAll,
  onOpen,
  links,
  currency,
  canSelect,
}: {
  rows: CatalogItem[]
  view: (row: CatalogItem) => CatalogItemView
  sort: ItemSort | ''
  order: 'asc' | 'desc'
  onSort: (column: ItemSort) => void
  selected: Set<number>
  onSelect: (id: number, on: boolean) => void
  onSelectAll: (on: boolean) => void
  onOpen: (row: CatalogItem) => void
  links: (item: CatalogItemView) => ItemRowLinks
  currency: string
  canSelect: boolean
}) {
  const selectableIds = rows.map((row) => view(row).id).filter((id): id is number => id !== null)
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id))

  return (
    <div className="billing-table-scroll">
      <table className="billing-table items-table">
        <thead>
          <tr>
            {canSelect && (
              <th className="items-table__tick">
                <input
                  type="checkbox"
                  checked={allSelected}
                  aria-label={allSelected ? 'Clear the selection' : 'Select every item on this page'}
                  onChange={(event) => onSelectAll(event.target.checked)}
                />
              </th>
            )}
            {COLUMNS.map((column) => (
              <th key={column.key} className={column.numeric ? 'billing-amount' : undefined}>
                {column.sort ? (
                  <button
                    type="button"
                    className="items-sort"
                    aria-label={`Sort by ${column.label}`}
                    onClick={() => onSort(column.sort as ItemSort)}
                  >
                    {column.label}
                    {sort === column.sort ? (
                      order === 'asc' ? (
                        <ArrowUp size={13} aria-hidden />
                      ) : (
                        <ArrowDown size={13} aria-hidden />
                      )
                    ) : (
                      <ChevronsUpDown size={13} aria-hidden className="items-sort__idle" />
                    )}
                  </button>
                ) : (
                  column.label
                )}
              </th>
            ))}
            <th className="items-table__actions">
              <span className="billing-sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const item = view(row)
            const id = item.id
            const rowLinks = links(item)

            return (
              <tr
                key={id ?? `row-${index}`}
                className={item.status === 'inactive' ? 'items-row items-row--inactive' : 'items-row'}
                onClick={() => onOpen(row)}
              >
                {canSelect && (
                  <td className="items-table__tick" onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={id !== null && selected.has(id)}
                      disabled={id === null}
                      aria-label={`Select ${item.name ?? 'this item'}`}
                      onChange={(event) => id !== null && onSelect(id, event.target.checked)}
                    />
                  </td>
                )}

                <td>
                  <div className="items-cell">
                    <ItemThumb view={item} />
                    <div className="items-cell__text">
                      <button type="button" className="items-cell__name" onClick={() => onOpen(row)}>
                        {item.name ?? 'Unnamed item'}
                      </button>
                      {item.description && <span className="items-cell__detail">{item.description}</span>}
                    </div>
                  </div>
                </td>

                <td className="items-mono">{item.sku ?? '—'}</td>
                <td className="items-mono">{item.hsn_sac ?? '—'}</td>
                <td>
                  <TypeBadge type={item.type} />
                </td>
                <td>{item.group.name ?? '—'}</td>
                <td className="billing-amount">{item.rate === null ? '—' : money(item.rate, currency)}</td>
                <td>
                  <StockCell stock={item.stock} />
                </td>
                <td>
                  <StatusPill view={item} />
                </td>

                <td className="items-table__actions" onClick={(event) => event.stopPropagation()}>
                  <div className="items-actions">
                    {rowLinks.edit && (
                      <a
                        className="items-actions__button"
                        href={rowLinks.edit}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Edit ${item.name ?? 'this item'} in Aicountly Inventory`}
                        title="Edit in Inventory"
                      >
                        <Pencil size={15} aria-hidden />
                      </a>
                    )}
                    <button
                      type="button"
                      className="items-actions__button"
                      aria-label={`Copy the SKU of ${item.name ?? 'this item'}`}
                      title={item.sku ? 'Copy SKU' : 'This item has no SKU to copy'}
                      disabled={!item.sku}
                      onClick={() => item.sku && void navigator.clipboard?.writeText(item.sku)}
                    >
                      <Copy size={15} aria-hidden />
                    </button>
                    <Popover
                      ariaLabel={`More actions for ${item.name ?? 'this item'}`}
                      triggerClassName="items-actions__button"
                      title="More actions"
                      label={<MoreHorizontal size={15} aria-hidden />}
                    >
                      {(close) => (
                        <>
                          <button
                            type="button"
                            className="billing-menu__item"
                            onClick={() => {
                              close()
                              onOpen(row)
                            }}
                          >
                            View item details
                          </button>
                          {rowLinks.view && (
                            <a className="billing-menu__item" href={rowLinks.view} target="_blank" rel="noreferrer">
                              <ExternalLink size={14} aria-hidden /> Open in Inventory
                            </a>
                          )}
                          {rowLinks.stock && item.stock.applicable && (
                            <a className="billing-menu__item" href={rowLinks.stock} target="_blank" rel="noreferrer">
                              <ExternalLink size={14} aria-hidden /> Stock details
                            </a>
                          )}
                        </>
                      )}
                    </Popover>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
