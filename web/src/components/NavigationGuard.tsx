/**
 * "You have typed something. Did you mean to leave?"
 *
 * WHY IT IS BUILT THIS WAY. React Router's own blocker needs a data router, and
 * this app mounts a plain `<BrowserRouter>`; swapping that out to guard one form
 * would be a change to how every screen in the product routes. So the guard
 * works where navigation actually starts — the link the user clicked — by
 * catching the click before the router sees it.
 *
 * WHAT IT COVERS: every in-app link, including the sidebar, the drawer, the
 * breadcrumb and the header, plus closing or reloading the tab.
 *
 * WHAT IT DOES NOT: the browser's own Back button. A single-page app cannot
 * intercept that without a data router, and faking one by pushing a history
 * entry breaks Back for everybody who did mean it. A form left by Back is
 * therefore lost, which is the same as it is on every other screen here — and
 * the reason this screen can also save a draft to the server.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export interface NavigationGuard {
  /** Where the user tried to go, while they are being asked about it. */
  pending: string | null
  keepEditing: () => void
  discard: () => void
  /** Leave deliberately, without being asked. For "Saved" and "Cancel". */
  leave: (to: string | number) => void
}

export function useNavigationGuard(dirty: boolean): NavigationGuard {
  const navigate = useNavigate()
  const location = useLocation()
  const [pending, setPending] = useState<string | null>(null)
  const bypass = useRef(false)

  useEffect(() => {
    if (!dirty) return undefined

    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (bypass.current) return
      // The wording is the browser's, not ours — no browser has shown a custom
      // message here for a decade.
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  useEffect(() => {
    if (!dirty) return undefined

    function onClick(event: MouseEvent) {
      if (bypass.current || event.defaultPrevented) return
      // Anything that is not a plain left click is the user asking for a new
      // tab or a context menu, and neither leaves this page.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const target = event.target as Element | null
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return

      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (url.pathname === location.pathname && url.search === location.search) return

      event.preventDefault()
      event.stopPropagation()
      setPending(url.pathname + url.search + url.hash)
    }

    // Capture phase, so the router's own link handler never runs.
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [dirty, location.pathname, location.search])

  const leave = useCallback(
    (to: string | number) => {
      bypass.current = true
      if (typeof to === 'number') navigate(to)
      else navigate(to)
    },
    [navigate],
  )

  const discard = useCallback(() => {
    const to = pending
    setPending(null)
    if (to) leave(to)
  }, [pending, leave])

  const keepEditing = useCallback(() => setPending(null), [])

  // Memoised because callers put this object in a dependency list; a fresh one
  // every render would re-bind their keyboard handlers on every keystroke.
  return useMemo(
    () => ({ pending, keepEditing, discard, leave }),
    [pending, keepEditing, discard, leave],
  )
}

/**
 * A small modal for a question with two answers.
 *
 * Focus moves to the safe answer, Escape takes it, and focus returns where it
 * came from — the same contract as the navigation drawer, which is the other
 * dialog in this product.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Keep editing',
  tone = 'danger',
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
  onConfirm: () => void
  onCancel: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  const safe = useRef<HTMLButtonElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return undefined

    returnTo.current = document.activeElement as HTMLElement | null
    safe.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCancel()
        return
      }
      if (event.key !== 'Tab' || !panel.current) return

      const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not([disabled])'))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (event.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      returnTo.current?.focus()
    }
  }, [open, onCancel])

  if (!open) return null

  return (
    <>
      <div className="billing-deposit-dialog-backdrop" aria-hidden="true" onClick={onCancel} />
      <div className="billing-deposit-dialog" role="alertdialog" aria-modal="true" aria-labelledby="billing-deposit-dialog-title" ref={panel}>
        <h2 id="billing-deposit-dialog-title">{title}</h2>
        <div className="billing-deposit-dialog__body">{children}</div>
        <div className="billing-deposit-dialog__actions">
          <button type="button" className="billing-button" ref={safe} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === 'danger' ? 'billing-button billing-deposit-button--danger' : 'billing-button billing-button--primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  )
}
