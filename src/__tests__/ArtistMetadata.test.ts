import "reflect-metadata";

jest.mock("../config/db", () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));

import AppDataSource from "../config/db";
import { ArtistMetadataService } from "../services/ArtistMetadataService";
import { User, UserRole } from "../entities/User";

describe("ArtistMetadataService — OG + JSON-LD (no private data)", () => {
  let mockUserRepo: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUserRepo = { findOne: jest.fn() };
    (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) => {
      if (entity === User) return mockUserRepo;
      return mockUserRepo;
    });
    process.env.APP_URL = "https://audioblock.example.com";
  });

  it("returns valid Open Graph fields", async () => {
    mockUserRepo.findOne.mockResolvedValue({
      id: "artist-1",
      name: "Test Artist",
      username: "testartist",
      bio: "Bio text",
      profileImage: "https://s3.example.com/profile.jpg",
      pageCover: "https://s3.example.com/cover.jpg",
      website: "https://testartist.com",
      twitterUsername: "testartist",
      role: UserRole.ARTIST,
      email: "private@example.com",
      walletAddress: "0xSECRET",
      passwordHash: "hash",
      stellarPublicKey: "GSECRET",
    } as any);

    const svc = new ArtistMetadataService();
    const meta = await svc.getArtistMetadata("artist-1");

    expect(meta.openGraph).toBeDefined();
    expect(meta.openGraph.title).toBe("Test Artist");
    expect(meta.openGraph.description).toBe("Bio text");
    expect(meta.openGraph.image).toBe("https://s3.example.com/profile.jpg");
    expect(meta.openGraph.url).toBe("https://audioblock.example.com/artist/artist-1");
    expect(meta.openGraph.type).toBe("profile");

    expect(meta.jsonLd).toBeDefined();
    expect(meta.jsonLd["@context"]).toBe("https://schema.org");
    expect(meta.jsonLd["@type"]).toBe("MusicGroup");
    expect(meta.jsonLd.name).toBe("Test Artist");
    expect(meta.jsonLd.url).toBe("https://audioblock.example.com/artist/artist-1");
    expect(meta.jsonLd.sameAs).toContain("https://testartist.com");
  });

  it("does not expose private data (email, wallet, stellar, passwordHash)", async () => {
    mockUserRepo.findOne.mockResolvedValue({
      id: "artist-2",
      name: "Private Artist",
      username: "privateartist",
      bio: "Hello",
      profileImage: null,
      role: UserRole.ARTIST,
      email: "private@example.com",
      walletAddress: "0xPRIVATE",
      passwordHash: "supersecret",
      stellarPublicKey: "GPRIVATE",
      twoFactorSecret: "2FASECRET",
      emailVerificationToken: "token",
    } as any);

    const svc = new ArtistMetadataService();
    const meta = await svc.getArtistMetadata("artist-2");

    const serialized = JSON.stringify(meta);
    expect(serialized).not.toContain("private@example.com");
    expect(serialized).not.toContain("0xPRIVATE");
    expect(serialized).not.toContain("supersecret");
    expect(serialized).not.toContain("GPRIVATE");
    expect(serialized).not.toContain("2FASECRET");
    expect(serialized).not.toContain("token");

    // Profile whitelist check: only public fields present
    expect((meta.profile as any).email).toBeUndefined();
    expect((meta.profile as any).walletAddress).toBeUndefined();
    expect((meta.profile as any).passwordHash).toBeUndefined();
    expect((meta.profile as any).stellarPublicKey).toBeUndefined();
    expect(meta.profile).toEqual(
      expect.objectContaining({
        id: "artist-2",
        username: "privateartist",
        name: "Private Artist",
      })
    );
  });

  it("throws 404 for missing artist", async () => {
    mockUserRepo.findOne.mockResolvedValue(null);
    const svc = new ArtistMetadataService();
    await expect(svc.getArtistMetadata("missing")).rejects.toThrow("Artist not found");
  });

  it("generates HTML fragment with OG meta tags and JSON-LD script", async () => {
    mockUserRepo.findOne.mockResolvedValue({
      id: "artist-3",
      name: "HTML Artist",
      bio: "Desc",
      profileImage: "https://example.com/img.jpg",
      username: "htmlartist",
      role: UserRole.ARTIST,
    } as any);
    const svc = new ArtistMetadataService();
    const html = await svc.getArtistMetadataHtml("artist-3");
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:description"');
    expect(html).toContain('property="og:image"');
    expect(html).toContain('property="og:url"');
    expect(html).toContain('property="og:type"');
    expect(html).toContain('application/ld+json');
    expect(html).toContain("HTML Artist");
  });

  it("handles missing optional fields gracefully", async () => {
    mockUserRepo.findOne.mockResolvedValue({
      id: "artist-4",
      name: null,
      username: null,
      bio: null,
      role: UserRole.ARTIST,
    } as any);
    const svc = new ArtistMetadataService();
    const meta = await svc.getArtistMetadata("artist-4");
    expect(meta.openGraph.title).toBe("Artist");
    expect(meta.openGraph.description).toBe("Artist on AudioBlock");
    expect(meta.openGraph.url).toContain("artist-4");
  });
});
