/**
 * Reading a row whose key spelling we do not control.
 *
 * Books and Inventory are each one product across several deployments, and
 * their lists have grown more than one spelling for the same field — `item_id`
 * here, `product_id` there. The server does this guessing once in
 * `BooksReadings`; these are the same three rules for the handful of lists a
 * screen reads straight through without a typed shape on this side.
 *
 * A field that is absent reads as null, never as zero: `?? 0` on a missing
 * amount is how an unreachable service ends up on screen as a healthy ₹0.00.
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

export function readNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  }

  return null
}
