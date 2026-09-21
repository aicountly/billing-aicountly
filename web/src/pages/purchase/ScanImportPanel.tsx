/**
 * Scan, or import.
 *
 * SCANNING IS REAL. A counter barcode reader is a keyboard that types a code
 * and presses Enter, so the field below is all one needs: the code goes to
 * Inventory's barcode lookup, and the item it returns becomes a line. It is the
 * same endpoint the biller desk scans with.
 *
 * THE TWO IMPORTS ARE NOT BUILT. No endpoint in this deployment takes a CSV or
 * reads a supplier's PDF, so they are shown disabled and say why, rather than
 * being wired to something that would silently do nothing. When those
 * endpoints exist, this is the one place that has to change.
 */

import { useRef, useState } from 'react'
import { FileSpreadsheet, FileText, ScanLine } from 'lucide-react'
import { api, ApiError } from '../../services/api'
import type { CatalogItem } from '../../services/types'

function isItem(value: unknown): value is CatalogItem {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Number.isFinite(Number((value as { item_id?: unknown }).item_id)) &&
    Number((value as { item_id: unknown }).item_id) > 0
  )
}

export function ScanImportPanel({ onFound }: { onFound: (item: CatalogItem) => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const inFlight = useRef<AbortController | null>(null)

  async function lookup() {
    const trimmed = code.trim()
    if (trimmed === '' || busy) return

    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller

    setBusy(true)
    setMessage(null)

    try {
      const item = await api
        .one<CatalogItem>(`v1/catalog/items/barcode/${encodeURIComponent(trimmed)}`, undefined, controller.signal)
        .then((response) => response.data)
        .catch(async (error: unknown) => {
          // Not every deployment barcodes everything. A plain search on the same
          // string is what a person would try next, so the screen tries it too.
          if (error instanceof ApiError && error.status === 404) {
            const results = await api.list<CatalogItem>(
              'v1/catalog/items/search',
              { q: trimmed, limit: 1 },
              controller.signal,
            )
            return results.data[0] ?? null
          }
          throw error
        })

      if (controller.signal.aborted) return

      // Inventory is another product behind a relay. Anything that is not
      // recognisably an item is treated as "not found" rather than being put
      // on the bill as a line with no name and no rate.
      if (!isItem(item)) {
        setMessage(`Nothing in Inventory matches “${trimmed}”.`)
        return
      }

      onFound(item)
      setCode('')
      setMessage(`Added ${item.item_name}.`)
    } catch (error) {
      if (controller.signal.aborted) return
      setMessage(
        error instanceof ApiError
          ? error.message
          : 'Could not reach Inventory for that code. Try again in a moment.',
      )
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  return (
    <div className="purchase-drawer__section">
      <h3>Scan a barcode</h3>
      <p className="purchase-drawer__note">
        Point a scanner at the field, or type the code. The item comes from Inventory.
      </p>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          className="purchase-input"
          aria-label="Barcode"
          placeholder="Scan or type a barcode…"
          value={code}
          disabled={busy}
          autoFocus
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void lookup()
            }
          }}
        />
        <button type="button" className="purchase-btn purchase-btn--outline" onClick={() => void lookup()} disabled={busy || code.trim() === ''}>
          <ScanLine size={15} aria-hidden />
          {busy ? 'Looking…' : 'Add'}
        </button>
      </div>

      {message && (
        <p className="purchase-drawer__note" role="status" style={{ marginTop: 8, marginBottom: 0 }}>
          {message}
        </p>
      )}

      <h3 style={{ marginTop: 20 }}>Import</h3>
      <div className="purchase-drawer__picks">
        <button
          type="button"
          className="purchase-drawer__pick"
          disabled
          title="No CSV import endpoint exists in this deployment yet."
          style={{ opacity: 0.55, cursor: 'not-allowed' }}
        >
          <span>
            <FileSpreadsheet size={15} aria-hidden style={{ verticalAlign: '-2px', marginRight: 6 }} />
            Import a CSV of lines
            <br />
            <small>Not available yet — no import endpoint in this deployment.</small>
          </span>
        </button>

        <button
          type="button"
          className="purchase-drawer__pick"
          disabled
          title="No document-reading endpoint exists in this deployment yet."
          style={{ opacity: 0.55, cursor: 'not-allowed' }}
        >
          <span>
            <FileText size={15} aria-hidden style={{ verticalAlign: '-2px', marginRight: 6 }} />
            Read the supplier&apos;s bill
            <br />
            <small>Not available yet — nothing here reads a PDF or a photo.</small>
          </span>
        </button>
      </div>
    </div>
  )
}
