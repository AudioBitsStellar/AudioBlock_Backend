import { generateAuthToken, TestJwtPayload } from './auth';

export interface MockResponse {
  status: jest.Mock;
  json: jest.Mock;
  setHeader: jest.Mock;
  on: jest.Mock;
  statusCode: number;
}

/**
 * Chainable mock Express Response, replacing the mockRes() duplicated
 * across WalletController.test.ts, UploadController.test.ts,
 * middleware.test.ts, and api.contract.test.ts.
 */
export function createMockResponse(): MockResponse {
  const res = {} as MockResponse;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn();
  res.on = jest.fn();
  res.statusCode = 200;
  return res;
}

export interface MockRequestOptions {
  userId?: string;
  user?: Partial<TestJwtPayload>;
  body?: Record<string, unknown>;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/** Plain mock Express Request, no auth header. */
export function createMockRequest(overrides: MockRequestOptions = {}): any {
  const { user, userId, ...rest } = overrides;
  const req: any = { headers: {}, ...rest };
  if (user || userId) {
    req.user = { id: userId ?? 'test-user-1', ...user };
  }
  return req;
}

/**
 * Builds on createMockRequest: auto-populates headers.authorization from
 * generateAuthToken(userId, user) and sets req.user, following the
 * authenticated-request pattern from UploadController.test.ts.
 */
export function createAuthenticatedRequest(overrides: MockRequestOptions = {}): any {
  const userId = overrides.userId ?? 'test-user-1';
  const user = { id: userId, ...overrides.user };
  const token = generateAuthToken(userId, overrides.user);

  const req = createMockRequest({ ...overrides, userId, user });
  req.headers = { ...req.headers, authorization: `Bearer ${token}`, ...overrides.headers };
  return req;
}
