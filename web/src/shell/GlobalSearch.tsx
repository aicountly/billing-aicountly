/**
 * Search, scoped to what this profile may actually see.
 *
 * The scoping is NOT done here. Each source is an endpoint that checks its own
 * permission and strips what the caller may not have — a biller without
 * `cost.view` gets the item without its purchase rate from the same URL the
 * owner uses. This component only asks and renders, which is the right place
 * for the boundary: a filter written in the browser is a filter the browser can
 * be asked to skip.
 *
 * Two smaller things that matter at a counter: the request is debounced so a
 * fast typist does not fire one per keystroke, and every response older than
 * the current query is discarded, so the answer to "ram" never lands after the
 * answer to "ramesh" and overwrites it.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { api } from '../services/api'
import { useBilling } from '../context/BillingContext'
import type { CatalogItem, CatalogParty } from '../services/types'
import { money } from '../ui'

interface Result {
  key: string
  group: string
  label: string
  detail: string
  path: string
}

const DEBOUNCE_MS = 250

export function GlobalSearch() {
  const navigate = useNavigate()
  const { scope, can, session } = useBilling()
  const listId = useId()

  const [term, setTerm] = useState('')
  const [results, setResults] = useState<Result[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const box = useRef<HTMLDivElement | null>(null)

  const maySeeParties = can('sale.view') || can('purchase.view') || can('receivable.view')
  const maySeeItems = can('sale.view') && (session?.settings.maintains_stock ?? true)

  // Anything typed before a company was chosen belongs to no company.
  useEffect(() => {
    setTerm('')
    setResults(null)
    setOpen(false)
  }, [scope?.cmp_id, scope?.fy_id, scope?.bo_id])

  useEffect(() => {
    const query = term.trim()
    if (query.length < 2 || !scope) {
      setResults(null)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)

    const timer = window.setTimeout(() => {
      const sources: Array<Promise<Result[]>> = []

      if (maySeeParties) {
        sources.push(
          api
            .list<CatalogParty>('v1/catalog/parties', { q: query, limit: 6 }, controller.signal)
            .then((response) =>
              response.data.map((party) => ({
                key: `party-${party.acc_id}`,
                group: 'Customers & suppliers',
                label: party.acc_name,
                detail: party.gstin ?? '',
                path: `/parties/${party.acc_id}`,
              })),
            )
            .catch(() => []),
        )
      }

      if (maySeeItems) {
        sources.push(
          api
            .get<{ data: CatalogItem[] }>('v1/catalog/items/search', { q: query, limit: 6 }, controller.signal)
            .then((response) =>
              (response.data ?? []).map((item) => ({
                key: `item-${item.item_id}`,
                group: 'Items',
                label: item.item_name,
                detail: [item.item_sku, item.mrp ? money(Number(item.mrp)) : null].filter(Boolean).join(' · '),
                path: `/sales/new?item_id=${item.item_id}`,
              })),
            )
            .catch(() => []),
        )
      }

      Promise.all(sources)
        .then((groups) => {
          if (controller.signal.aborted) return
          setResults(groups.flat())
          setActive(0)
          setOpen(true)
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [term, scope, maySeeParties, maySeeItems])

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  function choose(result: Result) {
    setOpen(false)
    setTerm('')
    navigate(result.path)
  }

  if (!maySeeParties && !maySeeItems) return null

  const grouped = (results ?? []).reduce<Record<string, Result[]>>((acc, result) => {
    ;(acc[result.group] ??= []).push(result)
    return acc
  }, {})

  return (
    <div className="billing-search" ref={box}>
      <Search size={15} className="billing-search__icon" aria-hidden />
      <input
        className="billing-search__input"
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={maySeeItems ? 'Search customers, items…' : 'Search customers, suppliers…'}
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onFocus={() => results && setOpen(true)}
        onKeyDown={(e) => {
          if (!open || !results?.length) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((index) => (index + 1) % results.length)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((index) => (index - 1 + results.length) % results.length)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            choose(results[active])
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />

      {open && (
        <div className="billing-search__results" id={listId} role="listbox">
          {loading && <div className="billing-search__empty">Searching…</div>}
          {!loading && (results ?? []).length === 0 && (
            <div className="billing-search__empty">
              Nothing matched “{term.trim()}” in what your profile can see.
            </div>
          )}
          {Object.entries(grouped).map(([group, rows]) => (
            <div key={group}>
              <div className="billing-search__group">{group}</div>
              {rows.map((result) => {
                const index = (results ?? []).indexOf(result)
                return (
                  <button
                    key={result.key}
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    className="billing-search__result"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(result)}
                  >
                    <span>{result.label}</span>
                    {result.detail && (
                      <span style={{ color: 'var(--billing-muted)', fontSize: 12 }}>{result.detail}</span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
