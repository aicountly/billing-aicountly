/**
 * Bill / Receipt — the block that takes the photo of the bill.
 *
 * TWO SHAPES, AND WHICH ONE APPEARS IS NOT A PREFERENCE. When a document
 * service is configured for this deployment the file goes to it and the
 * voucher carries the reference it hands back, so this is a drop zone. When
 * none is, there is nowhere for a photo to land — so rather than a drop zone
 * that swallows one and loses it, the block asks WHERE the bill is kept and
 * says why. The server decides, in DocumentCapture::storage(); this component
 * only draws the answer.
 *
 * Either way exactly one field reaches Books: `attachment_ref` on the expense,
 * which is a field that request already accepted.
 */

import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Sparkles,
  Trash2,
  UploadCloud,
} from 'lucide-react'
import { api, ApiError } from '../../services/api'
import type { DocumentCapability, StoredBill } from '../../services/types'

/** What the server accepts when it has not said otherwise. */
const DEFAULT_ACCEPTS = ['application/pdf', 'image/jpeg', 'image/png']
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024

export interface BillReceiptUploaderProps {
  /** The stored bill, once a document service has taken one. */
  value: StoredBill | null
  onChange: (bill: StoredBill | null) => void
  /** Where the bill is kept, used only when there is nowhere to put the file. */
  reference: string
  onReferenceChange: (value: string) => void
  storage: DocumentCapability | null
  extraction: DocumentCapability | null
  extractionBusy: boolean
  /** Read the bill that is already attached, rather than asking for it twice. */
  onReadBill: (file: File) => void
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'uploading'; name: string; fraction: number | null }
  | { kind: 'failed'; name: string; message: string; retryable: boolean }

export function BillReceiptUploader(props: BillReceiptUploaderProps) {
  const { value, onChange, storage } = props

  const accepts = storage?.accepts ?? DEFAULT_ACCEPTS
  const maxBytes = storage?.max_bytes ?? DEFAULT_MAX_BYTES

  const [stage, setStage] = useState<Stage>({ kind: 'idle' })
  const [rejected, setRejected] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  /**
   * The file this person chose, kept as a handle — not its bytes — so the bill
   * reader can work on what is already attached instead of asking for it twice.
   */
  const [chosen, setChosen] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const picker = useRef<HTMLInputElement>(null)
  const inFlight = useRef<AbortController | null>(null)
  /**
   * The live object URL, mirrored in a ref.
   *
   * Revoking is done here rather than from an effect keyed on the URL: that
   * effect's cleanup runs on every change, and under StrictMode it would revoke
   * a URL that is still on screen.
   */
  const previewUrl = useRef<string | null>(null)

  function showPreview(file: File | null) {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    const next = file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null
    previewUrl.current = next
    setPreview(next)
  }

  // Only on the way out: an upload nobody is waiting for any more is stopped,
  // and the lock an object URL holds on the file is released.
  useEffect(() => {
    return () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
      previewUrl.current = null
      inFlight.current?.abort()
    }
  }, [])

  // The expense was saved, or reset: what was attached belongs to an entry that
  // is finished, so the thumbnail and the file behind it go with it.
  useEffect(() => {
    if (value !== null) return

    setChosen(null)
    showPreview(null)
    setStage((current) => (current.kind === 'uploading' ? current : { kind: 'idle' }))
    // showPreview is stable for this component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  async function take(file: File) {
    setRejected(null)

    // Checked here so an obvious mistake costs nothing. The server checks the
    // CONTENT again, because a file's declared type is a claim by whoever
    // chose it.
    if (accepts.length > 0 && !accepts.includes(file.type)) {
      setRejected(
        `${describeTypes(accepts)} only — that one is ${file.type === '' ? 'of a type the browser could not name' : file.type}.`,
      )
      return
    }
    if (file.size === 0) {
      setRejected('That file is empty.')
      return
    }
    if (file.size > maxBytes) {
      setRejected(`That file is ${formatBytes(file.size)}, and the limit is ${formatBytes(maxBytes)}.`)
      return
    }

    const controller = new AbortController()
    inFlight.current?.abort()
    inFlight.current = controller

    setChosen(file)
    showPreview(file)
    setStage({ kind: 'uploading', name: file.name, fraction: null })

    const form = new FormData()
    form.append('file', file)

    try {
      const response = await api.upload<StoredBill>('v1/expenses/bill', form, {
        signal: controller.signal,
        onProgress: (fraction) =>
          setStage((current) => (current.kind === 'uploading' ? { ...current, fraction } : current)),
      })

      if (controller.signal.aborted) return

      onChange(response.data)
      setStage({ kind: 'idle' })
    } catch (error) {
      if (controller.signal.aborted) return

      setChosen(null)
      showPreview(null)

      const failure =
        error instanceof ApiError
          ? { message: error.message, retryable: error.retryable }
          : { message: 'That file could not be sent. Check the connection and try again.', retryable: true }

      setStage({ kind: 'failed', name: file.name, message: failure.message, retryable: failure.retryable })
    } finally {
      if (inFlight.current === controller) inFlight.current = null
    }
  }

  function clear() {
    inFlight.current?.abort()
    inFlight.current = null
    setChosen(null)
    showPreview(null)
    setStage({ kind: 'idle' })
  }

  // -------------------------------------------------------------- no store

  if (storage !== null && !storage.available) {
    return (
      <div className="billing-expense-bill">
        <div className="billing-expense-bill__head">
          <span className="billing-expense-bill__mark" aria-hidden>
            <Paperclip size={15} />
          </span>
          <label htmlFor="expense-bill-reference">Bill / Receipt</label>
        </div>

        <input
          id="expense-bill-reference"
          className="billing-expense-control"
          value={props.reference}
          placeholder="e.g. Bill file 12, drive link"
          aria-describedby="expense-bill-why"
          onChange={(event) => props.onReferenceChange(event.target.value)}
        />

        <p className="billing-expense-bill__why" id="expense-bill-why">
          <FileText size={12} aria-hidden style={{ verticalAlign: '-1px', marginRight: 4 }} />
          {storage.reason ?? 'Kept with the voucher in Smart Books.'}
        </p>
      </div>
    )
  }

  // --------------------------------------------------------------- the file

  return (
    <div className="billing-expense-bill billing-expense-bill--upload">
      <div className="billing-expense-bill__head">
        <span className="billing-expense-bill__mark" aria-hidden>
          <Paperclip size={15} />
        </span>
        <span id="expense-bill-label">Bill / Receipt</span>
      </div>

      {value ? (
        <Attached
          bill={value}
          preview={preview}
          extraction={props.extraction}
          extractionBusy={props.extractionBusy}
          canRead={chosen !== null}
          onRead={() => {
            if (chosen) props.onReadBill(chosen)
          }}
          onReplace={() => picker.current?.click()}
          onRemove={() => {
            clear()
            onChange(null)
            setRejected(null)
          }}
        />
      ) : stage.kind === 'uploading' ? (
        <div className="billing-expense-drop billing-expense-drop--busy">
          <Loader2 size={22} aria-hidden className="spin billing-expense-drop__icon" />
          <span className="billing-expense-drop__name">{stage.name}</span>

          <span
            className="billing-expense-drop__bar"
            role="progressbar"
            aria-label={`Uploading ${stage.name}`}
            {...(stage.fraction === null
              ? {}
              : { 'aria-valuenow': Math.round(stage.fraction * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 })}
          >
            <span
              className={`billing-expense-drop__fill${
                stage.fraction === null ? ' billing-expense-drop__fill--unmeasured' : ''
              }`}
              style={stage.fraction === null ? undefined : { width: `${Math.round(stage.fraction * 100)}%` }}
            />
          </span>

          <button type="button" className="billing-expense-inline-action" onClick={clear}>
            Cancel
          </button>
        </div>
      ) : stage.kind === 'failed' ? (
        <div className="billing-expense-drop billing-expense-drop--failed" role="alert">
          <AlertCircle size={20} aria-hidden className="billing-expense-drop__icon" />
          <span className="billing-expense-drop__name">{stage.name}</span>
          <span className="billing-expense-drop__why">{stage.message}</span>

          <span className="billing-expense-drop__row">
            {stage.retryable && (
              <button
                type="button"
                className="billing-button billing-button--small"
                onClick={() => picker.current?.click()}
              >
                Try again
              </button>
            )}
            <button type="button" className="billing-expense-inline-action" onClick={() => setStage({ kind: 'idle' })}>
              Record this expense without it
            </button>
          </span>
        </div>
      ) : (
        <button
          type="button"
          className={`billing-expense-drop billing-expense-drop--empty${dragging ? ' is-dragging' : ''}`}
          aria-labelledby="expense-bill-label"
          aria-describedby="expense-bill-limits"
          onClick={() => picker.current?.click()}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            const file = event.dataTransfer.files?.[0]
            if (file) void take(file)
          }}
        >
          <UploadCloud size={26} aria-hidden className="billing-expense-drop__icon" />
          <span className="billing-expense-drop__lead">
            Drag &amp; drop, or <strong>click to upload</strong>
          </span>
          <span className="billing-expense-drop__limits" id="expense-bill-limits">
            {describeTypes(accepts)} · up to {formatBytes(maxBytes)}
          </span>
        </button>
      )}

      {/* Never colour alone, and never only in the zone that has just been
          replaced by something else. */}
      {rejected && (
        <p className="billing-expense-field__error" role="alert">
          <AlertCircle size={13} aria-hidden /> {rejected}
        </p>
      )}

      <input
        ref={picker}
        type="file"
        accept={accepts.join(',')}
        className="billing-sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          // Cleared so choosing the same file twice still counts as a change.
          event.target.value = ''
          if (file) void take(file)
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// What is attached
// ---------------------------------------------------------------------------

function Attached({
  bill,
  preview,
  extraction,
  extractionBusy,
  canRead,
  onRead,
  onReplace,
  onRemove,
}: {
  bill: StoredBill
  preview: string | null
  extraction: DocumentCapability | null
  extractionBusy: boolean
  canRead: boolean
  onRead: () => void
  onReplace: () => void
  onRemove: () => void
}) {
  const name = bill.filename ?? 'Bill'
  const isPdf = (bill.content_type ?? '') === 'application/pdf'

  return (
    <div className="billing-expense-attached">
      <span className={`billing-expense-attached__thumb${isPdf ? ' billing-expense-attached__thumb--pdf' : ''}`}>
        {preview ? (
          // The file this person just chose. Nothing is fetched back to show
          // something the browser is already holding.
          <img src={preview} alt="" />
        ) : isPdf ? (
          <FileText size={18} aria-hidden />
        ) : (
          <ImageIcon size={18} aria-hidden />
        )}
      </span>

      <span className="billing-expense-attached__main">
        <span className="billing-expense-attached__name" title={name}>
          {name}
        </span>
        <span className="billing-expense-attached__meta">
          {bill.size === null ? 'Attached' : `${formatBytes(bill.size)} · attached`}
          {bill.url && (
            <>
              {' · '}
              <a href={bill.url} target="_blank" rel="noreferrer">
                Open
              </a>
            </>
          )}
        </span>
      </span>

      <span className="billing-expense-attached__actions">
        {extraction?.available && canRead && (
          <button
            type="button"
            className="billing-button billing-button--small"
            disabled={extractionBusy}
            onClick={onRead}
          >
            {extractionBusy ? <Loader2 size={14} aria-hidden className="spin" /> : <Sparkles size={14} aria-hidden />}
            {extractionBusy ? 'Reading…' : 'Read it'}
          </button>
        )}
        <button type="button" className="billing-button billing-button--small" onClick={onReplace}>
          Replace
        </button>
        <button type="button" className="billing-expense-tip__close" aria-label={`Remove ${name}`} onClick={onRemove}>
          <Trash2 size={15} aria-hidden />
        </button>
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------

/** "PDF, JPG or PNG", from whatever the server said it takes. */
function describeTypes(accepts: string[]): string {
  const names = [
    ...new Set(
      accepts.map((type) => {
        if (type === 'application/pdf') return 'PDF'
        if (type === 'image/jpeg') return 'JPG'
        if (type === 'image/png') return 'PNG'

        return type.split('/').pop()?.toUpperCase() ?? type
      }),
    ),
  ]

  if (names.length === 0) return 'A bill file'
  if (names.length === 1) return names[0]

  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`

  // One decimal, dropped when it is a whole number. Rounding to whole
  // megabytes made an 11 MB file and a 10 MB limit both read "10 MB", which
  // turns a clear refusal into an argument with the user.
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`
}
