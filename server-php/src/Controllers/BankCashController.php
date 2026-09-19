<?php

declare(strict_types=1);

namespace Aicountly\Api\Controllers;

use Aicountly\Api\Auth;
use Aicountly\Api\Clients\BooksClient;
use Aicountly\Api\Context;
use Aicountly\Api\Db;
use Aicountly\Api\Domain\BooksReadings;
use Aicountly\Api\Domain\Period;
use Aicountly\Api\Domain\RegisterReader;
use Aicountly\Api\Http;
use Aicountly\Api\Permissions;

/**
 * Recent movements between the business's own cash and bank accounts.
 *
 * WHY THIS IS A JOIN AND NOT A TABLE READ. Books holds the contra vouchers and
 * is the only authority for what they are worth; it does not, however, know
 * which of them the shopkeeper called "a deposit" and which "a withdrawal" —
 * to Books they are all contras, and a register row does not say which side
 * went where in a shape this product can rely on across deployments.
 *
 * Billing does know, because Billing asked for them: its request row carries
 * the kind, the two account ids and the voucher id Books handed back. So the
 * list is built from both — the register for the amount, the date and the
 * number, this product's own request log only for "which ones were deposits".
 *
 * Nothing here is a second copy of a voucher. A deposit that Books has since
 * cancelled drops out of this list on the next load, because the list is the
 * register filtered, not the request log rendered.
 *
 * THE COST. Three reads, whatever the length of the list: one register page,
 * one cash-and-bank master list for the names, one local indexed query. There
 * is deliberately no per-row lookup — a sidebar that fires five requests to
 * draw five lines is a sidebar that makes the form it sits beside feel slow.
 */
final class BankCashController extends Controller
{
    /** @var list<string> */
    private const KINDS = ['bank_deposit', 'bank_withdrawal', 'bank_transfer'];

    /**
     * How far back "recent" reaches.
     *
     * Long enough that a shop which banks once a week still has something to
     * see, short enough that one register page holds it.
     */
    private const WINDOW_DAYS = 90;

    public static function movements(): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'contra.create');

        $kind = (string) (Http::param('kind') ?? 'bank_deposit');
        if (!in_array($kind, self::KINDS, true)) {
            Http::validationFailed('Unknown money movement "' . $kind . '".', ['field' => 'kind']);
        }
        $limit = max(1, min(20, Http::intParam('limit', 5) ?? 5));

        $to = Period::resolve(['key' => 'today'])->today();
        $from = (new \DateTimeImmutable($to))->modify('-' . self::WINDOW_DAYS . ' days')->format('Y-m-d');

        $books = (new BooksClient())->withSession($auth->sesKey());
        $reading = (new RegisterReader($ctx, $books))->read(BooksClient::VCH_CONTRA, $from, $to);

        if (!$reading['available']) {
            // Said plainly, with the retry left to the caller. An empty list
            // here would read on screen as "you have never banked anything".
            Http::data([
                'available'  => false,
                'reason'     => 'Smart Books did not answer, so recent entries could not be read.',
                'kind'       => $kind,
                'from'       => $from,
                'to'         => $to,
                'movements'  => [],
                'complete'   => false,
                'source'     => 'books',
            ]);
        }

        $posted = self::postedRequests($ctx, $kind, $from);
        if ($posted === []) {
            Http::data(self::envelope($kind, $from, $to, [], $reading['complete']));
        }

        $vouchers = [];
        foreach ($reading['rows'] as $row) {
            $voucherId = BooksReadings::voucherId($row);
            if ($voucherId !== null) {
                $vouchers[$voucherId] = $row;
            }
        }

        $names = self::accountNames($ctx, $auth);

        $movements = [];
        foreach ($posted as $request) {
            $voucherId = (int) $request['books_voucher_id'];
            $row = $vouchers[$voucherId] ?? null;
            if ($row === null) {
                // Posted here, not in the register for this window: either
                // cancelled in Books or dated outside it. Either way it is not
                // ours to assert, so it is left out rather than guessed at.
                continue;
            }

            $payload = Db::jsonColumn($request['payload']);
            $fromId = isset($payload['from_account_id']) ? (int) $payload['from_account_id'] : null;
            $toId = isset($payload['to_account_id']) ? (int) $payload['to_account_id'] : null;

            $movements[] = [
                'request_id'        => (int) $request['request_id'],
                'voucher_id'        => $voucherId,
                'voucher_no'        => BooksReadings::voucherNumber($row) ?? $request['books_voucher_no'],
                'date'              => BooksReadings::voucherDate($row) ?? $request['transaction_date'],
                // Null when the register spells the amount under a key this
                // product does not know. The screen then shows the entry
                // without a figure rather than showing a zero.
                'amount'            => BooksReadings::voucherAmount($row),
                'kind'              => $kind,
                'payment_mode'      => $payload['payment_mode'] ?? 'cash',
                'reference'         => $payload['instrument_no'] ?? null,
                'from_account_id'   => $fromId,
                'from_account_name' => $fromId !== null ? ($names[$fromId] ?? null) : null,
                'to_account_id'     => $toId,
                'to_account_name'   => $toId !== null ? ($names[$toId] ?? null) : null,
            ];

            if (count($movements) >= $limit) {
                break;
            }
        }

        Http::data(self::envelope($kind, $from, $to, $movements, $reading['complete']));
    }

    /**
     * @param list<array<string, mixed>> $movements
     * @return array<string, mixed>
     */
    private static function envelope(string $kind, string $from, string $to, array $movements, bool $complete): array
    {
        return [
            'available' => true,
            'reason'    => null,
            'kind'      => $kind,
            'from'      => $from,
            'to'        => $to,
            'movements' => $movements,
            'complete'  => $complete,
            'source'    => 'books',
            'note'      => 'Read from Smart Books just now, for entries recorded here since ' . $from . '.'
                . ($complete ? '' : ' More entries exist in this window than could be read at once.')
                . ' An entry made directly in Smart Books is not listed.',
        ];
    }

    /**
     * This product's own requests of one kind that reached Books.
     *
     * The only thing taken from these rows is which voucher was which kind of
     * movement, and the two account ids the user chose. The money comes from
     * the register.
     *
     * @return list<array<string, mixed>>
     */
    private static function postedRequests(Context $ctx, string $kind, string $from): array
    {
        [$scope, $params] = $ctx->scopeClause();

        return Db::all(
            "SELECT request_id, books_voucher_id, books_voucher_no, transaction_date, payload
             FROM billing_transaction_requests
             WHERE {$scope}
               AND kind = :kind
               AND status = 'POSTED'
               AND books_voucher_id IS NOT NULL
               AND transaction_date >= :from
             ORDER BY transaction_date DESC, request_id DESC
             LIMIT 200",
            $params + ['kind' => $kind, 'from' => $from],
        );
    }

    /**
     * Cash and bank account names, in one call.
     *
     * The same list the pickers on the form are filled from, so a name on the
     * recent list and a name in the dropdown cannot disagree.
     *
     * @return array<int, string>
     */
    private static function accountNames(Context $ctx, Auth $auth): array
    {
        $response = (new BooksClient())->withSession($auth->sesKey())->accounts($ctx, [
            'nature' => 'cash_bank',
            'limit'  => 100,
        ]);
        if (!$response['ok']) {
            return [];
        }

        $names = [];
        foreach (BooksReadings::rows($response['body']) as $row) {
            $id = BooksReadings::id($row, ['acc_id', 'account_id', 'id']);
            $name = BooksReadings::text($row, ['acc_name', 'account_name', 'name']);
            if ($id !== null && $name !== null) {
                $names[$id] = $name;
            }
        }

        return $names;
    }
}
