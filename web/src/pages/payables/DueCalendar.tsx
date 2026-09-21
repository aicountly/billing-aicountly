/**
 * The due dates, on a month.
 *
 * Drawn entirely from the calendar the payables call already returned, so
 * opening it costs nothing and cannot disagree with the table. It is a view of
 * this screen's own data and deliberately not a diary: there is no scheduling
 * here, nothing is saved, and a day with bills on it takes you to that day's
 * bills in the table.
 */

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { compactMoney, money } from '../../ui'
import { Dialog } from './parts'

interface DueDay {
  date: string
  amount: number
  count: number
  overdue: boolean
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(new Date(year, month, 1))
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function DueCalendar({
  days,
  today,
  onClose,
  onPickDay,
}: {
  days: DueDay[]
  today: string
  onClose: () => void
  onPickDay: (date: string) => void
}) {
  const start = new Date(`${today}T00:00:00`)
  const [cursor, setCursor] = useState({ year: start.getFullYear(), month: start.getMonth() })

  const byDate = useMemo(() => {
    const map = new Map<string, DueDay>()
    for (const day of days) map.set(day.date, day)

    return map
  }, [days])

  const firstOfMonth = new Date(cursor.year, cursor.month, 1)
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate()
  // Monday-first, which is how a working week is read here.
  const lead = (firstOfMonth.getDay() + 6) % 7

  const monthTotal = useMemo(() => {
    let sum = 0
    let count = 0
    for (let day = 1; day <= daysInMonth; day++) {
      const entry = byDate.get(iso(cursor.year, cursor.month, day))
      if (entry) {
        sum += entry.amount
        count += entry.count
      }
    }

    return { sum, count }
  }, [byDate, cursor.year, cursor.month, daysInMonth])

  function shift(by: number) {
    setCursor((current) => {
      const next = new Date(current.year, current.month + by, 1)

      return { year: next.getFullYear(), month: next.getMonth() }
    })
  }

  return (
    <Dialog
      title="When your bills fall due"
      description="Every outstanding bill with a due date, on a month. Pick a day to list its bills."
      onClose={onClose}
    >
      <div className="mtp-cal__head">
        <button type="button" className="mtp-iconbutton" onClick={() => shift(-1)} aria-label="Previous month">
          <ChevronLeft size={15} aria-hidden />
        </button>
        <strong aria-live="polite">{monthLabel(cursor.year, cursor.month)}</strong>
        <button type="button" className="mtp-iconbutton" onClick={() => shift(1)} aria-label="Next month">
          <ChevronRight size={15} aria-hidden />
        </button>
      </div>

      <div className="mtp-cal__grid" role="grid" aria-label={`Bills falling due in ${monthLabel(cursor.year, cursor.month)}`}>
        {WEEKDAYS.map((weekday) => (
          <div key={weekday} className="mtp-cal__dow" role="columnheader">{weekday}</div>
        ))}

        {Array.from({ length: lead }, (_, index) => (
          <div key={`lead-${index}`} className="mtp-cal__day mtp-cal__day--empty" aria-hidden="true" />
        ))}

        {Array.from({ length: daysInMonth }, (_, index) => {
          const day = index + 1
          const key = iso(cursor.year, cursor.month, day)
          const entry = byDate.get(key)
          const classes = [
            'mtp-cal__day',
            entry ? 'mtp-cal__day--due' : '',
            entry?.overdue ? 'mtp-cal__day--overdue' : '',
            key === today ? 'mtp-cal__day--today' : '',
          ].filter(Boolean).join(' ')

          const content = (
            <>
              <span className="mtp-cal__date">{day}</span>
              {entry && (
                <>
                  <span className="mtp-cal__amount">{compactMoney(entry.amount)}</span>
                  <span className="mtp-cal__count">{entry.count} bill{entry.count === 1 ? '' : 's'}</span>
                </>
              )}
            </>
          )

          return entry ? (
            <button
              key={key}
              type="button"
              className={classes}
              onClick={() => onPickDay(key)}
              title={`${entry.count} bill${entry.count === 1 ? '' : 's'} due, ${money(entry.amount)}`}
            >
              {content}
            </button>
          ) : (
            <div key={key} className={classes} role="gridcell">{content}</div>
          )
        })}
      </div>

      <p style={{ margin: '14px 0 0', color: 'var(--billing-muted)', fontSize: 12 }}>
        {monthTotal.count === 0
          ? 'Nothing falls due this month.'
          : `${monthTotal.count} bill${monthTotal.count === 1 ? '' : 's'} due this month, ${money(monthTotal.sum)} in all.`}
        {' '}Bills recorded without a due date are not on the calendar; they are in the table under &ldquo;No due date&rdquo;.
      </p>
    </Dialog>
  )
}
