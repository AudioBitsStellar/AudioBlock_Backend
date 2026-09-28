import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '../entities/User';
import { Permission, roleHasPermission } from '../types/Permissions';
import { AppError, ErrorType } from '../errors/AppError';
import { handleError } from '../utils/helpers';
import logger from '../config/logger';
import {
  isLegacyAuthEnabled,
  isLegacyFallbackEnabled,
  isPrivyAuthEnabled,
} from '../config/authFlags';
import { privyAuthFallbacksTotal } from '../services/MetricsService';
import { looksLikePrivyToken, verifyPrivyAccessToken } from '../services/privy/PrivyTokenVerifier';
import { getPrivyJwksCacheSafe, type PrivyJwksCache } from '../services/privy/PrivyJwksCache';
import {
  isPrivyAvailabilityFailure,
  PrivyInvalidTokenError,
  PrivyKeyUnavailableError,
  PrivyMalformedTokenError,
  PrivyUnknownKeyError,
  PrivyUserNotSyncedError,
} from '../services/privy/PrivyErrors';
import { PrivyUserResolver } from '../services/privy/PrivyUserResolver';

export interface JwtPayload {
  id: string;
  role?: UserRole;
  email?: string;
  walletAddress?: string;
  stellarPublicKey?: string;
  username?: string;
  name?: string;
  emailVerified?: boolean;
  /**
   * Which credential authenticated this request. `legacy` for a JWT signed with
   * `JWT_SECRET`, `privy` for a Privy access token. Handlers can use this to
   * distinguish a normal Privy session from one served in a degraded mode.
   */
  authMethod?: 'legacy' | 'privy';
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

/** Pull the bearer token out of the Authorization header. */
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/** Legacy path: verify a JWT signed with `JWT_SECRET` and trust its claims. */
function authenticateLegacyToken(token: string): JwtPayload {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw AppError.businessLogic('JWT_SECRET is not configured');
  }

  const decoded = jwt.verify(token, secret) as JwtPayload;
  if (!decoded || !decoded.id) {
    throw AppError.authentication('Unauthorized: Invalid token');
  }

  return { ...decoded, authMethod: 'legacy' };
}

/**
 * 503 carrying an explicit `retryable` marker, used when Privy is unreachable.
 *
 * A 401 here would be actively harmful: clients treat that as "your credential
 * is no good" and typically discard a perfectly valid session, so a 30-second
 * Privy blip would sign every active user out. 503 plus a machine-readable code
 * lets clients keep the token and retry.
 *
 * Exported so `privyMiddleware` reports unavailability the same way this module
 * does, rather than inventing a second shape for the same condition.
 */
export function privyUnavailableError(reason: string): AppError {
  return new AppError(
    `Authentication service temporarily unavailable: ${reason}`,
    ErrorType.EXTERNAL_SERVICE_ERROR,
    503,
    true,
    { retryable: true, reason },
    'PRIVY_UNAVAILABLE',
  );
}

/** Verify a Privy access token and resolve it to a local account. */
async function authenticatePrivyToken(
  token: string,
  resolver: PrivyUserResolver,
  cache: PrivyJwksCache | null,
): Promise<JwtPayload> {
  // No cache means no `PRIVY_APP_ID`, so Privy tokens cannot be checked at all.
  // Classified as an availability failure so `AUTH_MODE=legacy` reads as the fix
  // rather than the request being treated as a bad credential.
  if (!cache) {
    throw new PrivyKeyUnavailableError('Privy is not configured on this deployment');
  }

  const verified = await verifyPrivyAccessToken(token, cache);
  const user = await resolver.resolve(verified.userId);

  return {
    id: user.id,
    role: user.role,
    email: user.email,
    username: user.username,
    name: user.name,
    walletAddress: user.walletAddress,
    stellarPublicKey: user.stellarPublicKey,
    emailVerified: user.emailVerified,
    authMethod: 'privy',
  };
}

/**
 * Translate a Privy verification failure into the right HTTP response.
 *
 * The central distinction is *rejection* versus *unavailable*. A bad signature or
 * an expired token is the caller's problem and gets 401. Privy being unreachable
 * is our problem and gets a retryable 503.
 */
function toAuthError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof PrivyUserNotSyncedError) {
    // 409, not 401: the credential is good, we simply have no account for it yet.
    // Issue #602 adds the first-login sync endpoint.
    return new AppError(
      error.message,
      ErrorType.BUSINESS_LOGIC_ERROR,
      409,
      true,
      undefined,
      'PRIVY_USER_NOT_SYNCED',
    );
  }

  if (isPrivyAvailabilityFailure(error)) {
    return privyUnavailableError((error as Error).message);
  }

  if (
    error instanceof PrivyInvalidTokenError ||
    error instanceof PrivyUnknownKeyError ||
    error instanceof PrivyMalformedTokenError
  ) {
    return AppError.authentication('Unauthorized: Invalid or expired Privy token');
  }

  // Anything unrecognised fails closed as a 401. Availability must be positively
  // identified, never assumed — otherwise an unexpected error shape would
  // silently downgrade a rejection into a retryable 503, or worse.
  return AppError.authentication('Unauthorized: Invalid or expired token');
}

/**
 * True when Privy is known to be down, judged by an open circuit breaker.
 *
 * Safe to call only when Privy is enabled and configured: constructing the cache
 * requires `PRIVY_APP_ID`, so a misconfigured deployment must not blow up here.
 */
function isPrivyDegraded(cache: PrivyJwksCache | null): boolean {
  if (!isPrivyAuthEnabled() || !process.env.PRIVY_APP_ID) {
    return false;
  }
  return (cache ?? getPrivyJwksCacheSafe())?.isDegraded() ?? false;
}

/**
 * Authenticate a request according to the configured `AUTH_MODE` (Issue #636).
 *
 * Token selection uses the `alg` header rather than a heuristic: legacy tokens are
 * HS256 and Privy access tokens are ES256, so the algorithm identifies the
 * credential type exactly. Nothing is trusted here — `alg` only selects *which*
 * verifier runs, and each verifier independently re-checks the algorithm.
 *
 * **How Privy downtime is handled (Issue #635).** A Privy ES256 token can never
 * be verified by the legacy HS256 verifier, so there is no token-level fallback
 * and pretending otherwise would be a fiction. What actually keeps a staged
 * rollout alive through a Privy outage is:
 *
 * 1. Stale JWKS keys keep verifying throughout, so a warm cache means no
 *    user-visible impact at all (see `PrivyJwksCache`, Issue #634).
 * 2. Legacy-issued tokens authenticate normally the whole time, because that path
 *    never touches the Privy API. This is the real fallback: a mixed fleet keeps
 *    serving while Privy users wait.
 * 3. Availability failures surface as a retryable 503, never a 401, so clients
 *    keep their sessions instead of being logged out by a transient blip.
 * 4. `AUTH_MODE=legacy` remains the instant operator rollback (Issue #636).
 *
 * `PRIVY_ALLOW_LEGACY_FALLBACK` then decides what a *known* outage does to legacy
 * traffic. On (default), legacy requests keep working and only the Privy path
 * returns 503 — availability is preserved. Off, a degraded Privy fails *all* auth
 * with 503, which an operator may prefer during an incident so that clients see
 * one uniform, retryable failure instead of a population split across two
 * different behaviours mid-outage.
 *
 * @param req - The incoming request.
 * @param res - The response, used only to emit errors.
 * @param next - Continue to the next handler on success.
 * @param resolver - Injectable Privy→local user resolver.
 * @param cache - Injectable JWKS cache; defaults to the process-wide one.
 */
export async function authenticateRequest(
  req: Request,
  res: Response,
  next: NextFunction,
  resolver: PrivyUserResolver = new PrivyUserResolver(),
  cache: PrivyJwksCache | null = getPrivyJwksCacheSafe(),
): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    handleError(req, res, AppError.authentication('Unauthorized: No token provided'));
    return;
  }

  const isPrivyCandidate = looksLikePrivyToken(token);

  // Operator asked for the whole API to fail closed while Privy is known down.
  if (!isLegacyFallbackEnabled() && isPrivyDegraded(cache)) {
    privyAuthFallbacksTotal.inc();
    logger.error({ route: req.path }, 'Privy degraded; refusing auth (legacy fallback disabled)');
    handleError(
      req,
      res,
      privyUnavailableError('Privy is degraded and legacy fallback is disabled'),
    );
    return;
  }

  try {
    let user: JwtPayload;

    if (isPrivyCandidate) {
      if (!isPrivyAuthEnabled()) {
        throw AppError.authentication('Unauthorized: Privy authentication is not enabled');
      }
      user = await authenticatePrivyToken(token, resolver, cache);
    } else {
      if (!isLegacyAuthEnabled()) {
        throw AppError.authentication('Unauthorized: Legacy authentication is not enabled');
      }
      user = authenticateLegacyToken(token);
    }

    (req as any).user = user;
    next();
  } catch (error) {
    const authError = toAuthError(error);

    if (authError.code === 'PRIVY_UNAVAILABLE') {
      // Count and log availability failures separately from rejections: the two
      // mean very different things operationally, and alerting on their sum
      // would fire on every credential-stuffing attempt.
      privyAuthFallbacksTotal.inc();
      logger.error({ err: error, route: req.path }, 'Privy verification unavailable');
    } else if (!(error instanceof AppError)) {
      logger.error({ err: error, route: req.path }, 'Authentication error');
    }

    handleError(req, res, authError);
  }
}

/**
 * Require a valid session. Dispatches on `AUTH_MODE` (Issue #636).
 *
 * Returns synchronously and defers to {@link authenticateRequest}, so it still
 * composes as ordinary Express middleware.
 */
export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  void authenticateRequest(req, res, next);
};

export const optionalAuth = (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    const token = extractBearerToken(req);
    if (!token) {
      return next();
    }

    try {
      if (looksLikePrivyToken(token)) {
        if (!isPrivyAuthEnabled()) return next();
        (req as any).user = await authenticatePrivyToken(
          token,
          new PrivyUserResolver(),
          getPrivyJwksCacheSafe(),
        );
      } else {
        if (!isLegacyAuthEnabled()) return next();
        (req as any).user = authenticateLegacyToken(token);
      }
    } catch {
      // An optional-auth route treats a bad credential as anonymous rather than
      // as an error — that is the point of this variant.
    }
    next();
  })();
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
