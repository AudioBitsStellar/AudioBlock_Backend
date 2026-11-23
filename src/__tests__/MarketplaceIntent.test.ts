/**
 * Reading a marketplace call back out of the XDR a wallet signed (#920).
 *
 * The lifecycle store is only as good as its source, so these run against
 * transactions built the same way `SorobanService.prepareInvocation` builds
 * them — a real `Contract.call` operation in a real transaction envelope —
 * rather than against hand-written stand-ins.
 */

import {
  Account,
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  Operation,
  StrKey,
  Transaction,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';
import { readMarketplaceIntent } from '../services/Marketplace/marketplaceIntent';

const MARKETPLACE = StrKey.encodeContract(Buffer.alloc(32, 7));
const OTHER_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 9));

const seller = Keypair.random();
const options = { networkPassphrase: Networks.TESTNET, marketplaceContractId: MARKETPLACE };

function addressArg(publicKey: string): xdr.ScVal {
  return nativeToScVal(publicKey, { type: 'address' });
}

function u64(value: number | string): xdr.ScVal {
  return nativeToScVal(BigInt(value), { type: 'u64' });
}

/** Mirrors the relay: build the invocation, let the wallet sign it, hand the XDR over. */
function signedXdr(contractId: string, method: string, args: xdr.ScVal[]): string {
  const account = new Account(seller.publicKey(), '1');
  const transaction: Transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(120)
    .build();

  transaction.sign(seller);
  return transaction.toXDR();
}

describe('readMarketplaceIntent', () => {
  it('reads a fixed-price listing from the signed transaction', () => {
    const intent = readMarketplaceIntent(
      signedXdr(MARKETPLACE, 'list_nft', [addressArg(seller.publicKey()), u64(7), u64(10_000_000)]),
      options,
    );

    expect(intent).toEqual({
      functionName: 'list_nft',
      contractId: MARKETPLACE,
      tokenId: '7',
      signerAddress: seller.publicKey(),
      amountStroops: '10000000',
    });
  });

  it('reads the auction length, which is what makes expiry derivable', () => {
    const intent = readMarketplaceIntent(
      signedXdr(MARKETPLACE, 'create_auction', [
        addressArg(seller.publicKey()),
        u64(42),
        u64(5_000_000),
        u64(86_400),
      ]),
      options,
    );

    expect(intent).toMatchObject({
      functionName: 'create_auction',
      tokenId: '42',
      amountStroops: '5000000',
      durationSeconds: 86400,
    });
  });

  it('reads a purchase', () => {
    const intent = readMarketplaceIntent(
      signedXdr(MARKETPLACE, 'buy_nft', [addressArg(seller.publicKey()), u64(7)]),
      options,
    );

    expect(intent).toMatchObject({ functionName: 'buy_nft', tokenId: '7' });
    expect(intent?.amountStroops).toBeUndefined();
  });

  it('reads a bid', () => {
    const intent = readMarketplaceIntent(
      signedXdr(MARKETPLACE, 'place_bid', [
        addressArg(seller.publicKey()),
        u64(7),
        u64(12_000_000),
      ]),
      options,
    );

    expect(intent).toMatchObject({
      functionName: 'place_bid',
      tokenId: '7',
      amountStroops: '12000000',
    });
  });

  it('reads through a fee-bump wrapper', () => {
    const feePayer = Keypair.random();
    const account = new Account(seller.publicKey(), '1');
    const inner = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        new Contract(MARKETPLACE).call(
          'list_nft',
          addressArg(seller.publicKey()),
          u64(7),
          u64(10_000_000),
        ),
      )
      .setTimeout(120)
      .build();

    inner.sign(seller);
    const bumped = TransactionBuilder.buildFeeBumpTransaction(
      feePayer.publicKey(),
      BASE_FEE,
      inner,
      Networks.TESTNET,
    );

    expect(readMarketplaceIntent(bumped.toXDR(), options)).toMatchObject({
      functionName: 'list_nft',
      tokenId: '7',
    });
  });

  it('handles token ids a JavaScript number cannot hold', () => {
    const huge = '18446744073709551615';
    const intent = readMarketplaceIntent(
      signedXdr(MARKETPLACE, 'list_nft', [
        addressArg(seller.publicKey()),
        nativeToScVal(BigInt(huge), { type: 'u64' }),
        u64(1),
      ]),
      options,
    );

    expect(intent?.tokenId).toBe(huge);
  });
});

describe('what the reader refuses to guess', () => {
  it('ignores an XDR that is not a transaction', () => {
    expect(readMarketplaceIntent('not-xdr-at-all', options)).toBeNull();
  });

  it('ignores an empty string', () => {
    expect(readMarketplaceIntent('', options)).toBeNull();
  });

  it('ignores an invocation aimed at a different contract', () => {
    expect(
      readMarketplaceIntent(
        signedXdr(OTHER_CONTRACT, 'list_nft', [addressArg(seller.publicKey()), u64(7), u64(1)]),
        options,
      ),
    ).toBeNull();
  });

  it('ignores an operation that is not a contract call', () => {
    const account = new Account(seller.publicKey(), '1');
    const payment = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: seller.publicKey(),
          asset: Asset.native(),
          amount: '1',
        }),
      )
      .setTimeout(120)
      .build();
    payment.sign(seller);

    expect(readMarketplaceIntent(payment.toXDR(), options)).toBeNull();
  });

  it('ignores a contract function this backend does not relay', () => {
    expect(
      readMarketplaceIntent(
        signedXdr(MARKETPLACE, 'withdraw_royalties', [addressArg(seller.publicKey())]),
        options,
      ),
    ).toBeNull();
  });

  it('ignores a listing call that is missing its price', () => {
    expect(
      readMarketplaceIntent(
        signedXdr(MARKETPLACE, 'list_nft', [addressArg(seller.publicKey()), u64(7)]),
        options,
      ),
    ).toBeNull();
  });

  it('ignores an auction with no end time, since nothing could expire', () => {
    expect(
      readMarketplaceIntent(
        signedXdr(MARKETPLACE, 'create_auction', [
          addressArg(seller.publicKey()),
          u64(7),
          u64(5_000_000),
        ]),
        options,
      ),
    ).toBeNull();
  });

  it('ignores a zero-length auction', () => {
    expect(
      readMarketplaceIntent(
        signedXdr(MARKETPLACE, 'create_auction', [
          addressArg(seller.publicKey()),
          u64(7),
          u64(5_000_000),
          u64(0),
        ]),
        options,
      ),
    ).toBeNull();
  });

  it('ignores arguments in the wrong positions', () => {
    expect(
      readMarketplaceIntent(signedXdr(MARKETPLACE, 'list_nft', [u64(7), u64(1), u64(2)]), options),
    ).toBeNull();
  });
});
