<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

use Aicountly\Api\Auth;
use Aicountly\Api\Clients\BooksClient;
use Aicountly\Api\Context;
use Aicountly\Api\Http;
use Aicountly\Api\Permissions;

/**
 * The party directory — customers and suppliers, composed live from Books.
 *
 * SMART BOOKS OWNS THE PARTY. There is no billing_parties table, no
 * billing_customers, no shadow copy and no synchronisation job. Every row this
 * service returns was read from Books' own `masters/accounts` on the request
 * that produced it, and every balance beside it was read from Books'
 * `reports/bill-by-bill` on the same request. Nothing here is written down.
 *
 * What this service adds over relaying that endpoint straight through is the
 * three things a directory screen needs and one ledger list cannot give:
 *
 *  1. ONE SHAPE. Books spells a party's state `state`, `state_name` or
 *     `place_of_supply` depending on the deployment. The screen should not
 *     know that, so the guessing happens once, here.
 *  2. THE BALANCE BESIDE THE NAME. Outstanding is not a field on a ledger
 *     account; it is the sum of that account's open bills. Billing composes it
 *     per request rather than storing it, which is why it cannot go stale.
 *  3. AN HONEST TOTAL. A figure derived from one page of a paginated list is
 *     not a total, and this service will not report one as though it were:
 *     anything it could not count completely comes back null, with
 *     `complete: false` beside it, and the screen says so.
 *
 * Cost is bounded deliberately. The cheap path — one side, no filter Books
 * cannot apply itself — is a single upstream page. Anything else scans, in
 * chunks, up to SCAN_MAX rows per side and then stops and admits it stopped.
 */
final class PartyDirectory
{
    /** One upstream page while scanning. Large enough to be few calls, small enough to come back. */
    private const CHUNK = 200;

    /**
     * The most rows this service will read per side before it gives up counting.
     *
     * A directory that silently returns the first thousand of four thousand
     * parties is worse than one that says it could not read them all, so the
     * limit is paired with `complete` on every answer that depends on it.
     */
    private const SCAN_MAX = 1000;

    /** Sorts that Books cannot do for us, and so force a scan. */
    private const LOCAL_SORTS = ['outstanding', 'overdue', 'credit_limit', 'last_transaction', 'state'];

    /** @var array<int, array<string, mixed>>|null */
    private ?array $duesByAccount = null;

    /** @var array{receivable: ?array<string, mixed>, payable: ?array<string, mixed>}|null */
    private ?array $duesCache = null;

    /** @var array<string, array{rows: list<array<string, mixed>>, total: ?int, complete: bool}> */
    private array $scans = [];

    public function __construct(
        private readonly Context $ctx,
        private readonly Auth $auth,
    ) {
    }

    // -----------------------------------------------------------------------
    // Who may see which half of the directory
    // -----------------------------------------------------------------------

    /**
     * Customers are visible to anyone who sells or chases what is owed.
     *
     * The menu entry for this screen asks for `sale.view`; these are the same
     * permissions the receivables and payables screens check, so a profile that
     * may open one of those and not the other sees exactly one half here
     * instead of an empty screen or a 403.
     */
    public function maySeeCustomers(): bool
    {
        return Permissions::allows($this->ctx, $this->auth, 'sale.view')
            || Permissions::allows($this->ctx, $this->auth, 'receivable.view');
    }

    public function maySeeSuppliers(): bool
    {
        return Permissions::allows($this->ctx, $this->auth, 'purchase.view')
            || Permissions::allows($this->ctx, $this->auth, 'payable.view');
    }

    /**
     * The sides a request actually reads, after permissions.
     *
     * Asking for suppliers without the profile for them returns no suppliers —
     * not somebody else's idea of a useful fallback.
     *
     * @return list<string>
     */
    public function sidesFor(string $requested): array
    {
        $wanted = match ($requested) {
            'customer' => ['customer'],
            'supplier' => ['supplier'],
            default    => ['customer', 'supplier'],
        };

        return array_values(array_filter(
            $wanted,
            fn (string $side) => $side === 'customer' ? $this->maySeeCustomers() : $this->maySeeSuppliers(),
        ));
    }

    // -----------------------------------------------------------------------
    // The list
    // -----------------------------------------------------------------------

    /**
     * One page of the directory.
     *
     * @param array<string, mixed> $query
     * @return array{rows: list<array<string, mixed>>, total: ?int, complete: bool, sides: list<string>, scanned: bool}
     */
    public function page(array $query): array
    {
        $sides  = $this->sidesFor((string) ($query['side'] ?? 'all'));
        $limit  = max(1, min(200, (int) ($query['limit'] ?? 20)));
        $offset = max(0, (int) ($query['offset'] ?? 0));
        $search = self::trimmedOrNull($query['q'] ?? null);

        if ($sides === []) {
            return ['rows' => [], 'total' => 0, 'complete' => true, 'sides' => [], 'scanned' => false];
        }

        // The cheap path: Books can paginate this itself, so it does.
        if (count($sides) === 1 && !$this->needsScan($query)) {
            $read = $this->fetchSide($sides[0], $limit, $offset, $search);
            // Ordered again here rather than only asked for above. `sort` is a
            // hint to Books, and a hint an older deployment may not act on; a
            // page that arrives in the order its rows were created must still
            // read alphabetically under a header that says it is sorted.
            $rows = self::sortRows($this->withDues($read['rows']), 'name', 'asc');

            return [
                'rows'     => $rows,
                'total'    => $read['total'],
                'complete' => true,
                'sides'    => $sides,
                'scanned'  => false,
            ];
        }

        $rows = [];
        $total = 0;
        $complete = true;

        foreach ($sides as $side) {
            $scan = $this->scanSide($side, $search);
            $rows = array_merge($rows, $scan['rows']);
            $complete = $complete && $scan['complete'];
            if ($scan['total'] === null) {
                $complete = false;
            } else {
                $total += $scan['total'];
            }
        }

        $rows = $this->withDues($rows);
        $rows = $this->applyFilters($rows, $query);

        // After filtering, the honest total is the number of rows that matched
        // — but only if every row was read. A partial scan can say how many it
        // matched and must not call that a total.
        $matched = count($rows);
        $rows = self::sortRows($rows, (string) ($query['sort'] ?? 'name'), (string) ($query['order'] ?? 'asc'));

        return [
            'rows'     => array_slice($rows, $offset, $limit),
            'total'    => $complete ? $matched : null,
            'complete' => $complete,
            'sides'    => $sides,
            'scanned'  => true,
        ];
    }

    /**
     * Every row the current filters match, for the CSV export.
     *
     * Capped by the same scan limit as everything else: an export that silently
     * stops at a thousand rows is a spreadsheet somebody will reconcile against.
     *
     * @param array<string, mixed> $query
     * @return array{rows: list<array<string, mixed>>, complete: bool}
     */
    public function all(array $query): array
    {
        $sides = $this->sidesFor((string) ($query['side'] ?? 'all'));
        $search = self::trimmedOrNull($query['q'] ?? null);

        $rows = [];
        $complete = true;
        foreach ($sides as $side) {
            $scan = $this->scanSide($side, $search);
            $rows = array_merge($rows, $scan['rows']);
            $complete = $complete && $scan['complete'];
        }

        $rows = $this->applyFilters($this->withDues($rows), $query);

        return [
            'rows'     => self::sortRows($rows, (string) ($query['sort'] ?? 'name'), (string) ($query['order'] ?? 'asc')),
            'complete' => $complete,
        ];
    }

    // -----------------------------------------------------------------------
    // The figures above the list
    // -----------------------------------------------------------------------

    /**
     * The overview cards, the filter options, and the insights under them.
     *
     * Every figure here is either counted from a complete reading or returned
     * as null. There is no third option and no estimate: a card that says
     * "—, could not be counted" is useful, and a card showing the size of the
     * first page as though it were the size of the business is not.
     *
     * @return array<string, mixed>
     */
    public function overview(): array
    {
        $sides = $this->sidesFor('all');
        $counts = ['customer' => null, 'supplier' => null];
        $rows = [];
        $complete = $sides !== [];

        foreach ($sides as $side) {
            $scan = $this->scanSide($side, null);
            $counts[$side] = $scan['total'];
            $rows = array_merge($rows, $scan['rows']);
            $complete = $complete && $scan['complete'] && $scan['total'] !== null;
        }

        $rows = $this->withDues($rows);
        $dues = $this->duesReadings();

        $active = 0;
        $inactive = 0;
        $statusKnown = 0;
        $creditLimit = 0.0;
        $creditLimitKnown = false;
        $overLimit = 0;
        $gstRegistered = 0;
        $gstKnown = false;
        $withoutActivity = 0;
        $activityKnown = 0;
        $ninetyDaysAgo = (new \DateTimeImmutable('today'))->modify('-90 days')->format('Y-m-d');

        foreach ($rows as $row) {
            if ($row['status'] !== null) {
                $statusKnown++;
                $row['status'] === 'active' ? $active++ : $inactive++;
            }
            if ($row['credit_limit'] !== null) {
                $creditLimitKnown = true;
                $creditLimit += (float) $row['credit_limit'];
                if ($row['outstanding'] !== null && (float) $row['credit_limit'] > 0 && (float) $row['outstanding'] > (float) $row['credit_limit']) {
                    $overLimit++;
                }
            }
            if (array_key_exists('gstin', $row)) {
                $gstKnown = true;
                if (self::isNonEmptyString($row['gstin'])) {
                    $gstRegistered++;
                }
            }
            if ($row['last_transaction_at'] !== null) {
                $activityKnown++;
                if ($row['last_transaction_at'] < $ninetyDaysAgo) {
                    $withoutActivity++;
                }
            }
        }

        // A total is the sum of the sides this profile may see, and only when
        // every one of them answered with a count of its own.
        $counted = array_map(static fn (string $side) => $counts[$side], $sides);
        $total = in_array(null, $counted, true) ? null : (int) array_sum($counted);

        $duplicates = $this->duplicateGroups($rows);

        return [
            'total_parties'  => $total,
            'customers'      => $counts['customer'],
            'suppliers'      => $counts['supplier'],
            // Active is a count of the parties whose status Books actually
            // stated. When it states none, the card says so instead of
            // reporting every party as active.
            'active_parties' => $statusKnown > 0 && $complete ? $active : null,
            'inactive_parties' => $statusKnown > 0 && $complete ? $inactive : null,
            'status_known'   => $statusKnown,
            'active_percentage' => $statusKnown > 0 && $complete
                ? (int) round(($active / $statusKnown) * 100)
                : null,
            // Credit limit is a field on the ledger account. Where Books does
            // not carry it, this is null and the card reads "Not provided".
            'credit_limit_exposure' => $creditLimitKnown && $complete ? round($creditLimit, 2) : null,
            'parties_over_limit'    => $creditLimitKnown && $complete ? $overLimit : null,
            'gst_registered'        => $gstKnown && $complete ? $gstRegistered : null,
            'without_activity_90d'  => $activityKnown > 0 && $complete ? $withoutActivity : null,
            'overdue_receivables'   => $dues['receivable']['overdue'] ?? null,
            'total_receivable'      => $dues['receivable']['total'] ?? null,
            'total_payable'         => $dues['payable']['total'] ?? null,
            'overdue_payables'      => $dues['payable']['overdue'] ?? null,
            'duplicate_groups'      => $complete ? count($duplicates) : null,
            'complete'              => $complete,
            'facets'                => $this->facets($rows, $complete),
            'insights'              => $this->insights($rows, $complete, $overLimit, $creditLimitKnown, $withoutActivity, $activityKnown),
            'may_see_customers'     => $this->maySeeCustomers(),
            'may_see_suppliers'     => $this->maySeeSuppliers(),
            'source'                => 'books',
            'note'                  => 'Counted from Smart Books on this request. Billing keeps no party list of its own.',
        ];
    }

    /**
     * Parties that look like the same party twice.
     *
     * Only exact, checkable evidence: the same GSTIN, the same phone number,
     * the same email address, or the same name once case and punctuation are
     * set aside. Nothing is merged and nothing is scored — a confidence
     * percentage cannot be checked by the person being asked to act on it,
     * and the reason can.
     *
     * @return array{groups: list<array<string, mixed>>, complete: bool}
     */
    public function duplicates(): array
    {
        $rows = [];
        $complete = true;
        foreach ($this->sidesFor('all') as $side) {
            $scan = $this->scanSide($side, null);
            $rows = array_merge($rows, $scan['rows']);
            $complete = $complete && $scan['complete'];
        }

        return ['groups' => $this->duplicateGroups($this->withDues($rows)), 'complete' => $complete];
    }

    // -----------------------------------------------------------------------
    // Reading Books
    // -----------------------------------------------------------------------

    /**
     * One upstream page of one side.
     *
     * @return array{rows: list<array<string, mixed>>, total: ?int}
     */
    private function fetchSide(string $side, int $limit, int $offset, ?string $search): array
    {
        $response = (new BooksClient())->withSession($this->auth->sesKey())->accounts($this->ctx, [
            'q'          => $search,
            'limit'      => $limit,
            'offset'     => $offset,
            // Asked for by name so a Books that can order a page does; nothing
            // downstream depends on it having been honoured.
            'sort'       => 'name',
            'order'      => 'asc',
            'party_type' => $side === 'supplier' ? 'creditor' : 'debtor',
            'nature'     => $side === 'supplier' ? 'sundry_creditors' : 'sundry_debtors',
        ]);

        if (!$response['ok']) {
            // Halt rather than return an empty page. A directory that answers
            // "no parties" when the product that holds them was unreachable is
            // the one failure a user cannot tell from a new company.
            $unreachable = $response['status'] === 0 || $response['status'] >= 500;
            Http::error(
                $unreachable ? 503 : $response['status'],
                $unreachable ? 'books_unavailable' : 'books_refused',
                $unreachable
                    ? 'Could not reach Smart Books for the party list. Please try again in a moment.'
                    : 'Smart Books would not give the party list for this company.',
            );
        }

        $rows = [];
        foreach (BooksReadings::rows($response['body']) as $row) {
            $party = $this->normalise($row, $side);
            if ($party !== null) {
                $rows[] = $party;
            }
        }

        return ['rows' => $rows, 'total' => BooksReadings::total($response['body'])];
    }

    /**
     * Every row of one side, in chunks, up to SCAN_MAX.
     *
     * Memoised for the life of the request — the list, the overview and the
     * duplicate check all want the same reading and there is no reason to ask
     * Books three times for it. Nothing survives the response.
     *
     * @return array{rows: list<array<string, mixed>>, total: ?int, complete: bool}
     */
    private function scanSide(string $side, ?string $search): array
    {
        $key = $side . '|' . ($search ?? '');
        if (isset($this->scans[$key])) {
            return $this->scans[$key];
        }

        $rows = [];
        $offset = 0;
        $total = null;
        $complete = true;

        while (true) {
            $page = $this->fetchSide($side, self::CHUNK, $offset, $search);
            $total ??= $page['total'];
            $rows = array_merge($rows, $page['rows']);

            // Short of a full chunk means the far end has run out, which is the
            // only reliable end-of-list signal when meta.total is absent.
            if (count($page['rows']) < self::CHUNK) {
                break;
            }
            $offset += self::CHUNK;
            if ($offset >= self::SCAN_MAX) {
                $complete = false;
                break;
            }
        }

        if ($total !== null && count($rows) < $total) {
            $complete = false;
        }

        return $this->scans[$key] = [
            'rows'     => $rows,
            'total'    => $total ?? count($rows),
            'complete' => $complete,
        ];
    }

    /**
     * Books' account row, in one shape.
     *
     * Absent is null, never zero and never an empty string standing in for a
     * value nobody supplied: the screen draws "—" for a field Books does not
     * carry, and "₹ 0.00" only where Books actually said nought.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>|null
     */
    private function normalise(array $row, string $side): ?array
    {
        $id = BooksReadings::id($row, ['acc_id', 'account_id', 'id', 'ledger_id']);
        $name = BooksReadings::text($row, ['acc_name', 'account_name', 'name', 'ledger_name', 'party_name']);
        if ($id === null || $name === null) {
            return null;
        }

        $status = self::statusOf($row);

        return [
            'account_id'   => $id,
            'name'         => $name,
            'type'         => $side,
            'gstin'        => BooksReadings::text($row, ['gstin', 'gst_no', 'gst_number', 'party_gstin', 'tax_registration_no']),
            'pan'          => BooksReadings::text($row, ['pan', 'pan_no', 'pan_number', 'income_tax_no']),
            'phone'        => BooksReadings::text($row, ['phone', 'mobile', 'contact_no', 'phone_no', 'mobile_no', 'contact_number']),
            'email'        => BooksReadings::text($row, ['email', 'email_id', 'contact_email']),
            'city'         => BooksReadings::text($row, ['city', 'city_name', 'town', 'district']),
            'state'        => BooksReadings::text($row, ['state', 'state_name', 'place_of_supply', 'billing_state', 'state_of_supply']),
            'group'        => BooksReadings::text($row, ['group_name', 'acc_group', 'account_group', 'party_group', 'group', 'grp_name']),
            'credit_limit' => BooksReadings::number($row, ['credit_limit', 'credit_limit_amount', 'party_credit_limit']),
            'credit_days'  => BooksReadings::number($row, ['credit_days', 'credit_period', 'payment_terms_days']),
            'status'       => $status,
            'last_transaction_at' => BooksReadings::date($row, ['last_transaction_date', 'last_voucher_date', 'last_txn_date', 'last_activity_at']),
            'updated_at'   => BooksReadings::date($row, ['updated_at', 'modified_at', 'last_modified', 'created_at']),
            // Filled in by withDues() from Books' own bill-by-bill reading.
            'outstanding'  => null,
            'overdue'      => null,
            'bill_count'   => null,
            'oldest_overdue_days' => null,
        ];
    }

    /**
     * Active or inactive, only when Books says.
     *
     * A party whose status Books does not carry is null here rather than
     * "active": treating silence as active is how an Inactive tab comes back
     * permanently empty while looking like it worked.
     *
     * @param array<string, mixed> $row
     */
    private static function statusOf(array $row): ?string
    {
        foreach (['is_active', 'active', 'is_enabled'] as $key) {
            if (array_key_exists($key, $row) && ($row[$key] === true || $row[$key] === false)) {
                return $row[$key] ? 'active' : 'inactive';
            }
            if (array_key_exists($key, $row) && (is_int($row[$key]) || (is_string($row[$key]) && $row[$key] !== '' && ctype_digit($row[$key])))) {
                return ((int) $row[$key]) === 1 ? 'active' : 'inactive';
            }
        }

        $word = BooksReadings::text($row, ['status', 'acc_status', 'record_status']);
        if ($word === null) {
            return null;
        }
        $word = strtolower($word);
        if (in_array($word, ['active', 'enabled', 'open', 'y', 'yes'], true)) {
            return 'active';
        }
        if (in_array($word, ['inactive', 'disabled', 'closed', 'blocked', 'n', 'no'], true)) {
            return 'inactive';
        }

        return null;
    }

    // -----------------------------------------------------------------------
    // The balance beside the name
    // -----------------------------------------------------------------------

    /**
     * Books' bill-by-bill reading, per account.
     *
     * The same endpoint the receivables screen draws, indexed by account, so
     * the outstanding shown here and the outstanding shown there are the same
     * number read the same way. Permission-gated by DuesService: a profile
     * without `receivable.view` gets no customer balances, and the column
     * reads "—" rather than "₹ 0.00".
     *
     * @return array{receivable: ?array<string, mixed>, payable: ?array<string, mixed>}
     */
    private function duesReadings(): array
    {
        if ($this->duesCache !== null) {
            return $this->duesCache;
        }

        $dues = new DuesService($this->ctx, $this->auth);

        return $this->duesCache = [
            'receivable' => $this->maySeeCustomers() ? $dues->tryReceivables() : null,
            'payable'    => $this->maySeeSuppliers() ? $dues->tryPayables() : null,
        ];
    }

    /** @return array<int, array<string, mixed>> */
    private function duesByAccount(): array
    {
        if ($this->duesByAccount !== null) {
            return $this->duesByAccount;
        }

        $index = [];
        foreach ($this->duesReadings() as $reading) {
            foreach ((array) ($reading['parties'] ?? []) as $party) {
                $id = (int) ($party['account_id'] ?? 0);
                if ($id > 0) {
                    $index[$id] = $party;
                }
            }
        }

        return $this->duesByAccount = $index;
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private function withDues(array $rows): array
    {
        $readings = $this->duesReadings();
        $index = $this->duesByAccount();

        return array_map(static function (array $row) use ($index, $readings): array {
            // Whether a zero is a real zero depends on whether the reading that
            // would have carried it was made at all.
            $readable = $row['type'] === 'supplier' ? $readings['payable'] !== null : $readings['receivable'] !== null;
            $dues = $index[$row['account_id']] ?? null;

            if ($dues !== null) {
                $row['outstanding'] = (float) ($dues['total'] ?? 0);
                $row['overdue'] = (float) ($dues['overdue'] ?? 0);
                $row['bill_count'] = (int) ($dues['bill_count'] ?? 0);
                $row['oldest_overdue_days'] = (int) ($dues['oldest_overdue_days'] ?? 0);
            } elseif ($readable) {
                // Read, and this party had no open bill: a true nought.
                $row['outstanding'] = 0.0;
                $row['overdue'] = 0.0;
                $row['bill_count'] = 0;
                $row['oldest_overdue_days'] = 0;
            }

            $row['over_credit_limit'] = $row['credit_limit'] !== null
                && (float) $row['credit_limit'] > 0
                && $row['outstanding'] !== null
                && (float) $row['outstanding'] > (float) $row['credit_limit'];

            return $row;
        }, $rows);
    }

    // -----------------------------------------------------------------------
    // Filtering, sorting, facets
    // -----------------------------------------------------------------------

    /**
     * Whether this request can be served by one upstream page.
     *
     * `order=desc` forces a scan even on the default sort. Reversing the page
     * Books just returned would give the first twenty names backwards, not the
     * last twenty names — a bug that looks like it works on page one.
     *
     * @param array<string, mixed> $query
     */
    private function needsScan(array $query): bool
    {
        return ($query['order'] ?? 'asc') === 'desc'
            || self::isSet($query['status'] ?? null, 'all')
            || self::isSet($query['state'] ?? null, 'all')
            || self::isSet($query['group'] ?? null, 'all')
            || self::isSet($query['city'] ?? null, '')
            || self::isSet($query['balance'] ?? null, 'any')
            || self::isSet($query['credit'] ?? null, 'any')
            || self::isSet($query['gst'] ?? null, 'any')
            || self::isSet($query['activity'] ?? null, 'any')
            || in_array((string) ($query['sort'] ?? 'name'), self::LOCAL_SORTS, true);
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @param array<string, mixed>       $query
     * @return list<array<string, mixed>>
     */
    private function applyFilters(array $rows, array $query): array
    {
        $status = (string) ($query['status'] ?? 'all');
        $state = (string) ($query['state'] ?? 'all');
        $group = (string) ($query['group'] ?? 'all');
        $city = strtolower(trim((string) ($query['city'] ?? '')));
        $balance = (string) ($query['balance'] ?? 'any');
        $credit = (string) ($query['credit'] ?? 'any');
        $gst = (string) ($query['gst'] ?? 'any');
        $activity = (string) ($query['activity'] ?? 'any');

        $activitySince = match ($activity) {
            'last_7'  => (new \DateTimeImmutable('today'))->modify('-7 days')->format('Y-m-d'),
            'last_30' => (new \DateTimeImmutable('today'))->modify('-30 days')->format('Y-m-d'),
            'last_90' => (new \DateTimeImmutable('today'))->modify('-90 days')->format('Y-m-d'),
            default   => null,
        };

        return array_values(array_filter($rows, static function (array $row) use (
            $status, $state, $group, $city, $balance, $credit, $gst, $activity, $activitySince
        ): bool {
            if ($status !== 'all' && $row['status'] !== $status) {
                return false;
            }
            if ($state !== 'all' && strcasecmp((string) ($row['state'] ?? ''), $state) !== 0) {
                return false;
            }
            if ($group !== 'all' && strcasecmp((string) ($row['group'] ?? ''), $group) !== 0) {
                return false;
            }
            if ($city !== '' && !str_contains(strtolower((string) ($row['city'] ?? '')), $city)) {
                return false;
            }
            if ($balance === 'outstanding' && !(($row['outstanding'] ?? 0) > 0)) {
                return false;
            }
            if ($balance === 'settled' && !(($row['outstanding'] ?? null) !== null && (float) $row['outstanding'] <= 0)) {
                return false;
            }
            if ($balance === 'overdue' && !(($row['overdue'] ?? 0) > 0)) {
                return false;
            }
            if ($credit === 'over' && $row['over_credit_limit'] !== true) {
                return false;
            }
            if ($credit === 'within') {
                if ($row['credit_limit'] === null || (float) $row['credit_limit'] <= 0 || $row['over_credit_limit'] === true) {
                    return false;
                }
            }
            if ($credit === 'none' && $row['credit_limit'] !== null && (float) $row['credit_limit'] > 0) {
                return false;
            }
            if ($gst === 'registered' && !self::isNonEmptyString($row['gstin'])) {
                return false;
            }
            if ($gst === 'unregistered' && self::isNonEmptyString($row['gstin'])) {
                return false;
            }
            if ($activity === 'none' && $row['last_transaction_at'] !== null) {
                return false;
            }
            if ($activitySince !== null && ($row['last_transaction_at'] === null || $row['last_transaction_at'] < $activitySince)) {
                return false;
            }

            return true;
        }));
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private static function sortRows(array $rows, string $sort, string $order): array
    {
        $direction = $order === 'desc' ? -1 : 1;

        usort($rows, static function (array $a, array $b) use ($sort, $direction): int {
            $result = match ($sort) {
                // Nulls sort last whichever way the column is pointed: a party
                // with no recorded balance is not the largest debtor.
                'outstanding'      => self::compareNullable($a['outstanding'] ?? null, $b['outstanding'] ?? null),
                'overdue'          => self::compareNullable($a['overdue'] ?? null, $b['overdue'] ?? null),
                'credit_limit'     => self::compareNullable($a['credit_limit'] ?? null, $b['credit_limit'] ?? null),
                'last_transaction' => self::compareNullable($a['last_transaction_at'] ?? null, $b['last_transaction_at'] ?? null),
                'updated_at'       => self::compareNullable($a['updated_at'] ?? null, $b['updated_at'] ?? null),
                'state'            => strcasecmp((string) ($a['state'] ?? ''), (string) ($b['state'] ?? '')),
                default            => strcasecmp((string) $a['name'], (string) $b['name']),
            };

            if ($result !== 0) {
                return $result * $direction;
            }

            return strcasecmp((string) $a['name'], (string) $b['name']);
        });

        return $rows;
    }

    private static function compareNullable(mixed $a, mixed $b): int
    {
        if ($a === null && $b === null) {
            return 0;
        }
        if ($a === null) {
            return 1;
        }
        if ($b === null) {
            return -1;
        }

        return is_string($a) || is_string($b) ? strcmp((string) $a, (string) $b) : ($a <=> $b);
    }

    /**
     * The values the State and Group pickers offer.
     *
     * Built from what was actually read, so a filter can never offer an option
     * that matches nothing. An incomplete scan returns none rather than a
     * partial list, because a picker missing half its states looks complete.
     *
     * @param list<array<string, mixed>> $rows
     * @return array{states: list<string>, groups: list<string>, cities: list<string>}
     */
    private function facets(array $rows, bool $complete): array
    {
        if (!$complete) {
            return ['states' => [], 'groups' => [], 'cities' => []];
        }

        $states = [];
        $groups = [];
        $cities = [];
        foreach ($rows as $row) {
            if (self::isNonEmptyString($row['state'])) {
                $states[(string) $row['state']] = true;
            }
            if (self::isNonEmptyString($row['group'])) {
                $groups[(string) $row['group']] = true;
            }
            if (self::isNonEmptyString($row['city'])) {
                $cities[(string) $row['city']] = true;
            }
        }

        $sort = static function (array $set): array {
            $values = array_keys($set);
            usort($values, 'strcasecmp');

            return array_values($values);
        };

        return ['states' => $sort($states), 'groups' => $sort($groups), 'cities' => $sort($cities)];
    }

    /**
     * One or two things worth knowing, each one arithmetic on rows just read.
     *
     * Nothing is predicted and nothing is inferred. If the reading was partial,
     * there are no insights at all — "12 customers account for 74% of overdue"
     * is a lie when it was worked out from the first thousand of four thousand.
     *
     * @param list<array<string, mixed>> $rows
     * @return list<array{kind: string, tone: string, message: string}>
     */
    private function insights(array $rows, bool $complete, int $overLimit, bool $creditKnown, int $withoutActivity, int $activityKnown): array
    {
        if (!$complete) {
            return [];
        }

        $out = [];

        if ($creditKnown && $overLimit > 0) {
            $out[] = [
                'kind' => 'over_credit_limit',
                'tone' => 'danger',
                'message' => $overLimit === 1
                    ? '1 party owes more than its credit limit allows.'
                    : $overLimit . ' parties owe more than their credit limit allows.',
            ];
        }

        // How concentrated the overdue money is. Useful because chasing the
        // right four customers is a morning's work and chasing forty is not.
        $overdue = array_values(array_filter($rows, static fn (array $row) => ($row['overdue'] ?? 0) > 0));
        if (count($overdue) > 2) {
            usort($overdue, static fn (array $a, array $b) => $b['overdue'] <=> $a['overdue']);
            $total = array_sum(array_map(static fn (array $row) => (float) $row['overdue'], $overdue));
            $topCount = max(1, (int) ceil(count($overdue) * 0.2));
            $top = array_sum(array_map(
                static fn (array $row) => (float) $row['overdue'],
                array_slice($overdue, 0, $topCount),
            ));
            if ($total > 0) {
                $share = (int) round(($top / $total) * 100);
                if ($share >= 50) {
                    $out[] = [
                        'kind' => 'overdue_concentration',
                        'tone' => 'warning',
                        'message' => sprintf(
                            '%d of %d parties with overdue bills account for %d%% of the overdue money.',
                            $topCount,
                            count($overdue),
                            $share,
                        ),
                    ];
                }
            }
        }

        if ($activityKnown > 0 && $withoutActivity > 0) {
            $out[] = [
                'kind' => 'dormant',
                'tone' => 'info',
                'message' => $withoutActivity === 1
                    ? '1 party has had no transaction in the last 90 days.'
                    : $withoutActivity . ' parties have had no transaction in the last 90 days.',
            ];
        }

        return $out;
    }

    /**
     * @param list<array<string, mixed>> $rows
     * @return list<array<string, mixed>>
     */
    private function duplicateGroups(array $rows): array
    {
        /** @var array<string, array{reason: string, field: string, members: list<array<string, mixed>>}> $buckets */
        $buckets = [];

        $add = static function (string $key, string $reason, string $field, array $row) use (&$buckets): void {
            $buckets[$key] ??= ['reason' => $reason, 'field' => $field, 'members' => []];
            $buckets[$key]['members'][] = $row;
        };

        foreach ($rows as $row) {
            $member = [
                'account_id' => $row['account_id'],
                'name'       => $row['name'],
                'type'       => $row['type'],
                'gstin'      => $row['gstin'],
                'phone'      => $row['phone'],
                'email'      => $row['email'],
                'state'      => $row['state'],
                'outstanding' => $row['outstanding'],
            ];

            if (self::isNonEmptyString($row['gstin'])) {
                $add('gstin:' . strtoupper(trim((string) $row['gstin'])), 'Same GSTIN', 'gstin', $member);
                continue;
            }
            $phone = self::digits((string) ($row['phone'] ?? ''));
            if (strlen($phone) >= 10) {
                $add('phone:' . substr($phone, -10), 'Same phone number', 'phone', $member);
                continue;
            }
            if (self::isNonEmptyString($row['email'])) {
                $add('email:' . strtolower(trim((string) $row['email'])), 'Same email address', 'email', $member);
                continue;
            }
            $name = self::comparableName((string) $row['name']);
            if ($name !== '') {
                $add('name:' . $name, 'Nearly the same name', 'name', $member);
            }
        }

        $groups = [];
        foreach ($buckets as $key => $bucket) {
            if (count($bucket['members']) < 2) {
                continue;
            }
            $groups[] = [
                'key'     => $key,
                'reason'  => $bucket['reason'],
                'field'   => $bucket['field'],
                'members' => $bucket['members'],
            ];
        }

        usort($groups, static fn (array $a, array $b) => count($b['members']) <=> count($a['members']));

        return $groups;
    }

    /**
     * A name with the things that differ between two spellings of one company
     * taken out: case, punctuation, and the legal suffixes.
     */
    private static function comparableName(string $name): string
    {
        $value = strtolower($name);
        $value = preg_replace('/\b(private|pvt|limited|ltd|llp|inc|co|company|and|the|&)\b/u', ' ', $value) ?? $value;
        $value = preg_replace('/[^a-z0-9]+/u', '', $value) ?? $value;

        return strlen($value) >= 5 ? $value : '';
    }

    private static function digits(string $value): string
    {
        return preg_replace('/\D+/', '', $value) ?? '';
    }

    private static function isNonEmptyString(mixed $value): bool
    {
        return is_string($value) && trim($value) !== '';
    }

    private static function isSet(mixed $value, string $neutral): bool
    {
        return $value !== null && (string) $value !== '' && (string) $value !== $neutral;
    }

    private static function trimmedOrNull(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }

    /**
     * The CSV a person gets when they export the list they are looking at.
     *
     * @param list<array<string, mixed>> $rows
     */
    public static function toCsv(array $rows): string
    {
        $headers = ['Name', 'Type', 'GSTIN', 'Phone', 'Email', 'City', 'State', 'Group', 'Outstanding', 'Overdue', 'Credit limit', 'Status', 'Last transaction'];
        $handle = fopen('php://temp', 'r+');
        if ($handle === false) {
            return '';
        }

        fputcsv($handle, $headers);
        foreach ($rows as $row) {
            fputcsv($handle, array_map([ReportService::class, 'cell'], [
                $row['name'],
                $row['type'] === 'supplier' ? 'Supplier' : 'Customer',
                $row['gstin'],
                $row['phone'],
                $row['email'],
                $row['city'],
                $row['state'],
                $row['group'],
                $row['outstanding'],
                $row['overdue'],
                $row['credit_limit'],
                $row['status'],
                $row['last_transaction_at'],
            ]));
        }

        rewind($handle);
        $csv = (string) stream_get_contents($handle);
        fclose($handle);

        return $csv;
    }
}
