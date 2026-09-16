<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

use Aicountly\Api\Audit;
use Aicountly\Api\Auth;
use Aicountly\Api\Clients\BooksClient;
use Aicountly\Api\Context;
use Aicountly\Api\Db;
use Aicountly\Api\Http;
use Aicountly\Api\IntegrationCommand;
use Aicountly\Api\Permissions;

/**
 * Every transaction Billing can create, and the one way it creates them.
 *
 * BOOKS MAKES THE TRANSACTION. Billing takes what the user typed, checks they
 * are allowed to type it, and asks Books. What comes back is a voucher id.
 *
 * There is no sale here, no purchase, no receipt, no payment and no ledger. The
 * `billing_transaction_requests` row holds the REQUEST — what was asked for, its
 * state, and the reference Books returned — so the screen can show a retry and
 * so a lost response does not become a second invoice.
 *
 * The user-facing names are deliberately not the accounting ones. "Money
 * received" is a receipt voucher and "Bank deposit" is a contra; the shopkeeper
 * should not have to learn either word, and internally we call the right API.
 */
final class TransactionService
{
    public const COMMAND_POST = 'billing.transaction.post';

    /**
     * kind => [Books voucher type, permission, plain-English name]
     *
     * @var array<string, array{0:int, 1:string, 2:string}>
     */
    private const KINDS = [
        'sale'             => [BooksClient::VCH_SALES,       'sale.create',        'bill'],
        'purchase'         => [BooksClient::VCH_PURCHASE,    'purchase.create',    'purchase'],
        'receipt'          => [BooksClient::VCH_RECEIPT,     'receipt.create',     'money received'],
        'payment'          => [BooksClient::VCH_PAYMENT,     'payment.create',     'money paid'],
        'credit_note'      => [BooksClient::VCH_CREDIT_NOTE, 'credit_note.create', 'credit note'],
        'debit_note'       => [BooksClient::VCH_DEBIT_NOTE,  'debit_note.create',  'debit note'],
        'expense'          => [BooksClient::VCH_PAYMENT,     'expense.create',     'expense'],
        'bank_deposit'     => [BooksClient::VCH_CONTRA,      'contra.create',      'bank deposit'],
        'bank_withdrawal'  => [BooksClient::VCH_CONTRA,      'contra.create',      'bank withdrawal'],
        'bank_transfer'    => [BooksClient::VCH_CONTRA,      'contra.create',      'bank transfer'],
    ];

    public function __construct(
        private readonly Context $ctx,
        private readonly Auth $auth,
    ) {
    }

    /**
     * Record a transaction: save the request, ask Books, keep the reference.
     *
     * @param array<string, mixed> $input
     */
    public function create(string $kind, array $input): array
    {
        if (!isset(self::KINDS[$kind])) {
            Http::validationFailed('Unknown transaction type "' . $kind . '".', ['field' => 'kind']);
        }
        [$vchTypeId, $permission, $label] = self::KINDS[$kind];

        Permissions::assert($this->ctx, $this->auth, $permission);

        $payload = $this->normalise($kind, $input, $label);

        $requestId = (int) Db::insert('billing_transaction_requests', [
            'cmp_id'           => $this->ctx->cmpId,
            'fy_id'            => $this->ctx->fyId,
            'bo_id'            => $this->ctx->boId,
            'kind'             => $kind,
            'status'           => 'PENDING',
            'party_account_id' => $payload['party_acc_id'] ?? null,
            'transaction_date' => $payload['vch_date'],
            'payload'          => $payload,
            'created_by'       => $this->auth->uuid,
        ], 'request_id');

        $this->rememberFavourites($payload);

        return $this->post($requestId, $vchTypeId, $label);
    }

    /**
     * Send a stored request to Books.
     *
     * Split out so a RETRY drives the SAME request row, and therefore reaches
     * IntegrationCommand with the same idempotency key. That is the whole
     * defence against the classic small-business complaint: the network hiccuped,
     * they pressed Save again, and the customer got two invoices.
     */
    public function post(int $requestId, ?int $vchTypeId = null, ?string $label = null): array
    {
        $request = Db::first(
            'SELECT * FROM billing_transaction_requests WHERE request_id = :id AND cmp_id = :cmp',
            ['id' => $requestId, 'cmp' => $this->ctx->cmpId],
        );
        if ($request === null) {
            Http::notFound('That transaction does not exist.');
        }
        if ($request['status'] === 'POSTED') {
            Http::conflict('That transaction has already been recorded.');
        }

        $kind = (string) $request['kind'];
        [$resolvedType, $permission, $resolvedLabel] = self::KINDS[$kind];
        $vchTypeId ??= $resolvedType;
        $label ??= $resolvedLabel;

        Permissions::assert($this->ctx, $this->auth, $permission);

        $command = IntegrationCommand::open(
            $this->ctx,
            'books',
            self::COMMAND_POST,
            'transaction_request',
            $requestId,
            ['kind' => $kind],
        );
        $commandId = (int) $command['command_id'];
        IntegrationCommand::markPosting($commandId);
        Db::update('billing_transaction_requests', ['status' => 'POSTING', 'updated_at' => self::now()], ['request_id' => $requestId]);

        $payload = Db::jsonColumn($request['payload']);
        $payload['source_app'] = 'billing';
        $payload['source_document_type'] = 'billing.' . $kind;
        $payload['source_document_id'] = $requestId;
        $payload['source_document_uuid'] = (string) $request['request_uuid'];

        $response = (new BooksClient())
            ->withService($this->auth->uuid)
            ->createAndPostVoucher($this->ctx, $vchTypeId, $payload, (string) $command['idempotency_key']);

        if (!$response['ok']) {
            $technical = $response['error'] ?? 'Books did not accept it.';
            $businessRefusal = in_array($response['status'], [409, 422], true);
            $businessRefusal ? IntegrationCommand::block($commandId, $technical) : IntegrationCommand::fail($commandId, $technical);

            Db::update('billing_transaction_requests', [
                'status' => 'FAILED', 'last_error' => mb_substr($technical, 0, 480), 'updated_at' => self::now(),
            ], ['request_id' => $requestId]);

            // A shopkeeper is not going to read a stack trace, and the one thing
            // they need to know is that pressing Save again is safe.
            Http::error(
                $businessRefusal ? 409 : 502,
                $businessRefusal ? 'books_refused' : 'books_unavailable',
                $businessRefusal
                    ? $technical
                    : sprintf('Could not save this %s right now. No duplicate has been created — please retry.', $label),
                ['request_id' => $requestId, 'retryable' => !$businessRefusal, 'detail' => $technical],
            );
        }

        $voucher = $response['body']['data'] ?? [];
        IntegrationCommand::complete($commandId, [
            'books_voucher_id'   => $voucher['vch_txn_id'] ?? null,
            'books_voucher_uuid' => $voucher['vch_uuid'] ?? null,
            'books_voucher_no'   => $voucher['vch_no'] ?? null,
        ]);

        Db::update('billing_transaction_requests', [
            'status'             => 'POSTED',
            'books_voucher_id'   => self::id($voucher['vch_txn_id'] ?? $voucher['voucher_id'] ?? null),
            'books_voucher_uuid' => self::text($voucher['vch_uuid'] ?? $voucher['voucher_uuid'] ?? null),
            'books_voucher_no'   => self::text($voucher['vch_no'] ?? $voucher['voucher_no'] ?? null),
            'last_error'         => null,
            'updated_at'         => self::now(),
        ], ['request_id' => $requestId]);

        Audit::record($this->ctx, $this->auth, 'transaction.' . $kind, 'transaction_request', $requestId, null, [
            'books_voucher_id' => $voucher['vch_txn_id'] ?? null,
        ]);

        return $this->find($requestId);
    }

    /** @return array<string, mixed> */
    public function find(int $requestId): array
    {
        $row = Db::first(
            'SELECT * FROM billing_transaction_requests WHERE request_id = :id AND cmp_id = :cmp',
            ['id' => $requestId, 'cmp' => $this->ctx->cmpId],
        );
        if ($row === null) {
            return [];
        }
        $row['commands'] = IntegrationCommand::forEntity($this->ctx, 'transaction_request', $requestId);

        return $row;
    }

    /**
     * Requests that have not reached Books.
     *
     * Deliberately only the unfinished ones: a POSTED request is history, and the
     * list of what was actually billed is Books' register, read live. Keeping a
     * "recent bills" list here would be a second answer to that question.
     *
     * @return list<array<string, mixed>>
     */
    public function unfinished(int $limit = 50): array
    {
        [$scope, $params] = $this->ctx->scopeClause();

        return Db::all(
            "SELECT * FROM billing_transaction_requests
             WHERE {$scope} AND status IN ('PENDING', 'POSTING', 'FAILED')
             ORDER BY created_at DESC LIMIT " . (int) $limit,
            $params,
        );
    }

    /**
     * Shape what the user typed into what Books expects.
     *
     * Note what is NOT computed here: no tax amount, no CGST/SGST/IGST split, no
     * place of supply, no rounding, no input-credit decision. Books does all of
     * it. A second tax engine in a product aimed at people who do not want to
     * learn accounting is the worst possible place for one.
     *
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    private function normalise(string $kind, array $input, string $label): array
    {
        $date = self::date($input['date'] ?? $input['vch_date'] ?? null);
        $narration = self::text($input['narration'] ?? $input['notes'] ?? null);

        $base = [
            'vch_date'     => $date,
            'narration'    => $narration,
            'reference_no' => self::text($input['reference_no'] ?? null),
            'bo_id'        => $this->ctx->boId,
        ];

        return match ($kind) {
            'sale', 'purchase', 'credit_note', 'debit_note' => $base + $this->documentPayload($kind, $input, $label),
            'receipt', 'payment' => $base + $this->settlementPayload($kind, $input, $label),
            'expense' => $base + $this->expensePayload($input),
            'bank_deposit', 'bank_withdrawal', 'bank_transfer' => $base + $this->contraPayload($kind, $input),
            default => $base,
        };
    }

    /** @return array<string, mixed> */
    private function documentPayload(string $kind, array $input, string $label): array
    {
        $partyId = self::id($input['party_account_id'] ?? $input['customer_account_id'] ?? $input['supplier_account_id'] ?? null);
        if ($partyId === null) {
            Http::validationFailed(
                $kind === 'purchase' || $kind === 'debit_note'
                    ? 'Choose the supplier this purchase is from.'
                    : 'Choose the customer this bill is for.',
                ['field' => 'party_account_id'],
            );
        }

        $lines = $input['lines'] ?? [];
        if (!is_array($lines) || $lines === []) {
            Http::validationFailed('Add at least one line to this ' . $label . '.', ['field' => 'lines']);
        }

        // Only somebody with rate.override may depart from the item's own rate.
        // The check is here rather than in the UI because the UI is a courtesy.
        $mayOverrideRate = Permissions::allows($this->ctx, $this->auth, 'rate.override');
        $mayDiscount = Permissions::allows($this->ctx, $this->auth, 'discount.override');

        $inventoryLines = [];
        $serviceLines = [];
        $lineNo = 0;

        foreach ($lines as $line) {
            if (!is_array($line)) {
                continue;
            }
            $lineNo++;
            $qty = round((float) ($line['qty'] ?? $line['quantity'] ?? 0), 4);
            $rate = round((float) ($line['rate'] ?? 0), 4);
            $discountPc = round((float) ($line['discount_pc'] ?? 0), 3);

            if ($qty <= 0) {
                Http::validationFailed('Quantity must be more than zero.', ['field' => 'lines', 'line_no' => $lineNo]);
            }
            if ($discountPc > 0 && !$mayDiscount) {
                Http::forbidden('You cannot give a discount with your Billing profile.');
            }
            if (!empty($line['rate_was_changed']) && !$mayOverrideRate) {
                Http::forbidden('You cannot change the rate with your Billing profile.');
            }

            $gross = round($qty * $rate, 4);
            $amount = round($gross - ($gross * $discountPc / 100), 4);
            $itemId = self::id($line['item_id'] ?? null);

            if ($itemId === null) {
                $description = self::text($line['description'] ?? null);
                if ($description === null) {
                    Http::validationFailed('A line without an item needs a description.', ['field' => 'lines', 'line_no' => $lineNo]);
                }
                $serviceLines[] = [
                    'source_line_ref' => (string) $lineNo,
                    'description'     => $description,
                    'amount'          => $amount,
                    'tax_cat_id'      => self::id($line['tax_cat_id'] ?? null),
                ];
                continue;
            }

            $inventoryLines[] = [
                'source_line_ref' => (string) $lineNo,
                'item_id'         => $itemId,
                'unit_id'         => self::id($line['unit_id'] ?? null),
                'mc_id'           => self::id($line['warehouse_id'] ?? null),
                'batch_id'        => self::id($line['batch_id'] ?? null),
                'qty'             => $qty,
                'rate'            => $rate,
                'discount_pc'     => $discountPc,
                'amount'          => $amount,
                'tax_cat_id'      => self::id($line['tax_cat_id'] ?? null),
                'hsn_sac'         => self::text($line['hsn_sac'] ?? null),
                'description'     => self::text($line['description'] ?? null),
            ];
        }

        $payload = [
            'party_acc_id'    => $partyId,
            'inventory_lines' => $inventoryLines,
            'service_lines'   => $serviceLines,
            'payment_terms'   => self::text($input['payment_terms'] ?? null),
            'due_date'        => self::text($input['due_date'] ?? null),
        ];

        if ($kind === 'purchase' || $kind === 'debit_note') {
            $payload['supplier_invoice_no'] = self::text($input['supplier_invoice_no'] ?? null);
            $payload['supplier_invoice_date'] = self::text($input['supplier_invoice_date'] ?? null);
        }

        // A cash sale settles itself: Books is told which cash or bank account
        // received the money, and makes the receipt side of it.
        $settledTo = self::id($input['settled_to_account_id'] ?? null);
        if ($settledTo !== null) {
            $payload['settlement_account_id'] = $settledTo;
            $payload['is_cash_transaction'] = true;
        }

        if (($against = self::id($input['against_voucher_id'] ?? null)) !== null) {
            $payload['against_voucher_id'] = $against;
        }

        return $payload;
    }

    /** @return array<string, mixed> */
    private function settlementPayload(string $kind, array $input, string $label): array
    {
        $partyId = self::id($input['party_account_id'] ?? $input['customer_account_id'] ?? $input['supplier_account_id'] ?? null);
        if ($partyId === null) {
            Http::validationFailed(
                $kind === 'receipt' ? 'Choose who the money came from.' : 'Choose who the money went to.',
                ['field' => 'party_account_id'],
            );
        }

        $amount = round((float) ($input['amount'] ?? 0), 4);
        if ($amount <= 0) {
            Http::validationFailed('Enter the amount of ' . $label . '.', ['field' => 'amount']);
        }

        $accountId = self::id($input['cash_bank_account_id'] ?? null);
        if ($accountId === null) {
            Http::validationFailed(
                $kind === 'receipt' ? 'Say where the money was received — cash or which bank.' : 'Say where the money was paid from.',
                ['field' => 'cash_bank_account_id'],
            );
        }

        // Bill-by-bill allocation is Books'. We pass what the user chose; Books
        // validates it against the bills it knows are still open.
        $allocations = [];
        foreach ((array) ($input['allocations'] ?? []) as $allocation) {
            if (!is_array($allocation)) {
                continue;
            }
            $allocated = round((float) ($allocation['amount'] ?? 0), 4);
            if ($allocated <= 0) {
                continue;
            }
            $allocations[] = [
                'bill_reference' => self::text($allocation['bill_reference'] ?? $allocation['bill_no'] ?? null),
                'voucher_id'     => self::id($allocation['voucher_id'] ?? null),
                'amount'         => $allocated,
            ];
        }

        $allocatedTotal = array_sum(array_column($allocations, 'amount'));
        if ($allocatedTotal > $amount + 0.005) {
            Http::validationFailed(
                sprintf('You have allocated %s against %s.', self::money($allocatedTotal), self::money($amount)),
                ['field' => 'allocations'],
            );
        }

        return [
            'party_acc_id'         => $partyId,
            'amount'               => $amount,
            'cash_bank_account_id' => $accountId,
            'payment_mode'         => self::text($input['payment_mode'] ?? null) ?? 'cash',
            'instrument_no'        => self::text($input['instrument_no'] ?? $input['reference'] ?? null),
            'instrument_date'      => self::text($input['instrument_date'] ?? null),
            'allocations'          => $allocations,
            // Anything not allocated sits on account, which is Books' concept
            // and Books' decision — we just say how much.
            'on_account_amount'    => round($amount - $allocatedTotal, 4),
        ];
    }

    /** @return array<string, mixed> */
    private function expensePayload(array $input): array
    {
        $expenseAccountId = self::id($input['expense_account_id'] ?? null);
        if ($expenseAccountId === null) {
            Http::validationFailed('Choose what this expense is for.', ['field' => 'expense_account_id']);
        }
        $paidFrom = self::id($input['cash_bank_account_id'] ?? null);
        if ($paidFrom === null) {
            Http::validationFailed('Say what the expense was paid from.', ['field' => 'cash_bank_account_id']);
        }
        $amount = round((float) ($input['amount'] ?? 0), 4);
        if ($amount <= 0) {
            Http::validationFailed('Enter the amount of the expense.', ['field' => 'amount']);
        }

        return [
            'expense_account_id'   => $expenseAccountId,
            'cash_bank_account_id' => $paidFrom,
            'party_acc_id'         => self::id($input['party_account_id'] ?? null),
            'amount'               => $amount,
            'tax_cat_id'           => self::id($input['tax_cat_id'] ?? null),
            'attachment_ref'       => self::text($input['attachment_ref'] ?? null),
        ];
    }

    /**
     * Cash and bank movements.
     *
     * The user sees "Bank deposit" and "Bank withdrawal". Internally both are a
     * contra voucher, and which account is debited is decided from the kind
     * rather than asked — that is the simplification this product exists for.
     *
     * @return array<string, mixed>
     */
    private function contraPayload(string $kind, array $input): array
    {
        $amount = round((float) ($input['amount'] ?? 0), 4);
        if ($amount <= 0) {
            Http::validationFailed('Enter the amount to move.', ['field' => 'amount']);
        }

        $from = self::id($input['from_account_id'] ?? null);
        $to = self::id($input['to_account_id'] ?? null);

        if ($from === null || $to === null) {
            Http::validationFailed(
                match ($kind) {
                    'bank_deposit'    => 'Say which cash account the money came from and which bank it went into.',
                    'bank_withdrawal' => 'Say which bank the money came from and which cash account it went into.',
                    default           => 'Say which account the money came from and which it went to.',
                },
                ['field' => $from === null ? 'from_account_id' : 'to_account_id'],
            );
        }
        if ($from === $to) {
            Http::validationFailed('The money has to move between two different accounts.', ['field' => 'to_account_id']);
        }

        return [
            'from_account_id' => $from,
            'to_account_id'   => $to,
            'amount'          => $amount,
            'instrument_no'   => self::text($input['instrument_no'] ?? null),
            'contra_kind'     => $kind,
        ];
    }

    /**
     * Remember which items this user bills most, for the fast-entry screen.
     *
     * An id and a counter. The item's name, rate and stock stay in Inventory.
     *
     * @param array<string, mixed> $payload
     */
    private function rememberFavourites(array $payload): void
    {
        foreach ((array) ($payload['inventory_lines'] ?? []) as $line) {
            $itemId = self::id($line['item_id'] ?? null);
            if ($itemId === null) {
                continue;
            }
            try {
                Db::run(
                    'INSERT INTO billing_favourite_items (cmp_id, user_uuid, item_id, use_count, last_used_at)
                     VALUES (:cmp, :uuid, :item, 1, NOW())
                     ON CONFLICT (cmp_id, user_uuid, item_id)
                     DO UPDATE SET use_count = billing_favourite_items.use_count + 1, last_used_at = NOW()',
                    ['cmp' => $this->ctx->cmpId, 'uuid' => $this->auth->uuid, 'item' => $itemId],
                );
            } catch (\Throwable $e) {
                // A convenience, never a reason a bill fails to save.
                error_log('[billing] favourite update failed: ' . $e->getMessage());
            }
        }
    }

    private static function money(float $value): string
    {
        return '₹' . number_format($value, 2);
    }

    private static function id(mixed $value): ?int
    {
        return ($value === null || $value === '' || (int) $value === 0) ? null : (int) $value;
    }

    private static function text(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }

    private static function date(mixed $value): string
    {
        if (is_string($value) && preg_match('/^\d{4}-\d{2}-\d{2}$/', trim($value)) === 1) {
            return trim($value);
        }

        return gmdate('Y-m-d');
    }

    private static function now(): string
    {
        return gmdate('Y-m-d H:i:s');
    }
}
