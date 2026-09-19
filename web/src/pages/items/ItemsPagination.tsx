/**
 * The footer: how many are being shown, and how to reach the rest.
 *
 * Server-side, always. Nothing here slices a list the browser already holds,
 * because the browser never holds the list — it holds one page of it, which is
 * what makes this screen the same speed for a shop with forty items and a
 * distributor with forty thousand.
 *
 * When Inventory does not say how many there are, the count says so instead of
 * naming a number nobody counted, and Next is offered while a full page keeps
 * arriving.
 */

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { PAGE_SIZES } from './useItemsQuery'

export function ItemsPagination({
  page,
  perPage,
  shown,
  total,
  onPage,
  onPerPage,
}: {
  page: number
  perPage: number
  shown: number
  /** null when Inventory returned no count. */
  total: number | null
  onPage: (page: number) => void
  onPerPage: (perPage: number) => void
}) {
  const first = shown === 0 ? 0 : (page - 1) * perPage + 1
  const last = (page - 1) * perPage + shown
  const lastPage = total === null ? null : Math.max(1, Math.ceil(total / perPage))
  const hasNext = lastPage === null ? shown === perPage : page < lastPage

  return (
    <footer className="items-pagination">
      <div className="items-pagination__count">
        {total === null
          ? `Showing ${first} to ${last}. Aicountly Inventory did not give a total.`
          : `Showing ${first} to ${last} of ${new Intl.NumberFormat('en-IN').format(total)} items`}
      </div>

      <div className="items-pagination__size">
        <label htmlFor="items-per-page">Rows</label>
        <select
          id="items-per-page"
          className="items-select items-select--small"
          value={perPage}
          onChange={(event) => onPerPage(Number(event.target.value))}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>

      <nav className="items-pages" aria-label="Pages">
        <button
          type="button"
          className="items-pages__button"
          aria-label="Previous page"
          title="Previous page"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft size={15} aria-hidden />
        </button>

        {lastPage === null ? (
          <span className="items-pages__current" aria-current="page">
            Page {page}
          </span>
        ) : (
          pageNumbers(page, lastPage).map((entry, index) =>
            entry === null ? (
              <span className="items-pages__gap" key={`gap-${index}`} aria-hidden>
                …
              </span>
            ) : (
              <button
                type="button"
                key={entry}
                className="items-pages__button"
                aria-current={entry === page ? 'page' : undefined}
                aria-label={`Page ${entry}`}
                onClick={() => onPage(entry)}
              >
                {entry}
              </button>
            ),
          )
        )}

        <button
          type="button"
          className="items-pages__button"
          aria-label="Next page"
          title="Next page"
          disabled={!hasNext}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight size={15} aria-hidden />
        </button>
      </nav>
    </footer>
  )
}

/**
 * 1 … 4 5 6 … 50 — the first, the last, and the neighbours of where you are.
 * `null` is a gap. Never more than seven controls, however many pages there are.
 */
function pageNumbers(page: number, lastPage: number): Array<number | null> {
  if (lastPage <= 7) {
    return Array.from({ length: lastPage }, (_, index) => index + 1)
  }

  const pages = new Set<number>([1, lastPage, page, page - 1, page + 1])
  const sorted = [...pages].filter((entry) => entry >= 1 && entry <= lastPage).sort((a, b) => a - b)

  const out: Array<number | null> = []
  let previous = 0
  for (const entry of sorted) {
    if (previous !== 0 && entry - previous > 1) out.push(null)
    out.push(entry)
    previous = entry
  }

  return out
}
