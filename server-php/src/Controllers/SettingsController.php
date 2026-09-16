<?php

declare(strict_types=1);

namespace Aicountly\Api\Controllers;

use Aicountly\Api\Audit;
use Aicountly\Api\Dashboards;
use Aicountly\Api\Db;
use Aicountly\Api\Http;
use Aicountly\Api\Permissions;

/**
 * Business mode, the menu it produces, and this user's session.
 */
final class SettingsController extends Controller
{
    /**
     * The app's first call: who you are, what you may do, and what menu to draw.
     *
     * The menu is computed here rather than in React because it depends on the
     * permissions, and a menu computed in the browser from a permission list the
     * browser was handed is a menu the browser can change.
     */
    public static function session(): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::seed($ctx);

        $settings = self::settingsRow($ctx->cmpId);
        $granted = Permissions::granted($ctx, $auth);

        Http::data([
            'uuid'         => $auth->uuid,
            'display_name' => $auth->displayName(),
            'is_owner'     => $auth->accessType() === 1,
            'context'      => $ctx->asQuery(),
            'permissions'  => $granted,
            'settings'     => $settings,
            'menu'         => self::menu($settings, $granted, $auth->accessType() === 1),
            // The dashboards this profile may open, and where it starts. Built
            // from the same list the endpoints check, so the tab bar can never
            // offer a screen the API will refuse.
            'dashboards'   => Dashboards::permitted($granted, $auth->accessType() === 1),
            'landing'      => Dashboards::landing($granted, $auth->accessType() === 1),
        ]);
    }

    public static function show(): void
    {
        [$auth, $ctx] = self::enter();
        Http::data(self::settingsRow($ctx->cmpId));
    }

    public static function update(): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'settings.manage');

        $body = Http::body();
        $before = self::settingsRow($ctx->cmpId);
        $changes = [];

        foreach ([
            'business_mode', 'business_type', 'gst_registered', 'maintains_stock',
            'needs_purchase', 'needs_payables', 'needs_bank_cash',
            'default_sale_terms', 'default_payment_terms', 'onboarding_done',
        ] as $field) {
            if (array_key_exists($field, $body)) {
                $changes[$field] = $body[$field];
            }
        }

        if (isset($changes['business_mode']) && !in_array($changes['business_mode'], ['micro', 'trader', 'service', 'retail', 'owner'], true)) {
            Http::validationFailed('Business mode must be micro, trader, service, retail or owner.', ['field' => 'business_mode']);
        }

        if ($changes !== []) {
            $changes['updated_at'] = gmdate('Y-m-d H:i:s');
            Db::update('billing_settings', $changes, ['cmp_id' => $ctx->cmpId]);
            Audit::record($ctx, $auth, 'settings.updated', 'billing_settings', $ctx->cmpId, $before, $changes);
        }

        self::show();
    }

    /**
     * Onboarding: five questions, one menu.
     *
     * It creates no masters, no ledgers and no vouchers — it decides what this
     * business sees and nothing else. A shop that answers "no stock" simply does
     * not get the stock screens; Inventory is untouched either way.
     */
    public static function onboard(): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'settings.manage');

        $body = Http::body();
        $businessType = trim((string) ($body['business_type'] ?? 'trading'));

        $mode = match (true) {
            !($body['needs_purchase'] ?? true) && !($body['needs_bank_cash'] ?? true) => 'micro',
            $businessType === 'service' => 'service',
            $businessType === 'retail'  => 'retail',
            default => 'trader',
        };

        Db::run('INSERT INTO billing_settings (cmp_id) VALUES (:cmp) ON CONFLICT (cmp_id) DO NOTHING', ['cmp' => $ctx->cmpId]);
        Db::update('billing_settings', [
            'business_mode'   => $mode,
            'business_type'   => $businessType,
            'gst_registered'  => (bool) ($body['gst_registered'] ?? true),
            'maintains_stock' => (bool) ($body['maintains_stock'] ?? true),
            'needs_purchase'  => (bool) ($body['needs_purchase'] ?? true),
            'needs_payables'  => (bool) ($body['needs_payables'] ?? true),
            'needs_bank_cash' => (bool) ($body['needs_bank_cash'] ?? true),
            'onboarding_done' => true,
            'updated_at'      => gmdate('Y-m-d H:i:s'),
        ], ['cmp_id' => $ctx->cmpId]);

        Permissions::seed($ctx);
        Audit::record($ctx, $auth, 'billing.onboarded', 'billing_settings', $ctx->cmpId, null, ['business_mode' => $mode]);

        self::session();
    }

    /**
     * The menu this business and this user should see.
     *
     * Two filters, and both matter: what the BUSINESS needs (a service company
     * has no stock screens) and what the USER may do (a biller has no payables).
     *
     * @param array<string, mixed> $settings
     * @param list<string>         $granted
     * @return list<array{key:string, label:string, path:string, children:list<array{label:string, path:string}>}>
     */
    private static function menu(array $settings, array $granted, bool $isOwner): array
    {
        $may = static fn (?string $permission) => $permission === null || $isOwner || in_array($permission, $granted, true);
        $landing = Dashboards::landing($granted, $isOwner);

        // Grouped the way a shopkeeper thinks about the day rather than the way
        // the vouchers are filed: what I sold, what I bought, where the money
        // went, who I deal with.
        //
        // Every path here has a route behind it. An entry pointing at a screen
        // that does not exist is worse than no entry: the user is told the
        // feature is there, clicks, and is told the page does not exist.
        $entries = [
            ['key' => 'dashboard',   'label' => 'Dashboard',   'path' => $landing,       'permission' => null,              'needs' => null, 'children' => []],
            ['key' => 'sales',       'label' => 'Sales',       'path' => '/sales',       'permission' => 'sale.view',       'needs' => null, 'children' => [
                ['label' => 'New bill',     'path' => '/sales/new',         'permission' => 'sale.create'],
                ['label' => 'Credit note',  'path' => '/more/credit-note',  'permission' => 'credit_note.create'],
            ]],
            ['key' => 'purchases',   'label' => 'Purchases',   'path' => '/purchases',   'permission' => 'purchase.view',   'needs' => 'needs_purchase', 'children' => [
                ['label' => 'New purchase', 'path' => '/purchases/new',    'permission' => 'purchase.create'],
                ['label' => 'Debit note',   'path' => '/more/debit-note',  'permission' => 'debit_note.create'],
                ['label' => 'Expense',      'path' => '/more/expense',     'permission' => 'expense.create'],
            ]],
            ['key' => 'money',       'label' => 'Money',       'path' => '/money-in',    'permission' => 'receipt.create',  'needs' => null, 'children' => [
                ['label' => 'Money received', 'path' => '/money-in/new',        'permission' => 'receipt.create'],
                ['label' => 'Money paid',     'path' => '/money-out/new',       'permission' => 'payment.create'],
                ['label' => 'Bank deposit',   'path' => '/bank-cash/deposit',   'permission' => 'contra.create'],
                ['label' => 'Bank withdrawal', 'path' => '/bank-cash/withdrawal', 'permission' => 'contra.create'],
            ]],
            ['key' => 'receivables', 'label' => 'Money to Collect', 'path' => '/receivables', 'permission' => 'receivable.view', 'needs' => null, 'children' => []],
            ['key' => 'payables',    'label' => 'Money to Pay',     'path' => '/payables',    'permission' => 'payable.view',    'needs' => 'needs_payables', 'children' => []],
            ['key' => 'parties',     'label' => 'Parties',     'path' => '/parties',     'permission' => 'sale.view',       'needs' => null, 'children' => []],
            ['key' => 'items',       'label' => 'Items',       'path' => '/items',       'permission' => 'sale.view',       'needs' => 'maintains_stock', 'children' => []],
            ['key' => 'reports',     'label' => 'Reports',     'path' => '/reports',     'permission' => 'reports.view',    'needs' => null, 'children' => []],
            ['key' => 'more',        'label' => 'Settings',    'path' => '/more',        'permission' => null,              'needs' => null, 'children' => []],
        ];

        $out = [];
        foreach ($entries as $entry) {
            if (!$may($entry['permission'])) {
                continue;
            }
            if ($entry['needs'] !== null && !($settings[$entry['needs']] ?? true)) {
                continue;
            }

            $children = [];
            foreach ($entry['children'] as $child) {
                if ($may($child['permission'])) {
                    $children[] = ['label' => $child['label'], 'path' => $child['path']];
                }
            }

            $out[] = [
                'key'      => $entry['key'],
                'label'    => $entry['label'],
                'path'     => $entry['path'],
                'children' => $children,
            ];
        }

        return $out;
    }

    /** @return array<string, mixed> */
    private static function settingsRow(int $cmpId): array
    {
        $row = Db::first('SELECT * FROM billing_settings WHERE cmp_id = :cmp', ['cmp' => $cmpId]);
        if ($row === null) {
            Db::insert('billing_settings', ['cmp_id' => $cmpId], 'cmp_id');
            $row = Db::first('SELECT * FROM billing_settings WHERE cmp_id = :cmp', ['cmp' => $cmpId]);
        }

        return $row ?? [];
    }
}
