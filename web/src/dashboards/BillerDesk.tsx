/**
 * Dashboard 2 — "Ready for your next bill".
 *
 * The counter screen: a customer box, an item box, and the bills this person
 * has not finished. It shows their own work and nothing about the business —
 * not because the cards are hidden, but because the API never sends them.
 *
 * The customer and item chosen here are carried into the real invoice editor
 * rather than being a search box that forgets what you picked.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ClipboardList, FileText, IndianRupee, Printer, RotateCcw, ScanLine } from 'lucide-react'
import { PartyPicker } from '../components/LivePicker'
import { api } from '../services/api'
import type { CatalogItem, CatalogParty } from '../services/types'
import { useApi } from '../hooks/useApi'
import { useBilling } from '../context/BillingContext'
import { date, money } from '../ui'
import { BillingDashboardLayout, DataStatus } from './DashboardLayout'
import {
  Badge,
  DashboardPanel,
  EmptyState,
  ErrorState,
  QuickAction,
  SettlementBadge,
  SkeletonRows,
  Unavailable,
} from './kit'
import { useDashboard } from './useDashboard'
import { countFormat } from './Overview'
import type { BillerDashboard } from './types'

const ICONS: Record<string, React.ReactNode> = {
  my_invoices_today: <FileText size={17} />,
  my_billed_value: <IndianRupee size={17} />,
  my_drafts: <ClipboardList size={17} />,
  my_document_checks: <ScanLine size={17} />,
}

export default function BillerDesk() {
  const navigate = useNavigate()
  const { scope, can } = useBilling()
  const { data, loading, error, retryable, reload } = useDashboard<BillerDashboard>('v1/dashboards/biller', 'today')

  const [customer, setCustomer] = useState<{ id: number; name: string } | null>(null)
  const [itemTerm, setItemTerm] = useState('')

  const favourites = useApi(
    (signal) => api.get<{ data: CatalogItem[] }>('v1/catalog/items/favourites', undefined, signal),
    [scope?.cmp_id, scope?.fy_id],
    Boolean(scope) && can('sale.create'),
  )

  /** Everything picked here travels with you, so the editor opens ready. */
  function startInvoice(extra?: Record<string, string>) {
    const params = new URLSearchParams()
    if (customer) {
      params.set('party_account_id', String(customer.id))
      params.set('party_name', customer.name)
    }
    for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value)
    navigate(`/sales/new${params.toString() ? `?${params.toString()}` : ''}`)
  }

  const panels = data?.panels

  return (
    <BillingDashboardLayout
      activeDashboard="biller"
      title="Ready for your next bill"
      description="Fast billing. Fewer clicks."
      period={data?.period}
      status={<DataStatus generatedAt={data?.generated_at} loading={loading} onRefresh={reload} />}
      metrics={data?.metrics ?? []}
      metricsLoading={loading}
      metricFormat={countFormat}
      metricIcons={ICONS}
      actions={
        can('sale.create') ? (
          <button type="button" className="billing-button billing-button--primary" onClick={() => startInvoice()}>
            New Invoice
          </button>
        ) : undefined
      }
    >
      {error && <ErrorState message={error} onRetry={retryable ? reload : undefined} />}

      <div className="billing-grid billing-grid--wide">
        <DashboardPanel
          title="Start a new invoice"
          description="Pick the customer, then the items."
          footnote="Customers come from Smart Books and items from Aicountly Inventory, read as you type."
        >
          {!can('sale.create') ? (
            <Unavailable title="Not your job here">
              Your Billing profile can see bills but not raise them.
            </Unavailable>
          ) : (
            <div style={{ display: 'grid', gap: '1.1rem' }}>
              <PartyPicker
                side="customer"
                selectedLabel={customer?.name}
                autoFocus
                onPick={(picked: CatalogParty) => setCustomer({ id: picked.acc_id, name: picked.acc_name })}
              />

              <div className="billing-field">
                <label htmlFor="desk-item">Scan a barcode or search an item</label>
                <input
                  id="desk-item"
                  type="search"
                  placeholder="Scan barcode or type an item name…"
                  value={itemTerm}
                  onChange={(event) => setItemTerm(event.target.value)}
                  onKeyDown={(event) => {
                    // A barcode scanner is a keyboard that types fast and
                    // presses Enter. Nothing special is needed for it — and the
                    // same box still works for somebody typing a name.
                    if (event.key === 'Enter' && itemTerm.trim() !== '') {
                      event.preventDefault()
                      startInvoice({ scan: itemTerm.trim() })
                    }
                  }}
                />
                <span className="billing-field__hint">
                  Press Enter to carry it into the bill. A scanner works here without any setup.
                </span>
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 8 }}>Recently billed items</div>
                {favourites.loading ? (
                  <SkeletonRows rows={2} />
                ) : (favourites.data?.data ?? []).length === 0 ? (
                  <p style={{ color: 'var(--billing-muted)', margin: 0, fontSize: 13 }}>
                    The items you bill most will appear here once you have billed a few.
                  </p>
                ) : (
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {(favourites.data?.data ?? []).slice(0, 6).map((item) => (
                      <button
                        key={item.item_id}
                        type="button"
                        className="billing-button billing-button--small"
                        onClick={() => startInvoice({ item_id: String(item.item_id) })}
                      >
                        {item.item_name}
                        {item.mrp && (
                          <span style={{ color: 'var(--billing-muted)' }} className="num">
                            {money(Number(item.mrp))}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="button" className="billing-button billing-button--primary" onClick={() => startInvoice()}>
                  Create Invoice <ArrowRight size={15} aria-hidden />
                </button>
              </div>
            </div>
          )}
        </DashboardPanel>

        <div style={{ display: 'grid', gap: 22 }}>
          <DashboardPanel
            title="Finish a bill"
            description="Started here and not yet accepted by Smart Books"
            action={
              (panels?.unfinished ?? []).length > 0 ? (
                <button type="button" className="billing-button billing-button--small" onClick={() => navigate('/more/unfinished')}>
                  View all
                </button>
              ) : undefined
            }
          >
            {loading && !data ? (
              <SkeletonRows rows={3} />
            ) : (panels?.unfinished ?? []).length === 0 ? (
              <EmptyState>Nothing half-finished. Every bill you started has been saved.</EmptyState>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {(panels?.unfinished ?? []).slice(0, 4).map((request) => (
                  <div
                    key={request.request_id}
                    className="billing-suggestion"
                    style={{ alignItems: 'center' }}
                  >
                    <div>
                      <strong style={{ fontSize: 14 }}>
                        {request.kind === 'sale' ? 'Bill' : request.kind.replace(/_/g, ' ')} · {date(request.date)}
                      </strong>
                      <p>
                        {request.line_count} line{request.line_count === 1 ? '' : 's'}
                        {request.entered_value !== null && (
                          <>
                            {' · '}
                            <span className="num">{money(request.entered_value)}</span> as entered, before tax
                          </>
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="billing-button billing-button--soft billing-button--small"
                      onClick={() => navigate('/more/unfinished')}
                    >
                      Continue
                    </button>
                  </div>
                ))}
              </div>
            )}
          </DashboardPanel>

          <DashboardPanel title="Quick actions">
            <div className="billing-quick-actions">
              {panels?.can_return && (
                <QuickAction
                  label="Sales return"
                  hint="Credit note"
                  icon={<RotateCcw size={18} />}
                  onClick={() => navigate('/more/credit-note')}
                />
              )}
              {panels?.can_take_money && (
                <QuickAction
                  label="Take money"
                  hint="Record a receipt"
                  icon={<IndianRupee size={18} />}
                  onClick={() => navigate('/money-in/new')}
                />
              )}
              <QuickAction
                label="Reprint a bill"
                hint="Find and print"
                icon={<Printer size={18} />}
                onClick={() => navigate('/sales')}
              />
            </div>
          </DashboardPanel>
        </div>
      </div>

      <DashboardPanel
        title="Checks before you issue"
        description="What Billing can tell is missing, without troubling Smart Books"
        footnote="These are checks on what you typed. Smart Books decides the tax and whether a document is needed — Billing never guesses at either."
      >
        {loading && !data ? (
          <SkeletonRows rows={2} />
        ) : (panels?.checks ?? []).length === 0 ? (
          <EmptyState>Nothing to clear. Your bills are complete.</EmptyState>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {(panels?.checks ?? []).map((check) => (
              <div key={check.id} className="billing-suggestion">
                <div className="billing-suggestion__body">
                  <div>
                    <h3>
                      {check.title}{' '}
                      <Badge tone={check.tone === 'danger' ? 'danger' : check.tone === 'warning' ? 'warning' : 'info'}>
                        {check.tone === 'danger' ? 'Blocking' : check.tone === 'warning' ? 'Check' : 'In progress'}
                      </Badge>
                    </h3>
                    <p>{check.detail}</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="billing-button billing-button--soft billing-button--small"
                  onClick={() => navigate(check.action.path)}
                >
                  {check.action.label}
                </button>
              </div>
            ))}
          </div>
        )}
      </DashboardPanel>

      <DashboardPanel title="My recent bills" className="billing-panel--flush">
        {loading && !data ? (
          <div style={{ padding: '0 22px' }}><SkeletonRows rows={5} /></div>
        ) : !panels?.recent.available ? (
          <div style={{ padding: '0 22px' }}>
            <Unavailable>{panels?.recent.reason ?? 'Smart Books did not answer.'}</Unavailable>
          </div>
        ) : panels.recent.rows.length === 0 ? (
          <EmptyState>You have not billed anything yet.</EmptyState>
        ) : (
          <div className="billing-table-scroll">
            <table className="billing-table">
              <thead>
                <tr>
                  <th scope="col">Invoice No.</th>
                  <th scope="col">Date</th>
                  <th scope="col">Customer</th>
                  <th scope="col" className="billing-amount">Amount</th>
                  <th scope="col">Payment</th>
                  <th scope="col"><span className="billing-sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {panels.recent.rows.map((row) => (
                  <tr key={row.voucher_uuid ?? row.voucher_id ?? row.document_no}>
                    <td>{row.document_no ?? '—'}</td>
                    <td>{date(row.date)}</td>
                    <td>{row.party ?? '—'}</td>
                    <td className="billing-amount">{row.amount === null ? '—' : money(row.amount)}</td>
                    <td><SettlementBadge status={row.status} /></td>
                    <td>
                      {row.voucher_id !== null && (
                        <button
                          type="button"
                          className="billing-button billing-button--quiet billing-button--small"
                          onClick={() => navigate(`/sales/${row.voucher_id}`)}
                        >
                          <Printer size={14} aria-hidden /> Open
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DashboardPanel>
    </BillingDashboardLayout>
  )
}
