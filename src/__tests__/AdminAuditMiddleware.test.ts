import { EventEmitter } from 'events';
import { Request, Response } from 'express';

jest.mock('../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../services/AdminAuditService', () => ({
  AdminAuditService: { record: jest.fn(async () => undefined) },
}));

import { AdminAuditService } from '../services/AdminAuditService';
import { adminAuditMiddleware } from '../middlewares/adminAuditMiddleware';

const record = AdminAuditService.record as jest.Mock;

function fakeRequest(overrides: Record<string, unknown> = {}): Request {
  return {
    method: 'POST',
    originalUrl: '/api/admin/users/abc/suspend?dryRun=1',
    path: '/users/abc/suspend',
    ip: '203.0.113.7',
    body: {},
    ...overrides,
  } as unknown as Request;
}

function fakeResponse(statusCode: number): Response & EventEmitter {
  return Object.assign(new EventEmitter(), { statusCode }) as unknown as Response & EventEmitter;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('adminAuditMiddleware (#980)', () => {
  it('does not record read-only requests', () => {
    const next = jest.fn();
    const res = fakeResponse(200);

    adminAuditMiddleware(fakeRequest({ method: 'GET' }), res, next);
    res.emit('finish');

    expect(next).toHaveBeenCalledTimes(1);
    expect(record).not.toHaveBeenCalled();
  });

  it('records a mutating request once the response has finished', () => {
    const res = fakeResponse(200);
    const req = fakeRequest({
      user: { id: 'admin-1', role: 'admin' },
      body: { type: 'suspended', reason: 'repeated spam' },
    });

    adminAuditMiddleware(req, res, jest.fn());
    expect(record).not.toHaveBeenCalled();

    res.emit('finish');

    expect(record).toHaveBeenCalledWith({
      actorId: 'admin-1',
      method: 'POST',
      path: '/api/admin/users/abc/suspend',
      statusCode: 200,
      ipAddress: '203.0.113.7',
      reason: 'repeated spam',
    });
  });

  it('records denied attempts with a null actor and the status returned', () => {
    const res = fakeResponse(403);
    const req = fakeRequest({ method: 'DELETE', originalUrl: '/api/admin/comments/c1' });

    adminAuditMiddleware(req, res, jest.fn());
    res.emit('finish');

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: null, method: 'DELETE', statusCode: 403, reason: null }),
    );
  });

  it('never fails the response when the audit write fails', async () => {
    record.mockRejectedValueOnce(new Error('database unavailable'));
    const res = fakeResponse(200);

    adminAuditMiddleware(fakeRequest(), res, jest.fn());

    expect(() => res.emit('finish')).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(record).toHaveBeenCalledTimes(1);
  });
});
