/**
 * The same page of items as cards.
 *
 * One data hook, two renderings: this component receives the rows the table
 * would have drawn and adds no request, no filter and no sort of its own, so
 * the two views cannot drift into showing different catalogues.
 */

import { ExternalLink } from 'lucide-react'
import { money } from '../../ui'
import type { CatalogItem, CatalogItemView } from '../../services/types'
import { ItemThumb, StatusPill, StockCell, TypeBadge } from './parts'
import type { ItemRowLinks } from './ItemsTable'

export function ItemsGrid({
  rows,
  view,
  onOpen,
  links,
  currency,
}: {
  rows: CatalogItem[]
  view: (row: CatalogItem) => CatalogItemView
  onOpen: (row: CatalogItem) => void
  links: (item: CatalogItemView) => ItemRowLinks
  currency: string
}) {
  return (
    <ul className="items-grid">
      {rows.map((row, index) => {
        const item = view(row)
        const rowLinks = links(item)

        return (
          <li key={item.id ?? `card-${index}`} className={item.status === 'inactive' ? 'items-card items-card--inactive' : 'items-card'}>
            <button type="button" className="items-card__open" onClick={() => onOpen(row)}>
              <ItemThumb view={item} size="lg" />
              <span className="items-card__head">
                <strong>{item.name ?? 'Unnamed item'}</strong>
                {item.description && <span className="items-card__detail">{item.description}</span>}
              </span>
            </button>

            <dl className="items-card__facts">
              <div>
                <dt>SKU</dt>
                <dd className="items-mono">{item.sku ?? '—'}</dd>
              </div>
              <div>
                <dt>HSN/SAC</dt>
                <dd className="items-mono">{item.hsn_sac ?? '—'}</dd>
              </div>
              <div>
                <dt>Group</dt>
                <dd>{item.group.name ?? '—'}</dd>
              </div>
              <div>
                <dt>Stock</dt>
                <dd>
                  <StockCell stock={item.stock} />
                </dd>
              </div>
            </dl>

            <div className="items-card__foot">
              <span className="items-card__rate num">{item.rate === null ? '—' : money(item.rate, currency)}</span>
              <span className="items-card__marks">
                <TypeBadge type={item.type} />
                <StatusPill view={item} />
              </span>
            </div>

            {rowLinks.view && (
              <a className="items-card__link" href={rowLinks.view} target="_blank" rel="noreferrer">
                <ExternalLink size={13} aria-hidden /> Open in Inventory
              </a>
            )}
          </li>
        )
      })}
    </ul>
  )
}
