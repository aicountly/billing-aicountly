/**
 * Regrouping the trend, and writing the window it covers.
 *
 * Split out of the components so it can be run without a browser: these are
 * the two pieces of arithmetic the dashboard does in the browser at all, and
 * both of them are the kind that is wrong by a rupee or a day and looks right.
 */

export interface TrendPoint {
  /** An ISO date, as the server sent it. */
  label: string
  value: number
}

/** How the trend is grouped. Both are sums of the SAME daily figures. */
export type Grain = 'day' | 'week'

/**
 * Daily figures, optionally added up into weeks.
 *
 * ADDITION ONLY — no average, no fill, no interpolation. The weekly line is
 * the same rupees as the daily one, so the chart cannot disagree with the card
 * above it. A week is labelled by the Monday it belongs to, and a period
 * starting mid-week keeps the first day the server actually sent rather than
 * being back-dated to a Monday nobody read.
 *
 * Summed in paise and divided once at the end. Adding 0.1 + 0.2 in floating
 * point thirty times drifts, and a trend a rupee off the total beside it is a
 * trend somebody has to go and check.
 */
export function groupPoints(points: TrendPoint[], grain: Grain): TrendPoint[] {
  if (grain === 'day' || points.length === 0) return points

  const weeks: Array<{ key: string; label: string; paise: number }> = []

  for (const point of points) {
    const start = weekStart(point.label)
    // A date that will not parse groups under itself rather than joining
    // whichever week happens to be last: one unreadable label must not move
    // somebody else's money into the wrong week.
    const key = start ?? `unparsed:${point.label}`
    const last = weeks[weeks.length - 1]
    const paise = Math.round(point.value * 100)

    if (last !== undefined && last.key === key) {
      last.paise += paise
    } else {
      weeks.push({ key, label: start ?? point.label, paise })
    }
  }

  return weeks.map((week) => ({ label: week.label, value: week.paise / 100 }))
}

/** The Monday of the week an ISO date falls in, or null if it will not parse. */
export function weekStart(iso: string): string | null {
  // Parsed as local midnight rather than as UTC: `new Date('2026-09-01')` is
  // UTC midnight, which in a timezone behind UTC is the previous day, and the
  // week it lands in is then the wrong one.
  const parsed = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return null

  const weekday = (parsed.getDay() + 6) % 7 // Monday = 0
  parsed.setDate(parsed.getDate() - weekday)

  return [
    parsed.getFullYear(),
    String(parsed.getMonth() + 1).padStart(2, '0'),
    String(parsed.getDate()).padStart(2, '0'),
  ].join('-')
}

/**
 * The window as a person writes it: "01 – 19 Sept 2026", not
 * "2026-09-01 → 2026-09-19".
 *
 * An unparseable date falls back to the ISO pair rather than to a date that
 * was never sent — the screen keeping the raw string is recoverable, the
 * screen quietly showing today is not.
 */
export function readableRange(from: string, to: string): string {
  const start = new Date(`${from}T00:00:00`)
  const end = new Date(`${to}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return from === to ? from : `${from} → ${to}`
  }

  const day = new Intl.DateTimeFormat('en-IN', { day: '2-digit' })
  const dayMonth = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short' })
  const full = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

  if (from === to) return full.format(start)
  // Say the month once when both ends share it, and the year once when both
  // ends share that. "01 – 19 Sept 2026" reads; "01 Sept 2026 – 19 Sept 2026"
  // is the same fact twice.
  if (start.getFullYear() === end.getFullYear()) {
    return start.getMonth() === end.getMonth()
      ? `${day.format(start)} – ${full.format(end)}`
      : `${dayMonth.format(start)} – ${full.format(end)}`
  }

  return `${full.format(start)} – ${full.format(end)}`
}
