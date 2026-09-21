/**
 * The two things this screen draws and cannot do yet.
 *
 * Neither is decided here in any real sense. `DocumentCapture` in the API is
 * the switch for both — it is what the expense screen and the payables
 * dashboard read, so that "can this deployment keep a bill file?" and "can it
 * read one?" have ONE answer in this product rather than one per screen. These
 * constants say what that switch currently answers for a receipt, and the panel
 * they gate says the same thing on screen rather than offering a control that
 * quietly does nothing.
 *
 * See docs/BILLING_API_DEPENDENCIES.md — "Not available: keeping the bill file"
 * and "Not available: bill extraction".
 */

/**
 * Attaching payment proof to a receipt.
 *
 * `DocumentCapture::storage()` answers false whatever the environment says,
 * because Billing has no client that puts a file into a document service. The
 * expense screen works around it by recording WHERE the bill is kept, in the
 * `attachment_ref` the expense payload already carries. A receipt has no such
 * field — see `TransactionService::settlementPayload()` — so there is not even
 * a reference to write, and a drop zone here would swallow a photo and lose it.
 */
export const ATTACHMENTS_ENABLED = false

/**
 * Reading an amount, a date and a reference off a photographed receipt.
 *
 * `DocumentCapture::extraction()` turns on with `DOCUMENT_EXTRACTION_BASE`, but
 * what exists behind it is `POST v1/expenses/read-bill`, which reads a
 * SUPPLIER'S BILL: a different hint, a different set of fields, and a different
 * document. Borrowing it would put an answer about the wrong kind of paper in
 * front of somebody recording money. This turns on when there is a call behind
 * it that reads a receipt.
 */
export const RECEIPT_SCAN_ENABLED = false
