import { MarketplaceController } from '../MarketplaceController';
import {
  createMockRequest,
  createMockResponse,
  assertErrorResponse,
  MockResponse,
} from '../../../tests/helpers';

/**
 * MarketplaceController's success responses are `{ success: true, data }`
 * with no `message` field, unlike the `assertSuccessResponse` helper's
 * `{ success, message, ...data }` shape (built for AdminController-style
 * responses) - so this asserts this controller's actual shape directly
 * instead.
 */
function assertMarketplaceSuccess(res: MockResponse, data?: Record<string, unknown>): void {
  expect(res.status).toHaveBeenCalledWith(200);
  if (data !== undefined) {
    expect(res.json).toHaveBeenCalledWith({ success: true, data });
  } else {
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  }
}

// handleError -> logRequestError imports the live Redis client, which opens a
// socket that keeps the process alive. Mock it so the suite exits cleanly.
jest.mock('../../config/redis', () => ({
  __esModule: true,
  default: { incr: jest.fn(), expire: jest.fn(), get: jest.fn(), set: jest.fn(), del: jest.fn() },
}));

// Factory mocks so the controller never loads the real services (which pull
// in the DB data source / Stellar network clients at import time).
const mockPrepareListing = jest.fn();
const mockSubmitListing = jest.fn();
const mockPrepareBuy = jest.fn();
const mockSubmitBuy = jest.fn();
const mockPrepareAuction = jest.fn();
const mockSubmitAuction = jest.fn();
const mockPrepareBid = jest.fn();
const mockSubmitBid = jest.fn();
jest.mock('../../services/Marketplace/MarketplaceService', () => ({
  MarketplaceService: jest.fn().mockImplementation(() => ({
    prepareListing: (...args: unknown[]) => mockPrepareListing(...args),
    submitListing: (...args: unknown[]) => mockSubmitListing(...args),
    prepareBuy: (...args: unknown[]) => mockPrepareBuy(...args),
    submitBuy: (...args: unknown[]) => mockSubmitBuy(...args),
    prepareAuction: (...args: unknown[]) => mockPrepareAuction(...args),
    submitAuction: (...args: unknown[]) => mockSubmitAuction(...args),
    prepareBid: (...args: unknown[]) => mockPrepareBid(...args),
    submitBid: (...args: unknown[]) => mockSubmitBid(...args),
  })),
}));

const mockNotificationCreate = jest.fn();
jest.mock('../../services/NotificationService', () => ({
  NotificationService: jest.fn().mockImplementation(() => ({
    create: (...args: unknown[]) => mockNotificationCreate(...args),
  })),
}));

const STELLAR_KEY = 'GABCDEFTESTSTELLARPUBLICKEY';

describe('MarketplaceController (#313)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNotificationCreate.mockResolvedValue(undefined);
  });

  // ── prepareListing ──────────────────────────────────────────────────────

  describe('prepareListing', () => {
    it('returns 200 with the prepared transaction for a connected wallet', async () => {
      mockPrepareListing.mockResolvedValue({ xdr: 'unsigned-xdr' });
      const req = createMockRequest({
        user: { stellarPublicKey: STELLAR_KEY },
        body: { tokenId: '42', priceInStroops: '1000000' },
      });
      const res = createMockResponse();

      await MarketplaceController.prepareListing(req, res as any);

      expect(mockPrepareListing).toHaveBeenCalledWith(STELLAR_KEY, 42, 1000000);
      assertMarketplaceSuccess(res, { xdr: 'unsigned-xdr' });
    });

    it('rejects with 400 when no Stellar wallet is connected (unauthorized listing attempt)', async () => {
      const req = createMockRequest({ body: { tokenId: '42', priceInStroops: '1000000' } });
      const res = createMockResponse();

      await MarketplaceController.prepareListing(req, res as any);

      expect(mockPrepareListing).not.toHaveBeenCalled();
      assertErrorResponse(res, { status: 400, message: 'Connect a Stellar wallet before listing' });
    });

    it('propagates a service failure as an error response', async () => {
      const { AppError } = jest.requireActual('../../errors/AppError');
      mockPrepareListing.mockRejectedValue(AppError.notFound('Token not found'));
      const req = createMockRequest({
        user: { stellarPublicKey: STELLAR_KEY },
        body: { tokenId: '999', priceInStroops: '1000000' },
      });
      const res = createMockResponse();

      await MarketplaceController.prepareListing(req, res as any);

      assertErrorResponse(res, { status: 404, message: 'Token not found' });
    });
  });

  // ── submitListing ───────────────────────────────────────────────────────

  describe('submitListing', () => {
    it('returns 200 with the submitted transaction hash', async () => {
      mockSubmitListing.mockResolvedValue({ txHash: 'tx-listing-1' });
      const req = createMockRequest({ body: { signedXdr: 'signed-xdr' } });
      const res = createMockResponse();

      await MarketplaceController.submitListing(req, res as any);

      expect(mockSubmitListing).toHaveBeenCalledWith('signed-xdr');
      assertMarketplaceSuccess(res, { txHash: 'tx-listing-1' });
    });

    it('propagates a service failure as an error response', async () => {
      const { AppError } = jest.requireActual('../../errors/AppError');
      mockSubmitListing.mockRejectedValue(AppError.businessLogic('Listing already sold'));
      const req = createMockRequest({ body: { signedXdr: 'stale-xdr' } });
      const res = createMockResponse();

      await MarketplaceController.submitListing(req, res as any);

      assertErrorResponse(res, { status: 400, message: 'Listing already sold' });
    });
  });

  // ── prepareBuy ───────────────────────────────────────────────────────────

  describe('prepareBuy', () => {
    it('returns 200 with the prepared transaction for a connected wallet', async () => {
      mockPrepareBuy.mockResolvedValue({ xdr: 'buy-xdr' });
      const req = createMockRequest({
        user: { stellarPublicKey: STELLAR_KEY },
        body: { tokenId: '7' },
      });
      const res = createMockResponse();

      await MarketplaceController.prepareBuy(req, res as any);

      expect(mockPrepareBuy).toHaveBeenCalledWith(STELLAR_KEY, 7);
      assertMarketplaceSuccess(res);
    });

    it('rejects with 400 when no Stellar wallet is connected (unauthorized buy attempt)', async () => {
      const req = createMockRequest({ body: { tokenId: '7' } });
      const res = createMockResponse();

      await MarketplaceController.prepareBuy(req, res as any);

      expect(mockPrepareBuy).not.toHaveBeenCalled();
      assertErrorResponse(res, { status: 400, message: 'Connect a Stellar wallet before buying' });
    });
  });

  // ── submitBuy ────────────────────────────────────────────────────────────

  describe('submitBuy', () => {
    it('returns 200 and best-effort notifies the buyer on success', async () => {
      mockSubmitBuy.mockResolvedValue({ txHash: 'tx-buy-1' });
      const req = createMockRequest({
        userId: 'buyer-1',
        body: { signedXdr: 'buy-signed-xdr' },
      });
      const res = createMockResponse();

      await MarketplaceController.submitBuy(req, res as any);

      expect(mockSubmitBuy).toHaveBeenCalledWith('buy-signed-xdr');
      expect(mockNotificationCreate).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'buyer-1', type: 'marketplace_sale' }),
      );
      assertMarketplaceSuccess(res, { txHash: 'tx-buy-1' });
    });

    it('still returns 200 when the best-effort notification fails', async () => {
      mockSubmitBuy.mockResolvedValue({ txHash: 'tx-buy-2' });
      mockNotificationCreate.mockRejectedValue(new Error('notification service down'));
      const req = createMockRequest({
        userId: 'buyer-2',
        body: { signedXdr: 'buy-signed-xdr' },
      });
      const res = createMockResponse();

      await MarketplaceController.submitBuy(req, res as any);

      assertMarketplaceSuccess(res, { txHash: 'tx-buy-2' });
    });

    it('skips notification when the request has no authenticated user', async () => {
      mockSubmitBuy.mockResolvedValue({ txHash: 'tx-buy-3' });
      const req = createMockRequest({ body: { signedXdr: 'buy-signed-xdr' } });
      const res = createMockResponse();

      await MarketplaceController.submitBuy(req, res as any);

      expect(mockNotificationCreate).not.toHaveBeenCalled();
      assertMarketplaceSuccess(res);
    });

    it('propagates a service failure as an error response', async () => {
      const { AppError } = jest.requireActual('../../errors/AppError');
      mockSubmitBuy.mockRejectedValue(AppError.businessLogic('Insufficient balance'));
      const req = createMockRequest({ body: { signedXdr: 'buy-signed-xdr' } });
      const res = createMockResponse();

      await MarketplaceController.submitBuy(req, res as any);

      expect(mockNotificationCreate).not.toHaveBeenCalled();
      assertErrorResponse(res, { status: 400, message: 'Insufficient balance' });
    });
  });

  // ── prepareAuction / submitAuction ──────────────────────────────────────

  describe('prepareAuction', () => {
    it('returns 200 with the prepared transaction for a connected wallet', async () => {
      mockPrepareAuction.mockResolvedValue({ xdr: 'auction-xdr' });
      const req = createMockRequest({
        user: { stellarPublicKey: STELLAR_KEY },
        body: { tokenId: '3', startingPriceInStroops: '500000', durationSeconds: '86400' },
      });
      const res = createMockResponse();

      await MarketplaceController.prepareAuction(req, res as any);

      expect(mockPrepareAuction).toHaveBeenCalledWith(STELLAR_KEY, 3, 500000, 86400);
      assertMarketplaceSuccess(res);
    });

    it('rejects with 400 when no Stellar wallet is connected (unauthorized auction attempt)', async () => {
      const req = createMockRequest({
        body: { tokenId: '3', startingPriceInStroops: '500000', durationSeconds: '86400' },
      });
      const res = createMockResponse();

      await MarketplaceController.prepareAuction(req, res as any);

      expect(mockPrepareAuction).not.toHaveBeenCalled();
      assertErrorResponse(res, { status: 400, message: 'Connect a Stellar wallet before listing' });
    });
  });

  describe('submitAuction', () => {
    it('returns 200 with the submitted transaction hash', async () => {
      mockSubmitAuction.mockResolvedValue({ txHash: 'tx-auction-1' });
      const req = createMockRequest({ body: { signedXdr: 'auction-signed-xdr' } });
      const res = createMockResponse();

      await MarketplaceController.submitAuction(req, res as any);

      expect(mockSubmitAuction).toHaveBeenCalledWith('auction-signed-xdr');
      assertMarketplaceSuccess(res, { txHash: 'tx-auction-1' });
    });

    it('propagates a service failure as an error response', async () => {
      const { AppError } = jest.requireActual('../../errors/AppError');
      mockSubmitAuction.mockRejectedValue(AppError.notFound('Auction not found'));
      const req = createMockRequest({ body: { signedXdr: 'bad-xdr' } });
      const res = createMockResponse();

      await MarketplaceController.submitAuction(req, res as any);

      assertErrorResponse(res, { status: 404, message: 'Auction not found' });
    });
  });

  // ── prepareBid / submitBid ───────────────────────────────────────────────

  describe('prepareBid', () => {
    it('returns 200 with the prepared transaction for a connected wallet', async () => {
      mockPrepareBid.mockResolvedValue({ xdr: 'bid-xdr' });
      const req = createMockRequest({
        user: { stellarPublicKey: STELLAR_KEY },
        body: { tokenId: '3', bidAmountInStroops: '600000' },
      });
      const res = createMockResponse();

      await MarketplaceController.prepareBid(req, res as any);

      expect(mockPrepareBid).toHaveBeenCalledWith(STELLAR_KEY, 3, 600000);
      assertMarketplaceSuccess(res);
    });

    it('rejects with 400 when no Stellar wallet is connected (unauthorized bid attempt)', async () => {
      const req = createMockRequest({ body: { tokenId: '3', bidAmountInStroops: '600000' } });
      const res = createMockResponse();

      await MarketplaceController.prepareBid(req, res as any);

      expect(mockPrepareBid).not.toHaveBeenCalled();
      assertErrorResponse(res, { status: 400, message: 'Connect a Stellar wallet before bidding' });
    });
  });

  describe('submitBid', () => {
    it('returns 200 with the submitted transaction hash', async () => {
      mockSubmitBid.mockResolvedValue({ txHash: 'tx-bid-1' });
      const req = createMockRequest({ body: { signedXdr: 'bid-signed-xdr' } });
      const res = createMockResponse();

      await MarketplaceController.submitBid(req, res as any);

      expect(mockSubmitBid).toHaveBeenCalledWith('bid-signed-xdr');
      assertMarketplaceSuccess(res, { txHash: 'tx-bid-1' });
    });

    it('propagates a service failure as an error response', async () => {
      const { AppError } = jest.requireActual('../../errors/AppError');
      mockSubmitBid.mockRejectedValue(AppError.businessLogic('Bid below current highest'));
      const req = createMockRequest({ body: { signedXdr: 'low-bid-xdr' } });
      const res = createMockResponse();

      await MarketplaceController.submitBid(req, res as any);

      assertErrorResponse(res, { status: 400, message: 'Bid below current highest' });
    });
  });
});
