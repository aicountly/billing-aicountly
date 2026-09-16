<?php

declare(strict_types=1);

namespace Aicountly\Api;

/**
 * The five dashboards: who may open each, and which one a person lands on.
 *
 * ONE LIST, used twice. The session endpoint builds the tab bar from it and
 * every dashboard endpoint checks against it, so "the tab is not shown" and
 * "the URL is refused" cannot drift apart — which is the failure that makes a
 * hidden menu into a security hole. A biller who types /dashboard/payables gets
 * the same 403 as a biller who curls it.
 *
 * The landing rule reads top to bottom: the first dashboard a person may open
 * is where they start. An owner therefore lands on the business overview and a
 * counter biller lands on the biller desk, without either being special-cased.
 */
final class Dashboards
{
    /**
     * @var list<array{key:string, label:string, path:string, permissions:list<string>}>
     */
    public const ALL = [
        [
            'key'   => 'overview',
            'label' => 'Overview',
            'path'  => '/dashboard/overview',
            'permissions' => ['overview.view'],
        ],
        [
            'key'   => 'biller',
            'label' => 'Biller Desk',
            'path'  => '/dashboard/biller',
            'permissions' => ['biller.desk'],
        ],
        [
            'key'   => 'receivables',
            'label' => 'Receivables',
            'path'  => '/dashboard/receivables',
            'permissions' => ['receivable.view'],
        ],
        [
            'key'   => 'payables',
            'label' => 'Payables',
            'path'  => '/dashboard/payables',
            'permissions' => ['payable.view'],
        ],
        [
            'key'   => 'cash-compliance',
            'label' => 'Cash & Compliance',
            'path'  => '/dashboard/cash-compliance',
            'permissions' => ['cash.view', 'bank.view', 'compliance.view'],
        ],
    ];

    /**
     * The dashboards this user may open, in order.
     *
     * @param list<string> $granted
     * @return list<array{key:string, label:string, path:string}>
     */
    public static function permitted(array $granted, bool $isOwner): array
    {
        $out = [];
        foreach (self::ALL as $dashboard) {
            if (!self::holdsAny($dashboard['permissions'], $granted, $isOwner)) {
                continue;
            }
            $out[] = ['key' => $dashboard['key'], 'label' => $dashboard['label'], 'path' => $dashboard['path']];
        }

        return $out;
    }

    /**
     * Where this user starts.
     *
     * Never null: a user with no dashboard at all still needs somewhere to be,
     * and that is the sales screen they were given a profile for.
     *
     * @param list<string> $granted
     */
    public static function landing(array $granted, bool $isOwner): string
    {
        $permitted = self::permitted($granted, $isOwner);
        if ($permitted !== []) {
            return $permitted[0]['path'];
        }

        return in_array('sale.create', $granted, true) || $isOwner ? '/sales/new' : '/more';
    }

    /**
     * Refuse a dashboard this profile cannot open. Called by every endpoint.
     */
    public static function assert(Context $ctx, Auth $auth, string $key): void
    {
        foreach (self::ALL as $dashboard) {
            if ($dashboard['key'] !== $key) {
                continue;
            }
            foreach ($dashboard['permissions'] as $permission) {
                if (Permissions::allows($ctx, $auth, $permission)) {
                    return;
                }
            }
            Http::forbidden('The ' . $dashboard['label'] . ' dashboard is not part of your Billing profile.');
        }

        Http::notFound('There is no such dashboard.');
    }

    /**
     * @param list<string> $needed
     * @param list<string> $granted
     */
    private static function holdsAny(array $needed, array $granted, bool $isOwner): bool
    {
        if ($isOwner) {
            return true;
        }
        foreach ($needed as $permission) {
            if (in_array($permission, $granted, true)) {
                return true;
            }
        }

        return false;
    }
}
