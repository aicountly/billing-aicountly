/**
 * One authoritative copy of the purchase being entered, and everything that
 * reads or changes it.
 *
 * Validation is computed from the form on every render but only SHOWN once the
 * user has tried to save. Red borders on a form somebody has not finished
 * filling in are noise; red borders the moment they press Save, on the exact
 * fields holding it up, are help.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CatalogItem } from '../../services/types'
import {
  dueDateFor,
  emptyForm,
  emptyLine,
  isLineStarted,
  termsForDueDate,
  type PurchaseForm,
  type PurchaseLine,
  type PurchaseSupplier,
} from './model'

export interface LineErrors {
  item?: string
  qty?: string
  rate?: string
  tax?: string
}

export interface PurchaseErrors {
  supplier?: string
  purchaseDate?: string
  warehouse?: string
  settleAccount?: string
  lines: Record<string, LineErrors>
  /** A whole-section problem: no lines at all. */
  items?: string
}

export interface FinancialYear {
  start: string
  end: string
  label: string
}

export interface UsePurchaseFormOptions {
  today: string
  /** The year the scope is set to. Dates outside it are refused before saving. */
  financialYear: FinancialYear | null
  /** True when the company is GST-registered and a rate has to be chosen per line. */
  requireTaxCategory: boolean
  /** False when Books' tax master gave no usable rates — do not demand the impossible. */
  taxCategoriesUsable: boolean
}

export interface PurchaseFormApi {
  form: PurchaseForm
  dirty: boolean
  errors: PurchaseErrors
  showErrors: boolean
  hasErrors: boolean
  /** Lines the user has actually started. What gets validated and sent. */
  startedLines: PurchaseLine[]

  patch: (partial: Partial<PurchaseForm>) => void
  /** Fill in a default without counting it as the user's own edit. */
  applyDefault: (partial: Partial<PurchaseForm>) => void
  patchLine: (key: string, partial: Partial<PurchaseLine>) => void
  applyItem: (item: CatalogItem, key?: string) => void
  addLine: () => string
  removeLine: (key: string) => void
  setSupplier: (supplier: PurchaseSupplier | null) => void
  setPurchaseDate: (date: string) => void
  setPaymentTerms: (terms: string) => void
  setDueDate: (date: string) => void

  /** True when the form is good enough to send. Turns the red borders on. */
  attemptSave: () => boolean
  reset: () => void
  markClean: () => void
}

export function usePurchaseForm(options: UsePurchaseFormOptions): PurchaseFormApi {
  const { today, financialYear, requireTaxCategory, taxCategoriesUsable } = options

  const [form, setForm] = useState<PurchaseForm>(() => emptyForm(today))
  const [dirty, setDirty] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  // The date defaults to today, and "today" only becomes known once the
  // company's timezone has loaded. Moving it under the user afterwards would
  // be worse than being a few hundred milliseconds late, so it is only applied
  // while the field is still untouched.
  const appliedToday = useRef(today)
  useEffect(() => {
    if (appliedToday.current === today) return
    const previous = appliedToday.current
    appliedToday.current = today
    setForm((current) => (current.purchaseDate === previous ? { ...current, purchaseDate: today } : current))
  }, [today])

  const patch = useCallback((partial: Partial<PurchaseForm>) => {
    setDirty(true)
    setForm((current) => ({ ...current, ...partial }))
  }, [])

  /**
   * A default the screen filled in, not a change the user made.
   *
   * It must not arm the discard warning: being asked "discard this purchase?"
   * after opening a screen and touching nothing is how people learn to ignore
   * that dialog.
   */
  const applyDefault = useCallback((partial: Partial<PurchaseForm>) => {
    setForm((current) => ({ ...current, ...partial }))
  }, [])

  const patchLine = useCallback((key: string, partial: Partial<PurchaseLine>) => {
    setDirty(true)
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.key === key ? { ...line, ...partial } : line)),
    }))
  }, [])

  const setSupplier = useCallback((supplier: PurchaseSupplier | null) => {
    setDirty(true)
    setForm((current) => ({ ...current, supplier }))
  }, [])

  /** Changing the date moves the due date with the terms that produced it. */
  const setPurchaseDate = useCallback((date: string) => {
    setDirty(true)
    setForm((current) => {
      const derived = dueDateFor(current.paymentTerms, date)
      return {
        ...current,
        purchaseDate: date,
        dueDate: current.paymentTerms === 'Custom' ? current.dueDate : derived,
      }
    })
  }, [])

  const setPaymentTerms = useCallback((terms: string) => {
    setDirty(true)
    setForm((current) => ({
      ...current,
      paymentTerms: terms,
      dueDate: terms === 'Custom' ? current.dueDate : dueDateFor(terms, current.purchaseDate),
    }))
  }, [])

  /** Typing a date the terms do not imply makes the terms Custom, not a lie. */
  const setDueDate = useCallback((date: string) => {
    setDirty(true)
    setForm((current) => ({
      ...current,
      dueDate: date,
      paymentTerms: termsForDueDate(date, current.purchaseDate),
    }))
  }, [])

  /**
   * An item chosen from Inventory, dropped into a line.
   *
   * The name, unit, HSN and rate all come from Inventory on the request that
   * found it; none of them is kept anywhere but in this form. Choosing an item
   * does NOT mark the rate as changed — only a human typing over it does, which
   * is what the backend's rate.override check is actually about.
   */
  const applyItem = useCallback((item: CatalogItem, key?: string) => {
    setDirty(true)
    setForm((current) => {
      const target = key ?? current.lines.find((line) => line.itemId === null)?.key
      const patchedLine: Partial<PurchaseLine> = {
        itemId: item.item_id,
        label: item.item_name,
        sku: item.item_sku ?? null,
        hsnSac: item.hsn_sac ?? null,
        unitId: item.unit_id,
        description: '',
        // The rate on a PURCHASE is what the supplier is charging, which the
        // item master cannot know. Inventory's figure is offered as a starting
        // point only when the line is still empty.
        rate: item.mrp ?? '',
        rateWasChanged: false,
      }

      const lines = target
        ? current.lines.map((line) => (line.key === target ? { ...line, ...patchedLine } : line))
        : [...current.lines, { ...emptyLine(), ...patchedLine }]

      // Always leave one blank line ready, so the next item needs no extra tap.
      return {
        ...current,
        lines: lines.some((line) => !isLineStarted(line)) ? lines : [...lines, emptyLine()],
      }
    })
  }, [])

  const addLine = useCallback(() => {
    const line = emptyLine()
    setDirty(true)
    setForm((current) => ({ ...current, lines: [...current.lines, line] }))
    return line.key
  }, [])

  const removeLine = useCallback((key: string) => {
    setDirty(true)
    setForm((current) => {
      const remaining = current.lines.filter((line) => line.key !== key)
      return { ...current, lines: remaining.length > 0 ? remaining : [emptyLine()] }
    })
  }, [])

  const reset = useCallback(() => {
    setForm(emptyForm(appliedToday.current))
    setShowErrors(false)
    setDirty(false)
  }, [])

  const markClean = useCallback(() => setDirty(false), [])

  // ------------------------------------------------------------- validation

  const startedLines = useMemo(() => form.lines.filter(isLineStarted), [form.lines])

  const errors = useMemo<PurchaseErrors>(() => {
    const result: PurchaseErrors = { lines: {} }

    if (!form.supplier) result.supplier = 'Select a supplier.'

    if (!form.purchaseDate) {
      result.purchaseDate = 'Purchase date is required.'
    } else if (financialYear && financialYear.start && financialYear.end) {
      if (form.purchaseDate < financialYear.start || form.purchaseDate > financialYear.end) {
        result.purchaseDate = `That date is outside ${financialYear.label}. Switch the year at the top, or change the date.`
      }
    }

    if (form.purchaseType === 'goods' && form.warehouseId === '') {
      result.warehouse = 'Choose where the goods are being received.'
    }

    if (form.paidNow && form.settleAccountId === '') {
      result.settleAccount = 'Say which cash or bank account paid for this.'
    }

    if (startedLines.length === 0) {
      result.items = 'Add at least one item.'
    }

    for (const line of startedLines) {
      const lineErrors: LineErrors = {}

      if (form.purchaseType === 'goods' && line.itemId === null) {
        lineErrors.item = 'Choose an item.'
      }
      if (form.purchaseType === 'services' && line.itemId === null && line.description.trim() === '') {
        lineErrors.item = 'Describe what was bought.'
      }
      if (!(Number(line.qty) > 0)) {
        lineErrors.qty = 'Quantity must be greater than 0.'
      }
      if (line.rate.trim() === '' || !Number.isFinite(Number(line.rate)) || Number(line.rate) < 0) {
        lineErrors.rate = 'Enter a valid rate.'
      }
      if (requireTaxCategory && taxCategoriesUsable && line.taxCatId === '') {
        lineErrors.tax = 'Select a GST rate.'
      }

      if (Object.keys(lineErrors).length > 0) result.lines[line.key] = lineErrors
    }

    return result
  }, [form, startedLines, financialYear, requireTaxCategory, taxCategoriesUsable])

  const hasErrors =
    Boolean(errors.supplier || errors.purchaseDate || errors.warehouse || errors.settleAccount || errors.items) ||
    Object.keys(errors.lines).length > 0

  const attemptSave = useCallback(() => {
    setShowErrors(true)
    return !hasErrors
  }, [hasErrors])

  // Nothing else can stop a browser back or a tab close, so this is the one
  // guard that has to be here. In-app navigation is handled by the page.
  useEffect(() => {
    if (!dirty) return undefined

    function warn(event: BeforeUnloadEvent) {
      event.preventDefault()
      // Chrome shows its own wording; the assignment is what arms the prompt.
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // Memoised because the page lists this object in effect dependencies: a fresh
  // literal every render would tear down and re-register the keyboard shortcuts
  // on every keystroke.
  return useMemo(
    () => ({
      form,
      dirty,
      errors,
      showErrors,
      hasErrors,
      startedLines,
      patch,
      applyDefault,
      patchLine,
      applyItem,
      addLine,
      removeLine,
      setSupplier,
      setPurchaseDate,
      setPaymentTerms,
      setDueDate,
      attemptSave,
      reset,
      markClean,
    }),
    [
      form,
      dirty,
      errors,
      showErrors,
      hasErrors,
      startedLines,
      patch,
      applyDefault,
      patchLine,
      applyItem,
      addLine,
      removeLine,
      setSupplier,
      setPurchaseDate,
      setPaymentTerms,
      setDueDate,
      attemptSave,
      reset,
      markClean,
    ],
  )
}
