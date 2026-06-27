import "reflect-metadata";

jest.mock("../config/db", () => ({
  __esModule: true,
  default: { getRepository: jest.fn() },
}));
jest.mock("../config/rabbitmq", () => ({
  getChannel: jest.fn().mockReturnValue({ sendToQueue: jest.fn() }),
}));
jest.mock("../config/s3", () => ({
  s3: {
    upload: jest.fn().mockReturnValue({ promise: jest.fn().mockResolvedValue({ Location: "s3://bucket/key" }) }),
  },
}));
jest.mock("../services/Soroban/SorobanService", () => ({
  SorobanService: jest.fn().mockImplementation(() => ({
    prepareInvocation: jest.fn(),
    submitSignedTransaction: jest.fn(),
  })),
  addressArg: jest.fn((v) => v),
  stringArg: jest.fn((v) => v),
  u64Arg: jest.fn((v) => v),
}));
jest.mock("../config/soroban", () => ({
  SorobanContracts: { catalog: "CATALOG_CONTRACT" },
  getNetworkPassphrase: jest.fn().mockReturnValue("Test SDF Network ; September 2015"),
  getSorobanServer: jest.fn(),
  getSorobanRpcUrl: jest.fn(),
}));

import AppDataSource from "../config/db";
import { SorobanService } from "../services/Soroban/SorobanService";
import { SongService } from "../services/SongService";
import { Song } from "../entities/Song";
import { User } from "../entities/User";

const mockSongRepo = {
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
};
const mockUserRepo = {
  findOneBy: jest.fn(),
};

let mockSorobanInstance: { prepareInvocation: jest.Mock; submitSignedTransaction: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: unknown) => {
    if (entity === Song) return mockSongRepo;
    if (entity === User) return mockUserRepo;
    return mockSongRepo;
  });
  mockSorobanInstance = (SorobanService as jest.Mock).mock.instances?.[0] ?? {
    prepareInvocation: jest.fn(),
    submitSignedTransaction: jest.fn(),
  };
});

// Helper to get the soroban instance from the service after instantiation
function makeSvc() {
  const svc = new SongService();
  // Access the private soroban instance via any
  mockSorobanInstance = (svc as any).soroban;
  return svc;
}

describe("SongService.prepareSongMintTx", () => {
  it("throws when song is not found", async () => {
    mockSongRepo.findOne.mockResolvedValue(null);
    const svc = makeSvc();
    await expect(svc.prepareSongMintTx("missing-id")).rejects.toThrow("Song not found");
  });

  it("throws when song has no metadata CID", async () => {
    mockSongRepo.findOne.mockResolvedValue({ id: "s1", metadataCid: null, user: null, artistId: "u1" });
    mockUserRepo.findOneBy.mockResolvedValue({ id: "u1", stellarPublicKey: "GXYZ" });
    const svc = makeSvc();
    await expect(svc.prepareSongMintTx("s1")).rejects.toThrow("Song has no metadata CID yet");
  });

  it("throws when the artist has no connected Stellar wallet", async () => {
    mockSongRepo.findOne.mockResolvedValue({
      id: "s1",
      metadataCid: "QmABC",
      user: { id: "u1", stellarPublicKey: null },
      artistId: "u1",
    });
    const svc = makeSvc();
    await expect(svc.prepareSongMintTx("s1")).rejects.toThrow(
      "Connect a Stellar wallet before minting this song"
    );
  });

  it("returns PreparedTransaction on success", async () => {
    const song = { id: "s1", metadataCid: "QmABC", user: null, artistId: "u1" };
    mockSongRepo.findOne.mockResolvedValue(song);
    mockUserRepo.findOneBy.mockResolvedValue({ id: "u1", stellarPublicKey: "GXYZ" });
    process.env.SOROBAN_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

    const svc = makeSvc();
    mockSorobanInstance.prepareInvocation.mockResolvedValue("unsigned-xdr");

    const result = await svc.prepareSongMintTx("s1", 0);

    expect(mockSorobanInstance.prepareInvocation).toHaveBeenCalledWith(
      "GXYZ",
      "CATALOG_CONTRACT",
      "upload_and_mint_song",
      expect.any(Array)
    );
    expect(result).toEqual({ xdr: "unsigned-xdr", networkPassphrase: "Test SDF Network ; September 2015" });
  });
});

describe("SongService.submitSongMintTx", () => {
  it("throws when song is not found", async () => {
    mockSongRepo.findOneBy.mockResolvedValue(null);
    const svc = makeSvc();
    await expect(svc.submitSongMintTx("missing-id", "signedXdr")).rejects.toThrow("Song not found");
  });

  it("marks song as failed and rethrows when the Soroban tx fails", async () => {
    const song = { id: "s1", mintStatus: "pending", onChainSongId: null, onChainTokenId: null };
    mockSongRepo.findOneBy.mockResolvedValue(song);
    mockSongRepo.save.mockResolvedValue(song);

    const svc = makeSvc();
    mockSorobanInstance.submitSignedTransaction.mockRejectedValue(new Error("tx rejected"));

    await expect(svc.submitSongMintTx("s1", "signedXdr")).rejects.toThrow("tx rejected");
    expect(song.mintStatus).toBe("failed");
    expect(mockSongRepo.save).toHaveBeenCalled();
  });

  it("updates song with on-chain IDs and returns txHash on success", async () => {
    const song: any = { id: "s1", mintStatus: "pending", onChainSongId: null, onChainTokenId: null };
    mockSongRepo.findOneBy.mockResolvedValue(song);
    mockSongRepo.save.mockImplementation(async (s: any) => s);

    const svc = makeSvc();
    mockSorobanInstance.submitSignedTransaction.mockResolvedValue({
      hash: "txhash123",
      returnValue: [BigInt(42), BigInt(7)],
    });

    const result = await svc.submitSongMintTx("s1", "signedXdr");

    expect(song.mintStatus).toBe("minted");
    expect(song.onChainSongId).toBe("42");
    expect(song.onChainTokenId).toBe("7");
    expect(result).toEqual({ txHash: "txhash123", songId: "42", tokenId: "7" });
  });
});
