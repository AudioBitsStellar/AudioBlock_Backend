import { RoyaltyTemplateController } from '../RoyaltyTemplateController';
import { createMockRequest, createMockResponse } from '../../../tests/helpers';

const mockCreate = jest.fn();
const mockFindByUser = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
jest.mock('../../services/RoyaltyTemplateService', () => ({
  RoyaltyTemplateService: jest.fn().mockImplementation(() => ({
    create: (...args: unknown[]) => mockCreate(...args),
    findByUser: (...args: unknown[]) => mockFindByUser(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  })),
}));

jest.mock('../../services/SongService', () => ({
  SongService: jest.fn().mockImplementation(() => ({})),
}));

describe('RoyaltyTemplateController (#314)', () => {
  const controller = new RoyaltyTemplateController();
  const userId = 'artist-1';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('returns 401 when the request is unauthenticated', async () => {
      const req = createMockRequest({
        body: { name: 'Split', splits: [{ payeeId: 'p1', percentage: 100 }] },
      });
      const res = createMockResponse();

      await controller.create(req, res as any);

      expect(mockCreate).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('returns 400 when splits is missing', async () => {
      const req = createMockRequest({ userId, body: { name: 'Split' } });
      const res = createMockResponse();

      await controller.create(req, res as any);

      expect(mockCreate).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: expect.stringContaining('splits') }),
      );
    });

    it('returns 400 when splits is not an array', async () => {
      const req = createMockRequest({ userId, body: { name: 'Split', splits: 'not-an-array' } });
      const res = createMockResponse();

      await controller.create(req, res as any);

      expect(mockCreate).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('creates a single-payee template (100% to one payee)', async () => {
      const splits = [{ payeeId: 'p1', percentage: 100 }];
      mockCreate.mockResolvedValue({ id: 't1', name: 'Solo', userId, splits });
      const req = createMockRequest({ userId, body: { name: 'Solo', splits } });
      const res = createMockResponse();

      await controller.create(req, res as any);

      expect(mockCreate).toHaveBeenCalledWith({ name: 'Solo', userId, splits });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: expect.objectContaining({ id: 't1' }) }),
      );
    });

    it('creates a many-payee template (percentages summing to 100)', async () => {
      const splits = [
        { payeeId: 'p1', percentage: 25 },
        { payeeId: 'p2', percentage: 25 },
        { payeeId: 'p3', percentage: 25 },
        { payeeId: 'p4', percentage: 25 },
      ];
      mockCreate.mockResolvedValue({ id: 't2', name: 'Band Split', userId, splits });
      const req = createMockRequest({ userId, body: { name: 'Band Split', splits } });
      const res = createMockResponse();

      await controller.create(req, res as any);

      expect(mockCreate).toHaveBeenCalledWith({ name: 'Band Split', userId, splits });
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('surfaces a service validation error (percentages not summing to 100) with its status code', async () => {
      const err: any = new Error('Split percentages must sum to 100');
      err.statusCode = 422;
      mockCreate.mockRejectedValue(err);
      const splits = [
        { payeeId: 'p1', percentage: 60 },
        { payeeId: 'p2', percentage: 60 },
      ];
      const req = createMockRequest({ userId, body: { name: 'Bad Split', splits } });
      const res = createMockResponse();

      await controller.create(req, res as any);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, message: 'Split percentages must sum to 100' }),
      );
    });

    it('defaults to 400 for a service error with no statusCode', async () => {
      mockCreate.mockRejectedValue(new Error('unexpected failure'));
      const req = createMockRequest({
        userId,
        body: { name: 'X', splits: [{ payeeId: 'p1', percentage: 100 }] },
      });
      const res = createMockResponse();

      await controller.create(req, res as any);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 500 when a non-Error value is thrown', async () => {
      mockCreate.mockRejectedValue('a string rejection');
      const req = createMockRequest({
        userId,
        body: { name: 'X', splits: [{ payeeId: 'p1', percentage: 100 }] },
      });
      const res = createMockResponse();

      await controller.create(req, res as any);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  // ── list ─────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('returns 401 when the request is unauthenticated', async () => {
      const req = createMockRequest({});
      const res = createMockResponse();

      await controller.list(req, res as any);

      expect(mockFindByUser).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("returns 200 with the caller's templates", async () => {
      mockFindByUser.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
      const req = createMockRequest({ userId });
      const res = createMockResponse();

      await controller.list(req, res as any);

      expect(mockFindByUser).toHaveBeenCalledWith(userId);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: [{ id: 't1' }, { id: 't2' }] }),
      );
    });
  });

  // ── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    it('returns 401 when the request is unauthenticated', async () => {
      const req = createMockRequest({ params: { id: 't1' }, body: { name: 'New' } });
      const res = createMockResponse();

      await controller.update(req, res as any);

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("updates the caller's own template", async () => {
      const splits = [{ payeeId: 'p1', percentage: 100 }];
      mockUpdate.mockResolvedValue({ id: 't1', name: 'Renamed', userId, splits });
      const req = createMockRequest({
        userId,
        params: { id: 't1' },
        body: { name: 'Renamed', splits },
      });
      const res = createMockResponse();

      await controller.update(req, res as any);

      expect(mockUpdate).toHaveBeenCalledWith('t1', userId, { name: 'Renamed', splits });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("surfaces an ownership error (updating another user's template) with its status code", async () => {
      const err: any = new Error('Template not found');
      err.statusCode = 404;
      mockUpdate.mockRejectedValue(err);
      const req = createMockRequest({ userId, params: { id: 'not-mine' }, body: { name: 'X' } });
      const res = createMockResponse();

      await controller.update(req, res as any);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ── delete ───────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('returns 401 when the request is unauthenticated', async () => {
      const req = createMockRequest({ params: { id: 't1' } });
      const res = createMockResponse();

      await controller.delete(req, res as any);

      expect(mockDelete).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("deletes the caller's own template", async () => {
      mockDelete.mockResolvedValue(undefined);
      const req = createMockRequest({ userId, params: { id: 't1' } });
      const res = createMockResponse();

      await controller.delete(req, res as any);

      expect(mockDelete).toHaveBeenCalledWith('t1', userId);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("surfaces an ownership error (deleting another user's template) with its status code", async () => {
      const err: any = new Error('Not authorized to delete this template');
      err.statusCode = 403;
      mockDelete.mockRejectedValue(err);
      const req = createMockRequest({ userId, params: { id: 'not-mine' } });
      const res = createMockResponse();

      await controller.delete(req, res as any);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });
});
