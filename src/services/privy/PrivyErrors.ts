/**
 * Error types for the Privy integration.
 *
 * The split that matters is *definitive rejection* versus *unavailable*. A
 * caller who presented a bad signature or an expired token is an attacker or a
 * bug, and must be rejected. A caller we could not check because Privy was
 * unreachable is a victim of an outage, and may be given a lower-assurance
 * fallback (Issue #635) or a retryable error. Conflating the two would either
 * let an outage bypass authentication or turn a transient blip into a lockout.
 */

/** The token is invalid: bad signature, wrong audience/issuer, or expired. Never fall back. */
export class PrivyInvalidTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrivyInvalidTokenError';
  }
}

/** The JWKS was retrieved but holds no key for this `kid`. Never fall back. */
export class PrivyUnknownKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrivyUnknownKeyError';
  }
}

/**
 * Privy could not be reached, or no usable key was available.
 *
 * Transient by nature — callers may retry, serve stale keys, or fall back to
 * legacy auth, subject to configuration.
 */
export class PrivyKeyUnavailableError extends Error {
  override readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'PrivyKeyUnavailableError';
    this.cause = cause;
  }
}

/** The token was structurally not a JWT, or carried no `kid`. */
export class PrivyMalformedTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrivyMalformedTokenError';
  }
}

/**
 * A Privy identity has no corresponding local user row.
 *
 * Distinct from the errors above because it is neither an attack nor an outage:
 * the caller authenticated fine, we simply have not created their local
 * account. The first-login sync endpoint (Issue #602) resolves this.
 */
export class PrivyUserNotSyncedError extends Error {
  readonly privyUserId: string;

  constructor(privyUserId: string) {
    super('No local account is linked to this Privy identity yet');
    this.name = 'PrivyUserNotSyncedError';
    this.privyUserId = privyUserId;
  }
}

/**
 * Narrow an unknown rejection to the "Privy is unavailable" family.
 *
 * Used by the auth middleware to decide whether legacy fallback is permitted,
 * so it must be conservative: anything not positively identified as an
 * availability failure counts as a rejection and fails closed.
 */
export function isPrivyAvailabilityFailure(error: unknown): boolean {
  return error instanceof PrivyKeyUnavailableError;
}
