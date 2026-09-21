/**
 * Reading a row whose key spelling we do not control.
 *
 * Books' lists have grown several shapes over the years — `acc_id` here,
 * `account_id` there, an account number under any of four names. The server
 * parses them the same way (see BooksReadings) and these are the browser's
 * half of the same rule: ask for every key that could carry the value, take
 * the first one that does, and treat everything else as absent.
 *
 * Absent reads as null, never as zero or an empty string standing in for one.
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
