/**
 * What the marketplace relay does with the listing store (#920).
 *
 * These pin the two rules the status table depends on: a row is only ever
 * written from what the signed transaction actually says, and the store is a
 * witness to the relay — never a gate on it.
 */

import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';

const mockMarketplaceContract = StrKey.encodeContract(Buffer.alloc(32, 7));
const mockOtherContract = StrKey.encodeContract(Buffer.alloc(32, 9));
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

const mockSubmitSigned = jest.fn();
const mockPublish = jest.fn();
const mockRecordPending = jest.fn();
const mockMarkActive = jest.fn();
const mockMarkFailed = jest.fn();
const mockMarkSold = jest.fn();

jest.mock('../services/Soroban/SorobanService', () => ({
  SorobanService: jest.fn().mockImplementation(() => ({
    submitSignedTransaction: mockSubmitSigned,
  })),
  addressArg: jest.fn((value: unknown) => value),
  u64Arg: jest.fn((value: unknown) => value),
}));

jest.mock('../config/soroban', () => ({
  getNetworkPassphrase: () => TESTNET_PASSPHRASE,
  SorobanContracts: {
    get marketplace() {
      return mockMarketplaceContract;
    },
  },
}));

jest.mock('../services/Marketplace/MarketplaceListingService', () => ({
  MarketplaceListingService: jest.fn().mockImplementation(() => ({
    recordPending: mockRecordPending,
    markActive: mockMarkActive,
    markFailed: mockMarkFailed,
    markSoldByToken: mockMarkSold,
  })),
}));

jest.mock('../services/WebhookService', () => ({
  WebhookService: jest.fn().mockImplementation(() => ({ publish: mockPublish })),
}));

jest.mock('../config/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { MarketplaceService } from '../services/Marketplace/MarketplaceService';

const seller = Keypair.random();

function signedXdr(contractId: string, method: string, args: xdr.ScVal[]): string {
  const account = new Account(seller.publicKey(), '1');
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: TESTNET_PASSPHRASE,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(120)
    .build();

  transaction.sign(seller);
  return transaction.toXDR();
}

const addressArg = (publicKey: string): xdr.ScVal => nativeToScVal(publicKey, { type: 'address' });
const u64 = (value: number | string): xdr.ScVal => nativeToScVal(BigInt(value), { type: 'u64' });

const listingXdr = (contractId = mockMarketplaceContract) =>
  signedXdr(contractId, 'list_nft', [addressArg(seller.publicKey()), u64(7), u64(10_000_000)]);

const auctionXdr = (durationSeconds: number) =>
  signedXdr(mockMarketplaceContract, 'create_auction', [
    addressArg(seller.publicKey()),
    u64(42),
    u64(5_000_000),
    u64(durationSeconds),
  ]);

const buyXdr = (tokenId = 7) =>
  signedXdr(mockMarketplaceContract, 'buy_nft', [addressArg(seller.publicKey()), u64(tokenId)]);

let service: MarketplaceService;
let row: { id: string; status: string };

beforeEach(() => {
  jest.clearAllMocks();
  row = { id: 'row-1', status: 'pending' };
  mockRecordPending.mockResolvedValue(row);
  mockMarkActive.mockResolvedValue(row);
  mockMarkFailed.mockResolvedValue(row);
  mockMarkSold.mockResolvedValue(row);
  mockSubmitSigned.mockResolvedValue({ hash: 'HASH-OK', returnValue: undefined });
  mockPublish.mockResolvedValue(undefined);
  service = new MarketplaceService();
});

describe('submitListing', () => {
  it('records the decoded intent, then activates it with the confirmed hash', async () => {
    const result = await service.submitListing(listingXdr());

    expect(mockRecordPending).toHaveBeenCalledWith({
      tokenId: '7',
      kind: 'fixed_price',
      sellerPublicKey: seller.publicKey(),
      priceStroops: '10000000',
      endsAt: undefined,
    });
    expect(mockMarkActive).toHaveBeenCalledWith(row, 'HASH-OK');
    expect(result).toEqual({ txHash: 'HASH-OK' });
  });

  it('fails the row with the rejection the network returned, and still raises it', async () => {
    const rejection = new Error('Soroban transaction rejected: SOROBAN_TOO_MANY_REQUESTS');
    mockSubmitSigned.mockRejectedValue(rejection);

    await expect(service.submitListing(listingXdr())).rejects.toThrow(rejection);
    expect(mockMarkFailed).toHaveBeenCalledWith(
      row,
      'Soroban transaction rejected: SOROBAN_TOO_MANY_REQUESTS',
    );
    expect(mockMarkActive).not.toHaveBeenCalled();
  });

  it('records nothing for XDR that is not a marketplace call', async () => {
    const result = await service.submitListing('signed-list-xdr');

    expect(mockRecordPending).not.toHaveBeenCalled();
    expect(mockMarkActive).not.toHaveBeenCalled();
    expect(result).toEqual({ txHash: 'HASH-OK' });
  });

  it('records nothing for a call aimed at another contract', async () => {
    await service.submitListing(listingXdr(mockOtherContract));
    expect(mockRecordPending).not.toHaveBeenCalled();
  });

  it('relays a listing even when the store cannot be written', async () => {
    mockRecordPending.mockRejectedValue(new Error('connection terminated'));

    const result = await service.submitListing(listingXdr());

    expect(result).toEqual({ txHash: 'HASH-OK' });
    expect(mockMarkActive).not.toHaveBeenCalled();
  });

  it('keeps a confirmed listing confirmed when the status write fails', async () => {
    mockMarkActive.mockRejectedValue(new Error('connection terminated'));

    await expect(service.submitListing(listingXdr())).resolves.toEqual({ txHash: 'HASH-OK' });
  });

  it('never lets a store outage replace the network error', async () => {
    mockSubmitSigned.mockRejectedValue(new Error('network timeout'));
    mockMarkFailed.mockRejectedValue(new Error('connection terminated'));

    await expect(service.submitListing(listingXdr())).rejects.toThrow('network timeout');
  });
});

describe('submitAuction', () => {
  it('stores the close time the seller signed, so the sweep can expire it', async () => {
    const before = Date.now();
    await service.submitAuction(auctionXdr(86_400));

    const intent = mockRecordPending.mock.calls[0][0] as {
      kind: string;
      endsAt: Date;
      tokenId: string;
    };
    expect(intent.kind).toBe('auction');
    expect(intent.tokenId).toBe('42');
    expect(intent.endsAt.getTime()).toBeGreaterThanOrEqual(before + 86_400_000);
    expect(intent.endsAt.getTime()).toBeLessThanOrEqual(Date.now() + 86_400_000);
  });

  it('opens no row for an auction signed without an end time', async () => {
    const truncated = signedXdr(mockMarketplaceContract, 'create_auction', [
      addressArg(seller.publicKey()),
      u64(42),
      u64(5_000_000),
    ]);

    await service.submitAuction(truncated);
    expect(mockRecordPending).not.toHaveBeenCalled();
  });
});

describe('submitBuy', () => {
  it('marks the purchased token sold and names it in the webhook', async () => {
    const result = await service.submitBuy(buyXdr(7));

    expect(mockMarkSold).toHaveBeenCalledWith('7', 'HASH-OK');
    expect(mockPublish).toHaveBeenCalledWith('sale.completed', { txHash: 'HASH-OK', tokenId: '7' });
    expect(result).toEqual({ txHash: 'HASH-OK' });
  });

  it('still publishes the sale when the token cannot be identified', async () => {
    await service.submitBuy('signed-buy-xdr');

    expect(mockMarkSold).not.toHaveBeenCalled();
    expect(mockPublish).toHaveBeenCalledWith('sale.completed', {
      txHash: 'HASH-OK',
      tokenId: null,
    });
  });

  it('leaves the listing untouched if the network rejects the purchase', async () => {
    mockSubmitSigned.mockRejectedValue(new Error('contract error'));

    await expect(service.submitBuy(buyXdr(7))).rejects.toThrow('contract error');
    expect(mockMarkSold).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('does not fail the sale when the status write does', async () => {
    mockMarkSold.mockRejectedValue(new Error('connection terminated'));

    await expect(service.submitBuy(buyXdr(7))).resolves.toEqual({ txHash: 'HASH-OK' });
  });

  it('does not mark a listing from a bid', async () => {
    const bid = signedXdr(mockMarketplaceContract, 'place_bid', [
      addressArg(seller.publicKey()),
      u64(7),
      u64(12_000_000),
    ]);

    await service.submitBuy(bid);
    expect(mockMarkSold).not.toHaveBeenCalled();
  });
});

describe('a marketplace contract that is not configured', () => {
  it('still relays, and records nothing', async () => {
    jest.resetModules();
    jest.doMock('../config/soroban', () => ({
      getNetworkPassphrase: () => 'Test SDF Network ; September 2015',
      SorobanContracts: {
        get marketplace() {
          throw new Error('SOROBAN_TESTNET_MARKETPLACE_CONTRACT_ID is not configured');
        },
      },
    }));

    const { MarketplaceService: Unconfigured } =
      (await import('../services/Marketplace/MarketplaceService')) as {
        MarketplaceService: new () => MarketplaceService;
      };

    await expect(new Unconfigured().submitListing(listingXdr())).resolves.toEqual({
      txHash: 'HASH-OK',
    });
    expect(mockRecordPending).not.toHaveBeenCalled();
  });
});
