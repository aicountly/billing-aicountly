/**
 * Who the bill is for, and the facts about the document itself.
 *
 * NOTHING ON THIS CARD IS A LOCAL RECORD. The customer is a ledger account in
 * Smart Books, searched as you type; the outstanding figure beside them is read
 * from Books on this request; the bill number is Books' to assign when it
 * posts. Billing keeps the account id and nothing else.
 *
 * The GST treatment is a READOUT, not a choice. A customer with a GSTIN is
 * registered and one without is not — that is the fact, not an opinion, and
 * offering it as a control would invite somebody to overrule a thing they
 * cannot overrule. What IS a choice is the place of supply, because it is a
 * fact about the supply rather than about the customer, and it is what decides
 * CGST + SGST against IGST. Books still decides the tax.
 */

import { useCallback, useState, type RefObject } from 'react'
import { ExternalLink, History, Info, MapPin, Receipt, Store, UserRound } from 'lucide-react'
import { api } from '../../services/api'
import type { CatalogParty } from '../../services/types'
import { money } from '../../ui'
import { Field, Segmented } from './SaleFields'
import { Combo } from '../../components/Combo'
import {
  GST_STATES,
  OVERSEAS_CODE,
  gstTreatment,
  isValidGstin,
  stateName,
  supplyKind,
  type GstTreatment,
  type SaleDraft,
  type SaleErrors,
  type SupplyKind,
} from './saleForm'

/** What Books says this customer still owes, read live and handed in. */
export interface CustomerStanding {
  loading: boolean
  failed: boolean
  outstanding: number | null
  billCount: number
  oldestDue: string | null
}

const TREATMENTS: ReadonlyArray<{ value: GstTreatment; label: string; title: string }> = [
  { value: 'taxable', label: 'Taxable', title: 'This customer has a GSTIN in Smart Books.' },
  { value: 'unregistered', label: 'Unregistered', title: 'Smart Books holds no GSTIN for this customer.' },
  { value: 'overseas', label: 'Overseas', title: 'The place of supply is outside India.' },
]

const SUPPLY_WORDS: Record<SupplyKind, string> = {
  intra: 'Within the state — Smart Books applies CGST and SGST.',
  inter: 'Another state — Smart Books applies IGST.',
  overseas: 'Outside India. Smart Books decides how an export is taxed.',
  unknown: '',
}

export function CustomerBillCard({
  draft,
  onChange,
  errors,
  showErrors,
  recentCustomers,
  standing,
  companyStateCode,
  companyGstin,
  gstRegistered,
  customerRef,
  billDateRef,
  onOpenBooks,
}: {
  draft: SaleDraft
  onChange: (patch: Partial<SaleDraft>) => void
  errors: SaleErrors
  showErrors: boolean
  recentCustomers: CatalogParty[]
  standing: CustomerStanding | null
  companyStateCode: string
  companyGstin: string
  gstRegistered: boolean
  customerRef: RefObject<HTMLInputElement | null>
  billDateRef: RefObject<HTMLInputElement | null>
  onOpenBooks: () => void
}) {
  const shown = (field: keyof SaleErrors) => (showErrors ? (errors[field] as string | undefined) : undefined)
  const [counter, setCounter] = useState<{ busy: boolean; failed: boolean; rows: CatalogParty[] } | null>(null)

  const treatment = gstTreatment(draft.party, draft.placeOfSupply)
  const supply = supplyKind(companyStateCode, draft.placeOfSupply)

  const searchParties = useCallback(async (term: string, signal: AbortSignal) => {
    const response = await api.list<CatalogParty>('v1/catalog/parties', { q: term, side: 'customer', limit: 20 }, signal)
    return response.data
  }, [])

  /**
   * The counter-sales ledger.
   *
   * Billing cannot invent a walk-in customer: a bill needs an account and the
   * accounts are Books'. So this SEARCHES Books for the ledger most shops keep
   * for over-the-counter sales and offers what it finds — and says so plainly
   * when there is nothing, rather than making one up.
   */
  async function findCounterLedger() {
    setCounter({ busy: true, failed: false, rows: [] })
    try {
      const responses = await Promise.all(
        ['cash', 'counter', 'walk'].map((term) =>
          api.list<CatalogParty>('v1/catalog/parties', { q: term, side: 'customer', limit: 10 }),
        ),
      )
      const seen = new Set<number>()
      const rows: CatalogParty[] = []
      for (const response of responses) {
        for (const row of response.data) {
          if (seen.has(row.acc_id)) continue
          seen.add(row.acc_id)
          rows.push(row)
        }
      }
      setCounter({ busy: false, failed: false, rows: rows.slice(0, 6) })
    } catch {
      setCounter({ busy: false, failed: true, rows: [] })
    }
  }

  /**
   * The page owns what a new customer implies — it is the only place that knows
   * whether the place of supply has been set by hand since. This hands it the
   * customer and nothing else.
   */
  function pickCustomer(party: CatalogParty) {
    onChange({ party })
    setCounter(null)
  }

  return (
    <section className="billing-sale-card" aria-labelledby="sale-party-heading">
      <div className="billing-sale-party">
        <div className="billing-sale-party__left">
          <div className="billing-sale__section-head">
            <span className="billing-sale__section-icon" aria-hidden>
              <UserRound size={16} />
            </span>
            <h2 id="sale-party-heading">Customer (Party)</h2>
          </div>

          <Combo<CatalogParty>
            label="Search or select a customer"
            placeholder={draft.party ? draft.party.acc_name : 'Search or select a customer…'}
            selected={draft.party?.acc_name ?? null}
            onClear={() => onChange({ party: null })}
            invalid={Boolean(shown('party'))}
            inputRef={customerRef}
            describedBy="sale-party-help"
            search={searchParties}
            idleOptions={draft.party ? [] : recentCustomers}
            idleHeading={recentCustomers.length > 0 ? 'Billed recently on this device' : undefined}
            keyOf={(party) => party.acc_id}
            onPick={pickCustomer}
            renderOption={(party) => ({
              name: party.acc_name,
              meta: [
                party.gstin ? `GSTIN ${party.gstin}` : 'No GSTIN on record',
                party.gstin && stateName(party.gstin.slice(0, 2)) ? stateName(party.gstin.slice(0, 2)) : null,
              ].filter(Boolean) as string[],
            })}
            emptyAction={
              <button type="button" className="billing-sale-combo__retry" onClick={onOpenBooks}>
                Add in Smart Books
              </button>
            }
          />

          {shown('party') && (
            <span className="billing-sale__error" role="alert">
              <Info size={12} aria-hidden /> {errors.party}
            </span>
          )}

          <div className="billing-sale__chips">
            <button
              type="button"
              className="billing-sale__chip"
              onClick={() => {
                setCounter(null)
                customerRef.current?.focus()
              }}
            >
              <History size={14} aria-hidden /> Recent customers
            </button>
            <button type="button" className="billing-sale__chip" onClick={findCounterLedger}>
              <Store size={14} aria-hidden /> Walk-in customer
            </button>
            <button type="button" className="billing-sale__chip billing-sale__chip--primary" onClick={onOpenBooks}>
              <ExternalLink size={14} aria-hidden /> Add customer
            </button>
          </div>

          <p className="billing-sale__hint" id="sale-party-help">
            Customers are ledger accounts in Smart Books. Billing keeps no copy, so a new one is added there and appears
            here straight away.
          </p>

          {counter && (
            <div className="billing-sale-party__picked" role="status">
              {counter.busy && <p style={{ margin: 0, fontSize: 12 }}>Looking for a counter-sales ledger…</p>}
              {counter.failed && (
                <p style={{ margin: 0, fontSize: 12 }}>
                  Could not reach Smart Books for the ledger list. Try the search box above.
                </p>
              )}
              {!counter.busy && !counter.failed && counter.rows.length === 0 && (
                <p style={{ margin: 0, fontSize: 12 }}>
                  No cash or counter-sales ledger found in Smart Books. Add one there, or search for the customer by
                  name.
                </p>
              )}
              {counter.rows.length > 0 && (
                <>
                  <p style={{ margin: '0 0 8px', fontSize: 12 }}>Counter-sales ledgers in Smart Books:</p>
                  <div className="billing-sale__chips" style={{ marginTop: 0 }}>
                    {counter.rows.map((row) => (
                      <button
                        key={row.acc_id}
                        type="button"
                        className="billing-sale__chip"
                        onClick={() => pickCustomer(row)}
                      >
                        {row.acc_name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {draft.party && <PickedCustomer party={draft.party} standing={standing} />}
        </div>

        <div className="billing-sale-party__right">
          <div className="billing-sale__meta">
            <Field label="Bill date" htmlFor="sale-bill-date" error={shown('billDate')}>
              <input
                id="sale-bill-date"
                ref={billDateRef}
                type="date"
                className={`billing-sale__control${shown('billDate') ? ' billing-sale__control--invalid' : ''}`}
                value={draft.billDate}
                required
                onChange={(event) => onChange({ billDate: event.target.value })}
              />
            </Field>

            <Field
              label="Bill no."
              note="auto"
              htmlFor="sale-bill-no"
              hint="Smart Books numbers the invoice when it posts, in this company's own series."
            >
              <input
                id="sale-bill-no"
                type="text"
                className="billing-sale__control"
                value="Auto"
                readOnly
                disabled
              />
            </Field>

            <Field
              label="Place of supply"
              htmlFor="sale-place-of-supply"
              error={shown('placeOfSupply')}
              hint={
                draft.placeOfSupply && SUPPLY_WORDS[supply]
                  ? SUPPLY_WORDS[supply]
                  : companyStateCode
                    ? `This company is registered in ${stateName(companyStateCode)}.`
                    : 'Add this company’s GSTIN in Manage and the state is filled in from it.'
              }
            >
              <select
                id="sale-place-of-supply"
                className={`billing-sale__control${shown('placeOfSupply') ? ' billing-sale__control--invalid' : ''}`}
                value={draft.placeOfSupply}
                onChange={(event) => onChange({ placeOfSupply: event.target.value })}
              >
                <option value="">Choose a state…</option>
                {GST_STATES.map((state) => (
                  <option key={state.code} value={state.code}>
                    {state.code} · {state.name}
                  </option>
                ))}
                <option value={OVERSEAS_CODE}>Outside India (export)</option>
              </select>
            </Field>

            <Field
              label="Due date"
              note="optional"
              htmlFor="sale-due-date"
              error={shown('dueDate')}
              hint={draft.dueDate ? undefined : 'Leave it empty and Smart Books applies this company’s terms.'}
            >
              <input
                id="sale-due-date"
                type="date"
                className={`billing-sale__control${shown('dueDate') ? ' billing-sale__control--invalid' : ''}`}
                value={draft.dueDate}
                min={draft.billDate}
                onChange={(event) => onChange({ dueDate: event.target.value })}
              />
            </Field>

            {/* Two fields this deployment cannot fill. They are shown rather than
                hidden so it is clear the bill is not quietly carrying one — and
                disabled rather than faked, because a select with nothing real
                behind it is worse than an empty one. */}
            <Field
              label="Sales person"
              htmlFor="sale-person"
              hint="No salesperson list is served to Billing yet, so a bill carries none."
            >
              <select id="sale-person" className="billing-sale__control" disabled>
                <option>Not available here</option>
              </select>
            </Field>

            <Field
              label="Price list"
              htmlFor="sale-price-list"
              hint="Rates come from the item in Inventory. Billing has no price-list API to choose from."
            >
              <select id="sale-price-list" className="billing-sale__control" disabled>
                <option>Item rate from Inventory</option>
              </select>
            </Field>

            <div className="billing-sale__field billing-sale__field--full">
              <span className="billing-sale__label">
                GST treatment
                <span className="billing-sale__label-note">from the customer and the place of supply</span>
              </span>
              <Segmented<GstTreatment>
                label="GST treatment"
                options={TREATMENTS}
                value={treatment === 'unknown' ? null : treatment}
                readOnly
              />
              <span className="billing-sale__hint">{treatmentEvidence(draft, treatment, companyGstin, gstRegistered)}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function treatmentEvidence(
  draft: SaleDraft,
  treatment: GstTreatment,
  companyGstin: string,
  gstRegistered: boolean,
): string {
  if (!gstRegistered) {
    return 'This company is recorded as not GST registered, so Smart Books raises the bill without GST.'
  }
  if (!draft.party) return 'Choose a customer and their GST standing is read from Smart Books.'

  const gstin = (draft.party.gstin ?? '').trim()

  if (treatment === 'overseas') {
    return 'The place of supply is outside India, so this is an export. Smart Books decides how it is taxed.'
  }
  if (treatment === 'taxable') {
    const suspect = !isValidGstin(gstin)
    return suspect
      ? `Smart Books holds ${gstin} for this customer, which is not the shape of a GSTIN — worth checking there.`
      : `${draft.party.acc_name} is registered as ${gstin}.${companyGstin ? '' : ' This company has no GSTIN in Manage.'}`
  }

  return `Smart Books holds no GSTIN for ${draft.party.acc_name}, so this is a sale to an unregistered customer.`
}

/**
 * The chosen customer, with what Books says they still owe.
 *
 * Shown only once somebody is chosen: the screen opens on the one thing that
 * has to be done first, and a panel of facts about nobody is noise. The balance
 * is Books', read on this request — when it cannot be read the row says so
 * rather than showing a nought, because a nought and an outage look identical.
 */
function PickedCustomer({ party, standing }: { party: CatalogParty; standing: CustomerStanding | null }) {
  const stateCode = (party.gstin ?? '').trim().slice(0, 2)

  return (
    <div className="billing-sale-party__picked">
      <div className="billing-sale-party__picked-top">
        <p className="billing-sale-party__picked-name">{party.acc_name}</p>
        <Receipt size={16} aria-hidden style={{ color: 'var(--billing-action)', flexShrink: 0 }} />
      </div>

      <div className="billing-sale-party__facts">
        <span>
          GSTIN <strong>{party.gstin?.trim() || 'not on record'}</strong>
        </span>
        {stateName(stateCode) && (
          <span>
            <MapPin size={11} aria-hidden /> <strong>{stateName(stateCode)}</strong>
          </span>
        )}
      </div>

      {standing && (
        <div className="billing-sale-party__outstanding">
          <span>Outstanding in Smart Books</span>
          {standing.loading && <span>Reading…</span>}
          {!standing.loading && standing.failed && <span>Could not read it just now</span>}
          {!standing.loading && !standing.failed && standing.outstanding !== null && (
            <strong className="num" style={{ color: 'var(--billing-text)' }}>
              {money(standing.outstanding)}
              {standing.billCount > 0 && (
                <span style={{ color: 'var(--billing-muted)', fontWeight: 600 }}>
                  {' '}
                  · {standing.billCount} open {standing.billCount === 1 ? 'bill' : 'bills'}
                </span>
              )}
            </strong>
          )}
        </div>
      )}
    </div>
  )
}
