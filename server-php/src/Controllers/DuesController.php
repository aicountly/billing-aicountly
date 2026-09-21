<?php

declare(strict_types=1);

namespace Aicountly\Api\Controllers;

use Aicountly\Api\Audit;
use Aicountly\Api\Clients\BooksClient;
use Aicountly\Api\Db;
use Aicountly\Api\Domain\DuesService;
use Aicountly\Api\Domain\Period;
use Aicountly\Api\Domain\ReportService;
use Aicountly\Api\Http;
use Aicountly\Api\Permissions;

final class DuesController extends Controller
{
    /** Columns the table may be ordered by. Anything else falls back to the due date. */
    private const SORTABLE = ['bill_no', 'bill_date', 'supplier', 'reference', 'due_date', 'days', 'amount', 'status'];

    public static function receivables(): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new DuesService($ctx, $auth))->receivables([
            'as_on'      => Http::param('as_on') ?: self::today($ctx->cmpId),
            'account_id' => Http::intParam('account_id'),
        ]));
    }

    /**
     * Money to pay, as the workspace screen needs it.
     *
     * One reading of Books behind all of it: the headline figures, the ageing,
     * what falls due next, the category split and the calendar are computed over
     * every open bill, and only the table rows are searched, filtered, sorted
     * and paged. A caller that asks for none of those gets the same answer the
     * ageing report and the dashboards have always had.
     */
    public static function payables(): void
    {
        [$auth, $ctx] = self::enter();

        $workspace = (new DuesService($ctx, $auth))->payablesWorkspace(self::query($ctx->cmpId));

        // The whole filtered set is what the export reads. Sending it as well as
        // the page would put every bill on the wire to draw twenty-five of them.
        unset($workspace['all_matching_bills']);

        Http::data($workspace);
    }

    /**
     * What was owed one month ago, so the headline card can show a real change.
     *
     * Its own endpoint, and deliberately so: this is a second reading of Books
     * at a past date, and folding it into the call above would re-read a month
     * of history every time somebody typed a letter into the search box.
     */
    public static function payablesComparison(): void
    {
        [$auth, $ctx] = self::enter();

        $today = self::today($ctx->cmpId);
        $previous = (new \DateTimeImmutable($today))->modify('-1 month')->format('Y-m-d');

        Http::data([
            'as_on'      => $today,
            'comparison' => (new DuesService($ctx, $auth))->payablesComparison($previous, 'last month'),
        ]);
    }

    /**
     * The filtered payables as a file.
     *
     * A separate permission from seeing them: a person may be trusted to look up
     * what is owed on screen and not to walk out with the list.
     */
    public static function payablesExport(): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'payable.view');
        Permissions::assert($ctx, $auth, 'export.data');

        $report = (new DuesService($ctx, $auth))->payablesExport(self::query($ctx->cmpId));
        $csv = ReportService::toCsv($report);

        Audit::record($ctx, $auth, 'payables.exported', 'report', 0, null, [
            'rows'  => count($report['rows']),
            'as_on' => $report['period']['from'],
        ]);

        if (PHP_SAPI === 'cli') {
            Http::json(200, ['data' => ['csv' => $csv]]);
        }

        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="money-to-pay-' . $report['period']['from'] . '.csv"');
        header('Cache-Control: no-store');
        // A BOM, so Excel opens ₹ and Indian names as UTF-8 rather than mojibake.
        echo "\xEF\xBB\xBF" . $csv;
        exit;
    }

    public static function statement(string $accountId): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new DuesService($ctx, $auth))->statement((int) $accountId, [
            'from' => Http::param('from'),
            'to'   => Http::param('to'),
        ]));
    }

    public static function cashAndBank(): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new DuesService($ctx, $auth))->cashAndBank());
    }

    /**
     * Bills a receipt or payment could be allocated against.
     *
     * Books decides what is still open. Showing the user a bill that has been
     * settled since they opened the screen is how a payment gets allocated twice.
     */
    public static function openBills(): void
    {
        [$auth, $ctx] = self::enter();

        $accountId = Http::intParam('account_id');
        if ($accountId === null) {
            Http::validationFailed('Choose the party first.', ['field' => 'account_id']);
        }

        $isReceivable = (Http::param('side') ?? 'receivable') === 'receivable';
        Permissions::assert($ctx, $auth, $isReceivable ? 'receipt.create' : 'payment.create');

        $response = (new BooksClient())->withSession($auth->sesKey())->billByBill($ctx, [
            'party_type' => $isReceivable ? 'debtor' : 'creditor',
            'account_id' => $accountId,
        ]);

        if (!$response['ok']) {
            Http::error(503, 'books_unavailable', 'Could not reach Smart Books for the open bills. Please retry.');
        }

        $bills = [];
        foreach ((array) ($response['body']['data'] ?? []) as $row) {
            $balance = (float) ($row['balance'] ?? $row['outstanding'] ?? 0);
            if ($balance <= 0) {
                continue;
            }
            $bills[] = [
                'bill_no'      => $row['bill_no'] ?? $row['reference_no'] ?? null,
                'bill_date'    => $row['bill_date'] ?? $row['voucher_date'] ?? null,
                'due_date'     => $row['due_date'] ?? null,
                'balance'      => round($balance, 2),
                'voucher_id'   => $row['voucher_id'] ?? $row['vch_txn_id'] ?? null,
                'voucher_uuid' => $row['voucher_uuid'] ?? $row['vch_uuid'] ?? null,
            ];
        }

        Http::data(['account_id' => $accountId, 'bills' => $bills, 'source' => 'books']);
    }

    /**
     * The table's search, filters, sort and page, read once and validated once.
     *
     * @return array<string, mixed>
     */
    private static function query(int $cmpId): array
    {
        $sortBy = (string) (Http::param('sort_by') ?? 'due_date');
        $pageSize = Http::intParam('page_size', 25) ?? 25;

        return [
            'as_on'          => Http::param('as_on') ?: self::today($cmpId),
            'search'         => Http::param('search'),
            'status'         => Http::param('status'),
            'age_bucket'     => Http::param('age_bucket'),
            'supplier_id'    => Http::intParam('supplier_id'),
            'category'       => Http::param('category'),
            'reference'      => Http::param('reference'),
            'bill_date_from' => Http::param('bill_date_from'),
            'bill_date_to'   => Http::param('bill_date_to'),
            'due_date_from'  => Http::param('due_date_from'),
            'due_date_to'    => Http::param('due_date_to'),
            'amount_min'     => Http::param('amount_min'),
            'amount_max'     => Http::param('amount_max'),
            'sort_by'        => in_array($sortBy, self::SORTABLE, true) ? $sortBy : 'due_date',
            'sort_dir'       => Http::param('sort_dir') === 'desc' ? 'desc' : 'asc',
            'page'           => max(1, Http::intParam('page', 1) ?? 1),
            'page_size'      => max(0, min(DuesService::MAX_PAGE_SIZE, $pageSize)),
        ];
    }

    /**
     * The company's today, not the server's.
     *
     * "Overdue" is decided by comparing a due date with a date, and a shop
     * closing at 9pm in Kolkata is still open when a UTC server has already
     * started tomorrow. Every other screen in this product resolves the business
     * date through Period; these endpoints used gmdate(), which is how the
     * ageing here could read a day ahead of the ageing on the dashboards.
     */
    private static function today(int $cmpId): string
    {
        try {
            $row = Db::first('SELECT timezone FROM billing_settings WHERE cmp_id = :cmp', ['cmp' => $cmpId]);
        } catch (\Throwable) {
            $row = null;
        }
        $timezone = is_string($row['timezone'] ?? null) && $row['timezone'] !== '' ? $row['timezone'] : 'Asia/Kolkata';

        return Period::resolve(['key' => 'today'], $timezone)->today();
    }
}
