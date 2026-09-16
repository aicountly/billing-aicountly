<?php

declare(strict_types=1);

/**
 * Integration tests for the Billing domain.
 *
 * Against a REAL PostgreSQL database and a stub standing in for Books and
 * Inventory.
 *
 *   server-php/tests/run.sh
 */

namespace Aicountly\Api;

require __DIR__ . '/../src/Env.php';
require __DIR__ . '/../src/Autoload.php';

Env::load(__DIR__ . '/../.env');

use Aicountly\Api\Domain\DuesService;
use Aicountly\Api\Domain\ScheduleService;
use Aicountly\Api\Domain\TransactionService;

$passed = 0;
$failed = 0;

function check(string $name, callable $fn): void
{
    global $passed, $failed;
    try {
        $fn();
        echo "  ok    {$name}\n";
        $passed++;
    } catch (\Throwable $e) {
        echo "  FAIL  {$name}\n        {$e->getMessage()}\n";
        if (getenv('VERBOSE')) {
            echo '        ' . $e->getFile() . ':' . $e->getLine() . "\n";
        }
        $failed++;
    }
}

function assertSame(mixed $expected, mixed $actual, string $what): void
{
    if ($expected !== $actual) {
        throw new \RuntimeException(sprintf('%s: expected %s, got %s', $what, var_export($expected, true), var_export($actual, true)));
    }
}

function assertTrue(bool $condition, string $what): void
{
    if (!$condition) {
        throw new \RuntimeException($what);
    }
}

function assertThrows(callable $fn, string $expectFragment, string $what): void
{
    try {
        $fn();
    } catch (\Throwable $e) {
        if ($expectFragment !== '' && !str_contains($e->getMessage(), $expectFragment)) {
            throw new \RuntimeException($what . ': wrong error — ' . $e->getMessage());
        }

        return;
    }
    throw new \RuntimeException($what . ': expected a failure, none was thrown');
}

function freshContext(int $cmpId = 55, int $fyId = 4, int $boId = 0): Context
{
    $r = new \ReflectionClass(Context::class);
    $ctx = $r->newInstanceWithoutConstructor();
    foreach (['cmpId' => $cmpId, 'fyId' => $fyId, 'boId' => $boId] as $prop => $value) {
        $p = $r->getProperty($prop);
        $p->setAccessible(true);
        $p->setValue($ctx, $value);
    }

    return $ctx;
}

function authFor(string $uuid = 'user-owner', ?int $acsType = 1): Auth
{
    $r = new \ReflectionClass(Auth::class);
    $auth = $r->newInstanceWithoutConstructor();
    foreach ([
        'uuid'      => $uuid,
        'kind'      => 'user',
        'sourceApp' => 'billing',
        'sesKey'    => 'stub-ses-key',
        'session'   => ['acs_type' => $acsType, 'name' => $uuid],
    ] as $prop => $value) {
        $p = $r->getProperty($prop);
        $p->setAccessible(true);
        $p->setValue($auth, $value);
    }

    return $auth;
}

/** A delegated user holding exactly the permissions of one shipped profile. */
function userWithProfile(Context $ctx, string $uuid, string $templateKey): Auth
{
    Permissions::seed($ctx);
    $profileId = (int) Db::scalar(
        'SELECT profile_id FROM billing_profiles WHERE cmp_id = :cmp AND profile_code = :code',
        ['cmp' => $ctx->cmpId, 'code' => $templateKey],
    );
    Db::run(
        'INSERT INTO billing_profile_assignments (cmp_id, user_uuid, profile_id) VALUES (:cmp, :uuid, :profile)
         ON CONFLICT DO NOTHING',
        ['cmp' => $ctx->cmpId, 'uuid' => $uuid, 'profile' => $profileId],
    );

    return authFor($uuid, 0);
}

function resetDatabase(): void
{
    $tables = [
        'billing_reminder_log', 'billing_reminder_rules',
        'billing_recurring_runs', 'billing_recurring_rules',
        'billing_transaction_requests', 'billing_integration_commands',
        'billing_favourite_items', 'billing_saved_filters', 'billing_user_preferences',
        'billing_profile_assignments', 'billing_profiles', 'billing_settings',
    ];
    Db::connect()->exec('TRUNCATE ' . implode(', ', $tables) . ', billing_audit_log RESTART IDENTITY CASCADE');
    @unlink(sys_get_temp_dir() . '/stub-idempotency.json');
    @unlink(sys_get_temp_dir() . '/stub-requests.jsonl');
    @unlink(sys_get_temp_dir() . '/stub-documents.json');
    stubRecover();
}

function stubFail(string $pathFragment, int $status): void
{
    file_put_contents(sys_get_temp_dir() . '/stub-control.json', json_encode(['path' => $pathFragment, 'status' => $status]));
}

function stubRecover(): void
{
    @unlink(sys_get_temp_dir() . '/stub-control.json');
}

/** @return list<array<string, mixed>> */
function stubRequests(): array
{
    $log = sys_get_temp_dir() . '/stub-requests.jsonl';
    if (!is_file($log)) {
        return [];
    }
    $out = [];
    foreach (explode("\n", trim((string) file_get_contents($log))) as $line) {
        if ($line !== '') {
            $out[] = json_decode($line, true);
        }
    }

    return $out;
}

function saleInput(array $overrides = []): array
{
    return $overrides + [
        'party_account_id' => 501,
        'date'             => '2026-09-14',
        'lines' => [
            ['item_id' => 301, 'unit_id' => 1, 'qty' => 5, 'rate' => 120],
            ['item_id' => 302, 'unit_id' => 1, 'qty' => 2, 'rate' => 450],
        ],
    ];
}

// ---------------------------------------------------------------------------

$ctx = freshContext();
$auth = authFor();

echo "\nRecording transactions\n";

check('a sale goes to Books and only the voucher reference is kept', function () use ($ctx, $auth) {
    resetDatabase();
    $sale = (new TransactionService($ctx, $auth))->create('sale', saleInput());

    assertSame('POSTED', $sale['status'], 'status');
    assertTrue($sale['books_voucher_id'] !== null, 'the Books voucher id was kept');
    assertTrue($sale['books_voucher_no'] !== null, 'and its number');

    // What Billing holds is a request and a reference — never a voucher.
    $columns = Db::all(
        "SELECT column_name FROM information_schema.columns
         WHERE table_name = 'billing_transaction_requests'
           AND column_name IN ('amount', 'total_amount', 'tax_amount', 'balance')",
    );
    assertSame(0, count($columns), 'no amount or tax column exists on the request row');
});

check('each transaction kind reaches the right Books voucher type', function () use ($ctx, $auth) {
    resetDatabase();
    $service = new TransactionService($ctx, $auth);

    $service->create('sale', saleInput());
    $service->create('receipt', [
        'party_account_id' => 501, 'amount' => 600, 'cash_bank_account_id' => 9001, 'payment_mode' => 'cash',
    ]);
    $service->create('bank_deposit', ['amount' => 5000, 'from_account_id' => 9001, 'to_account_id' => 9002]);

    $types = [];
    foreach (stubRequests() as $request) {
        if (str_contains($request['path'], '/vouchers/drafts') && !str_contains($request['path'], '/post')) {
            $types[] = $request['body']['vch_type_id'] ?? null;
        }
    }

    assertTrue(in_array(18, $types, true), 'a sale is voucher type 18');
    assertTrue(in_array(13, $types, true), 'a receipt is voucher type 13');
    assertTrue(in_array(1, $types, true), 'a bank deposit is a contra, voucher type 1');
});

check('Billing computes no tax — Books is sent the lines and decides', function () use ($ctx, $auth) {
    resetDatabase();
    (new TransactionService($ctx, $auth))->create('sale', saleInput());

    $draft = null;
    foreach (stubRequests() as $request) {
        if (str_contains($request['path'], '/vouchers/drafts') && !str_contains($request['path'], '/post')) {
            $draft = $request['body']['payload'] ?? [];
            break;
        }
    }

    assertTrue($draft !== null, 'a draft was sent');
    foreach (['tax_amount', 'cgst', 'sgst', 'igst', 'total_amount', 'round_off'] as $forbidden) {
        assertTrue(!array_key_exists($forbidden, $draft), "the payload must not carry {$forbidden}");
    }
    assertTrue(isset($draft['inventory_lines']), 'the lines are sent');
});

check('an unreachable Books leaves the entry retryable and says no duplicate exists', function () use ($ctx, $auth) {
    resetDatabase();
    stubFail('vouchers/drafts', 500);

    assertThrows(
        static fn () => (new TransactionService($ctx, $auth))->create('sale', saleInput()),
        'No duplicate has been created',
        'a sale during an outage',
    );

    stubRecover();

    $request = Db::first("SELECT * FROM billing_transaction_requests WHERE status = 'FAILED' ORDER BY request_id DESC LIMIT 1");
    assertTrue($request !== null, 'the request row survived');

    $command = Db::first('SELECT * FROM billing_integration_commands ORDER BY command_id DESC LIMIT 1');
    assertSame('FAILED', $command['status'], 'FAILED, so it can be retried');
});

check('a retry reuses the original idempotency key, so one sale is one invoice', function () use ($ctx, $auth) {
    resetDatabase();
    stubFail('vouchers/drafts', 500);

    try {
        (new TransactionService($ctx, $auth))->create('sale', saleInput());
    } catch (\Throwable) {
        // Expected — the point is what happens next.
    }

    stubRecover();

    $requestId = (int) Db::scalar("SELECT request_id FROM billing_transaction_requests WHERE status = 'FAILED' ORDER BY request_id DESC LIMIT 1");
    $firstKey = Db::scalar('SELECT idempotency_key FROM billing_integration_commands ORDER BY command_id DESC LIMIT 1');

    $posted = (new TransactionService($ctx, $auth))->post($requestId);
    assertSame('POSTED', $posted['status'], 'the retry succeeded');

    $secondKey = Db::scalar('SELECT idempotency_key FROM billing_integration_commands ORDER BY command_id DESC LIMIT 1');
    assertSame($firstKey, $secondKey, 'the key survived the retry');

    assertSame(1, (int) Db::scalar('SELECT COUNT(*) FROM billing_transaction_requests'), 'one request, not two');
});

check('posting an already-posted transaction is refused', function () use ($ctx, $auth) {
    resetDatabase();
    $service = new TransactionService($ctx, $auth);
    $sale = $service->create('sale', saleInput());

    assertThrows(
        static fn () => $service->post((int) $sale['request_id']),
        'already been recorded',
        'double post',
    );
});

check('a receipt cannot allocate more than was received', function () use ($ctx, $auth) {
    resetDatabase();
    assertThrows(
        static fn () => (new TransactionService($ctx, $auth))->create('receipt', [
            'party_account_id'     => 501,
            'amount'               => 1000,
            'cash_bank_account_id' => 9001,
            'allocations' => [
                ['bill_no' => 'INV/0001', 'amount' => 800],
                ['bill_no' => 'INV/0002', 'amount' => 500],
            ],
        ]),
        'You have allocated',
        'over-allocation',
    );
});

check('a receipt with no cash or bank account is refused in plain language', function () use ($ctx, $auth) {
    resetDatabase();
    assertThrows(
        static fn () => (new TransactionService($ctx, $auth))->create('receipt', ['party_account_id' => 501, 'amount' => 100]),
        'where the money was received',
        'receipt without an account',
    );
});

check('money cannot be moved between the same account twice', function () use ($ctx, $auth) {
    resetDatabase();
    assertThrows(
        static fn () => (new TransactionService($ctx, $auth))->create('bank_deposit', [
            'amount' => 100, 'from_account_id' => 9001, 'to_account_id' => 9001,
        ]),
        'two different accounts',
        'same-account contra',
    );
});

echo "\nBilling profiles\n";

check('the shipped profiles are created on first use', function () use ($ctx) {
    resetDatabase();
    Permissions::seed($ctx);

    $codes = array_column(Db::all('SELECT profile_code FROM billing_profiles WHERE cmp_id = :cmp', ['cmp' => $ctx->cmpId]), 'profile_code');
    foreach (['biller', 'sales_biller', 'purchase_operator', 'cashier', 'collection', 'owner'] as $expected) {
        assertTrue(in_array($expected, $codes, true), "the {$expected} profile exists");
    }
});

check('a BILLER can make a bill', function () use ($ctx) {
    resetDatabase();
    $biller = userWithProfile($ctx, 'counter-ravi', 'biller');
    $sale = (new TransactionService($ctx, $biller))->create('sale', saleInput());

    assertSame('POSTED', $sale['status'], 'the bill was raised');
});

check('a BILLER cannot see cost, record a purchase, or see the bank', function () use ($ctx) {
    resetDatabase();
    $biller = userWithProfile($ctx, 'counter-ravi', 'biller');

    assertTrue(!Permissions::allows($ctx, $biller, 'cost.view'), 'no cost.view');
    assertTrue(!Permissions::allows($ctx, $biller, 'profit.view'), 'no profit.view');
    assertTrue(!Permissions::allows($ctx, $biller, 'bank.view'), 'no bank.view');
    assertTrue(!Permissions::allows($ctx, $biller, 'payable.view'), 'no payable.view');

    assertThrows(
        static fn () => (new TransactionService($ctx, $biller))->create('purchase', [
            'party_account_id' => 601, 'lines' => [['item_id' => 301, 'qty' => 1, 'rate' => 10]],
        ]),
        'cannot record a purchase',
        'a biller recording a purchase',
    );

    assertThrows(
        static fn () => (new DuesService($ctx, $biller))->payables(),
        'cannot see money to pay',
        'a biller reading payables',
    );
});

check('the permission check is in the service, not the screen', function () use ($ctx) {
    resetDatabase();
    $biller = userWithProfile($ctx, 'counter-ravi', 'biller');

    // The UI would not offer a discount field. Calling the API directly is what
    // the control has to survive, and this is that call.
    assertThrows(
        static fn () => (new TransactionService($ctx, $biller))->create('sale', saleInput([
            'lines' => [['item_id' => 301, 'qty' => 1, 'rate' => 100, 'discount_pc' => 40]],
        ])),
        'cannot give a discount',
        'a biller discounting through the API',
    );
});

check('a CASHIER can move money but not record a purchase', function () use ($ctx) {
    resetDatabase();
    $cashier = userWithProfile($ctx, 'cash-meena', 'cashier');

    $contra = (new TransactionService($ctx, $cashier))->create('bank_deposit', [
        'amount' => 5000, 'from_account_id' => 9001, 'to_account_id' => 9002,
    ]);
    assertSame('POSTED', $contra['status'], 'the deposit went through');

    assertTrue(!Permissions::allows($ctx, $cashier, 'purchase.create'), 'no purchase.create');
});

check('a COLLECTION user sees receivables but not payables', function () use ($ctx) {
    resetDatabase();
    $collector = userWithProfile($ctx, 'collect-arun', 'collection');

    assertTrue(Permissions::allows($ctx, $collector, 'receivable.view'), 'receivables yes');
    assertTrue(!Permissions::allows($ctx, $collector, 'payable.view'), 'payables no');
    assertTrue(!Permissions::allows($ctx, $collector, 'cost.view'), 'cost no');
});

echo "\nDues, read live from Books\n";

check('receivables are aged from the due date and totalled', function () use ($ctx, $auth) {
    resetDatabase();
    $dues = (new DuesService($ctx, $auth))->receivables();

    // The stub returns one bill of 120000 due 2026-08-31, which is overdue.
    assertSame(120000.0, $dues['total'], 'total');
    assertSame(120000.0, $dues['overdue'], 'overdue');
    assertSame('books', $dues['source'], 'and it says where it came from');
    assertTrue(count($dues['bills']) === 1, 'the bill is listed');
    assertTrue($dues['bills'][0]['days_overdue'] > 0, 'with its age');
});

check('an unreachable Books is reported, not shown as zero', function () use ($ctx, $auth) {
    resetDatabase();
    stubFail('bill-by-bill', 500);

    assertThrows(
        static fn () => (new DuesService($ctx, $auth))->receivables(),
        'Could not reach Smart Books',
        'receivables during an outage',
    );

    stubRecover();
});

echo "\nRecurring bills and reminders\n";

check('a recurring rule raises a real Books invoice, not a Billing one', function () use ($ctx, $auth) {
    resetDatabase();
    $schedule = new ScheduleService($ctx, $auth);

    $rule = $schedule->createRecurring([
        'rule_name'           => 'Monthly rent',
        'customer_account_id' => 501,
        'frequency'           => 'monthly',
        'start_date'          => '2026-09-01',
        'template_lines'      => [['item_id' => 301, 'qty' => 1, 'rate' => 25000]],
    ]);

    $after = $schedule->runRecurring((int) $rule['rule_id']);

    assertSame('POSTED', $after['runs'][0]['status'], 'the run posted');
    assertTrue($after['runs'][0]['books_voucher_uuid'] !== null, 'and it has a Books voucher');
    assertSame('2026-10-01', $after['next_run_date'], 'the next date advanced a month');
});

check('the same occurrence cannot be billed twice', function () use ($ctx, $auth) {
    resetDatabase();
    $schedule = new ScheduleService($ctx, $auth);
    $rule = $schedule->createRecurring([
        'rule_name' => 'Monthly rent', 'customer_account_id' => 501,
        'start_date' => '2026-09-01', 'template_lines' => [['item_id' => 301, 'qty' => 1, 'rate' => 25000]],
    ]);

    $schedule->runRecurring((int) $rule['rule_id'], '2026-09-01');

    assertThrows(
        static fn () => $schedule->runRecurring((int) $rule['rule_id'], '2026-09-01'),
        'already been raised',
        'billing the same month twice',
    );
});

check('month-end billing neither skips a month nor drifts off month-end', function () {
    // PHP's "+1 month" from 31 January lands on 3 March, which would skip a
    // month's rent entirely. Clamping fixes that but introduces drift: without
    // an anchor the rule walks 31 Jan → 28 Feb → 28 Mar → 28 Apr and never
    // returns to month-end.
    assertSame('2026-02-28', ScheduleService::advance('2026-01-31', 'monthly', null, 31), 'Jan 31 → Feb 28');
    assertSame('2026-03-31', ScheduleService::advance('2026-02-28', 'monthly', null, 31), 'Feb 28 → Mar 31, back to month-end');
    assertSame('2026-04-30', ScheduleService::advance('2026-03-31', 'monthly', null, 31), 'Mar 31 → Apr 30');

    // A rule genuinely on the 15th stays on the 15th.
    assertSame('2026-02-15', ScheduleService::advance('2026-01-15', 'monthly', null, 15), 'the 15th stays the 15th');

    // Quarterly and weekly are unaffected.
    assertSame('2026-04-15', ScheduleService::advance('2026-01-15', 'quarterly', null, 15), 'quarterly');
    assertSame('2026-01-22', ScheduleService::advance('2026-01-15', 'weekly', null), 'weekly');
});

check('a month-end recurring rule stays on month-end across three runs', function () use ($ctx, $auth) {
    resetDatabase();
    $schedule = new ScheduleService($ctx, $auth);
    $rule = $schedule->createRecurring([
        'rule_name'           => 'Month-end rent',
        'customer_account_id' => 501,
        'frequency'           => 'monthly',
        'start_date'          => '2026-01-31',
        'day_of_month'        => 31,
        'template_lines'      => [['item_id' => 301, 'qty' => 1, 'rate' => 25000]],
    ]);
    $ruleId = (int) $rule['rule_id'];

    $after = $schedule->runRecurring($ruleId, '2026-01-31');
    assertSame('2026-02-28', $after['next_run_date'], 'February is clamped');

    $after = $schedule->runRecurring($ruleId, '2026-02-28');
    assertSame('2026-03-31', $after['next_run_date'], 'March returns to month-end');
});

check('a recurring rule ends when it passes its end date', function () use ($ctx, $auth) {
    resetDatabase();
    $schedule = new ScheduleService($ctx, $auth);
    $rule = $schedule->createRecurring([
        'rule_name' => 'Two months only', 'customer_account_id' => 501,
        'start_date' => '2026-09-01', 'end_date' => '2026-09-15',
        'template_lines' => [['item_id' => 301, 'qty' => 1, 'rate' => 1000]],
    ]);

    $after = $schedule->runRecurring((int) $rule['rule_id'], '2026-09-01');
    assertSame('ENDED', $after['status'], 'the next date would be past the end date, so it ended');
});

check('reminder candidates come from the live outstanding', function () use ($ctx, $auth) {
    resetDatabase();
    $schedule = new ScheduleService($ctx, $auth);

    $rule = $schedule->createReminderRule([
        'rule_name' => 'Chase a week late', 'offset_days' => 7, 'channel' => 'email',
    ]);

    $result = $schedule->reminderCandidates((int) $rule['rule_id']);
    assertTrue(count($result['candidates']) === 1, 'the overdue bill is a candidate');
    assertTrue(str_contains($result['note'], 'Smart Books'), 'and the note says where it came from');
});

check('a reminder rule with a minimum skips small bills', function () use ($ctx, $auth) {
    resetDatabase();
    $schedule = new ScheduleService($ctx, $auth);
    $rule = $schedule->createReminderRule([
        'rule_name' => 'Big ones only', 'offset_days' => 7, 'minimum_amount' => 500000,
    ]);

    $result = $schedule->reminderCandidates((int) $rule['rule_id']);
    assertSame(0, count($result['candidates']), 'the 120000 bill is below the minimum');
});

echo "\nData ownership (release-blocking)\n";

check('no table holds a voucher, ledger, balance, item or party', function () {
    $forbidden = Db::all(
        "SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public'
           AND (table_name LIKE '%voucher%' OR table_name LIKE '%ledger%'
                OR table_name LIKE '%receivable%' OR table_name LIKE '%payable%'
                OR table_name LIKE '%invoice%' OR table_name LIKE '%stock%'
                OR table_name LIKE '%item_master%' OR table_name = 'billing_items'
                OR table_name LIKE '%customer_master%' OR table_name LIKE '%supplier_master%'
                OR table_name LIKE '%mirror%' OR table_name LIKE '%_cache')",
    );
    assertSame(0, count($forbidden), 'forbidden tables exist: ' . json_encode($forbidden));
});

check('no column caches a remote balance, name or valuation', function () {
    $suspicious = Db::all(
        "SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = 'public'
           AND (column_name IN ('outstanding', 'balance', 'closing_balance', 'receivable_balance',
                                'payable_balance', 'item_name', 'party_name', 'stock_qty',
                                'valuation_rate', 'cost_rate', 'last_synced_at', 'synced_at')
                OR column_name LIKE 'sync%')",
    );
    assertSame(0, count($suspicious), 'cached remote fields exist: ' . json_encode($suspicious));
});

check('the one amount column that exists is a record of what we told a customer', function () {
    // billing_reminder_log.amount_at_send. It is a record of a message that was
    // sent, not a balance this product maintains, and nothing reads it back as
    // one — the reminder screen re-reads Books every time.
    $amounts = Db::all(
        "SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND data_type = 'numeric'
           AND table_name NOT IN ('billing_recurring_rules', 'billing_reminder_rules')",
    );
    foreach ($amounts as $column) {
        assertTrue(
            $column['table_name'] === 'billing_reminder_log' && $column['column_name'] === 'amount_at_send',
            "unexpected numeric column {$column['table_name']}.{$column['column_name']}",
        );
    }
});

check('the audit log refuses UPDATE and DELETE', function () {
    Db::run(
        'INSERT INTO billing_audit_log (cmp_id, fy_id, actor_uuid, actor_kind, source_app, action, entity_type)
         VALUES (55, 4, :u, :k, :a, :act, :e)',
        ['u' => 'tester', 'k' => 'user', 'a' => 'billing', 'act' => 'test', 'e' => 'transaction_request'],
    );
    assertThrows(static fn () => Db::run("UPDATE billing_audit_log SET action = 'tampered'"), 'append-only', 'audit UPDATE');
    assertThrows(static fn () => Db::run('DELETE FROM billing_audit_log'), 'append-only', 'audit DELETE');
});

echo "\nTenant isolation\n";

check('a query for another company returns nothing', function () use ($ctx, $auth) {
    resetDatabase();
    (new TransactionService($ctx, $auth))->create('sale', saleInput());

    $other = freshContext(999);
    assertSame(0, count((new TransactionService($other, $auth))->unfinished()), 'company 999 sees nothing');
    assertSame(
        0,
        (int) Db::scalar('SELECT COUNT(*) FROM billing_transaction_requests WHERE cmp_id = 999'),
        'and there is nothing there to see',
    );
});

echo "\n" . str_repeat('-', 60) . "\n";
echo "{$passed} passed, {$failed} failed\n";
exit($failed === 0 ? 0 : 1);
