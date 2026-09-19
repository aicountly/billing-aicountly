/**
 * Items.
 *
 * Read-through: an item is a record in Aicountly Inventory and is not copied
 * here. That is why this screen searches rather than lists everything — there
 * is no local table to page through, and asking the owning product on each
 * request is the only way the list cannot be stale.
 *
 * Creating an item is deliberately not offered here. That master belongs to
 * Inventory, and a second place to create it is a second place for the same
 * item to exist under two names.
 *
 * Parties followed the same rule and outgrew this file; they now live in
 * `pages/parties`, reading the same way from Smart Books.
 */

import { useState } from 'react'
import { Search } from 'lucide-react'
import { api } from '../services/api'
import { useApi } from '../hooks/useApi'
import { useBilling } from '../context/BillingContext'
import type { CatalogItem } from '../services/types'
import { Card, DataTable, money, Notice } from '../ui'

export function Items() {
  const { scope, can } = useBilling()
  const [term, setTerm] = useState('')
  const [applied, setApplied] = useState('')

  const items = useApi(
    (signal) => api.list<CatalogItem>('v1/catalog/items', { q: applied || undefined, limit: 50 }, signal),
    [applied, scope?.cmp_id, scope?.fy_id],
    Boolean(scope),
  )

  const lowStock = useApi(
    (signal) => api.get<{ data: Array<Record<string, unknown>> }>('v1/catalog/low-stock', { limit: 10 }, signal),
    [scope?.cmp_id, scope?.fy_id],
    Boolean(scope),
  )

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div className="billing-page-heading">
        <div>
          <h1>Items</h1>
          <p>
            From Aicountly Inventory, read as you search. Rates and stock live there;{' '}
            {can('cost.view') ? 'cost is shown because your profile allows it.' : 'cost is not part of your Billing profile.'}
          </p>
        </div>
      </div>

      <Card>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            setApplied(term.trim())
          }}
          style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}
        >
          <div className="billing-search" style={{ flex: 1, maxWidth: 'none' }}>
            <Search size={15} className="billing-search__icon" aria-hidden />
            <label className="billing-sr-only" htmlFor="item-search">Search items</label>
            <input
              id="item-search"
              className="billing-search__input"
              type="search"
              placeholder="Item name, SKU or HSN…"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
            />
          </div>
          <button type="submit" className="billing-button billing-button--primary">Search</button>
        </form>

        {items.error && <Notice tone="danger" title="Could not read the list">{items.error}</Notice>}

        <DataTable
          loading={items.loading}
          rows={items.data?.data ?? []}
          rowKey={(row) => row.item_id}
          empty={applied ? `Nothing matched “${applied}”.` : 'No items yet.'}
          columns={[
            { key: 'name', header: 'Item', render: (row) => row.item_name },
            { key: 'sku', header: 'SKU', render: (row) => row.item_sku ?? '—' },
            { key: 'hsn', header: 'HSN/SAC', render: (row) => row.hsn_sac ?? '—' },
            { key: 'mrp', header: 'Rate', numeric: true, render: (row) => (row.mrp ? money(Number(row.mrp)) : '—') },
          ]}
        />
      </Card>

      {(lowStock.data?.data ?? []).length > 0 && (
        <Card title="Running low">
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {(lowStock.data?.data ?? []).slice(0, 10).map((row, index) => (
              <li key={index}>
                {String(row.item_name ?? `Item #${row.item_id}`)}
                {row.available_qty !== undefined && (
                  <span style={{ color: 'var(--muted)' }}> — {String(row.available_qty)} left</span>
                )}
              </li>
            ))}
          </ul>
          <p style={{ color: 'var(--muted)', fontSize: '0.78rem', marginTop: '0.6rem', marginBottom: 0 }}>
            From Aicountly Inventory, read just now.
          </p>
        </Card>
      )}
    </div>
  )
}
