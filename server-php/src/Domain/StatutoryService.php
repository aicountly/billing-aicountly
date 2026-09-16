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
 * e-Invoice and e-Way Bill.
 *
 * Billing builds NO statutory engine. Smart Books already talks to the IRP,
 * holds the credentials, signs the payload, keeps the IRN and handles a
 * cancellation inside the legal window. What this product adds is a button in a
 * place a shopkeeper will find, and one action that does both at once — which is
 * how most goods actually leave a shop.
 *
 * There is no IRN ledger here and no e-Way register. The status shown on screen
 * is read from Books each time it is displayed.
 */
final class StatutoryService
{
    public const COMMAND_EINVOICE = 'billing.einvoice.generate';
    public const COMMAND_EWAY     = 'billing.eway.generate';

    public function __construct(
        private readonly Context $ctx,
        private readonly Auth $auth,
    ) {
    }

    /** Live status for a voucher — never stored. */
    public function status(int $voucherId): array
    {
        $books = (new BooksClient())->withSession($this->auth->sesKey());

        $eInvoice = $books->eInvoiceStatus($this->ctx, $voucherId);
        $eWay = $books->eWayBillStatus($this->ctx, $voucherId);

        return [
            'voucher_id' => $voucherId,
            'e_invoice'  => $eInvoice['ok'] ? ($eInvoice['body']['data'] ?? null) : null,
            'e_way_bill' => $eWay['ok'] ? ($eWay['body']['data'] ?? null) : null,
            'reachable'  => $eInvoice['ok'] || $eWay['ok'],
            'source'     => 'books',
        ];
    }

    /**
     * Generate an e-Invoice, an e-Way Bill, or both.
     *
     * Both is one user action because that is one real-world event: the goods are
     * going out now and the lorry is waiting. Doing them as two screens is how a
     * consignment leaves with one document and not the other.
     *
     * @param array<string, mixed> $input
     */
    public function generate(int $requestId, string $what, array $input): array
    {
        $request = Db::first(
            'SELECT * FROM billing_transaction_requests WHERE request_id = :id AND cmp_id = :cmp',
            ['id' => $requestId, 'cmp' => $this->ctx->cmpId],
        );
        if ($request === null) {
            Http::notFound('That bill does not exist.');
        }
        if ($request['status'] !== 'POSTED' || $request['books_voucher_id'] === null) {
            Http::conflict('Save the bill first — an e-Invoice is raised against a posted invoice.');
        }

        $voucherId = (int) $request['books_voucher_id'];
        $books = (new BooksClient())->withService($this->auth->uuid);
        $result = ['voucher_id' => $voucherId];

        if ($what === 'einvoice' || $what === 'both') {
            Permissions::assert($this->ctx, $this->auth, 'einvoice.generate');
            $result['e_invoice'] = $this->run(
                $books,
                $requestId,
                self::COMMAND_EINVOICE,
                'e-Invoice',
                fn (string $key) => $books->generateEInvoice($this->ctx, $voucherId, $key),
            );
        }

        if ($what === 'eway' || $what === 'both') {
            Permissions::assert($this->ctx, $this->auth, 'eway.generate');

            $transport = $this->transportFields($input);
            $result['e_way_bill'] = $this->run(
                $books,
                $requestId,
                self::COMMAND_EWAY,
                'e-Way Bill',
                fn (string $key) => $books->generateEWayBill($this->ctx, $voucherId, $transport, $key),
            );
        }

        Audit::record($this->ctx, $this->auth, 'statutory.' . $what, 'transaction_request', $requestId, null, $result);

        return $result;
    }

    /**
     * @param callable(string): array{ok:bool, status:int, body:?array, error:?string} $call
     * @return array<string, mixed>
     */
    private function run(BooksClient $books, int $requestId, string $commandType, string $label, callable $call): array
    {
        $command = IntegrationCommand::open(
            $this->ctx,
            'books',
            $commandType,
            'transaction_request',
            $requestId,
            ['label' => $label],
        );

        if (($command['status'] ?? '') === IntegrationCommand::COMPLETED) {
            // Already generated. Reporting it as done is right; asking the IRP
            // again would be refused anyway and would look like a failure.
            return ['status' => 'ALREADY_GENERATED', 'reference' => Db::jsonColumn($command['external_reference'] ?? null)];
        }

        $commandId = (int) $command['command_id'];
        IntegrationCommand::markPosting($commandId);

        $response = $call((string) $command['idempotency_key']);

        if (!$response['ok']) {
            $technical = $response['error'] ?? ($label . ' could not be generated.');
            $businessRefusal = in_array($response['status'], [409, 422], true);
            $businessRefusal ? IntegrationCommand::block($commandId, $technical) : IntegrationCommand::fail($commandId, $technical);

            return [
                'status'    => $businessRefusal ? 'REFUSED' : 'FAILED',
                // The IRP's own reason is the useful part — it names the field
                // that is wrong far better than we could paraphrase it.
                'message'   => $businessRefusal
                    ? $technical
                    : 'Could not reach the ' . $label . ' service. Nothing has been generated — please retry.',
                'retryable' => !$businessRefusal,
            ];
        }

        $data = $response['body']['data'] ?? [];
        IntegrationCommand::complete($commandId, [
            'irn'           => $data['irn'] ?? null,
            'ack_no'        => $data['ack_no'] ?? null,
            'eway_bill_no'  => $data['eway_bill_no'] ?? $data['ewb_no'] ?? null,
        ]);

        return ['status' => 'GENERATED', 'data' => $data];
    }

    /** @param array<string, mixed> $input */
    private function transportFields(array $input): array
    {
        $mode = self::text($input['transport_mode'] ?? null) ?? 'road';
        $vehicle = self::text($input['vehicle_no'] ?? null);

        // The IRP refuses a road e-Way Bill with no vehicle, and its message is
        // opaque. Saying so here saves the user a round trip they will not
        // understand.
        if ($mode === 'road' && $vehicle === null && self::text($input['transporter_id'] ?? null) === null) {
            Http::validationFailed(
                'For road transport, give either the vehicle number or the transporter ID.',
                ['field' => 'vehicle_no'],
            );
        }

        return array_filter([
            'transport_mode'  => $mode,
            'vehicle_no'      => $vehicle,
            'transporter_id'  => self::text($input['transporter_id'] ?? null),
            'transporter_name' => self::text($input['transporter_name'] ?? null),
            'transport_doc_no' => self::text($input['transport_doc_no'] ?? null),
            'transport_doc_date' => self::text($input['transport_doc_date'] ?? null),
            'distance_km'     => isset($input['distance_km']) ? (int) $input['distance_km'] : null,
            'ship_from'       => is_array($input['ship_from'] ?? null) ? $input['ship_from'] : null,
            'ship_to'         => is_array($input['ship_to'] ?? null) ? $input['ship_to'] : null,
        ], static fn ($value) => $value !== null);
    }

    private static function text(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }
}
