/**
 * The footer under the list.
 *
 * Pagination is the server's job — the browser never asks for the whole party
 * master so it can slice it locally. What this does is say where you are and
 * let you go somewhere else.
 *
 * When the far end would not say how many parties there are, the count is not
 * invented: the line reads "Showing 1–20" with no "of", and the pager offers
 * Previous and Next rather than a last page it cannot locate.
 */

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { PARTY_PAGE_SIZES } from '../../services/parties'

/**
 * Which page numbers to draw.
 *
 * First, last, and a window around the current one: 1 … 4 5 6 … 24. Drawing
 * twenty-four buttons is how a pager becomes a wall.
 */
function pageNumbers(current: number, last: number): Array<number | 'gap'> {
  if (last <= 7) return Array.from({ length: last }, (_, index) => index + 1)

  const window = new Set<number>([1, last, current, current - 1, current + 1])
  if (current <= 3) [2, 3, 4].forEach((page) => window.add(page))
  if (current >= last - 2) [last - 3, last - 2, last - 1].forEach((page) => window.add(page))

  const pages = [...window].filter((page) => page >= 1 && page <= last).sort((a, b) => a - b)

  const out: Array<number | 'gap'> = []
  let previous = 0
  for (const page of pages) {
    if (previous && page - previous > 1) out.push('gap')
    out.push(page)
    previous = page
  }

  return out
}

export function PartyPagination({
  page,
  pageSize,
  rowCount,
  total,
  totalKnown,
  onPage,
  onPageSize,
  busy,
}: {
  page: number
  pageSize: number
  rowCount: number
  total: number
  totalKnown: boolean
  onPage: (page: number) => void
  onPageSize: (size: number) => void
  busy: boolean
}) {
  const first = rowCount === 0 ? 0 : (page - 1) * pageSize + 1
  const last = (page - 1) * pageSize + rowCount
  const lastPage = totalKnown ? Math.max(1, Math.ceil(total / pageSize)) : null
  const hasNext = lastPage === null ? rowCount === pageSize : page < lastPage

  return (
    <div className="billing-parties__foot">
      <span aria-live="polite">
        {rowCount === 0
          ? 'No parties on this page'
          : totalKnown
            ? `Showing ${first.toLocaleString('en-IN')}–${last.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')} ${
                total === 1 ? 'party' : 'parties'
              }`
            : `Showing ${first.toLocaleString('en-IN')}–${last.toLocaleString('en-IN')}`}
      </span>

      <div className="billing-parties__pager">
        <label className="billing-sr-only" htmlFor="party-page-size">
          Parties per page
        </label>
        <select
          id="party-page-size"
          className="billing-parties__select"
          style={{ minHeight: 34, maxWidth: '9rem' }}
          value={pageSize}
          onChange={(event) => onPageSize(Number(event.target.value))}
        >
          {PARTY_PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size} per page
            </option>
          ))}
        </select>

        <button type="button" onClick={() => onPage(1)} disabled={page === 1 || busy} aria-label="First page">
          <ChevronsLeft size={15} aria-hidden />
        </button>
        <button type="button" onClick={() => onPage(page - 1)} disabled={page === 1 || busy} aria-label="Previous page">
          <ChevronLeft size={15} aria-hidden />
        </button>

        {lastPage === null ? (
          <button type="button" aria-current="page" disabled>
            {page}
          </button>
        ) : (
          pageNumbers(page, lastPage).map((entry, index) =>
            entry === 'gap' ? (
              <span key={`gap-${index}`} className="billing-parties__pager-gap" aria-hidden>
                …
              </span>
            ) : (
              <button
                key={entry}
                type="button"
                aria-current={entry === page ? 'page' : undefined}
                aria-label={`Page ${entry}`}
                disabled={busy}
                onClick={() => onPage(entry)}
              >
                {entry}
              </button>
            ),
          )
        )}

        <button type="button" onClick={() => onPage(page + 1)} disabled={!hasNext || busy} aria-label="Next page">
          <ChevronRight size={15} aria-hidden />
        </button>
        {lastPage !== null && (
          <button
            type="button"
            onClick={() => onPage(lastPage)}
            disabled={page === lastPage || busy}
            aria-label="Last page"
          >
            <ChevronsRight size={15} aria-hidden />
          </button>
        )}
      </div>
    </div>
  )
}
