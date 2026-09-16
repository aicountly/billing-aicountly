<?php

declare(strict_types=1);

namespace Aicountly\Api\Controllers;

use Aicountly\Api\Dashboards;
use Aicountly\Api\Db;
use Aicountly\Api\Domain\BillerDeskService;
use Aicountly\Api\Domain\CollectionsService;
use Aicountly\Api\Domain\ComplianceService;
use Aicountly\Api\Domain\OverviewService;
use Aicountly\Api\Domain\Period;
use Aicountly\Api\Domain\PromiseService;
use Aicountly\Api\Domain\SupplierDuesService;
use Aicountly\Api\Http;

/**
 * The five dashboards.
 *
 * Each one checks its own permission FIRST, through Dashboards::assert, before
 * a single figure is fetched. The tab bar in React is built from the same list,
 * so a dashboard that is not shown is also a dashboard that cannot be reached by
 * typing its URL — the menu is a convenience and this is the control.
 */
final class DashboardsController extends Controller
{
    public static function overview(): void
    {
        [$auth, $ctx] = self::enter();
        Dashboards::assert($ctx, $auth, 'overview');

        Http::data((new OverviewService($ctx, $auth))->build(self::period($ctx->cmpId)));
    }

    public static function biller(): void
    {
        [$auth, $ctx] = self::enter();
        Dashboards::assert($ctx, $auth, 'biller');

        Http::data((new BillerDeskService($ctx, $auth))->build(self::period($ctx->cmpId)));
    }

    public static function receivables(): void
    {
        [$auth, $ctx] = self::enter();
        Dashboards::assert($ctx, $auth, 'receivables');

        Http::data((new CollectionsService($ctx, $auth))->build(self::period($ctx->cmpId)));
    }

    public static function payables(): void
    {
        [$auth, $ctx] = self::enter();
        Dashboards::assert($ctx, $auth, 'payables');

        Http::data((new SupplierDuesService($ctx, $auth))->build(self::period($ctx->cmpId)));
    }

    public static function cashCompliance(): void
    {
        [$auth, $ctx] = self::enter();
        Dashboards::assert($ctx, $auth, 'cash-compliance');

        Http::data((new ComplianceService($ctx, $auth))->build(
            self::period($ctx->cmpId),
            Http::param('business_date'),
        ));
    }

    /** Tick or untick one step of a day's close. It locks nothing. */
    public static function dayCloseStep(): void
    {
        [$auth, $ctx] = self::enter();
        Dashboards::assert($ctx, $auth, 'cash-compliance');

        $body = Http::body();
        Http::data((new ComplianceService($ctx, $auth))->setStep(
            (string) ($body['date'] ?? gmdate('Y-m-d')),
            (string) ($body['step'] ?? ''),
            (bool) ($body['checked'] ?? true),
        ));
    }

    public static function recordPromise(): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new PromiseService($ctx, $auth))->record(Http::body()));
    }

    public static function setPromiseStatus(string $id): void
    {
        [$auth, $ctx] = self::enter();
        $body = Http::body();
        Http::data((new PromiseService($ctx, $auth))->setStatus((int) $id, (string) ($body['status'] ?? '')));
    }

    /**
     * The window this dashboard is showing.
     *
     * Resolved in the COMPANY's timezone, which is a setting rather than a
     * guess: a shop in Kolkata closing at 9pm is still trading when a UTC server
     * has moved on to tomorrow, and a "today" that disagrees with the till makes
     * every figure on the screen arguable.
     */
    private static function period(int $cmpId): Period
    {
        return Period::resolve(
            [
                'key'  => Http::param('period'),
                'from' => Http::param('from'),
                'to'   => Http::param('to'),
            ],
            self::timezone($cmpId),
        );
    }

    private static function timezone(int $cmpId): string
    {
        $configured = Db::first('SELECT timezone FROM billing_settings WHERE cmp_id = :cmp', ['cmp' => $cmpId]);
        $value = $configured['timezone'] ?? null;

        return is_string($value) && $value !== '' ? $value : 'Asia/Kolkata';
    }
}
