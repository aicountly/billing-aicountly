/**
 * Company, branch and financial year, as three controls in the header.
 *
 * THE LIST IS READ FROM MANAGE, LIVE. Manage owns companies, branches and
 * years; this product stores their three ids and nothing else. Showing someone
 * a list is a read, not a copy — and a list read on the request that draws it
 * cannot go stale the way a local `companies` table would the moment somebody
 * is granted access elsewhere.
 *
 * Manage also decides WHICH companies come back, because the call carries the
 * signed-in user's own session key. This product never filters that list and is
 * never the thing deciding what someone may open.
 *
 * Changing any of the three changes the scope for the whole application at
 * once: every screen keys its queries on it, and the in-flight requests for the
 * old scope are aborted rather than left to land on the new one.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Building2 } from 'lucide-react'
import { fetchAllCompanies, fetchCompanyInfo } from '../services/manage'
import type { CompanyInfo, CompanyOption } from '../services/manage'
import { useBilling } from '../context/BillingContext'

export function ScopeBar() {
  const { scope, setCompanyScope } = useBilling()

  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [info, setInfo] = useState<CompanyInfo | null>(null)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingInfo, setLoadingInfo] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const infoAbort = useRef<AbortController | null>(null)

  // ------------------------------------------------------------ the list

  useEffect(() => {
    const controller = new AbortController()
    setLoadingList(true)

    fetchAllCompanies(controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return
        setCompanies(rows)
        setError(null)
        // One company and nothing chosen yet: choose it. Making somebody pick
        // from a list of one is a click that teaches them nothing.
        if (rows.length === 1 && !scope) void openCompany(rows[0].cmpId)
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return
        setError(e instanceof Error ? e.message : 'Could not load your companies.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingList(false)
      })

    return () => controller.abort()
    // Runs once: the list belongs to the sign-in, not to the chosen company.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --------------------------------------------------- one company's detail

  const loadInfo = useCallback(async (cmpId: number): Promise<CompanyInfo | null> => {
    infoAbort.current?.abort()
    const controller = new AbortController()
    infoAbort.current = controller

    setLoadingInfo(true)
    try {
      const next = await fetchCompanyInfo(cmpId, controller.signal)
      if (controller.signal.aborted) return null
      setInfo(next)
      setError(null)
      return next
    } catch (e) {
      if (controller.signal.aborted) return null
      setError(e instanceof Error ? e.message : "Could not load that company's years and branches.")
      setInfo(null)
      return null
    } finally {
      if (!controller.signal.aborted) setLoadingInfo(false)
    }
  }, [])

  useEffect(() => {
    if (scope) void loadInfo(scope.cmp_id)
    return () => infoAbort.current?.abort()
  }, [scope?.cmp_id, loadInfo])

  /**
   * Switching company needs its years first: a scope carrying the previous
   * company's fy_id would ask Books for a year that company does not have.
   */
  async function openCompany(cmpId: number) {
    const next = await loadInfo(cmpId)
    if (!next) return
    const fyId = next.fyList[0]?.fyId
    if (fyId === undefined) {
      setError('That company has no financial year set up yet. Add one in Aicountly Manage.')
      return
    }
    setCompanyScope({ cmp_id: cmpId, fy_id: fyId, bo_id: 0 })
  }

  const currentCompany = companies.find((c) => c.cmpId === scope?.cmp_id)

  return (
    <div className="billing-contextbar__scope">
      <Building2 size={16} aria-hidden style={{ color: 'var(--billing-muted)', flexShrink: 0 }} />

      <label className="billing-sr-only" htmlFor="scope-company">Company</label>
      <select
        id="scope-company"
        className="billing-scope-select"
        value={scope?.cmp_id ?? ''}
        disabled={loadingList}
        onChange={(e) => {
          const value = Number(e.target.value)
          if (value) void openCompany(value)
        }}
      >
        <option value="">{loadingList ? 'Loading companies…' : 'Choose a company'}</option>
        {companies.map((company) => (
          <option key={company.cmpId} value={company.cmpId}>
            {company.name}
            {company.ownership === 'shared' ? ' (shared)' : ''}
          </option>
        ))}
        {/* The chosen company may sit beyond the pages fetched so far; without
            this the select would silently show "Choose a company" over a
            perfectly valid scope. */}
        {scope && !currentCompany && <option value={scope.cmp_id}>Company {scope.cmp_id}</option>}
      </select>

      <label className="billing-sr-only" htmlFor="scope-branch">Branch</label>
      <select
        id="scope-branch"
        className="billing-scope-select"
        value={scope?.bo_id ?? 0}
        disabled={!scope || loadingInfo}
        onChange={(e) => scope && setCompanyScope({ ...scope, bo_id: Number(e.target.value) || 0 })}
      >
        <option value={0}>All branches</option>
        {(info?.branches ?? []).map((branch) => (
          <option key={branch.boId} value={branch.boId}>
            {branch.name}
            {branch.isHeadOffice ? ' (head office)' : ''}
          </option>
        ))}
      </select>

      <label className="billing-sr-only" htmlFor="scope-fy">Financial year</label>
      <select
        id="scope-fy"
        className="billing-scope-select"
        value={scope?.fy_id ?? ''}
        disabled={!scope || loadingInfo}
        onChange={(e) => scope && setCompanyScope({ ...scope, fy_id: Number(e.target.value) })}
      >
        {(info?.fyList ?? []).map((fy) => (
          <option key={fy.fyId} value={fy.fyId}>
            {fy.label}
          </option>
        ))}
        {scope && (info?.fyList ?? []).every((fy) => fy.fyId !== scope.fy_id) && (
          <option value={scope.fy_id}>Year {scope.fy_id}</option>
        )}
      </select>

      {error && (
        <span role="status" style={{ color: 'var(--billing-danger)', fontSize: 12, maxWidth: '22rem' }}>
          {error}
        </span>
      )}
    </div>
  )
}
