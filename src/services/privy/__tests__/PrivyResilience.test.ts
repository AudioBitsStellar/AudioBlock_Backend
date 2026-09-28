import {
  CircuitBreaker,
  CircuitOpenError,
  isRetryableError,
  resilientCall,
  RetriesExhaustedError,
  withRetry,
} from '../PrivyResilience';

describe('isRetryableError', () => {
  it.each([
    ['ECONNRESET', 'ECONNRESET'],
    ['ECONNREFUSED', 'ECONNREFUSED'],
    ['ETIMEDOUT', 'ETIMEDOUT'],
    ['ERR_NETWORK', 'ERR_NETWORK'],
  ])('treats the transport error %s as retryable', (_label, code) => {
    expect(isRetryableError({ code })).toBe(true);
  });

  it.each([408, 429, 500, 502, 503, 504])('treats HTTP %s as retryable', (status) => {
    expect(isRetryableError({ response: { status } })).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])('treats HTTP %s as permanent', (status) => {
    expect(isRetryableError({ response: { status } })).toBe(false);
  });

  it('treats an unrecognised error as permanent rather than retrying blindly', () => {
    // Retrying a programming error five times just delays the real failure and
    // hides it behind a wall of noise.
    expect(isRetryableError(new TypeError('x is not a function'))).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
    expect(isRetryableError('boom')).toBe(false);
  });

  it('never retries because the breaker is open', () => {
    expect(isRetryableError(new CircuitOpenError(1000))).toBe(false);
  });
});

describe('withRetry', () => {
  const base = { attempts: 3, baseDelayMs: 10, maxDelayMs: 100, operation: 'test' };

  it('returns the first successful result without sleeping', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    const fn = jest.fn().mockResolvedValue('ok');

    await expect(withRetry(fn, { ...base, sleep })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries a transient failure and succeeds', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    const fn = jest.fn().mockRejectedValueOnce({ code: 'ECONNRESET' }).mockResolvedValue('ok');

    await expect(withRetry(fn, { ...base, sleep })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('gives up after the attempt budget and reports exhaustion', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    const fn = jest.fn().mockRejectedValue({ code: 'ECONNRESET' });

    await expect(withRetry(fn, { ...base, sleep })).rejects.toBeInstanceOf(RetriesExhaustedError);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not retry a permanent error', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    const fn = jest.fn().mockRejectedValue({ response: { status: 400 } });

    await expect(withRetry(fn, { ...base, sleep })).rejects.toEqual({ response: { status: 400 } });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('applies exponential backoff capped by maxDelayMs', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    // random() === 1 puts each delay at the top of its window, making the
    // doubling directly observable.
    const fn = jest.fn().mockRejectedValue({ code: 'ECONNRESET' });

    await expect(
      withRetry(fn, {
        ...base,
        attempts: 4,
        baseDelayMs: 10,
        maxDelayMs: 25,
        sleep,
        random: () => 0.999,
      }),
    ).rejects.toBeInstanceOf(RetriesExhaustedError);

    // 10, 20, 25 (capped)
    expect(sleep.mock.calls.map((call) => call[0])).toEqual([10, 20, 25]);
  });

  it('jitters the delay below the computed ceiling', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    const fn = jest.fn().mockRejectedValue({ code: 'ECONNRESET' });

    await expect(
      withRetry(fn, {
        ...base,
        attempts: 2,
        baseDelayMs: 100,
        maxDelayMs: 100,
        sleep,
        random: () => 0,
      }),
    ).rejects.toBeInstanceOf(RetriesExhaustedError);

    expect(sleep).toHaveBeenCalledWith(0);
  });

  it('honours a server Retry-After hint over its own backoff', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    const fn = jest
      .fn()
      .mockRejectedValueOnce({ response: { status: 429, headers: { 'retry-after': '2' } } })
      .mockResolvedValue('ok');

    await expect(withRetry(fn, { ...base, sleep })).resolves.toBe('ok');
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('treats attempts=1 as no retrying at all', async () => {
    const fn = jest.fn().mockRejectedValue({ code: 'ECONNRESET' });
    await expect(withRetry(fn, { ...base, attempts: 1 })).rejects.toBeInstanceOf(
      RetriesExhaustedError,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('CircuitBreaker', () => {
  const build = (failureThreshold = 2, resetTimeoutMs = 1000) => {
    let now = 0;
    const breaker = new CircuitBreaker({
      name: 'privy',
      failureThreshold,
      resetTimeoutMs,
      now: () => now,
    });
    return {
      breaker,
      advance: (ms: number) => {
        now += ms;
      },
    };
  };

  it('stays closed and passes traffic through while healthy', async () => {
    const { breaker } = build();
    await expect(breaker.execute(async () => 'ok')).resolves.toBe('ok');
    expect(breaker.getState()).toBe('closed');
  });

  it('opens only after the failure threshold is reached', async () => {
    const { breaker } = build(3);

    await expect(
      breaker.execute(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(
      breaker.execute(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(breaker.getState()).toBe('closed');

    await expect(
      breaker.execute(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(breaker.getState()).toBe('open');
  });

  it('fails fast once open, without invoking the call', async () => {
    const { breaker } = build(1);
    await expect(
      breaker.execute(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const fn = jest.fn().mockResolvedValue('ok');
    await expect(breaker.execute(fn)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('reports how long until a probe is admitted', async () => {
    const { breaker, advance } = build(1, 1000);
    await expect(
      breaker.execute(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(breaker.getRetryAfterMs()).toBe(1000);
    advance(400);
    expect(breaker.getRetryAfterMs()).toBe(600);
  });

  it('moves to half_open after the reset window and closes again on a successful probe', async () => {
    const { breaker, advance } = build(1, 1000);
    await expect(
      breaker.execute(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    advance(1000);
    expect(breaker.getState()).toBe('half_open');
    await expect(breaker.execute(async () => 'recovered')).resolves.toBe('recovered');
    expect(breaker.getState()).toBe('closed');
  });

  it('re-opens for a full window when the probe fails', async () => {
    const { breaker, advance } = build(1, 1000);
    await expect(
      breaker.execute(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    advance(1000);
    expect(breaker.getState()).toBe('half_open');
    await expect(
      breaker.execute(async () => {
        throw new Error('still broken');
      }),
    ).rejects.toThrow();

    expect(breaker.getState()).toBe('open');
    expect(breaker.getRetryAfterMs()).toBe(1000);
  });

  it('resets the failure count after a success, so failures must be consecutive', async () => {
    const { breaker } = build(2);

    await expect(
      breaker.execute(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(breaker.execute(async () => 'ok')).resolves.toBe('ok');
    await expect(
      breaker.execute(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(breaker.getState()).toBe('closed');
  });

  it('admits only one probe at a time in half_open', async () => {
    // Otherwise a recovering upstream gets hit by a thundering herd of probes,
    // which is the same failure mode the breaker exists to prevent.
    const { breaker, advance } = build(1, 1000);
    await expect(
      breaker.execute(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    advance(1000);

    let releaseProbe: (value: string) => void = () => {};
    const probe = breaker.execute(
      () =>
        new Promise<string>((resolve) => {
          releaseProbe = resolve;
        }),
    );

    await expect(breaker.execute(async () => 'second')).rejects.toBeInstanceOf(CircuitOpenError);

    releaseProbe('first');
    await expect(probe).resolves.toBe('first');
  });

  it('can start open for a cold standby replica', async () => {
    const breaker = new CircuitBreaker({
      name: 'privy',
      failureThreshold: 5,
      resetTimeoutMs: 1000,
      startsOpen: true,
    });

    expect(breaker.getState()).toBe('open');
    await expect(breaker.execute(async () => 'ok')).rejects.toBeInstanceOf(CircuitOpenError);
  });
});

describe('resilientCall', () => {
  it('counts one end-to-end failure per call, not one per internal retry', async () => {
    // A call that internally rode out a transient blip should not push the
    // breaker toward opening — the upstream is fine, we just had a bad moment.
    const breaker = new CircuitBreaker({
      name: 'privy',
      failureThreshold: 2,
      resetTimeoutMs: 1000,
    });

    let attempt = 0;
    const result = await resilientCall(
      breaker,
      async () => {
        attempt += 1;
        if (attempt === 1) throw { code: 'ECONNRESET' };
        return 'ok';
      },
      {
        operation: 'test',
        attempts: 3,
        baseDelayMs: 1,
        maxDelayMs: 1,
        sleep: async () => {},
        random: () => 0,
      },
    );

    expect(result).toBe('ok');
    expect(attempt).toBe(2);
    expect(breaker.getState()).toBe('closed');
  });

  it('trips the breaker once a full call exhausts its retries', async () => {
    const breaker = new CircuitBreaker({
      name: 'privy',
      failureThreshold: 2,
      resetTimeoutMs: 1000,
    });

    const opts = {
      operation: 'test',
      attempts: 1,
      baseDelayMs: 1,
      maxDelayMs: 1,
      sleep: async () => {},
      random: () => 0,
    };
    const failing = () =>
      resilientCall(
        breaker,
        async () => {
          throw { code: 'ECONNRESET' };
        },
        opts,
      );

    await expect(failing()).rejects.toBeInstanceOf(RetriesExhaustedError);
    await expect(failing()).rejects.toBeInstanceOf(RetriesExhaustedError);
    expect(breaker.getState()).toBe('open');

    // Third call short-circuits without touching the network.
    await expect(failing()).rejects.toBeInstanceOf(CircuitOpenError);
  });
});
