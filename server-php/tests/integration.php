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

use Aicountly\Api\Domain\BillerDeskService;
use Aicountly\Api\Domain\CollectionsService;
use Aicountly\Api\Domain\ComplianceService;
use Aicountly\Api\Domain\DocumentCapture;
use Aicountly\Api\Domain\CreditNoteContext;
use Aicountly\Api\Domain\DuesService;
use Aicountly\Api\Domain\ExpenseHistory;
use Aicountly\Api\Domain\Metric;
use Aicountly\Api\Domain\MoneyActivityService;
use Aicountly\Api\Domain\OverviewService;
use Aicountly\Api\Domain\Period;
use Aicountly\Api\Domain\RegisterReader;
use Aicountly\Api\Domain\ReportService;
use Aicountly\Api\Domain\SupplierDuesService;
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
    // Both memos are per-request in production. Across a suite in one process
    // they would carry a previous case's answer into the next one.
    Context::forgetAccess();
    Permissions::forget();

    $tables = [
        'billing_reminder_log', 'billing_reminder_rules',
        'billing_recurring_runs', 'billing_recurring_rules',
        'billing_transaction_requests', 'billing_integration_commands',
        'billing_favourite_items', 'billing_saved_filters', 'billing_user_preferences',
        'billing_profile_assignments', 'billing_profiles', 'billing_settings',
        'billing_payment_promises', 'billing_day_close_checks',
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

echo "\nWho owns this company\n";

check('the portal session cannot say who owns a company, and Manage can', function () {
    // The bug this closes: ownership was read from the PORTAL session, which
    // validates a ses_key and knows nothing about companies. `acs_type` is
    // simply absent from that response, so every user resolved as delegated,
    // held no permissions, and saw a menu with two entries on it.
    assertSame(1, ManageAccess::resolve(['acs_type' => 1]), 'an explicit owner');
    assertSame(0, ManageAccess::resolve(['acs_type' => 0]), 'an explicit delegate');
    assertSame(1, ManageAccess::resolve(['ownership' => 'owner']), 'the label');
    assertSame(0, ManageAccess::resolve(['ownership' => 'shared']), 'and its opposite');
    assertSame(0, ManageAccess::resolve(['ownership' => 'Delegated']), 'whatever its case');
    assertSame(1, ManageAccess::resolve(['is_creator' => true]), 'the oldest signal of the three');
    assertSame(null, ManageAccess::resolve(['cmp_id' => 55]), 'and silence is not a no — it is unknown');

    // Order matters: acs_type wins over the label, the label over is_creator.
    assertSame(0, ManageAccess::resolve(['acs_type' => 0, 'ownership' => 'owner']), 'acs_type beats the label');
    assertSame(0, ManageAccess::resolve(['ownership' => 'shared', 'is_creator' => true]), 'the label beats is_creator');
});

check('an owner holds every permission without a Billing profile', function () {
    // The real-world case: somebody creates a company in Manage and opens
    // Billing for the first time. There is no profile assigned to them yet, and
    // there cannot be — assigning one needs access.manage, which is what they
    // are trying to get. If ownership does not resolve, there is no way in.
    Context::forgetAccess();
    Permissions::forget();
    resetDatabase();

    $owner = freshContext(61);          // the stub calls 61 an owner
    $auth = authFor('fresh-owner', null); // and the portal said nothing at all

    assertSame(null, $auth->accessType(), 'the session carries no acs_type, as in production');
    assertTrue($owner->isOwner($auth), 'Manage says owner, so they are one here');
    assertTrue(Permissions::allows($owner, $auth, 'cost.view'), 'and they hold everything');
    assertTrue(Permissions::allows($owner, $auth, 'access.manage'), 'including the one that lets them assign profiles');
    assertSame(count(Permissions::all()), count(Permissions::granted($owner, $auth)), 'every permission in the catalog');
});

check('a delegated user with no profile holds nothing', function () {
    Context::forgetAccess();
    Permissions::forget();
    resetDatabase();

    $ctx62 = freshContext(62);          // the stub calls 62 shared
    $auth = authFor('delegate', null);

    assertTrue(!$ctx62->isOwner($auth), 'Manage says shared');
    assertSame([], Permissions::granted($ctx62, $auth), 'and nobody has given them a profile');
    assertThrows(
        static fn () => Permissions::assert($ctx62, $auth, 'sale.create'),
        'Billing profile',
        'a delegate with no profile raising a bill',
    );
});

check('ownership comes off the companies list when companyinfo is silent', function () {
    // companyinfo does not carry ownership — the browser's own parser reads it
    // off the LIST row, not that one. The resolution has to fall through, and
    // the stub is shaped to make it: its companyinfo never says.
    Context::forgetAccess();
    Permissions::forget();
    resetDatabase();

    foreach ([[63, true, 'acs_type on the list row'], [64, true, 'is_creator on the list row'], [65, false, 'acs_type 0 on the list row']] as [$cmpId, $expected, $what]) {
        Context::forgetAccess();
        Permissions::forget();
        $ctx = freshContext($cmpId);
        assertSame($expected, $ctx->isOwner(authFor('someone-' . $cmpId, null)), $what);
    }
});

check('a company Manage says nothing about falls back to the session, then closed', function () {
    Context::forgetAccess();
    Permissions::forget();
    resetDatabase();

    // 55 appears in the stub's list with no ownership fields at all.
    $ctx55 = freshContext(55);

    // Nothing anywhere: not an owner. Failing closed is the right way round —
    // a person wrongly shown as delegated sees too little and complains; one
    // wrongly shown as an owner sees the bank balance.
    assertTrue(!$ctx55->isOwner(authFor('nobody', null)), 'silence is not ownership');

    // A portal that does carry acs_type is still honoured.
    Context::forgetAccess();
    Permissions::forget();
    assertTrue($ctx55->isOwner(authFor('legacy-owner', 1)), 'a session that does say is believed');
});

check('an owner lands on the overview even with no profile row', function () {
    Context::forgetAccess();
    Permissions::forget();
    resetDatabase();

    $ctx61 = freshContext(61);
    $auth = authFor('fresh-owner', null);
    $granted = Permissions::granted($ctx61, $auth);

    assertSame('/dashboard/overview', Dashboards::landing($granted, $ctx61->isOwner($auth)), 'not /more');
    assertSame(5, count(Dashboards::permitted($granted, $ctx61->isOwner($auth))), 'all five tabs');
});

echo "\nThe five dashboards\n";

check('an owner lands on the overview and a biller on their own desk', function () use ($ctx) {
    resetDatabase();
    Permissions::seed($ctx);

    $owner = authFor('user-owner', 1);
    $biller = userWithProfile($ctx, 'user-biller', 'biller');

    assertSame(
        '/dashboard/overview',
        Dashboards::landing(Permissions::granted($ctx, $owner), true),
        'the owner starts on the business',
    );
    assertSame(
        '/dashboard/biller',
        Dashboards::landing(Permissions::granted($ctx, $biller), false),
        'the biller starts at the counter',
    );
});

check('a biller is refused the dashboards they cannot see, by the API and not the menu', function () use ($ctx) {
    resetDatabase();
    $biller = userWithProfile($ctx, 'user-biller', 'biller');

    // The tab bar does not offer them...
    $offered = array_column(Dashboards::permitted(Permissions::granted($ctx, $biller), false), 'key');
    assertSame(['biller'], $offered, 'only the biller desk is offered');

    // ...and neither does the API, which is the part that matters.
    foreach (['overview', 'receivables', 'payables', 'cash-compliance'] as $key) {
        assertThrows(
            static fn () => Dashboards::assert($ctx, $biller, $key),
            'not part of your Billing profile',
            'a biller typing /dashboard/' . $key,
        );
    }

    // And the one they may open, they may open.
    Dashboards::assert($ctx, $biller, 'biller');
});

check('the overview leaves out the cards a profile may not see, rather than greying them', function () use ($ctx) {
    resetDatabase();
    $biller = userWithProfile($ctx, 'user-biller', 'biller');

    $overview = (new OverviewService($ctx, $biller))->build(Period::resolve(['key' => 'month']));
    $ids = array_column($overview['metrics'], 'id');

    assertTrue(in_array('sales', $ids, true), 'a biller may see what they sold');
    foreach (['to_collect', 'to_pay', 'cash_bank'] as $hidden) {
        assertTrue(!in_array($hidden, $ids, true), $hidden . ' is absent, not shown as unavailable');
    }
});

check('an owner gets four cards, each saying what kind of number it is', function () use ($ctx, $auth) {
    resetDatabase();
    $overview = (new OverviewService($ctx, $auth))->build(Period::resolve(['key' => 'month']));

    $byId = [];
    foreach ($overview['metrics'] as $metric) {
        $byId[$metric['id']] = $metric;
    }

    assertSame(4, count($byId), 'four cards');
    assertSame(Metric::BASIS_PERIOD, $byId['sales']['basis'], 'sales is a movement');
    assertSame(Metric::BASIS_AS_OF, $byId['to_collect']['basis'], 'what is owed is a balance');
    assertSame(Metric::BASIS_AS_OF, $byId['cash_bank']['basis'], 'so is cash and bank');

    foreach ($byId as $id => $metric) {
        assertTrue($metric['definition'] !== '', $id . ' says what it counts');
    }
});

check('an unreachable Books makes a card unavailable, never zero', function () use ($ctx, $auth) {
    resetDatabase();
    stubFail('bill-by-bill', 500);

    $overview = (new OverviewService($ctx, $auth))->build(Period::resolve(['key' => 'month']));
    stubRecover();

    $collect = null;
    foreach ($overview['metrics'] as $metric) {
        if ($metric['id'] === 'to_collect') {
            $collect = $metric;
        }
    }

    assertTrue($collect !== null, 'the card is still drawn');
    assertSame('unavailable', $collect['status'], 'and says so');
    assertSame(null, $collect['value'], 'with no value at all — a zero here reads as a quiet day');

    // The other three were perfectly readable and must survive it.
    $ready = array_filter($overview['metrics'], static fn (array $m) => $m['status'] === 'ready');
    assertTrue(count($ready) >= 2, 'one dead service does not blank the whole screen');
});

check('a receipt in the period is collections, and is not called revenue', function () use ($ctx, $auth) {
    resetDatabase();
    $dashboard = (new CollectionsService($ctx, $auth))->build(Period::resolve(['from' => '2026-09-01', 'to' => '2026-09-30']));

    $collected = null;
    foreach ($dashboard['metrics'] as $metric) {
        if ($metric['id'] === 'collected') {
            $collected = $metric;
        }
    }

    assertTrue($collected !== null, 'the card exists');
    assertSame(50000.0, $collected['value'], 'the stub receipt');
    assertSame(Metric::BASIS_PERIOD, $collected['basis'], 'a movement, not a balance');
    assertTrue(str_contains($collected['definition'], 'not revenue'), 'and the wording says what it is not');
});

check('the ageing buckets add up to the total shown above them', function () use ($ctx, $auth) {
    resetDatabase();
    $dues = (new DuesService($ctx, $auth))->receivables();

    $sum = array_sum($dues['ageing']);
    assertTrue(abs($sum - $dues['total']) < 0.01, "buckets {$sum} against total {$dues['total']}");
    assertTrue($dues['ageing_reconciles'], 'and the service says so itself');
});

check('a bill with no due date gets its own bucket, not the healthy one', function () use ($ctx, $auth) {
    // Folding an undated bill into "not yet due" paints it green. It might be
    // months late and nobody would chase it.
    resetDatabase();
    $service = new \ReflectionClass(DuesService::class);
    $method = $service->getMethod('dues');
    $method->setAccessible(true);

    $rows = (new DuesService($ctx, $auth))->receivables();
    assertSame(0.0, $rows['ageing']['no_due_date'], 'the stub bill is dated, so the bucket is empty');
    assertTrue(array_key_exists('no_due_date', $rows['ageing']), 'but the bucket exists');
});

check('the priority queue names who to ring and the arithmetic behind it', function () use ($ctx, $auth) {
    resetDatabase();
    $dashboard = (new CollectionsService($ctx, $auth))->build(Period::resolve(['key' => 'month']));
    $priorities = $dashboard['panels']['priorities'];

    assertTrue($priorities !== null, 'the stub bill is overdue, so there is somebody to chase');
    $sum = 0.0;
    foreach ($priorities['accounts'] as $account) {
        $sum += $account['overdue'];
    }
    assertTrue(abs($sum - $priorities['amount']) < 0.01, 'the named accounts add up to the figure quoted');
    assertTrue(!str_contains(json_encode($priorities), 'confidence'), 'and no confidence score is invented');
});

check('a promise is a record of a conversation, judged against what Books says', function () use ($ctx, $auth) {
    resetDatabase();
    $promises = new \Aicountly\Api\Domain\PromiseService($ctx, $auth);
    $promises->record([
        'account_id' => 501, 'amount' => 25000, 'promised_date' => '2020-01-01', 'status' => 'CONFIRMED',
    ]);

    // Books still shows something outstanding, and the date has passed.
    $open = $promises->open('2026-09-16', [501 => ['account_name' => 'Northern Distributors', 'total' => 120000.0]]);
    assertSame(1, count($open), 'one promise');
    assertSame('PAST_DUE', $open[0]['standing'], 'the date went by and the money did not come');
    assertSame(25000.0, $open[0]['promised_amount'], 'what they said');
    assertSame(120000.0, $open[0]['still_outstanding'], 'and, separately, what Books says is left');

    // Books says nothing is left: the promise is settled, without this product
    // ever having written that down.
    $settled = $promises->open('2026-09-16', [501 => ['account_name' => 'Northern Distributors', 'total' => 0.0]]);
    assertSame('SETTLED', $settled[0]['standing'], 'settled because Books says so, not because we marked it');
});

check('a promise cannot be recorded without the permission for it', function () use ($ctx) {
    resetDatabase();
    $biller = userWithProfile($ctx, 'user-biller', 'biller');

    assertThrows(
        static fn () => (new \Aicountly\Api\Domain\PromiseService($ctx, $biller))->record([
            'account_id' => 501, 'amount' => 100, 'promised_date' => '2026-10-01',
        ]),
        'Billing profile',
        'a biller noting a promise',
    );
});

check('two bills that look like the same bill are flagged, and neither is blocked', function () use ($ctx, $auth) {
    resetDatabase();
    $dashboard = (new SupplierDuesService($ctx, $auth))->build(Period::resolve(['key' => 'month']));
    $review = $dashboard['panels']['review'];

    assertTrue($review['available'], 'the queue was read');
    $codes = [];
    foreach ($review['rows'] as $row) {
        foreach ($row['flags'] as $flag) {
            $codes[$flag['code']] = true;
        }
    }

    // MD-7812 and MD/7812 are the same number written two ways.
    assertTrue(isset($codes['duplicate_number']), 'the same bill number twice is caught through the punctuation');
    assertTrue(isset($codes['missing_bill_date']), 'and a bill with no date of its own is caught');

    // Four purchases in the stub. The clean one is not in the queue at all:
    // a bill with nothing wrong with it is recorded, not "awaiting review".
    assertSame(4, $review['examined'], 'all four were looked at');
    assertSame(3, count($review['rows']), 'and only the three with something odd are listed');

    $listed = array_column($review['rows'], 'bill_no');
    assertTrue(!in_array('AP-9021', $listed, true), 'the clean bill is absent');

    // Flagged, not blocked: the row carries the other document so a person can
    // compare them, and nothing is merged or refused automatically.
    foreach ($review['rows'] as $row) {
        if ($row['bill_no'] === 'MD-7812') {
            assertTrue(count($row['peer_bills']) > 0, 'the other bill is offered for comparison');
        }
    }
});

check('a bank deposit is counted as neither money in nor money out', function () use ($ctx, $auth) {
    // A cash deposit into the bank is not income and a withdrawal is not an
    // expense. Counting either would show a business that banked its takings on
    // the way in and spent them on the way out.
    resetDatabase();
    $dashboard = (new ComplianceService($ctx, $auth))->build(Period::resolve(['key' => 'today']), '2026-09-15');
    $movement = $dashboard['panels']['movement'];

    assertTrue($movement['available'], 'the day was read');
    assertSame(50000.0, $movement['in_total'], 'the receipt');
    assertSame(12000.0, $movement['out_total'], 'the payment');
    assertSame(40000.0, $movement['transferred']['amount'], 'and the contra, reported on its own');
    assertTrue(
        abs($movement['in_total'] - 50000.0) < 0.01 && abs($movement['out_total'] - 12000.0) < 0.01,
        'the 40,000 transfer is in neither total',
    );
});

check('ticking a day-close step records who looked and locks nothing', function () use ($ctx, $auth) {
    resetDatabase();
    $service = new ComplianceService($ctx, $auth);
    $service->setStep('2026-09-15', 'receipts_reviewed', true);

    $dashboard = $service->build(Period::resolve(['key' => 'today']), '2026-09-15');
    $steps = [];
    foreach ($dashboard['panels']['checklist']['steps'] as $step) {
        $steps[$step['key']] = $step;
    }

    assertTrue($steps['receipts_reviewed']['checked'], 'the tick stuck');
    assertSame($auth->uuid, $steps['receipts_reviewed']['checked_by'], 'and says who');
    assertTrue(!$steps['payments_reviewed']['checked'], 'the others are untouched');

    // Nothing anywhere claims a period was closed.
    assertTrue(
        str_contains($dashboard['panels']['checklist']['note'], 'closes no period'),
        'the screen says outright that it locks nothing',
    );

    $service->setStep('2026-09-15', 'receipts_reviewed', false);
    $after = $service->build(Period::resolve(['key' => 'today']), '2026-09-15');
    assertTrue(!$after['panels']['checklist']['steps'][0]['checked'], 'and it can be unticked');
});

check('an unknown day-close step is refused', function () use ($ctx, $auth) {
    resetDatabase();
    assertThrows(
        static fn () => (new ComplianceService($ctx, $auth))->setStep('2026-09-15', 'lock_the_books', true),
        'not a step',
        'a step nobody defined',
    );
});

check('the biller desk counts this biller\'s own work and nobody else\'s', function () use ($ctx) {
    resetDatabase();
    $biller = userWithProfile($ctx, 'user-biller', 'biller');
    $other = userWithProfile($ctx, 'user-other', 'biller');

    // The COMPANY's today, not the server's. Dating these with gmdate() made
    // this test pass for eighteen hours a day and fail for the other five and a
    // half: after 18:30 UTC it is already tomorrow in Asia/Kolkata, so the bill
    // was written on the 16th and the desk — correctly — counted the 17th.
    $period = Period::resolve(['key' => 'today']);
    $today = $period->today();

    (new TransactionService($ctx, $biller))->create('sale', saleInput(['date' => $today]));
    (new TransactionService($ctx, $other))->create('sale', saleInput(['date' => $today]));

    $desk = (new BillerDeskService($ctx, $biller))->build($period);
    $mine = null;
    foreach ($desk['metrics'] as $metric) {
        if ($metric['id'] === 'my_invoices_today') {
            $mine = $metric;
        }
    }

    assertSame(1, $mine['value'], 'one bill, mine — not the two on the counter');
    assertSame(Metric::BASIS_COUNT, $mine['basis'], 'and it is a count, not an amount');
});

echo "\nReading Books honestly\n";

check('a register that could not be read in full is not totalled', function () {
    // Summing a page and calling it a month is the easiest way to put a
    // confidently wrong figure in front of an owner: it looks plausible and is
    // short by whatever did not fit.
    $truncated = ['available' => true, 'complete' => false, 'rows' => [
        ['grand_total' => 100.0], ['grand_total' => 200.0],
    ]];
    assertSame(null, RegisterReader::total($truncated), 'no total from a partial read');
    assertSame(null, RegisterReader::daily($truncated, Period::resolve(['key' => 'month'])), 'and no chart either');

    $complete = ['available' => true, 'complete' => true, 'rows' => [
        ['grand_total' => 100.0], ['grand_total' => 200.0],
    ]];
    assertSame(300.0, RegisterReader::total($complete), 'a complete read does total');
});

check('a row with no readable amount stops the total rather than shortening it', function () {
    $reading = ['available' => true, 'complete' => true, 'rows' => [
        ['grand_total' => 100.0], ['voucher_no' => 'INV/2'],
    ]];
    assertSame(null, RegisterReader::total($reading), 'one unreadable row means no total');
});

check('a part-paid invoice never reads as paid', function () {
    $paid = \Aicountly\Api\Domain\BooksReadings::settlementStatus(['grand_total' => 1000.0, 'balance' => 0.0]);
    $part = \Aicountly\Api\Domain\BooksReadings::settlementStatus(['grand_total' => 1000.0, 'balance' => 400.0]);
    $none = \Aicountly\Api\Domain\BooksReadings::settlementStatus(['grand_total' => 1000.0, 'balance' => 1000.0]);
    $unknown = \Aicountly\Api\Domain\BooksReadings::settlementStatus(['voucher_no' => 'INV/1']);

    assertSame('PAID', $paid, 'settled');
    assertSame('PARTIALLY_PAID', $part, 'half of it is still owed and the badge says so');
    assertSame('UNPAID', $none, 'none of it paid');
    assertSame(null, $unknown, 'and an unreadable row shows no status rather than a guessed one');
});

check('an invoice\'s lines are read whatever Books calls them', function () {
    // Two deployments, two spellings, one set of lines. A credit note that
    // cannot start from the bill is a credit note somebody retypes off paper.
    $ours = CreditNoteContext::linesOf(['inventory_lines' => [[
        'source_line_ref' => '1', 'item_id' => 7, 'item_name' => 'Wireless Mouse', 'item_sku' => 'M221-BLK',
        'mc_id' => 3, 'batch_no' => 'BATCH-A1', 'qty' => 5, 'rate' => 850, 'discount_pc' => 0,
        'amount' => 4250, 'tax_cat_id' => 4, 'tax_rate' => 18,
    ]], 'service_lines' => [[
        'source_line_ref' => '2', 'description' => 'Installation', 'amount' => 500,
    ]]]);

    assertSame(2, count($ours), 'the goods line and the service line');
    assertSame('Wireless Mouse', $ours[0]['item_name'], 'the item');
    assertSame(3, $ours[0]['warehouse_id'], 'the warehouse it went out of');
    assertTrue($ours[0]['stockable'], 'goods can come back');
    assertTrue($ours[1]['stockable'] === false, 'a described charge never does');

    $theirs = CreditNoteContext::linesOf(['items' => [[
        'product_id' => 9, 'product_name' => 'USB-C Cable', 'code' => 'CB11-1M', 'quantity' => '3',
        'unit_price' => '450.00', 'discount_percent' => '5', 'line_amount' => '1282.50',
        'gst_rate' => '18', 'warehouse_id' => 2,
    ]]]);

    assertSame(1, count($theirs), 'the other spelling reads too');
    assertSame(3.0, $theirs[0]['qty'], 'quantity as a number, from a string');
    assertSame(18.0, $theirs[0]['tax_rate'], 'the rate Books had on the bill');
});

check('the accounting legs of a voucher are never read as goods', function () {
    // "Output CGST 9%" in a list of things coming back is the one mistake this
    // normaliser must not make, so those containers are not even looked at.
    $legs = CreditNoteContext::linesOf([
        'entries' => [['account_name' => 'Output CGST 9%', 'amount' => 382.5, 'dr_cr' => 'CR']],
        'ledger_entries' => [['account_name' => 'Sales', 'amount' => 4250]],
    ]);
    assertSame(0, count($legs), 'no lines from the ledger side of the voucher');

    $unknown = CreditNoteContext::linesOf(['something_else' => [['foo' => 'bar']]]);
    assertSame(0, count($unknown), 'and none from a shape we do not recognise');
});

check('a comparison against nothing is refused, and a rise is not always good', function () {
    $noBase = Metric::compare(1000.0, 0.0, 'last month', riseIsGood: true);
    assertTrue($noBase['available'] === false, 'dividing by nothing gives no percentage');
    assertSame('No comparison available', $noBase['label'], 'and it says so instead of inventing one');

    $salesUp = Metric::compare(110.0, 100.0, 'last month', riseIsGood: true);
    assertSame('positive', $salesUp['tone'], 'more sales is good news');

    $overdueUp = Metric::compare(110.0, 100.0, 'last month', riseIsGood: false);
    assertSame('warning', $overdueUp['tone'], 'more overdue debt is not, and must not be painted green');
});

check('today is the company\'s today, not the server\'s', function () {
    $india = Period::resolve(['key' => 'today'], 'Asia/Kolkata');
    $pacific = Period::resolve(['key' => 'today'], 'America/Los_Angeles');

    assertSame($india->from, $india->to, 'today is one day');
    assertTrue($india->timezone === 'Asia/Kolkata', 'and it is kept with the figure');
    // At most one calendar day apart, and often different — which is the point.
    $gap = abs((new \DateTimeImmutable($india->today()))->getTimestamp() - (new \DateTimeImmutable($pacific->today()))->getTimestamp());
    assertTrue($gap <= 86400, 'the two clocks differ by at most a day');

    $nonsense = Period::resolve(['key' => 'today'], 'Mars/Olympus_Mons');
    assertSame('Asia/Kolkata', $nonsense->timezone, 'a timezone PHP does not know falls back rather than failing');
});

check('a period compares against the same number of days before it', function () {
    $period = Period::resolve(['from' => '2026-09-01', 'to' => '2026-09-30']);
    assertSame(30, $period->days(), 'thirty days');
    assertSame('2026-08-02', $period->previousFrom, 'compared with the thirty before it');
    assertSame('2026-08-31', $period->previousTo, 'not with a 31-day August');
});

echo "\nReports and exports\n";

check('an export carries the whole filtered set, or refuses', function () use ($ctx, $auth) {
    resetDatabase();
    $report = (new ReportService($ctx, $auth))->run('sales_register', Period::resolve(['from' => '2026-09-01', 'to' => '2026-09-30']));

    assertSame(2, count($report['rows']), 'both stub invoices');
    assertTrue($report['complete'], 'and the read was complete');
    $csv = ReportService::toCsv($report);
    assertSame(4, count(array_filter(explode("\n", trim($csv)))), 'header, two rows, total');

    // A partial read must not produce a short file that looks whole.
    $report['complete'] = false;
    assertThrows(
        static fn () => ReportService::toCsv($report),
        'would give you a short file',
        'exporting a truncated report',
    );
});

check('a customer named like a formula exports as a name', function () use ($ctx, $auth) {
    resetDatabase();
    $report = (new ReportService($ctx, $auth))->run('sales_register', Period::resolve(['key' => 'month']));
    $report['rows'] = [
        ['document_no' => 'INV/9', 'date' => '2026-09-15', 'party' => '=cmd|\' /c calc\'!A1', 'amount' => 100.0, 'status' => 'PAID'],
        ['document_no' => 'INV/10', 'date' => '2026-09-15', 'party' => "\t@SUM(1+1)", 'amount' => 50.0, 'status' => 'PAID'],
    ];
    $report['complete'] = true;

    $csv = ReportService::toCsv($report);
    assertTrue(str_contains($csv, "'=cmd"), 'a leading = is neutralised');
    assertTrue(str_contains($csv, "'@SUM"), 'and so is a leading @ hidden behind a tab');
    assertTrue(!preg_match('/,=cmd/', $csv), 'nothing reaches the file as a live formula');
});

check('exporting needs its own permission, separate from reading', function () use ($ctx) {
    resetDatabase();
    // A profile may be trusted to look a balance up on screen and not to walk
    // out with the ledger.
    $collection = userWithProfile($ctx, 'user-collection', 'collection');
    assertTrue(
        !Permissions::allows($ctx, $collection, 'export.data'),
        'a collection user cannot export',
    );
    assertTrue(
        !Permissions::allows($ctx, $collection, 'reports.view'),
        'nor open the report screen',
    );
});

check('a biller cannot run a report about money they may not see', function () use ($ctx) {
    resetDatabase();
    $biller = userWithProfile($ctx, 'user-biller', 'biller');

    assertThrows(
        static fn () => (new ReportService($ctx, $biller))->run('payables_ageing', Period::resolve(['key' => 'month'])),
        'Billing profile',
        'a biller running the payables ageing',
    );
    assertThrows(
        static fn () => (new ReportService($ctx, $biller))->run('cash_bank_summary', Period::resolve(['key' => 'month'])),
        'does not show balances',
        'a biller running the cash summary',
    );
});

echo "\nThe expense screen\n";

check('recent expenses are this company\'s own posted ones, newest first, named live', function () use ($ctx, $auth) {
    resetDatabase();
    $service = new TransactionService($ctx, $auth);
    $service->create('expense', ['amount' => 2450, 'expense_account_id' => 810, 'cash_bank_account_id' => 101, 'date' => '2026-09-11', 'narration' => 'Office stationery']);
    $service->create('expense', ['amount' => 1320, 'expense_account_id' => 811, 'cash_bank_account_id' => 101, 'date' => '2026-09-15', 'narration' => 'Client meeting']);

    $recent = (new ExpenseHistory($ctx, $auth))->recent(5);

    assertSame(2, count($recent['rows']), 'both expenses come back');
    assertSame('2026-09-15', $recent['rows'][0]['date'], 'newest first');
    assertSame(1320.0, $recent['rows'][0]['amount'], 'the amount is what was recorded');
    // The NAME is Books', read on this request. Billing stores the id only.
    assertTrue($recent['names_available'], 'Books answered, so the heads are named');
    assertSame('Travel & Conveyance', $recent['rows'][0]['category_name'], 'the head is named from Books');
    assertSame('Cash in hand', $recent['rows'][0]['paid_from_name'], 'so is the account it came out of');
});

check('a sale is not an expense, and an unposted one is not history', function () use ($ctx, $auth) {
    resetDatabase();
    (new TransactionService($ctx, $auth))->create('sale', saleInput());

    stubFail('vouchers/drafts', 500);
    try {
        (new TransactionService($ctx, $auth))->create('expense', [
            'amount' => 700, 'expense_account_id' => 810, 'cash_bank_account_id' => 101, 'date' => '2026-09-16',
        ]);
    } catch (\Throwable) {
        // The point of the case: it did not reach Books.
    }
    stubRecover();

    assertSame([], (new ExpenseHistory($ctx, $auth))->recent(5)['rows'], 'neither one shows as a recorded expense');
});

check('another company\'s expenses are not in this one\'s list', function () use ($auth) {
    resetDatabase();
    $mine = freshContext(55);
    $theirs = freshContext(77);

    (new TransactionService($mine, $auth))->create('expense', ['amount' => 100, 'expense_account_id' => 810, 'cash_bank_account_id' => 101, 'date' => '2026-09-12']);
    (new TransactionService($theirs, $auth))->create('expense', ['amount' => 200, 'expense_account_id' => 810, 'cash_bank_account_id' => 101, 'date' => '2026-09-12']);

    $rows = (new ExpenseHistory($mine, $auth))->recent(5)['rows'];
    assertSame(1, count($rows), 'only this company\'s');
    assertSame(100.0, $rows[0]['amount'], 'and it is the right one');
});

check('Books being unreachable costs the chips, not the list', function () use ($ctx, $auth) {
    resetDatabase();
    (new TransactionService($ctx, $auth))->create('expense', [
        'amount' => 999, 'expense_account_id' => 810, 'cash_bank_account_id' => 101, 'date' => '2026-09-12', 'narration' => 'Internet bill',
    ]);

    stubFail('masters/accounts', 503);
    $recent = (new ExpenseHistory($ctx, $auth))->recent(5);
    stubRecover();

    assertSame(1, count($recent['rows']), 'the expense is still listed');
    assertSame(999.0, $recent['rows'][0]['amount'], 'with its amount');
    assertTrue($recent['names_available'] === false, 'and the screen is told the names are missing');
    assertSame(null, $recent['rows'][0]['category_name'], 'rather than being given a guess');
});

check('the expense carries the party, bill number and tax category it was given', function () use ($ctx, $auth) {
    resetDatabase();
    $expense = (new TransactionService($ctx, $auth))->create('expense', [
        'amount'               => 1250.5,
        'expense_account_id'   => 814,
        'cash_bank_account_id' => 102,
        'date'                 => '2026-09-18',
        'party_account_id'     => 605,
        'reference_no'         => 'INV-9001',
        'tax_cat_id'           => 1,
        'attachment_ref'       => 'Drive / bills / 2026-09',
        'narration'            => 'Quarterly audit fee',
    ]);

    $payload = Db::jsonColumn(Db::scalar(
        'SELECT payload FROM billing_transaction_requests WHERE request_id = :id',
        ['id' => $expense['request_id']],
    ));

    assertSame(605, $payload['party_acc_id'], 'the party goes with it');
    assertSame('INV-9001', $payload['reference_no'], 'so does the supplier\'s own bill number');
    assertSame(1, $payload['tax_cat_id'], 'and the tax category Books will apply');
    assertSame('Drive / bills / 2026-09', $payload['attachment_ref'], 'and where the bill is kept');
});

check('a bill file cannot be kept here, and the screen is told why', function () {
    $storage = DocumentCapture::storage();
    assertTrue($storage['available'] === false, 'there is nowhere to put it');
    assertTrue(is_string($storage['reason']) && $storage['reason'] !== '', 'and the reason says so in words');
    assertSame(['application/pdf', 'image/jpeg', 'image/png'], $storage['accepts'], 'what one would be, when there is');

    // No DOCUMENT_EXTRACTION_BASE in the test environment, so the reader is off
    // — with an explanation rather than a button that does nothing.
    $extraction = DocumentCapture::extraction();
    assertTrue($extraction['available'] === false, 'and no service reads one either');
    assertTrue(str_contains((string) $extraction['reason'], 'document-extraction'), 'named, so it can be turned on');
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

check('the only amounts stored are records of what somebody said', function () {
    // Two kinds of numeric column are allowed in this product, and the list is
    // spelled out one column at a time so that adding a third is a deliberate
    // act with a justification attached rather than a migration nobody queried.
    //
    // A RULE'S OWN TERMS — what a recurring bill is for, the floor below which
    // a reminder is not worth sending. Ours by definition: nothing else knows
    // the rule exists.
    //
    // A RECORD OF A CONVERSATION — what we told a customer was outstanding when
    // we chased them, and what they said back. Neither is a balance. Nothing
    // reads either one back as one: the reminder screen re-reads Books every
    // time, and a promise is judged by asking Books what is still owed.
    //
    // What remains forbidden is the thing this test exists for: a column that
    // holds a figure Books, Inventory or Manage owns, so that some screen can
    // render it without asking. That is a second source of truth, and it is
    // wrong the moment anybody posts anything anywhere else.
    $allowedTables = ['billing_recurring_rules', 'billing_reminder_rules'];
    $allowedColumns = [
        'billing_reminder_log.amount_at_send'      => 'what we told a customer they owed, when we told them',
        'billing_payment_promises.promised_amount' => 'what the customer said they would pay',
    ];

    $amounts = Db::all(
        "SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND data_type = 'numeric'",
    );

    foreach ($amounts as $column) {
        if (in_array($column['table_name'], $allowedTables, true)) {
            continue;
        }
        assertTrue(
            isset($allowedColumns[$column['table_name'] . '.' . $column['column_name']]),
            "unexpected numeric column {$column['table_name']}.{$column['column_name']}",
        );
    }
});

check('a promise to pay is never read back as a balance', function () {
    // The promise is ours; the outstanding is Books'. They are shown side by
    // side so that a promise which was not kept is visible AS one — which only
    // works while the two stay separate. If this ever fails, some screen has
    // started answering "how much do they owe" out of our own table.
    $sources = [
        __DIR__ . '/../src/Domain/PromiseService.php',
        __DIR__ . '/../src/Domain/CollectionsService.php',
    ];

    foreach ($sources as $file) {
        $code = (string) file_get_contents($file);
        assertTrue(
            !preg_match('/SUM\s*\(\s*promised_amount/i', $code),
            basename($file) . ' totals promised_amount as if it were a balance',
        );
    }

    // And the shape proves it: the outstanding beside a promise is a separate
    // field, fed from the Books reading rather than from the promise row.
    $service = new \ReflectionClass(\Aicountly\Api\Domain\PromiseService::class);
    $open = (string) file_get_contents($service->getFileName());
    assertTrue(str_contains($open, "'still_outstanding'"), 'the Books figure is carried separately');
    assertTrue(str_contains($open, "'promised_amount'"), 'and so is what they said');
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

echo "\nThe money screens\n";

/**
 * A payment as it exists after a real save: Books holds the voucher, and the
 * Billing row holds what the user typed. `books_voucher_id` is the stub payment
 * register's own row, which is what the join is being tested against.
 */
function paidEntry(Context $ctx, array $overrides = []): int
{
    return (int) Db::insert('billing_transaction_requests', [
        'cmp_id'           => $ctx->cmpId,
        'fy_id'            => $ctx->fyId,
        'bo_id'            => 0,
        'kind'             => 'payment',
        'status'           => 'POSTED',
        'party_account_id' => 601,
        'transaction_date' => '2026-09-15',
        'payload'          => [
            'cash_bank_account_id' => 9001,
            'payment_mode'         => 'upi',
            'instrument_no'        => 'UTR-77',
            'narration'            => 'Material payment',
        ] + $overrides,
        'books_voucher_id' => 4301,
        'created_by'       => 'user-owner',
    ], 'request_id');
}

check("the recent list is Books' register with Billing's own detail joined on", function () use ($ctx, $auth) {
    resetDatabase();
    paidEntry($ctx);

    $result = (new MoneyActivityService($ctx, $auth))->recent('out', Period::resolve(['key' => 'month']), 8);

    assertSame(1, count($result['rows']), 'one payment in the register');
    $row = $result['rows'][0];

    // Books' half.
    assertSame('Aarti Plastics', $row['party'], 'party comes from Books');
    assertSame(12000.0, $row['amount'], 'amount comes from Books');

    // Billing's half, which Books' register does not carry.
    assertSame('upi', $row['payment_mode'], 'mode comes from the Billing row');
    assertSame('UTR-77', $row['reference_no'], 'reference comes from the Billing row');
    assertSame('Material payment', $row['narration'], 'narration comes from the Billing row');
    assertSame(9001, $row['account_id'], 'paid-from comes from the Billing row');
    assertSame('user-owner', $row['created_by'], 'who keyed it comes from the Billing row');
    assertTrue($row['recorded_here'] === true, 'and it is marked as ours');
});

check('an entry made in Books shows with its detail empty, not missing', function () use ($ctx, $auth) {
    resetDatabase();
    // No Billing row at all: this payment was recorded in Books.
    $result = (new MoneyActivityService($ctx, $auth))->recent('out', Period::resolve(['key' => 'month']), 8);

    assertSame(1, count($result['rows']), 'it is still listed');
    $row = $result['rows'][0];
    assertSame(12000.0, $row['amount'], 'with the amount Books holds');
    assertSame(null, $row['payment_mode'], 'and no mode, because Billing never saw it');
    assertSame(null, $row['created_by'], 'and nobody here keyed it');
    assertTrue($row['recorded_here'] === false, 'and the row says so');
});

check('the summary totals, counts and averages the same set', function () use ($ctx, $auth) {
    resetDatabase();
    $summary = (new MoneyActivityService($ctx, $auth))->recent('out', Period::resolve(['key' => 'month']), 8)['summary'];

    assertTrue($summary['available'] === true, 'the register could be read');
    assertSame(12000.0, $summary['total'], 'total');
    assertSame(1, $summary['count'], 'count');
    assertSame(12000.0, $summary['average'], 'average is the total over the count');
    assertSame('Aarti Plastics', $summary['largest']['party'], 'the largest payment names its party');
});

check('a Billing row for another company is never joined on', function () use ($ctx, $auth) {
    resetDatabase();
    // Same Books voucher id, a different company's row. If the scope clause
    // were missing this would put one company's narration on another's screen.
    paidEntry(freshContext(999));

    $row = (new MoneyActivityService($ctx, $auth))->recent('out', Period::resolve(['key' => 'month']), 8)['rows'][0];
    assertSame(null, $row['narration'], 'company 55 sees none of 999\'s detail');
    assertTrue($row['recorded_here'] === false, 'and does not claim the entry');
});

check('money paid is refused to a profile that may only take money in', function () use ($ctx) {
    resetDatabase();
    $biller = userWithProfile($ctx, 'user-biller-money', 'biller');
    $service = new MoneyActivityService($ctx, $biller);

    assertThrows(
        static fn () => $service->recent('out', Period::resolve(['key' => 'month']), 8),
        'cannot',
        'a biller reading money paid',
    );

    // The same profile may read money received, which it is allowed to record.
    assertTrue(
        is_array($service->recent('in', Period::resolve(['key' => 'month']), 8)['rows']),
        'but money received is theirs to see',
    );
});

check('the party context answers for the party asked about and no other', function () use ($ctx, $auth) {
    resetDatabase();
    $service = new MoneyActivityService($ctx, $auth);

    $theirs = $service->partyContext('out', 601);
    assertSame(1, $theirs['entries_in_window'], 'one payment to this supplier in the window');
    assertSame('2026-09-15', $theirs['last']['date'], 'and it is the one Books returned');
    assertSame(180, $theirs['looked_back_days'], 'the window is stated, not implied');

    $nobody = $service->partyContext('out', 999999);
    assertSame(0, $nobody['entries_in_window'], 'a supplier with nothing gets nothing');
    assertSame(null, $nobody['last'], 'and no last payment is invented for them');
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
