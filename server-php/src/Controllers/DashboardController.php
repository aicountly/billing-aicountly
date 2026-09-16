<?php

declare(strict_types=1);

namespace Aicountly\Api\Controllers;

use Aicountly\Api\Clients\BooksClient;
use Aicountly\Api\Clients\InventoryClient;
use Aicountly\Api\Db;
use Aicountly\Api\Domain\DuesService;
use Aicountly\Api\Http;
use Aicountly\Api\IntegrationCommand;
use Aicountly\Api\Permissions;

/**
 * The Billing home screen.
 *
 * It answers the questions a small business owner actually asks, in that order:
 * how much did I sell today, who owes me, whom do I owe, how much cash is there.
 *
 * Every figure is read from Books or Inventory on this request. There is no
 * roll-up table, no nightly job and no cached total — and every card is gated on
 * a permission, because the whole point of Billing profiles is that the person
 * at the counter sees the first question and not the last three.
 */
final class DashboardController extends Controller
{
    public static function index(): void
    {
        [$auth, $ctx] = self::enter();

        $from = Http::param('from') ?? gmdate('Y-m-01');
        $to = Http::param('to') ?? gmdate('Y-m-d');
        $today = gmdate('Y-m-d');

        $books = (new BooksClient())->withSession($auth->sesKey());
        $cards = [];

        // --- Sales, from Books' own dashboard --------------------------------
        if (Permissions::allows($ctx, $auth, 'sale.view')) {
            $salesToday = $books->salesDashboard($ctx, ['from' => $today, 'to' => $today]);
            $salesPeriod = $books->salesDashboard($ctx, ['from' => $from, 'to' => $to]);

            $cards['sales'] = [
                'available' => $salesToday['ok'] || $salesPeriod['ok'],
                'today'     => $salesToday['ok'] ? ($salesToday['body']['data'] ?? null) : null,
                'period'    => $salesPeriod['ok'] ? ($salesPeriod['body']['data'] ?? null) : null,
                'reason'    => $salesToday['ok'] ? null : 'Smart Books did not answer.',
            ];
        }

        // --- Dues, live ------------------------------------------------------
        $dues = new DuesService($ctx, $auth);

        if (Permissions::allows($ctx, $auth, 'receivable.view')) {
            try {
                $receivables = $dues->receivables(['as_on' => $today]);
                $cards['receivable'] = [
                    'available' => true,
                    'total'     => $receivables['total'],
                    'overdue'   => $receivables['overdue'],
                    'due_today' => $receivables['due_today'],
                    'due_this_week' => $receivables['due_this_week'],
                ];
            } catch (\Throwable) {
                $cards['receivable'] = ['available' => false, 'reason' => 'Smart Books did not answer.'];
            }
        }

        if (Permissions::allows($ctx, $auth, 'payable.view')) {
            try {
                $payables = $dues->payables(['as_on' => $today]);
                $cards['payable'] = [
                    'available' => true,
                    'total'     => $payables['total'],
                    'overdue'   => $payables['overdue'],
                    'due_this_week' => $payables['due_this_week'],
                ];
            } catch (\Throwable) {
                $cards['payable'] = ['available' => false, 'reason' => 'Smart Books did not answer.'];
            }
        }

        // --- Cash and bank, each gated separately ----------------------------
        $cards['cash_bank'] = $dues->cashAndBank();

        // --- Low stock, from Inventory ---------------------------------------
        $settings = Db::first('SELECT maintains_stock FROM billing_settings WHERE cmp_id = :cmp', ['cmp' => $ctx->cmpId]);
        if (($settings['maintains_stock'] ?? true) && Permissions::allows($ctx, $auth, 'sale.view')) {
            $lowStock = (new InventoryClient())->withSession($auth->sesKey())->replenishment($ctx, ['limit' => 10]);
            $cards['low_stock'] = $lowStock['ok']
                ? ['available' => true, 'items' => $lowStock['body']['data'] ?? []]
                : ['available' => false, 'reason' => 'Inventory did not answer.'];
        }

        // --- Ours: what has not reached Books, and what is due to be billed ---
        $cards['attention'] = [
            'unfinished_transactions' => (int) Db::scalar(
                "SELECT COUNT(*) FROM billing_transaction_requests
                 WHERE cmp_id = :cmp AND status IN ('PENDING', 'POSTING', 'FAILED')",
                ['cmp' => $ctx->cmpId],
            ),
            'recurring_due' => (int) Db::scalar(
                "SELECT COUNT(*) FROM billing_recurring_rules
                 WHERE cmp_id = :cmp AND status = 'ACTIVE' AND next_run_date <= :today",
                ['cmp' => $ctx->cmpId, 'today' => $today],
            ),
        ];

        Http::data([
            'period' => ['from' => $from, 'to' => $to],
            'cards'  => $cards,
            'note'   => 'Every figure here is read from Smart Books and Inventory as this page loads. Billing keeps none of them.',
        ]);
    }

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
