/**
 * One item, read from Aicountly Inventory when the row is opened.
 *
 * READ ONLY, and not as a matter of taste: this product holds no item master,
 * so there is nothing here a Save button could write to. Everything that would
 * change the record is a link into Inventory, where the record lives.
 *
 * The row already in the table is shown immediately and the full record
 * replaces it when it arrives, so opening a row never shows an empty panel
 * while a request is in flight.
 */

import { ExternalLink } from 'lucide-react'
import { Drawer } from '../../shell/Drawer'
import { useApi } from '../../hooks/useApi'
import { api } from '../../services/api'
import { money } from '../../ui'
import type { CatalogItem, CatalogItemView } from '../../services/types'
import { ItemThumb, StatusPill, StockCell, TypeBadge, formatQty } from './parts'
import type { ItemRowLinks } from './ItemsTable'

export function ItemDetailDrawer({
  row,
  onClose,
  links,
  currency,
  canSeeCost,
  scopeKey,
}: {
  row: CatalogItem | null
  onClose: () => void
  links: (item: CatalogItemView) => ItemRowLinks
  currency: string
  canSeeCost: boolean
  scopeKey: string
}) {
  const fromList = row?.catalog ?? null
  const itemId = fromList?.id ?? row?.item_id ?? null

  const full = useApi(
    (signal) => api.one<CatalogItem>(`v1/catalog/items/${itemId}`, undefined, signal),
    [itemId, scopeKey],
    itemId !== null,
  )

  // Only the record for the item that is actually open. `useApi` keeps the
  // previous response while the next is in flight, and painting that would put
  // the last item's SKU under this item's name for as long as the read takes.
  const fetched = full.data?.data?.catalog
  const item = fetched && fetched.id === itemId ? fetched : fromList
  if (!row || !item) return null

  const rowLinks = links(item)

  return (
    <Drawer open onClose={onClose} side="right" title={item.name ?? 'Item'} closeLabel="Close item details">
      <div className="items-detail">
        <div className="items-detail__head">
          <ItemThumb view={item} size="lg" />
          <div>
            <h2>{item.name ?? 'Unnamed item'}</h2>
            {item.description && <p>{item.description}</p>}
            <div className="items-detail__marks">
              <TypeBadge type={item.type} />
              <StatusPill view={item} />
            </div>
          </div>
        </div>

        {full.error && (
          <p className="items-detail__note items-detail__note--warn">
            Showing what the list returned. The full record could not be read: {full.error}
          </p>
        )}

        <dl className="items-detail__facts">
          <Fact label="SKU" value={item.sku} mono />
          <Fact label="HSN/SAC" value={item.hsn_sac} mono />
          <Fact label="Barcode" value={item.barcode} mono />
          <Fact label="Group" value={item.group.name} />
          <Fact label="Unit" value={item.unit} />
          <Fact label="Selling rate" value={item.rate === null ? null : money(item.rate, currency)} />
          {canSeeCost && item.cost !== undefined && (
            <Fact label="Cost" value={item.cost === null ? null : money(item.cost, currency)} />
          )}
          <div>
            <dt>Available</dt>
            <dd>
              <StockCell stock={item.stock} />
            </dd>
          </div>
          <Fact
            label="Reorder level"
            value={item.stock.threshold === null ? null : formatQty(item.stock.threshold)}
          />
        </dl>

        <p className="items-detail__note">
          <span className="items-live__dot" aria-hidden /> Live from Aicountly Inventory. Billing keeps no copy of
          this item, so anything changed there shows here on the next read.
        </p>

        <div className="items-detail__actions">
          {rowLinks.edit && (
            <a className="billing-button billing-button--primary" href={rowLinks.edit} target="_blank" rel="noreferrer">
              <ExternalLink size={15} aria-hidden /> Edit in Inventory
            </a>
          )}
          {rowLinks.view && (
            <a className="billing-button" href={rowLinks.view} target="_blank" rel="noreferrer">
              Open in Inventory
            </a>
          )}
        </div>
      </div>
    </Drawer>
  )
}

function Fact({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? 'items-mono' : undefined}>{value ?? '—'}</dd>
    </div>
  )
}
