import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Loader2, Receipt } from 'lucide-react'
import type { SaveTarget } from './form'

/**
 * Save, and the two things somebody might want to do straight afterwards.
 *
 * Nothing in the menu is offered unless it exists: there is no "print receipt"
 * here, because no endpoint in this product prints one.
 */
export function SaveButton({
  saving,
  onSave,
}: {
  saving: boolean
  onSave: (target: SaveTarget) => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return undefined

    function onPointerDown(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="billing-receipt-split" ref={box}>
      <button
        type="button"
        className="billing-button billing-button--primary"
        disabled={saving}
        onClick={() => onSave('stay')}
      >
        {saving ? (
          <>
            <span className="spin" aria-hidden style={{ display: 'inline-flex' }}>
              <Loader2 size={15} />
            </span>
            Saving…
          </>
        ) : (
          <>
            <Receipt size={15} aria-hidden /> Save money received
          </>
        )}
      </button>

      <button
        type="button"
        className="billing-button billing-button--primary"
        disabled={saving}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More ways to save"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown size={15} aria-hidden />
      </button>

      {open && (
        <div className="billing-receipt-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onSave('another')
            }}
          >
            Save and add another
            <small>Keeps this customer, clears the amount</small>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onSave('view')
            }}
          >
            Save and view the receipt
            <small>Opens what Smart Books recorded</small>
          </button>
        </div>
      )}
    </div>
  )
}
