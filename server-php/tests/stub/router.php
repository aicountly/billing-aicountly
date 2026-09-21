<?php
/**
 * A stand-in for Books and Inventory, for the integration tests.
 *
 * It answers the handful of endpoints the Sales services call, in the envelope
 * shape the real contracts document. It also records every request it received
 * so a test can assert on the IDEMPOTENCY KEY — which is the one thing these
 * tests exist to prove.
 */
declare(strict_types=1);

$log = getenv('STUB_LOG') ?: sys_get_temp_dir() . '/stub-requests.jsonl';
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$body = json_decode((string) file_get_contents('php://input'), true) ?: [];

$headers = [];
foreach ($_SERVER as $k => $v) {
    if (str_starts_with($k, 'HTTP_')) {
        $headers[strtolower(str_replace('_', '-', substr($k, 5)))] = $v;
    }
}

file_put_contents($log, json_encode([
    'method'  => $method,
    'path'    => $path,
    'headers' => $headers,
    'body'    => $body,
    'query'   => $_GET,
]) . "\n", FILE_APPEND);

header('Content-Type: application/json');

/**
 * Forced failures, controlled through a file rather than the environment.
 *
 * The stub runs in its own process, started before the tests. putenv() in the
 * test process cannot reach it, so the control has to be something both
 * processes can see: {"path": "reservations", "status": 422}.
 */
$controlFile = sys_get_temp_dir() . '/stub-control.json';
$control = is_file($controlFile) ? (json_decode((string) file_get_contents($controlFile), true) ?: []) : [];
if (!empty($control['path']) && str_contains($path, (string) $control['path'])) {
    http_response_code((int) ($control['status'] ?? 500));
    echo json_encode([
        'error'   => ['code' => 'stub_forced', 'message' => 'Forced failure for test'],
        'message' => 'Forced failure for test',
    ]);
    exit;
}

/**
 * Replay by idempotency key, exactly as Books and Inventory do. Two calls with
 * the same key must produce ONE document — that is what the tests check.
 */
$store = sys_get_temp_dir() . '/stub-idempotency.json';
$seen = is_file($store) ? (json_decode((string) file_get_contents($store), true) ?: []) : [];
$key = $headers['idempotency-key'] ?? '';

function remember(string $store, array $seen, string $key, array $payload): array {
    if ($key !== '') {
        $seen[$key] = $payload;
        file_put_contents($store, json_encode($seen));
    }
    return $payload;
}

if ($key !== '' && isset($seen[$key])) {
    echo json_encode(['data' => $seen[$key] + ['duplicate' => true]]);
    exit;
}

$n = count($seen) + 1;

// --- Manage ---------------------------------------------------------------
/**
 * Ownership is keyed off the company id so one stub can play every shape
 * Manage has used. Company 55 — the one almost every test opens — deliberately
 * says NOTHING about ownership, which is the case production is actually in:
 * companyinfo answers, the row carries no acs_type, and the resolution has to
 * fall through to the companies list.
 */
$manageOwnership = [
    61 => ['ownership' => 'owner'],
    62 => ['ownership' => 'shared'],
    63 => ['acs_type' => 1],
    64 => ['is_creator' => true],
    65 => ['acs_type' => 0],
];

if (str_contains($path, '/companyinfo')) {
    $id = (int) ($_GET['comp_id'] ?? 0);
    // companyinfo never carries ownership here, mirroring the real payload the
    // browser's parser reads: it pulls ownership off the LIST row, not this one.
    echo json_encode(['data' => ['cmp_id' => $id, 'cmp_name' => 'Stub Trading Co']]);
    exit;
}

if (str_contains($path, '/companies')) {
    $rows = [];
    foreach ($manageOwnership as $id => $fields) {
        $rows[] = ['comp_id' => $id, 'company_name' => 'Stub Co ' . $id] + $fields;
    }
    // 55 is in the list but says nothing either, so it resolves to null.
    $rows[] = ['comp_id' => 55, 'company_name' => 'Stub Trading Co'];
    echo json_encode(['data' => $rows, 'meta' => ['total' => count($rows)]]);
    exit;
}

// --- Inventory ------------------------------------------------------------
if (str_contains($path, '/v1/valuation/unit-costs')) {
    $ids = array_filter(explode(',', (string) ($_GET['item_ids'] ?? '')));
    echo json_encode(['data' => array_map(static fn ($id) => ['item_id' => (int) $id, 'unit_cost' => 80.0], $ids)]);
    exit;
}
if (str_contains($path, '/v1/availability/check')) {
    echo json_encode(['data' => array_map(static fn ($l) => [
        'item_id' => $l['item_id'], 'available' => 500.0, 'shortfall' => 0.0, 'ok' => true,
    ], $body['lines'] ?? [])]);
    exit;
}
if (str_contains($path, '/v1/reservations') && $method === 'POST') {
    $payload = [
        'reservation_id'   => 9000 + $n,
        'reservation_uuid' => 'resv-' . $n,
        'lines' => array_map(static fn ($l) => [
            'source_line_ref' => $l['source_line_ref'],
            'reservation_id'  => 9000 + $n,
            'reservation_uuid' => 'resv-' . $n,
        ], $body['lines'] ?? []),
    ];
    echo json_encode(['data' => remember($store, $seen, $key, $payload)]);
    exit;
}
/**
 * Posted documents are remembered by their source so `by-source` can answer,
 * which is what the three-way match reads to learn what actually arrived.
 */
$documentStore = sys_get_temp_dir() . '/stub-documents.json';
$documents = is_file($documentStore) ? (json_decode((string) file_get_contents($documentStore), true) ?: []) : [];

if (str_contains($path, '/v1/inventory-documents/by-source')) {
    $sourceKey = ($_GET['source_app'] ?? '') . '|' . ($_GET['source_document_type'] ?? '') . '|' . ($_GET['source_document_id'] ?? '');
    echo json_encode(['data' => $documents[$sourceKey] ?? []]);
    exit;
}

if (str_contains($path, '/v1/inventory-documents/post')) {
    $payload = [
        'document_id'   => 7000 + $n,
        'document_uuid' => 'invdoc-' . $n,
        'document_no'   => 'SI/' . str_pad((string) $n, 4, '0', STR_PAD_LEFT),
        'status'        => 'POSTED',
        'lines' => array_map(static fn ($l) => [
            'source_line_ref' => $l['source_line_ref'] ?? null,
            'item_id'         => $l['item_id'] ?? null,
            'qty'             => $l['qty'] ?? 0,
            'valuation_rate'  => 80.0,
        ], $body['lines'] ?? []),
    ];

    // Only an inward document counts as a receipt for by-source purposes; a
    // return going out must not read back as more goods arriving.
    if (($body['document_type'] ?? '') === 'PURCHASE_RECEIPT') {
        $sourceKey = ($body['source_app'] ?? '') . '|' . ($body['source_document_type'] ?? '') . '|' . ($body['source_document_id'] ?? '');
        $documents[$sourceKey][] = $payload;
        file_put_contents($documentStore, json_encode($documents));
    }

    echo json_encode(['data' => remember($store, $seen, $key, $payload)]);
    exit;
}

// --- Books ----------------------------------------------------------------
if (str_contains($path, '/masters/accounts/')) {
    echo json_encode(['data' => ['acc_id' => 501, 'acc_name' => 'Northern Distributors', 'credit_limit' => 500000, 'credit_days' => 30]]);
    exit;
}
if (str_contains($path, '/reports/bill-by-bill')) {
    // Debtors are left exactly as they were: the receivables and overview tests
    // are written against this one bill and must keep meaning what they meant.
    if (($_GET['party_type'] ?? 'debtor') !== 'creditor') {
        echo json_encode(['data' => [
            ['bill_no' => 'INV/0001', 'bill_date' => '2026-08-01', 'due_date' => '2026-08-31', 'balance' => 120000.0, 'bill_amount' => 150000.0],
        ]]);
        exit;
    }

    /**
     * Creditors — enough of a spread to exercise the Money to Pay workspace.
     *
     * Every ageing bucket, a bill with no due date, a part-paid bill, two
     * suppliers, a reference that is not the bill number, and one row that
     * spells its fields the OTHER way Books deployments spell them, so the
     * reader is proved to be reading and not assuming.
     *
     * The dates are relative to the stub's own today, because "overdue" is the
     * whole point of these rows and a fixed date stops being overdue.
     */
    // Relative to the as_on the caller asked for, so a test that names a date
    // gets the same bills whatever hour the suite is run at. Billing resolves
    // as_on in the company's timezone; the stub must not re-decide it in the
    // server's.
    $asOn = (string) ($_GET['as_on'] ?? '');
    $origin = new DateTimeImmutable($asOn !== '' ? $asOn : 'today');
    $day = static fn (int $offset) => $origin->modify($offset . ' days')->format('Y-m-d');

    echo json_encode(['data' => [
        ['account_id' => 601, 'account_name' => 'Northern Distributors', 'bill_no' => 'BILL/2001', 'reference_no' => 'PO-4587',
         'bill_date' => $day(-120), 'due_date' => $day(-95), 'balance' => 40000.0, 'bill_amount' => 60000.0,
         'group_name' => 'Raw Materials', 'voucher_id' => 7001],
        ['account_id' => 601, 'account_name' => 'Northern Distributors', 'bill_no' => 'BILL/2002',
         'bill_date' => $day(-80), 'due_date' => $day(-70), 'balance' => 25000.0,
         'group_name' => 'Raw Materials', 'voucher_id' => 7002],
        // The supplier's number filed under reference_no and nowhere else.
        ['account_id' => 602, 'account_name' => 'Metro Stationery', 'reference_no' => 'BILL/2003',
         'bill_date' => $day(-60), 'due_date' => $day(-45), 'balance' => 12500.0,
         'group_name' => 'Office Supplies', 'voucher_id' => 7003],
        // The same number twice, punctuated two ways.
        ['account_id' => 602, 'account_name' => 'Metro Stationery', 'bill_no' => 'BILL/2004',
         'reference_no' => 'bill-2004',
         'bill_date' => $day(-30), 'due_date' => $day(-10), 'balance' => 8000.0,
         'group_name' => 'Office Supplies', 'voucher_id' => 7004],
        // Spelled the other way: acc_id / acc_name / pending_amount.
        ['acc_id' => 603, 'acc_name' => 'Airtel Business', 'bill_no' => 'BILL/2005',
         'bill_date' => $day(-5), 'due_date' => $day(0), 'pending_amount' => 25000.0,
         'group_name' => 'Services', 'voucher_id' => 7005],
        ['account_id' => 603, 'account_name' => 'Airtel Business', 'bill_no' => 'BILL/2006',
         'bill_date' => $day(-2), 'due_date' => $day(4), 'balance' => 15000.0,
         'group_name' => 'Services', 'voucher_id' => 7006],
        ['account_id' => 601, 'account_name' => 'Northern Distributors', 'bill_no' => 'BILL/2007',
         'bill_date' => $day(-1), 'due_date' => $day(21), 'balance' => 110000.0,
         'group_name' => 'Raw Materials', 'voucher_id' => 7007],
        // No due date of its own: its own bucket, never quietly filed as "not due".
        ['account_id' => 602, 'account_name' => 'Metro Stationery', 'bill_no' => 'BILL/2008',
         'bill_date' => $day(-15), 'due_date' => null, 'balance' => 3000.0,
         'group_name' => 'Office Supplies', 'voucher_id' => 7008],
        // Settled: Books still lists it, and a zero balance is not a payable.
        ['account_id' => 602, 'account_name' => 'Metro Stationery', 'bill_no' => 'BILL/2009',
         'bill_date' => $day(-40), 'due_date' => $day(-20), 'balance' => 0.0, 'voucher_id' => 7009],
    ]]);
    exit;
}
if (str_contains($path, '/vouchers/drafts') && str_contains($path, '/post')) {
    $payload = ['vch_txn_id' => 4000 + $n, 'vch_uuid' => 'vch-' . $n, 'vch_no' => 'INV/' . str_pad((string) $n, 4, '0', STR_PAD_LEFT), 'status' => 'POSTED'];
    echo json_encode(['data' => remember($store, $seen, $key, $payload)]);
    exit;
}
if (str_contains($path, '/vouchers/drafts') && $method === 'POST') {
    $payload = ['draft_id' => 3000 + $n, 'status' => 'DRAFT'];
    echo json_encode(['data' => remember($store, $seen, $key, $payload)]);
    exit;
}
if (str_contains($path, '/dashboard/sales')) {
    echo json_encode(['data' => ['total_sales' => 985000.0, 'invoice_count' => 42]]);
    exit;
}

/**
 * The voucher register, which is what every dashboard reads.
 *
 * Shaped like the real contract, with `meta.total` present so the truncation
 * rule can be exercised: a reader that cannot prove it has every row must
 * refuse to total them.
 */
if (str_contains($path, '/registers')) {
    $type = (int) ($_GET['vch_type_id'] ?? 0);
    $rows = [];

    if ($type === 18) {            // sales
        $rows = [
            ['voucher_id' => 4101, 'vch_uuid' => 'vch-s1', 'voucher_no' => 'INV/0001', 'voucher_date' => '2026-09-14',
             'account_id' => 501, 'account_name' => 'Northern Distributors', 'grand_total' => 118000.0, 'balance' => 0.0],
            ['voucher_id' => 4102, 'vch_uuid' => 'vch-s2', 'voucher_no' => 'INV/0002', 'voucher_date' => '2026-09-15',
             'account_id' => 502, 'account_name' => 'Mehta Traders', 'grand_total' => 59000.0, 'balance' => 29500.0],
        ];
    } elseif ($type === 13) {      // receipts
        $rows = [
            ['voucher_id' => 4201, 'voucher_no' => 'RCP/0001', 'voucher_date' => '2026-09-15',
             'account_id' => 501, 'account_name' => 'Northern Distributors', 'grand_total' => 50000.0],
        ];
    } elseif ($type === 9) {       // payments
        $rows = [
            ['voucher_id' => 4301, 'voucher_no' => 'PAY/0001', 'voucher_date' => '2026-09-15',
             'account_id' => 601, 'account_name' => 'Aarti Plastics', 'grand_total' => 12000.0],
        ];
    } elseif ($type === 1) {       // contra — a bank deposit
        $rows = [
            ['voucher_id' => 4401, 'voucher_no' => 'CON/0001', 'voucher_date' => '2026-09-15', 'grand_total' => 40000.0],
        ];
    } elseif ($type === 11) {      // purchases, with two that look alike and one missing its date
        $rows = [
            ['voucher_id' => 4501, 'voucher_no' => 'PUR/0001', 'voucher_date' => '2026-09-10',
             'account_id' => 601, 'account_name' => 'Mahalaxmi Distributors',
             'supplier_invoice_no' => 'MD-7812', 'supplier_invoice_date' => '2026-09-09', 'grand_total' => 24000.0],
            ['voucher_id' => 4502, 'voucher_no' => 'PUR/0002', 'voucher_date' => '2026-09-11',
             'account_id' => 601, 'account_name' => 'Mahalaxmi Distributors',
             'supplier_invoice_no' => 'MD/7812', 'supplier_invoice_date' => '2026-09-09', 'grand_total' => 24000.0],
            ['voucher_id' => 4503, 'voucher_no' => 'PUR/0003', 'voucher_date' => '2026-09-12',
             'account_id' => 602, 'account_name' => 'R.K. Industries',
             'supplier_invoice_no' => 'RKI-4490', 'grand_total' => 32500.0],
            // Nothing wrong with this one. It must not appear in the queue:
            // a clean bill is recorded, not "awaiting review".
            ['voucher_id' => 4504, 'voucher_no' => 'PUR/0004', 'voucher_date' => '2026-09-13',
             'account_id' => 603, 'account_name' => 'Aarti Plastics',
             'supplier_invoice_no' => 'AP-9021', 'supplier_invoice_date' => '2026-09-12', 'grand_total' => 11800.0],
        ];
    }

    echo json_encode(['data' => $rows, 'meta' => ['total' => count($rows), 'limit' => 500, 'offset' => 0]]);
    exit;
}

// The ledger list, narrowed by `nature`. The expense screen reads it twice —
// once for the heads, once for the cash and bank accounts.
if (str_contains($path, '/masters/accounts')) {
    $nature = $_GET['nature'] ?? '';
    $rows = match ($nature) {
        'indirect_expenses' => [
            ['acc_id' => 810, 'acc_name' => 'Office Supplies'],
            ['acc_id' => 811, 'acc_name' => 'Travel & Conveyance'],
            ['acc_id' => 819, 'acc_name' => 'Other Expenses'],
        ],
        'cash_bank' => [
            ['acc_id' => 101, 'acc_name' => 'Cash in hand'],
            ['acc_id' => 102, 'acc_name' => 'HDFC Current'],
        ],
        default => [
            ['acc_id' => 501, 'acc_name' => 'Northern Distributors', 'gstin' => '29AAACB1234F1Z5'],
        ],
    };

    echo json_encode(['data' => $rows, 'meta' => ['total' => count($rows), 'limit' => 200, 'offset' => 0]]);
    exit;
}

if (str_contains($path, '/reports/account-summary')) {
    echo json_encode(['data' => [
        ['account_id' => 9001, 'account_name' => 'Cash in hand', 'group_name' => 'Cash-in-hand', 'closing_balance' => 42500.0],
        ['account_id' => 9002, 'account_name' => 'HDFC Current', 'group_name' => 'Bank Accounts', 'closing_balance' => 282000.0],
    ]]);
    exit;
}

http_response_code(404);
echo json_encode(['error' => ['code' => 'not_found', 'message' => 'Stub has no route for ' . $path], 'message' => 'no stub route']);
