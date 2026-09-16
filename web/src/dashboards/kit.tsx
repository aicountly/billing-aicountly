/**
 * The pieces every dashboard is built from.
 *
 * Three rules run through all of them.
 *
 *  1. A figure that could not be read renders as "Unavailable" with the reason,
 *     never as ₹0.00. A zero and an outage look identical to the person reading
 *     it, and one of them means "quiet day".
 *  2. Colour is never the only signal. Every badge and every trend carries a
 *     word or an arrow as well as a hue.
 *  3. A loading state keeps the layout it will have when it arrives, so the
 *     page does not jump under a finger that is already moving toward a button.
 */

import type { ReactNode } from 'react'
import { AlertCircle, AlertTriangle, ArrowDownRight, ArrowUpRight, Info, Minus } from 'lucide-react'
import type { AgeingBucket, Metric, MetricBasis, SuggestedActionShape } from './types'
import { money } from '../ui'

// ---------------------------------------------------------------------------
// Metric cards
// ---------------------------------------------------------------------------

/** What kind of number this is, in three words. */
const BASIS_WORDS: Record<MetricBasis, string> = {
  period: 'Over the period',
  as_of: 'Balance today',
  window: 'Falls due soon',
  count: 'Count',
  stated: 'As stated',
}

export function MetricCard({
  metric,
  loading = false,
  format = 'money',
  icon,
  onOpen,
}: {
  metric: Metric
  loading?: boolean
  format?: 'money' | 'count'
  icon?: ReactNode
  onOpen?: () => void
}) {
  const status = loading ? 'loading' : metric.status
  const comparison = metric.comparison

  const content = (
    <>
      <span className="billing-metric__top">
        <span className="billing-metric__label">{metric.label}</span>
        {icon && <span className="billing-metric__icon" aria-hidden="true">{icon}</span>}
      </span>

      {status === 'loading' ? (
        <span className="billing-skeleton billing-skeleton--value">
          <span className="billing-sr-only">Loading {metric.label}</span>
        </span>
      ) : status === 'unavailable' || metric.value === null ? (
        <strong className="billing-metric__value billing-metric__value--unavailable">Unavailable</strong>
      ) : (
        <strong className="billing-metric__value">
          {format === 'count' ? metric.value.toLocaleString('en-IN') : money(metric.value)}
        </strong>
      )}

      <span className="billing-metric__description">
        {status === 'unavailable' ? (metric.reason ?? 'This figure could not be read.') : (metric.detail ?? metric.definition)}
      </span>

      <span className="billing-metric__foot">
        <span className="billing-basis">{BASIS_WORDS[metric.basis] ?? metric.basis}</span>
        {status === 'ready' && comparison && <Comparison comparison={comparison} />}
      </span>
    </>
  )

  return (
    <article className="billing-metric" aria-busy={status === 'loading'}>
      {onOpen && status === 'ready' ? (
        <button
          type="button"
          className="billing-metric__content billing-metric__button"
          onClick={onOpen}
          aria-label={`${metric.label}. ${metric.definition}`}
          title={metric.definition}
        >
          {content}
        </button>
      ) : (
        <div className="billing-metric__content" title={metric.definition}>
          {content}
        </div>
      )}
    </article>
  )
}

/**
 * A like-for-like change, or an honest refusal to draw one.
 *
 * The tone comes from the server, which knows whether a rise is welcome. Here,
 * +14% on overdue debt would otherwise be painted the same green as +14% on
 * sales, and the person glancing at it would read good news.
 */
function Comparison({ comparison }: { comparison: NonNullable<Metric['comparison']> }) {
  if (!comparison.available) {
    return (
      <span className="billing-trend" title={comparison.detail}>
        <Minus size={13} aria-hidden /> {comparison.label}
      </span>
    )
  }

  const Arrow = comparison.direction === 'up' ? ArrowUpRight : ArrowDownRight

  return (
    <span className={`billing-trend billing-trend--${comparison.tone ?? 'positive'}`}>
      <Arrow size={13} aria-hidden /> {comparison.label}
    </span>
  )
}

/** Four skeletons while the first response is in flight, so nothing jumps. */
export function MetricRow({
  metrics,
  loading,
  placeholders = 4,
  format,
  icons,
  onOpen,
}: {
  metrics: Metric[]
  loading: boolean
  placeholders?: number
  format?: (metric: Metric) => 'money' | 'count'
  icons?: Record<string, ReactNode>
  onOpen?: (metric: Metric) => void
}) {
  const shown: Metric[] = loading && metrics.length === 0
    ? Array.from({ length: placeholders }, (_, index) => ({
        id: `placeholder-${index}`,
        label: ' ',
        value: null,
        status: 'loading' as const,
        basis: 'as_of' as const,
        definition: '',
        comparison: null,
        tone: 'neutral' as const,
      }))
    : metrics

  return (
    <section
      className="billing-metrics"
      data-count={shown.length < 4 ? shown.length : undefined}
      aria-label="Key figures"
    >
      {shown.map((metric) => (
        <MetricCard
          key={metric.id}
          metric={metric}
          loading={metric.status === 'loading'}
          format={format ? format(metric) : 'money'}
          icon={icons?.[metric.id]}
          onOpen={onOpen && metric.status === 'ready' ? () => onOpen(metric) : undefined}
        />
      ))}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

export function DashboardPanel({
  title,
  description,
  action,
  footnote,
  children,
  className = '',
}: {
  title: string
  description?: string
  action?: ReactNode
  footnote?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`billing-panel ${className}`.trim()}>
      <div className="billing-panel__heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      {children}
      {footnote && <p className="billing-panel__footnote">{footnote}</p>}
    </section>
  )
}

export function SuggestedAction({
  suggestion,
  onReview,
}: {
  suggestion: SuggestedActionShape
  onReview: (suggestion: SuggestedActionShape) => void
}) {
  const Mark = suggestion.tone === 'danger' ? AlertCircle : suggestion.tone === 'warning' ? AlertTriangle : Info

  return (
    <div className="billing-suggestion">
      <div className="billing-suggestion__body">
        <span className={`billing-suggestion__mark billing-suggestion__mark--${suggestion.tone}`} aria-hidden="true">
          <Mark size={17} />
        </span>
        <div>
          <h3>{suggestion.title}</h3>
          <p>{suggestion.reason}</p>
        </div>
      </div>
      <button
        type="button"
        className="billing-button billing-button--soft billing-button--small"
        onClick={() => onReview(suggestion)}
      >
        {suggestion.action.label}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/**
 * Something that could not be read, and why.
 *
 * Deliberately not styled as an error: an unavailable panel is usually a
 * service having a moment, not the user having done anything wrong.
 */
export function Unavailable({
  title = 'Not available',
  children,
  action,
}: {
  title?: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="billing-unavailable" role="status">
      <span className="billing-unavailable__title">{title}</span>
      <span>{children}</span>
      {action}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="billing-error-state" role="alert">
      <AlertCircle size={20} aria-hidden />
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="billing-button billing-button--small" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="billing-empty-state">
      <p style={{ margin: 0 }}>{children}</p>
      {action && <div style={{ marginTop: '0.9rem' }}>{action}</div>}
    </div>
  )
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="billing-skeleton-rows" aria-busy="true">
      <span className="billing-sr-only">Loading</span>
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="billing-skeleton billing-skeleton--line" />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

export type BadgeTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info'

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={`billing-badge billing-badge--${tone}`}>{children}</span>
}

/**
 * Settlement state, in words.
 *
 * PARTIALLY_PAID is deliberately its own badge rather than being rounded up to
 * Paid: the difference between a customer who owes nothing and one who owes
 * half is the whole of the receivables screen.
 */
export function SettlementBadge({ status }: { status: string | null }) {
  if (status === null) return <span style={{ color: 'var(--billing-muted)' }}>—</span>

  const tones: Record<string, BadgeTone> = {
    PAID: 'success',
    PARTIALLY_PAID: 'warning',
    UNPAID: 'neutral',
    DUE: 'warning',
    OVERDUE: 'danger',
    DRAFT: 'neutral',
    CANCELLED: 'neutral',
  }
  const tone: BadgeTone = tones[status] ?? 'neutral'

  const labels: Record<string, string> = {
    PAID: 'Paid',
    PARTIALLY_PAID: 'Part paid',
    UNPAID: 'Unpaid',
  }
  const label = labels[status] ?? status.replace(/_/g, ' ').toLowerCase()

  return <Badge tone={tone}>{label}</Badge>
}

export function QuickAction({
  label,
  hint,
  icon,
  onClick,
}: {
  label: string
  hint?: string
  icon: ReactNode
  onClick: () => void
}) {
  return (
    <button type="button" className="billing-quick-action" onClick={onClick}>
      <span className="billing-quick-action__mark" aria-hidden="true">{icon}</span>
      <span>
        <span className="billing-quick-action__label">{label}</span>
        {hint && <span className="billing-quick-action__hint">{hint}</span>}
      </span>
    </button>
  )
}

/**
 * The ageing bar.
 *
 * Widths are shares of the total, so the bar and the figures beneath it cannot
 * disagree. `reconciles` comes from the server, which checked the buckets add
 * up to the headline; when it says no, the bar is not drawn at all — a stacked
 * bar that is silently short is the one error on this screen a user cannot see.
 */
export function AgeingBar({
  buckets,
  total,
  reconciles,
}: {
  buckets: AgeingBucket[]
  total: number
  reconciles: boolean
}) {
  if (!reconciles) {
    return (
      <Unavailable title="Ageing cannot be shown">
        The buckets do not add up to the outstanding total, so the breakdown would be misleading. The total above is
        still Smart Books&rsquo; own figure.
      </Unavailable>
    )
  }

  if (total <= 0) {
    return <EmptyState>Nothing outstanding — there is nothing to age.</EmptyState>
  }

  const visible = buckets.filter((bucket) => bucket.amount > 0)

  return (
    <div>
      <div
        className="billing-ageing__bar"
        role="img"
        aria-label={`Outstanding ${money(total)}: ${visible
          .map((bucket) => `${bucket.label} ${money(bucket.amount)}`)
          .join(', ')}`}
      >
        {visible.map((bucket) => (
          <div
            key={bucket.key}
            className={`billing-ageing__segment billing-ageing__segment--${bucket.tone}`}
            style={{ width: `${Math.max(bucket.share, 1.5)}%` }}
            title={`${bucket.label}: ${money(bucket.amount)} (${bucket.share}%)`}
          >
            {bucket.share >= 12 ? money(bucket.amount) : ''}
          </div>
        ))}
      </div>

      <div className="billing-ageing__legend">
        {buckets.map((bucket) => (
          <div key={bucket.key} className="billing-ageing__key">
            <span className={`billing-ageing__dot billing-ageing__dot--${bucket.tone}`} aria-hidden="true" />
            <span>
              {bucket.label}
              <br />
              <strong style={{ color: 'var(--billing-text)' }} className="num">
                {money(bucket.amount)}
              </strong>{' '}
              ({bucket.share}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Days, in the words somebody would use out loud. */
export function overdueWords(days: number): string {
  if (days <= 0) return 'Not overdue'
  if (days === 1) return '1 day'
  return `${days} days`
}
