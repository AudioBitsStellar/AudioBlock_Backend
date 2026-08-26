import jwt from 'jsonwebtoken';
import { IsString, IsNotEmpty } from 'class-validator';
import { requireAuth } from '../authMiddleware';
import { requestLoggerMiddleware } from '../requestLogger';
import { validateDTO } from '../validate';
import {
  createMockRequest,
  createMockResponse,
  generateAuthToken,
  getTestJwtSecret,
} from '../../../tests/helpers';

function mockReq(overrides: any = {}): any {
  return createMockRequest(overrides);
}

function mockRes(): any {
  return createMockResponse();
}

describe('requireAuth', () => {
  it('rejects a request with no Authorization header', () => {
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign({ id: 'user-1' }, getTestJwtSecret(), { expiresIn: -10 });
    const req = mockReq({ headers: { authorization: `Bearer ${expired}` } });
    const res = mockRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() and attaches the decoded user for a valid token', () => {
    const token = generateAuthToken('user-1', { role: 'artist' });
    const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
    const res = mockRes();
    const next = jest.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ id: 'user-1', role: 'artist' });
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('requestLoggerMiddleware', () => {
  it('assigns a request id and forwards it in the response header', () => {
    const req = mockReq({ method: 'GET', originalUrl: '/health/live' });
    const res = mockRes();
    const next = jest.fn();

    requestLoggerMiddleware(req, res, next);

    expect(req.id).toBeTruthy();
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.id);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('reuses an incoming X-Request-Id header instead of generating a new one', () => {
    const req = mockReq({
      method: 'GET',
      originalUrl: '/health/live',
      headers: { 'x-request-id': 'incoming-id-123' },
    });
    const res = mockRes();
    const next = jest.fn();

    requestLoggerMiddleware(req, res, next);

    expect(req.id).toBe('incoming-id-123');
  });
});

class SampleDTO {
  @IsString()
  @IsNotEmpty()
  name!: string;
}

describe('validateDTO', () => {
  it('calls next() when the body satisfies the DTO', async () => {
    const middleware = validateDTO(SampleDTO);
    const req: any = { body: { name: 'valid' } };
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 400 with field errors when the body is invalid', async () => {
    const middleware = validateDTO(SampleDTO);
    const req: any = { body: { name: '' } };
    const res = mockRes();
    const next = jest.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.error.code).toBe('VALIDATION_FAILED');
    expect(payload.error.details[0]).toMatchObject({ field: 'name' });
  });
});
