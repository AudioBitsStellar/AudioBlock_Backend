import 'reflect-metadata';

jest.mock('../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));
jest.mock('../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import AppDataSource from '../config/db';
import { TakedownService } from '../services/TakedownService';
import {
  TakedownRequest,
  TakedownStatus,
  TakedownReason,
  TAKEDOWN_COUNTER_NOTICE_WINDOW_MS,
  TAKEDOWN_REVIEW_SLA_MS,
} from '../entities/TakedownRequest';
import { Song } from '../entities/Song';
import { TransactionLog } from '../entities/TransactionLog';

const DAY_MS = 24 * 60 * 60 * 1000;
const artistId = '77777777-7777-4777-8777-777777777777';
const otherUserId = '88888888-8888-4888-8888-888888888888';
const adminId = '99999999-9999-4999-8999-999999999999';
const takedownId = 'td-1';

let mockTakedownRepo: any;
let mockSongRepo: any;
let mockLogRepo: any;

function approvedTakedown(overrides: Partial<TakedownRequest> = {}): any {
  return {
    id: takedownId,
    songId: 'song-1',
    status: TakedownStatus.APPROVED,
    reason: TakedownReason.COPYRIGHT,
    counterNotice: null,
    counterNoticeDueAt: new Date(Date.now() + 5 * DAY_MS),
    song: { id: 'song-1', artistId, flagged: true },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTakedownRepo = {
    create: jest.fn((data) => ({ id: takedownId, ...data })),
    save: jest.fn(async (data) => data),
    findOne: jest.fn(async () => null),
    find: jest.fn(async () => []),
  };
  mockSongRepo = {
    findOneBy: jest.fn(async () => ({ id: 'song-1', artistId, flagged: false })),
    save: jest.fn(async (s) => s),
  };
  mockLogRepo = { save: jest.fn(async () => ({})) };

  (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: unknown) => {
    if (entity === TakedownRequest) return mockTakedownRepo;
    if (entity === Song) return mockSongRepo;
    if (entity === TransactionLog) return mockLogRepo;
    return mockTakedownRepo;
  });
});

describe('TakedownService review deadlines (#981)', () => {
  it('gives a new request a review deadline three days out', async () => {
    const before = Date.now();
    const svc = new TakedownService();

    await svc.createRequest(otherUserId, 'song-1', TakedownReason.COPYRIGHT);

    const data = mockTakedownRepo.create.mock.calls[0][0];
    expect(data.reviewDueAt).toBeInstanceOf(Date);
    const due = (data.reviewDueAt as Date).getTime();
    expect(due).toBeGreaterThanOrEqual(before + TAKEDOWN_REVIEW_SLA_MS);
    expect(due).toBeLessThanOrEqual(Date.now() + TAKEDOWN_REVIEW_SLA_MS);
  });

  it('opens a counter-notice window fourteen days from approval', async () => {
    mockTakedownRepo.findOne.mockResolvedValueOnce({
      id: takedownId,
      songId: 'song-1',
      status: TakedownStatus.PENDING,
    });
    const svc = new TakedownService();

    const saved = await svc.reviewRequest(takedownId, adminId, 'approve');

    expect(saved.status).toBe(TakedownStatus.APPROVED);
    const window = saved.counterNoticeDueAt!.getTime() - saved.resolvedAt!.getTime();
    expect(window).toBe(TAKEDOWN_COUNTER_NOTICE_WINDOW_MS);
    expect(TAKEDOWN_COUNTER_NOTICE_WINDOW_MS).toBe(14 * DAY_MS);
  });

  it('filters to pending requests past their review deadline when asked', async () => {
    const svc = new TakedownService();

    await svc.listRequests({ overdue: true });

    const { where } = mockTakedownRepo.find.mock.calls[0][0];
    expect(where.status).toBe(TakedownStatus.PENDING);
    expect(where.reviewDueAt).toBeDefined();
  });
});

describe('TakedownService.submitCounterNotice (#981)', () => {
  it('lets the artist of the song file a trimmed counter-notice', async () => {
    mockTakedownRepo.findOne.mockResolvedValueOnce(approvedTakedown());
    const svc = new TakedownService();

    const saved = await svc.submitCounterNotice(takedownId, artistId, '  This is licensed.  ');

    expect(saved.counterNotice).toBe('This is licensed.');
    expect(saved.counterNoticeBy).toBe(artistId);
    expect(saved.counterNoticeAt).toBeInstanceOf(Date);
    // Filing a counter-notice does not decide the takedown; an admin still does.
    expect(saved.status).toBe(TakedownStatus.APPROVED);
  });

  it('refuses a caller who does not own the song', async () => {
    mockTakedownRepo.findOne.mockResolvedValueOnce(approvedTakedown());
    const svc = new TakedownService();

    await expect(svc.submitCounterNotice(takedownId, otherUserId, 'mine')).rejects.toMatchObject({
      statusCode: 403,
      code: 'COUNTER_NOTICE_FORBIDDEN',
    });
    expect(mockTakedownRepo.save).not.toHaveBeenCalled();
  });

  it('refuses a counter-notice on a takedown that is not approved', async () => {
    mockTakedownRepo.findOne.mockResolvedValueOnce(
      approvedTakedown({ status: TakedownStatus.PENDING }),
    );
    const svc = new TakedownService();

    await expect(svc.submitCounterNotice(takedownId, artistId, 'hi')).rejects.toMatchObject({
      statusCode: 409,
      code: 'TAKEDOWN_NOT_APPROVED',
    });
  });

  it('allows only one counter-notice per takedown', async () => {
    mockTakedownRepo.findOne.mockResolvedValueOnce(approvedTakedown({ counterNotice: 'first' }));
    const svc = new TakedownService();

    await expect(svc.submitCounterNotice(takedownId, artistId, 'second')).rejects.toMatchObject({
      statusCode: 409,
      code: 'COUNTER_NOTICE_EXISTS',
    });
    expect(mockTakedownRepo.save).not.toHaveBeenCalled();
  });

  it('refuses a counter-notice once the window has closed', async () => {
    mockTakedownRepo.findOne.mockResolvedValueOnce(
      approvedTakedown({ counterNoticeDueAt: new Date(Date.now() - DAY_MS) }),
    );
    const svc = new TakedownService();

    await expect(svc.submitCounterNotice(takedownId, artistId, 'late')).rejects.toMatchObject({
      statusCode: 409,
      code: 'COUNTER_NOTICE_WINDOW_CLOSED',
    });
    expect(mockTakedownRepo.save).not.toHaveBeenCalled();
  });

  it('rejects a statement that is only whitespace', async () => {
    mockTakedownRepo.findOne.mockResolvedValueOnce(approvedTakedown());
    const svc = new TakedownService();

    await expect(svc.submitCounterNotice(takedownId, artistId, '   ')).rejects.toMatchObject({
      statusCode: 400,
      code: 'STATEMENT_REQUIRED',
    });
    expect(mockTakedownRepo.save).not.toHaveBeenCalled();
  });
});
