/**
 * Short confirmations, and the failures that do not deserve a dialog.
 *
 * A toast says something HAPPENED. It never says what to do about it: anything
 * a person has to read, decide on, or act from stays on the page in a Notice,
 * where it can be re-read after the six seconds are up. So "Bank deposit
 * recorded" is a toast; "Smart Books refused this, here is why" is not.
 *
 * Deliberately no dependency. The whole thing is a list, a timer and a region
 * a screen reader announces — anything larger would be a second design system
 * living beside the one in billing-dashboard.css.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Info, X } from 'lucide-react'
import '../styles/billing-dashboard.css'

export type ToastTone = 'success' | 'info' | 'danger'

export interface ToastRequest {
  tone?: ToastTone
  title: string
  detail?: string
  /** Milliseconds on screen. Errors stay until dismissed when this is 0. */
  duration?: number
}

interface Toast extends ToastRequest {
  id: number
  tone: ToastTone
}

const ToastContext = createContext<((toast: ToastRequest) => void) | null>(null)

const DEFAULT_MS = 6000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, number>())

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
    const timer = timers.current.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (request: ToastRequest) => {
      const id = nextId.current++
      const toast: Toast = { ...request, id, tone: request.tone ?? 'success' }

      // Three is the most anyone reads. Older ones go rather than scrolling the
      // corner of the screen.
      setToasts((current) => [...current.slice(-2), toast])

      const duration = request.duration ?? (toast.tone === 'danger' ? 0 : DEFAULT_MS)
      if (duration > 0) {
        timers.current.set(id, window.setTimeout(() => dismiss(id), duration))
      }
    },
    [dismiss],
  )

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer)
      pending.clear()
    }
  }, [])

  const value = useMemo(() => push, [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Always in the tree, empty or not: a live region added at the moment it
          has something to say is a live region some screen readers never read. */}
      <div className="billing-toasts" role="status" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div key={toast.id} className={`billing-toast billing-toast--${toast.tone}`}>
            <span className="billing-toast__mark" aria-hidden="true">
              {toast.tone === 'success' ? <Check size={15} /> : toast.tone === 'danger' ? <AlertTriangle size={15} /> : <Info size={15} />}
            </span>
            <span className="billing-toast__body">
              <strong>{toast.title}</strong>
              {toast.detail && <span>{toast.detail}</span>}
            </span>
            <button type="button" className="billing-toast__close" onClick={() => dismiss(toast.id)} aria-label="Dismiss">
              <X size={14} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

/**
 * Show a toast.
 *
 * Returns a no-op outside a provider rather than throwing: a missing toast is
 * never a reason for a screen that saved something successfully to crash.
 */
export function useToast(): (toast: ToastRequest) => void {
  const push = useContext(ToastContext)
  return push ?? noop
}

function noop() {
  /* no provider mounted */
}
