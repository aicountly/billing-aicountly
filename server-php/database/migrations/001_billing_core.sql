-- ---------------------------------------------------------------------------
-- Aicountly Billing — configuration and workflow only
--
-- Billing is a LIGHTWEIGHT OPERATIONAL UI over Smart Books and Inventory. It is
-- not a second accounting system, and this schema is the proof: there is no
-- sales voucher here, no purchase voucher, no receipt, no payment, no ledger,
-- no receivable, no payable, no stock and no GST figure.
--
-- When a shopkeeper presses Save on a bill, Books creates the voucher. What we
-- keep is the voucher uuid, so the screen can find it again.
--
-- What IS ours, and what nobody else records:
--   * who may see and do what INSIDE Billing (billing profiles)
--   * which menu this business sees (business mode)
--   * recurring billing rules and payment-reminder rules
--   * this user's defaults and favourites
--
-- The release-blocking test in tests/integration.php reads information_schema
-- and fails if an authoritative transaction table ever appears here.
-- ---------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- Billing profiles — the product's centrepiece
--
-- A shop owner wants their counter staff to raise bills without seeing the
-- purchase cost, the profit or the bank balance. That is a Billing decision —
-- Books has its own permissions for its own screens, and neither replaces the
-- other. Enforced in the backend: hiding a React menu is not a control.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_profiles (
    profile_id      BIGSERIAL PRIMARY KEY,
    cmp_id          BIGINT       NOT NULL,
    profile_code    TEXT         NOT NULL,
    profile_name    TEXT         NOT NULL,
    description     TEXT,
    -- One of the shipped templates (biller, sales_biller, purchase_operator,
    -- cashier, collection, owner) or 'custom'.
    template_key    TEXT         NOT NULL DEFAULT 'custom',
    -- A JSON array of permission codes from Permissions::CATALOG.
    permissions     JSONB        NOT NULL DEFAULT '[]'::jsonb,
    is_system       BOOLEAN      NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (cmp_id, profile_code)
);

CREATE TABLE IF NOT EXISTS billing_profile_assignments (
    assignment_id   BIGSERIAL PRIMARY KEY,
    cmp_id          BIGINT       NOT NULL,
    -- The portal uuid. Billing does not duplicate user identity: no name, no
    -- email, no password, no login of its own.
    user_uuid       TEXT         NOT NULL,
    profile_id      BIGINT       NOT NULL REFERENCES billing_profiles(profile_id) ON DELETE CASCADE,
    created_by      TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (cmp_id, user_uuid, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_assign_user ON billing_profile_assignments (cmp_id, user_uuid);

-- --------------------------------------------------------------------------
-- Business mode — what this business actually needs on screen
--
-- Answered once at first use. It decides the menu and nothing else: it creates
-- no masters, no ledgers and no vouchers.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_settings (
    cmp_id              BIGINT       PRIMARY KEY,
    -- micro | trader | service | retail | owner
    business_mode       TEXT         NOT NULL DEFAULT 'trader',
    -- retail | wholesale | service | trading | other
    business_type       TEXT,
    gst_registered      BOOLEAN      NOT NULL DEFAULT TRUE,
    maintains_stock     BOOLEAN      NOT NULL DEFAULT TRUE,
    needs_purchase      BOOLEAN      NOT NULL DEFAULT TRUE,
    needs_payables      BOOLEAN      NOT NULL DEFAULT TRUE,
    needs_bank_cash     BOOLEAN      NOT NULL DEFAULT TRUE,
    -- Shown on a bill; the numbering itself is Books' voucher series.
    default_sale_terms  TEXT,
    default_payment_terms TEXT,
    onboarding_done     BOOLEAN      NOT NULL DEFAULT FALSE,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- --------------------------------------------------------------------------
-- Per-user conveniences
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_user_preferences (
    preference_id   BIGSERIAL PRIMARY KEY,
    cmp_id          BIGINT       NOT NULL,
    user_uuid       TEXT         NOT NULL,
    -- default_warehouse_id, default_cash_account_id, default_bank_account_id,
    -- print_template, save_behaviour, visible_optional_fields…
    scope           TEXT         NOT NULL,
    payload         JSONB        NOT NULL DEFAULT '{}'::jsonb,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (cmp_id, user_uuid, scope)
);

-- Favourites are REFERENCES: an item id and how often it has been billed. The
-- item's name, price and stock stay in Inventory and are read from there.
CREATE TABLE IF NOT EXISTS billing_favourite_items (
    favourite_id    BIGSERIAL PRIMARY KEY,
    cmp_id          BIGINT       NOT NULL,
    user_uuid       TEXT,
    item_id         BIGINT       NOT NULL,
    use_count       INT          NOT NULL DEFAULT 0,
    last_used_at    TIMESTAMPTZ,
    UNIQUE (cmp_id, user_uuid, item_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_favourites ON billing_favourite_items (cmp_id, user_uuid, use_count DESC);

CREATE TABLE IF NOT EXISTS billing_saved_filters (
    filter_id       BIGSERIAL PRIMARY KEY,
    cmp_id          BIGINT       NOT NULL,
    user_uuid       TEXT         NOT NULL,
    screen          TEXT         NOT NULL,
    filter_name     TEXT         NOT NULL,
    payload         JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (cmp_id, user_uuid, screen, filter_name)
);

-- --------------------------------------------------------------------------
-- Recurring billing — a RULE, not an invoice
--
-- On the due date the rule triggers the Books Sales API and Books creates the
-- invoice. A Billing invoice is never created first and reconciled later; there
-- is no Billing invoice at all.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_recurring_rules (
    rule_id         BIGSERIAL PRIMARY KEY,
    cmp_id          BIGINT       NOT NULL,
    fy_id           BIGINT       NOT NULL,
    bo_id           BIGINT       NOT NULL DEFAULT 0,
    rule_name       TEXT         NOT NULL,
    customer_account_id BIGINT   NOT NULL,
    -- weekly | monthly | quarterly | annual | custom_days
    frequency       TEXT         NOT NULL DEFAULT 'monthly',
    interval_days   INT,
    day_of_month    INT,
    start_date      DATE         NOT NULL,
    end_date        DATE,
    next_run_date   DATE         NOT NULL,
    -- The lines to bill. OUR template for a future invoice, not a copy of a
    -- past one: item ids, quantities and the rates this agreement fixed.
    template_lines  JSONB        NOT NULL DEFAULT '[]'::jsonb,
    narration       TEXT,
    -- ACTIVE | PAUSED | ENDED
    status          TEXT         NOT NULL DEFAULT 'ACTIVE',
    -- Raise the invoice automatically, or just put it on the user's list.
    auto_post       BOOLEAN      NOT NULL DEFAULT FALSE,
    last_run_at     TIMESTAMPTZ,
    last_books_voucher_uuid TEXT,
    created_by      TEXT         NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_recurring_due ON billing_recurring_rules (cmp_id, status, next_run_date);

-- Each firing of a rule, and what Books made of it. A log of our own actions.
CREATE TABLE IF NOT EXISTS billing_recurring_runs (
    run_id          BIGSERIAL PRIMARY KEY,
    rule_id         BIGINT       NOT NULL REFERENCES billing_recurring_rules(rule_id) ON DELETE CASCADE,
    cmp_id          BIGINT       NOT NULL,
    due_date        DATE         NOT NULL,
    -- PENDING | POSTED | FAILED | SKIPPED
    status          TEXT         NOT NULL DEFAULT 'PENDING',
    books_voucher_uuid TEXT,
    books_voucher_id   BIGINT,
    books_voucher_no   TEXT,
    last_error      TEXT,
    ran_at          TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (rule_id, due_date)
);

-- --------------------------------------------------------------------------
-- Payment reminders — a RULE and a log of what was sent
--
-- Before any reminder goes out, the CURRENT outstanding is read from Books. A
-- reminder chasing a bill the customer paid last week is worse than no reminder
-- at all, and that is exactly what a copied receivable balance would produce.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_reminder_rules (
    rule_id         BIGSERIAL PRIMARY KEY,
    cmp_id          BIGINT       NOT NULL,
    rule_name       TEXT         NOT NULL,
    -- Negative = before the due date, positive = after it.
    offset_days     INT          NOT NULL,
    -- Repeat every N days after the first send; 0 = do not repeat.
    repeat_days     INT          NOT NULL DEFAULT 0,
    max_reminders   INT          NOT NULL DEFAULT 3,
    -- email | whatsapp | sms — delivered by the shared AICOUNTLY services.
    channel         TEXT         NOT NULL DEFAULT 'email',
    message_template TEXT,
    -- Do not chase anything smaller than this.
    minimum_amount  NUMERIC(18,4) NOT NULL DEFAULT 0,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (cmp_id, rule_name)
);

CREATE TABLE IF NOT EXISTS billing_reminder_log (
    log_id          BIGSERIAL PRIMARY KEY,
    cmp_id          BIGINT       NOT NULL,
    rule_id         BIGINT       REFERENCES billing_reminder_rules(rule_id) ON DELETE SET NULL,
    customer_account_id BIGINT   NOT NULL,
    -- The Books bill being chased. A reference.
    books_voucher_uuid TEXT,
    books_bill_no   TEXT,
    -- What the outstanding WAS when the reminder went out. Not a balance this
    -- product maintains: a record of what we told the customer, which is worth
    -- keeping when they ring up about it.
    amount_at_send  NUMERIC(18,4),
    channel         TEXT         NOT NULL,
    -- SENT | FAILED | SKIPPED_PAID | SKIPPED_BELOW_MINIMUM
    status          TEXT         NOT NULL,
    detail          TEXT,
    sent_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_reminder_log ON billing_reminder_log (cmp_id, customer_account_id, sent_at DESC);

-- --------------------------------------------------------------------------
-- Integration commands — intent and outcome, never data
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_integration_commands (
    command_id      BIGSERIAL PRIMARY KEY,
    cmp_id          BIGINT       NOT NULL,
    fy_id           BIGINT       NOT NULL,
    bo_id           BIGINT       NOT NULL DEFAULT 0,
    target_service  TEXT         NOT NULL,     -- books | inventory | contacts
    command_type    TEXT         NOT NULL,
    entity_type     TEXT         NOT NULL,
    entity_id       BIGINT       NOT NULL,
    -- Minted once, before the first call, reused by every retry. This is what
    -- stops a slow network becoming two invoices for one sale.
    idempotency_key TEXT         NOT NULL,
    status          TEXT         NOT NULL DEFAULT 'PENDING',
    attempts        INT          NOT NULL DEFAULT 0,
    request_summary JSONB        NOT NULL DEFAULT '{}'::jsonb,
    external_reference JSONB,
    last_error      TEXT,
    last_attempt_at TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (cmp_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_billing_commands_entity ON billing_integration_commands (cmp_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_billing_commands_open   ON billing_integration_commands (cmp_id, status)
    WHERE status IN ('PENDING', 'POSTING', 'FAILED', 'BLOCKED');

-- --------------------------------------------------------------------------
-- Transaction requests
--
-- One row per thing the user asked Billing to create in Books. It holds the
-- request, its state and the voucher reference Books returned — never the
-- voucher. The screen that shows "today's bills" reads the Books register.
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_transaction_requests (
    request_id      BIGSERIAL PRIMARY KEY,
    request_uuid    UUID         NOT NULL DEFAULT gen_random_uuid(),
    cmp_id          BIGINT       NOT NULL,
    fy_id           BIGINT       NOT NULL,
    bo_id           BIGINT       NOT NULL DEFAULT 0,
    -- sale | purchase | receipt | payment | credit_note | debit_note
    -- | expense | bank_deposit | bank_withdrawal | bank_transfer
    kind            TEXT         NOT NULL,
    -- PENDING | POSTING | POSTED | FAILED | CANCELLED
    status          TEXT         NOT NULL DEFAULT 'PENDING',
    party_account_id BIGINT,
    transaction_date DATE        NOT NULL,
    -- Enough to retry the call and to show the user what they typed. Not a
    -- voucher: Books computes the tax, assigns the number and owns the result.
    payload         JSONB        NOT NULL DEFAULT '{}'::jsonb,
    -- What Books called it. Value, tax and balance are read from Books.
    books_voucher_id   BIGINT,
    books_voucher_uuid TEXT,
    books_voucher_no   TEXT,
    last_error      TEXT,
    created_by      TEXT         NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_requests_scope ON billing_transaction_requests (cmp_id, fy_id, kind, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_billing_requests_open  ON billing_transaction_requests (cmp_id, status)
    WHERE status IN ('PENDING', 'POSTING', 'FAILED');

-- --------------------------------------------------------------------------
-- Audit — ours only
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_audit_log (
    audit_id        BIGSERIAL PRIMARY KEY,
    cmp_id          BIGINT       NOT NULL,
    fy_id           BIGINT       NOT NULL,
    bo_id           BIGINT       NOT NULL DEFAULT 0,
    actor_uuid      TEXT         NOT NULL,
    actor_kind      TEXT         NOT NULL,
    source_app      TEXT         NOT NULL,
    action          TEXT         NOT NULL,
    entity_type     TEXT         NOT NULL,
    entity_id       TEXT,
    before_state    JSONB,
    after_state     JSONB,
    reason          TEXT,
    ip_address      TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_audit_entity ON billing_audit_log (cmp_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_billing_audit_time   ON billing_audit_log (cmp_id, created_at DESC);

CREATE OR REPLACE FUNCTION billing_audit_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'billing_audit_log is append-only (attempted %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_billing_audit_no_update ON billing_audit_log;
CREATE TRIGGER trg_billing_audit_no_update
    BEFORE UPDATE ON billing_audit_log
    FOR EACH ROW EXECUTE FUNCTION billing_audit_immutable();

DROP TRIGGER IF EXISTS trg_billing_audit_no_delete ON billing_audit_log;
CREATE TRIGGER trg_billing_audit_no_delete
    BEFORE DELETE ON billing_audit_log
    FOR EACH ROW EXECUTE FUNCTION billing_audit_immutable();
