import 'reflect-metadata';
import { Request, Response } from 'express';
import { ActivityController } from '../controllers/ActivityController';

jest.mock('../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));

import AppDataSource from '../config/db';

describe('ActivityController.getActivityFeed', () => {
  let mockFeedRepo: any;
  let mockFollowRepo: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFeedRepo = {
      findAndCount: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    mockFollowRepo = {
      find: jest.fn(),
    };
    (AppDataSource.getRepository as jest.Mock).mockImplementation((entity) => {
      if (entity.name === 'ActivityFeed') return mockFeedRepo;
      if (entity.name === 'UserFollow') return mockFollowRepo;
    });
  });

  it('returns platform-wide feed when mode is not specified', async () => {
    const req = { query: {} } as unknown as Request;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response;

    mockFeedRepo.findAndCount.mockResolvedValue([[{ id: 'act-1' }], 1]);

    await ActivityController.getActivityFeed(req, res);

    expect(mockFeedRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        order: { createdAt: 'DESC' },
        skip: 0,
        take: 20,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        total: 1,
        data: [{ id: 'act-1' }],
      }),
    );
  });

  it('requires authentication for following-only mode', async () => {
    const req = { query: { mode: 'following' } } as unknown as Request;
    const res = {} as unknown as Response;

    await expect(ActivityController.getActivityFeed(req, res)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('returns following-only activity feed when authenticated and mode=following', async () => {
    const req = {
      query: { mode: 'following' },
      user: { id: 'user-1' },
    } as unknown as Request;

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response;

    mockFollowRepo.find.mockResolvedValue([
      { followingId: 'target-1' },
      { followingId: 'target-2' },
    ]);

    const qb = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[{ id: 'act-2' }], 1]),
    };
    mockFeedRepo.createQueryBuilder.mockReturnValue(qb);

    await ActivityController.getActivityFeed(req, res);

    expect(mockFollowRepo.find).toHaveBeenCalledWith({
      where: { followerId: 'user-1' },
      select: ['followingId'],
    });
    expect(mockFeedRepo.createQueryBuilder).toHaveBeenCalledWith('activity');
    expect(qb.where).toHaveBeenCalledWith('activity.userId IN (:...followingIds)', {
      followingIds: ['target-1', 'target-2'],
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        total: 1,
        data: [{ id: 'act-2' }],
      }),
    );
  });

  it('returns empty array immediately if user follows no accounts in following mode', async () => {
    const req = {
      query: { mode: 'following' },
      user: { id: 'user-1' },
    } as unknown as Request;

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response;

    mockFollowRepo.find.mockResolvedValue([]);

    await ActivityController.getActivityFeed(req, res);

    expect(mockFeedRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        total: 0,
        data: [],
      }),
    );
  });
});
