<?php

declare(strict_types=1);

namespace Aicountly\Api;

/**
 * Billing profiles — this product's permissions, layered over the portal identity.
 *
 * The problem this solves, in the shopkeeper's words: "I want my counter staff
 * to make bills, but I don't want them seeing what I paid for the goods, what I
 * make on them, or what's in the bank."
 *
 * That is a Billing decision. Smart Books has its own permissions for its own
 * screens and neither replaces the other; a user may be allowed to raise a sale
 * here without being given the run of Books.
 *
 * ENFORCED IN THE BACKEND, on every route. Hiding a menu item in React tells the
 * user what they may do; it does not stop them, and the person who most wants to
 * see the margin they were not shown is exactly the person who will try the URL.
 */
final class Permissions
{
    public const TABLE_PROFILES    = 'billing_profiles';
    public const TABLE_ASSIGNMENTS = 'billing_profile_assignments';

    /** @var array<string, array<string, string>> */
    public const CATALOG = [
        // Which dashboard a person lands on, and whether they get one at all.
        // The biller holds `biller.desk` and NOT `overview.view`, which is the
        // whole point: the counter gets a till, the owner gets the business.
        'Dashboards' => [
            'overview.view'  => 'See the business overview',
            'biller.desk'    => 'Use the biller desk',
            'compliance.view' => 'Review document checks',
        ],
        'Selling' => [
            'sale.view'    => 'See bills',
            'sale.create'  => 'Make a bill',
            'sale.cancel'  => 'Cancel a bill',
            'quotation.create' => 'Make a quotation',
        ],
        'Buying' => [
            'purchase.view'   => 'See purchases',
            'purchase.create' => 'Record a purchase',
            'expense.create'  => 'Record an expense',
        ],
        'Money' => [
            'receipt.create' => 'Record money received',
            'payment.create' => 'Record money paid',
            'contra.create'  => 'Move money between cash and bank',
            'cash.view'      => 'See the cash balance',
            'bank.view'      => 'See the bank balance',
        ],
        'Dues' => [
            'receivable.view' => 'See money to collect',
            'payable.view'    => 'See money to pay',
            'statement.view'  => 'See a party statement',
            'reminder.send'   => 'Send a payment reminder',
            'promise.manage'  => 'Record what a customer promised to pay',
        ],
        'Notes' => [
            'credit_note.create' => 'Make a credit note',
            'debit_note.create'  => 'Make a debit note',
        ],
        'Statutory' => [
            'einvoice.generate' => 'Generate an e-Invoice',
            'eway.generate'     => 'Generate an e-Way Bill',
        ],
        'Sensitive' => [
            // The three a counter operator must not hold, and the reason this
            // whole profile system exists.
            'cost.view'   => 'See purchase cost',
            'profit.view' => 'See profit and margin',
            'rate.override' => 'Change the rate on a bill',
            'discount.override' => 'Give a discount beyond the usual',
        ],
        'Administration' => [
            'reports.view'    => 'See reports',
            'export.data'     => 'Export a list to a file',
            'settings.manage' => 'Change Billing settings',
            'access.manage'   => 'Manage Billing profiles',
            'recurring.manage' => 'Manage recurring bills and reminders',
        ],
    ];

    /**
     * The profiles a new company starts with.
     *
     * BILLER is the important one: everything needed to stand at a counter and
     * nothing else. No purchase, no payment, no cost, no profit, no bank.
     *
     * @var array<string, array{name:string, description:string, permissions:list<string>}>
     */
    public const TEMPLATES = [
        'biller' => [
            'name' => 'Biller',
            'description' => 'Makes bills at the counter. Cannot see cost, profit, payables or the bank.',
            'permissions' => ['biller.desk', 'sale.view', 'sale.create', 'receipt.create', 'einvoice.generate', 'eway.generate'],
        ],
        'sales_biller' => [
            'name' => 'Sales biller',
            'description' => 'Bills, collects and chases customers.',
            'permissions' => [
                'biller.desk', 'sale.view', 'sale.create', 'quotation.create', 'receipt.create',
                'receivable.view', 'statement.view', 'reminder.send', 'promise.manage',
                'credit_note.create', 'einvoice.generate', 'eway.generate',
            ],
        ],
        'purchase_operator' => [
            'name' => 'Purchase operator',
            'description' => 'Records purchases and supplier dues.',
            'permissions' => ['purchase.view', 'purchase.create', 'payable.view', 'statement.view', 'debit_note.create', 'cost.view', 'payment.create'],
        ],
        'cashier' => [
            'name' => 'Cashier',
            'description' => 'Cash sales, receipts, and moving money between cash and bank.',
            'permissions' => ['biller.desk', 'compliance.view', 'sale.view', 'sale.create', 'receipt.create', 'payment.create', 'contra.create', 'cash.view', 'bank.view'],
        ],
        'collection' => [
            'name' => 'Collection',
            'description' => 'Chases what customers owe, and records what comes in.',
            'permissions' => ['receivable.view', 'statement.view', 'receipt.create', 'reminder.send', 'promise.manage', 'sale.view'],
        ],
        'owner' => [
            'name' => 'Owner',
            'description' => 'Everything in Billing.',
            'permissions' => [], // filled from the catalog at seed time
        ],
    ];

    /** @var array<string, list<string>> */
    private static array $cache = [];

    public static function assert(Context $ctx, Auth $auth, string $permission): void
    {
        if (!self::allows($ctx, $auth, $permission)) {
            Http::forbidden('You cannot ' . self::describe($permission) . ' with your Billing profile.');
        }
    }

    public static function allows(Context $ctx, Auth $auth, string $permission): bool
    {
        if ($auth->isService()) {
            return true;
        }
        if ($auth->accessType() === 1) {
            return true;
        }

        return in_array($permission, self::granted($ctx, $auth), true);
    }

    /** @return list<string> */
    public static function granted(Context $ctx, Auth $auth): array
    {
        $key = $ctx->cmpId . ':' . $auth->uuid;
        if (isset(self::$cache[$key])) {
            return self::$cache[$key];
        }

        if ($auth->isService() || $auth->accessType() === 1) {
            return self::$cache[$key] = self::all();
        }

        try {
            $rows = Db::all(
                'SELECT p.permissions
                 FROM ' . self::TABLE_ASSIGNMENTS . ' a
                 JOIN ' . self::TABLE_PROFILES . ' p ON p.profile_id = a.profile_id
                 WHERE a.cmp_id = :cmp AND a.user_uuid = :uuid AND p.is_active = TRUE',
                ['cmp' => $ctx->cmpId, 'uuid' => $auth->uuid],
            );
        } catch (\Throwable $e) {
            error_log('[permissions] lookup failed: ' . $e->getMessage());

            return self::$cache[$key] = [];
        }

        $granted = [];
        foreach ($rows as $row) {
            foreach (Db::jsonColumn($row['permissions'] ?? null) as $permission) {
                if (is_string($permission)) {
                    $granted[$permission] = true;
                }
            }
        }

        return self::$cache[$key] = array_keys($granted);
    }

    /** @return list<string> */
    public static function all(): array
    {
        $out = [];
        foreach (self::CATALOG as $group) {
            foreach (array_keys($group) as $permission) {
                $out[] = $permission;
            }
        }

        return $out;
    }

    public static function exists(string $permission): bool
    {
        return in_array($permission, self::all(), true);
    }

    /** Create the shipped profiles for a company that has none. */
    public static function seed(Context $ctx): void
    {
        $existing = (int) Db::scalar('SELECT COUNT(*) FROM ' . self::TABLE_PROFILES . ' WHERE cmp_id = :cmp', ['cmp' => $ctx->cmpId]);
        if ($existing > 0) {
            return;
        }

        foreach (self::TEMPLATES as $code => $template) {
            Db::insert(self::TABLE_PROFILES, [
                'cmp_id'       => $ctx->cmpId,
                'profile_code' => $code,
                'profile_name' => $template['name'],
                'description'  => $template['description'],
                'template_key' => $code,
                'permissions'  => $code === 'owner' ? self::all() : $template['permissions'],
                'is_system'    => true,
            ], 'profile_id');
        }
    }

    private static function describe(string $permission): string
    {
        foreach (self::CATALOG as $group) {
            if (isset($group[$permission])) {
                return strtolower($group[$permission]);
            }
        }

        return 'do that';
    }
}
