import 'reflect-metadata';

jest.mock('../config/db', () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));

import AppDataSource from '../config/db';
import { CommentReportService } from '../services/CommentReportService';
import { CommentReport } from '../entities/CommentReport';
import { Comment } from '../entities/Comment';

const mockReportRepo = {
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  findAndCount: jest.fn(),
  count: jest.fn(),
};
const mockCommentRepo = {
  findOneBy: jest.fn(),
  save: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: unknown) => {
    if (entity === CommentReport) return mockReportRepo;
    if (entity === Comment) return mockCommentRepo;
    throw new Error(`Unexpected entity: ${(entity as { name?: string })?.name}`);
  });
});

function makeSvc(): CommentReportService {
  return new CommentReportService();
}

describe('CommentReportService.submitReport', () => {
  it('flags a comment and enqueues it for moderation (Issue #411)', async () => {
    mockCommentRepo.findOneBy.mockResolvedValue({ id: 'c-1', text: 'bad comment' });
    mockReportRepo.findOne.mockResolvedValue(null);
    mockReportRepo.create.mockImplementation((input: unknown) => input);
    mockReportRepo.save.mockImplementation(async (r: CommentReport) => r);

    const svc = makeSvc();
    const report = await svc.submitReport('c-1', 'u-1', { reason: 'harassment' });

    expect(mockReportRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        commentId: 'c-1',
        reporterId: 'u-1',
        reason: 'harassment',
        status: 'pending',
      }),
    );
    expect(report.commentId).toBe('c-1');
  });

  it('rejects an unknown reason', async () => {
    mockCommentRepo.findOneBy.mockResolvedValue({ id: 'c-1' });

    const svc = makeSvc();
    await expect(svc.submitReport('c-1', 'u-1', { reason: 'nope' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('rejects duplicate reports for the same comment and reporter', async () => {
    mockCommentRepo.findOneBy.mockResolvedValue({ id: 'c-1' });
    mockReportRepo.findOne.mockResolvedValue({ id: 'r-1', commentId: 'c-1', reporterId: 'u-1' });

    const svc = makeSvc();
    await expect(svc.submitReport('c-1', 'u-1', { reason: 'spam' })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('returns 404 when the comment does not exist', async () => {
    mockCommentRepo.findOneBy.mockResolvedValue(null);

    const svc = makeSvc();
    await expect(svc.submitReport('ghost', 'u-1', { reason: 'spam' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('CommentReportService.listPendingReports', () => {
  it('returns flagged comments with full context', async () => {
    mockReportRepo.findAndCount.mockResolvedValue([
      [{ id: 'r-1', comment: { id: 'c-1', text: 'bad', songId: 's-1' } }],
      1,
    ]);

    const svc = makeSvc();
    const result = await svc.listPendingReports(1, 20);

    expect(mockReportRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'pending' },
        relations: { comment: true },
        skip: 0,
        take: 20,
      }),
    );
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0].commentText).toBe('bad');
    expect(result.reports[0].songId).toBe('s-1');
    expect(result.pagination.total).toBe(1);
  });
});

describe('CommentReportService.resolveReport', () => {
  it('flags the comment when the moderator removes it', async () => {
    mockReportRepo.findOneBy.mockResolvedValue({
      id: 'r-1',
      commentId: 'c-1',
      status: 'pending',
      actionTaken: null,
    });
    mockReportRepo.save.mockImplementation(async (r: CommentReport) => r);
    mockCommentRepo.findOneBy.mockResolvedValue({ id: 'c-1', flagged: false });
    mockCommentRepo.save.mockImplementation(async (c: Comment) => c);

    const svc = makeSvc();
    await svc.resolveReport('r-1', 'mod-1', { actionTaken: 'comment_removed' });

    expect(mockCommentRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-1', flagged: true }),
    );
  });

  it('rejects resolving an already resolved report', async () => {
    mockReportRepo.findOneBy.mockResolvedValue({
      id: 'r-1',
      status: 'resolved',
    });

    const svc = makeSvc();
    await expect(
      svc.resolveReport('r-1', 'mod-1', { actionTaken: 'dismissed' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
