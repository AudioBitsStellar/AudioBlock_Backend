import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import { handleError } from '../utils/helpers';
import logger from '../config/logger';
import { isPrivyEnabled } from '../config/privy';
import { getPrivyJwksCacheSafe } from '../services/privy/PrivyJwksCache';
import { isPrivyAvailabilityFailure } from '../services/privy/PrivyErrors';
import { verifyPrivyAccessToken } from '../services/privy/PrivyTokenVerifier';
import { privyUnavailableError } from './authMiddleware';

export interface PrivyUser {
  id: string;
  email?: string;
  walletAddress?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      privyUser?: PrivyUser;
    }
  }
}

/**
 * Authenticate a request with a Privy access token.
 *
 * **Security note — this previously did not verify anything.** The original
 * implementation (merged in #703) base64-decoded the token payload and read
 * `sub` straight out of it, accepting the `verificationKey` argument and never
 * using it. Since it is wired to `POST /api/auth/privy/refresh-token`, which mints
 * a `JWT_SECRET`-signed access token for `privyUser.id`, anyone could mint a
 * valid session for an arbitrary user id by sending a hand-crafted token such as
 * `x.eyJzdWIiOiJ2aWN0aW0ifQ.y` — a full account takeover. Fixed here by routing
 * through the real verifier.
 *
 * Verification is signature + claim based, using the cached Privy JWKS
 * (`PrivyTokenVerifier`). A rejected token is a 401 and never falls back to any
 * other credential; only an availability failure produces a retryable 503.
 */
export const requirePrivyAuth = (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    if (!isPrivyEnabled) {
      return handleError(req, res, AppError.authentication('Privy authentication is not enabled'));
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return handleError(req, res, AppError.authentication('Privy token required'));
    }
    const token = authHeader.slice('Bearer '.length).trim();

    const cache = getPrivyJwksCacheSafe();
    if (!cache) {
      // Configured for Privy but the key set cannot be resolved, so nothing can
      // be verified. Fail closed rather than accepting an unverified token.
      return handleError(
        req,
        res,
        AppError.authentication('Privy authentication is misconfigured (no PRIVY_APP_ID)'),
      );
    }

    try {
      const verified = await verifyPrivyAccessToken(token, cache);
      req.privyUser = { id: verified.userId };
      return next();
    } catch (error) {
      if (isPrivyAvailabilityFailure(error)) {
        // Privy is unreachable. 503 + retryable, not 401, so a client does not
        // discard a perfectly valid session over a transient blip.
        logger.error({ err: error, route: req.path }, 'Privy verification unavailable');
        return handleError(req, res, privyUnavailableError((error as Error).message));
      }
      return handleError(req, res, AppError.authentication('Invalid Privy token'));
    }
  })();
};
