/**
 * The parts of this screen whose backend does not exist yet.
 *
 * Both are documented in docs/BILLING_API_DEPENDENCIES.md, and both follow the
 * same rule as the dashboards: when a capability is missing the screen SAYS SO.
 * It does not hide the feature as though nobody had asked for it, and it does
 * not offer a control that quietly does nothing.
 *
 * Turning either on is a one-line change here once the contract exists — the
 * UI around them is already written to the shape the contract would take.
 */

/**
 * Attaching payment proof to a receipt.
 *
 * There is no upload endpoint in this API and no document store behind it. The
 * receipt payload Books accepts (see TransactionService::settlementPayload) has
 * no attachment field either, so a file chosen here would have nowhere to go —
 * and a receipt saved with a proof the user believes is attached is worse than
 * one saved without.
 */
export const ATTACHMENTS_ENABLED = false

/**
 * Reading an amount, a date and a reference off a photographed receipt.
 *
 * Needs a document-extraction service. `DOCUMENT_EXTRACTION_BASE` is the
 * setting that would enable one; this deployment has none, and this product
 * does not ask a model to guess at somebody's figures.
 */
export const RECEIPT_SCAN_ENABLED = false
