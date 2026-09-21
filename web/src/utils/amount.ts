/**
 * Reading and writing an amount somebody is TYPING.
 *
 * Distinct from `money()` in the ui kit, which formats a figure for display
 * with its currency symbol. These two are the pair a text input needs: what the
 * characters in the box mean, and what to put back in the box once they have
 * finished typing.
 *
 * They live here rather than in either screen because the expense form and the
 * bank withdrawal form both take an amount, and two copies of "what counts as a
 * number" is how two screens end up disagreeing about whether `1,23,456` is one.
 */

/**
 * The amount as a number, or null when it is not one.
 *
 * Grouping separators are stripped rather than rejected: the field shows
 * 1,23,456.78 after it loses focus, and a person who clicks back into it and
 * presses Save should not be told that what we wrote there is invalid.
 */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[\s,]/g, '')
  if (cleaned === '') return null

  const value = Number(cleaned)

  return Number.isFinite(value) ? value : null
}

/** Indian digit grouping — the same grouping money() prints. */
export function groupAmount(value: number): string {
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}
