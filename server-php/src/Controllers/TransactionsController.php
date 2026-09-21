<?php

declare(strict_types=1);

namespace Aicountly\Api\Controllers;

use Aicountly\Api\Clients\BooksClient;
use Aicountly\Api\Domain\CreditNoteContext;
use Aicountly\Api\Domain\Period;
use Aicountly\Api\Domain\RegisterReader;
use Aicountly\Api\Domain\StatutoryService;
use Aicountly\Api\Domain\TransactionService;
use Aicountly\Api\Http;
use Aicountly\Api\Permissions;

/**
 * One route per thing a user can record, all going through one service.
 *
 * The URLs use the accounting names (`sale`, `receipt`, `contra`) because that
 * is what the API is; the SCREENS use the shopkeeper's names ("Money received",
 * "Bank deposit"), which is what the product is for.
 */
final class TransactionsController extends Controller
{
    public static function create(string $kind): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new TransactionService($ctx, $auth))->create($kind, Http::body()), 201);
    }

    /**
     * Save a transaction WITHOUT sending it to Books.
     *
     * The counter's answer to an interruption. What is typed goes to the server
     * under the same validation a real save runs, and stays there as a request
     * nobody has posted — not in a browser, where a day's takings would belong
     * to one machine.
     */
    public static function saveDraft(string $kind): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new TransactionService($ctx, $auth))->draft($kind, Http::body()), 201);
    }

    /** Replace what a draft holds. Refused once it has been posted. */
    public static function updateDraft(string $id): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new TransactionService($ctx, $auth))->updateDraft((int) $id, Http::body()));
    }

    public static function show(string $id): void
    {
        [$auth, $ctx] = self::enter();

        $request = (new TransactionService($ctx, $auth))->find((int) $id);
        if ($request === []) {
            Http::notFound('That transaction does not exist.');
        }

        Http::data($request);
    }

    /** Retry a save that did not reach Books, on its original idempotency key. */
    public static function retry(string $id): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new TransactionService($ctx, $auth))->post((int) $id));
    }

    /**
     * Transactions that have not reached Books.
     *
     * Deliberately only the unfinished ones — the list of what was actually
     * billed is Books' register, read live.
     */
    public static function unfinished(): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new TransactionService($ctx, $auth))->unfinished(Http::intParam('limit', 50) ?? 50));
    }

    /**
     * Documents a credit or debit note can be raised against.
     *
     * A note without its original is a note nobody can match to anything: the
     * customer rings about invoice 214 and the credit sits on the account
     * unattached. Books owns the original, so the list is read from its register
     * on this request — there is no Billing copy of an invoice to pick from.
     *
     * Filtered to the party here rather than trusting the register to do it,
     * because not every deployment's register takes a party filter, and a list
     * that quietly includes somebody else's invoices is worse than a slow one.
     */
    public static function originalDocuments(): void
    {
        [$auth, $ctx] = self::enter();

        $against = Http::param('kind') === 'purchase' ? 'purchase' : 'sale';
        Permissions::assert($ctx, $auth, $against === 'purchase' ? 'debit_note.create' : 'credit_note.create');

        $partyId = Http::intParam('party_account_id');
        if ($partyId === null) {
            Http::validationFailed('Choose the party first.', ['field' => 'party_account_id']);
        }

        // A year back by default. A note against something older is possible but
        // rare enough that asking for the dates is better than reading a decade.
        $period = Period::resolve([
            'from' => Http::param('from') ?? gmdate('Y-m-d', strtotime('-1 year')),
            'to'   => Http::param('to') ?? gmdate('Y-m-d'),
        ]);

        $books = (new BooksClient())->withSession($auth->sesKey());
        $reading = (new RegisterReader($ctx, $books))->read(
            $against === 'purchase' ? BooksClient::VCH_PURCHASE : BooksClient::VCH_SALES,
            $period->from,
            $period->to,
        );

        if (!$reading['available']) {
            Http::error(503, 'books_unavailable', 'Could not reach Smart Books for the original documents. Please retry.');
        }

        // How much of each one is still unpaid. A missing column, never a
        // failed request: picking the invoice to credit does not depend on it.
        $context = new CreditNoteContext($ctx, $books);
        $outstanding = $context->outstanding($partyId, $against === 'purchase' ? 'creditor' : 'debtor');

        $documents = [];
        foreach (RegisterReader::documents($reading, 500) as $document) {
            if ($document['party_id'] !== null && $document['party_id'] !== $partyId) {
                continue;
            }
            $document['outstanding'] = self::outstandingFor($document, $outstanding);
            $documents[] = $document;
        }

        Http::data([
            'party_account_id' => $partyId,
            'from'      => $period->from,
            'to'        => $period->to,
            'documents' => array_slice($documents, 0, 50),
            'complete'  => $reading['complete'],
            'outstanding_available' => $outstanding['available'],
            'source'    => 'books',
            'note'      => $reading['complete']
                ? 'Read from Smart Books just now.'
                : 'Read from Smart Books just now. More documents exist in this range than could be read at once — narrow the dates if the one you want is missing.',
        ]);
    }

    /**
     * One original document, WITH the lines that were billed on it.
     *
     * This is what lets a credit note start from the invoice rather than from
     * an empty table: the items, quantities and rates come back as Books has
     * them, and the screen proposes returning what was sold. Books is still
     * the authority on what may actually be credited — the quantities here
     * describe the invoice, they are not a permission to credit them.
     */
    public static function originalDocument(string $voucherId): void
    {
        [$auth, $ctx] = self::enter();

        $against = Http::param('kind') === 'purchase' ? 'purchase' : 'sale';
        Permissions::assert($ctx, $auth, $against === 'purchase' ? 'debit_note.create' : 'credit_note.create');

        $id = (int) $voucherId;
        if ($id <= 0) {
            Http::validationFailed('That is not a document reference.', ['field' => 'voucher_id']);
        }

        $books = (new BooksClient())->withSession($auth->sesKey());
        $invoice = (new CreditNoteContext($ctx, $books))->invoice($id);

        if (!$invoice['available']) {
            Http::error(503, 'books_unavailable', (string) $invoice['reason']);
        }

        Http::data($invoice);
    }

    /**
     * Credit notes raised this month, against the window before it.
     *
     * Books' own register, counted live. Unavailable rather than zero when it
     * cannot be proved: "no credit notes this month" and "we could not read
     * the register" are different facts and only one of them is good news.
     */
    public static function creditNoteTrend(): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'credit_note.create');

        Http::data((new CreditNoteContext($ctx, (new BooksClient())->withSession($auth->sesKey())))->trend());
    }

    /**
     * The unpaid balance on one register row.
     *
     * Matched on the voucher id first and the document number second, because
     * the two reports do not always identify a bill the same way.
     *
     * @param array<string, mixed> $document
     * @param array{available:bool, by_voucher:array<int,float>, by_number:array<string,float>} $outstanding
     */
    private static function outstandingFor(array $document, array $outstanding): ?float
    {
        if (!$outstanding['available']) {
            return null;
        }

        $voucherId = $document['voucher_id'] ?? null;
        if (is_int($voucherId) && isset($outstanding['by_voucher'][$voucherId])) {
            return $outstanding['by_voucher'][$voucherId];
        }

        $number = $document['document_no'] ?? null;
        if (is_string($number) && isset($outstanding['by_number'][$number])) {
            return $outstanding['by_number'][$number];
        }

        // Books answered and this bill is not in the open list, which means it
        // is settled. Nought here is a fact, not a missing reading.
        return 0.0;
    }

    public static function statutoryStatus(string $id): void
    {
        [$auth, $ctx] = self::enter();

        $request = (new TransactionService($ctx, $auth))->find((int) $id);
        if ($request === [] || $request['books_voucher_id'] === null) {
            Http::notFound('That bill has not been posted yet.');
        }

        Http::data((new StatutoryService($ctx, $auth))->status((int) $request['books_voucher_id']));
    }

    /** `what` is einvoice | eway | both. */
    public static function generateStatutory(string $id, string $what): void
    {
        [$auth, $ctx] = self::enter();

        if (!in_array($what, ['einvoice', 'eway', 'both'], true)) {
            Http::validationFailed('Ask for einvoice, eway or both.');
        }

        Http::data((new StatutoryService($ctx, $auth))->generate((int) $id, $what, Http::body()));
    }
}
