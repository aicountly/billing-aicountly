/**
 * Type-ahead pickers for records another product owns.
 *
 * Every keystroke asks Inventory (items) or Books (parties) through this
 * product's read-through endpoint. Nothing is prefetched into a local list and
 * nothing survives the choice except the id.
 *
 * The search, the keyboard handling and the dismissal all live in Combobox now,
 * so the counter's picker and the purchase grid's in-cell picker cannot drift
 * apart. What stays here is the part that is actually about this product: which
 * endpoint each one reads, and how a row from it reads to a human.
 */

import { useMemo } from 'react'
import { Search } from 'lucide-react'
import { api } from '../services/api'
import type { CatalogItem, CatalogParty } from '../services/types'
import { Combobox } from './Combobox'

export function ItemPicker({
  onPick,
  selectedLabel,
  autoFocus,
}: {
  onPick: (item: CatalogItem) => void
  selectedLabel?: string | null
  autoFocus?: boolean
}) {
  const search = useMemo(
    () => async (term: string, signal: AbortSignal) => {
      const response = await api.list<CatalogItem>('v1/catalog/items/search', { q: term }, signal)
      return response.data
    },
    [],
  )

  return (
    <Combobox
      label="Item"
      placeholder="Type or scan…"
      leading={<Search size={14} aria-hidden />}
      selectedLabel={selectedLabel}
      onPick={onPick}
      search={search}
      autoFocus={autoFocus}
      keyOf={(item) => item.item_id}
      renderOption={(item) => (item.item_sku ? `${item.item_name} · ${item.item_sku}` : item.item_name)}
    />
  )
}

export function PartyPicker({
  side = 'customer',
  onPick,
  selectedLabel,
  autoFocus,
}: {
  side?: 'customer' | 'supplier'
  onPick: (party: CatalogParty) => void
  selectedLabel?: string | null
  autoFocus?: boolean
}) {
  const search = useMemo(
    () => async (term: string, signal: AbortSignal) => {
      const response = await api.list<CatalogParty>('v1/catalog/parties', { q: term, side }, signal)
      return response.data
    },
    [side],
  )

  return (
    <Combobox
      label={side === 'supplier' ? 'Supplier' : 'Customer'}
      placeholder="Type a name…"
      leading={<Search size={14} aria-hidden />}
      selectedLabel={selectedLabel}
      onPick={onPick}
      search={search}
      autoFocus={autoFocus}
      keyOf={(party) => party.acc_id}
      renderOption={(party) => (party.gstin ? `${party.acc_name} · ${party.gstin}` : party.acc_name)}
    />
  )
}
