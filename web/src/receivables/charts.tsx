/**
 * The two charts on Money to Collect, in plain SVG.
 *
 * Built the way `dashboards/Chart.tsx` already builds this product's charts, and
 * for the same reason: there is no chart library here, and adding one for two
 * shapes would cost more bundle than it saves on a counter machine. What that
 * file established and this one keeps:
 *
 *   * an axis that starts at zero, so a 3% difference cannot be drawn as a cliff;
 *   * the exact figure available on hover AND as a real table for a screen
 *     reader — `aria-label="chart"` tells somebody nothing;
 *   * Indian digit grouping on every amount, abbreviated only on the axis;
 *   * one entrance transition and no idle animation.
 *
 * Nothing here invents a value. Every bar and every arc is a figure the API sent.
 */

import { useId, useMemo, useState } from 'react'
import { compactMoney, money, moneyWhole } from '../ui'
import type { AgeingSlice, PartyShare } from './model'

/**
 * A rounded axis top, so gridlines land on numbers a person would choose.
 *
 * More steps than the dashboards' version on purpose: with only 1, 2, 5 and 10
 * a tallest bar of \u20b95.7L is drawn against an axis of \u20b910L and fills half the
 * panel, which makes five buckets look flatter than they are.
 */
const AXIS_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]

function niceMax(value: number): number {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalised = value / magnitude
  const step = AXIS_STEPS.find((candidate) => normalised <= candidate) ?? 10

  return step * magnitude
}

export type AgeingMode = 'amount' | 'count'

// ---------------------------------------------------------------------------
// Ageing — one bar per bucket
// ---------------------------------------------------------------------------

export function AgeingChart({
  slices,
  mode,
  onPick,
  selected,
}: {
  slices: AgeingSlice[]
  mode: AgeingMode
  onPick?: (key: AgeingSlice['key']) => void
  selected?: string | null
}) {
  const titleId = useId()
  const [hover, setHover] = useState<number | null>(null)

  // The undated bucket is drawn only when something is in it. An always-empty
  // sixth bar teaches nothing and steals width from the five that matter.
  const drawn = useMemo(
    () => slices.filter((slice) => slice.key !== 'no_due_date' || slice.amount > 0 || slice.count > 0),
    [slices],
  )

  const value = (slice: AgeingSlice) => (mode === 'amount' ? slice.amount : slice.count)
  const label = (amount: number) => (mode === 'amount' ? moneyWhole(amount) : String(amount))
  const axisLabel = (amount: number) => (mode === 'amount' ? compactMoney(amount) : String(Math.round(amount)))

  const max = useMemo(() => niceMax(Math.max(...drawn.map(value), 0)), [drawn, mode])
  const empty = drawn.every((slice) => value(slice) === 0)

  const width = 660
  const height = 242
  const padding = { top: 24, right: 10, bottom: 38, left: 56 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom

  const groupWidth = plotWidth / Math.max(drawn.length, 1)
  const barWidth = Math.min(86, groupWidth * 0.56)
  const y = (amount: number) => padding.top + plotHeight - (amount / max) * plotHeight

  const active = hover !== null ? drawn[hover] : null

  // Nothing outstanding is a sentence, not a chart. Drawing five flat bars
  // against an axis that reads \u20b90, \u20b90, \u20b91 is worse than saying it.
  if (empty) {
    return (
      <p style={{ margin: 0, color: 'var(--billing-muted)', fontSize: 13 }}>
        Nothing outstanding, so there is nothing to age.
      </p>
    )
  }

  return (
    <figure style={{ margin: 0 }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="billing-dues-chart"
        role="img"
        aria-labelledby={titleId}
        style={{ maxHeight: 250 }}
      >
        <title id={titleId}>
          {mode === 'amount'
            ? `Outstanding by age: ${drawn.map((slice) => `${slice.label} ${money(slice.amount)}`).join(', ')}`
            : `Bills by age: ${drawn.map((slice) => `${slice.label} ${slice.count}`).join(', ')}`}
        </title>

        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
          <g key={fraction}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y(max * fraction)}
              y2={y(max * fraction)}
              stroke="#e8efe9"
              strokeWidth={1}
            />
            <text x={padding.left - 9} y={y(max * fraction) + 4} textAnchor="end" fontSize={11} fill="#5b6b62">
              {axisLabel(max * fraction)}
            </text>
          </g>
        ))}

        {drawn.map((slice, index) => {
          const amount = value(slice)
          const centre = padding.left + groupWidth * index + groupWidth / 2
          const top = amount > 0 ? y(amount) : padding.top + plotHeight
          const barHeight = Math.max(0, padding.top + plotHeight - top)
          const isSelected = selected === slice.key

          return (
            <g key={slice.key}>
              {amount > 0 && (
                <text x={centre} y={top - 8} textAnchor="middle" fontSize={11.5} fontWeight={700} fill="#18251e">
                  {label(amount)}
                </text>
              )}

              <rect
                className="billing-dues-chart__bar"
                x={centre - barWidth / 2}
                y={top}
                width={barWidth}
                height={barHeight}
                rx={6}
                fill={slice.colour}
                opacity={selected && !isSelected ? 0.4 : 1}
              >
                <title>
                  {`${slice.label}: ${money(slice.amount)} across ${slice.count} bill${slice.count === 1 ? '' : 's'}`}
                </title>
              </rect>

              {/* A full-height target, so the whole column answers the pointer
                  rather than only the few pixels a small bucket is tall. */}
              <rect
                className={onPick ? 'billing-dues-chart__hit' : undefined}
                x={padding.left + groupWidth * index}
                y={padding.top}
                width={groupWidth}
                height={plotHeight}
                fill="transparent"
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover(null)}
                onClick={onPick ? () => onPick(slice.key) : undefined}
              />

              <text
                x={centre}
                y={height - 14}
                textAnchor="middle"
                fontSize={11.5}
                fontWeight={isSelected ? 700 : 500}
                fill={isSelected ? '#18251e' : '#5b6b62'}
              >
                {slice.short}
              </text>
            </g>
          )
        })}
      </svg>

      <figcaption className="billing-dues-chart__caption" aria-live="polite">
        {active ? (
          <>
            <strong style={{ color: 'var(--billing-text)' }}>{active.label}</strong>
            {' · '}
            {money(active.amount)} across {active.count} bill{active.count === 1 ? '' : 's'}
            {active.share > 0 && ` · ${active.share}% of the total`}
          </>
        ) : empty ? (
          'Nothing outstanding, so there is nothing to age.'
        ) : (
          'Aged from each bill’s own due date. Select a bar to filter the list below.'
        )}
      </figcaption>

      {/* The same figures as text: read by a screen reader, and the only thing
          that survives when somebody prints this page. */}
      <table className="billing-sr-only">
        <caption>Outstanding by age</caption>
        <thead>
          <tr>
            <th scope="col">Age</th>
            <th scope="col">Amount</th>
            <th scope="col">Bills</th>
          </tr>
        </thead>
        <tbody>
          {drawn.map((slice) => (
            <tr key={slice.key}>
              <th scope="row">{slice.label}</th>
              <td>{money(slice.amount)}</td>
              <td>{slice.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

// ---------------------------------------------------------------------------
// Share — who the money sits with
// ---------------------------------------------------------------------------

export function ShareDonut({
  shares,
  total,
  onPick,
  selected,
}: {
  shares: PartyShare[]
  total: number
  onPick?: (accountId: number | null) => void
  selected?: number | null
}) {
  const titleId = useId()

  const size = 132
  const radius = 52
  const stroke = 19
  const circumference = 2 * Math.PI * radius

  // Offsets accumulate around the ring, so the arcs cannot overlap or leave a
  // gap however the percentages round.
  let offset = 0
  const arcs = shares.map((share) => {
    const length = total > 0 ? (share.amount / total) * circumference : 0
    const arc = { share, length, offset }
    offset += length
    return arc
  })

  return (
    <div className="billing-dues-donut">
      <div className="billing-dues-donut__figure">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-labelledby={titleId}>
          <title id={titleId}>
            {`Outstanding ${money(total)}: ${shares.map((share) => `${share.label} ${share.share}%`).join(', ')}`}
          </title>

          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#eef2f0" strokeWidth={stroke} />

          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {arcs.map(({ share, length, offset: start }) => (
              <circle
                key={share.id}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={share.colour}
                strokeWidth={selected !== null && selected !== undefined && selected === share.accountId ? stroke + 4 : stroke}
                strokeDasharray={`${Math.max(0, length)} ${circumference}`}
                strokeDashoffset={-start}
                opacity={selected !== null && selected !== undefined && selected !== share.accountId ? 0.4 : 1}
              >
                <title>{`${share.label}: ${money(share.amount)} (${share.share}%)`}</title>
              </circle>
            ))}
          </g>

          <text x={size / 2} y={size / 2 - 2} textAnchor="middle" fontSize={17} fontWeight={750} fill="#18251e">
            {compactMoney(total)}
          </text>
          <text x={size / 2} y={size / 2 + 15} textAnchor="middle" fontSize={11} fill="#5b6b62">
            Total
          </text>
        </svg>
      </div>

      <ul className="billing-dues-donut__legend">
        {shares.map((share) => {
          const body = (
            <>
              <span className="billing-dues-donut__dot" style={{ background: share.colour }} aria-hidden="true" />
              <span className="billing-dues-donut__name" title={share.label}>
                {share.label}
              </span>
              <span className="billing-dues-donut__amount">{compactMoney(share.amount)}</span>
              <span className="billing-dues-donut__share">{share.share}%</span>
            </>
          )

          return (
            <li key={share.id}>
              {onPick && share.accountId !== null ? (
                <button
                  type="button"
                  className="billing-dues-donut__row"
                  onClick={() => onPick(share.accountId)}
                  aria-pressed={selected === share.accountId}
                  title={`${share.label}: ${money(share.amount)} across ${share.billCount} bill${
                    share.billCount === 1 ? '' : 's'
                  }`}
                >
                  {body}
                </button>
              ) : (
                <span className="billing-dues-donut__row" title={`${share.label}: ${money(share.amount)}`}>
                  {body}
                </span>
              )}
            </li>
          )
        })}
      </ul>

      <table className="billing-sr-only">
        <caption>Outstanding by party</caption>
        <thead>
          <tr>
            <th scope="col">Party</th>
            <th scope="col">Outstanding</th>
            <th scope="col">Share</th>
            <th scope="col">Bills</th>
          </tr>
        </thead>
        <tbody>
          {shares.map((share) => (
            <tr key={share.id}>
              <th scope="row">{share.label}</th>
              <td>{money(share.amount)}</td>
              <td>{share.share}%</td>
              <td>{share.billCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
