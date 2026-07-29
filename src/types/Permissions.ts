import { UserRole } from '../entities/User';

/**
 * Granular permissions checked by the RBAC middleware (Issue #100).
 *
 * A permission names a single capability. Roles are mapped to the set of
 * permissions they hold in {@link ROLE_PERMISSIONS}, so route handlers can
 * require a capability rather than hard-coding which roles happen to have it.
 */
export enum Permission {
  // Content moderation
  CONTENT_MODERATE = 'content:moderate',

  // Background jobs / operational visibility
  JOBS_VIEW = 'jobs:view',

  // Search index maintenance
  SEARCH_MANAGE = 'search:manage',

  // User & role administration
  USER_MANAGE = 'user:manage',
  ROLE_ASSIGN = 'role:assign',

  // Artist verification review (Issue #92)
  VERIFICATION_REVIEW = 'verification:review',
}

/**
 * Maps each role to the permissions it is granted.
 *
 * Roles are additive but not hierarchical: a role holds exactly the
 * permissions listed for it. `super_admin` is granted every permission so
 * that adding a new capability does not silently exclude the top role.
 */
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.LISTENER]: [],
  [UserRole.ARTIST]: [],
  [UserRole.MODERATOR]: [
    Permission.CONTENT_MODERATE,
    Permission.JOBS_VIEW,
    Permission.VERIFICATION_REVIEW,
  ],
  [UserRole.ADMIN]: [
    Permission.CONTENT_MODERATE,
    Permission.JOBS_VIEW,
    Permission.SEARCH_MANAGE,
    Permission.USER_MANAGE,
    Permission.ROLE_ASSIGN,
    Permission.VERIFICATION_REVIEW,
  ],
  [UserRole.SUPER_ADMIN]: Object.values(Permission),
};

/** True when `role` is granted `permission`. */
export function roleHasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
