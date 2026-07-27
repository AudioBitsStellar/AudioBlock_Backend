const mockIncr = jest.fn();
const mockExpire = jest.fn();
jest.mock('../../config/redis', () => ({
  __esModule: true,
  default: {
    incr: (...args: unknown[]) => mockIncr(...args),
    expire: (...args: unknown[]) => mockExpire(...args),
  },
}));

const mockLoggerError = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerDebug = jest.fn();
jest.mock('../../config/logger', () => ({
  __esModule: true,
  default: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    debug: (...args: unknown[]) => mockLoggerDebug(...args),
  },
}));

import { logRequestError } from '../errorLogger';

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function mockRequest(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'req-1',
    method: 'GET',
    originalUrl: '/api/song/abc',
    path: '/api/song/abc',
    baseUrl: '',
    route: undefined,
    ip: '127.0.0.1',
    user: undefined,
    body: {},
    ...overrides,
  };
}

describe('logRequestError', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIncr.mockResolvedValue(1);
    mockExpire.mockResolvedValue(1);
  });

  it('logs 5xx errors at error level with full context and stack on first occurrence', async () => {
    const req = mockRequest({ user: { id: 'user-1' } });
    const err = new Error('boom');

    logRequestError(req, err, 500);
    await flushAsync();

    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    const [context, message] = mockLoggerError.mock.calls[0];
    expect(message).toBe('Request error');
    expect(context).toMatchObject({
      reqId: 'req-1',
      method: 'GET',
      path: '/api/song/abc',
      statusCode: 500,
      userId: 'user-1',
      ip: '127.0.0.1',
      count: 1,
      err,
    });
  });

  it('logs 4xx errors at warn level', async () => {
    const req = mockRequest();
    const err = new Error('bad input');

    logRequestError(req, err, 400);
    await flushAsync();

    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
    expect(mockLoggerError).not.toHaveBeenCalled();
    expect(mockLoggerWarn.mock.calls[0][0]).toMatchObject({ statusCode: 400, count: 1 });
  });

  it('logs the request body at debug level, redacted, on first occurrence', async () => {
    const req = mockRequest({ body: { email: 'a@b.com', password: 'hunter2' } });

    logRequestError(req, new Error('boom'), 500);
    await flushAsync();

    expect(mockLoggerDebug).toHaveBeenCalledTimes(1);
    const [context] = mockLoggerDebug.mock.calls[0];
    expect(context.body).toMatchObject({ email: 'a@b.com', password: '[REDACTED]' });
  });

  it('suppresses full detail and logs a lightweight line with a running count for repeats', async () => {
    mockIncr.mockResolvedValue(3);
    const req = mockRequest();

    logRequestError(req, new Error('boom'), 500);
    await flushAsync();

    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    expect(mockLoggerDebug).not.toHaveBeenCalled();
    const [context, message] = mockLoggerError.mock.calls[0];
    expect(message).toBe('Duplicate error suppressed');
    expect(context).toMatchObject({ count: 3 });
    expect(context.err).toBeUndefined();
  });

  it('sets a TTL on the dedup counter only when it is first created', async () => {
    mockIncr.mockResolvedValue(1);
    logRequestError(mockRequest(), new Error('boom'), 500);
    await flushAsync();
    expect(mockExpire).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    mockIncr.mockResolvedValue(2);
    logRequestError(mockRequest(), new Error('boom'), 500);
    await flushAsync();
    expect(mockExpire).not.toHaveBeenCalled();
  });

  it('fails open (treats as first occurrence) when Redis is unavailable', async () => {
    mockIncr.mockRejectedValue(new Error('ECONNREFUSED'));
    const req = mockRequest();

    logRequestError(req, new Error('boom'), 500);
    await flushAsync();

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ fingerprint: expect.any(String) }),
      'Error dedup counter unavailable, logging as first occurrence',
    );
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
      'Request error',
    );
  });
});
