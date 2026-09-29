import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../entities/User';
import { AppError } from '../errors/AppError';
import { handleError } from '../utils/helpers';
import logger from '../config/logger';

/**
 * Role-Based Access Control (RBAC) middleware for Privy-authenticated users (Issue #615).
 *
 * Enforces role-based permissions on top of Privy identity.
 * Works with both legacy JWT auth and Privy auth.
 *
 * Role hierarchy (from least to most privileged):
 * - listener: Basic user, can consume content
 * - artist: Can upload and manage their own content
 * - moderator: Can moderate content across the platform
 * - admin: Platform administration capabilities
 * - super_admin: Full platform cont
laylist',
    'delete:own_playlist',
    'create:comment',
    'update:own_comment',
    'delete:own_comment',
    'create:song',
    'read:own_song',
    'update:own_song',
    'delete:own_song',
    'create:album',
    'read:own_album',
    'update:own_album',
    'delete:own_album',
    'read:analytics',
    'read:royalties',
  ],
  [UserRole.MODERATOR]: [
    'read:public',
    'read:own_profile',
    'update:own_profile',
    'create:playlist',
    'read:playlist',
    'update:own_playlist',
    'delete:own_playlist',
    'create:comment',
    'update:own_comment',
    'delete:own_comment',
    'moderate:content',
    'read:reports',
    'update:reports',
    'delete:any_comment',
    'flag:song',
    'unflag:song',
  ],
  [UserRole.ADMIN]: [
    'read:public',
    'read:own_profile',
    'update:own_profile',
    'create:playlist',
    'read:playlist',
    'update:own_playlist',
    'delete:own_playlist',
    'create:comment',
    'update:own_comment',
    'delete:own_comment',
    'moderate:content',
    'read:reports',
    'update:reports',
    'delete:any_comment',
    'flag:song',
    'unflag:song',
    'read:users',
    'update:users',
    'delete:users',
    'read:admin_analytics',
    'manage:platform_settings',
  ],
  [UserRole.SUPER_ADMIN]: ['*'], // Super admin has all permissions
};

/**
 * Check if a user has a specific permission based on their role.
 */
export function hasPermission(userRole: UserRole, permission: string): boolean {
  const rolePermissions = RolePermissions[userRole] || [];

  // Super admin has all permissions
  if (rolePermissions.includes('*')) {
    return true;
  }

  return rolePermissions.includes(permission);
}

/**
 * Check if a user has any of the specified roles.
 */
export function hasRole(userRole: UserRole, allowedRoles: UserRole[]): boolean {
  return allowedRoles.includes(userRole);
}

/**
 * Middleware factory to require specific roles.
 * Issue #615: Implements role-based access control on top of Privy identity.
 *
 * @param allowedRoles - Array of roles that are allowed to access the route
 * @returns Express middleware function
 *
 * @example
 * router.post('/upload', requireAuth, requireRoles([UserRole.ARTIST, UserRole.ADMIN]), uploadSong);
 */
export function requireRoles(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as any).user || (req as any).privyUser;

    if (!user) {
      return handleError(req, res, AppError.authentication('Authentication required'));
    }

    if (!user.role) {
      logger.error({ userId: user.id }, 'User object missing role field');
      return handleError(req, res, AppError.authorization('Invalid user session'));
    }

    if (!hasRole(user.role, allowedRoles)) {
      logger.warn(
        { userId: user.id, userRole: user.role, requiredRoles: allowedRoles },
        'Access denied: insufficient role',
      );
      return handleError(
        req,
        res,
        AppError.authorization(
          `Access denied. Required roles: ${allowedRoles.join(', ')}. Your role: ${user.role}`,
        ),
      );
    }

    next();
  };
}

/**
 * Middleware factory to require specific permissions.
 * Issue #615: Fine-grained permission-based access control.
 *
 * @param requiredPermissions - Array of permissions required to access the route
 * @returns Express middleware function
 *
 * @example
 * router.delete('/comment/:id', requireAuth, requirePermissions(['delete:any_comment']), deleteComment);
 */
export function requirePermissions(requiredPermissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as any).user || (req as any).privyUser;

    if (!user) {
      return handleError(req, res, AppError.authentication('Authentication required'));
    }

    if (!user.role) {
      logger.error({ userId: user.id }, 'User object missing role field');
      return handleError(req, res, AppError.authorization('Invalid user session'));
    }

    const missingPermissions = requiredPermissions.filter(
      (permission) => !hasPermission(user.role, permission),
    );

    if (missingPermissions.length > 0) {
      logger.warn(
        { userId: user.id, userRole: user.role, missingPermissions },
        'Access denied: insufficient permissions',
      );
      return handleError(
        req,
        res,
        AppError.authorization(
          `Access denied. Missing permissions: ${missingPermissions.join(', ')}`,
        ),
      );
    }

    next();
  };
}

/**
 * Middleware to require artist role specifically (Issue #616).
 * Convenience wrapper around requireRoles for artist-only routes.
 */
export const requireArtist = requireRoles([UserRole.ARTIST, UserRole.ADMIN, UserRole.SUPER_ADMIN]);

/**
 * Middleware to require moderator or higher role.
 */
export const requireModerator = requireRoles([
  UserRole.MODERATOR,
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
]);

/**
 * Middleware to require admin role.
 */
export const requireAdmin = requireRoles([UserRole.ADMIN, UserRole.SUPER_ADMIN]);

/**
 * Middleware to require super admin role.
 */
export const requireSuperAdmin = requireRoles([UserRole.SUPER_ADMIN]);

/**
 * Check if user can access their own resource or has elevated privileges.
 * Useful for routes where users can manage their own content, but admins can manage any content.
 */
export function canAccessResource(
  user: { id: string; role: UserRole },
  resourceOwnerId: string,
): boolean {
  // User can access their own resources
  if (user.id === resourceOwnerId) {
    return true;
  }

  // Admins and super admins can access any resource
  return hasRole(user.role, [UserRole.ADMIN, UserRole.SUPER_ADMIN]);
}
