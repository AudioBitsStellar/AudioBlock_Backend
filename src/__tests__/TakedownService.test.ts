import "reflect-metadata";

jest.mock("../config/db", () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));
jest.mock("../config/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import AppDataSource from "../config/db";
import { TakedownService } from "../services/TakedownService";
import { TakedownRequest, TakedownStatus, TakedownReason } from "../entities/TakedownRequest";
import { Song } from "../entities/Song";
import { TransactionLog } from "../entities/TransactionLog";

describe("TakedownService — dedicated copyright takedown workflow (reversible unpublish)", () => {
  let mockTakedownRepo: any;
  let mockSongRepo: any;
  let mockLogRepo: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTakedownRepo = {
      create: jest.fn((data) => ({ id: "td-1", ...data, createdAt: new Date(), updatedAt: new Date() })),
      save: jest.fn(async (data) => data),
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => []),
    };
    mockSongRepo = {
      findOneBy: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(async (s) => s),
    };
    mockLogRepo = { save: jest.fn(async () => ({})) };

    (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
      if (entity === TakedownRequest) return mockTakedownRepo;
      if (entity === Song) return mockSongRepo;
      if (entity === TransactionLog) return mockLogRepo;
      return mockTakedownRepo;
    });
  });

  describe("createRequest — tracked separately from ContentReport", () => {
    it("creates a takedown request distinct from general moderation (separate entity)", async () => {
      mockSongRepo.findOneBy.mockResolvedValue({ id: "song-1", title: "Test", flagged: false } as any);
      mockTakedownRepo.findOne.mockResolvedValue(null); // no pending duplicate

      const svc = new TakedownService();
      const req = await svc.createRequest("user-1", "song-1", TakedownReason.COPYRIGHT, "Infringing copy", "https://evidence.com/doc");

      expect(mockTakedownRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          songId: "song-1",
          requestedBy: "user-1",
          reason: TakedownReason.COPYRIGHT,
          description: "Infringing copy",
          evidenceUrl: "https://evidence.com/doc",
        })
      );
      expect(req.songId).toBe("song-1");
      expect(req.status).toBe(TakedownStatus.PENDING);
      // Verify it's a TakedownRequest, not a generic log/report
      expect(mockTakedownRepo.save).toHaveBeenCalled();
      expect(mockLogRepo.save).toHaveBeenCalledWith(expect.objectContaining({ action: "takedown_request_created" }));
    });

    it("throws 404 if song not found", async () => {
      mockSongRepo.findOneBy.mockResolvedValue(null);
      const svc = new TakedownService();
      await expect(svc.createRequest("user-1", "missing", TakedownReason.COPYRIGHT)).rejects.toMatchObject({ message: "Song not found" });
    });

    it("is tracked separately — uses TakedownRequest repo not TransactionLog/ContentReport", async () => {
      mockSongRepo.findOneBy.mockResolvedValue({ id: "s1", flagged: false } as any);
      mockTakedownRepo.findOne.mockResolvedValue(null);
      const svc = new TakedownService();
      await svc.createRequest("u1", "s1", TakedownReason.COPYRIGHT);
      // Ensure TakedownRequest repo was used, not just TransactionLog
      expect(AppDataSource.getRepository).toHaveBeenCalledWith(TakedownRequest);
      expect(mockTakedownRepo.create).toHaveBeenCalled();
    });
  });

  describe("review workflow — approve (unpublish) and reverse (republish)", () => {
    it("approve temporarily unpublishes song (flagged=true) pending review", async () => {
      const song: any = { id: "song-1", flagged: false, flaggedAt: null, flaggedBy: null, flagReason: null };
      mockSongRepo.findOneBy.mockResolvedValue(song);
      const takedown: any = { id: "td-1", songId: "song-1", status: TakedownStatus.PENDING, previousFlagged: false };
      mockTakedownRepo.findOne.mockResolvedValue(takedown);

      const svc = new TakedownService();
      const result = await svc.reviewRequest("td-1", "admin-1", "approve", "Valid claim");

      expect(result.status).toBe(TakedownStatus.APPROVED);
      expect(result.reviewedBy).toBe("admin-1");
      expect(song.flagged).toBe(true);
      expect(song.flaggedBy).toBe("admin-1");
      expect(song.flagReason).toContain("takedown:td-1");
      expect(mockSongRepo.save).toHaveBeenCalledWith(song);
      expect(mockLogRepo.save).toHaveBeenCalledWith(expect.objectContaining({ action: "takedown_approved" }));
    });

    it("reverse is reversible — republishes song if claim resolved in artist favor", async () => {
      const song: any = { id: "song-1", flagged: true, flaggedAt: new Date(), flaggedBy: "admin-1", flagReason: "takedown:td-1:copyright:Valid claim" };
      mockSongRepo.findOneBy.mockResolvedValue(song);
      const takedown: any = {
        id: "td-1",
        songId: "song-1",
        status: TakedownStatus.APPROVED,
        previousFlagged: false, // was not flagged before takedown
        flagReason: "takedown:td-1",
      };
      mockTakedownRepo.findOne.mockResolvedValue(takedown);

      const svc = new TakedownService();
      const result = await svc.reviewRequest("td-1", "admin-1", "reverse", "Claim invalid — artist proved ownership");

      expect(result.status).toBe(TakedownStatus.REVERSED);
      expect(song.flagged).toBe(false);
      expect(song.flaggedAt).toBeNull();
      expect(mockSongRepo.save).toHaveBeenCalledWith(expect.objectContaining({ flagged: false }));
      expect(mockLogRepo.save).toHaveBeenCalledWith(expect.objectContaining({ action: "takedown_reversed" }));
    });

    it("reverse restores previously flagged state if song was already flagged before takedown", async () => {
      const song: any = { id: "song-1", flagged: true, flagReason: "takedown:td-1:copyright" };
      mockSongRepo.findOneBy.mockResolvedValue(song);
      const takedown: any = { id: "td-1", songId: "song-1", status: TakedownStatus.APPROVED, previousFlagged: true };
      mockTakedownRepo.findOne.mockResolvedValue(takedown);

      const svc = new TakedownService();
      await svc.reviewRequest("td-1", "admin-1", "reverse");
      // Should keep flagged true because it was flagged before
      expect(song.flagged).toBe(true);
    });

    it("reject keeps song published", async () => {
      const song: any = { id: "song-1", flagged: false };
      mockSongRepo.findOneBy.mockResolvedValue(song);
      const takedown: any = { id: "td-1", songId: "song-1", status: TakedownStatus.PENDING };
      mockTakedownRepo.findOne.mockResolvedValue(takedown);

      const svc = new TakedownService();
      const result = await svc.reviewRequest("td-1", "admin-1", "reject", "Insufficient evidence");
      expect(result.status).toBe(TakedownStatus.REJECTED);
      expect(song.flagged).toBe(false); // not unpublished
      expect(mockSongRepo.save).not.toHaveBeenCalled(); // no song mutation on reject
    });

    it("throws if trying to reverse non-approved takedown", async () => {
      const song: any = { id: "s1", flagged: false };
      mockSongRepo.findOneBy.mockResolvedValue(song);
      mockTakedownRepo.findOne.mockResolvedValue({ id: "td-1", songId: "s1", status: TakedownStatus.PENDING } as any);
      const svc = new TakedownService();
      await expect(svc.reviewRequest("td-1", "admin-1", "reverse")).rejects.toThrow("Only approved takedowns can be reversed");
    });
  });

  describe("list and get", () => {
    it("lists takedown requests", async () => {
      mockTakedownRepo.find.mockResolvedValue([{ id: "td-1" }, { id: "td-2" }]);
      const svc = new TakedownService();
      const list = await svc.listRequests({ status: TakedownStatus.PENDING });
      expect(mockTakedownRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { status: TakedownStatus.PENDING } }));
      expect(list).toHaveLength(2);
    });

    it("gets single request or throws 404", async () => {
      mockTakedownRepo.findOne.mockResolvedValue(null);
      const svc = new TakedownService();
      await expect(svc.getRequest("missing")).rejects.toMatchObject({ message: "Takedown request not found" });

      mockTakedownRepo.findOne.mockResolvedValue({ id: "td-1", songId: "s1" });
      const req = await svc.getRequest("td-1");
      expect(req.id).toBe("td-1");
    });
  });
});
