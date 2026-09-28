/**
 * In-process cache of the ES256 public keys Privy signs access tokens with
 * (Issue #634).
 *
 * Verifying a Privy access token needs the app's signing keys, served as a JWKS
 * document at a public URL. Fetching that document per request would put a
 * third-party round trip — and a third-party failure mode — in front of every
 * authenticated call, and would make Privy's availability a hard prerequisite
 * for the whole API. The keys rotate rarely, so they are cached:
 *
 * - **Single-flight.** Concurrent misses collapse onto one in-flight fetch.
 *   Without this a cold start under load fires N identical requests, which is
 *   wasteful and a good way to get rate-limited.
 * - **TTL with a stale window.** Keys stay usable past their TTL. Expiry is a
 *   *refresh* trigger, not an invalidation point: the alternative — discarding a
 *   working key — turns a routine refresh failure into an authentication
 *   outage. Inside the stale window a failed refresh is served from the last
 *   good set, which is the graceful-downtime path of Issue #635.
 * - **Negative caching + refetch cooldown.** These two bound the damage an
 *   unknown `kid` can do. During a key rotation a burst of requests carrying the
 *   new `kid` must still be able to fetch, so unknown kids are remembered only
 *   briefly; but a caller sending *random* kids must not be able to turn us into
 *   a load generator against our own JWKS endpoint. The cooldown allows at most
 *   one network fetch per window regardless of how many distinct unknown kids
 *   arrive, bounding the cost of picking up a rotated key to one refresh period.
 *
 * The cache is per-process, and deliberately so. A shared cache would have to be
 * invalidated correctly across the fleet on rotation, and the failure mode of
 * getting that wrong is accepting a revoked key. One fetch per instance per TTL
 * is a rounding error against traffic.
 *
 * Serving a stale key cannot extend a token's life: `exp` is enforced
 * independently by the verifier, so a stale key only affects whether a
 * *still-valid* token is accepted, never whether an expired one is.
 */

import { createPublicKey, type KeyObject } from 'crypto';
import axios from 'axios';
import logger from '../../config/logger';
import { getPrivyConfig, PRIVY_TOKEN_ALGORITHM } from '../../config/privyAuth';
import {
  privyJwkCacheHitsTotal,
  privyJwkCacheMissesTotal,
  privyJwkFetchesTotal,
  privyJwkUnknownKidTotal,
} from '../MetricsService';
import {
  CircuitOpenError,
  createPrivyCircuitBreaker,
  resilientCall,
  type CircuitBreaker,
  type CircuitSnapshot,
} from './PrivyResilience';
import { PrivyKeyUnavailableError, PrivyUnknownKeyError } from './PrivyErrors';

/** A single entry from a JWKS document. Only the fields we care about. */
export interface Jwk {
  kid?: string;
  kty?: string;
  crv?: string;
  alg?: string;
  use?: string;
}

export interface JwksDocument {
  keys?: Jwk[];
}

interface CacheEntry {
  /** kid -> imported public key. */
  keys: Map<string, KeyObject>;
  /** When this set was last fetched from Privy. */
  fetchedAt: number;
  /** Before this, the entry is fresh and needs no refresh. */
  expiresAt: number;
  /** After this, the entry is refused outright. */
  hardExpireAt: number;
}

export interface PrivyJwksCacheOptions {
  /** Injected for tests. */
  now?: () => number;
  /** Injected for tests, in place of an axios GET of the JWKS endpoint. */
  fetchJwks?: () => Promise<JwksDocument>;
  breaker?: CircuitBreaker;
}

/** Read-only view of cache state, for a health endpoint. */
export interface JwksCacheSnapshot {
  loaded: boolean;
  keyCount: number;
  ageMs: number | null;
  expiresInMs: number | null;
  servingStale: boolean;
  breaker: CircuitSnapshot;
}

/**
 * Convert a JWKS entry into a Node public key, or null if it is unusable.
 *
 * Returns null rather than throwing so one malformed entry from upstream is
 * skipped instead of poisoning the entire set and taking down every token
 * verification.
 */
export function importPrivyJwk(jwk: Jwk): KeyObject | null {
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') return null;
  if (jwk.use && jwk.use !== 'sig') return null;
  if (jwk.alg && jwk.alg !== PRIVY_TOKEN_ALGORITHM) return null;
  if (typeof jwk.kid !== 'string' || jwk.kid.length === 0) return null;

  // Require the EC coordinates explicitly: a truncated document should fail
  // here, not deep inside crypto with a confusing message.
  const raw = jwk as unknown as { x?: string; y?: string };
  if (typeof raw.x !== 'string' || typeof raw.y !== 'string') return null;

  try {
    return createPublicKey({ key: { ...raw, kty: 'EC', crv: 'P-256' }, format: 'jwk' });
  } catch (err) {
    logger.warn({ err, kid: jwk.kid }, 'Skipping unimportable Privy JWK');
    return null;
  }
}

export class PrivyJwksCache {
  private entry: CacheEntry | null = null;
  /** kids we have looked up and not found, mapped to when we learned that. */
  private readonly unknownKids = new Map<string, number>();
  /** Shared across concurrent callers so one fetch serves a burst. */
  private inFlight: Promise<CacheEntry> | null = null;
  /** Timestamp of the last completed fetch, for the anti-amplification cooldown. */
  private lastFetchAt: number | null = null;

  private readonly now: () => number;
  private readonly fetchJwks: () => Promise<JwksDocument>;
  private readonly breaker: CircuitBreaker;
  private readonly config = getPrivyConfig();

  constructor(options: PrivyJwksCacheOptions = {}) {
    this.now = options.now ?? Date.now;
    this.breaker =
      options.breaker ??
      createPrivyCircuitBreaker({
        failureThreshold: this.config.circuitFailureThreshold,
        resetTimeoutMs: this.config.circuitResetTimeoutMs,
        startsOpen: this.config.circuitStartsOpen,
      });
    this.fetchJwks =
      options.fetchJwks ??
      (async () => {
        const response = await axios.get<JwksDocument>(this.config.jwksUrl, {
          timeout: this.config.requestTimeoutMs,
          headers: { Accept: 'application/json' },
        });
        return response.data;
      });
  }

  /**
   * Resolve the public key for a token's `kid`, fetching the JWKS if needed.
   *
   * @param kid - The `kid` header of the token being verified.
   * @returns The public key to verify the signature against.
   * @throws {PrivyUnknownKeyError} No key matches this `kid`. Definitive — the
   *   token is not verifiable and retrying will not help.
   * @throws {PrivyKeyUnavailableError} No usable key could be obtained, including
   *   because Privy was unreachable and nothing was cached. Transient in nature.
   */
  async getKey(kid: string): Promise<KeyObject> {
    // A token with no `kid` gives us nothing to select on. Trying every cached
    // key in turn would turn verification into an oracle, so refuse.
    if (typeof kid !== 'string' || kid.length === 0) {
      privyJwkUnknownKidTotal.inc();
      throw new PrivyUnknownKeyError('Token is missing a key id (kid) header');
    }

    const entry = this.entry;
    const now = this.now();

    // A kid we have already looked up and not found is refused outright, with no
    // network call. This is what stops an attacker replaying one bad kid from
    // generating a request each time.
    if (this.isUnknownKidCached(kid)) {
      privyJwkCacheHitsTotal.inc();
      privyJwkUnknownKidTotal.inc();
      throw new PrivyUnknownKeyError(`No Privy signing key matches kid "${kid}"`);
    }

    if (entry && now < entry.expiresAt) {
      const key = entry.keys.get(kid);
      if (key) {
        privyJwkCacheHitsTotal.inc();
        return key;
      }

      // Fresh set, but this kid is new to us. A brand-new kid is exactly what a
      // key rotation looks like, so it earns one fetch attempt — but only if the
      // cooldown has passed, which is what bounds a flood of random kids to a
      // single request per window.
      if (!this.canRefetch()) {
        this.noteUnknownKid(kid);
        privyJwkUnknownKidTotal.inc();
        throw new PrivyUnknownKeyError(`No Privy signing key matches kid "${kid}"`);
      }
    }

    privyJwkCacheMissesTotal.inc();
    const refreshed = await this.refresh();
    const key = refreshed.keys.get(kid);

    if (key) {
      this.unknownKids.delete(kid);
      return key;
    }

    this.noteUnknownKid(kid);
    privyJwkUnknownKidTotal.inc();
    throw new PrivyUnknownKeyError(`No Privy signing key matches kid "${kid}"`);
  }

  /**
   * Whether a JWKS refetch is currently permitted.
   *
   * Always true when nothing has ever been fetched (a cold start has no other
   * option), otherwise rate-limited to one fetch per negative-TTL window.
   */
  private canRefetch(): boolean {
    if (this.lastFetchAt === null) return true;
    return this.now() - this.lastFetchAt >= this.config.jwksNegativeTtlMs;
  }

  /** Fetch a fresh key set, collapsing concurrent callers onto one request. */
  private refresh(): Promise<CacheEntry> {
    if (this.inFlight) {
      return this.inFlight;
    }
    const run = this.doRefresh().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  private async doRefresh(): Promise<CacheEntry> {
    // Cold start: nothing to serve, so a fetch is the only way forward.
    if (!this.entry) {
      return this.fetchAndStore();
    }

    // Anti-amplification cooldown. At most one network fetch per negative-TTL
    // window, no matter how many distinct unknown kids we are asked about. The
    // cost of picking up a rotated key is therefore bounded by this window
    // rather than by attacker-supplied traffic.
    const lastFetch = this.lastFetchAt;
    if (lastFetch !== null && this.now() - lastFetch < this.config.jwksNegativeTtlMs) {
      return this.staleEntryOrThrow(
        new PrivyKeyUnavailableError('Privy key set refresh is in its cooldown window'),
        true,
      );
    }

    return this.fetchAndStore();
  }

  private async fetchAndStore(): Promise<CacheEntry> {
    try {
      const document = await resilientCall(this.breaker, async () => this.fetchJwks(), {
        operation: 'jwks.fetch',
        attempts: this.config.retryAttempts,
        baseDelayMs: this.config.retryBaseDelayMs,
        maxDelayMs: this.config.retryMaxDelayMs,
      });

      const keys = new Map<string, KeyObject>();
      for (const jwk of document?.keys ?? []) {
        const imported = importPrivyJwk(jwk);
        if (imported && jwk.kid) {
          keys.set(jwk.kid, imported);
        }
      }

      // A 200 with no usable keys is a misconfiguration or a bad upstream
      // response, not a legitimate "no keys" state. Treating it as a valid
      // empty set would reject every token while also clearing the cache.
      if (keys.size === 0) {
        throw new Error('Privy JWKS response contained no usable ES256 keys');
      }

      const at = this.now();
      this.entry = {
        keys,
        fetchedAt: at,
        expiresAt: at + this.config.jwksTtlMs,
        hardExpireAt: at + this.config.jwksStaleTtlMs,
      };
      this.lastFetchAt = at;
      this.unknownKids.clear();
      privyJwkFetchesTotal.inc({ outcome: 'success' });

      logger.info(
        { keyCount: keys.size, ttlMs: this.config.jwksTtlMs },
        'Refreshed Privy JWKS cache',
      );
      return this.entry;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: error }, `Failed to refresh Privy JWKS: ${message}`);
      privyJwkFetchesTotal.inc({ outcome: 'failure' });

      const reason =
        error instanceof CircuitOpenError
          ? 'Privy is unavailable (circuit breaker open)'
          : `Privy JWKS fetch failed: ${message}`;

      return this.staleEntryOrThrow(new PrivyKeyUnavailableError(reason, error));
    }
  }

  /**
   * Return the last known good key set when it is still inside the stale window,
   * otherwise propagate `error`.
   *
   * @param duringCooldown - Suppress the "failure" metric, since a cooldown skip
   *   is a deliberate rate limit rather than a failed call.
   */
  private staleEntryOrThrow(error: Error, duringCooldown = false): CacheEntry {
    const entry = this.entry;
    const now = this.now();

    if (entry && this.config.allowStaleKeysOnError && now < entry.hardExpireAt) {
      if (!duringCooldown) {
        privyJwkFetchesTotal.inc({ outcome: 'stale_served' });
      }
      logger.warn(
        { ageMs: now - entry.fetchedAt, keyCount: entry.keys.size, duringCooldown },
        'Serving stale Privy signing keys instead of the JWKS endpoint',
      );
      return entry;
    }

    throw error;
  }

  private noteUnknownKid(kid: string): void {
    this.unknownKids.set(kid, this.now());
  }

  private isUnknownKidCached(kid: string): boolean {
    const seenAt = this.unknownKids.get(kid);
    if (seenAt === undefined) return false;
    if (this.now() - seenAt >= this.config.jwksNegativeTtlMs) {
      this.unknownKids.delete(kid);
      return false;
    }
    return true;
  }

  /** Current cache and breaker state, for a health endpoint. */
  getSnapshot(): JwksCacheSnapshot {
    const entry = this.entry;
    const now = this.now();
    return {
      loaded: entry !== null,
      keyCount: entry?.keys.size ?? 0,
      ageMs: entry ? now - entry.fetchedAt : null,
      expiresInMs: entry ? Math.max(0, entry.expiresAt - now) : null,
      servingStale: Boolean(entry && now >= entry.expiresAt && now < entry.hardExpireAt),
      breaker: {
        name: 'privy',
        state: this.breaker.getState(),
        consecutiveFailures: 0,
        retryAfterMs: this.breaker.getRetryAfterMs(),
      },
    };
  }

  /**
   * True when Privy is known to be down (breaker open) — the signal the auth
   * middleware uses to decide whether legacy fallback is appropriate.
   */
  isDegraded(): boolean {
    return this.breaker.getState() === 'open';
  }

  /**
   * Drop all cached state. The next verification repopulates from the JWKS
   * endpoint.
   */
  invalidate(): void {
    this.entry = null;
    this.unknownKids.clear();
    this.lastFetchAt = null;
  }
}

/**
 * Process-wide cache instance.
 *
 * Construction is lazy: importing this module must not throw on a server that
 * has never set `PRIVY_APP_ID`, since `legacy` auth mode does not need it.
 */
let sharedCache: PrivyJwksCache | null = null;
let sharedCacheKey: string | null = null;

export function getPrivyJwksCache(): PrivyJwksCache {
  const config = getPrivyConfig();
  // Rebuild if the app id or endpoint changed under us, otherwise a cache built
  // for a previous app could serve that app's keys to this one.
  const cacheKey = `${config.appId}|${config.jwksUrl}`;
  if (!sharedCache || sharedCacheKey !== cacheKey) {
    sharedCache = new PrivyJwksCache();
    sharedCacheKey = cacheKey;
  }
  return sharedCache;
}

/**
 * The shared cache, or null when Privy is not configured.
 *
 * Callers on a request path use this rather than {@link getPrivyJwksCache} so a
 * deployment with no `PRIVY_APP_ID` gets a clear "not configured" result instead
 * of an exception thrown from cache construction.
 */
export function getPrivyJwksCacheSafe(): PrivyJwksCache | null {
  try {
    return getPrivyJwksCache();
  } catch {
    return null;
  }
}

/** Reset the shared instance. Test-only. */
export function resetPrivyJwksCache(): void {
  sharedCache = null;
  sharedCacheKey = null;
}
