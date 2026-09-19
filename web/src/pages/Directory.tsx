/**
 * Parties.
 *
 * Read-through: a customer is a ledger account in Smart Books and is not copied
 * here. That is why this screen searches rather than lists everything — there
 * is no local table to page through, and asking Books on each request is the
 * only way the list cannot be stale.
 *
 * Creating a customer is deliberately not offered here. That master belongs to
 * Books, and a second place to create it is a second place for the same
 * customer to exist under two names.
 *
 * Items follow the same rule against Inventory and have outgrown this file;
 * they live in `pages/items`.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { api } from '../services/api'
import { useApi } from '../hooks/useApi'
import { useBilling } from '../context/BillingContext'
import type { CatalogParty } from '../services/types'
import { Card, DataTable, Notice } from '../ui'

export function Parties() {
  const { scope, can } = useBilling()
  const [side, setSide] = useState<'customer' | 'supplier'>('customer')
  const [term, setTerm] = useState('')
  const [applied, setApplied] = useState('')

  const parties = useApi(
    (signal) => api.list<CatalogParty>('v1/catalog/parties', { side, q: applied || undefined, limit: 50 }, signal),
    [side, applied, scope?.cmp_id, scope?.fy_id],
    Boolean(scope),
  )

  const maySeeSuppliers = can('purchase.view') || can('payable.view')

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div className="billing-page-heading">
        <div>
          <h1>Parties</h1>
          <p>Customers and suppliers, as Smart Books holds them. Billing keeps no copy.</p>
        </div>
      </div>

      <Card
        action={
          maySeeSuppliers && (
            <div className="billing-segmented" role="group" aria-label="Which parties">
              <button
                type="button"
                className="billing-segmented__option"
                aria-pressed={side === 'customer'}
                onClick={() => setSide('customer')}
              >
                Customers
              </button>
              <button
                type="button"
                className="billing-segmented__option"
                aria-pressed={side === 'supplier'}
                onClick={() => setSide('supplier')}
              >
                Suppliers
              </button>
            </div>
          )
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            setApplied(term.trim())
          }}
          style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}
        >
          <div className="billing-search" style={{ flex: 1, maxWidth: 'none' }}>
            <Search size={15} className="billing-search__icon" aria-hidden />
            <label className="billing-sr-only" htmlFor="party-search">Search parties</label>
            <input
              id="party-search"
              className="billing-search__input"
              type="search"
              placeholder="Name, phone or GSTIN…"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
            />
          </div>
          <button type="submit" className="billing-button billing-button--primary">Search</button>
        </form>

        {parties.error && <Notice tone="danger" title="Could not read the list">{parties.error}</Notice>}

        <DataTable
          loading={parties.loading}
          rows={parties.data?.data ?? []}
          rowKey={(row) => row.acc_id}
          empty={applied ? `Nothing matched “${applied}”.` : 'No parties yet.'}
          columns={[
            {
              key: 'name',
              header: 'Name',
              render: (row) => <Link to={`/parties/${row.acc_id}`}>{row.acc_name}</Link>,
            },
            { key: 'gstin', header: 'GSTIN', render: (row) => row.gstin ?? '—' },
            {
              key: 'statement',
              header: '',
              render: (row) => (
                <Link to={`/parties/${row.acc_id}`} className="billing-button billing-button--small">
                  Statement
                </Link>
              ),
            },
          ]}
        />
      </Card>
    </div>
  )
}
