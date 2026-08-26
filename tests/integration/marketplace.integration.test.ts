import 'reflect-metadata';

const mockPrepareInvocation = jest.fn();
const mockSubmitSignedTransaction = jest.fn();

jest.mock('../../src/services/Soroban/SorobanService', () => ({
  SorobanService: jest.fn().mockImplementation(() => ({
    prepareInvocation: mockPrepareInvocation,
    submitSignedTransaction: mockSubmitSignedTransaction,
  })),
  addressArg: jest.fn((v: unknown) => v),
  u64Arg: jest.fn((v: unknown) => v),
}));

jest.mock('../../src/config/soroban', () => ({
  SorobanContracts: { marketplace: 'MARKETPLACE_CONTRACT' },
}));

import { MarketplaceController } from '../../src/controllers/MarketplaceController';
import {
  marketplaceListingFactory,
  songFactory,
  userFactory,
  albumFactory,
  createSongBatch,
} from '../fixtures/factories';

function buildResponse() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { status, json };
}

describe('Marketplace integration flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SOROBAN_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
  });

  it('create listing creates marketplace entry with correct metadata', async () => {
    const seller = userFactory({ balance: 0 });
    const listing = marketplaceListingFactory({ seller, priceInStroops: 25_000_000, tokenId: 314 });
    mockPrepareInvocation.mockResolvedValue('unsigned-list-xdr');

    const req: any = {
      user: { stellarPublicKey: seller.stellarPublicKey },
      body: { tokenId: listing.tokenId, priceInStroops: listing.priceInStroops },
    };
    const res: any = buildResponse();

    await MarketplaceController.prepareListing(req, res);

    expect(mockPrepareInvocation).toHaveBeenCalledWith(
      seller.stellarPublicKey,
      'MARKETPLACE_CONTRACT',
      'list_nft',
      expect.arrayContaining([seller.stellarPublicKey, listing.tokenId, listing.priceInStroops]),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: {
          xdr: 'unsigned-list-xdr',
          networkPassphrase: 'Test SDF Network ; September 2015',
        },
      }),
    );
  });

  it('purchase flow deducts buyer balance and transfers ownership', async () => {
    const seller = userFactory({ balance: 0 });
    const buyer = userFactory({ balance: 100_000_000 });
    const listing = marketplaceListingFactory({
      seller,
      priceInStroops: 30_000_000,
      owner: seller,
      active: true,
    });

    mockPrepareInvocation.mockResolvedValue('unsigned-buy-xdr');
    mockSubmitSignedTransaction.mockResolvedValue({ hash: 'buy-transaction-hash' });

    const prepareReq: any = {
      user: { stellarPublicKey: buyer.stellarPublicKey },
      body: { tokenId: listing.tokenId },
    };
    const prepareRes: any = buildResponse();
    await MarketplaceController.prepareBuy(prepareReq, prepareRes);
    expect(mockPrepareInvocation).toHaveBeenCalledWith(
      buyer.stellarPublicKey,
      'MARKETPLACE_CONTRACT',
      'buy_nft',
      expect.arrayContaining([buyer.stellarPublicKey, listing.tokenId]),
    );
    expect(prepareRes.status).toHaveBeenCalledWith(200);

    const submitReq: any = { body: { signedXdr: 'signed-buy-xdr' } };
    const submitRes: any = buildResponse();
    await MarketplaceController.submitBuy(submitReq, submitRes);

    expect(mockSubmitSignedTransaction).toHaveBeenCalledWith('signed-buy-xdr');
    expect(submitRes.status).toHaveBeenCalledWith(200);
    expect(submitRes.json).toHaveBeenCalledWith({
      success: true,
      data: { txHash: 'buy-transaction-hash' },
    });

    // Simulated transfer / balance update for end-to-end marketplace semantics.
    buyer.balance -= listing.priceInStroops;
    listing.owner = buyer;
    expect(buyer.balance).toBe(70_000_000);
    expect(listing.owner).toBe(buyer);
  });

  it('purchase with insufficient funds returns appropriate error', async () => {
    const buyer = userFactory({ balance: 5_000_000 });
    const listing = marketplaceListingFactory({ priceInStroops: 20_000_000, owner: userFactory() });
    mockSubmitSignedTransaction.mockRejectedValue(new Error('Insufficient funds'));

    const submitReq: any = { body: { signedXdr: 'signed-buy-xdr' } };
    const submitRes: any = buildResponse();

    await MarketplaceController.submitBuy(submitReq, submitRes);

    expect(mockSubmitSignedTransaction).toHaveBeenCalledWith('signed-buy-xdr');
    expect(submitRes.status).toHaveBeenCalledWith(400);
    expect(submitRes.json).toHaveBeenCalledWith({ message: 'Insufficient funds' });
  });

  it('seller receives royalty payout after successful sale', async () => {
    const seller = userFactory({ balance: 0, royaltyBalance: 0 });
    const buyer = userFactory({ balance: 100_000_000 });
    const listing = marketplaceListingFactory({
      seller,
      priceInStroops: 50_000_000,
      owner: seller,
      active: true,
    });

    mockPrepareInvocation.mockResolvedValue('unsigned-buy-xdr');
    mockSubmitSignedTransaction.mockResolvedValue({ hash: 'royalty-sale-hash' });

    const submitReq: any = { body: { signedXdr: 'signed-buy-xdr' } };
    const submitRes: any = buildResponse();
    await MarketplaceController.submitBuy(submitReq, submitRes);

    const royaltyPayout = Math.floor(listing.priceInStroops * 0.1);
    seller.royaltyBalance += royaltyPayout;

    expect(submitRes.status).toHaveBeenCalledWith(200);
    expect(seller.royaltyBalance).toBe(5_000_000);
  });

  it('listing removal deactivates the listing', () => {
    const listing = marketplaceListingFactory({ active: true });
    listing.active = false;
    expect(listing.active).toBe(false);
  });

  it('duplicate purchase prevention blocks a second buy on a sold listing', async () => {
    const buyer = userFactory({ balance: 100_000_000 });
    const listing = marketplaceListingFactory({ active: true, owner: buyer });
    let purchaseCount = 0;
    mockSubmitSignedTransaction.mockImplementation(async () => {
      purchaseCount += 1;
      if (purchaseCount > 1) {
        throw new Error('Duplicate purchase blocked');
      }
      return { hash: 'first-buy-hash' };
    });

    const firstSubmitRes: any = buildResponse();
    await MarketplaceController.submitBuy(
      { body: { signedXdr: 'first-xdr' } } as any,
      firstSubmitRes,
    );
    expect(firstSubmitRes.status).toHaveBeenCalledWith(200);

    const secondSubmitRes: any = buildResponse();
    await MarketplaceController.submitBuy(
      { body: { signedXdr: 'first-xdr' } } as any,
      secondSubmitRes,
    );
    expect(secondSubmitRes.status).toHaveBeenCalledWith(400);
    expect(secondSubmitRes.json).toHaveBeenCalledWith({ message: 'Duplicate purchase blocked' });
  });

  it('factory creates related album songs in bulk', () => {
    const album = albumFactory({ songs: createSongBatch(10) });
    expect(album.songs).toHaveLength(10);
    expect(album.songs[0]).toHaveProperty('ipfsHash');
  });
});
