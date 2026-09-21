/**
 * Pro tip, and how far through setup this company actually is.
 *
 * THE NUMBER IS DERIVED. It comes from useSetupChecklist(), which asks Manage
 * for the company, Books for the accounts and Billing for its own rules — so
 * it moves when somebody configures something and it is never a decorative
 * "4 of 6". While those reads are in flight the bar shows a checking state
 * rather than a figure that is about to change, and a step nobody could answer
 * is left out of the total instead of counted as a failure.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronRight, CircleDashed, Lightbulb, TriangleAlert } from 'lucide-react'
import { useSetupChecklist } from '../../services/settingsSetup'
import { trackEvent } from '../../utils/analytics'
import { SettingsDialog } from './SettingsDialog'

export function SettingsSetupCard() {
  const checklist = useSetupChecklist()
  const [open, setOpen] = useState(false)

  const counted = checklist.total > 0
  const summary = checklist.loading
    ? 'Checking…'
    : counted
      ? `${checklist.complete} / ${checklist.total} completed`
      : 'Nothing to check yet'

  return (
    <section className="billing-settings__protip" aria-label="Setup checklist">
      <div className="billing-settings__protip-copy">
        <span className="billing-settings__tip-mark" aria-hidden>
          <Lightbulb size={20} />
        </span>
        <div>
          <strong>Pro tip</strong>
          <p>Complete your basic settings to get the best experience with Aicountly Billing.</p>
        </div>
      </div>

      <div className="billing-settings__progress">
        <div className="billing-settings__progress-text">
          <span>Setup checklist</span>
          <small>{summary}</small>
        </div>

        <div
          className="billing-settings__progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={counted ? checklist.total : 0}
          aria-valuenow={counted ? checklist.complete : undefined}
          aria-valuetext={summary}
          aria-label="Setup completed"
        >
          <span style={{ width: checklist.loading || !counted ? '0%' : `${checklist.percentage}%` }} />
        </div>

        <button
          type="button"
          className="billing-button billing-button--small"
          onClick={() => {
            trackEvent('billing_settings_checklist_opened', {
              complete: checklist.complete,
              total: checklist.total,
            })
            setOpen(true)
          }}
        >
          View checklist
        </button>
      </div>

      {open && (
        <SettingsDialog
          title="Setup checklist"
          description={
            checklist.loading
              ? 'Reading your configuration from Manage, Smart Books and Billing…'
              : counted
                ? `${checklist.complete} of ${checklist.total} done. Each line is checked against what is actually configured.`
                : 'None of these could be checked with your Billing profile.'
          }
          onClose={() => setOpen(false)}
          actions={
            <>
              {checklist.degraded && (
                <button type="button" className="billing-button" onClick={() => checklist.reload()}>
                  Try again
                </button>
              )}
              <button type="button" className="billing-button billing-button--primary" onClick={() => setOpen(false)}>
                Close
              </button>
            </>
          }
        >
          <div className="billing-settings__checklist">
            {checklist.steps.map((step) => (
              <Link
                key={step.key}
                to={step.to}
                className={`billing-settings__check${step.complete === true ? ' billing-settings__check--done' : ''}`}
                onClick={() => setOpen(false)}
              >
                <span className="billing-settings__check-mark" aria-hidden>
                  {step.complete === true ? (
                    <Check size={16} strokeWidth={3} />
                  ) : step.complete === false ? (
                    <CircleDashed size={16} />
                  ) : (
                    <TriangleAlert size={15} />
                  )}
                </span>
                <span style={{ minWidth: 0 }}>
                  <strong>{step.label}</strong>
                  <p>{step.detail}</p>
                </span>
                <ChevronRight size={15} aria-hidden style={{ color: 'var(--billing-muted)' }} />
                <span className="billing-sr-only">
                  {step.complete === true ? 'Done' : step.complete === false ? 'Not done' : 'Could not be checked'}
                </span>
              </Link>
            ))}
          </div>

          {checklist.unknown > 0 && (
            <p style={{ margin: '12px 0 0', color: 'var(--billing-muted)', fontSize: 12, lineHeight: 1.5 }}>
              {checklist.unknown} {checklist.unknown === 1 ? 'line is' : 'lines are'} left out of the count — either the
              product that owns the answer did not reply, or your Billing profile does not read it.
            </p>
          )}
        </SettingsDialog>
      )}
    </section>
  )
}
