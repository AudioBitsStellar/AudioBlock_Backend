import 'reflect-metadata';

jest.mock('../../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));
jest.mock('../../config/redis', () => ({
  __esModule: true,
  default: { set: jest.fn(), get: jest.fn(), del: jest.fn() },
}));

import AppDataSource from '../../config/db';
import { UserService } from '../UserService';
import { UserRole } from '../../entities/User';

const mockUserRepo = {
  findOneBy: jest.fn(),
  save: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  // UserService requests both the User and TransactionLog repositories.
  (AppDataSource.getRepository as jest.Mock).mockReturnValue(mockUserRepo);
});

describe('UserService.assignRole (#100)', () => {
  it('throws 404 when the user does not exist', async () => {
    mockUserRepo.findOneBy.mockResolvedValue(null);
    const svc = new UserService();

    await expect(svc.assignRole('missing-id', UserRole.MODERATOR)).rejects.toThrow(
      'User not found',
    );
    expect(mockUserRepo.save).not.toHaveBeenCalled();
  });

  it('persists the new role and returns the updated user', async () => {
    const user = { id: 'u1', role: UserRole.LISTENER };
    mockUserRepo.findOneBy.mockResolvedValue(user);
    mockUserRepo.save.mockImplementation(async (u) => u);
    const svc = new UserService();

    const result = await svc.assignRole('u1', UserRole.MODERATOR);

    expect(user.role).toBe(UserRole.MODERATOR);
    expect(mockUserRepo.save).toHaveBeenCalledWith(user);
    expect(result.role).toBe(UserRole.MODERATOR);
  });

  it('throws when id is missing', async () => {
    const svc = new UserService();
    await expect(svc.assignRole('', UserRole.ADMIN)).rejects.toThrow();
  });
});
