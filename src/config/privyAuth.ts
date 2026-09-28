/**
 * Typed access to Privy configuration and its resilience tuning knobs
 * (Issues #634, #635).
 *
 * Everything is read lazily from `process.env` on each access rather than
 * snapshotted at import time, so tests can flip env vars between cases without
 * needing a module reset.
 *
 * Privy's JWKS URL is configurable because the exact path has moved between SDK
 * versions. Copy the JWKS URL from the Privy dashboard (Configuration → App
 * settings) into `PRIVY_JWKS_URL`; the default below matches the documented
 * `https://auth.privy.io/api/v1/apps/{appId}/.well-known/jwks.json` layout.
 */

const DEFAULT_API_URL = 'https://auth.privy.io/api';
const DEFAULT_TIMEOUT_MS = 5_000;

/** Reads a positive-integer env var, falling back when unset/invalid/non-positive. */
function intVar(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boolVar(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw.toLowerCase() === 'true';
}

export interface PrivyConfig {
  /** Privy app id. Required for any Privy auth to work. */
  appId: string;
  /** Privy app secret. Only needed for privileged API calls, not token verification. */
  appSecret?: string;
  /** Base URL for Privy's API, used to derive the JWKS URL when it is not set explicitly. */
  apiUrl: string;
  /** Fully-resolved JWKS URL the public signing keys are fetched from. */
  jwksUrl: string;
  /** How long a fetched key set is considered fresh (Issue #634). */
  jwksTtlMs: number;
  /** How long a key set may still be served after it goes stale, if refresh fails (Issue #635). */
  jwksStaleTtlMs: number;
  /** How long an unknown `kid` is remembered as unknown, so a burst of requests with a bad key does not hammer the JWKS endpoint. */
  jwksNegativeTtlMs: number;
  /** Per-request timeout when talking to Privy. */
  requestTimeoutMs: number;
  /** Total attempts (1 = no retry) for transient Privy failures (Issue #635). */
  retryAttempts: number;
  /** First backoff delay; doubles per attempt. */
  retryBaseDelayMs: number;
  /** Ceiling for a single backoff delay. */
  retryMaxDelayMs: number;
  /** Consecutive failures before the circuit breaker opens. */
  circuitFailureThreshold: number;
  /** How long the breaker stays open before allowing a probe request. */
  circuitResetTimeoutMs: number;
  /** Whether the circuit breaker starts open (useful for a cold standby replica). */
  circuitStartsOpen: boolean;
  /**
   * Whether a stale-but-known key may be served when the JWKS endpoint is
   * unreachable. Defaults on: an expired access token is still rejected on its
   * own `exp`, so serving a slightly stale key cannot extend token lifetime —
   * it only avoids rejecting a still-valid token over a network blip.
   */
  allowStaleKeysOnError: boolean;
}

/**
 * Build the effective Privy configuration.
 *
 * @throws {Error} If `PRIVY_APP_ID` is missing, since the JWKS URL cannot be
 *   derived without it and every caller here needs it.
 */
export function getPrivyConfig(): PrivyConfig {
  const appId = (process.env.PRIVY_APP_ID || '').trim();
  if (!appId) {
    throw new Error('PRIVY_APP_ID is not set');
  }

  const apiUrl = (process.env.PRIVY_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');
  const jwksUrl = (
    process.env.PRIVY_JWKS_URL ||
    `${apiUrl}/v1/apps/${encodeURIComponent(appId)}/.well-known/jwks.json`
  ).trim();

  return {
    appId,
    appSecret: (process.env.PRIVY_APP_SECRET || '').trim() || undefined,
    apiUrl,
    jwksUrl,
    jwksTtlMs: intVar('PRIVY_JWKS_TTL_MS', 60 * 60 * 1000),
    jwksStaleTtlMs: intVar('PRIVY_JWKS_STALE_TTL_MS', 24 * 60 * 60 * 1000),
    jwksNegativeTtlMs: intVar('PRIVY_JWKS_NEGATIVE_TTL_MS', 60 * 1000),
    requestTimeoutMs: intVar('PRIVY_REQUEST_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    retryAttempts: intVar('PRIVY_RETRY_ATTEMPTS', 3),
    retryBaseDelayMs: intVar('PRIVY_RETRY_BASE_DELAY_MS', 200),
    retryMaxDelayMs: intVar('PRIVY_RETRY_MAX_DELAY_MS', 2_000),
    circuitFailureThreshold: intVar('PRIVY_CIRCUIT_FAILURE_THRESHOLD', 5),
    circuitResetTimeoutMs: intVar('PRIVY_CIRCUIT_RESET_TIMEOUT_MS', 30_000),
    circuitStartsOpen: boolVar('PRIVY_CIRCUIT_STARTS_OPEN', false),
    allowStaleKeysOnError: boolVar('PRIVY_ALLOW_STALE_KEYS', true),
  };
}

/** The expected `iss` claim on every Privy-issued token. */
export const PRIVY_TOKEN_ISSUER = 'privy.io';

/** Privy access tokens are ES256; pinned so `alg: none` / HS256 downgrades fail. */
export const PRIVY_TOKEN_ALGORITHM = 'ES256';
