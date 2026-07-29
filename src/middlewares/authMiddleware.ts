import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '../entities/User';
import { AppError } from '../errors/AppError';
import { handleError } from '../utils/helpers';
import {
  Permission,
  hasPermission,
  hasAllPermissions,
  hasAnyPermission,
} from '../types/permissions';

export interface JwtPayload {
  id: string;
  role?: UserRole;
  email?: string;
  walletAddress?: string;
  stellarPublicKey?: string;
  username?: string;
  name?: string;
  emailVerified?: boolean;
}

/** Extend Express Request to carry the decoded JWT set by requireAuth. */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return handleError(req, res, AppError.authentication('Unauthorized: No token provided'));
    }

    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_SECRET!;
    const decoded = jwt.verify(token, secret) as JwtPayload;

    if (!decoded) {
      return handleError(req, res, AppError.authentication('Unauthorized: Invalid token'));
    }

    (req as any).user = decoded;
    next();
  } catch (error) {
    console.error('JWT verification error:', error);
    return handleError(req, res, AppError.authentication('Unauthorized: Invalid or expired token'));
  }
};

export const requireRoles =
  (...allowedRoles: UserRole[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    return requireAuth(req, res, () => {
      const role = (req as any).user?.role as UserRole | undefined;
      if (!role || !allowedRoles.includes(role)) {
        return handleError(
          req,
          res,
          AppError.forbidden(
            `Forbidden: one of these roles is required: ${allowedRoles.join(', ')}`,
          ),
        );
      }

      return next();
    });
  };

export const authArtistMiddleware = requireRoles(UserRole.ARTIST, UserRole.ADMIN);
export const authListenerMiddleware = requireRoles(UserRole.LISTENER, UserRole.ADMIN);

export const requireEmailVerified = (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user;
  if (!user) {
    return handleError(req, res, AppError.authentication('Unauthorized: No user in session'));
  }

  if (user.emailVerified === false) {
    return handleError(
      req,
      res,
      AppError.authorization('Email verification required for this action'),
    );
  }

  next();
};

export const requireArtistAndVerified = (req: Request, res: Response, next: NextFunction) => {
  return requireRoles(UserRole.ARTIST, UserRole.ADMIN)(req, res, () => {
    return requireEmailVerified(req, res, next);
  });
};

/**
 * Middleware to require a specific permission.
 * Returns 403 Forbidden if the user's role doesn't have the required permission.
 *
 * @param permission - The required permission
 */
export const requirePermission =
  (permission: Permission) => (req: Request, res: Response, next: NextFunction) => {
    return requireAuth(req, res, () => {
      const role = (req as any).user?.role as UserRole | undefined;

      if (!role || !hasPermission(role, permission)) {
        return handleError(
          req,
          res,
          AppError.forbidden(`Forbidden: ${permission} permission required`),
        );
      }

      return next();
    });
  };

/**
 * Middleware to require all of the specified permissions.
 * Returns 403 Forbidden if the user's role doesn't have all required permissions.
 *
 * @param permissions - Array of required permissions
 */
export const requireAllPermissions =
  (...permissions: Permission[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    return requireAuth(req, res, () => {
      const role = (req as any).user?.role as UserRole | undefined;

      if (!role || !hasAllPermissions(role, permissions)) {
        return handleError(
          req,
          res,
          AppError.forbidden(
            `Forbidden: all of these permissions are required: ${permissions.join(', ')}`,
          ),
        );
      }

      return next();
    });
  };

/**
 * Middleware to require any of the specified permissions.
 * Returns 403 Forbidden if the user's role doesn't have at least one of the required permissions.
 *
 * @param permissions - Array of permissions (user needs at least one)
 */
export const requireAnyPermission =
  (...permissions: Permission[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    return requireAuth(req, res, () => {
      const role = (req as any).user?.role as UserRole | undefined;

      if (!role || !hasAnyPermission(role, permissions)) {
        return handleError(
          req,
          res,
          AppError.forbidden(
            `Forbidden: one of these permissions is required: ${permissions.join(', ')}`,
          ),
        );
      }

      return next();
    });
  };
