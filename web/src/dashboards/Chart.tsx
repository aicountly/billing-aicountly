/**
 * Two charts, both drawn from whatever the API actually returned.
 *
 * There is no chart library in this project and adding one for two shapes would
 * cost more bundle than it saves, so these are plain SVG — but plain SVG with
 * the parts a chart library gives you and a hand-rolled one usually forgets:
 *
 *   * a y-axis that starts at zero, so a 3% change cannot be drawn as a cliff;
 *   * a real text equivalent, not `aria-label="chart"` — a screen reader gets
 *     the same figures in a table, and so does anyone who prints the page;
 *   * an explicit "not enough data" state, distinct from "all zeros", because
 *     a flat line at the bottom and no data are different facts;
 *   * legends and formatted currency, since an axis reading 150000 in a country
 *     that groups digits as 1,50,000 is an axis people misread.
 *
 * Nothing here invents a point. Every coordinate comes from the props.
 */

import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { compactMoney, money } from '../ui'
import { EmptyState, Unavailable } from './kit'

interface Series {
  key: string
  label: string
  colour: string
  points: Array<{ label: string; value: number }>
}

function shortDate(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(parsed)
}

/**
 * The width the chart is actually being drawn at.
 *
 * WITHOUT THIS THE AXIS LABELS SHRINK WITH THE PHONE. An SVG with a fixed
 * viewBox scales its whole coordinate system to fit, text included, so an
 * 11px date label drawn into a 720-wide viewBox is about 6px once that box is
 * squeezed into a 390px screen — present, unreadable, and invisible to every
 * check that only looks for overflow. Measuring the container and drawing into
 * a viewBox of that width keeps a px a px at every size.
 *
 * Falls back to 720 before the first measurement so the first paint is a chart
 * rather than a collapsed one, and never goes below 320 — under that the chart
 * scrolls sideways inside its own box instead of becoming illegible.
 */
function useDrawnWidth(): [(node: HTMLElement | null) => void, number] {
  const [width, setWidth] = useState(720)
  const observer = useRef<ResizeObserver | null>(null)

  const ref = useCallback((node: HTMLElement | null) => {
    observer.current?.disconnect()
    if (node === null) return

    const measure = () => setWidth(Math.max(320, Math.round(node.clientWidth)))
    measure()

    if (typeof ResizeObserver === 'undefined') return
    observer.current = new ResizeObserver(measure)
    observer.current.observe(node)
  }, [])

  useLayoutEffect(() => () => observer.current?.disconnect(), [])

  return [ref, width]
}

/**
 * A rounded axis top, so gridlines land on numbers a person would choose.
 *
 * Also never zero: a day with no sales still needs an axis, or the line is
 * drawn against a height of nothing and every point sits at infinity.
 */
function niceMax(value: number): number {
  if (value <= 0) return 1000
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalised = value / magnitude
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10
  return step * magnitude
}

// ---------------------------------------------------------------------------
// Trend — sales against collections
// ---------------------------------------------------------------------------

export function TrendChart({
  series,
  basis,
  reason,
}: {
  series: Series[]
  basis: string
  reason?: string | null
}) {
  const titleId = useId()
  const [hover, setHover] = useState<number | null>(null)
  const [box, width] = useDrawnWidth()

  const height = width < 520 ? 230 : 260
  const padding = { top: 16, right: 16, bottom: 30, left: width < 520 ? 46 : 56 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom

  const labels = series[0]?.points.map((point) => point.label) ?? []
  const max = useMemo(() => {
    let highest = 0
    for (const line of series) {
      for (const point of line.points) highest = Math.max(highest, point.value)
    }
    return niceMax(highest)
  }, [series])

  if (reason) {
    return <Unavailable title="No chart for these dates">{reason}</Unavailable>
  }
  if (series.length === 0 || labels.length === 0) {
    return <EmptyState>Nothing was recorded in this period, so there is nothing to plot.</EmptyState>
  }
  if (labels.length === 1) {
    // One point is not a trend. Say the number instead of drawing a dot and
    // calling it a line.
    return (
      <div style={{ display: 'grid', gap: '0.6rem' }}>
        {series.map((line) => (
          <p key={line.key} style={{ margin: 0 }}>
            <strong>{line.label}</strong> on {shortDate(labels[0])}:{' '}
            <span className="num">{money(line.points[0]?.value ?? 0)}</span>
          </p>
        ))}
        <p style={{ margin: 0, color: 'var(--billing-muted)', fontSize: 12 }}>
          A single day cannot be drawn as a trend. Choose a longer period to see one.
        </p>
      </div>
    )
  }

  const x = (index: number) => padding.left + (index / (labels.length - 1)) * plotWidth
  const y = (value: number) => padding.top + plotHeight - (value / max) * plotHeight

  // At most eight date labels. Spacing them by a fixed step and then forcing
  // the last one puts two labels on top of each other whenever the day count is
  // not a multiple of the step — 15 Sept and 16 Sept printed over each other on
  // a 16-day month. Distributing the ticks across the range instead includes
  // both ends by construction and never doubles up.
  const lastIndex = labels.length - 1
  // Eight dates need about 560px to sit apart. Below that they are thinned
  // rather than shrunk: four readable labels beat eight overlapping ones.
  const tickCount = Math.min(labels.length, width < 420 ? 3 : width < 560 ? 5 : 8)
  const ticks = new Set(
    tickCount <= 1
      ? [0]
      : Array.from({ length: tickCount }, (_, index) => Math.round((index * lastIndex) / (tickCount - 1))),
  )

  return (
    <figure style={{ margin: 0 }} ref={box}>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
        {series.map((line) => (
          <span key={line.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 650 }}>
            <span
              aria-hidden="true"
              style={{ width: 10, height: 10, borderRadius: 3, background: line.colour, display: 'inline-block' }}
            />
            {line.label}
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="billing-chart"
        style={{ width: '100%', height, display: 'block', overflow: 'visible' }}
        role="img"
        aria-labelledby={titleId}
      >
        <title id={titleId}>
          {series.map((line) => `${line.label} by day, highest ${money(Math.max(...line.points.map((p) => p.value)))}`).join('. ')}
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
            <text x={padding.left - 8} y={y(max * fraction) + 4} textAnchor="end" fontSize={11} fill="#5b6b62">
              {compactMoney(max * fraction)}
            </text>
          </g>
        ))}

        {series.map((line) => {
          const path = line.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point.value)}`).join(' ')
          const area = `${path} L ${x(line.points.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`

          return (
            <g key={line.key}>
              <path d={area} fill={line.colour} opacity={0.1} />
              <path d={path} fill="none" stroke={line.colour} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
              {hover !== null && line.points[hover] && (
                <circle cx={x(hover)} cy={y(line.points[hover].value)} r={4.5} fill="#fff" stroke={line.colour} strokeWidth={2.2} />
              )}
            </g>
          )
        })}

        {labels.map((label, index) =>
          ticks.has(index) ? (
            <text
              key={label}
              x={x(index)}
              y={height - 8}
              textAnchor={index === 0 ? 'start' : index === lastIndex ? 'end' : 'middle'}
              fontSize={11}
              fill="#5b6b62"
            >
              {shortDate(label)}
            </text>
          ) : null,
        )}

        {/* One invisible band per day, so a pointer anywhere in the column
            reads that day rather than requiring a hit on a 2px line. */}
        {labels.map((label, index) => (
          <rect
            key={`hit-${label}`}
            x={x(index) - plotWidth / (labels.length - 1) / 2}
            y={padding.top}
            width={plotWidth / (labels.length - 1)}
            height={plotHeight}
            fill="transparent"
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(null)}
          />
        ))}

        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={padding.top}
            y2={padding.top + plotHeight}
            stroke="#b9c9bd"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}
      </svg>

      <figcaption
        style={{ marginTop: 10, minHeight: '1.3em', fontSize: 13, color: 'var(--billing-muted)' }}
        aria-live="polite"
      >
        {hover !== null ? (
          <>
            <strong style={{ color: 'var(--billing-text)' }}>{shortDate(labels[hover])}</strong>
            {series.map((line) => (
              <span key={line.key}>
                {' · '}
                {line.label} <span className="num">{money(line.points[hover]?.value ?? 0)}</span>
              </span>
            ))}
          </>
        ) : (
          basis
        )}
      </figcaption>

      {/* The same figures as text. Read by a screen reader, and the only thing
          that survives when the page is printed. */}
      <table className="billing-sr-only">
        <caption>Daily figures for the selected period</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            {series.map((line) => (
              <th key={line.key} scope="col">{line.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((label, index) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              {series.map((line) => (
                <td key={line.key}>{money(line.points[index]?.value ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

// ---------------------------------------------------------------------------
// Flow — money in against money out
// ---------------------------------------------------------------------------

export function FlowChart({
  buckets,
  basis,
}: {
  buckets: Array<{ label: string; in: number; out: number }>
  basis: string
}) {
  const titleId = useId()

  const width = 660
  const height = 240
  const padding = { top: 14, right: 12, bottom: 28, left: 56 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom

  const max = useMemo(
    () => niceMax(buckets.reduce((highest, bucket) => Math.max(highest, bucket.in, bucket.out), 0)),
    [buckets],
  )

  if (buckets.length === 0) {
    return <EmptyState>No money moved on this date.</EmptyState>
  }

  const groupWidth = plotWidth / buckets.length
  const barWidth = Math.min(16, Math.max(5, groupWidth / 2.8))
  const y = (value: number) => padding.top + plotHeight - (value / max) * plotHeight

  return (
    <figure style={{ margin: 0 }}>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 650 }}>
          <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: '#2f9e28' }} /> Money in
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 650 }}>
          <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: '#e3a008' }} /> Money out
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="billing-chart"
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-labelledby={titleId}
      >
        <title id={titleId}>Money in and money out, by {buckets.length > 1 ? 'hour' : 'day'}</title>

        {[0, 0.5, 1].map((fraction) => (
          <g key={fraction}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y(max * fraction)}
              y2={y(max * fraction)}
              stroke="#e8efe9"
              strokeWidth={1}
            />
            <text x={padding.left - 8} y={y(max * fraction) + 4} textAnchor="end" fontSize={11} fill="#5b6b62">
              {compactMoney(max * fraction)}
            </text>
          </g>
        ))}

        {buckets.map((bucket, index) => {
          const centre = padding.left + groupWidth * index + groupWidth / 2
          return (
            <g key={bucket.label}>
              <rect
                x={centre - barWidth - 1.5}
                y={y(bucket.in)}
                width={barWidth}
                height={Math.max(0, padding.top + plotHeight - y(bucket.in))}
                fill="#2f9e28"
                rx={3}
              >
                <title>{`${bucket.label} in: ${money(bucket.in)}`}</title>
              </rect>
              <rect
                x={centre + 1.5}
                y={y(bucket.out)}
                width={barWidth}
                height={Math.max(0, padding.top + plotHeight - y(bucket.out))}
                fill="#e3a008"
                rx={3}
              >
                <title>{`${bucket.label} out: ${money(bucket.out)}`}</title>
              </rect>
              {(buckets.length <= 14 || index % 2 === 0) && (
                <text x={centre} y={height - 8} textAnchor="middle" fontSize={11} fill="#5b6b62">
                  {bucket.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      <figcaption style={{ marginTop: 10, fontSize: 12, color: 'var(--billing-muted)' }}>{basis}</figcaption>

      <table className="billing-sr-only">
        <caption>Money in and out</caption>
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">In</th>
            <th scope="col">Out</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr key={bucket.label}>
              <th scope="row">{bucket.label}</th>
              <td>{money(bucket.in)}</td>
              <td>{money(bucket.out)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

export const SERIES_COLOURS = {
  sales: '#25b003',
  collections: '#0f7fa8',
  outflow: '#e3a008',
} as const
