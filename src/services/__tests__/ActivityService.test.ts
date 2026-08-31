import 'reflect-metadata';

jest.mock('../../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));

import AppDataSource from '../../config/db';
import { ActivityService } from '../ActivityService';

const mockActivityRepo = {
  find: jest.fn(),
};

const mockUserFollowRepo = {
  find: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  (AppDataSource.getRepository as jest.Mock).mockImplementation((entity) => {
    if (entity.name === 'ActivityFeed') return mockActivityRepo;
    if (entity.name === 'UserFollow') return mockUserFollowRepo;
    return {};
  });
});

describe('ActivityService.getActivityFeed', () => {
  it('returns empty array when mode is following and user follows nobody', async () => {
    mockUserFollowRepo.find.mockResolvedValue([]);
    const svc = new ActivityService();

    const result = await svc.getActivityFeed({ userId: 'u1', mode: 'following' });

    expect(result).toEqual([]);
    expect(mockActivityRepo.find).not.toHaveBeenCalled();
  });

  it('returns activity from followed accounts when mode is following', async () => {
    mockUserFollowRepo.find.mockResolvedValue([{ followingId: 'u2' }, { followingId: 'u3' }]);
    const expectedActivities = [{ id: 'a1', userId: 'u2', actionType: 'song_release' }];
    mockActivityRepo.find.mockResolvedValue(expectedActivities);

    const svc = new ActivityService();
    const result = await svc.getActivityFeed({ userId: 'u1', mode: 'following' });

    expect(mockUserFollowRepo.find).toHaveBeenCalledWith({
      where: { followerId: 'u1' },
      select: ['followingId'],
    });
    expect(mockActivityRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        order: { createdAt: 'DESC' },
      }),
    );
    expect(result).toEqual(expectedActivities);
  });

  it('returns platform-wide activity when mode is all', async () => {
    const expectedActivities = [{ id: 'a1', userId: 'u99' }];
    mockActivityRepo.find.mockResolvedValue(expectedActivities);

    const svc = new ActivityService();
    const result = await svc.getActivityFeed({ userId: 'u1', mode: 'all' });

    expect(mockUserFollowRepo.find).not.toHaveBeenCalled();
    expect(result).toEqual(expectedActivities);
  });
});
