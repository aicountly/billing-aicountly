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

/**
 * The ledger accounts behind the party directory.
 *
 * Deliberately varied, because the directory's job is to survive what Books
 * actually returns: one party with no GSTIN, one with no state, two sharing a
 * GSTIN (the duplicate check), one inactive, and one owing more than its credit
 * limit allows. `meta.total` is present so the "is this a total or a page?"
 * rule can be exercised both ways.
 */
if (str_contains($path, '/masters/accounts') && !str_contains($path, '/masters/accounts/')) {
    $nature = (string) ($_GET['nature'] ?? '');
    $partyType = (string) ($_GET['party_type'] ?? '');
    $supplier = $partyType === 'creditor' || str_contains($nature, 'creditor');

    if (str_contains($nature, 'cash_bank')) {
        echo json_encode(['data' => [
            ['acc_id' => 101, 'acc_name' => 'Cash in hand'],
            ['acc_id' => 102, 'acc_name' => 'HDFC Current'],
        ], 'meta' => ['total' => 2, 'limit' => 200, 'offset' => 0]]);
        exit;
    }
    if (str_contains($nature, 'indirect_expenses')) {
        echo json_encode(['data' => [
            ['acc_id' => 810, 'acc_name' => 'Office Supplies'],
            ['acc_id' => 811, 'acc_name' => 'Travel & Conveyance'],
            ['acc_id' => 819, 'acc_name' => 'Other Expenses'],
        ], 'meta' => ['total' => 3, 'limit' => 200, 'offset' => 0]]);
        exit;
    }

    $customers = [
        ['acc_id' => 501, 'acc_name' => 'Northern Distributors', 'gstin' => '07AABCA1234F1Z5', 'state' => 'Delhi',
         'city' => 'New Delhi', 'phone' => '9811000001', 'email' => 'accounts@northern.example',
         'credit_limit' => 100000, 'credit_days' => 30, 'is_active' => true, 'group_name' => 'Key Accounts',
         'last_transaction_date' => '2026-09-14'],
        ['acc_id' => 502, 'acc_name' => 'Mehta Traders', 'gstin' => null, 'state' => 'Maharashtra',
         'city' => 'Mumbai', 'phone' => '9820000002', 'email' => null,
         'credit_limit' => 0, 'is_active' => true, 'group_name' => 'Retail Customers',
         'last_transaction_date' => '2026-09-15'],
        ['acc_id' => 503, 'acc_name' => 'Achievement Reward', 'state' => null, 'city' => null,
         'is_active' => false, 'group_name' => 'Retail Customers'],
        // Same GSTIN as 501, spelled differently. The duplicate check exists for this.
        ['acc_id' => 504, 'acc_name' => 'Northern Distributors Pvt Ltd', 'gstin' => '07AABCA1234F1Z5',
         'state' => 'Delhi', 'city' => 'New Delhi', 'is_active' => true],
    ];

    $suppliers = [
        ['acc_id' => 601, 'acc_name' => 'Aarti Plastics', 'gstin' => '27AACFA1122D1Z7', 'state' => 'Maharashtra',
         'city' => 'Mumbai', 'phone' => '9820000601', 'credit_limit' => 250000, 'is_active' => true,
         'group_name' => 'Vendors', 'last_transaction_date' => '2026-09-10'],
        ['acc_id' => 602, 'acc_name' => 'R.K. Industries', 'gstin' => '29AAGCA9798Q1Z1', 'state' => 'Karnataka',
         'city' => 'Bengaluru', 'credit_limit' => null, 'is_active' => true, 'group_name' => 'Vendors'],
    ];

    $rows = $supplier ? $suppliers : $customers;

    $term = trim((string) ($_GET['q'] ?? ''));
    if ($term !== '') {
        $rows = array_values(array_filter(
            $rows,
            static fn (array $row) => stripos((string) $row['acc_name'], $term) !== false
                || stripos((string) ($row['gstin'] ?? ''), $term) !== false,
        ));
    }

    $total = count($rows);
    $limit = max(1, (int) ($_GET['limit'] ?? 50));
    $offset = max(0, (int) ($_GET['offset'] ?? 0));

    echo json_encode([
        'data' => array_values(array_slice($rows, $offset, $limit)),
        'meta' => ['total' => $total, 'limit' => $limit, 'offset' => $offset],
    ]);
    exit;
}

if (str_contains($path, '/reports/bill-by-bill')) {
    // Named, so the party directory can join a balance to the account beside
    // it, and carrying `bill_amount` so the dues screen can tell a part-paid
    // bill from an untouched one. One bill against a customer whose credit
    // limit is 100000 — which is what the "over the limit" reading measures.
    $creditor = ($_GET['party_type'] ?? 'debtor') === 'creditor';
    echo json_encode(['data' => $creditor ? [
        ['account_id' => 601, 'account_name' => 'Aarti Plastics', 'bill_no' => 'MD/7812',
         'bill_date' => '2026-09-01', 'due_date' => '2026-10-01', 'balance' => 24000.0, 'bill_amount' => 24000.0],
    ] : [
        ['account_id' => 501, 'account_name' => 'Northern Distributors', 'bill_no' => 'INV/0001',
         'bill_date' => '2026-08-01', 'due_date' => '2026-08-31', 'balance' => 120000.0, 'bill_amount' => 150000.0],
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

if (str_contains($path, '/reports/account-summary')) {
    echo json_encode(['data' => [
        ['account_id' => 9001, 'account_name' => 'Cash in hand', 'group_name' => 'Cash-in-hand', 'closing_balance' => 42500.0],
        ['account_id' => 9002, 'account_name' => 'HDFC Current', 'group_name' => 'Bank Accounts', 'closing_balance' => 282000.0],
    ]]);
    exit;
}

http_response_code(404);
echo json_encode(['error' => ['code' => 'not_found', 'message' => 'Stub has no route for ' . $path], 'message' => 'no stub route']);
