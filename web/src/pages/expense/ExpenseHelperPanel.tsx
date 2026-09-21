/**
 * The column beside the form: a tip, the shortcuts, the bill reader, and what
 * was recorded lately.
 *
 * None of it is decoration. The quick cards are this company's own expense
 * heads, the recent list is this company's own entries, and the bill reader
 * says plainly what this deployment can and cannot do rather than offering a
 * button that goes nowhere. Every card fails on its own: Books being slow
 * costs the panel, never the form.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  Copy,
  Eye,
  Lightbulb,
  Loader2,
  MoreVertical,
  Receipt,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react'
import type { ItemResponse, ListResponse } from '../../services/api'
import type { AsyncState } from '../../hooks/useApi'
import type { CatalogAccount, DocumentCapability, RecentExpense, RecentExpenses } from '../../services/types'
import { date as formatDate, money } from '../../ui'
import { resolveQuickCategories } from './quickCategories'

const TIP_KEY = 'billing:expense:tip'

export interface ExpenseHelperPanelProps {
  /** Whether a bill file can be kept here, which decides what the tip advises. */
  storage: DocumentCapability | null
  categories: AsyncState<ListResponse<CatalogAccount>>
  selectedCategoryId: string
  onPickCategory: (accountId: number) => void
  /** "View all" — the whole list lives in the dropdown, so send them there. */
  onOpenCategoryList: () => void
  extraction: DocumentCapability | null
  extractionBusy: boolean
  onReadBill: () => void
  recent: AsyncState<ItemResponse<RecentExpenses>>
  onDuplicate: (row: RecentExpense) => void
  canViewReports: boolean
}

export function ExpenseHelperPanel(props: ExpenseHelperPanelProps) {
  return (
    <aside className="billing-expense__aside" aria-label="Expense shortcuts">
      <ProTipCard storage={props.storage} extraction={props.extraction} />
      <QuickExpenseCategories
        categories={props.categories}
        selectedCategoryId={props.selectedCategoryId}
        onPick={props.onPickCategory}
        onOpenCategoryList={props.onOpenCategoryList}
      />
      <AiBillReaderCard
        capability={props.extraction}
        busy={props.extractionBusy}
        onReadBill={props.onReadBill}
      />
      <RecentExpensesCard
        recent={props.recent}
        onDuplicate={props.onDuplicate}
        canViewReports={props.canViewReports}
      />
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Pro tip
// ---------------------------------------------------------------------------

/**
 * Dismissed in this browser and nowhere else.
 *
 * Whether somebody has read a tip is not accounting data and has no business
 * in the company's records, so it does not go to the API.
 *
 * What it ADVISES follows what this deployment can do. Telling somebody to
 * attach the bill and have it read, on a deployment with neither service
 * configured, is advice they cannot take.
 */
function ProTipCard({
  storage,
  extraction,
}: {
  storage: DocumentCapability | null
  extraction: DocumentCapability | null
}) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(TIP_KEY) === 'dismissed'
    } catch {
      return false
    }
  })

  if (dismissed) return null

  return (
    <section className="billing-expense-tip">
      <Lightbulb size={19} aria-hidden className="billing-expense-tip__icon" />
      <div>
        <strong>Pro Tip</strong>
        <p>{tipFor(storage, extraction)}</p>
      </div>
      <button
        type="button"
        className="billing-expense-tip__close"
        aria-label="Dismiss this tip"
        onClick={() => {
          setDismissed(true)
          try {
            window.localStorage.setItem(TIP_KEY, 'dismissed')
          } catch {
            /* a private window; it stays dismissed for this visit */
          }
        }}
      >
        <X size={16} aria-hidden />
      </button>
    </section>
  )
}

function tipFor(storage: DocumentCapability | null, extraction: DocumentCapability | null): string {
  if (storage?.available && extraction?.available) {
    return 'Attach the bill and auto-read the details using AI.'
  }
  if (storage?.available) {
    return 'Attach the bill — it stays with the voucher, so the expense is still provable a year later.'
  }

  return 'Record the bill number and where the bill is kept — that is what makes an expense findable a year later.'
}

// ---------------------------------------------------------------------------
// Quick categories
// ---------------------------------------------------------------------------

function QuickExpenseCategories({
  categories,
  selectedCategoryId,
  onPick,
  onOpenCategoryList,
}: {
  categories: AsyncState<ListResponse<CatalogAccount>>
  selectedCategoryId: string
  onPick: (accountId: number) => void
  onOpenCategoryList: () => void
}) {
  const accounts = useMemo(() => categories.data?.data ?? [], [categories.data])
  const cards = useMemo(() => resolveQuickCategories(accounts), [accounts])

  return (
    <section className="billing-expense-aside-card">
      <div className="billing-expense-aside-card__head">
        <h2>Quick Expense Categories</h2>
        {accounts.length > cards.length && (
          <button type="button" className="billing-expense-inline-action" onClick={onOpenCategoryList}>
            View all
          </button>
        )}
      </div>

      {categories.loading && (
        <div className="billing-expense-quick" aria-busy="true">
          <span className="billing-sr-only">Loading your expense heads</span>
          {[0, 1, 2, 3].map((key) => (
            <span key={key} className="billing-skeleton" style={{ height: 92, borderRadius: 12 }} />
          ))}
        </div>
      )}

      {!categories.loading && categories.error && (
        <div className="billing-expense-retry">
          <span>We couldn’t load your expense heads.</span>
          <button type="button" className="billing-button billing-button--small" onClick={categories.reload}>
            Retry
          </button>
        </div>
      )}

      {!categories.loading && !categories.error && cards.length === 0 && (
        <p className="billing-expense-inline-note">
          <AlertCircle size={14} aria-hidden />
          No expense heads in this company yet. Add one in Smart Books.
        </p>
      )}

      {cards.length > 0 && (
        <div className="billing-expense-quick">
          {cards.map((card) => (
            <button
              key={card.key}
              type="button"
              className="billing-expense-quick__card"
              aria-pressed={selectedCategoryId === String(card.accountId)}
              title={card.accountName}
              onClick={() => onPick(card.accountId)}
            >
              <card.Icon size={21} aria-hidden className="billing-expense-quick__icon" />
              <span className="billing-expense-quick__label">{card.label}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// AI bill reader
// ---------------------------------------------------------------------------

/**
 * Reading a bill and proposing the fields.
 *
 * Off unless a document-extraction service is configured for this deployment,
 * and when it is off it says why instead of offering a button. Nothing here
 * guesses at a total: what comes back is proposed, shown, and applied only
 * when somebody says so.
 */
function AiBillReaderCard({
  capability,
  busy,
  onReadBill,
}: {
  capability: DocumentCapability | null
  busy: boolean
  onReadBill: () => void
}) {
  const available = capability?.available === true

  return (
    <section className="billing-expense-ai" aria-labelledby="expense-ai-title">
      <div className="billing-expense-ai__body">
        <div className="billing-expense-ai__title" id="expense-ai-title">
          <Sparkles size={17} aria-hidden /> AI Bill Reader
        </div>
        <p id="expense-ai-reason">
          {available
            ? 'Upload the bill and the details come back for you to check before anything is filled in.'
            : (capability?.reason ??
              'AI bill reading will be available once the document extraction service is enabled.')}
        </p>
      </div>

      <button
        type="button"
        className="billing-button billing-button--soft"
        disabled={!available || busy}
        aria-describedby="expense-ai-reason"
        onClick={onReadBill}
      >
        {busy ? <Loader2 size={15} aria-hidden className="spin" /> : <UploadCloud size={15} aria-hidden />}
        {busy ? 'Reading…' : 'Upload & Read Bill'}
      </button>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Recent expenses
// ---------------------------------------------------------------------------

function RecentExpensesCard({
  recent,
  onDuplicate,
  canViewReports,
}: {
  recent: AsyncState<ItemResponse<RecentExpenses>>
  onDuplicate: (row: RecentExpense) => void
  canViewReports: boolean
}) {
  const navigate = useNavigate()
  const data = recent.data?.data
  const rows = data?.rows ?? []

  return (
    <section className="billing-expense-aside-card">
      <div className="billing-expense-aside-card__head">
        <h2>Recent Expenses</h2>
        {canViewReports && rows.length > 0 && (
          <button
            type="button"
            className="billing-expense-inline-action"
            title="Expenses are payment vouchers in Smart Books — open the payment register in Reports"
            onClick={() => navigate('/reports')}
          >
            View all
          </button>
        )}
      </div>

      {recent.loading && (
        <div aria-busy="true">
          <span className="billing-sr-only">Loading recent expenses</span>
          {[0, 1, 2, 3].map((key) => (
            <div key={key} className="billing-expense-skeleton-row">
              <span className="billing-skeleton" style={{ width: 34, height: 34, borderRadius: 10 }} />
              <span className="billing-skeleton billing-skeleton--line" style={{ width: '60%' }} />
            </div>
          ))}
        </div>
      )}

      {!recent.loading && recent.error && (
        <div className="billing-expense-retry">
          <span>We couldn’t load recent expenses.</span>
          <button type="button" className="billing-button billing-button--small" onClick={recent.reload}>
            Retry
          </button>
        </div>
      )}

      {!recent.loading && !recent.error && rows.length === 0 && (
        <p className="billing-expense-inline-note">
          <Receipt size={14} aria-hidden />
          Nothing recorded from Billing yet. Your first expense will show here.
        </p>
      )}

      {rows.length > 0 && (
        <div className="billing-expense-recent">
          {rows.map((row) => (
            <RecentExpenseRow key={row.request_id} row={row} onDuplicate={onDuplicate} />
          ))}
        </div>
      )}

      {data?.basis && rows.length > 0 && <p className="billing-expense-footnote">{data.basis}</p>}
    </section>
  )
}

function RecentExpenseRow({ row, onDuplicate }: { row: RecentExpense; onDuplicate: (row: RecentExpense) => void }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return undefined

    function away(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  const title = row.note ?? row.reference_no ?? row.category_name ?? row.voucher_no ?? 'Expense'

  return (
    <article className="billing-expense-recent__row">
      <span className="billing-expense-recent__mark" aria-hidden>
        <Receipt size={16} />
      </span>

      <span className="billing-expense-recent__main">
        <span className="billing-expense-recent__name" title={title}>{title}</span>
        <span className="billing-expense-recent__meta">
          <span className="billing-expense-recent__date">{formatDate(row.date)}</span>
          {row.category_name && <span className="billing-expense-recent__chip">{row.category_name}</span>}
        </span>
      </span>

      <span className="billing-expense-recent__amount">{row.amount === null ? '—' : money(row.amount)}</span>

      <span className="billing-expense-recent__wrap" ref={box}>
        <button
          type="button"
          className="billing-expense-recent__more"
          aria-label={`More actions for ${title}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <MoreVertical size={16} aria-hidden />
        </button>

        {open && (
          <div className="billing-expense-menu billing-expense-menu--down" role="menu">
            <button
              type="button"
              role="menuitem"
              className="billing-expense-menu__item"
              onClick={() => {
                setOpen(false)
                navigate(`/more/expense/${row.request_id}`)
              }}
            >
              <Eye size={15} aria-hidden /> View
            </button>
            <button
              type="button"
              role="menuitem"
              className="billing-expense-menu__item"
              onClick={() => {
                setOpen(false)
                onDuplicate(row)
              }}
            >
              <Copy size={15} aria-hidden /> Copy into this form
            </button>
            {/* Editing and deleting a posted voucher belong to Smart Books,
                which owns it — there is no Billing route that would do it, so
                there is no button here that pretends otherwise. */}
          </div>
        )}
      </span>
    </article>
  )
}
