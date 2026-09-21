/**
 * The purchase helper.
 *
 * NOTHING HERE CALLS AN AI SERVICE, because this deployment has none. Every
 * line below is worked out in the browser from the form on screen and from
 * readings this page has already made — Books' payables, Books' tax master, the
 * two GSTINs, Inventory's warehouses, the financial year from Manage. That is
 * said plainly at the top of the panel rather than implied, so nobody mistakes
 * a checklist for a judgement.
 *
 * It is useful precisely because it is deterministic: the same bill produces
 * the same list every time, and every item names the thing to go and fix.
 */

import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import type { CatalogItem } from '../../services/types'
import { Drawer } from '../../shell/Drawer'
import { money } from '../../ui'
import type { GstMode } from './gst'
import { isLineStarted, type PurchaseForm, type PurchaseTotals } from './model'
import type { FinancialYear } from './usePurchaseForm'
import type { SupplierInsight } from './useSupplierInsight'

type Tone = 'ok' | 'warn' | 'info'

interface Check {
  key: string
  tone: Tone
  title: string
  detail: string
}

function mark(tone: Tone) {
  if (tone === 'ok') return <CheckCircle2 size={15} aria-hidden className="purchase-drawer__mark purchase-drawer__mark--ok" />
  if (tone === 'warn') return <AlertTriangle size={15} aria-hidden className="purchase-drawer__mark purchase-drawer__mark--warn" />
  return <Info size={15} aria-hidden className="purchase-drawer__mark purchase-drawer__mark--info" />
}

function buildChecks(input: {
  form: PurchaseForm
  totals: PurchaseTotals
  gstMode: GstMode
  insight: SupplierInsight
  financialYear: FinancialYear | null
  warehouseName: string | null
}): Check[] {
  const { form, totals, gstMode, insight, financialYear, warehouseName } = input
  const checks: Check[] = []

  checks.push(
    form.supplier
      ? { key: 'supplier', tone: 'ok', title: form.supplier.name, detail: 'Supplier chosen.' }
      : { key: 'supplier', tone: 'warn', title: 'No supplier yet', detail: 'Pick the supplier this bill came from.' },
  )

  checks.push({
    key: 'gst',
    tone: gstMode.treatment === 'unknown' ? 'info' : 'ok',
    title: gstMode.label,
    detail: gstMode.reason,
  })

  if (financialYear && form.purchaseDate) {
    const inYear = form.purchaseDate >= financialYear.start && form.purchaseDate <= financialYear.end
    checks.push({
      key: 'fy',
      tone: inYear ? 'ok' : 'warn',
      title: inYear ? `Inside ${financialYear.label}` : `Outside ${financialYear.label}`,
      detail: inYear
        ? 'The purchase date is inside the year you have open.'
        : 'Change the date, or switch the financial year at the top of the page.',
    })
  }

  const started = form.lines.filter(isLineStarted)
  const missingRate = started.filter((line) => line.taxCatId === '').length
  if (started.length === 0) {
    checks.push({ key: 'lines', tone: 'warn', title: 'No lines yet', detail: 'Add what was bought.' })
  } else if (missingRate > 0 && gstMode.treatment !== 'no_gst') {
    checks.push({
      key: 'rates',
      tone: 'warn',
      title: `${missingRate} line${missingRate === 1 ? '' : 's'} without a GST rate`,
      detail: 'Until each line has one, the tax above is not previewed.',
    })
  } else {
    checks.push({
      key: 'rates',
      tone: 'ok',
      title: `${started.length} line${started.length === 1 ? '' : 's'}, ${money(totals.taxable)} taxable`,
      detail: 'Every line has a rate on it.',
    })
  }

  if (form.purchaseType === 'goods') {
    checks.push(
      warehouseName
        ? { key: 'warehouse', tone: 'ok', title: warehouseName, detail: 'Goods will be received here.' }
        : {
            key: 'warehouse',
            tone: 'warn',
            title: 'No warehouse chosen',
            detail: 'A goods purchase needs somewhere for the stock to land.',
          },
    )
  } else {
    checks.push({
      key: 'warehouse',
      tone: 'info',
      title: 'Services purchase',
      detail: 'Lines carry no item, so nothing moves in Inventory.',
    })
  }

  if (form.supplier && insight.outstanding !== null && insight.outstanding > 0) {
    checks.push({
      key: 'outstanding',
      tone: insight.overdue !== null && insight.overdue > 0 ? 'warn' : 'info',
      title: `${money(insight.outstanding)} already owed`,
      detail:
        insight.overdue !== null && insight.overdue > 0
          ? `${money(insight.overdue)} of it is overdue. Read from Smart Books just now.`
          : 'Nothing overdue. Read from Smart Books just now.',
    })
  }

  if (form.paidNow && form.settleAccountId === '') {
    checks.push({
      key: 'paid',
      tone: 'warn',
      title: 'Paid, but not from where',
      detail: 'Name the cash or bank account the money left.',
    })
  }

  if (form.supplierInvoiceNo.trim() === '') {
    checks.push({
      key: 'invoice',
      tone: 'info',
      title: 'No supplier invoice number',
      detail: 'Worth adding — it is what this bill is matched against later.',
    })
  }

  return checks
}

export function PurchaseHelperDrawer({
  open,
  onClose,
  form,
  totals,
  gstMode,
  insight,
  financialYear,
  warehouseName,
  favourites,
  onAddItem,
}: {
  open: boolean
  onClose: () => void
  form: PurchaseForm
  totals: PurchaseTotals
  gstMode: GstMode
  insight: SupplierInsight
  financialYear: FinancialYear | null
  warehouseName: string | null
  favourites: CatalogItem[]
  onAddItem: (item: CatalogItem) => void
}) {
  const checks = buildChecks({ form, totals, gstMode, insight, financialYear, warehouseName })

  return (
    <Drawer open={open} onClose={onClose} title="Purchase helper" side="right">
      <p className="purchase-drawer__note">
        These checks run here, on this page, from what you have typed and what has already been read from Smart
        Books, Inventory and Manage. Nothing is sent anywhere to produce them.
      </p>

      <div className="purchase-drawer__section">
        <h3>This bill</h3>
        {checks.map((check) => (
          <div key={check.key} className="purchase-drawer__item">
            {mark(check.tone)}
            <div>
              <strong>{check.title}</strong>
              <span>{check.detail}</span>
            </div>
          </div>
        ))}
      </div>

      {favourites.length > 0 && (
        <div className="purchase-drawer__section">
          <h3>Items you use most</h3>
          <p className="purchase-drawer__note">
            Billing remembers which item ids you put on documents. The names and rates come from Inventory each
            time.
          </p>
          <div className="purchase-drawer__picks">
            {favourites.slice(0, 10).map((item) => (
              <button
                key={item.item_id}
                type="button"
                className="purchase-drawer__pick"
                onClick={() => onAddItem(item)}
              >
                <span>{item.item_name}</span>
                <small>{item.item_sku ?? 'Add'}</small>
              </button>
            ))}
          </div>
        </div>
      )}
    </Drawer>
  )
}
