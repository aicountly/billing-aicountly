<?php

declare(strict_types=1);

namespace Aicountly\Api\Domain;

use Aicountly\Api\Env;

/**
 * "Your business briefing" — the strip across the top of the overview.
 *
 * TWO THINGS SIT IN THAT STRIP AND THEY ARE NOT THE SAME KIND OF THING, so
 * they are built separately here and labelled separately on screen.
 *
 *   1. The BRIEFING is counted. Every clause in it is a count or an amount
 *      that came out of the same reads the four cards came out of, and every
 *      one of them names the screen the records are on. Nothing in it is
 *      generated, nothing in it is predicted, and it carries no confidence
 *      score — a number nobody can reproduce is worse than no number.
 *
 *   2. The ASSISTANT is generated, and this deployment has no model to
 *      generate it with. It is a separate endpoint for that reason: the
 *      briefing must not wait on it, must not fail with it, and must not
 *      cost a model call every time somebody opens the dashboard.
 *
 * Calling the counted half "AI" is the thing this class exists to avoid. The
 * mockup this screen was built to labels the whole strip "AI briefing"; what it
 * describes — "3 overdue invoices and 2 supplier bills need a review today" —
 * is arithmetic, and arithmetic is what it is shown as.
 */
final class BriefingService
{
    /**
     * The counted half. Built from the actions and metrics the caller already
     * has, so it cannot disagree with the panels beside it and costs no extra
     * read.
     *
     * @param list<array<string, mixed>> $actions  the priority list, already permission-scoped
     * @param list<array<string, mixed>> $metrics  the cards, already permission-scoped
     * @return array<string, mixed>
     */
    public static function build(Period $period, array $actions, array $metrics): array
    {
        $points = [];

        foreach ($actions as $action) {
            $count = $action['source']['count'] ?? null;
            $points[] = [
                'id'    => (string) $action['id'],
                'text'  => self::clause($action),
                'tone'  => (string) $action['tone'],
                'count' => is_int($count) ? $count : null,
                'path'  => (string) $action['action']['path'],
            ];
        }

        // Sales movement, but only when the server already decided a
        // like-for-like comparison was possible. A period with nothing to
        // compare against gets no sentence rather than an invented one.
        $movement = null;
        foreach ($metrics as $metric) {
            if (($metric['id'] ?? '') !== 'sales') {
                continue;
            }
            $comparison = $metric['comparison'] ?? null;
            if (is_array($comparison) && ($comparison['available'] ?? false) === true) {
                $movement = [
                    'text' => 'Sales ' . $comparison['label'],
                    'tone' => (string) ($comparison['tone'] ?? 'positive'),
                    'path' => '/sales',
                ];
            }
        }

        return [
            'available'    => true,
            'headline'     => self::headline($points),
            'points'       => $points,
            'movement'     => $movement,
            'basis'        => 'Counted from your own records, in ' . $period->timezone . '. Not generated text.',
            'generated_at' => gmdate('c'),
        ];
    }

    /**
     * One sentence, joined from the clauses that exist.
     *
     * Two at most: a strip that runs to three lines is a strip nobody reads,
     * and the same items are listed in full in the panel underneath.
     *
     * @param list<array<string, mixed>> $points
     */
    private static function headline(array $points): string
    {
        if ($points === []) {
            return 'Nothing needs a decision right now.';
        }

        $clauses = array_map(static fn (array $point): string => (string) $point['text'], array_slice($points, 0, 2));
        $sentence = count($clauses) === 1 ? $clauses[0] : $clauses[0] . ' and ' . $clauses[1];

        $remaining = count($points) - count($clauses);
        if ($remaining > 0) {
            $sentence .= sprintf(', with %d more below', $remaining);
        }

        return ucfirst($sentence) . ' need a look today.';
    }

    /**
     * The short form of one priority, for the strip.
     *
     * Deliberately not the action's own title: the title is written to stand
     * alone in a list ("3 customers overdue, ₹74,500.00 in total") and a
     * sentence made of two of those is unreadable.
     *
     * @param array<string, mixed> $action
     */
    private static function clause(array $action): string
    {
        $count = $action['source']['count'] ?? null;
        $count = is_int($count) ? $count : null;
        $plural = static fn (string $one, string $many): string => $count === 1 ? $one : $many;

        return match ((string) $action['id']) {
            'overdue_receivables' => $count === null
                ? 'overdue customer bills'
                : sprintf('%d overdue customer %s', $count, $plural('account', 'accounts')),
            'supplier_bills_due' => $count === null
                ? 'supplier bills falling due'
                : sprintf('%d supplier %s due this week', $count, $plural('account', 'accounts')),
            'unfinished_entries' => $count === null
                ? 'entries not saved to the accounts'
                : sprintf('%d %s not saved to the accounts', $count, $plural('entry', 'entries')),
            'recurring_due' => $count === null
                ? 'recurring bills ready to raise'
                : sprintf('%d recurring %s ready to raise', $count, $plural('bill', 'bills')),
            'statutory_failed' => $count === null
                ? 'statutory documents that did not complete'
                : sprintf('%d statutory %s to fix', $count, $plural('document', 'documents')),
            // An action added later still reads sensibly: its own title, lower
            // cased, rather than a blank space in the sentence.
            default => lcfirst((string) $action['title']),
        };
    }

    // -----------------------------------------------------------------------
    // The generated half
    // -----------------------------------------------------------------------

    /**
     * Whether this deployment can generate a narrative at all.
     *
     * Checked before anything is sent anywhere, and the reason is what the
     * screen shows. See docs/BILLING_API_DEPENDENCIES.md — this is the third
     * capability in that file, and like the other two it renders as an honest
     * unavailable state rather than as silence.
     *
     * @return array{available: bool, reason: ?string}
     */
    public static function assistantStatus(): array
    {
        $base = trim(Env::get('AI_BRIEFING_BASE'));

        if ($base === '') {
            return [
                'available' => false,
                'reason'    => 'No briefing model is configured for this deployment, so there is nothing to write '
                    . 'the summary. The counted briefing above is unaffected.',
            ];
        }

        if (trim(Env::get('AI_BRIEFING_KEY')) === '') {
            return [
                'available' => false,
                'reason'    => 'A briefing service is configured but its key is not set, so Billing will not call it.',
            ];
        }

        // Configured, and still unavailable: no client for it has been written,
        // because no service in this deployment serves the contract. Writing one
        // against an invented shape would put a summary on screen that nobody
        // could check, which is the one thing this screen must not do.
        return [
            'available' => false,
            'reason'    => 'A briefing service is configured, but Billing has no client for it yet. '
                . 'The contract it would need is in docs/BILLING_API_DEPENDENCIES.md.',
        ];
    }
}
