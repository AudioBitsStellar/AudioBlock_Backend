/**
 * Service for managing Privy session revocation (Issue #625).
 *
 * Tracks revoked Privy sessions (by session id) in memory with a TTL matching
 * the Privy access token lifetime. When a user explicitly logs out or an admin
 * revokes sessions, their session id is added to this cache. Token verification
 * checks this cache before accepting the token.
 *
 * Why in-memory rather than Redis:
 * - Session revocation is rare compared to token verification (logout vs every
 *   authenticated request)
 * - TTL matches token expiry (~1 hour), so memory footprint stays bounded
 * - No cross-process sync required: each server process tracks its own set,
 *   and a revoked token hitting a different server just gets rejected on the
 *   next refresh when Privy's own revocation takes effect
 */

import logger from '../../config/logger';

interface RevokedSession {
  sessionId: string;
  revokedAt: number;
  expiresAt: number;
}

/** In-process cache of revoked Privy sessions. */
class PrivySessionService {
  private revokedSessions: Map<string, RevokedSession> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Clean up expired revocations every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Mark a Privy session as revoked.
   *
   * @param sessionId - Privy session id from the token's `sid` claim
   * @param expiresAt - Seconds since epoch when the token naturally expires
   */
  revokeSession(sessionId: string, expiresAt: number): void {
    this.revokedSessions.set(sessionId, {
      sessionId,
      revokedAt: Math.floor(Date.now() / 1000),
      expiresAt,
    });

    logger.info({ sessionId, expiresAt }, 'Privy session marked as revoked');
  }

  /**
   * Mark all sessions for a given user as revoked.
   *
   * This is a best-effort operatio
tice this will be empty
    // unless the user was recently active on this server process.
    let count = 0;
    for (const session of this.revokedSessions.values()) {
      if (session.sessionId.startsWith(userId)) {
        this.revokeSession(session.sessionId, expiresAt);
        count++;
      }
    }

    logger.info({ userId, count, ttlSeconds }, 'Revoked all Privy sessions for user');
  }

  /**
   * Check if a session has been revoked.
   *
   * @param sessionId - Privy session id from the token's `sid` claim
   * @returns `true` if the session is known to be revoked, `false` otherwise
   */
  isSessionRevoked(sessionId: string): boolean {
    const revoked = this.revokedSessions.get(sessionId);
    if (!revoked) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    if (now >= revoked.expiresAt) {
      // Session's natural expiry has passed, so the revocation is no longer
      // relevant (the token would fail verification anyway)
      this.revokedSessions.delete(sessionId);
      return false;
    }

    return true;
  }

  /**
   * Remove expired revocations from the cache.
   *
   * Called automatically every 5 minutes by the background interval.
   */
  private cleanup(): void {
    const now = Math.floor(Date.now() / 1000);
    const before = this.revokedSessions.size;

    for (const [sessionId, session] of this.revokedSessions.entries()) {
      if (now >= session.expiresAt) {
        this.revokedSessions.delete(sessionId);
      }
    }

    const removed = before - this.revokedSessions.size;
    if (removed > 0) {
      logger.debug({ before, after: this.revokedSessions.size, removed }, 'Cleaned up revoked sessions');
    }
  }

  /**
   * Stop the cleanup interval. Call on graceful shutdown.
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get current cache size (for monitoring).
   */
  get size(): number {
    return this.revokedSessions.size;
  }
}

/** Global session service instance. */
export const privySessionService = new PrivySessionService();
