/**
 * The Billing setup checklist — derived, never decorative.
 *
 * THE RULE THIS FILE EXISTS FOR: the progress bar on the Settings page shows
 * what is actually configured. Nothing here returns a fixed "4 of 6", and no
 * step is reported done because it looks better done.
 *
 * Each step has THREE outcomes, not two:
 *
 *   true   — checked against real configuration and it is there
 *   false  — checked and it is not there; the row says what to do
 *   null   — NOT KNOWN. Either the source could not be reached, or this
 *            profile may not read it. An unknown step is left out of the
 *            denominator rather than counted as a failure, because "2 of 6"
 *            shown to a biller who simply cannot see four of them is wrong.
 *
 * Every source below is a live read from the product that owns the answer —
 * Manage for the company, Books for the accounts, Billing for its own rules.
 * Nothing is cached and nothing is written down. See docs/ARCHITECTURE.md.
 */

import { useMemo } from 'react'
import { api } from './api'
import { fetchCompanyInfo } from './manage'
import type { CompanyInfo } from './manage'
import type { BillingProfile, BillingSettings, CashBankAccount, ReminderRule } from './types'
import { useApi } from '../hooks/useApi'
import { useBilling } from '../context/BillingContext'
import { settingsPath } from '../config/settingsCatalog'

export interface SetupStep {
  key: string
  label: string
  /** What to do about it, in one line. Changes with the outcome. */
  detail: string
  complete: boolean | null
  /** Where the row goes. Always a route that exists. */
  to: string
}

export interface SetupChecklist {
  steps: SetupStep[]
  /** Steps confirmed done. */
  complete: number
  /** Steps whose answer is known — the denominator. */
  total: number
  /** Steps nobody could answer for this profile, shown as a caveat. */
  unknown: number
  percentage: number
  loading: boolean
  /** True when at least one source failed, so the card can offer a retry. */
  degraded: boolean
  reload: () => void
}

/**
 * Read the six things a new MSME has to set up, from whoever owns each one.
 *
 * Each source is asked only when this profile could possibly be allowed the
 * answer: a biller has no business triggering a profiles call that would come
 * back empty and be read as "nobody has access".
 */
export function useSetupChecklist(): SetupChecklist {
  const { scope, session, can } = useBilling()
  const settings: BillingSettings | null = session?.settings ?? null

  const mayReadAccounts = can('bank.view') || can('cash.view') || can('contra.create')
  const mayReadProfiles = can('access.manage')
  const mayReadReminders = can('recurring.manage')
  const usesBankCash = settings?.needs_bank_cash !== false

  const company = useApi<CompanyInfo>(
    (signal) => fetchCompanyInfo(scope!.cmp_id, signal),
    [scope?.cmp_id],
    Boolean(scope),
  )

  const accounts = useApi(
    (signal) => api.list<CashBankAccount>('v1/catalog/cash-bank', undefined, signal),
    [scope?.cmp_id],
    Boolean(scope) && mayReadAccounts && usesBankCash,
  )

  const profiles = useApi(
    (signal) =>
      api.one<{ profiles: BillingProfile[]; catalog: Record<string, Record<string, string>> }>(
        'v1/profiles',
        undefined,
        signal,
      ),
    [scope?.cmp_id],
    Boolean(scope) && mayReadProfiles,
  )

  const reminders = useApi(
    (signal) => api.get<{ data: ReminderRule[] }>('v1/reminders', undefined, signal),
    [scope?.cmp_id],
    Boolean(scope) && mayReadReminders,
  )

  const loading = company.loading || accounts.loading || profiles.loading || reminders.loading

  return useMemo(() => {
    const steps: SetupStep[] = []

    // 1 — the company itself. Manage owns it, so Manage is asked.
    const info = company.data
    const hasProfile = info !== null && info.name.trim() !== '' && info.addressLines.length > 0
    steps.push({
      key: 'company_profile',
      label: 'Complete your company profile',
      detail: company.error
        ? 'Aicountly Manage could not be reached, so this could not be checked.'
        : info === null
          ? 'Checking with Aicountly Manage…'
          : hasProfile
            ? `${info.name} — registered office on file.`
            : 'Your documents need a name and a registered office. Both live in Aicountly Manage.',
      complete: company.error ? null : info === null ? null : hasProfile,
      to: settingsPath('company'),
    })

    // 2 — GST. "Not registered" is a complete answer, not a missing one.
    const registered = settings?.gst_registered
    const gstin = info?.gstin?.trim() ?? ''
    steps.push({
      key: 'tax',
      label: 'Configure GST',
      detail:
        registered === false
          ? 'Marked not applicable — bills are raised without GST.'
          : gstin !== ''
            ? `GSTIN ${gstin}.`
            : company.error
              ? 'The GSTIN could not be read from Aicountly Manage.'
              : info === null
                ? 'Checking your GSTIN…'
                : 'Registered for GST, but no GSTIN is on the company in Aicountly Manage.',
      complete:
        registered === false ? true : company.error || info === null ? null : gstin !== '',
      to: settingsPath('taxes'),
    })

    // 3 — the words on the paper. Billing owns this one outright.
    const terms = (settings?.default_sale_terms ?? '').trim()
    steps.push({
      key: 'documents',
      label: 'Set the default terms on your bills',
      detail:
        settings === null
          ? 'Opening this company…'
          : terms !== ''
            ? 'Every new bill starts with your terms.'
            : 'New bills carry no terms or conditions yet.',
      complete: settings === null ? null : terms !== '',
      to: settingsPath('documents'),
    })

    // 4 — somewhere for the money to land. Books owns the accounts.
    if (usesBankCash) {
      const rows = accounts.data?.data ?? null
      steps.push({
        key: 'money',
        label: 'Connect a cash or bank account',
        detail: !mayReadAccounts
          ? 'Your Billing profile does not show balances, so this was not checked.'
          : accounts.error
            ? 'Smart Books could not be reached, so this could not be checked.'
            : rows === null
              ? 'Checking with Smart Books…'
              : rows.length > 0
                ? `${rows.length} cash or bank ${rows.length === 1 ? 'account' : 'accounts'} available.`
                : 'No cash or bank account exists in Smart Books yet.',
        complete: !mayReadAccounts || accounts.error ? null : rows === null ? null : rows.length > 0,
        to: settingsPath('payments'),
      })
    }

    // 5 — somebody who can run this. The owner always can.
    const profileRows = profiles.data?.data.profiles ?? null
    const assigned = (profileRows ?? []).some((profile) => Number(profile.member_count ?? 0) > 0)
    const isOwner = session?.is_owner === true
    steps.push({
      key: 'access',
      label: 'Decide who can do what',
      detail: isOwner && !assigned
        ? 'You are the owner of this company. Give your counter staff a Billing profile when you add them.'
        : assigned
          ? 'Your team has Billing profiles.'
          : !mayReadProfiles
            ? 'Managing Billing profiles is not part of your profile.'
            : profiles.error
              ? 'The profile list could not be read, so this could not be checked.'
              : profileRows === null
                ? 'Checking Billing profiles…'
                : 'Nobody has been given a Billing profile yet.',
      complete: isOwner || assigned
        ? true
        : !mayReadProfiles || profiles.error || profileRows === null
          ? null
          : false,
      to: settingsPath('users'),
    })

    // 6 — how overdue bills get chased.
    const rules = reminders.data?.data ?? null
    steps.push({
      key: 'reminders',
      label: 'Review your payment reminders',
      detail: !mayReadReminders
        ? 'Reminder rules are not part of your Billing profile.'
        : reminders.error
          ? 'The reminder rules could not be read, so this could not be checked.'
          : rules === null
            ? 'Checking your reminder rules…'
            : rules.length > 0
              ? `${rules.length} reminder ${rules.length === 1 ? 'rule' : 'rules'} set up.`
              : 'No rule decides when an overdue bill gets chased.',
      complete: !mayReadReminders || reminders.error ? null : rules === null ? null : rules.length > 0,
      to: settingsPath('automation'),
    })

    const known = steps.filter((step) => step.complete !== null)
    const complete = known.filter((step) => step.complete === true).length
    const total = known.length

    return {
      steps,
      complete,
      total,
      unknown: steps.length - total,
      // No known step means no honest bar: 0 of 0 is shown as nothing, not as
      // a full one. Guarding the division also keeps NaN out of a style width.
      percentage: total === 0 ? 0 : Math.round((complete / total) * 100),
      loading,
      degraded: Boolean(company.error || accounts.error || profiles.error || reminders.error),
      reload: () => {
        company.reload()
        accounts.reload()
        profiles.reload()
        reminders.reload()
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    company.data, company.error, company.loading,
    accounts.data, accounts.error, accounts.loading,
    profiles.data, profiles.error, profiles.loading,
    reminders.data, reminders.error, reminders.loading,
    settings, session?.is_owner, mayReadAccounts, mayReadProfiles, mayReadReminders, usesBankCash, loading,
  ])
}
