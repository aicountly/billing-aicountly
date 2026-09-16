-- ---------------------------------------------------------------------------
-- Aicountly Billing — workflow state behind the five dashboards
--
-- The rule from 001 still holds and this file does not bend it: every figure a
-- dashboard shows for sales, outstanding, cash, bank or tax is read from Smart
-- Books on the request that draws it. Nothing below is a balance, a voucher or
-- a copy of a master.
--
-- What IS here is the state of conversations and checks that happen INSIDE this
-- product and that nobody else records:
--
--   * what a customer said they would pay, and when
--   * which steps of today's close a person has ticked off
--
-- Neither is an accounting record. A promise to pay is not a receivable — the
-- receivable stays in Books and is re-read every time this screen loads, which
-- is exactly why the promise can be shown NEXT TO it rather than instead of it.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- Promises to pay
--
-- "Ring them on the 15th, they said they'd pay then." Books has no field for
-- that because it is not an accounting fact; it is a commitment a person made
-- on the phone. Recording it is the difference between chasing everybody every
-- week and chasing the right customer on the right day.
--
-- promised_amount is WHAT THE CUSTOMER SAID, in the same category as
-- billing_reminder_log.amount_at_send: a record of a conversation, never read
-- back as a balance. The outstanding shown beside it comes from Books, live,
-- and the two are deliberately displayed separately so a promise that was not
-- kept is visible as a promise that was not kept.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_payment_promises (
    promise_id      BIGSERIAL PRIMARY KEY,
    cmp_id          BIGINT       NOT NULL,
    fy_id           BIGINT       NOT NULL,
    bo_id           BIGINT       NOT NULL DEFAULT 0,
    -- The Books account ledger this promise is against. A reference, not a party.
    customer_account_id BIGINT   NOT NULL,
    -- The Books bill, when the promise was about one bill in particular.
    books_voucher_uuid TEXT,
    books_bill_no   TEXT,
    promised_date   DATE         NOT NULL,
    -- What they said they would pay. Not a balance this product maintains.
    promised_amount NUMERIC(18,4) NOT NULL,
    -- TENTATIVE  they mentioned a date
    -- CONFIRMED  they committed to it
    -- CANCELLED  withdrawn by us
    -- Whether a promise was KEPT is not stored: it is decided by comparing the
    -- promised date with what Books says is still outstanding, on this request.
    status          TEXT         NOT NULL DEFAULT 'TENTATIVE',
    note            TEXT,
    created_by      TEXT         NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_promises_due
    ON billing_payment_promises (cmp_id, status, promised_date);
CREATE INDEX IF NOT EXISTS idx_billing_promises_party
    ON billing_payment_promises (cmp_id, customer_account_id, promised_date DESC);

-- --------------------------------------------------------------------------
-- Day-close checklist
--
-- A tick is a person saying "I have looked at this". It closes nothing, locks
-- nothing and posts nothing — Billing has no accounting period to lock, and
-- inventing one here would be a second answer to a question Books already owns.
--
-- One row per company per day per step. Whether a step is COMPLETE is read from
-- Books on the request; this table only records who looked and when.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_day_close_checks (
    check_id        BIGSERIAL PRIMARY KEY,
    cmp_id          BIGINT       NOT NULL,
    fy_id           BIGINT       NOT NULL,
    bo_id           BIGINT       NOT NULL DEFAULT 0,
    business_date   DATE         NOT NULL,
    -- receipts_reviewed | payments_reviewed | bank_entries_matched | documents_reviewed
    step            TEXT         NOT NULL,
    checked_by      TEXT         NOT NULL,
    checked_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (cmp_id, bo_id, business_date, step)
);

CREATE INDEX IF NOT EXISTS idx_billing_day_close
    ON billing_day_close_checks (cmp_id, business_date DESC);

-- --------------------------------------------------------------------------
-- The company's clock
--
-- "Due this week" and "my bills today" are the two figures people act on
-- without reading anything else, and both are meaningless until somebody says
-- whose day is meant. A shop closing at 9pm in Kolkata is still trading when a
-- UTC server has already started tomorrow.
--
-- Defaulted rather than asked: India is where this product is used, and a
-- business that needs a different clock can set one without being interrogated
-- about it at sign-up.
-- --------------------------------------------------------------------------

ALTER TABLE billing_settings
    ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata';
