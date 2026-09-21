/**
 * The deposit slip — the counterfoil the bank stamped and handed back.
 *
 * TWO SHAPES, AND WHICH ONE APPEARS IS NOT A PREFERENCE. When a document
 * service is configured for this deployment, the file goes to it and the
 * voucher carries the reference it hands back, so this is a drop zone. When
 * none is, there is nowhere for a photo to land — so rather than a drop zone
 * that swallows one and loses it, the block says so and points at Reference,
 * which is what a bank statement is actually matched on. The server decides,
 * in DocumentCapture::storage(); this component only draws the answer.
 *
 * Either way exactly one field reaches Books: `attachment_ref` on the contra.
 * Billing writes no bytes and keeps no copy — same rule as the expense screen's
 * bill, which is why both go through the same checks on the server.
 *
 * Deliberately smaller than that one. A deposit slip is never read
 * automatically: there is nothing on it to propose, so there is no reader here
 * and no card offering one.
 */

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, FileText, Image as ImageIcon, Loader2, Paperclip, Trash2, UploadCloud } from 'lucide-react'
import { api, ApiError } from '../../services/api'
import type { DocumentCapability, StoredBill } from '../../services/types'

/** What the server accepts when it has not said otherwise. */
const DEFAULT_ACCEPTS = ['application/pdf', 'image/jpeg', 'image/png']
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024

type Stage =
  | { kind: 'idle' }
  | { kind: 'uploading'; name: string; fraction: number | null }
  | { kind: 'failed'; name: string; message: string; retryable: boolean }

export function SlipUploader({
  value,
  onChange,
  storage,
  loading,
}: {
  /** The stored slip, once a document service has taken one. */
  value: StoredBill | null
  onChange: (slip: StoredBill | null) => void
  storage: DocumentCapability | null
  loading: boolean
}) {
  const accepts = storage?.accepts ?? DEFAULT_ACCEPTS
  const maxBytes = storage?.max_bytes ?? DEFAULT_MAX_BYTES

  const [stage, setStage] = useState<Stage>({ kind: 'idle' })
  const [rejected, setRejected] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [lastFile, setLastFile] = useState<File | null>(null)

  const picker = useRef<HTMLInputElement>(null)
  const inFlight = useRef<AbortController | null>(null)

  // An upload nobody is waiting for any more is stopped, so leaving the screen
  // mid-upload does not leave a request running against a dead component.
  useEffect(() => () => inFlight.current?.abort(), [])

  if (loading) {
    return (
      <div className="billing-skeleton-rows" aria-busy="true">
        <span className="billing-sr-only">Checking whether a slip can be kept</span>
        <span className="billing-skeleton billing-skeleton--line" />
        <span className="billing-skeleton billing-skeleton--line" />
      </div>
    )
  }

  // Nowhere to put it. Said once, with the thing that does work offered.
  if (storage && !storage.available) {
    return (
      <div className="billing-unavailable">
        <Paperclip size={20} aria-hidden />
        <strong className="billing-unavailable__title">The slip itself cannot be kept here</strong>
        <p style={{ margin: 0, maxWidth: '62ch' }}>
          {storage.reason}
        </p>
        <p className="billing-deposit-dependency">
          Put the slip or UTR number in <strong>Reference</strong> above — that is what the bank statement is matched
          on. See docs/BILLING_API_DEPENDENCIES.md.
        </p>
      </div>
    )
  }

  function reject(message: string) {
    setRejected(message)
    setStage({ kind: 'idle' })
  }

  async function send(file: File) {
    // Checked here as a courtesy so an obvious mistake costs no round trip.
    // The server checks again, from the file's CONTENT rather than its name,
    // and the server's answer is the one that counts.
    if (file.size > maxBytes) {
      reject(`That file is ${mb(file.size)} MB. The limit is ${mb(maxBytes)} MB.`)
      return
    }
    if (file.type !== '' && !accepts.includes(file.type)) {
      reject('A slip has to be a PDF, JPG or PNG.')
      return
    }

    setRejected(null)
    setLastFile(file)
    setStage({ kind: 'uploading', name: file.name, fraction: null })

    const form = new FormData()
    form.append('file', file)

    const controller = new AbortController()
    inFlight.current = controller

    try {
      const response = await api.upload<StoredBill>('v1/bank-deposits/slip', form, {
        signal: controller.signal,
        onProgress: (fraction) =>
          setStage((current) => (current.kind === 'uploading' ? { ...current, fraction } : current)),
      })
      onChange(response.data)
      setStage({ kind: 'idle' })
    } catch (error) {
      if (controller.signal.aborted) return
      const apiError = error instanceof ApiError ? error : null
      setStage({
        kind: 'failed',
        name: file.name,
        message: apiError?.message ?? 'That upload did not finish. The deposit can still be recorded without it.',
        // A refusal is not worth retrying; an unreachable service is.
        retryable: apiError === null || apiError.retryable,
      })
    } finally {
      inFlight.current = null
    }
  }

  function choose(files: FileList | null) {
    const file = files?.[0]
    if (file) void send(file)
  }

  if (value) {
    return (
      <div className="billing-deposit-slip billing-deposit-slip--held">
        <span className="billing-deposit-slip__mark" aria-hidden="true">
          {value.content_type === 'application/pdf' ? <FileText size={18} /> : <ImageIcon size={18} />}
        </span>
        <span className="billing-deposit-slip__body">
          <strong>{value.filename ?? 'Deposit slip'}</strong>
          <span>
            {value.size !== null ? `${mb(value.size)} MB · ` : ''}Kept by the document service. The deposit will point
            at it.
          </span>
        </span>
        {value.url && (
          <a className="billing-button billing-button--small" href={value.url} target="_blank" rel="noreferrer">
            View
          </a>
        )}
        <button
          type="button"
          className="billing-button billing-button--small"
          onClick={() => {
            onChange(null)
            setLastFile(null)
          }}
        >
          <Trash2 size={14} aria-hidden /> Remove
        </button>
      </div>
    )
  }

  if (stage.kind === 'uploading') {
    return (
      <div className="billing-deposit-slip" aria-busy="true">
        <span className="billing-deposit-slip__mark" aria-hidden="true">
          <Loader2 size={18} className="spin" />
        </span>
        <span className="billing-deposit-slip__body">
          <strong>{stage.name}</strong>
          <span>{stage.fraction === null ? 'Uploading…' : `Uploading… ${Math.round(stage.fraction * 100)}%`}</span>
        </span>
        <button type="button" className="billing-button billing-button--small" onClick={() => inFlight.current?.abort()}>
          Cancel
        </button>
      </div>
    )
  }

  return (
    <>
      {stage.kind === 'failed' && (
        <div className="billing-deposit-slip billing-deposit-slip--failed" role="alert">
          <span className="billing-deposit-slip__mark" aria-hidden="true">
            <AlertCircle size={18} />
          </span>
          <span className="billing-deposit-slip__body">
            <strong>{stage.name}</strong>
            <span>{stage.message}</span>
          </span>
          {stage.retryable && lastFile && (
            <button type="button" className="billing-button billing-button--small" onClick={() => void send(lastFile)}>
              Try again
            </button>
          )}
        </div>
      )}

      <div
        className={`billing-deposit-drop${dragging ? ' is-over' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          choose(event.dataTransfer.files)
        }}
      >
        <span className="billing-deposit-drop__mark" aria-hidden="true">
          <UploadCloud size={22} />
        </span>
        <p className="billing-deposit-drop__lead">
          Drag &amp; drop the slip here, or{' '}
          <button type="button" className="billing-deposit-drop__link" onClick={() => picker.current?.click()}>
            click to upload
          </button>
        </p>
        <p className="billing-deposit-drop__hint">
          PDF, JPG or PNG · up to {mb(maxBytes)} MB
        </p>
        {rejected && <p className="billing-deposit-field__error">{rejected}</p>}

        <input
          ref={picker}
          type="file"
          className="billing-sr-only"
          accept={accepts.join(',')}
          onChange={(event) => {
            choose(event.target.files)
            // Cleared so choosing the same file twice still fires a change.
            event.target.value = ''
          }}
        />
      </div>
    </>
  )
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(bytes < 1024 * 1024 ? 2 : 1)
}
