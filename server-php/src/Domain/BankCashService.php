<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

use Aicountly\Api\Auth;
use Aicountly\Api\Clients\BooksClient;
use Aicountly\Api\Context;
use Aicountly\Api\Http;
use Aicountly\Api\Permissions;

/**
 * What the bank-and-cash screens need to know, read live from Smart Books.
 *
 * Two questions, both answered on the request that draws them:
 *
 *   1. Which cash and bank ledgers may money be moved between, and what is in
 *      them — `masters/accounts` for the list, `reports/account-summary` for
 *      the balances.
 *   2. What has been withdrawn from the bank lately — `reports/account-ledger`
 *      for the bank account, filtered to the contra entries that CREDIT it.
 *
 * Nothing here is stored. There is deliberately no billing_bank_withdrawals
 * table: the withdrawal is a contra voucher and Books owns it, so a list kept
 * on this side would be a second answer to a question Books already answers —
 * and the one that went stale the moment somebody posted a contra in Books.
 *
 * THE CLASSIFICATION RULE
 *
 * A ledger row is only counted as a withdrawal when Books says what kind of
 * voucher it is. If the deployment's ledger does not carry a voucher type,
 * every credit on a bank ledger would look alike — a supplier payment would be
 * listed as a cash withdrawal — so this reports the activity as unavailable
 * rather than listing entries it cannot vouch for. An empty list means "none in
 * this period", never "we could not tell".
 */
final class BankCashService
{
    /**
     * Bank ledgers read when no single account is in focus.
     *
     * Each one is an upstream call, and this runs behind a sidebar card: a
     * business with thirty bank accounts must not turn that card into thirty
     * round trips. The response says which accounts were read and whether any
     * were left out.
     */
    private const MAX_LEDGERS = 4;

    /** A year is the most a "recent activity" window can usefully ask for. */
    private const MAX_DAYS = 370;

    public function __construct(
        private readonly Context $ctx,
        private readonly Auth $auth,
    ) {
    }

    /**
     * The cash and bank ledgers, with their balances where the profile allows.
     *
     * The LIST is not permission-gated — somebody who may record a withdrawal
     * has to be able to choose the accounts it moves between. The BALANCES are,
     * separately for cash and bank, because "the staff may bank the takings but
     * must not see what is in the account" is a real instruction from a real
     * shop owner.
     *
     * @return array<string, mixed>
     */
    public function accounts(): array
    {
        $books = (new BooksClient())->withSession($this->auth->sesKey());

        $response = $books->accounts($this->ctx, ['nature' => 'cash_bank', 'limit' => 100]);
        if (!$response['ok']) {
            Http::error(503, 'books_unavailable', 'Could not reach Smart Books for your cash and bank accounts. Please retry.');
        }

        $mayCash = Permissions::allows($this->ctx, $this->auth, 'cash.view');
        $mayBank = Permissions::allows($this->ctx, $this->auth, 'bank.view');

        $balances = [];
        $balancesAvailable = false;
        $balancesReason = 'Your Billing profile does not show balances.';

        if ($mayCash || $mayBank) {
            $summary = $books->accountSummary($this->ctx, ['nature' => 'cash_bank']);
            if ($summary['ok']) {
                $balancesAvailable = true;
                $balancesReason = null;
                foreach (BooksReadings::rows($summary['body']) as $row) {
                    $id = BooksReadings::id($row, ['account_id', 'acc_id', 'id']);
                    if ($id === null) {
                        continue;
                    }
                    $balances[$id] = [
                        'balance' => BooksReadings::number($row, ['closing_balance', 'balance', 'current_balance']),
                        'group'   => BooksReadings::text($row, ['group_name', 'nature', 'acc_group']),
                    ];
                }
            } else {
                $balancesReason = 'Smart Books did not answer for the balances.';
            }
        }

        $accounts = [];
        foreach (BooksReadings::rows($response['body']) as $row) {
            $id = BooksReadings::id($row, ['acc_id', 'account_id', 'id']);
            if ($id === null) {
                continue;
            }

            $name = BooksReadings::text($row, ['acc_name', 'account_name', 'name']) ?? ('Account ' . $id);
            $group = BooksReadings::text($row, ['group_name', 'acc_group', 'nature', 'parent_group'])
                ?? ($balances[$id]['group'] ?? null);
            $kind = self::classify($group, $name);

            // The balance is shown only for the half of the pair this profile
            // may see. An account whose kind we could not establish is treated
            // as the stricter of the two.
            $maySeeBalance = $kind === 'cash' ? $mayCash : $mayBank;

            $accounts[] = [
                'account_id'   => $id,
                'account_name' => $name,
                'account_no'   => BooksReadings::text($row, ['bank_account_no', 'account_number', 'acc_no', 'bank_acc_no', 'bank_account_number']),
                'kind'         => $kind,
                'group'        => $group,
                'balance'      => $maySeeBalance ? ($balances[$id]['balance'] ?? null) : null,
                // Overdraft, when Books holds one. Absent in most deployments,
                // and absent is not zero: the screen shows the limit only when
                // there is one to show, and never blocks a legitimate overdraft.
                'overdraft_limit' => $maySeeBalance ? BooksReadings::number($row, ['overdraft_limit', 'od_limit', 'overdraft']) : null,
            ];
        }

        return [
            'accounts'            => $accounts,
            'balances_available'  => $balancesAvailable,
            'balances_reason'     => $balancesAvailable ? null : $balancesReason,
            'may_see_cash'        => $mayCash,
            'may_see_bank'        => $mayBank,
            'source'              => 'books',
            'note'                => 'Accounts and balances come from Smart Books as this screen loads. Billing keeps no copy of either.',
        ];
    }

    /**
     * Bank withdrawals in the recent past, and what they add up to.
     *
     * @param int|null $accountId one bank account, or null to scan the first few
     * @return array<string, mixed>
     */
    public function withdrawals(?int $accountId, int $days, int $limit): array
    {
        if (!Permissions::allows($this->ctx, $this->auth, 'bank.view')) {
            return [
                'available' => false,
                'reason'    => 'Your Billing profile does not show bank activity.',
                'entries'   => [],
            ];
        }

        $days = max(1, min($days, self::MAX_DAYS));
        $limit = max(1, min($limit, 50));
        $to = gmdate('Y-m-d');
        $from = gmdate('Y-m-d', strtotime($to . ' -' . ($days - 1) . ' days'));

        $books = (new BooksClient())->withSession($this->auth->sesKey());

        $listing = $books->accounts($this->ctx, ['nature' => 'cash_bank', 'limit' => 100]);
        if (!$listing['ok']) {
            return [
                'available' => false,
                'reason'    => 'Could not reach Smart Books for your bank accounts.',
                'entries'   => [],
            ];
        }

        $bankAccounts = [];
        foreach (BooksReadings::rows($listing['body']) as $row) {
            $id = BooksReadings::id($row, ['acc_id', 'account_id', 'id']);
            if ($id === null) {
                continue;
            }
            $name = BooksReadings::text($row, ['acc_name', 'account_name', 'name']) ?? ('Account ' . $id);
            if (self::classify(BooksReadings::text($row, ['group_name', 'acc_group', 'nature', 'parent_group']), $name) !== 'bank') {
                continue;
            }
            $bankAccounts[$id] = $name;
        }

        if ($accountId !== null) {
            if (!isset($bankAccounts[$accountId])) {
                return [
                    'available' => false,
                    'reason'    => 'That account is not a bank account in Smart Books.',
                    'entries'   => [],
                ];
            }
            $targets = [$accountId => $bankAccounts[$accountId]];
            $omitted = 0;
        } else {
            $targets = array_slice($bankAccounts, 0, self::MAX_LEDGERS, true);
            $omitted = count($bankAccounts) - count($targets);
        }

        if ($targets === []) {
            return [
                'available' => true,
                'reason'    => null,
                'from'      => $from,
                'to'        => $to,
                'days'      => $days,
                'account_id' => $accountId,
                'entries'   => [],
                'stats'     => ['total' => 0.0, 'count' => 0],
                'scanned'   => [],
                'omitted_accounts' => 0,
                'complete'  => true,
                'source'    => 'books',
                'note'      => 'No bank accounts in Smart Books yet.',
            ];
        }

        $entries = [];
        $scanned = [];
        $unreachable = 0;
        $rowsSeen = 0;
        $typedRows = 0;

        foreach ($targets as $id => $name) {
            $ledger = $books->accountLedger($this->ctx, $id, ['from' => $from, 'to' => $to]);
            if (!$ledger['ok']) {
                $unreachable++;
                continue;
            }
            $scanned[] = ['account_id' => $id, 'account_name' => $name];

            foreach (BooksReadings::rows($ledger['body']) as $row) {
                $rowsSeen++;
                $type = BooksReadings::text($row, ['voucher_type', 'vch_type', 'vch_type_name', 'voucher_type_name', 'type']);
                if ($type === null) {
                    continue;
                }
                $typedRows++;
                if (!self::isContra($type)) {
                    continue;
                }

                $out = self::moneyOut($row);
                if ($out === null || $out <= 0) {
                    // A contra that DEBITS the bank is a deposit, not a
                    // withdrawal. It belongs on the other screen.
                    continue;
                }

                $entries[] = [
                    'voucher_id'        => BooksReadings::voucherId($row),
                    'voucher_uuid'      => BooksReadings::voucherUuid($row),
                    'voucher_no'        => BooksReadings::voucherNumber($row),
                    'date'              => BooksReadings::voucherDate($row),
                    'amount'            => round($out, 2),
                    'bank_account_id'   => $id,
                    'bank_account_name' => $name,
                    'cash_account_id'   => BooksReadings::id($row, ['counter_account_id', 'against_account_id', 'contra_account_id', 'other_account_id']),
                    'cash_account_name' => BooksReadings::text($row, ['particulars', 'against_account', 'counter_account_name', 'contra_account', 'other_account_name']),
                    'reference'         => BooksReadings::text($row, ['instrument_no', 'cheque_no', 'reference_no', 'voucher_no', 'vch_no']),
                    'narration'         => BooksReadings::text($row, ['narration', 'remarks', 'note']),
                ];
            }
        }

        if ($unreachable > 0 && $scanned === []) {
            return [
                'available' => false,
                'reason'    => 'Smart Books did not answer for your bank ledgers.',
                'entries'   => [],
            ];
        }

        // Rows arrived but none of them said what kind of voucher they were. A
        // list built from that would be every payment out of the bank dressed
        // up as a cash withdrawal, so say nothing rather than something wrong.
        if ($rowsSeen > 0 && $typedRows === 0) {
            return [
                'available' => false,
                'reason'    => 'Smart Books\' ledger did not say which entries were bank withdrawals.',
                'entries'   => [],
            ];
        }

        usort($entries, static function (array $a, array $b): int {
            return [$b['date'] ?? '', $b['voucher_id'] ?? 0] <=> [$a['date'] ?? '', $a['voucher_id'] ?? 0];
        });

        $total = 0.0;
        foreach ($entries as $entry) {
            $total += $entry['amount'];
        }

        return [
            'available'  => true,
            'reason'     => null,
            'from'       => $from,
            'to'         => $to,
            'days'       => $days,
            'account_id' => $accountId,
            'entries'    => array_slice($entries, 0, $limit),
            'stats'      => ['total' => round($total, 2), 'count' => count($entries)],
            'scanned'    => $scanned,
            'omitted_accounts' => $omitted + $unreachable,
            'complete'   => $unreachable === 0 && $omitted === 0,
            'source'     => 'books',
            'note'       => 'Read from Smart Books just now. Billing keeps no list of its own.',
        ];
    }

    /**
     * Cash or bank, from the accounting group first and the name only after.
     *
     * The group is what Books actually files the ledger under; the name is a
     * fallback for deployments whose account list does not carry the group, and
     * it is deliberately narrow — "Cash", "Petty cash", "Cash counter" and
     * nothing cleverer.
     */
    private static function classify(?string $group, string $name): string
    {
        $group = strtolower(trim((string) $group));
        if ($group !== '') {
            return str_contains($group, 'cash') ? 'cash' : 'bank';
        }

        $lowered = strtolower($name);
        foreach (['cash', 'petty', 'till', 'counter'] as $word) {
            if (str_contains($lowered, $word)) {
                return 'cash';
            }
        }

        return 'bank';
    }

    private static function isContra(string $voucherType): bool
    {
        $lowered = strtolower($voucherType);

        return str_contains($lowered, 'contra')
            || str_contains($lowered, 'withdrawal')
            || str_contains($lowered, 'transfer');
    }

    /**
     * What left the account on this ledger row.
     *
     * Books' ledgers come in two shapes: a debit and a credit column, or one
     * amount with a Dr/Cr marker beside it. Both are read; anything else reads
     * as null, which keeps the row out of the list rather than into it at a
     * guessed value.
     *
     * @param array<string, mixed> $row
     */
    private static function moneyOut(array $row): ?float
    {
        $credit = BooksReadings::number($row, ['credit', 'credit_amount', 'cr_amount', 'cr']);
        if ($credit !== null) {
            return $credit;
        }

        $marker = strtolower((string) BooksReadings::text($row, ['dr_cr', 'drcr', 'entry_type', 'dc']));
        if ($marker === '') {
            return null;
        }
        if (!str_starts_with($marker, 'cr') && $marker !== 'c') {
            return null;
        }

        return BooksReadings::number($row, ['amount', 'value']);
    }
}
