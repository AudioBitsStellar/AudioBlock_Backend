import 'reflect-metadata';
import { ActivityService } from '../services/ActivityService';
import AppDataSource from '../config/db';
import { AppError } from '../errors/AppError';

jest.mock('../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));

describe('ActivityService filtering', () => {
  let activityService: ActivityService;
  let mockQueryBuilder: any;
  let mockActivityRepo: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    mockActivityRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };
    (AppDataSource.getRepository as jest.Mock).mockReturnValue(mockActivityRepo);
    activityService = new ActivityService();
  });

  it('throws AppError on invalid activity type filter', async () => {
    await expect(
      activityService.getFeed('user-1', undefined, 20, 'invalid_type')
    ).rejects.toThrow(AppError);
  });

  it('applies type filter when valid single type is passed', async () => {
    await activityService.getFeed('user-1', undefined, 20, 'song_upload');
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      'activity.actionType IN (:...types)',
      { types: ['song_upload'] }
    );
  });

  it('applies type filter when valid comma-separated types are passed', async () => {
    await activityService.getFeed('user-1', undefined, 20, 'song_upload,artist_follow');
    expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
      'activity.actionType IN (:...types)',
      { types: ['song_upload', 'artist_follow'] }
    );
  });
});
