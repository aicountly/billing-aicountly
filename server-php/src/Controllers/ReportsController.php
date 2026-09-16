<?php

declare(strict_types=1);

namespace Aicountly\Api\Controllers;

use Aicountly\Api\Db;
use Aicountly\Api\Domain\Period;
use Aicountly\Api\Domain\ReportService;
use Aicountly\Api\Http;
use Aicountly\Api\Permissions;

final class ReportsController extends Controller
{
    /** Which reports this profile may open. Each still checks again when run. */
    public static function index(): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'reports.view');

        Http::data([
            'reports' => (new ReportService($ctx, $auth))->available(),
            'note'    => 'Every report is read from Smart Books as you open it. Billing keeps no copy.',
        ]);
    }

    public static function run(string $key): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'reports.view');

        Http::data((new ReportService($ctx, $auth))->run($key, self::period($ctx->cmpId)));
    }

    /**
     * The same report as a file.
     *
     * A separate permission from viewing it: a person may be trusted to look up
     * a customer's balance on screen and not to walk out with the ledger.
     */
    public static function export(string $key): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'reports.view');
        Permissions::assert($ctx, $auth, 'export.data');

        $service = new ReportService($ctx, $auth);
        $report = $service->run($key, self::period($ctx->cmpId));
        $csv = ReportService::toCsv($report);

        \Aicountly\Api\Audit::record($ctx, $auth, 'report.exported', 'report', 0, null, [
            'report' => $key,
            'rows'   => count($report['rows']),
            'period' => $report['period'],
        ]);

        if (PHP_SAPI === 'cli') {
            Http::json(200, ['data' => ['csv' => $csv]]);
        }

        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $key . '-' . $report['period']['from'] . '-to-' . $report['period']['to'] . '.csv"');
        header('Cache-Control: no-store');
        // A BOM, so Excel opens ₹ and Indian names as UTF-8 rather than mojibake.
        echo "\xEF\xBB\xBF" . $csv;
        exit;
    }

    private static function period(int $cmpId): Period
    {
        $row = Db::first('SELECT timezone FROM billing_settings WHERE cmp_id = :cmp', ['cmp' => $cmpId]);
        $timezone = is_string($row['timezone'] ?? null) && $row['timezone'] !== '' ? $row['timezone'] : 'Asia/Kolkata';

        return Period::resolve([
            'key'  => Http::param('period'),
            'from' => Http::param('from'),
            'to'   => Http::param('to'),
        ], $timezone);
    }
}
