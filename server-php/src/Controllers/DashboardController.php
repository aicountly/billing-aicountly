<?php

declare(strict_types=1);

namespace Aicountly\Api\Controllers;

use Aicountly\Api\Db;
use Aicountly\Api\Domain\DuesService;
use Aicountly\Api\Http;
use Aicountly\Api\IntegrationCommand;
use Aicountly\Api\Permissions;

/**
 * The short list of things to act on, and the state of what has not saved.
 *
 * The figures themselves moved to the five dashboards. This file kept `index()`
 * for a while and answered "sales this month" from Books' own dashboard
 * endpoint, while the overview answered the same question from the register —
 * two endpoints, two figures, one question. The superseded one is gone rather
 * than left to drift; `v1/dashboards/overview` is the answer now.
 *
 * What remains is read live on the request that draws it, and every entry is
 * gated on a permission: a biller's notifications carry nothing about supplier
 * dues because the API never sends any.
 */
final class DashboardController extends Controller
{
    /**
     * A short list of the things a shopkeeper should act on.
     *
     * Each one connects to an action — an insight that cannot be acted on is
     * decoration, and this product has no room for decoration.
     */
    public static function insights(): void
    {
        [$auth, $ctx] = self::enter();

        $insights = [];
        $dues = new DuesService($ctx, $auth);

        if (Permissions::allows($ctx, $auth, 'receivable.view')) {
            try {
                $receivables = $dues->receivables();
                if ($receivables['overdue'] > 0) {
                    $insights[] = [
                        'kind'    => 'overdue_receivable',
                        'tone'    => 'warning',
                        'message' => self::money($receivables['overdue']) . ' is overdue from customers.',
                        'action'  => ['label' => 'See who', 'path' => '/receivables'],
                    ];
                }
                if ($receivables['due_this_week'] > 0) {
                    $insights[] = [
                        'kind'    => 'due_this_week',
                        'tone'    => 'info',
                        'message' => self::money($receivables['due_this_week']) . ' is due from customers this week.',
                        'action'  => ['label' => 'See the list', 'path' => '/receivables'],
                    ];
                }
                // Name the worst offender: "someone is overdue" is not actionable,
                // "Ramesh Traders is 42 days overdue" is a phone call.
                $worst = null;
                foreach ($receivables['parties'] as $party) {
                    if ($party['overdue'] > 0 && ($worst === null || $party['oldest_overdue_days'] > $worst['oldest_overdue_days'])) {
                        $worst = $party;
                    }
                }
                if ($worst !== null) {
                    $insights[] = [
                        'kind'    => 'worst_payer',
                        'tone'    => 'warning',
                        'message' => sprintf('%s is %d days overdue on %s.', $worst['account_name'], $worst['oldest_overdue_days'], self::money($worst['overdue'])),
                        'action'  => ['label' => 'Open statement', 'path' => '/parties/' . $worst['account_id']],
                    ];
                }
            } catch (\Throwable) {
                // Books unreachable. No insight is better than a wrong one.
            }
        }

        if (Permissions::allows($ctx, $auth, 'payable.view')) {
            try {
                $payables = $dues->payables();
                if ($payables['due_this_week'] > 0) {
                    $insights[] = [
                        'kind'    => 'payable_due',
                        'tone'    => 'info',
                        'message' => self::money($payables['due_this_week']) . ' is due to suppliers this week.',
                        'action'  => ['label' => 'See the list', 'path' => '/payables'],
                    ];
                }
            } catch (\Throwable) {
                // As above.
            }
        }

        $unfinished = (int) Db::scalar(
            "SELECT COUNT(*) FROM billing_transaction_requests WHERE cmp_id = :cmp AND status = 'FAILED'",
            ['cmp' => $ctx->cmpId],
        );
        if ($unfinished > 0) {
            $insights[] = [
                'kind'    => 'unfinished',
                'tone'    => 'danger',
                'message' => $unfinished . ' ' . ($unfinished === 1 ? 'entry has' : 'entries have') . ' not saved to Smart Books yet.',
                'action'  => ['label' => 'Retry them', 'path' => '/more/unfinished'],
            ];
        }

        $recurringDue = (int) Db::scalar(
            "SELECT COUNT(*) FROM billing_recurring_rules WHERE cmp_id = :cmp AND status = 'ACTIVE' AND next_run_date <= :today",
            ['cmp' => $ctx->cmpId, 'today' => gmdate('Y-m-d')],
        );
        if ($recurringDue > 0) {
            $insights[] = [
                'kind'    => 'recurring_due',
                'tone'    => 'info',
                'message' => $recurringDue . ' recurring ' . ($recurringDue === 1 ? 'bill is' : 'bills are') . ' ready to raise.',
                'action'  => ['label' => 'Raise them', 'path' => '/more/recurring'],
            ];
        }

        Http::data($insights);
    }

    public static function commands(): void
    {
        [$auth, $ctx] = self::enter();
        Http::data(IntegrationCommand::outstanding($ctx, Http::intParam('limit', 100) ?? 100));
    }

    private static function money(float $value): string
    {
        return '₹' . number_format($value, 2);
    }
}
