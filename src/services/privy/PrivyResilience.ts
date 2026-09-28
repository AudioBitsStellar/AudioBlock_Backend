/**
 * Resilience primitives for calls into the Privy API (Issue #635).
 *
 * Privy is a third-party dependency of the login path: when it is slow or down,
 * every authenticated request stalls and eventually times out, and a naive
 * retry loop makes an outage worse by multiplying load on an already-struggling
 * upstream. Two mechanisms keep that bounded:
 *
 * - {@link withRetry} — bounded exponential backoff with full jitter, applied
 *   only to errors that could plausibly succeed on a second attempt. Retrying a
 *   400 or a malformed-token rejection just burns time and rate limit budget.
 * - {@link CircuitBreaker} — after a run of consecutive failures the breaker
 *   opens and short-circuits further calls for a cool-down window, so an outage
 *   costs a predictable, near-zero-latency error instead of a timeout per
 *   request. One probe request is then let through to test recovery.
 *
 * The two are composed by {@link resilientCall}, breaker outermost, so a call
 * that is rejected outright consumes no retry budget and trips no failure
 * counter.
 */

import logger from '../../config/logger';
import { privyCircuitState } from '../MetricsService';

/** Error raised when the breaker is open and no probe is due. */
export class CircuitOpenError extends Error {
  /** Time left on the current open window, in ms. */
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super('Privy circuit breaker is open');
    this.name = 'CircuitOpenError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** Raised when every retry attempt has been exhausted. */
export class RetriesExhaustedError extends Error {
  readonly attempts: number;
  /** The underlying failure from the final attempt. */
  override readonly cause: unknown;

  constructor(attempts: number, cause: unknown) {
    super(`Privy call failed after ${attempts} attempt(s)`);
    this.name = 'RetriesExhaustedError';
    this.attempts = attempts;
    this.cause = cause;
  }
}

/** Minimal shape of an axios-style error, kept structural to avoid a hard axios dep here. */
interface HttpishError {
  message?: string;
  code?: string;
  response?: { status?: number; headers?: Record<string, unknown> };
}

/**
 * Whether a failure is worth another attempt.
 *
 * Retryable: connection-level problems (DNS, reset, refused, timeout) and HTTP
 * 408/429/5xx. Not retryable: any other 4xx — the request itself is wrong and
 * will be equally wrong next time — and unrecognised errors, which we treat as
 * permanent so a programming error is not silently retried five times.
 *
 * @param error - The rejection value from the failed call.
 */
export function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const err = error as HttpishError;
  if (err instanceof CircuitOpenError) return false;

  const status = err.response?.status;
  if (typeof status === 'number') {
    return status === 408 || status === 429 || status >= 500;
  }

  // No HTTP response at all: a transport-layer failure. Treat the standard Node
  // socket/DNS/TLS error codes as retryable, and axios' own timeout sentinel.
  const retryableCodes = new Set([
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'EPIPE',
    'ETIMEDOUT',
    'ERR_NETWORK',
  ]);
  if (typeof err.code === 'string' && retryableCodes.has(err.code)) {
    return true;
  }

  return false;
}

/** Pull a `Retry-After` hint (seconds or HTTP-date) off an error response, in ms. */
function retryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const headers = (error as HttpishError).response?.headers;
  const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
  if (raw === undefined || raw === null) return undefined;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const asDate = Date.parse(String(raw));
  if (!Number.isNaN(asDate)) {
    return Math.max(0, asDate - Date.now());
  }
  return undefined;
}

export interface RetryOptions {
  /** Total attempts including the first. `1` disables retrying. */
  attempts: number;
  /** Delay before the first retry; doubles each subsequent retry. */
  baseDelayMs: number;
  /** Ceiling for any single backoff delay. */
  maxDelayMs: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected for tests; must return a value in `[0, 1)`. */
  random?: () => number;
  /** Label used in log lines. */
  operation: string;
  /** Decides retryability; defaults to {@link isRetryableError}. */
  isRetryable?: (error: unknown) => boolean;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Run `fn`, retrying transient failures with exponential backoff and full jitter.
 *
 * "Full jitter" (a uniform draw from `[0, delay]`) rather than fixed backoff:
 * when a whole fleet of instances fails at the same instant, fixed delays
 * re-synchronise them into a repeating thundering herd, whereas jitter spreads
 * the retries out. A server-supplied `Retry-After` always wins over our own
 * backoff, so we honour an explicit cooldown rather than guessing against it.
 *
 * @throws {RetriesExhaustedError} When all attempts fail with a retryable error.
 * @throws The original error when a non-retryable failure is hit, unwrapped.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const {
    attempts,
    baseDelayMs,
    maxDelayMs,
    operation,
    sleep = defaultSleep,
    random = Math.random,
    isRetryable = isRetryableError,
  } = options;

  const totalAttempts = Math.max(1, Math.floor(attempts));
  let lastError: unknown;

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (!isRetryable(error) || attempt === totalAttempts) {
        break;
      }

      const serverHint = retryAfterMs(error);
      const backoffCeiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delay = serverHint ?? Math.round(random() * backoffCeiling);

      logger.warn(
        { operation, attempt, totalAttempts, delay, err: error },
        'Privy call failed; retrying after backoff',
      );
      await sleep(delay);
    }
  }

  // Only wrap when the failure was actually retryable; a permanent error is far
  // more useful to the caller (and to the middleware deciding on fallback) in
  // its original shape.
  if (isRetryable(lastError)) {
    throw new RetriesExhaustedError(totalAttempts, lastError);
  }
  throw lastError;
}

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  /** Consecutive failures required to open the breaker. */
  failureThreshold: number;
  /** How long the breaker stays open before a probe is allowed. */
  resetTimeoutMs: number;
  /** Start in the open state (for standby replicas that should stay out of the way). */
  startsOpen?: boolean;
  /** Label used in logs and the `privy_circuit_state` metric. */
  name: string;
  /** Injected for tests. */
  now?: () => number;
  /** Called whenever the state changes. */
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

/**
 * A minimal three-state circuit breaker.
 *
 * CLOSED passes traffic through and counts consecutive failures. Reaching the
 * threshold moves to OPEN, which rejects immediately for `resetTimeoutMs`. After
 * that window the breaker moves to HALF_OPEN and admits a single probe: success
 * restores CLOSED, failure re-opens it for another full window.
 *
 * Concurrent requests are collapsed on purpose — while OPEN they all fail fast,
 * and in HALF_OPEN only the first is admitted, so a thundering herd of probes
 * does not hit a recovering upstream all at once.
 */
export class CircuitBreaker {
  private state: CircuitState;
  private consecutiveFailures = 0;
  private openedAt: number;
  private probeInFlight = false;

  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly now: () => number;
  private readonly onStateChange?: (from: CircuitState, to: CircuitState) => void;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = Math.max(1, options.failureThreshold);
    this.resetTimeoutMs = Math.max(0, options.resetTimeoutMs);
    this.now = options.now ?? Date.now;
    this.onStateChange = options.onStateChange;
    this.state = options.startsOpen ? 'open' : 'closed';
    this.openedAt = options.startsOpen ? this.now() : 0;
  }

  /** Current state, resolving any pending OPEN → HALF_OPEN transition. */
  getState(): CircuitState {
    if (this.state === 'open' && this.now() - this.openedAt >= this.resetTimeoutMs) {
      this.transition('half_open');
    }
    return this.state;
  }

  /** ms until a probe is admitted; 0 when the breaker is not blocking. */
  getRetryAfterMs(): number {
    if (this.state !== 'open') return 0;
    return Math.max(0, this.resetTimeoutMs - (this.now() - this.openedAt));
  }

  /**
   * Execute `fn` under the breaker.
   *
   * @throws {CircuitOpenError} Immediately, when the breaker is open (or a probe
   *   is already in flight), so callers can react without waiting on the network.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.getState();

    if (state === 'open') {
      throw new CircuitOpenError(this.getRetryAfterMs());
    }

    if (state === 'half_open') {
      if (this.probeInFlight) {
        // Another request already owns the probe; treat the rest as blocked.
        throw new CircuitOpenError(this.resetTimeoutMs);
      }
      this.probeInFlight = true;
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    } finally {
      if (state === 'half_open') {
        this.probeInFlight = false;
      }
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.state !== 'closed') {
      this.transition('closed');
    }
  }

  private recordFailure(): void {
    // A failed probe re-opens for a full window rather than resuming the old
    // failure count, so a flapping upstream gets a genuine cool-down.
    this.consecutiveFailures =
      this.state === 'half_open' ? this.failureThreshold : this.consecutiveFailures + 1;

    if (this.state === 'open') {
      this.openedAt = this.now();
      return;
    }

    if (this.consecutiveFailures >= this.failureThreshold) {
      this.openedAt = this.now();
      this.transition('open');
    }
  }

  private transition(to: CircuitState): void {
    if (this.state === to) return;
    const from = this.state;
    this.state = to;
    if (to === 'open') {
      this.consecutiveFailures = this.failureThreshold;
    }
    logger.warn({ breaker: this.name, from, to }, 'Privy circuit breaker state changed');
    this.onStateChange?.(from, to);
  }
}

/** Read-only snapshot of a breaker, for a health endpoint. */
export interface CircuitSnapshot {
  name: string;
  state: CircuitState;
  consecutiveFailures: number;
  retryAfterMs: number;
}

/**
 * Compose the breaker (outermost) with the retry loop (innermost).
 *
 * A single end-to-end call is one "failure" from the breaker's point of view,
 * not one per internal retry — otherwise a short outage that each request
 * internally rode out would still accumulate toward the threshold and open the
 * breaker on a service that is actually fine.
 *
 * @throws {CircuitOpenError} When the breaker is open.
 * @throws {RetriesExhaustedError} When retries are exhausted by transient errors.
 */
export async function resilientCall<T>(
  breaker: CircuitBreaker,
  fn: () => Promise<T>,
  retry: Omit<RetryOptions, 'operation'> & { operation: string },
): Promise<T> {
  try {
    return await breaker.execute(() => withRetry(fn, retry));
  } catch (error) {
    if (error instanceof CircuitOpenError) {
      logger.warn({ operation: retry.operation }, 'Privy call short-circuited by open breaker');
    }
    throw error;
  }
}

/** Create a breaker wired to the `privy_circuit_state` gauge. */
export function createPrivyCircuitBreaker(options: {
  failureThreshold: number;
  resetTimeoutMs: number;
  startsOpen: boolean;
}): CircuitBreaker {
  return new CircuitBreaker({
    name: 'privy',
    failureThreshold: options.failureThreshold,
    resetTimeoutMs: options.resetTimeoutMs,
    startsOpen: options.startsOpen,
    onStateChange: (_from, to) => {
      privyCircuitState.set({ state: to }, 1);
      for (const other of ['closed', 'open', 'half_open'] as const) {
        if (other !== to) privyCircuitState.set({ state: other }, 0);
      }
    },
  });
}
