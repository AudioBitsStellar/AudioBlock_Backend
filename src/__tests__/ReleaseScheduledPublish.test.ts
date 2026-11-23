import 'reflect-metadata';

jest.mock('../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));

import AppDataSource from '../config/db';
import { ReleaseService } from '../services/ReleaseService';
import { Release, ReleaseStatus, ReleaseType } from '../entities/Release';
import { ReleaseTrack } from '../entities/ReleaseTrack';
import { Song } from '../entities/Song';
import { runScheduledReleasePublishJob } from '../jobs/ScheduledReleasePublishJob';

const mockReleaseRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOneBy: jest.fn(),
  find: jest.fn(),
  findAndCount: jest.fn(),
};

const mockTrackRepo = {
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
};

const mockSongRepo = {
  findBy: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  (AppDataSource.getRepository as jest.Mock).mockImplementation((entity) => {
    if (entity === Release) return mockReleaseRepo;
    if (entity === ReleaseTrack) return mockTrackRepo;
    if (entity === Song) return mockSongRepo;
    return mockReleaseRepo;
  });
});

describe('ReleaseService — Scheduled and Immediate Publishing (Issue #423)', () => {
  const baseTime = new Date('2026-10-19T10:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(baseTime);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates a release in SCHEDULED status when scheduledAt is in the future', async () => {
    const futureDate = new Date('2026-10-19T15:00:00.000Z');
    mockSongRepo.findBy.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
    mockReleaseRepo.create.mockImplementation((input: unknown) => input);
    mockReleaseRepo.save.mockImplementation(async (r: any) => ({ id: 'r1', ...r }));
    mockTrackRepo.create.mockImplementation((t: unknown) => t);
    mockTrackRepo.save.mockResolvedValue([]);
    mockReleaseRepo.findOneBy.mockImplementation(async () => ({
      id: 'r1',
      title: 'Future Album',
      artistId: 'artist-1',
      releaseDate: futureDate,
      type: ReleaseType.ALBUM,
      status: ReleaseStatus.SCHEDULED,
      scheduledAt: futureDate,
      publishedAt: null,
    }));
    mockTrackRepo.find.mockResolvedValue([]);

    const svc = new ReleaseService();
    const result = await svc.create({
      title: 'Future Album',
      artistId: 'artist-1',
      releaseDate: futureDate,
      type: ReleaseType.ALBUM,
      songIds: ['s1', 's2'],
      scheduledAt: futureDate,
    });

    expect(mockReleaseRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ReleaseStatus.SCHEDULED,
        scheduledAt: futureDate,
        publishedAt: null,
      }),
    );
    expect(result.status).toBe(ReleaseStatus.SCHEDULED);
  });

  it('immediately publishes a release when scheduledAt is not provided', async () => {
    mockSongRepo.findBy.mockResolvedValue([{ id: 's1' }]);
    mockReleaseRepo.create.mockImplementation((input: unknown) => input);
    mockReleaseRepo.save.mockImplementation(async (r: any) => ({ id: 'r1', ...r }));
    mockTrackRepo.create.mockImplementation((t: unknown) => t);
    mockTrackRepo.save.mockResolvedValue([]);
    mockReleaseRepo.findOneBy.mockImplementation(async () => ({
      id: 'r1',
      title: 'Now Single',
      artistId: 'artist-1',
      releaseDate: baseTime,
      type: ReleaseType.SINGLE,
      status: ReleaseStatus.PUBLISHED,
      scheduledAt: null,
      publishedAt: baseTime,
    }));
    mockTrackRepo.find.mockResolvedValue([]);

    const svc = new ReleaseService();
    const result = await svc.create({
      title: 'Now Single',
      artistId: 'artist-1',
      releaseDate: baseTime,
      type: ReleaseType.SINGLE,
      songIds: ['s1'],
    });

    expect(mockReleaseRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ReleaseStatus.PUBLISHED,
        scheduledAt: null,
        publishedAt: expect.any(Date),
      }),
    );
    expect(result.status).toBe(ReleaseStatus.PUBLISHED);
  });

  it('manually and immediately publishes a scheduled release before its time', async () => {
    const scheduledRelease = {
      id: 'r1',
      artistId: 'artist-1',
      title: 'Early Publish',
      status: ReleaseStatus.SCHEDULED,
      scheduledAt: new Date('2026-10-19T18:00:00.000Z'),
      publishedAt: null,
    };
    mockReleaseRepo.findOneBy.mockResolvedValue(scheduledRelease);
    mockReleaseRepo.save.mockImplementation(async (saved: any) => saved);

    const svc = new ReleaseService();
    const published = await svc.publish('r1', 'artist-1');

    expect(published.status).toBe(ReleaseStatus.PUBLISHED);
    expect(published.publishedAt).toEqual(baseTime);
    expect(published.scheduledAt).toBeNull();
    expect(mockReleaseRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ReleaseStatus.PUBLISHED,
        publishedAt: baseTime,
        scheduledAt: null,
      }),
    );
  });

  it('prevents non-owning artist from manually publishing a release', async () => {
    mockReleaseRepo.findOneBy.mockResolvedValue({
      id: 'r1',
      artistId: 'artist-1',
      status: ReleaseStatus.SCHEDULED,
    });

    const svc = new ReleaseService();
    await expect(svc.publish('r1', 'not-the-artist')).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('automatically flips release to PUBLISHED at scheduled time with mocked clock', async () => {
    const targetScheduledTime = new Date('2026-10-19T12:00:00.000Z');

    const scheduledRelease: any = {
      id: 'r-timed',
      title: 'Midnight Drop',
      status: ReleaseStatus.SCHEDULED,
      scheduledAt: targetScheduledTime,
      publishedAt: null,
    };

    // Before scheduled time: nothing is due
    mockReleaseRepo.find.mockImplementation(async ({ where }: any) => {
      // Simulate LessThanOrEqual condition
      if (where.scheduledAt && where.scheduledAt._value) {
        const asOf = where.scheduledAt._value;
        if (targetScheduledTime <= asOf) {
          return [scheduledRelease];
        }
      }
      return [];
    });
    mockReleaseRepo.save.mockImplementation(async (r: any) => r);

    const svc = new ReleaseService();

    // Check before scheduled time (10:00 AM)
    const publishedBefore = await svc.publishScheduledReleases(new Date());
    expect(publishedBefore).toHaveLength(0);

    // Fast-forward clock to exactly 12:00 PM
    jest.setSystemTime(targetScheduledTime);

    // Run auto-publish at scheduled time
    const publishedAtTime = await svc.publishScheduledReleases(new Date());
    expect(publishedAtTime).toHaveLength(1);
    expect(publishedAtTime[0].status).toBe(ReleaseStatus.PUBLISHED);
    expect(publishedAtTime[0].publishedAt).toEqual(targetScheduledTime);
  });

  it('ScheduledReleasePublishJob finds and publishes due releases', async () => {
    const dueTime = new Date('2026-10-19T12:00:00.000Z');
    jest.setSystemTime(dueTime);

    mockReleaseRepo.find.mockResolvedValue([
      {
        id: 'r-due',
        status: ReleaseStatus.SCHEDULED,
        scheduledAt: dueTime,
        publishedAt: null,
      },
    ]);
    mockReleaseRepo.save.mockImplementation(async (r: any) => ({
      ...r,
      status: ReleaseStatus.PUBLISHED,
    }));

    const count = await runScheduledReleasePublishJob(dueTime);
    expect(count).toBe(1);
    expect(mockReleaseRepo.save).toHaveBeenCalled();
  });
});
