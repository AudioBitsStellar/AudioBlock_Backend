import "reflect-metadata";

jest.mock("../services/Soroban/SorobanService", () => ({
  SorobanService: jest.fn().mockImplementation(() => ({
    prepareInvocation: jest.fn(),
    submitSignedTransaction: jest.fn(),
  })),
  addressArg: jest.fn((v) => v),
  u64Arg: jest.fn((v) => v),
}));
jest.mock("../config/soroban", () => ({
  SorobanContracts: { marketplace: "MARKETPLACE_CONTRACT" },
  getNetworkPassphrase: jest.fn().mockReturnValue("Test SDF Network ; September 2015"),
  getSorobanServer: jest.fn(),
  getSorobanRpcUrl: jest.fn(),
}));

import { SorobanService } from "../services/Soroban/SorobanService";
import { MarketplaceService } from "../services/Marketplace/MarketplaceService";

let mockSoroban: { prepareInvocation: jest.Mock; submitSignedTransaction: jest.Mock };
let svc: MarketplaceService;

beforeEach(() => {
  jest.clearAllMocks();
  svc = new MarketplaceService();
  mockSoroban = (svc as any).soroban;
  process.env.SOROBAN_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
});

describe("MarketplaceService.prepareListing", () => {
  it("calls prepareInvocation with list_nft and returns PreparedTransaction", async () => {
    mockSoroban.prepareInvocation.mockResolvedValue("unsigned-list-xdr");

    const result = await svc.prepareListing("GSELLER", 7, 10_000_000);

    expect(mockSoroban.prepareInvocation).toHaveBeenCalledWith(
      "GSELLER",
      "MARKETPLACE_CONTRACT",
      "list_nft",
      expect.any(Array)
    );
    expect(result).toEqual({
      xdr: "unsigned-list-xdr",
      networkPassphrase: "Test SDF Network ; September 2015",
    });
  });
});

describe("MarketplaceService.submitListing", () => {
  it("submits signed XDR and returns txHash", async () => {
    mockSoroban.submitSignedTransaction.mockResolvedValue({ hash: "list-txhash", returnValue: undefined });

    const result = await svc.submitListing("signed-list-xdr");

    expect(mockSoroban.submitSignedTransaction).toHaveBeenCalledWith("signed-list-xdr");
    expect(result).toEqual({ txHash: "list-txhash" });
  });

  it("rethrows Soroban errors", async () => {
    mockSoroban.submitSignedTransaction.mockRejectedValue(new Error("Soroban rejected"));
    await expect(svc.submitListing("bad-xdr")).rejects.toThrow("Soroban rejected");
  });
});

describe("MarketplaceService.prepareBuy", () => {
  it("calls prepareInvocation with buy_nft and returns PreparedTransaction", async () => {
    mockSoroban.prepareInvocation.mockResolvedValue("unsigned-buy-xdr");

    const result = await svc.prepareBuy("GBUYER", 7);

    expect(mockSoroban.prepareInvocation).toHaveBeenCalledWith(
      "GBUYER",
      "MARKETPLACE_CONTRACT",
      "buy_nft",
      expect.any(Array)
    );
    expect(result).toEqual({
      xdr: "unsigned-buy-xdr",
      networkPassphrase: "Test SDF Network ; September 2015",
    });
  });
});

describe("MarketplaceService.submitBuy", () => {
  it("submits signed XDR and returns txHash", async () => {
    mockSoroban.submitSignedTransaction.mockResolvedValue({ hash: "buy-txhash", returnValue: undefined });

    const result = await svc.submitBuy("signed-buy-xdr");

    expect(mockSoroban.submitSignedTransaction).toHaveBeenCalledWith("signed-buy-xdr");
    expect(result).toEqual({ txHash: "buy-txhash" });
  });

  it("rethrows Soroban errors", async () => {
    mockSoroban.submitSignedTransaction.mockRejectedValue(new Error("contract error"));
    await expect(svc.submitBuy("bad-xdr")).rejects.toThrow("contract error");
  });
});
