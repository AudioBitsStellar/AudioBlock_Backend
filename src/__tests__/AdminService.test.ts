import { Repository } from 'typeorm';
import { AdminService } from '../services/AdminService';
import { User, UserRole } from '../entities/User';
import AppDataSource from '../config/db';
import { AppError } from '../errors/AppError';

jest.mock('../config/db', () => ({
  __esModule: true,
  default: {
    getRepository: jest.fn(),
  },
}));

describe('AdminService', () => {
  let adminService: AdminService;
  let mockUserRepo: jest.Mocked<Repository<User>>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockUserRepo = {
      findOneBy: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<User>>;

    (AppDataSource.getRepository as jest.Mock).mockReturnValue(mockUserRepo);

    adminService = new AdminService();
  });

  describe('assignRole', () => {
    const userId = 'user-123';

    it('should successfully assign a role to a user', async () => {
      const mockUser: Partial<User> = {
        id: userId,
        email: 'test@example.com',
        username: 'testuser',
        role: UserRole.LISTENER,
      };

      const updatedUser: Partial<User> = {
        ...mockUser,
        role: UserRole.ARTIST,
      };

      mockUserRepo.findOneBy.mockResolvedValue(mockUser as User);
      mockUserRepo.save.mockResolvedValue(updatedUser as User);

      const result = await adminService.assignRole(userId, UserRole.ARTIST);

      expect(mockUserRepo.findOneBy).toHaveBeenCalledWith({ id: userId });
      expect(mockUserRepo.save).toHaveBeenCalled();
      expect(result.role).toBe(UserRole.ARTIST);
    });

    it('should assign MODERATOR role', async () => {
      const mockUser: Partial<User> = {
        id: userId,
        email: 'test@example.com',
        role: UserRole.LISTENER,
      };

      mockUserRepo.findOneBy.mockResolvedValue(mockUser as User);
      mockUserRepo.save.mockImplementation(async (user) => user as User);

      const result = await adminService.assignRole(userId, UserRole.MODERATOR);

      expect(result.role).toBe(UserRole.MODERATOR);
    });

    it('should assign SUPER_ADMIN role', async () => {
      const mockUser: Partial<User> = {
        id: userId,
        email: 'test@example.com',
        role: UserRole.ADMIN,
      };

      mockUserRepo.findOneBy.mockResolvedValue(mockUser as User);
      mockUserRepo.save.mockImplementation(async (user) => user as User);

      const result = await adminService.assignRole(userId, UserRole.SUPER_ADMIN);

      expect(result.role).toBe(UserRole.SUPER_ADMIN);
    });

    it('should throw AppError when user not found', async () => {
      mockUserRepo.findOneBy.mockResolvedValue(null);

      await expect(adminService.assignRole(userId, UserRole.ARTIST)).rejects.toThrow(AppError);

      await expect(adminService.assignRole(userId, UserRole.ARTIST)).rejects.toThrow(/not found/i);
    });

    it('should throw AppError when userId is missing', async () => {
      await expect(adminService.assignRole('', UserRole.ARTIST)).rejects.toThrow(AppError);
    });

    it('should throw AppError when role is missing', async () => {
      await expect(adminService.assignRole(userId, '' as UserRole)).rejects.toThrow(AppError);
    });

    it('should throw AppError for invalid role', async () => {
      const mockUser: Partial<User> = {
        id: userId,
        email: 'test@example.com',
        role: UserRole.LISTENER,
      };

      mockUserRepo.findOneBy.mockResolvedValue(mockUser as User);

      await expect(adminService.assignRole(userId, 'invalid_role' as UserRole)).rejects.toThrow(
        AppError,
      );

      await expect(adminService.assignRole(userId, 'invalid_role' as UserRole)).rejects.toThrow(
        /Invalid role/i,
      );
    });

    it('should allow reassigning the same role', async () => {
      const mockUser: Partial<User> = {
        id: userId,
        email: 'test@example.com',
        role: UserRole.ARTIST,
      };

      mockUserRepo.findOneBy.mockResolvedValue(mockUser as User);
      mockUserRepo.save.mockImplementation(async (user) => user as User);

      const result = await adminService.assignRole(userId, UserRole.ARTIST);

      expect(result.role).toBe(UserRole.ARTIST);
    });
  });
});
