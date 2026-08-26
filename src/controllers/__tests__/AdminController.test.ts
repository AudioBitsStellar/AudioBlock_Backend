import { AdminController } from '../AdminController';
import {
  createMockRequest,
  createMockResponse,
  assertSuccessResponse,
  assertErrorResponse,
} from '../../../tests/helpers';
import { UserRole } from '../../entities/User';

// handleError -> logRequestError imports the live Redis client, which opens a
// socket that keeps the process alive. Mock it so the suite exits cleanly.
jest.mock('../../config/redis', () => ({
  __esModule: true,
  default: { incr: jest.fn(), expire: jest.fn(), get: jest.fn(), set: jest.fn(), del: jest.fn() },
}));

// Factory mock so the controller never loads the real UserService (which
// pulls in the DB data source at import time). AdminController instantiates
// UserService at module load, so the factory runs during import — reference
// mockAssignRole lazily through a wrapper to sidestep the const TDZ.
const mockAssignRole = jest.fn();
jest.mock('../../services/UserService', () => ({
  UserService: jest.fn().mockImplementation(() => ({
    assignRole: (...args: unknown[]) => mockAssignRole(...args),
  })),
}));

describe('AdminController.assignRole (#100)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 200 with the updated id and role', async () => {
    mockAssignRole.mockResolvedValue({ id: 'u1', role: UserRole.MODERATOR });
    const req = createMockRequest({ params: { id: 'u1' }, body: { role: UserRole.MODERATOR } });
    const res = createMockResponse();

    await AdminController.assignRole(req, res as any);

    expect(mockAssignRole).toHaveBeenCalledWith('u1', UserRole.MODERATOR);
    assertSuccessResponse(res, { status: 200, data: { id: 'u1', role: UserRole.MODERATOR } });
  });

  it('surfaces a not-found service error as an error response', async () => {
    const { AppError } = jest.requireActual('../../errors/AppError');
    mockAssignRole.mockRejectedValue(AppError.notFound('User not found'));
    const req = createMockRequest({ params: { id: 'missing' }, body: { role: UserRole.ADMIN } });
    const res = createMockResponse();

    await AdminController.assignRole(req, res as any);

    assertErrorResponse(res, { status: 404, message: 'User not found' });
  });
});
