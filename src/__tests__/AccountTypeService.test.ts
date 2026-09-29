import { AccountTypeService } from '../services/AccountTypeService';
import { UserRole } from '../entities/User';
import AppDataSource from '../config/db';
import { AppError } from '../errors/AppError';

jest.mock('../config/db');

describe('AccountTypeService', () => {
  let service: AccountTypeService;
  let mockUserRepo: any;
  let mockSongRepo: any;

  beforeEach(() => {
    service = new AccountTypeService();

    mockUserRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      count: jest.fn(),
    };

    mockSongRepo = {
      count: jest.fn(),
    };

    (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: string) => {
      if (entity === 'User' || entity.name === 'User') {
        return mockUserRepo;
      }
      if (entity === 'Song') {
        return mockSongRepo;
      }
      return mockUserRepo;
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('setAccountType', () => {
    it('should set account type to artist for a listener', async () =>
(result.role).toBe(UserRole.ARTIST);
      expect(result.name).toBe('Test Artist');
      expect(result.bio).toBe('Test bio');
      expect(mockUserRepo.save).toHaveBeenCalled();
    });

    it('should set account type to listener', async () => {
      const mockUser = {
        id: 'user-123',
        role: UserRole.LISTENER,
        email: 'user@example.com',
      };

      mockUserRepo.findOne.mockResolvedValue(mockUser);
      mockUserRepo.save.mockResolvedValue({
        ...mockUser,
        role: UserRole.LISTENER,
      });

      const result = await service.setAccountType(mockUser.id, UserRole.LISTENER);

      expect(result.role).toBe(UserRole.LISTENER);
      expect(mockUserRepo.save).toHaveBeenCalled();
    });

    it('should throw error when downgrading artist with content', async () => {
      const mockUser = {
        id: 'user-123',
        role: UserRole.ARTIST,
        email: 'artist@example.com',
      };

      mockUserRepo.findOne.mockResolvedValue(mockUser);
      mockSongRepo.count.mockResol
 {
        id: 'user-123',
        role: UserRole.LISTENER,
        email: 'user@example.com',
      };

      mockUserRepo.findOne.mockResolvedValue(mockUser);
      mockUserRepo.save.mockResolvedValue({
        ...mockUser,
        role: UserRole.ARTIST,
        name: 'New Artist',
        bio: 'Artist bio',
      });

      const result = await service.upgradeToArtist(mockUser.id, {
        artistName: 'New Artist',
        bio: 'Artist bio',
      });

      expect(result.role).toBe(UserRole.ARTIST);
      expect(result.name).toBe('New Artist');
      expect(mockUserRepo.save).toHaveBeenCalled();
    });

    it('should throw error when user is already an artist', async () => {
      const mockUser = {
        id: 'user-123',
        role: UserRole.ARTIST,
        email: 'artist@example.com',
      };

      mockUserRepo.findOne.mockResolvedValue(mockUser);

      await expect(service.upgradeToArtist(mockUser.id)).rejects.toThrow();
    });

    it('should throw error for user not found', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);

      await expect(service.upgradeToArtist('non-existent')).rejects.toThrow(AppError);
    });
  });

  describe('getAccountType', () => {
    it('should return account type information for listener', async () => {
      const mockUser = {
        id: 'user-123',
        role: UserRole.LISTENER,
        email: 'listener@example.com',
        username: 'testuser',
        name: 'Test User',
      };

      mockUserRepo.findOne.mockResolvedValue(mockUser);

      const result = await service.getAccountType(mockUser.id);

      expect(result.role).toBe(UserRole.LISTENER);
      expect(result.isListener).toBe(true);
      expect(result.isArtist).toBe(false);
      expect(result.canUploadContent).toBe(false);
    });

    it('should return account type information for artist', async () => {
      const mockUser = {
        id: 'user-123',
        role: UserRole.ARTIST,
        email: 'artist@example.com',
        username: 'testartist',
        name: 'Test Artist',
      };

      mockUserRepo.findOne.mockResolvedValue(mockUser);

      const result = await service.getAccountType(mockUser.id);

      expect(result.role).toBe(UserRole.ARTIST);
      expect(result.isArtist).toBe(true);
      expect(result.isListener).toBe(false);
      expect(result.canUploadContent).toBe(true);
    });

    it('should throw error for user not found', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);

      await expect(service.getAccountType('non-existent')).rejects.toThrow(AppError);
    });
  });

  describe('canPerformArtistActions', () => {
    it('should return true for artist', async () => {
      const mockUser = {
        id: 'user-123',
        role: UserRole.ARTIST,
      };

      mockUserRepo.findOne.mockResolvedValue(mockUser);

      const result = await service.canPerformArtistActions(mockUser.id);

      expect(result).toBe(true);
    });

    it('should return false for listener', async () => {
      const mockUser = {
        id: 'user-123',
        role: UserRole.LISTENER,
      };

      mockUserRepo.findOne.mockResolvedValue(mockUser);

      const result = await service.canPerformArtistActions(mockUser.id);

      expect(result).toBe(false);
    });

    it('should return true for admin', async () => {
      const mockUser = {
        id: 'user-123',
        role: UserRole.ADMIN,
      };

      mockUserRepo.findOne.mockResolvedValue(mockUser);

      const result = await service.canPerformArtistActions(mockUser.id);

      expect(result).toBe(true);
    });

    it('should return false for non-existent user', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);

      const result = await service.canPerformArtistActions('non-existent');

      expect(result).toBe(false);
    });
  });
});

