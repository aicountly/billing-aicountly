<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

use Aicountly\Api\Audit;
use Aicountly\Api\Auth;
use Aicountly\Api\Clients\BooksClient;
use Aicountly\Api\Context;
use Aicountly\Api\Db;
use Aicountly\Api\Http;
use Aicountly\Api\Permissions;

/**
 * Recurring bills and payment reminders.
 *
 * BUSINESS AUTOMATION, NOT DATA SYNCHRONISATION. The difference matters and is
 * worth stating precisely, because this is the one place in the product where a
 * schedule exists at all:
 *
 *   ALLOWED, and this is it:  "on the 1st, raise this month's rent invoice";
 *                             "three days after a bill is due, chase it".
 *                             Both act on a BUSINESS EVENT and produce a
 *                             business outcome.
 *
 *   PROHIBITED:               "every hour, copy Books' invoices into Billing";
 *                             "every night, refresh the customer list";
 *                             "every morning, recompute the receivables table".
 *                             None of those has a business outcome; each exists
 *                             only to keep a second copy in step with a first.
 *
 * The test is simple: if the job's purpose is to make two databases agree, it is
 * prohibited. Nothing here makes two databases agree, because there is no second
 * copy of anything.
 *
 * Two consequences that follow from that:
 *
 *  * A recurring rule triggers the BOOKS Sales API. It never creates a Billing
 *    invoice first and pushes it later — there is no Billing invoice.
 *  * A reminder reads the CURRENT outstanding from Books before it sends. A
 *    reminder chasing a bill paid last week is worse than no reminder, and a
 *    stored receivable is exactly how that happens.
 */
final class ScheduleService
{
    public function __construct(
        private readonly Context $ctx,
        private readonly Auth $auth,
    ) {
    }

    // -----------------------------------------------------------------------
    // Recurring bills
    // -----------------------------------------------------------------------

    /** @param array<string, mixed> $input */
    public function createRecurring(array $input): array
    {
        Permissions::assert($this->ctx, $this->auth, 'recurring.manage');

        $customerId = (int) ($input['customer_account_id'] ?? 0);
        if ($customerId <= 0) {
            Http::validationFailed('Choose the customer to bill.', ['field' => 'customer_account_id']);
        }

        $name = self::text($input['rule_name'] ?? null);
        if ($name === null) {
            Http::validationFailed('Give this recurring bill a name you will recognise.', ['field' => 'rule_name']);
        }

        $frequency = self::text($input['frequency'] ?? null) ?? 'monthly';
        if (!in_array($frequency, ['weekly', 'monthly', 'quarterly', 'annual', 'custom_days'], true)) {
            Http::validationFailed('Frequency must be weekly, monthly, quarterly, annual or custom_days.', ['field' => 'frequency']);
        }

        $intervalDays = self::id($input['interval_days'] ?? null);
        if ($frequency === 'custom_days' && ($intervalDays === null || $intervalDays < 1)) {
            Http::validationFailed('Say how many days apart the bills should be.', ['field' => 'interval_days']);
        }

        $lines = $input['template_lines'] ?? $input['lines'] ?? [];
        if (!is_array($lines) || $lines === []) {
            Http::validationFailed('A recurring bill needs at least one line.', ['field' => 'template_lines']);
        }

        $startDate = self::date($input['start_date'] ?? null);

        $ruleId = (int) Db::insert('billing_recurring_rules', [
            'cmp_id'              => $this->ctx->cmpId,
            'fy_id'               => $this->ctx->fyId,
            'bo_id'               => $this->ctx->boId,
            'rule_name'           => $name,
            'customer_account_id' => $customerId,
            'frequency'           => $frequency,
            'interval_days'       => $intervalDays,
            'day_of_month'        => self::id($input['day_of_month'] ?? null),
            'start_date'          => $startDate,
            'end_date'            => self::text($input['end_date'] ?? null),
            'next_run_date'       => $startDate,
            'template_lines'      => array_values($lines),
            'narration'           => self::text($input['narration'] ?? null),
            'auto_post'           => (bool) ($input['auto_post'] ?? false),
            'created_by'          => $this->auth->uuid,
        ], 'rule_id');

        Audit::record($this->ctx, $this->auth, 'recurring.created', 'recurring_rule', $ruleId, null, ['rule_name' => $name]);

        return $this->findRecurring($ruleId);
    }

    /**
     * Raise this occurrence of a recurring bill.
     *
     * Called when the user presses "bill it now", or by the scheduled run. Either
     * way it goes straight to the Books Sales API through TransactionService, so
     * there is exactly one path a sale can take through this product.
     */
    public function runRecurring(int $ruleId, ?string $dueDate = null): array
    {
        Permissions::assert($this->ctx, $this->auth, 'sale.create');

        $rule = $this->findRecurring($ruleId);
        if ($rule === []) {
            Http::notFound('That recurring bill does not exist.');
        }
        if ($rule['status'] !== 'ACTIVE') {
            Http::conflict('This recurring bill is ' . strtolower((string) $rule['status']) . '.');
        }

        $dueDate ??= (string) $rule['next_run_date'];

        // One invoice per due date, and the unique index behind it is what makes
        // that true even if two people press the button at the same moment.
        $existing = Db::first(
            'SELECT * FROM billing_recurring_runs WHERE rule_id = :rule AND due_date = :due',
            ['rule' => $ruleId, 'due' => $dueDate],
        );
        if ($existing !== null && $existing['status'] === 'POSTED') {
            Http::conflict('This bill has already been raised for ' . $dueDate . '.');
        }

        if ($existing === null) {
            Db::insert('billing_recurring_runs', [
                'rule_id'  => $ruleId,
                'cmp_id'   => $this->ctx->cmpId,
                'due_date' => $dueDate,
                'status'   => 'PENDING',
            ], 'run_id');
        }

        try {
            $transaction = (new TransactionService($this->ctx, $this->auth))->create('sale', [
                'party_account_id' => (int) $rule['customer_account_id'],
                'date'             => $dueDate,
                'narration'        => $rule['narration'],
                'lines'            => Db::jsonColumn($rule['template_lines']),
            ]);
        } catch (\Throwable $e) {
            Db::update('billing_recurring_runs', [
                'status'     => 'FAILED',
                'last_error' => mb_substr($e->getMessage(), 0, 480),
                'ran_at'     => self::now(),
            ], ['rule_id' => $ruleId, 'due_date' => $dueDate]);

            throw $e;
        }

        Db::transaction(function () use ($ruleId, $dueDate, $transaction, $rule) {
            Db::update('billing_recurring_runs', [
                'status'             => 'POSTED',
                'books_voucher_id'   => $transaction['books_voucher_id'],
                'books_voucher_uuid' => $transaction['books_voucher_uuid'],
                'books_voucher_no'   => $transaction['books_voucher_no'],
                'last_error'         => null,
                'ran_at'             => self::now(),
            ], ['rule_id' => $ruleId, 'due_date' => $dueDate]);

            $next = self::advance(
                $dueDate,
                (string) $rule['frequency'],
                $rule['interval_days'] === null ? null : (int) $rule['interval_days'],
                // The day the rule is really on, so a month-end bill stays at
                // month-end instead of drifting to the 28th after February.
                $rule['day_of_month'] === null ? (int) (new \DateTimeImmutable((string) $rule['start_date']))->format('j') : (int) $rule['day_of_month'],
            );
            $ended = $rule['end_date'] !== null && $next > (string) $rule['end_date'];

            Db::update('billing_recurring_rules', [
                'next_run_date'           => $ended ? $dueDate : $next,
                'status'                  => $ended ? 'ENDED' : 'ACTIVE',
                'last_run_at'             => self::now(),
                'last_books_voucher_uuid' => $transaction['books_voucher_uuid'],
                'updated_at'              => self::now(),
            ], ['rule_id' => $ruleId, 'cmp_id' => $this->ctx->cmpId]);
        });

        return $this->findRecurring($ruleId);
    }

    /** Rules whose next date has arrived — the "bill these now" list. */
    public function dueRecurring(?string $asOn = null): array
    {
        Permissions::assert($this->ctx, $this->auth, 'sale.view');

        return Db::all(
            "SELECT * FROM billing_recurring_rules
             WHERE cmp_id = :cmp AND status = 'ACTIVE' AND next_run_date <= :as_on
             ORDER BY next_run_date",
            ['cmp' => $this->ctx->cmpId, 'as_on' => $asOn ?? gmdate('Y-m-d')],
        );
    }

    /** @return array<string, mixed> */
    public function findRecurring(int $ruleId): array
    {
        $row = Db::first(
            'SELECT * FROM billing_recurring_rules WHERE rule_id = :id AND cmp_id = :cmp',
            ['id' => $ruleId, 'cmp' => $this->ctx->cmpId],
        );
        if ($row === null) {
            return [];
        }
        $row['runs'] = Db::all('SELECT * FROM billing_recurring_runs WHERE rule_id = :id ORDER BY due_date DESC LIMIT 24', ['id' => $ruleId]);

        return $row;
    }

    /** @return list<array<string, mixed>> */
    public function listRecurring(): array
    {
        return Db::all(
            'SELECT * FROM billing_recurring_rules WHERE cmp_id = :cmp ORDER BY status, next_run_date',
            ['cmp' => $this->ctx->cmpId],
        );
    }

    public function setRecurringStatus(int $ruleId, string $status): array
    {
        Permissions::assert($this->ctx, $this->auth, 'recurring.manage');

        if (!in_array($status, ['ACTIVE', 'PAUSED', 'ENDED'], true)) {
            Http::validationFailed('Status must be ACTIVE, PAUSED or ENDED.', ['field' => 'status']);
        }

        $updated = Db::update('billing_recurring_rules', ['status' => $status, 'updated_at' => self::now()], [
            'rule_id' => $ruleId, 'cmp_id' => $this->ctx->cmpId,
        ]);
        if ($updated === 0) {
            Http::notFound('That recurring bill does not exist.');
        }

        Audit::record($this->ctx, $this->auth, 'recurring.' . strtolower($status), 'recurring_rule', $ruleId, null, ['status' => $status]);

        return $this->findRecurring($ruleId);
    }

    // -----------------------------------------------------------------------
    // Payment reminders
    // -----------------------------------------------------------------------

    /** @param array<string, mixed> $input */
    public function createReminderRule(array $input): array
    {
        Permissions::assert($this->ctx, $this->auth, 'recurring.manage');

        $name = self::text($input['rule_name'] ?? null);
        if ($name === null) {
            Http::validationFailed('Give this reminder a name.', ['field' => 'rule_name']);
        }

        $channel = self::text($input['channel'] ?? null) ?? 'email';
        if (!in_array($channel, ['email', 'whatsapp', 'sms'], true)) {
            Http::validationFailed('Reminders go by email, WhatsApp or SMS.', ['field' => 'channel']);
        }

        $ruleId = (int) Db::insert('billing_reminder_rules', [
            'cmp_id'           => $this->ctx->cmpId,
            'rule_name'        => $name,
            'offset_days'      => (int) ($input['offset_days'] ?? 0),
            'repeat_days'      => max(0, (int) ($input['repeat_days'] ?? 0)),
            'max_reminders'    => max(1, (int) ($input['max_reminders'] ?? 3)),
            'channel'          => $channel,
            'message_template' => self::text($input['message_template'] ?? null),
            'minimum_amount'   => round((float) ($input['minimum_amount'] ?? 0), 4),
        ], 'rule_id');

        Audit::record($this->ctx, $this->auth, 'reminder_rule.created', 'reminder_rule', $ruleId, null, ['rule_name' => $name]);

        return Db::first('SELECT * FROM billing_reminder_rules WHERE rule_id = :id', ['id' => $ruleId]) ?? [];
    }

    /** @return list<array<string, mixed>> */
    public function listReminderRules(): array
    {
        return Db::all('SELECT * FROM billing_reminder_rules WHERE cmp_id = :cmp ORDER BY offset_days', ['cmp' => $this->ctx->cmpId]);
    }

    /**
     * Who should be chased today, per a rule.
     *
     * READS THE CURRENT OUTSTANDING FROM BOOKS. A bill that has been paid since
     * the rule last looked simply does not appear, because there is no stored
     * receivable to disagree with the accounts.
     *
     * @return array<string, mixed>
     */
    public function reminderCandidates(int $ruleId): array
    {
        Permissions::assert($this->ctx, $this->auth, 'reminder.send');

        $rule = Db::first(
            'SELECT * FROM billing_reminder_rules WHERE rule_id = :id AND cmp_id = :cmp',
            ['id' => $ruleId, 'cmp' => $this->ctx->cmpId],
        );
        if ($rule === null) {
            Http::notFound('That reminder does not exist.');
        }

        $dues = (new DuesService($this->ctx, $this->auth))->receivables();
        $offset = (int) $rule['offset_days'];
        $minimum = (float) $rule['minimum_amount'];
        $today = new \DateTimeImmutable('today');

        $candidates = [];
        foreach ($dues['bills'] as $bill) {
            if ($bill['balance'] < $minimum) {
                continue;
            }
            if ($bill['due_date'] === null) {
                continue;
            }

            try {
                $due = new \DateTimeImmutable($bill['due_date']);
            } catch (\Throwable) {
                continue;
            }

            // offset_days is relative to the due date: -3 means three days
            // before, +7 means a week after.
            $target = $due->modify(($offset >= 0 ? '+' : '') . $offset . ' days');
            if ($target->format('Y-m-d') > $today->format('Y-m-d')) {
                continue;
            }

            $alreadySent = (int) Db::scalar(
                "SELECT COUNT(*) FROM billing_reminder_log
                 WHERE cmp_id = :cmp AND rule_id = :rule AND books_voucher_uuid IS NOT DISTINCT FROM :uuid
                   AND status = 'SENT'",
                ['cmp' => $this->ctx->cmpId, 'rule' => $ruleId, 'uuid' => $bill['voucher_uuid']],
            );
            if ($alreadySent >= (int) $rule['max_reminders']) {
                continue;
            }

            $candidates[] = $bill + ['reminders_sent' => $alreadySent];
        }

        return [
            'rule'       => $rule,
            'candidates' => $candidates,
            'note'       => 'Worked out from Smart Books\' current outstanding. A bill paid since the last run is simply not here.',
        ];
    }

    /**
     * Record that a reminder went out.
     *
     * The message itself is sent by the shared AICOUNTLY messaging service; what
     * is kept here is WHAT WE TOLD THE CUSTOMER and when, which is worth having
     * when they ring up about it. It is not a balance this product maintains.
     *
     * @param array<string, mixed> $input
     */
    public function logReminder(int $ruleId, array $input): array
    {
        Permissions::assert($this->ctx, $this->auth, 'reminder.send');

        $customerId = (int) ($input['customer_account_id'] ?? 0);
        if ($customerId <= 0) {
            Http::validationFailed('Say which customer was reminded.', ['field' => 'customer_account_id']);
        }

        $logId = (int) Db::insert('billing_reminder_log', [
            'cmp_id'              => $this->ctx->cmpId,
            'rule_id'             => $ruleId,
            'customer_account_id' => $customerId,
            'books_voucher_uuid'  => self::text($input['books_voucher_uuid'] ?? null),
            'books_bill_no'       => self::text($input['bill_no'] ?? null),
            'amount_at_send'      => round((float) ($input['amount'] ?? 0), 4),
            'channel'             => self::text($input['channel'] ?? null) ?? 'email',
            'status'              => self::text($input['status'] ?? null) ?? 'SENT',
            'detail'              => self::text($input['detail'] ?? null),
        ], 'log_id');

        return Db::first('SELECT * FROM billing_reminder_log WHERE log_id = :id', ['id' => $logId]) ?? [];
    }

    // -----------------------------------------------------------------------

    /**
     * The next due date after this one.
     *
     * `$anchorDay` is the day of the month the rule is really on, which matters
     * for month-end billing. PHP's "+1 month" from 31 January lands on 3 March,
     * so the day has to be clamped — but clamping alone makes the rule DRIFT:
     * 31 Jan → 28 Feb → 28 Mar → 28 Apr, and a rent invoice that was always
     * raised on the last day of the month quietly moves to the 28th for ever.
     *
     * Passing the anchor keeps it: 31 Jan → 28 Feb → 31 Mar → 30 Apr, each
     * month clamped to that month's length and then forgotten.
     */
    public static function advance(string $from, string $frequency, ?int $intervalDays, ?int $anchorDay = null): string
    {
        $date = new \DateTimeImmutable($from);

        return match ($frequency) {
            'weekly'      => $date->modify('+1 week')->format('Y-m-d'),
            'monthly'     => self::addMonths($date, 1, $anchorDay),
            'quarterly'   => self::addMonths($date, 3, $anchorDay),
            'annual'      => $date->modify('+1 year')->format('Y-m-d'),
            'custom_days' => $date->modify('+' . max(1, (int) $intervalDays) . ' days')->format('Y-m-d'),
            default       => self::addMonths($date, 1, $anchorDay),
        };
    }

    private static function addMonths(\DateTimeImmutable $date, int $months, ?int $anchorDay = null): string
    {
        $day = $anchorDay !== null && $anchorDay >= 1 && $anchorDay <= 31
            ? $anchorDay
            : (int) $date->format('j');

        $firstOfTarget = $date->modify('first day of this month')->modify('+' . $months . ' months');
        $daysInTarget = (int) $firstOfTarget->format('t');

        return $firstOfTarget->setDate(
            (int) $firstOfTarget->format('Y'),
            (int) $firstOfTarget->format('n'),
            min($day, $daysInTarget),
        )->format('Y-m-d');
    }

    private static function id(mixed $value): ?int
    {
        return ($value === null || $value === '' || (int) $value === 0) ? null : (int) $value;
    }

    private static function text(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }

    private static function date(mixed $value): string
    {
        if (is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}$/', trim($value)) === 1) {
            return trim($value);
        }

        return gmdate('Y-m-d');
    }

    private static function now(): string
    {
        return gmdate('Y-m-d H:i:s');
    }
}
