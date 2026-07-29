import { requirePermission } from '../authMiddleware';
import { Permission } from '../../types/Permissions';
import { UserRole } from '../../entities/User';
import {
  createMockRequest,
  createAuthenticatedRequest,
  createMockResponse,
} from '../../../tests/helpers';

// handleError -> logRequestError imports the live Redis client, which opens a
// socket that keeps the process alive. Mock it so the suite exits cleanly.
jest.mock('../../config/redis', () => ({
  __esModule: true,
  default: { incr: jest.fn(), expire: jest.fn(), get: jest.fn(), set: jest.fn(), del: jest.fn() },
}));

const asRes = (res: ReturnType<typeof createMockResponse>): any => res;

describe('requirePermission (#100)', () => {
  it('responds 401 when the request is unauthenticated', () => {
    const req = createMockRequest();
    const res = createMockResponse();
    const next = jest.fn();

    requirePermission(Permission.CONTENT_MODERATE)(req, asRes(res), next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('responds 403 (not 401) when an authenticated role lacks the permission', () => {
    const req = createAuthenticatedRequest({ user: { role: UserRole.LISTENER } });
    const res = createMockResponse();
    const next = jest.fn();

    requirePermission(Permission.CONTENT_MODERATE)(req, asRes(res), next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when the role holds the required permission', () => {
    const req = createAuthenticatedRequest({ user: { role: UserRole.MODERATOR } });
    const res = createMockResponse();
    const next = jest.fn();

    requirePermission(Permission.CONTENT_MODERATE)(req, asRes(res), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows super_admin through any permission gate', () => {
    const req = createAuthenticatedRequest({ user: { role: UserRole.SUPER_ADMIN } });
    const res = createMockResponse();
    const next = jest.fn();

    requirePermission(Permission.ROLE_ASSIGN)(req, asRes(res), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('responds 403 when the token carries no role claim', () => {
    const req = createAuthenticatedRequest({ user: {} });
    const res = createMockResponse();
    const next = jest.fn();

    requirePermission(Permission.JOBS_VIEW)(req, asRes(res), next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
