import 'reflect-metadata';

jest.mock('../../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));

import AppDataSource from '../../config/db';
import { ActivityService } from '../ActivityService';
import { ActivityFeed } from '../../entities/ActivityFeed';
import { UserFollow } from '../../entities/UserFollow';

const mockActivityRepo = {
  findAndCount: jest.fn(),
};

const mockUserFollowRepo = {
  find: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  (AppDataSource.getRepository as jest.Mock).mockImplementation((entity) => {
    if (entity === ActivityFeed) return mockActivityRepo;
    if (entity === UserFollow) return mockUserFollowRepo;
    return {};
  });
});

describe('ActivityService.getActivityFeed with followingOnly', () => {
  it('throws 401 when followingOnly is requested without a userId', async () => {
    const svc = new ActivityService();
    await expect(svc.getActivityFeed(undefined, true)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('returns empty items when user follows no one', async () => {
    mockUserFollowRepo.find.mockResolvedValue([]);
    const svc = new ActivityService();
    const result = await svc.getActivityFeed('user-1', true);

    expect(result).toEqual({ items: [], total: 0 });
    expect(mockActivityRepo.findAndCount).not.toHaveBeenCalled();
  });

  it('returns activity items from followed accounts only', async () => {
    mockUserFollowRepo.find.mockResolvedValue([
      { followerId: 'user-1', followingId: 'artist-1' },
      { followerId: 'user-1', followingId: 'artist-2' },
    ]);

    const mockActivities = [
      { id: 'act-1', userId: 'artist-1', actionType: 'RELEASE_SONG' },
    ];
    mockActivityRepo.findAndCount.mockResolvedValue([mockActivities, 1]);

    const svc = new ActivityService();
    const result = await svc.getActivityFeed('user-1', true);

    expect(mockUserFollowRepo.find).toHaveBeenCalledWith({
      where: { followerId: 'user-1' },
      select: ['followingId'],
    });
    expect(mockActivityRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        order: { createdAt: 'DESC' },
      }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});
