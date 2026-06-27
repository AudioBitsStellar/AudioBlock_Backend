/**
 * End-to-end test suite for the marketplace relay flow (#52).
 *
 * The relay pattern: backend builds an unsigned Soroban transaction, the
 * client wallet signs it (Freighter / mock in tests), then the signed XDR
 * is submitted back for on-chain execution.  These tests exercise the full
 * controller → service → SorobanService stack with the service tier mocked
 * so they run in CI without requiring a live testnet connection.
 *
 * Covered paths:
 *   prepare-listing  → success, missing wallet, Soroban RPC error
 *   submit-listing   → success (mock-signed XDR), invalid XDR, expired tx
 *   prepare-buy      → success, missing wallet
 *   submit-buy       → success, Soroban rejection
 */

import "reflect-metadata";

// ── Module-level mock variables (must be prefixed "mock" for Jest hoisting) ──

const mockPrepareListing = jest.fn();
const mockSubmitListing  = jest.fn();
const mockPrepareBuy     = jest.fn();
const mockSubmitBuy      = jest.fn();

// Mock the service so the controller's module-level singleton uses our fns
jest.mock("../services/Marketplace/MarketplaceService", () => ({
  MarketplaceService: jest.fn().mockImplementation(() => ({
    prepareListing: mockPrepareListing,
    submitListing:  mockSubmitListing,
    prepareBuy:     mockPrepareBuy,
    submitBuy:      mockSubmitBuy,
  })),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import { MarketplaceController } from "../controllers/MarketplaceController";
import { Request, Response } from "express";

// ── Helpers ────────────────────────────────────────────────────────────────────

function mockReq(overrides: Record<string, unknown> = {}): Request {
  return { body: {}, params: {}, query: {}, ...overrides } as unknown as Request;
}

function mockRes(): { res: Response; json: jest.Mock; status: jest.Mock } {
  const json   = jest.fn();
  const status = jest.fn().mockReturnThis();
  return { res: { json, status } as unknown as Response, json, status };
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockPrepareListing.mockReset();
  mockSubmitListing.mockReset();
  mockPrepareBuy.mockReset();
  mockSubmitBuy.mockReset();
});

// ══════════════════════════════════════════════════════════════════════════════
// Listing relay flow: prepare → (client mock-signs) → submit
// ══════════════════════════════════════════════════════════════════════════════

describe("Relay flow: prepare-listing → submit-listing", () => {
  // Step 1: backend prepares unsigned XDR ─────────────────────────────────────

  it("prepareListing returns unsigned XDR and network passphrase on success", async () => {
    mockPrepareListing.mockResolvedValue({
      xdr: "UNSIGNED_LISTING_XDR",
      networkPassphrase: "Test SDF Network ; September 2015",
    });

    const req = mockReq({
      body: { tokenId: 42, priceInStroops: 5_000_000 },
      user: { stellarPublicKey: "GSELLER_PK" },
    });
    const { res, json, status } = mockRes();

    await MarketplaceController.prepareListing(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ xdr: "UNSIGNED_LISTING_XDR" }),
      })
    );
  });

  it("prepareListing rejects when stellar wallet is not connected", async () => {
    const req = mockReq({
      body: { tokenId: 1, priceInStroops: 100 },
      user: { stellarPublicKey: undefined },
    });
    const { res, status } = mockRes();

    await MarketplaceController.prepareListing(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(mockPrepareListing).not.toHaveBeenCalled();
  });

  it("prepareListing propagates Soroban RPC errors", async () => {
    mockPrepareListing.mockRejectedValue(new Error("RPC timeout"));

    const req = mockReq({
      body: { tokenId: 5, priceInStroops: 1_000_000 },
      user: { stellarPublicKey: "GSELLER_PK" },
    });
    const { res, status } = mockRes();

    await MarketplaceController.prepareListing(req, res);

    // handleError() maps Error instances to 400; only unknown non-Error values map to 500
    expect(status).toHaveBeenCalledWith(400);
  });

  // Step 2: client signs, backend receives signed XDR ─────────────────────────

  it("submitListing accepts mock-signed XDR and returns txHash (success path)", async () => {
    const TX_HASH = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    mockSubmitListing.mockResolvedValue({ txHash: TX_HASH });

    const req = mockReq({ body: { signedXdr: "MOCK_SIGNED_LISTING_XDR" } });
    const { res, json } = mockRes();

    await MarketplaceController.submitListing(req, res);

    expect(mockSubmitListing).toHaveBeenCalledWith("MOCK_SIGNED_LISTING_XDR");
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ txHash: TX_HASH }),
      })
    );
  });

  it("submitListing returns error for invalid (unparseable) signed XDR", async () => {
    mockSubmitListing.mockRejectedValue(
      new Error("Soroban transaction rejected: invalid_xdr")
    );

    const req = mockReq({ body: { signedXdr: "NOT_VALID_XDR" } });
    const { res, status } = mockRes();

    await MarketplaceController.submitListing(req, res);

    expect(status).toHaveBeenCalledWith(400); // handleError maps Error → 400
  });

  it("submitListing returns error for expired transaction (TRANSACTION_EXPIRED)", async () => {
    // Simulates a transaction signed outside the 120-second window set in
    // SorobanService.prepareInvocation (see docs/ON_CHAIN_INTEGRATION.md).
    mockSubmitListing.mockRejectedValue(
      new Error("Soroban transaction rejected: TRANSACTION_EXPIRED")
    );

    const req = mockReq({ body: { signedXdr: "EXPIRED_SIGNED_XDR" } });
    const { res, status } = mockRes();

    await MarketplaceController.submitListing(req, res);

    expect(status).toHaveBeenCalledWith(400); // handleError maps Error → 400
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Buy relay flow: prepare → (client mock-signs) → submit
// ══════════════════════════════════════════════════════════════════════════════

describe("Relay flow: prepare-buy → submit-buy", () => {
  it("prepareBuy returns unsigned XDR on success", async () => {
    mockPrepareBuy.mockResolvedValue({
      xdr: "UNSIGNED_BUY_XDR",
      networkPassphrase: "Test SDF Network ; September 2015",
    });

    const req = mockReq({
      body: { tokenId: 99 },
      user: { stellarPublicKey: "GBUYER_PK" },
    });
    const { res, json } = mockRes();

    await MarketplaceController.prepareBuy(req, res);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ xdr: "UNSIGNED_BUY_XDR" }),
      })
    );
  });

  it("prepareBuy rejects when stellar wallet is not connected", async () => {
    const req = mockReq({
      body: { tokenId: 1 },
      user: { stellarPublicKey: undefined },
    });
    const { res, status } = mockRes();

    await MarketplaceController.prepareBuy(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(mockPrepareBuy).not.toHaveBeenCalled();
  });

  it("submitBuy accepts mock-signed XDR and returns txHash", async () => {
    mockSubmitBuy.mockResolvedValue({ txHash: "buy-tx-hash-0000" });

    const req = mockReq({ body: { signedXdr: "MOCK_SIGNED_BUY_XDR" } });
    const { res, json } = mockRes();

    await MarketplaceController.submitBuy(req, res);

    expect(mockSubmitBuy).toHaveBeenCalledWith("MOCK_SIGNED_BUY_XDR");
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ txHash: "buy-tx-hash-0000" }),
      })
    );
  });

  it("submitBuy propagates on-chain rejection (e.g. not-listed, insufficient balance)", async () => {
    mockSubmitBuy.mockRejectedValue(
      new Error("Soroban transaction rejected: CONTRACT_CALL_FAILED")
    );

    const req = mockReq({ body: { signedXdr: "SIGNED_BUY_XDR" } });
    const { res, status } = mockRes();

    await MarketplaceController.submitBuy(req, res);

    expect(status).toHaveBeenCalledWith(400); // handleError maps Error → 400
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Full relay round-trip (prepare → mock-sign → submit) documented
// ══════════════════════════════════════════════════════════════════════════════

describe("Full relay round-trip (simulated)", () => {
  /**
   * Documents the relay pattern end-to-end:
   *   1. prepareListing   → backend builds unsigned XDR
   *   2. mock-sign        → test simulates what Freighter would do
   *   3. submitListing    → backend relays signed XDR to the network
   *
   * In production the XDR returned by step 1 is a real Stellar transaction
   * that must be signed with the artist's secret key; in tests we pass a
   * fake string that the mocked service accepts without validation.
   */
  it("listing: prepare returns XDR, client signs it, submit returns txHash", async () => {
    const UNSIGNED_XDR = "PREPARE_STEP_XDR";
    const SIGNED_XDR   = "WALLET_SIGNED_XDR"; // what Freighter would produce
    const TX_HASH      = "relay-success-txhash";

    mockPrepareListing.mockResolvedValue({
      xdr: UNSIGNED_XDR,
      networkPassphrase: "Test SDF Network ; September 2015",
    });
    mockSubmitListing.mockResolvedValue({ txHash: TX_HASH });

    // Step 1: prepare
    const prepareReq = mockReq({
      body: { tokenId: 10, priceInStroops: 2_000_000 },
      user: { stellarPublicKey: "GSELLER" },
    });
    const { res: prepareRes, json: prepareJson } = mockRes();
    await MarketplaceController.prepareListing(prepareReq, prepareRes);

    const prepareBody = prepareJson.mock.calls[0][0];
    expect(prepareBody.success).toBe(true);
    expect(prepareBody.data.xdr).toBe(UNSIGNED_XDR);

    // Step 2: client wallet signs (Freighter would use the real XDR bytes)
    const walletSignedXdr = SIGNED_XDR;

    // Step 3: submit
    const submitReq = mockReq({ body: { signedXdr: walletSignedXdr } });
    const { res: submitRes, json: submitJson } = mockRes();
    await MarketplaceController.submitListing(submitReq, submitRes);

    const submitBody = submitJson.mock.calls[0][0];
    expect(submitBody.success).toBe(true);
    expect(submitBody.data.txHash).toBe(TX_HASH);
  });
});
