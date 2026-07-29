import { UserRole } from '../entities/User';

/**
 * Platform permission types.
 * Defines granular permissions beyond simple role checks.
 */
export enum Permission {
  // Song permissions
  UPLOAD_SONG = 'upload_song',
  DELETE_OWN_SONG = 'delete_own_song',
  DELETE_ANY_SONG = 'delete_any_song',
  FLAG_SONG = 'flag_song',
  MODERATE_SONG = 'moderate_song',

  // User permissions
  UPDATE_OWN_PROFILE = 'update_own_profile',
  UPDATE_ANY_PROFILE = 'update_any_profile',
  DELETE_USER = 'delete_user',
  ASSIGN_ROLE = 'assign_role',

  // Content management
  MODERATE_COMMENTS = 'moderate_comments',
  MANAGE_TAGS = 'manage_tags',
  MANAGE_RELEASES = 'manage_releases',

  // System administration
  VIEW_SYSTEM_LOGS = 'view_system_logs',
  MANAGE_JOBS = 'manage_jobs',
  REBUILD_SEARCH_INDEX = 'rebuild_search_index',
  VIEW_ALL_USERS = 'view_all_users',
}

/**
 * Maps each role to its permitted actions.
 * Roles do not inherit permissions - each role's permissions are explicit.
 */
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.LISTENER]: [Permission.UPDATE_OWN_PROFILE],

  [UserRole.ARTIST]: [
    Permission.UPDATE_OWN_PROFILE,
    Permission.UPLOAD_SONG,
    Permission.DELETE_OWN_SONG,
    Permission.MANAGE_RELEASES,
  ],

  [UserRole.MODERATOR]: [
    Permission.UPDATE_OWN_PROFILE,
    Permission.FLAG_SONG,
    Permission.MODERATE_SONG,
    Permission.MODERATE_COMMENTS,
    Permission.MANAGE_TAGS,
  ],

  [UserRole.ADMIN]: [
    Permission.UPDATE_OWN_PROFILE,
    Permission.UPDATE_ANY_PROFILE,
    Permission.UPLOAD_SONG,
    Permission.DELETE_OWN_SONG,
    Permission.DELETE_ANY_SONG,
    Permission.FLAG_SONG,
    Permission.MODERATE_SONG,
    Permission.MODERATE_COMMENTS,
    Permission.MANAGE_TAGS,
    Permission.MANAGE_RELEASES,
    Permission.DELETE_USER,
    Permission.VIEW_SYSTEM_LOGS,
    Permission.MANAGE_JOBS,
    Permission.REBUILD_SEARCH_INDEX,
    Permission.VIEW_ALL_USERS,
  ],

  [UserRole.SUPER_ADMIN]: [
    Permission.UPDATE_OWN_PROFILE,
    Permission.UPDATE_ANY_PROFILE,
    Permission.UPLOAD_SONG,
    Permission.DELETE_OWN_SONG,
    Permission.DELETE_ANY_SONG,
    Permission.FLAG_SONG,
    Permission.MODERATE_SONG,
    Permission.MODERATE_COMMENTS,
    Permission.MANAGE_TAGS,
    Permission.MANAGE_RELEASES,
    Permission.DELETE_USER,
    Permission.ASSIGN_ROLE,
    Permission.VIEW_SYSTEM_LOGS,
    Permission.MANAGE_JOBS,
    Permission.REBUILD_SEARCH_INDEX,
    Permission.VIEW_ALL_USERS,
  ],
};

/**
 * Check if a given role has a specific permission.
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  return permissions.includes(permission);
}

/**
 * Check if a given role has all of the specified permissions.
 */
export function hasAllPermissions(role: UserRole, permissions: Permission[]): boolean {
  return permissions.every((permission) => hasPermission(role, permission));
}

/**
 * Check if a given role has any of the specified permissions.
 */
export function hasAnyPermission(role: UserRole, permissions: Permission[]): boolean {
  return permissions.some((permission) => hasPermission(role, permission));
}
