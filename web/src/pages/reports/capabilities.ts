/**
 * What the Reports screen can actually do in THIS deployment.
 *
 * The screen offers several things a reporting product is expected to offer —
 * scheduling a report, building a custom one, a history of exports. Billing's
 * API serves none of them yet, and the honest thing is neither to hide the idea
 * nor to draw a button that quietly does nothing when it is pressed. Each one
 * is a flag: off by default, rendered as clearly unavailable with the reason
 * on it, and turned on by a build variable the day the endpoint exists.
 *
 * A button that does nothing is worse than one that says it cannot yet. The
 * first makes the user doubt themselves; the second tells them where they are.
 *
 * Everything NOT in this file is real and unconditional: running a report,
 * exporting it as CSV, printing it, copying a link to it, starring it.
 */

function flag(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === '') return fallback
  return value === 'true' || value === '1'
}

export interface ReportCapabilities {
  /** POST a schedule for a report. No endpoint: `v1/reports` runs, it does not book. */
  schedule: boolean
  /** A custom-report designer. No endpoint, and no report shape to save it into. */
  builder: boolean
  /** A list of past exports. The server audits every one, but serves no list of them. */
  exportHistory: boolean
  /**
   * The intelligence panel's call to action.
   *
   * On, this opens AI Pulse — a product already in this user's AICOUNTLY app
   * launcher, reached through the same single-sign-on jump the launcher grid
   * uses. It does not send anything anywhere, and no answer is invented here:
   * Billing has no intelligence endpoint and this screen does not pretend to.
   */
  askAi: boolean
}

export const REPORT_CAPABILITIES: ReportCapabilities = {
  schedule: flag(import.meta.env.VITE_FEATURE_REPORT_SCHEDULE),
  builder: flag(import.meta.env.VITE_FEATURE_REPORT_BUILDER),
  exportHistory: flag(import.meta.env.VITE_FEATURE_REPORT_EXPORT_HISTORY),
  askAi: flag(import.meta.env.VITE_FEATURE_REPORT_AI, true),
}

/** The line shown on a control that is switched off, explaining why. */
export const UNAVAILABLE_REASON: Record<keyof ReportCapabilities, string> = {
  schedule: 'Scheduled reports are not available in this deployment yet.',
  builder: 'The custom report builder is not available in this deployment yet.',
  exportHistory: 'Export history is not available in this deployment yet.',
  askAi: 'Report intelligence is not available in this deployment yet.',
}
