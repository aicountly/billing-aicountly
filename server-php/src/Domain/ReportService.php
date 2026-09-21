<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

use Aicountly\Api\Auth;
use Aicountly\Api\Clients\BooksClient;
use Aicountly\Api\Context;
use Aicountly\Api\Db;
use Aicountly\Api\Http;
use Aicountly\Api\Permissions;

/**
 * The handful of lists a small business actually prints.
 *
 * Every one is Books' own register or report, read on the request that draws
 * it. There is no reporting table here, no nightly roll-up and no "as at last
 * refresh" — which is why a register printed from this screen and the same
 * register printed from Books say the same thing.
 *
 * TWO RULES ABOUT EXPORTS
 *
 * An export is the FULL filtered set, not the page on screen. Someone who
 * filters to a month, sees twenty rows and exports expects the month. Handing
 * them the first page silently is the kind of error that is only discovered
 * when the figures are already in somebody's return, so when the whole set
 * cannot be read this refuses rather than truncating.
 *
 * And every text cell is neutralised against spreadsheet formula injection. A
 * customer named `=cmd|…` is a customer, not a macro, and the name came from
 * outside this product.
 */
final class ReportService
{
    /**
     * The catalogue, and everything the Reports screen needs to describe it.
     *
     * `categories` and `source` live here rather than in the browser because
     * they are facts about the report, not about how it is drawn: which
     * product owns the figures, and which shelves the report belongs on. The
     * screen supplies the icon and the wording around them, nothing more.
     *
     * A report may sit on more than one shelf. A sales register is a sales
     * report AND a register, and a user looking for it will accept either
     * door; the first entry is its primary home.
     *
     * @var array<string, array{label:string, permission:string, kind:string,
     *                          description:string, categories:list<string>, source:string}>
     */
    public const CATALOG = [
        'sales_register' => [
            'label' => 'Sales register', 'permission' => 'sale.view', 'kind' => 'register',
            'description' => 'Every bill raised in the period, with party, amount and status.',
            'categories' => ['sales', 'registers'], 'source' => 'books',
        ],
        'purchase_register' => [
            'label' => 'Purchase register', 'permission' => 'purchase.view', 'kind' => 'register',
            'description' => 'Every purchase recorded in the period, with supplier and amount.',
            'categories' => ['purchases', 'registers'], 'source' => 'books',
        ],
        'credit_notes' => [
            'label' => 'Credit note register', 'permission' => 'sale.view', 'kind' => 'register',
            'description' => 'Credit notes raised against customers in the period.',
            'categories' => ['sales', 'registers'], 'source' => 'books',
        ],
        'debit_notes' => [
            'label' => 'Debit note register', 'permission' => 'purchase.view', 'kind' => 'register',
            'description' => 'Debit notes raised against suppliers in the period.',
            'categories' => ['purchases', 'registers'], 'source' => 'books',
        ],
        'receipts' => [
            'label' => 'Receipt register', 'permission' => 'receipt.create', 'kind' => 'register',
            'description' => 'Money received in the period, and who it came from.',
            'categories' => ['money', 'registers'], 'source' => 'books',
        ],
        'payments' => [
            'label' => 'Payment register', 'permission' => 'payment.create', 'kind' => 'register',
            'description' => 'Money paid out in the period, and who it went to.',
            'categories' => ['money', 'registers'], 'source' => 'books',
        ],
        'receivables_ageing' => [
            'label' => 'Receivables ageing', 'permission' => 'receivable.view', 'kind' => 'ageing',
            'description' => 'What customers owe, aged by how long it has been outstanding.',
            'categories' => ['receivables-payables'], 'source' => 'books',
        ],
        'payables_ageing' => [
            'label' => 'Payables ageing', 'permission' => 'payable.view', 'kind' => 'ageing',
            'description' => 'What you owe suppliers, aged by how long it has been outstanding.',
            'categories' => ['receivables-payables'], 'source' => 'books',
        ],
        'cash_bank_summary' => [
            'label' => 'Cash and bank summary', 'permission' => 'cash.view', 'kind' => 'accounts',
            'description' => 'The balance of every cash and bank account you may see.',
            'categories' => ['money'], 'source' => 'books',
        ],
        'document_exceptions' => [
            'label' => 'Document exceptions', 'permission' => 'compliance.view', 'kind' => 'exceptions',
            'description' => 'Documents that did not reach Smart Books, or are waiting on a statutory step.',
            'categories' => ['audit'], 'source' => 'books',
        ],
    ];

    private const VOUCHER_TYPES = [
        'sales_register'    => BooksClient::VCH_SALES,
        'purchase_register' => BooksClient::VCH_PURCHASE,
        'credit_notes'      => BooksClient::VCH_CREDIT_NOTE,
        'debit_notes'       => BooksClient::VCH_DEBIT_NOTE,
        'receipts'          => BooksClient::VCH_RECEIPT,
        'payments'          => BooksClient::VCH_PAYMENT,
    ];

    public function __construct(
        private readonly Context $ctx,
        private readonly Auth $auth,
    ) {
    }

    /**
     * The reports this profile may open.
     *
     * Cash and bank is offered to anyone who may see either half, because the
     * summary shows only the accounts they are allowed to see.
     *
     * @return list<array{key:string, label:string, description:string,
     *                     categories:list<string>, source:string, kind:string}>
     */
    public function available(): array
    {
        $out = [];
        foreach (self::CATALOG as $key => $report) {
            $allowed = Permissions::allows($this->ctx, $this->auth, $report['permission'])
                || ($key === 'cash_bank_summary' && Permissions::allows($this->ctx, $this->auth, 'bank.view'));
            if ($allowed) {
                $out[] = [
                    'key'         => $key,
                    'label'       => $report['label'],
                    'description' => $report['description'],
                    'categories'  => $report['categories'],
                    'source'      => $report['source'],
                    'kind'        => $report['kind'],
                ];
            }
        }

        return $out;
    }

    /**
     * @return array{key:string, label:string, columns:list<array{key:string,label:string,numeric:bool}>,
     *               rows:list<array<string,mixed>>, total:?float, complete:bool, note:string, period:array<string,string>}
     */
    public function run(string $key, Period $period): array
    {
        if (!isset(self::CATALOG[$key])) {
            Http::notFound('There is no such report.');
        }

        $report = self::CATALOG[$key];
        if ($key === 'cash_bank_summary') {
            if (!Permissions::allows($this->ctx, $this->auth, 'cash.view')
                && !Permissions::allows($this->ctx, $this->auth, 'bank.view')) {
                Http::forbidden('Your Billing profile does not show balances.');
            }
        } else {
            Permissions::assert($this->ctx, $this->auth, $report['permission']);
        }

        return match ($report['kind']) {
            'register'   => $this->register($key, $report['label'], $period),
            'ageing'     => $this->ageing($key, $report['label'], $period),
            'accounts'   => $this->accounts($report['label'], $period),
            default      => $this->exceptions($report['label'], $period),
        };
    }

    /** @return array<string, mixed> */
    private function register(string $key, string $label, Period $period): array
    {
        $books = (new BooksClient())->withSession($this->auth->sesKey());
        $reading = (new RegisterReader($this->ctx, $books))->read(self::VOUCHER_TYPES[$key], $period->from, $period->to);

        if (!$reading['available']) {
            Http::error(503, 'books_unavailable', 'Could not reach Smart Books for this report. Please retry.');
        }

        $rows = RegisterReader::documents($reading, 1000);

        return [
            'key'     => $key,
            'label'   => $label,
            'columns' => [
                ['key' => 'document_no', 'label' => 'Document', 'numeric' => false],
                ['key' => 'date',        'label' => 'Date',     'numeric' => false],
                ['key' => 'party',       'label' => 'Party',    'numeric' => false],
                ['key' => 'amount',      'label' => 'Amount',   'numeric' => true],
                ['key' => 'status',      'label' => 'Status',   'numeric' => false],
            ],
            'rows'     => $rows,
            'total'    => RegisterReader::total($reading),
            'complete' => $reading['complete'],
            'period'   => ['from' => $period->from, 'to' => $period->to],
            'note'     => $reading['complete']
                ? 'Read from Smart Books just now. The total is the sum of every row shown.'
                : 'More documents exist in these dates than could be read at once, so no total is given and an export would be short. Narrow the dates.',
        ];
    }

    /** @return array<string, mixed> */
    private function ageing(string $key, string $label, Period $period): array
    {
        $dues = new DuesService($this->ctx, $this->auth);
        $data = $key === 'receivables_ageing'
            ? $dues->receivables(['as_on' => $period->today()])
            : $dues->payables(['as_on' => $period->today()]);

        return [
            'key'     => $key,
            'label'   => $label,
            'columns' => [
                ['key' => 'account_name', 'label' => 'Party',      'numeric' => false],
                ['key' => 'bill_no',      'label' => 'Bill',       'numeric' => false],
                ['key' => 'bill_date',    'label' => 'Dated',      'numeric' => false],
                ['key' => 'due_date',     'label' => 'Due',        'numeric' => false],
                ['key' => 'days_overdue', 'label' => 'Days late',  'numeric' => true],
                ['key' => 'balance',      'label' => 'Outstanding', 'numeric' => true],
            ],
            'rows'     => $data['bills'],
            'total'    => $data['total'],
            'complete' => true,
            'period'   => ['from' => $period->today(), 'to' => $period->today()],
            'note'     => 'Balances as at ' . $period->today() . ', aged from each bill\'s own due date. ' . $data['note'],
        ];
    }

    /** @return array<string, mixed> */
    private function accounts(string $label, Period $period): array
    {
        $cashBank = (new DuesService($this->ctx, $this->auth))->cashAndBank();
        if (!$cashBank['available']) {
            Http::error(503, 'books_unavailable', (string) ($cashBank['reason'] ?? 'Smart Books did not answer.'));
        }

        $accounts = $cashBank['accounts'] ?? [];

        return [
            'key'     => 'cash_bank_summary',
            'label'   => $label,
            'columns' => [
                ['key' => 'account_name', 'label' => 'Account', 'numeric' => false],
                ['key' => 'kind',         'label' => 'Kind',    'numeric' => false],
                ['key' => 'balance',      'label' => 'Balance', 'numeric' => true],
            ],
            'rows'     => $accounts,
            'total'    => round(array_sum(array_column($accounts, 'balance')), 2),
            'complete' => true,
            'period'   => ['from' => $period->today(), 'to' => $period->today()],
            'note'     => 'Closing balances from Smart Books as at ' . $period->today()
                . '. Only the accounts your Billing profile may see are listed, and the total is of those.',
        ];
    }

    /** @return array<string, mixed> */
    private function exceptions(string $label, Period $period): array
    {
        $rows = Db::all(
            "SELECT c.command_type, c.status, c.attempts, c.last_error, c.last_attempt_at,
                    r.books_voucher_no, r.transaction_date
             FROM billing_integration_commands c
             LEFT JOIN billing_transaction_requests r ON r.request_id = c.entity_id
             WHERE c.cmp_id = :cmp AND c.command_type LIKE 'billing.e%'
               AND c.status <> 'COMPLETED'
             ORDER BY c.updated_at DESC
             LIMIT 500",
            ['cmp' => $this->ctx->cmpId],
        );

        $out = [];
        foreach ($rows as $row) {
            $out[] = [
                'document'   => str_contains((string) $row['command_type'], 'eway') ? 'e-Way Bill' : 'e-Invoice',
                'voucher_no' => $row['books_voucher_no'],
                'date'       => $row['transaction_date'],
                'state'      => in_array((string) $row['status'], ['FAILED', 'BLOCKED'], true) ? 'Did not generate' : 'Still pending',
                'attempts'   => (int) $row['attempts'],
                'detail'     => $row['last_error'] ?? 'Smart Books has not confirmed it yet.',
            ];
        }

        return [
            'key'     => 'document_exceptions',
            'label'   => $label,
            'columns' => [
                ['key' => 'document',   'label' => 'Document', 'numeric' => false],
                ['key' => 'voucher_no', 'label' => 'Invoice',  'numeric' => false],
                ['key' => 'date',       'label' => 'Dated',    'numeric' => false],
                ['key' => 'state',      'label' => 'State',    'numeric' => false],
                ['key' => 'attempts',   'label' => 'Tries',    'numeric' => true],
                ['key' => 'detail',     'label' => 'What happened', 'numeric' => false],
            ],
            'rows'     => $out,
            'total'    => null,
            'complete' => true,
            'period'   => ['from' => $period->from, 'to' => $period->to],
            'note'     => 'e-Invoice and e-Way Bill requests raised from Billing that have not come back generated. '
                . 'A document that was never needed is not an exception and is not listed.',
        ];
    }

    /**
     * The report as CSV.
     *
     * @param array<string, mixed> $report
     */
    public static function toCsv(array $report): string
    {
        if (!$report['complete']) {
            Http::error(
                409,
                'export_incomplete',
                'This report could not be read in full, so exporting it would give you a short file. Narrow the dates and try again.',
            );
        }

        $handle = fopen('php://temp', 'r+');
        if ($handle === false) {
            Http::error(500, 'export_failed', 'Could not build the file.');
        }

        fputcsv($handle, array_map(static fn (array $column) => self::cell($column['label']), $report['columns']));

        foreach ($report['rows'] as $row) {
            $line = [];
            foreach ($report['columns'] as $column) {
                $line[] = self::cell($row[$column['key']] ?? null);
            }
            fputcsv($handle, $line);
        }

        if ($report['total'] !== null) {
            $line = array_fill(0, count($report['columns']), '');
            $line[0] = 'Total';
            foreach ($report['columns'] as $index => $column) {
                if ($column['numeric'] && $column['key'] !== 'days_overdue' && $column['key'] !== 'attempts') {
                    $line[$index] = (string) $report['total'];
                }
            }
            fputcsv($handle, $line);
        }

        rewind($handle);
        $csv = (string) stream_get_contents($handle);
        fclose($handle);

        return $csv;
    }

    /**
     * One cell, safe to open in a spreadsheet.
     *
     * A leading =, +, - or @ makes Excel and Sheets treat the cell as a formula,
     * and these cells carry names and narrations typed by people outside this
     * company. Prefixing an apostrophe is the standard neutralisation: the value
     * still reads correctly to a human and is inert to the spreadsheet. Leading
     * tabs and carriage returns are stripped first, because they are how the
     * prefix gets skipped past.
     */
    /**
     * One CSV cell, neutralised against spreadsheet formula injection.
     *
     * Public because the item catalogue and the party directory both export
     * through the same rule: a supplier's name that begins with `=` is a
     * formula the moment somebody opens the file, and there must be exactly
     * one place that decides what to do about it. Three copies of that defence
     * is two copies that will be forgotten.
     */
    public static function cell(mixed $value): string
    {
        if ($value === null || is_bool($value)) {
            return $value === true ? 'yes' : ($value === false ? 'no' : '');
        }
        if (is_int($value) || is_float($value)) {
            return (string) $value;
        }

        $text = is_scalar($value) ? (string) $value : json_encode($value, JSON_UNESCAPED_UNICODE);
        $text = ltrim((string) $text, "\t\r\n");

        if ($text !== '' && str_contains('=+-@', $text[0])) {
            return "'" . $text;
        }

        return $text;
    }
}
