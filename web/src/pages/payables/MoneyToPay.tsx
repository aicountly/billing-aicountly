/**
 * Money to Pay — the payables workspace.
 *
 * ONE READING OF SMART BOOKS DRAWS THE WHOLE SCREEN. The cards, the ageing,
 * what falls due next, the category split and the page of bills all come from
 * the same `v1/payables` answer, worked out on this request. Billing stores no
 * payable of its own and this page has no second source to drift from.
 *
 * Two things this screen is careful about.
 *
 * The cards describe the POSITION and the table describes a QUERY. Filtering to
 * one supplier narrows the rows and leaves "Total payables" alone, because a
 * headline that moved with the filter would be a different number every time
 * somebody searched and nobody could quote it.
 *
 * And a refresh keeps what is already on screen. Changing a filter fades the
 * table and leaves the figures readable rather than blanking a page somebody is
 * in the middle of reading.
 */

import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileUp, Loader2, Receipt } from 'lucide-react'
import { api, ApiError } from '../../services/api'
import type { PayableBill, PayablesComparison, PayablesWorkspace } from '../../services/types'
import { useApi } from '../../hooks/useApi'
import { useBilling } from '../../context/BillingContext'
import { money } from '../../ui'
import { Notice } from '../../ui'
import { PayablesHeader } from './Header'
import { PayablesKpis } from './Kpis'
import { PayablesAgeing } from './Ageing'
import { UpcomingPayments } from './Upcoming'
import { PayablesCategories } from './Categories'
import { PayablesToolbar } from './Toolbar'
import { PayablesTable } from './BillsTable'
import { BillDetail } from './BillDetail'
import { DueCalendar } from './DueCalendar'
import { Dialog, EmptyState, ErrorState } from './parts'
import { toApiParams, usePayablesQuery } from './query'
import '../../styles/payables.css'

export default function MoneyToPay() {
  const navigate = useNavigate()
  const { scope, can } = useBilling()
  const { query, patch, reset, clearAdvanced, advancedCount, isFiltered } = usePayablesQuery()

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [openBill, setOpenBill] = useState<PayableBill | null>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const params = useMemo(() => toApiParams(query), [query])
  // One string, so the dependency list keeps a stable length whatever is filtered.
  const queryKey = useMemo(() => JSON.stringify(params), [params])

  const payables = useApi(
    (signal) => api.one<PayablesWorkspace>('v1/payables', params, signal),
    [scope?.cmp_id, scope?.fy_id, scope?.bo_id, queryKey],
    Boolean(scope),
  )

  /**
   * What was owed a month ago — a second, slower reading, on its own.
   *
   * Keyed only on the company, so typing in the search box does not send Books
   * off to read a month of history again.
   */
  const comparison = useApi(
    (signal) => api.one<{ as_on: string; comparison: PayablesComparison }>('v1/payables/comparison', undefined, signal),
    [scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    Boolean(scope),
  )

  const workspace = payables.data?.data ?? null
  const refreshing = payables.loading && workspace !== null
  const bills = workspace?.bills ?? []

  const clearSelection = useCallback(() => setSelected(new Set()), [])

  const toggle = useCallback((bill: PayableBill) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(bill.row_key)) next.delete(bill.row_key)
      else next.add(bill.row_key)

      return next
    })
  }, [])

  const toggleAll = useCallback((rows: PayableBill[], select: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      for (const row of rows) {
        if (select) next.add(row.row_key)
        else next.delete(row.row_key)
      }

      return next
    })
  }, [])

  /**
   * Open the payment screen with the supplier already chosen.
   *
   * `account_id` / `account_name` / `amount` is the contract Money to Collect
   * already links with, and the money screen already reads. A second spelling
   * of the same three values would work until somebody changed one of them.
   */
  const recordPayment = useCallback(
    (bill: { account_id: number; account_name: string; balance?: number }) => {
      const params = new URLSearchParams({
        account_id: String(bill.account_id),
        account_name: bill.account_name,
      })
      if (bill.balance !== undefined) params.set('amount', String(bill.balance))
      navigate(`/money-out/new?${params.toString()}`)
    },
    [navigate],
  )

  async function exportCsv() {
    if (exporting) return
    setExporting(true)
    setExportError(null)
    try {
      const { blob, filename } = await api.download('v1/payables/export', params)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }

  // The bills ticked on this page, which is all a payment could ever be against.
  const chosen = bills.filter((bill) => selected.has(bill.row_key))
  const chosenAmount = chosen.reduce((sum, bill) => sum + bill.balance, 0)
  const chosenSuppliers = new Set(chosen.map((bill) => bill.account_id))

  const permissions = {
    add_purchase: can('purchase.create'),
    add_expense: can('expense.create'),
    debit_note: can('debit_note.create'),
  }

  if (payables.error && workspace === null) {
    return (
      <div className="mtp-page">
        <PayablesHeader
          can={permissions}
          onCalendar={() => setCalendarOpen(true)}
          onImport={() => setImportOpen(true)}
          onCreate={navigate}
        />
        <section className="mtp-card">
          <ErrorState
            title="Unable to load what you owe"
            message={payables.error}
            onRetry={payables.reload}
          />
        </section>
      </div>
    )
  }

  const nothingAtAll = workspace !== null && workspace.summary.bill_count === 0
  const nothingMatches = workspace !== null && !nothingAtAll && workspace.pagination.total === 0

  return (
    <div className="mtp-page">
      <PayablesHeader
        can={permissions}
        onCalendar={() => setCalendarOpen(true)}
        onImport={() => setImportOpen(true)}
        onCreate={navigate}
      />

      {payables.error && workspace !== null && (
        <Notice tone="warning" title="Showing the last figures that loaded">
          {payables.error}{' '}
          <button type="button" className="mtp-link" onClick={payables.reload}>Try again</button>
        </Notice>
      )}

      {exportError && (
        <Notice tone="warning" title="The file was not built" onDismiss={() => setExportError(null)}>
          {exportError}
        </Notice>
      )}

      <PayablesKpis
        summary={workspace?.summary ?? null}
        comparison={comparison.data?.data.comparison ?? null}
        loading={payables.loading && workspace === null}
        activeStatus={query.status}
        onPick={(status) => {
          clearSelection()
          patch({ status })
        }}
      />

      <section className="mtp-insights" aria-label="How what you owe breaks down">
        <PayablesAgeing
          buckets={workspace?.ageing_buckets ?? []}
          reconciles={workspace?.ageing_reconciles ?? true}
          loading={payables.loading && workspace === null}
          activeBucket={query.age_bucket}
          onPick={(bucket) => {
            clearSelection()
            patch({ age_bucket: bucket })
          }}
        />

        <UpcomingPayments
          upcoming={workspace?.upcoming ?? null}
          loading={payables.loading && workspace === null}
          onOpenBill={setOpenBill}
          onViewAll={() => {
            clearSelection()
            patch({ status: 'next_30_days' })
          }}
        />

        <PayablesCategories
          categories={workspace?.categories ?? null}
          loading={payables.loading && workspace === null}
          activeCategory={query.category}
          onPick={(category) => {
            clearSelection()
            patch({ category })
          }}
        />
      </section>

      <section className="mtp-card mtp-table-card" aria-label="Outstanding bills">
        <PayablesToolbar
          query={query}
          patch={(changes) => {
            clearSelection()
            patch(changes)
          }}
          clearAdvanced={() => {
            clearSelection()
            clearAdvanced()
          }}
          advancedCount={advancedCount}
          suppliers={workspace?.parties ?? []}
          categories={workspace?.categories ?? null}
          canExport={can('export.data')}
          exporting={exporting}
          onExport={exportCsv}
        />

        {chosen.length > 0 && (
          <div className="mtp-bulk">
            <span>
              <strong>{chosen.length} bill{chosen.length === 1 ? '' : 's'} selected</strong>
              {' · '}{money(chosenAmount)}
            </span>
            <span className="mtp-bulk__actions">
              {can('payment.create') && (
                <button
                  type="button"
                  className="billing-button billing-button--primary billing-button--small"
                  disabled={chosenSuppliers.size !== 1}
                  title={
                    chosenSuppliers.size === 1
                      ? 'Open a payment to this supplier, with these bills to allocate against'
                      : 'A payment is made to one supplier. Select bills from a single supplier to record one.'
                  }
                  onClick={() => recordPayment(chosen[0])}
                >
                  Record a payment
                </button>
              )}
              <button type="button" className="billing-button billing-button--small" onClick={clearSelection}>
                Clear selection
              </button>
            </span>
          </div>
        )}

        {nothingAtAll ? (
          <EmptyState
            title="Nothing to pay"
            icon={<Receipt size={20} />}
            actions={
              <>
                {permissions.add_purchase && (
                  <button type="button" className="billing-button billing-button--primary billing-button--small" onClick={() => navigate('/purchases/new')}>
                    New purchase bill
                  </button>
                )}
                {permissions.add_expense && (
                  <button type="button" className="billing-button billing-button--small" onClick={() => navigate('/more/expense')}>
                    Record an expense
                  </button>
                )}
              </>
            }
          >
            Purchase bills and expenses with something still outstanding will appear here.
          </EmptyState>
        ) : nothingMatches ? (
          <EmptyState
            title="No bills match these filters"
            actions={
              <button type="button" className="billing-button billing-button--small" onClick={() => { clearSelection(); reset() }}>
                Clear filters
              </button>
            }
          >
            {isFiltered
              ? 'Nothing outstanding fits the search and filters you have set.'
              : 'There is nothing on this page.'}
          </EmptyState>
        ) : (
          <div className={refreshing ? 'mtp-stale' : undefined} aria-busy={refreshing}>
            <PayablesTable
              workspace={workspace}
              query={query}
              patch={(changes) => {
                clearSelection()
                patch(changes)
              }}
              loading={payables.loading}
              canRecordPayment={can('payment.create')}
              canViewStatement={can('statement.view')}
              selected={selected}
              onToggle={toggle}
              onToggleAll={toggleAll}
              onOpenBill={setOpenBill}
              onRecordPayment={recordPayment}
              onOpenSupplier={(bill) => navigate(`/parties/${bill.account_id}`)}
            />
          </div>
        )}
      </section>

      <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--billing-muted)', fontSize: 12 }}>
        {refreshing && (
          <span className="mtp-refreshing">
            <Loader2 size={13} className="spin" aria-hidden /> Refreshing…
          </span>
        )}
        {workspace?.note}
      </p>

      {openBill && (
        <BillDetail
          bill={openBill}
          canRecordPayment={can('payment.create')}
          canViewStatement={can('statement.view')}
          onClose={() => setOpenBill(null)}
          onRecordPayment={() => recordPayment(openBill)}
          onOpenSupplier={() => navigate(`/parties/${openBill.account_id}`)}
        />
      )}

      {calendarOpen && workspace && (
        <DueCalendar
          days={workspace.calendar}
          today={workspace.as_on}
          onClose={() => setCalendarOpen(false)}
          onPickDay={(day) => {
            setCalendarOpen(false)
            clearSelection()
            patch({ status: 'all', due_date_from: day, due_date_to: day })
          }}
        />
      )}

      {importOpen && (
        <Dialog
          title="Import bills"
          onClose={() => setImportOpen(false)}
          footer={
            <>
              {permissions.add_purchase && workspace && (
                <button
                  type="button"
                  className="billing-button billing-button--primary"
                  onClick={() => navigate(workspace.import.manual_path)}
                >
                  <FileUp size={15} aria-hidden /> Enter the bill instead
                </button>
              )}
              <button type="button" className="billing-button" onClick={() => setImportOpen(false)}>Close</button>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55 }}>
            {workspace?.import.reason ??
              'Reading a bill from a PDF or a photo needs a document-extraction service, and none is configured for this deployment.'}
          </p>
        </Dialog>
      )}
    </div>
  )
}
