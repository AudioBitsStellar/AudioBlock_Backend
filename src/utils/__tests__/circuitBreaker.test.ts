/**
 * Unit tests for CircuitBreaker (#781).
 *
 * Uses Jest fake timers so the reset timeout and health-check interval
 * run synchronously without open handles.
 */

jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { CircuitBreaker, CircuitBreakerOpenError } from '../circuitBreaker';

function makeHealthFn(result: boolean | Error = true) {
  return jest.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

// ── 1. CLOSED state passes calls through ─────────────────────────────────────

describe('CLOSED state', () => {
  it('executes the wrapped function and returns its result', async () => {
    const cb = new CircuitBreaker(makeHealthFn(), {
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      healthCheckIntervalMs: 5000,
    });
    const fn = jest.fn(async () => 'ok');
    await expect(cb.execute(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    cb.destroy();
  });

  it('re-throws errors from the wrapped function without opening prematurely', async () => {
    const cb = new CircuitBreaker(makeHealthFn(), {
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      healthCheckIntervalMs: 5000,
    });
    const fn = jest.fn(async () => {
      throw new Error('boom');
    });
    await expect(cb.execute(fn)).rejects.toThrow('boom');
    expect(cb.currentState).toBe('CLOSED'); // only 1 failure, threshold is 3
    cb.destroy();
  });
});

// ── 2. CLOSED → OPEN after N consecutive failures ────────────────────────────

describe('opening after threshold failures', () => {
  it('opens after failureThreshold consecutive failures', async () => {
    const cb = new CircuitBreaker(makeHealthFn(), {
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      healthCheckIntervalMs: 5000,
    });
    const failing = async () => {
      throw new Error('fail');
    };
    await expect(cb.execute(failing)).rejects.toThrow();
    await expect(cb.execute(failing)).rejects.toThrow();
    await expect(cb.execute(failing)).rejects.toThrow();
    expect(cb.currentState).toBe('OPEN');
    cb.destroy();
  });

  it('fast-fails without invoking the wrapped function when OPEN', async () => {
    const cb = new CircuitBreaker(makeHealthFn(), {
      failureThreshold: 1,
      resetTimeoutMs: 1000,
      healthCheckIntervalMs: 5000,
    });
    await expect(
      cb.execute(async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow();
    expect(cb.currentState).toBe('OPEN');

    const fn = jest.fn(async () => 'should not run');
    await expect(cb.execute(fn)).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    expect(fn).not.toHaveBeenCalled();
    cb.destroy();
  });

  it('sets openedAt when opening', async () => {
    const cb = new CircuitBreaker(makeHealthFn(), {
      failureThreshold: 1,
      resetTimeoutMs: 1000,
      healthCheckIntervalMs: 5000,
    });
    await expect(
      cb.execute(async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow();
    expect(cb.getStatus().openedAt).toBeInstanceOf(Date);
    cb.destroy();
  });
});

// ── 3. OPEN → HALF_OPEN → CLOSED / OPEN ──────────────────────────────────────

describe('HALF_OPEN transitions', () => {
  it('moves to HALF_OPEN after resetTimeoutMs', async () => {
    const cb = new CircuitBreaker(makeHealthFn(), {
      failureThreshold: 1,
      resetTimeoutMs: 500,
      healthCheckIntervalMs: 5000,
    });
    await expect(
      cb.execute(async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow();
    expect(cb.currentState).toBe('OPEN');

    jest.advanceTimersByTime(500);
    expect(cb.currentState).toBe('HALF_OPEN');
    cb.destroy();
  });

  it('closes on success in HALF_OPEN state', async () => {
    const cb = new CircuitBreaker(makeHealthFn(), {
      failureThreshold: 1,
      resetTimeoutMs: 500,
      healthCheckIntervalMs: 5000,
    });
    await expect(
      cb.execute(async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow();
    jest.advanceTimersByTime(500);
    expect(cb.currentState).toBe('HALF_OPEN');

    await cb.execute(async () => 'ok');
    expect(cb.currentState).toBe('CLOSED');
    cb.destroy();
  });

  it('re-opens on failure in HALF_OPEN state', async () => {
    const cb = new CircuitBreaker(makeHealthFn(), {
      failureThreshold: 1,
      resetTimeoutMs: 500,
      healthCheckIntervalMs: 5000,
    });
    await expect(
      cb.execute(async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow();
    jest.advanceTimersByTime(500);
    expect(cb.currentState).toBe('HALF_OPEN');

    await expect(
      cb.execute(async () => {
        throw new Error('y');
      }),
    ).rejects.toThrow();
    expect(cb.currentState).toBe('OPEN');
    cb.destroy();
  });
});

// ── 4. Health-check interval cleared by destroy() ────────────────────────────

describe('health checks and destroy()', () => {
  it('stopHealthChecks / destroy clears the interval — no open handles', async () => {
    const health = makeHealthFn(true);
    const cb = new CircuitBreaker(health, {
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      healthCheckIntervalMs: 200,
    });
    cb.startHealthChecks();

    jest.advanceTimersByTime(600); // 3 intervals
    expect(health).toHaveBeenCalledTimes(3);

    cb.destroy();

    jest.advanceTimersByTime(600);
    expect(health).toHaveBeenCalledTimes(3); // no more calls after destroy
  });

  it('startHealthChecks is idempotent', () => {
    const health = makeHealthFn(true);
    const cb = new CircuitBreaker(health, {
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      healthCheckIntervalMs: 200,
    });
    cb.startHealthChecks();
    cb.startHealthChecks(); // second call must be a no-op
    jest.advanceTimersByTime(200);
    expect(health).toHaveBeenCalledTimes(1);
    cb.destroy();
  });

  it('health check closes HALF_OPEN on healthy result', async () => {
    const health = makeHealthFn(true);
    const cb = new CircuitBreaker(health, {
      failureThreshold: 1,
      resetTimeoutMs: 500,
      healthCheckIntervalMs: 200,
    });
    await expect(
      cb.execute(async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow();
    jest.advanceTimersByTime(500); // → HALF_OPEN
    cb.startHealthChecks();
    await Promise.resolve(); // flush microtasks after interval fires
    jest.advanceTimersByTime(200);
    await Promise.resolve();
    expect(cb.currentState).toBe('CLOSED');
    cb.destroy();
  });
});

// ── 5. getStatus reflects state correctly ────────────────────────────────────

describe('getStatus()', () => {
  it('returns correct counters in CLOSED state', () => {
    const cb = new CircuitBreaker(makeHealthFn(), {
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      healthCheckIntervalMs: 5000,
    });
    const s = cb.getStatus();
    expect(s.state).toBe('CLOSED');
    expect(s.failures).toBe(0);
    expect(s.lastFailure).toBeNull();
    expect(s.openedAt).toBeNull();
    cb.destroy();
  });

  it('increments failure count without opening below threshold', async () => {
    const cb = new CircuitBreaker(makeHealthFn(), {
      failureThreshold: 5,
      resetTimeoutMs: 1000,
      healthCheckIntervalMs: 5000,
    });
    await expect(
      cb.execute(async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow();
    expect(cb.getStatus().failures).toBe(1);
    cb.destroy();
  });
});
