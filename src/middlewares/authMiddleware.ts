import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '../entities/User';
import { Permission, roleHasPermission } from '../types/Permissions';
import { AppError } from '../errors/AppError';
import { handleError } from '../utils/helpers';

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
          AppError.authorization(
            `Forbidden: one of these roles is required: ${allowedRoles.join(', ')}`,
          ),
        );
      }

      return next();
    });
  };

export const authArtistMiddleware = requireRoles(UserRole.ARTIST, UserRole.ADMIN);
export const authListenerMiddleware = requireRoles(UserRole.LISTENER, UserRole.ADMIN);

/**
 * RBAC middleware: authenticates the request, then authorizes it against a
 * granular permission (Issue #100). Unlike {@link requireRoles}, callers name
 * the capability they need rather than the roles that happen to have it.
 *
 * Returns 401 when the caller is unauthenticated (no/invalid token) and 403
 * when authenticated but the role lacks the required permission.
 */
export const requirePermission =
  (permission: Permission) => (req: Request, res: Response, next: NextFunction) => {
    return requireAuth(req, res, () => {
      const role = (req as any).user?.role as UserRole | undefined;
      if (!role || !roleHasPermission(role, permission)) {
        return handleError(
          req,
          res,
          AppError.authorization(`Forbidden: missing required permission: ${permission}`),
        );
      }

      return next();
    });
  };

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
