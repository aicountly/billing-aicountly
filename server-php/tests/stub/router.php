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
 * The ledger master list.
 *
 * `nature=cash_bank` is what the bank-and-cash screens ask for. Axis is
 * deliberately ABSENT from the account-summary answer below, so a reader has to
 * cope with an account it has no balance for; and "Petty cash tin" carries no
 * accounting group at all, which is the case that forces classification to fall
 * back to the name.
 */
if (str_contains($path, '/masters/accounts')) {
    $nature = (string) ($_GET['nature'] ?? '');
    if ($nature !== 'cash_bank') {
        echo json_encode(['data' => [
            ['acc_id' => 501, 'acc_name' => 'Northern Distributors'],
            ['acc_id' => 601, 'acc_name' => 'Aarti Plastics'],
        ], 'meta' => ['total' => 2]]);
        exit;
    }

    echo json_encode(['data' => [
        ['acc_id' => 9001, 'acc_name' => 'Cash in hand', 'group_name' => 'Cash-in-hand'],
        ['acc_id' => 9002, 'acc_name' => 'HDFC Current', 'group_name' => 'Bank Accounts', 'bank_account_no' => '502000123456'],
        ['acc_id' => 9003, 'acc_name' => 'Axis Current', 'group_name' => 'Bank Accounts', 'bank_account_no' => '998877665544'],
        ['acc_id' => 9004, 'acc_name' => 'Untyped Bank', 'group_name' => 'Bank Accounts'],
        ['acc_id' => 9005, 'acc_name' => 'Petty cash tin'],
    ], 'meta' => ['total' => 5]]);
    exit;
}

/**
 * An account's own ledger.
 *
 * 9002 carries the four cases that matter to the withdrawal screen: a contra
 * OUT of the bank (a withdrawal), a payment out of the bank (not one), a contra
 * INTO the bank (a deposit, not one) and a second withdrawal. 9004's rows carry
 * no voucher type at all, which must read as "cannot tell" rather than as four
 * withdrawals.
 */
if (str_contains($path, '/reports/account-ledger')) {
    $account = (int) ($_GET['account_id'] ?? 0);
    $rows = match ($account) {
        9002 => [
            ['voucher_id' => 7101, 'voucher_no' => 'CON/0041', 'voucher_date' => '2026-09-18', 'voucher_type' => 'Contra',
             'debit' => 0, 'credit' => 25000, 'particulars' => 'Cash in hand', 'instrument_no' => 'CHQ002341'],
            ['voucher_id' => 7102, 'voucher_no' => 'PAY/0007', 'voucher_date' => '2026-09-17', 'voucher_type' => 'Payment',
             'debit' => 0, 'credit' => 60000, 'particulars' => 'Aarti Plastics'],
            ['voucher_id' => 7103, 'voucher_no' => 'CON/0038', 'voucher_date' => '2026-09-15', 'voucher_type' => 'Contra',
             'debit' => 40000, 'credit' => 0, 'particulars' => 'Cash in hand'],
            ['voucher_id' => 7104, 'voucher_no' => 'CON/0034', 'voucher_date' => '2026-09-12', 'voucher_type' => 'Contra',
             'debit' => 0, 'credit' => 50000, 'particulars' => 'Cash in hand', 'instrument_no' => 'CHQ002333'],
        ],
        9003 => [
            ['voucher_id' => 7201, 'voucher_no' => 'CON/0028', 'voucher_date' => '2026-09-05', 'voucher_type' => 'Contra',
             'debit' => 0, 'credit' => 15000, 'particulars' => 'Petty cash tin', 'instrument_no' => 'Slip No. 4456'],
        ],
        9004 => [
            ['voucher_id' => 7301, 'voucher_no' => 'XX/0001', 'voucher_date' => '2026-09-14', 'debit' => 0, 'credit' => 9000],
            ['voucher_id' => 7302, 'voucher_no' => 'XX/0002', 'voucher_date' => '2026-09-13', 'debit' => 5000, 'credit' => 0],
        ],
        default => [],
    };

    echo json_encode(['data' => $rows, 'meta' => ['total' => count($rows)]]);
    exit;
}
if (str_contains($path, '/reports/bill-by-bill')) {
    echo json_encode(['data' => [
        ['bill_no' => 'INV/0001', 'bill_date' => '2026-08-01', 'due_date' => '2026-08-31', 'balance' => 120000.0],
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
