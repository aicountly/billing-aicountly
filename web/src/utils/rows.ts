/**
 * Reading a value out of a row whose key spelling we do not control.
 *
 * Books' lists have grown several shapes over the years — `acc_id`,
 * `account_id`, `id` for the same thing — and the server parses them the same
 * way (see BooksReadings on the PHP side). These are the browser's half of
 * that, in one place, so two screens cannot disagree about which spelling wins.
 */

export function readId(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'number' && Number.isFinite(value) && value !== 0) return value
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) !== 0) {
      return Number(value)
    }
  }

  return null
}

export function readText(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }

  return null
}

/**
 * The same, for a value that may arrive as a string or as a number.
 *
 * An account number is the case this exists for: Books sends it as text in one
 * shape and as a bare number in another, and `readText` deliberately ignores
 * the number so that a numeric `name` cannot beat the real one.
 */
export function readScalar(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }

  return null
}
