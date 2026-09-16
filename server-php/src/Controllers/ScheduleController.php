<?php

declare(strict_types=1);

namespace Aicountly\Api\Controllers;

use Aicountly\Api\Domain\ScheduleService;
use Aicountly\Api\Http;

final class ScheduleController extends Controller
{
    public static function listRecurring(): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new ScheduleService($ctx, $auth))->listRecurring());
    }

    public static function createRecurring(): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new ScheduleService($ctx, $auth))->createRecurring(Http::body()), 201);
    }

    public static function showRecurring(string $id): void
    {
        [$auth, $ctx] = self::enter();

        $rule = (new ScheduleService($ctx, $auth))->findRecurring((int) $id);
        if ($rule === []) {
            Http::notFound('That recurring bill does not exist.');
        }

        Http::data($rule);
    }

    /** Raise this occurrence now. Goes through the same Books path as any sale. */
    public static function runRecurring(string $id): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new ScheduleService($ctx, $auth))->runRecurring((int) $id, Http::param('due_date')));
    }

    public static function setRecurringStatus(string $id): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new ScheduleService($ctx, $auth))->setRecurringStatus((int) $id, strtoupper((string) (Http::param('status') ?? ''))));
    }

    /** Recurring bills whose date has come — the "raise these" list. */
    public static function dueRecurring(): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new ScheduleService($ctx, $auth))->dueRecurring(Http::param('as_on')));
    }

    public static function listReminderRules(): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new ScheduleService($ctx, $auth))->listReminderRules());
    }

    public static function createReminderRule(): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new ScheduleService($ctx, $auth))->createReminderRule(Http::body()), 201);
    }

    /** Who this rule would chase today, worked out from Books' live outstanding. */
    public static function reminderCandidates(string $id): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new ScheduleService($ctx, $auth))->reminderCandidates((int) $id));
    }

    public static function logReminder(string $id): void
    {
        [$auth, $ctx] = self::enter();
        Http::data((new ScheduleService($ctx, $auth))->logReminder((int) $id, Http::body()), 201);
    }
}
