-- ---------------------------------------------------------------------------
-- Aicountly Billing — a request may now be a draft
--
-- No new table, and nothing here is accounting. This adds ONE state to a row
-- that already exists: DRAFT, meaning "typed into Billing and deliberately not
-- sent to Smart Books yet". It sits before PENDING in the same life this row
-- has always had —
--
--   DRAFT → PENDING → POSTING → POSTED
--                  ↘ FAILED (retried on the same idempotency key)
--
-- Why this instead of a draft table, or the browser. A draft deposit is not a
-- voucher and does not belong in Books; nor does it belong in one machine's
-- localStorage, where the till's takings would be typed on the counter PC and
-- invisible from the back office, and lost with the browser profile. It is a
-- request that has not been made, which is precisely what this table holds.
--
-- The only structural change is the partial index: it exists so the "not saved
-- yet" screen can find open work without scanning the table, and a draft is
-- open work.
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN billing_transaction_requests.status IS
    'DRAFT | PENDING | POSTING | POSTED | FAILED | CANCELLED. DRAFT has never been sent to Books.';

DROP INDEX IF EXISTS idx_billing_requests_open;

CREATE INDEX IF NOT EXISTS idx_billing_requests_open ON billing_transaction_requests (cmp_id, status)
    WHERE status IN ('DRAFT', 'PENDING', 'POSTING', 'FAILED');

-- Reopening a draft is "the newest one I was working on, of this kind", which
-- is a different question from the one the scope index above answers.
CREATE INDEX IF NOT EXISTS idx_billing_requests_drafts ON billing_transaction_requests (cmp_id, fy_id, kind, created_at DESC)
    WHERE status = 'DRAFT';
