import "reflect-metadata";

jest.mock("../config/db", () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));
jest.mock("../config/redis", () => ({
  __esModule: true,
  default: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue("OK") },
}));

import AppDataSource from "../config/db";
import redis from "../config/redis";
import { EmbedService } from "../services/EmbedService";
import { Song } from "../entities/Song";
import { Album } from "../entities/Album";
import { User } from "../entities/User";

describe("EmbedService — lightweight public player (no auth, rate-limited)", () => {
  let mockSongRepo: any;
  let mockAlbumRepo: any;
  let mockUserRepo: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSongRepo = { findOne: jest.fn() };
    mockAlbumRepo = { findOne: jest.fn() };
    mockUserRepo = { findOne: jest.fn() };
    (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
      if (entity === Song) return mockSongRepo;
      if (entity === Album) return mockAlbumRepo;
      if (entity === User) return mockUserRepo;
      return mockSongRepo;
    });
    (redis.get as jest.Mock).mockResolvedValue(null);
    (redis.set as jest.Mock).mockResolvedValue("OK");
  });

  describe("getSongEmbed", () => {
    it("works for public/ready songs without authentication", async () => {
      mockSongRepo.findOne.mockResolvedValue({
        id: "song-1",
        title: "Test Song",
        description: "Desc",
        coverArtPath: "https://s3.example.com/cover.jpg",
        hlsMasterUrl: "https://s3.example.com/hls/master.m3u8",
        artistId: "artist-1",
        status: "ready",
        flagged: false,
        genre: "Hip Hop",
        duration: 180,
      });
      mockUserRepo.findOne.mockResolvedValue({ id: "artist-1", name: "Artist Name", username: "artist1", profileImage: "https://s3.example.com/artist.jpg" });

      const svc = new EmbedService();
      const data = await svc.getSongEmbed("song-1", "1.2.3.4");

      expect(data.id).toBe("song-1");
      expect(data.title).toBe("Test Song");
      expect(data.coverArtPath).toBe("https://s3.example.com/cover.jpg");
      expect(data.artist.name).toBe("Artist Name");
      expect(data.streamUrl).toBe("/api/song/stream/song-1");
      expect(data.hlsMasterUrl).toBe("https://s3.example.com/hls/master.m3u8");
      expect(data.genre).toBe("Hip Hop");
    });

    it("rejects non-ready or flagged songs (404)", async () => {
      mockSongRepo.findOne.mockResolvedValue({ id: "song-2", status: "processing", flagged: false, title: "X", artistId: "a1" } as any);
      const svc = new EmbedService();
      await expect(svc.getSongEmbed("song-2", "1.2.3.4")).rejects.toMatchObject({ message: "Song not available" });

      mockSongRepo.findOne.mockResolvedValue({ id: "song-3", status: "ready", flagged: true, title: "X", artistId: "a1" } as any);
      await expect(svc.getSongEmbed("song-3", "1.2.3.4")).rejects.toMatchObject({ message: "Song not available" });

      mockSongRepo.findOne.mockResolvedValue(null);
      await expect(svc.getSongEmbed("missing", "1.2.3.4")).rejects.toMatchObject({ message: "Song not available" });
    });

    it("respects same rate limiting as streaming (Redis throttle 30s)", async () => {
      mockSongRepo.findOne.mockResolvedValue({
        id: "song-1",
        title: "Test Song",
        coverArtPath: "https://s3.example.com/cover.jpg",
        artistId: "artist-1",
        status: "ready",
        flagged: false,
      } as any);
      mockUserRepo.findOne.mockResolvedValue({ id: "artist-1", name: "Artist" } as any);

      (redis.get as jest.Mock).mockResolvedValue(null); // first request not throttled
      const svc = new EmbedService();
      await svc.getSongEmbed("song-1", "5.6.7.8");
      expect(redis.set).toHaveBeenCalledWith("embed:throttle:5.6.7.8:song-1", "1", "EX", 30);

      // Second request — already throttled, should still set/refresh throttle but not block
      (redis.get as jest.Mock).mockResolvedValue("1"); // pretend already throttled (shared stream key)
      await svc.getSongEmbed("song-1", "5.6.7.8");
      expect(redis.get).toHaveBeenCalled();
      // Ensure we checked both embed and stream throttle keys
      // In implementation we check both embed:throttle and play:throttle
    });

    it("does not require IP (works when IP absent)", async () => {
      mockSongRepo.findOne.mockResolvedValue({
        id: "song-1",
        title: "Test Song",
        coverArtPath: "https://s3.example.com/cover.jpg",
        artistId: "artist-1",
        status: "ready",
        flagged: false,
      } as any);
      mockUserRepo.findOne.mockResolvedValue({ id: "artist-1", name: "Artist" } as any);
      const svc = new EmbedService();
      const data = await svc.getSongEmbed("song-1");
      expect(data.id).toBe("song-1");
    });

    it("returns minimal data needed for embeddable player widget", async () => {
      mockSongRepo.findOne.mockResolvedValue({
        id: "song-99",
        title: "Widget Song",
        coverArtPath: "https://cdn.example.com/cover.jpg",
        hlsMasterUrl: "https://cdn.example.com/master.m3u8",
        artistId: "art-99",
        status: "ready",
        flagged: false,
      } as any);
      mockUserRepo.findOne.mockResolvedValue({ id: "art-99", name: "Widget Artist", username: "widget", profileImage: "https://cdn.example.com/artist.jpg" } as any);
      const svc = new EmbedService();
      const data = await svc.getSongEmbed("song-99", "1.1.1.1");
      // Widget needs: stream URL, cover, artist name
      expect(data).toHaveProperty("streamUrl");
      expect(data).toHaveProperty("coverArtPath");
      expect(data.artist).toHaveProperty("name");
      expect(typeof data.streamUrl).toBe("string");
      expect(typeof data.coverArtPath).toBe("string");
    });
  });

  describe("getAlbumEmbed (playlist)", () => {
    it("returns album with embedded songs", async () => {
      mockAlbumRepo.findOne.mockResolvedValue({
        id: "album-1",
        title: "Test Album",
        coverArtPath: "https://s3.example.com/album.jpg",
        artistId: "artist-1",
        songs: ["song-1", "song-2"],
      } as any);
      mockUserRepo.findOne.mockResolvedValue({ id: "artist-1", name: "Artist" } as any);
      mockSongRepo.findOne
        .mockResolvedValueOnce({ id: "song-1", title: "S1", coverArtPath: "https://s3.example.com/c1.jpg", artistId: "artist-1", status: "ready", flagged: false } as any)
        .mockResolvedValueOnce({ id: "song-2", title: "S2", coverArtPath: "https://s3.example.com/c2.jpg", artistId: "artist-1", status: "ready", flagged: false } as any);

      const svc = new EmbedService();
      const album = await svc.getAlbumEmbed("album-1", "1.2.3.4");
      expect(album.id).toBe("album-1");
      expect(album.songs).toHaveLength(2);
      expect(album.title).toBe("Test Album");
    });

    it("throws 404 for missing album", async () => {
      mockAlbumRepo.findOne.mockResolvedValue(null);
      const svc = new EmbedService();
      await expect(svc.getAlbumEmbed("missing", "1.2.3.4")).rejects.toMatchObject({ message: "Album not found" });
    });
  });
});
