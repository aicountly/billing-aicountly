<?php

declare(strict_types=1);

namespace Aicountly\Api\Controllers;

use Aicountly\Api\Audit;
use Aicountly\Api\Db;
use Aicountly\Api\Http;
use Aicountly\Api\Permissions;

/**
 * Billing profiles: who may see and do what inside this product.
 *
 * Identity stays with the portal — a profile is assigned to a portal uuid and
 * nothing about the person is stored here.
 */
final class ProfilesController extends Controller
{
    public static function index(): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::seed($ctx);

        Http::data([
            'profiles' => Db::all(
                'SELECT p.*, (SELECT COUNT(*) FROM billing_profile_assignments a WHERE a.profile_id = p.profile_id) AS member_count
                 FROM billing_profiles p WHERE p.cmp_id = :cmp ORDER BY p.is_system DESC, p.profile_name',
                ['cmp' => $ctx->cmpId],
            ),
            'catalog'   => Permissions::CATALOG,
            'templates' => Permissions::TEMPLATES,
        ]);
    }

    public static function create(): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'access.manage');

        $body = Http::body();
        $code = trim((string) ($body['profile_code'] ?? ''));
        $name = trim((string) ($body['profile_name'] ?? ''));

        if ($code === '' || $name === '') {
            Http::validationFailed('A profile needs a code and a name.', ['field' => $code === '' ? 'profile_code' : 'profile_name']);
        }

        $permissions = [];
        foreach ((array) ($body['permissions'] ?? []) as $permission) {
            if (!is_string($permission)) {
                continue;
            }
            // An unknown permission is refused rather than stored: a typo that
            // silently grants nothing is worse than an error, because the user
            // believes they have configured something.
            if (!Permissions::exists($permission)) {
                Http::validationFailed('"' . $permission . '" is not a Billing permission.', ['field' => 'permissions']);
            }
            $permissions[] = $permission;
        }

        $existing = Db::first('SELECT profile_id FROM billing_profiles WHERE cmp_id = :cmp AND profile_code = :code', ['cmp' => $ctx->cmpId, 'code' => $code]);
        if ($existing !== null) {
            Http::conflict('A profile with that code already exists.');
        }

        $profileId = (int) Db::insert('billing_profiles', [
            'cmp_id'       => $ctx->cmpId,
            'profile_code' => $code,
            'profile_name' => $name,
            'description'  => trim((string) ($body['description'] ?? '')) ?: null,
            'template_key' => 'custom',
            'permissions'  => array_values(array_unique($permissions)),
        ], 'profile_id');

        Audit::record($ctx, $auth, 'profile.created', 'billing_profile', $profileId, null, ['code' => $code, 'permissions' => $permissions]);

        self::index();
    }

    public static function update(string $id): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'access.manage');

        $before = Db::first('SELECT * FROM billing_profiles WHERE profile_id = :id AND cmp_id = :cmp', ['id' => (int) $id, 'cmp' => $ctx->cmpId]);
        if ($before === null) {
            Http::notFound('That profile does not exist.');
        }

        $body = Http::body();
        $changes = [];

        if (isset($body['profile_name'])) {
            $changes['profile_name'] = trim((string) $body['profile_name']);
        }
        if (isset($body['description'])) {
            $changes['description'] = trim((string) $body['description']) ?: null;
        }
        if (isset($body['is_active'])) {
            $changes['is_active'] = (bool) $body['is_active'];
        }
        if (isset($body['permissions'])) {
            $permissions = [];
            foreach ((array) $body['permissions'] as $permission) {
                if (is_string($permission) && Permissions::exists($permission)) {
                    $permissions[] = $permission;
                } elseif (is_string($permission)) {
                    Http::validationFailed('"' . $permission . '" is not a Billing permission.', ['field' => 'permissions']);
                }
            }
            $changes['permissions'] = array_values(array_unique($permissions));
        }

        if ($changes !== []) {
            $changes['updated_at'] = gmdate('Y-m-d H:i:s');
            Db::update('billing_profiles', $changes, ['profile_id' => (int) $id, 'cmp_id' => $ctx->cmpId]);
            Audit::record($ctx, $auth, 'profile.updated', 'billing_profile', (int) $id, $before, $changes);
        }

        self::index();
    }

    public static function members(string $id): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'access.manage');

        Http::data(Db::all(
            'SELECT assignment_id, user_uuid, created_by, created_at
             FROM billing_profile_assignments WHERE cmp_id = :cmp AND profile_id = :profile
             ORDER BY created_at',
            ['cmp' => $ctx->cmpId, 'profile' => (int) $id],
        ));
    }

    public static function assign(string $id): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'access.manage');

        $userUuid = trim((string) (Http::param('user_uuid') ?? ''));
        if ($userUuid === '') {
            Http::validationFailed('Say which portal user to give this profile to.', ['field' => 'user_uuid']);
        }

        $profile = Db::first('SELECT profile_id FROM billing_profiles WHERE profile_id = :id AND cmp_id = :cmp', ['id' => (int) $id, 'cmp' => $ctx->cmpId]);
        if ($profile === null) {
            Http::notFound('That profile does not exist.');
        }

        Db::run(
            'INSERT INTO billing_profile_assignments (cmp_id, user_uuid, profile_id, created_by)
             VALUES (:cmp, :uuid, :profile, :by)
             ON CONFLICT (cmp_id, user_uuid, profile_id) DO NOTHING',
            ['cmp' => $ctx->cmpId, 'uuid' => $userUuid, 'profile' => (int) $id, 'by' => $auth->uuid],
        );

        Audit::record($ctx, $auth, 'profile.assigned', 'billing_profile', (int) $id, null, ['user_uuid' => $userUuid]);

        self::members($id);
    }

    public static function unassign(string $id, string $assignmentId): void
    {
        [$auth, $ctx] = self::enter();
        Permissions::assert($ctx, $auth, 'access.manage');

        $removed = Db::run(
            'DELETE FROM billing_profile_assignments WHERE assignment_id = :assignment AND profile_id = :profile AND cmp_id = :cmp',
            ['assignment' => (int) $assignmentId, 'profile' => (int) $id, 'cmp' => $ctx->cmpId],
        )->rowCount();

        if ($removed === 0) {
            Http::notFound('That assignment does not exist.');
        }

        Audit::record($ctx, $auth, 'profile.unassigned', 'billing_profile', (int) $id, ['assignment_id' => (int) $assignmentId], null);

        self::members($id);
    }
}
