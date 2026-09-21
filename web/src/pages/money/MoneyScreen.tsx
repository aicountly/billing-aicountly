/**
 * Money paid and money received.
 *
 * The user sees "Money paid"; internally it is a payment voucher, and the word
 * "voucher" never appears on screen. One component serves both directions
 * because they are the same job mirrored — the same party search, the same
 * accounts, the same bill-by-bill allocation — and two copies of it would be
 * two places to fix the next thing found wrong with either.
 *
 * WHAT IS READ LIVE, AND WHY IT MATTERS HERE
 *
 * Open bills come from Books each time a party is picked, so a bill somebody
 * settled this morning cannot be paid twice. The recent list and the period
 * totals are Books' register on this request. Nothing on this screen is a
 * stored copy, and nothing on it is a figure this product made up: where a
 * total could not be proved complete the panel shows "—" and says why.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Lightbulb, WalletCards } from 'lucide-react'
import { api } from '../../services/api'
import type {
  CashBankAccount,
  MoneyActivity,
  MoneyActivityRow,
  MoneyPartyContext,
} from '../../services/types'
import { useApi } from '../../hooks/useApi'
import { useBilling } from '../../context/BillingContext'
import { Notice, ToastStack, useToasts, money } from '../../ui'
import { MoneyEntryForm } from './MoneyEntryForm'
import { MoneySummaryCard } from './MoneySummaryCard'
import { MoneySuggestionsCard } from './MoneySuggestionsCard'
import { RecentMoneyTable, type RowAction } from './RecentMoneyTable'
import { buildMoneyHints, type MoneyHint } from './suggestions'
import { localToday, toPaise, type Direction, type MoneyPeriodKey } from './money'
import { useMoneyForm, type OpenBill } from './useMoneyForm'
import '../../styles/billing-money.css'

interface OpenBillsResponse {
  account_id: number
  bills: OpenBill[]
  source: string
}

export function MoneyScreen({ direction }: { direction: Direction }) {
  const navigate = useNavigate()
  const { scope, session, can } = useBilling()
  const isOut = direction === 'out'
  const permission = isOut ? 'payment.create' : 'receipt.create'
  const allowed = can(permission)

  const [period, setPeriod] = useState<MoneyPeriodKey>('month')
  const [allocationOpen, setAllocationOpen] = useState(false)
  const [saveAndNew, setSaveAndNew] = useState(false)
  /** Bumped after a Save & New, to put the caret back on the party field. */
  const [refocusParty, setRefocusParty] = useState(0)
  const { toasts, push, dismiss } = useToasts()
  const [search] = useSearchParams()

  const pageRef = useRef<HTMLDivElement>(null)
  const partyInputRef = useRef<HTMLInputElement>(null)
  const partyChangeRef = useRef<HTMLButtonElement>(null)
  const amountInputRef = useRef<HTMLInputElement>(null)
  const dateInputRef = useRef<HTMLInputElement>(null)
  const referenceInputRef = useRef<HTMLInputElement>(null)

  // -------------------------------------------------------------------------
  // Live reads
  // -------------------------------------------------------------------------

  const cashBank = useApi(
    (signal) => api.list<CashBankAccount>('v1/catalog/cash-bank', undefined, signal),
    [scope?.cmp_id],
    Boolean(scope) && allowed,
  )

  const activity = useApi(
    (signal) => api.one<MoneyActivity>('v1/money/recent', { direction, period, limit: 8 }, signal),
    [direction, period, scope?.cmp_id, scope?.fy_id, scope?.bo_id],
    Boolean(scope) && allowed,
  )

  const accounts = useMemo(() => cashBank.data?.data ?? [], [cashBank.data])
  const businessToday = activity.data?.data.period.to ?? null

  // -------------------------------------------------------------------------
  // The form
  // -------------------------------------------------------------------------

  const [bills, setBills] = useState<OpenBill[]>([])

  /**
   * What the link opened this screen with.
   *
   * Money to Collect sends the party and the balance it was looking at, so a
   * user who clicked "Record money received" against a bill does not retype
   * either. Read once, into the form's opening values — the open bills and the
   * allocation still come from Books when the party lands.
   */
  const opening = useMemo(() => {
    // Two spellings, because two screens hand a party over and they were
    // written apart: Money to Collect sends `account_id`, and the bill editor
    // and the party directory send `party_account_id`. Reading both here is a
    // line; renaming one of them is a migration and a broken bookmark.
    const id = Number(search.get('account_id') ?? search.get('party_account_id'))
    const name = search.get('account_name') ?? search.get('party_name')
    const amount = Number(search.get('amount'))

    return {
      party: Number.isFinite(id) && id > 0 && name ? { id, name } : null,
      amount: Number.isFinite(amount) && amount > 0 ? amount.toFixed(2) : '',
    }
    // The opening value only: re-reading it after the user has typed would
    // undo their edit on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const form = useMoneyForm({
    direction,
    bills,
    today: localToday(),
    prefill: opening,
    onSaved: ({ requestId, amount, partyName, savedAndNew }) => {
      // The period totals and the recent list both just changed.
      activity.reload()

      if (savedAndNew) {
        push({
          tone: 'success',
          title: isOut ? 'Payment recorded' : 'Receipt recorded',
          detail: `${money(amount)} ${isOut ? 'paid to' : 'received from'} ${partyName}`,
        })
        setAllocationOpen(false)
        // Focus is moved by an effect, not a timer. The party input only exists
        // once the form has re-rendered empty, and a setTimeout(0) raced that
        // commit -- sometimes focusing an input that was about to be replaced,
        // leaving the caret on the amount instead of the party.
        setRefocusParty((n) => n + 1)
        return
      }

      // Otherwise the entry's own screen, which is where a save that has not
      // reached Books yet can be watched and retried. Unchanged from before.
      navigate(`/${isOut ? 'money-out' : 'money-in'}/${requestId}`)
    },
    onFailed: (message) => push({ tone: 'danger', title: 'Could not save this entry', detail: message }),
  })

  const party = form.values.party

  const openBills = useApi(
    (signal) =>
      api.one<OpenBillsResponse>(
        'v1/open-bills',
        { account_id: party?.id, side: isOut ? 'payable' : 'receivable' },
        signal,
      ),
    [party?.id, scope?.cmp_id, direction],
    Boolean(scope && party) && allowed,
  )

  const partyContext = useApi(
    (signal) =>
      api.one<MoneyPartyContext>('v1/money/party-context', { party_account_id: party?.id, direction }, signal),
    [party?.id, scope?.cmp_id, direction],
    Boolean(scope && party) && allowed,
  )

  // The bills the form allocates against are kept in state rather than read
  // straight from the query, so an in-flight refetch cannot blank the rows out
  // from under a half-typed allocation.
  useEffect(() => {
    if (!party) {
      setBills([])
      return
    }
    if (openBills.data) setBills(openBills.data.data.bills ?? [])
  }, [party, openBills.data])

  // The hook hands back a fresh object every render, so effects below depend on
  // the stable pieces of it rather than on `form` — a dependency that changes
  // every render is a dependency that does nothing except re-run the effect.
  const { set: setField, adoptBusinessDate } = form
  const accountId = form.values.accountId

  /** One account, or the first of several — the same default as before. */
  useEffect(() => {
    if (accountId === '' && accounts.length > 0) {
      setField('accountId', String(accounts[0].acc_id))
    }
  }, [accounts, accountId, setField])

  useEffect(() => {
    if (businessToday) adoptBusinessDate(businessToday)
  }, [businessToday, adoptBusinessDate])

  useEffect(() => {
    if (refocusParty === 0) return
    partyInputRef.current?.focus()
  }, [refocusParty])

  // -------------------------------------------------------------------------
  // Leaving with something typed
  // -------------------------------------------------------------------------

  const leave = useCallback(
    (go: () => void) => {
      if (form.dirty && !window.confirm('This entry has not been saved. Leave anyway?')) return
      go()
    },
    [form.dirty],
  )

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------

  // Read through a ref so the listener is bound once rather than torn down and
  // re-bound on every keystroke in the form.
  const saveNow = useRef<() => void>(() => {})
  saveNow.current = () => void form.save(saveAndNew)

  useEffect(() => {
    if (!allowed) return undefined

    function onKeyDown(event: KeyboardEvent) {
      // Ctrl/Cmd+Enter saves, but only from inside this screen — the same
      // chord in the global search belongs to the global search.
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        if (!pageRef.current?.contains(document.activeElement)) return
        event.preventDefault()
        saveNow.current()
        return
      }

      if (!event.altKey || event.ctrlKey || event.metaKey) return

      const target =
        event.key.toLowerCase() === 'p'
          ? (partyInputRef.current ?? partyChangeRef.current)
          : event.key.toLowerCase() === 'a'
            ? amountInputRef.current
            : event.key.toLowerCase() === 'd'
              ? dateInputRef.current
              : null

      if (target) {
        event.preventDefault()
        target.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [allowed])

  // -------------------------------------------------------------------------
  // Suggestions — built here from what is already on screen
  // -------------------------------------------------------------------------

  const hints = useMemo(
    () =>
      buildMoneyHints({
        direction,
        party: party ? { id: party.id, name: party.name } : null,
        billsLoading: openBills.loading,
        billsFailed: openBills.error !== null,
        openBillCount: bills.length,
        openBillTotalPaise: bills.reduce((sum, bill) => sum + toPaise(bill.balance), 0),
        amountPaise: form.amountPaise,
        allocatedPaise: form.allocatedPaise,
        partyContext: partyContext.data?.data ?? null,
        partyContextLoading: partyContext.loading,
        mode: form.mode,
        reference: form.values.reference,
      }),
    [
      direction,
      party,
      openBills.loading,
      openBills.error,
      bills,
      form.amountPaise,
      form.allocatedPaise,
      form.mode,
      form.values.reference,
      partyContext.data,
      partyContext.loading,
    ],
  )

  function onHint(hint: MoneyHint) {
    if (hint.action?.kind === 'allocate') {
      setAllocationOpen(true)
      window.setTimeout(
        () => document.getElementById('money-allocation')?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
        0,
      )
      return
    }
    if (hint.action?.kind === 'history' && party) {
      leave(() => navigate(`/parties/${party.id}`))
      return
    }
    if (hint.action?.kind === 'reference') referenceInputRef.current?.focus()
  }

  // -------------------------------------------------------------------------
  // Row actions — only the ones that exist
  // -------------------------------------------------------------------------

  const actionsFor = useCallback(
    (row: MoneyActivityRow): RowAction[] => {
      const actions: RowAction[] = []

      if (row.request_id !== null) {
        actions.push({
          key: 'view',
          label: 'Open this entry',
          icon: 'view',
          run: () => leave(() => navigate(`/${isOut ? 'money-out' : 'money-in'}/${row.request_id}`)),
        })
      }
      if (row.party_id !== null) {
        actions.push({
          key: 'party',
          label: 'Open party statement',
          icon: 'party',
          run: () => leave(() => navigate(`/parties/${row.party_id}`)),
        })
      }
      if (allowed && row.party_id !== null && row.party !== null) {
        actions.push({
          key: 'copy',
          label: 'Use as a template',
          icon: 'copy',
          run: () => {
            // Everything except the date, which stays today: a copied entry is
            // a new one, and inheriting last week's date is how a payment ends
            // up in the wrong month.
            form.pickParty({ acc_id: row.party_id!, acc_name: row.party! })
            if (row.amount !== null) form.setAmount(String(row.amount))
            if (row.payment_mode) form.set('mode', row.payment_mode)
            form.set('reference', '')
            form.set('narration', row.narration ?? '')
            if (row.account_id !== null) form.set('accountId', String(row.account_id))
            window.scrollTo({ top: 0, behavior: 'smooth' })
            window.setTimeout(() => amountInputRef.current?.focus(), 0)
            push({
              tone: 'info',
              title: 'Copied into the form',
              detail: 'Check the amount and reference before saving.',
            })
          },
        })
      }

      return actions
    },
    [allowed, isOut, form, leave, navigate, push],
  )

  // -------------------------------------------------------------------------

  if (!allowed) {
    return (
      <Notice tone="warning" title={isOut ? 'You cannot record money paid' : 'You cannot record money received'}>
        Your Billing profile does not include this. Ask whoever manages access if you need it.
      </Notice>
    )
  }

  const data = activity.data?.data ?? null

  return (
    <div className="billing-money" ref={pageRef}>
      <section className="billing-money__hero">
        <div className="billing-money__hero-left">
          <span className="billing-money__hero-mark" aria-hidden="true">
            <WalletCards size={25} />
          </span>
          <div>
            <h1>{isOut ? 'Money paid' : 'Money received'}</h1>
            <p>
              {isOut
                ? 'Record payments made to suppliers, expenses, or other parties'
                : 'Record money received from customers or other parties'}
            </p>
          </div>
        </div>

        <div className="billing-money__tip">
          <span className="billing-money__tip-mark" aria-hidden="true">
            <Lightbulb size={19} />
          </span>
          <div>
            <strong>{isOut ? 'Pay faster, stay in control' : 'Get paid faster, stay in control'}</strong>
            <span>
              {isOut
                ? 'Every payment recorded here lands in your books straight away.'
                : 'Every receipt recorded here lands in your books straight away.'}
            </span>
          </div>
        </div>
      </section>

      {form.saveError && (
        <Notice
          tone="danger"
          title="Could not save"
          onDismiss={() => form.setSaveError(null)}
          action={
            form.retryId !== null ? (
              <button
                type="button"
                className="billing-button billing-button--small"
                disabled={form.saving}
                onClick={() => void form.retry()}
              >
                Retry
              </button>
            ) : undefined
          }
        >
          {form.saveError}
        </Notice>
      )}

      <div className="billing-money__layout">
        <MoneyEntryForm
          direction={direction}
          form={form}
          accounts={accounts}
          accountsLoading={cashBank.loading}
          bills={bills}
          billsLoading={openBills.loading}
          billsFailed={openBills.error !== null}
          allocationOpen={allocationOpen}
          onAllocationOpenChange={setAllocationOpen}
          partyInputRef={partyInputRef}
          partyChangeRef={partyChangeRef}
          amountInputRef={amountInputRef}
          dateInputRef={dateInputRef}
          referenceInputRef={referenceInputRef}
          onCancel={() => leave(() => navigate(-1))}
          onExpense={() => leave(() => navigate('/more/expense'))}
          canSave={allowed}
          saveAndNew={saveAndNew}
          onSaveAndNewChange={setSaveAndNew}
        />

        <aside className="billing-money__rail">
          <MoneySummaryCard
            direction={direction}
            summary={data?.summary ?? null}
            loading={activity.loading}
            error={activity.error}
            period={period}
            onPeriodChange={setPeriod}
            periodLabel={data?.period.label ?? null}
          />

          <MoneySuggestionsCard
            direction={direction}
            hints={hints}
            loading={openBills.loading || partyContext.loading}
            hasParty={party !== null}
            onAct={onHint}
          />
        </aside>
      </div>

      <RecentMoneyTable
        direction={direction}
        rows={data?.rows ?? []}
        loading={activity.loading}
        error={activity.error}
        note={data?.note ?? null}
        onRetry={activity.reload}
        onViewAll={can('reports.view') ? () => leave(() => navigate(`/reports?report=${isOut ? 'payments' : 'receipts'}&period=${period}`)) : null}
        onCreate={() => partyInputRef.current?.focus()}
        actionsFor={actionsFor}
        currentUser={
          session ? { uuid: session.uuid, name: session.display_name_known ? session.display_name : null } : null
        }
      />

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
